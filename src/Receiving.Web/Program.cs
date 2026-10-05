using System.Security.Claims;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authentication.Negotiate;
using Microsoft.AspNetCore.DataProtection;
using Receiving.Web;

var builder = WebApplication.CreateBuilder(args);
var dataDir = Path.GetFullPath(builder.Configuration["DataDir"] ?? "data", builder.Environment.ContentRootPath);
Directory.CreateDirectory(Path.Combine(dataDir, "pdfs"));
Directory.CreateDirectory(Path.Combine(dataDir, "keys"));
Directory.CreateDirectory(Path.Combine(dataDir, "final"));

var dp = builder.Services.AddDataProtection().SetApplicationName("NBS.Receiving")
    .PersistKeysToFileSystem(new DirectoryInfo(Path.Combine(dataDir, "keys")));
if (OperatingSystem.IsWindows()) dp.ProtectKeysWithDpapi(protectToLocalMachine: true);   // machine scope: IIS app pool identities have no user profile

builder.Services.AddSingleton(new Db(Path.Combine(dataDir, "receiving.db")));
builder.Services.AddSingleton<SettingsStore>();
builder.Services.AddSingleton(new DataPaths(dataDir));
builder.Services.AddSingleton<BackupService>();
builder.Services.AddHostedService(sp => sp.GetRequiredService<BackupService>());
builder.Services.AddSingleton<Mailer>();
builder.Services.AddHostedService<AlertService>();
builder.Services.AddHostedService(sp => sp.GetRequiredService<Mailer>());
builder.WebHost.ConfigureKestrel(o => o.Limits.MaxRequestBodySize = 100L * 1024 * 1024);
// IIS must not sign people in on its own: only our cookie counts, and Windows login runs only on /api/auth/windows.
builder.Services.Configure<IISServerOptions>(o => { o.MaxRequestBodySize = 100L * 1024 * 1024; o.AutomaticAuthentication = false; });

builder.Services.AddAuthentication(o => { o.DefaultScheme = CookieAuthenticationDefaults.AuthenticationScheme; o.DefaultAuthenticateScheme = CookieAuthenticationDefaults.AuthenticationScheme; o.DefaultChallengeScheme = CookieAuthenticationDefaults.AuthenticationScheme; })
    .AddCookie(o =>
    {
        o.Cookie.Name = "nbs.auth"; o.Cookie.HttpOnly = true; o.Cookie.SameSite = SameSiteMode.Strict;
        o.ExpireTimeSpan = TimeSpan.FromHours(12);
        o.Events.OnRedirectToLogin = c => { c.Response.StatusCode = 401; return Task.CompletedTask; };
        o.Events.OnRedirectToAccessDenied = c => { c.Response.StatusCode = 403; return Task.CompletedTask; };
    })
    .AddNegotiate();
builder.Services.AddAuthorization(o => o.AddPolicy("Admin", p => p.RequireRole("admin")));

var app = builder.Build();
var db = app.Services.GetRequiredService<Db>();
var cfg = app.Services.GetRequiredService<SettingsStore>();
var mail = app.Services.GetRequiredService<Mailer>();
var backup = app.Services.GetRequiredService<BackupService>();
var fctx = new FeatureCtx(app, db, cfg, mail, dataDir, GetMe, Origin, LoadPacket);
// In-process IIS has its own Windows login; Kestrel uses the Negotiate handler.
var underIis = app.Services.GetRequiredService<Microsoft.AspNetCore.Hosting.Server.IServer>().GetType().Name.Contains("IIS", StringComparison.OrdinalIgnoreCase)
    || Environment.GetEnvironmentVariable("ASPNETCORE_IIS_HTTPAUTH") != null;

// first admin
if (db.Query("SELECT 1 FROM admins", r => 1).Count == 0)
    db.Exec("INSERT INTO admins(account,name,added_by,added_at) VALUES($0,$1,$2,$3)", @"BG\sims.anderson", "Sims Anderson", "system", Now());

app.UseDefaultFiles();
app.UseStaticFiles(new StaticFileOptions
{
    // app pages and scripts: always ask the server if they changed (cheap, uses the ETag) so an update shows up on the next load.
    // libraries and icons never change under the same name, so those can be cached for a day.
    OnPrepareResponse = ctx =>
    {
        var p = ctx.Context.Request.Path.Value ?? "";
        ctx.Context.Response.Headers["Cache-Control"] = p.StartsWith("/vendor/") || p.StartsWith("/icons/") || p.StartsWith("/tolerances/") ? "public, max-age=86400" : "no-cache";
    }
});
app.Use(async (c, next) =>
{
    if (c.Request.Path.StartsWithSegments("/api") && !HttpMethods.IsGet(c.Request.Method) && !HttpMethods.IsHead(c.Request.Method)
        && c.Request.Headers["X-Requested-With"] != "fetch")
    { c.Response.StatusCode = 400; await c.Response.WriteAsJsonAsync(new { error = "Bad request" }); return; }
    await next();
});
app.UseAuthentication();
app.UseAuthorization();
app.Use(async (c, next) =>
{
    // someone whose PIN was just set by an admin may only change it
    if (c.User.Identity?.IsAuthenticated == true && c.User.FindFirstValue("mustchange") == "1" && c.Request.Path.StartsWithSegments("/api") && !c.Request.Path.StartsWithSegments("/api/auth") && !c.Request.Path.StartsWithSegments("/api/config"))
    { c.Response.StatusCode = 403; await c.Response.WriteAsJsonAsync(new { error = "Choose a new PIN first.", mustChange = true }); return; }
    await next();
});

static long Now() => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
string[] AllRoles = ["receiver", "coordinator", "reviewer"];
var api = app.MapGroup("/api");

/* ---------------- config + auth ---------------- */
api.MapGet("/config", () => { var g = cfg.General(); return new { g.SiteName, g.IdleMinutes, g.PinLength }; });

api.MapGet("/auth/cards", () => db.Query("SELECT id,name,initials,roles FROM users WHERE active=1 AND pin_hash IS NOT NULL ORDER BY name",
    r => new { id = r.GetInt64(0), name = r.GetString(1), initials = r.GetString(2), roles = r.GetString(3).Split(',', StringSplitOptions.RemoveEmptyEntries) }));

api.MapGet("/auth/me", (ClaimsPrincipal u) => GetMe(u) is { } m ? Results.Ok(MeJson(m)) : Results.Unauthorized());

api.MapPost("/auth/pin", async (HttpContext c, PinReq req) =>
{
    var g = cfg.General();
    var u = db.One("SELECT id,name,initials,roles,pin_hash,pin_salt,active,failed,locked_until,must_change FROM users WHERE id=$0",
        r => new { Id = r.GetInt64(0), Name = r.GetString(1), Ini = r.GetString(2), Roles = r.GetString(3), H = r.IsDBNull(4) ? null : r.GetString(4), S = r.IsDBNull(5) ? null : r.GetString(5), Act = r.GetInt32(6) == 1, Fail = r.GetInt32(7), Lock = r.GetInt64(8), Must = r.GetInt32(9) == 1 }, req.UserId);
    if (u == null || !u.Act) return Results.Json(new { error = "Unknown user" }, statusCode: 401);
    if (u.Lock > Now()) return Results.Json(new { error = $"Locked. Try again in {Math.Ceiling((u.Lock - Now()) / 60000.0)} min or ask an admin." }, statusCode: 423);
    if (!Pin.Check(req.Pin ?? "", u.H, u.S))
    {
        var f = u.Fail + 1; var lockTo = f >= g.MaxFailed ? Now() + g.LockMinutes * 60000L : 0;
        db.Exec("UPDATE users SET failed=$1, locked_until=$2 WHERE id=$0", u.Id, lockTo == 0 ? f : 0, lockTo);
        db.Audit(u.Name, lockTo > 0 ? "pin_locked" : "pin_fail", $"attempt {f}");
        return Results.Json(new { error = lockTo > 0 ? $"Too many tries. Locked for {g.LockMinutes} min." : "Wrong PIN" }, statusCode: 401);
    }
    db.Exec("UPDATE users SET failed=0, locked_until=0 WHERE id=$0", u.Id);
    var me = new Me("pin", u.Id.ToString(), u.Name, u.Ini, u.Roles.Split(',', StringSplitOptions.RemoveEmptyEntries), u.Must);
    await c.SignInAsync(Principal(me));
    db.Audit(u.Name, "login", "pin");
    return Results.Ok(MeJson(me));
});

// Windows integrated sign-in (admins only). GET so the browser can complete the Negotiate handshake.
api.MapGet("/auth/windows", async (HttpContext c) =>
{
    var winScheme = underIis ? "Windows" : NegotiateDefaults.AuthenticationScheme;
    // ?next=1 means the browser navigated here (top level), which is the only reliable way to let it do the Windows handshake.
    // Without it the reply is JSON, for scripts and tests.
    var nav = c.Request.Query.ContainsKey("next");
    async Task Page(int status, string title, string text)
    {
        c.Response.StatusCode = status; c.Response.ContentType = "text/html; charset=utf-8";
        await c.Response.WriteAsync($"<!doctype html><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'><title>{title}</title><body style=\"margin:0;min-height:100vh;display:grid;place-items:center;background:#F5F4F0;font:16px Arial,sans-serif;color:#1b2a26;text-align:center;padding:24px\"><div><h1 style=\"color:#213B34\">{title}</h1><p style=\"color:#5d6b66\">{text}</p><p><a href=\"/\" style=\"display:inline-block;background:#006325;color:#fff;padding:14px 26px;border-radius:8px;text-decoration:none;font-weight:bold\">Back to Steel Receiving</a></p></div></body>");
    }
    AuthenticateResult r;
    try { r = await c.AuthenticateAsync(winScheme); }
    catch (Exception ex)
    {
        if (nav) { await Page(500, "Windows sign-in is not available", System.Net.WebUtility.HtmlEncode(ex.Message)); return; }
        c.Response.StatusCode = 500; await c.Response.WriteAsJsonAsync(new { error = "Windows sign-in is not available here (" + winScheme + "): " + ex.Message }); return;
    }
    if (!r.Succeeded || r.Principal?.Identity?.Name is not { } acct)
    {
        await c.ChallengeAsync(winScheme);
        if (nav) await Page(401, "Windows sign-in needed", "Your browser did not send Windows credentials. Try again and enter your Windows user name and password if asked.");
        return;
    }
    var local = acct.Contains('\\') ? acct[(acct.IndexOf('\\') + 1)..] : acct;
    var row = db.One("SELECT account,name FROM admins WHERE account=$0 OR account=$1 OR (instr(account,'\\')=0 AND account=$1)",
        x => new { Acct = x.GetString(0), Name = x.GetString(1) }, acct, local);
    if (row == null)
    {
        db.Audit(acct, "windows_denied");
        if (nav) { await Page(403, "Not an admin", System.Net.WebUtility.HtmlEncode(acct) + " is not on the admin list. Ask an admin to add it in Settings."); return; }
        c.Response.StatusCode = 403; await c.Response.WriteAsJsonAsync(new { error = $"{acct} is not an admin." }); return;
    }
    var me = new Me("win", acct, string.IsNullOrWhiteSpace(row.Name) ? acct : row.Name, Initials(row.Name, acct), ["admin", "coordinator", "receiver", "reviewer"]);
    await c.SignInAsync(Principal(me));
    db.Audit(acct, "login", "windows");
    if (nav) { c.Response.Redirect("/#/"); return; }
    await c.Response.WriteAsJsonAsync(MeJson(me));
});

api.MapPost("/auth/change-pin", async (HttpContext c, ChangePinReq req) =>
{
    var me = GetMe(c.User); if (me == null || me.Kind != "pin") return Results.Unauthorized();
    var len = cfg.General().PinLength;
    if (string.IsNullOrEmpty(req.New) || req.New.Length != len || !req.New.All(char.IsDigit)) return Results.BadRequest(new { error = $"New PIN must be {len} digits." });
    var row = db.One("SELECT pin_hash,pin_salt FROM users WHERE id=$0", r => new { H = r.IsDBNull(0) ? null : r.GetString(0), S = r.IsDBNull(1) ? null : r.GetString(1) }, long.Parse(me.Id));
    if (row == null || !Pin.Check(req.Current ?? "", row.H, row.S)) return Results.Json(new { error = "Current PIN is wrong." }, statusCode: 400);
    if (req.New == req.Current) return Results.BadRequest(new { error = "Pick a different PIN." });
    var (h, s) = Pin.Make(req.New);
    db.Exec("UPDATE users SET pin_hash=$1,pin_salt=$2,must_change=0,failed=0,locked_until=0 WHERE id=$0", long.Parse(me.Id), h, s);
    db.Audit(me.Name, "pin_changed", "");
    var fresh = new Me("pin", me.Id, me.Name, me.Initials, me.Roles, false);
    await c.SignInAsync(Principal(fresh));
    return Results.Ok(MeJson(fresh));
});

api.MapPost("/auth/logout", async (HttpContext c) => { await c.SignOutAsync(); return Results.Ok(); });

/* ---------------- packets ---------------- */
var pk = api.MapGroup("/packets").RequireAuthorization();

static bool IsDraft(JsonNode? n) => n?["ready"] is JsonValue v && v.TryGetValue<bool>(out var b) && !b;

pk.MapGet("", (ClaimsPrincipal u, bool? all) =>
{
    var cutoff = Now() - 60L * 86400000; var seeAll = GetMe(u)!.Has("coordinator");
    var rows = db.Query("SELECT id,bol,stage,created,updated,data FROM packets ORDER BY created DESC", r => PacketJson(r.GetString(0), r.GetString(1), r.GetString(2), r.GetInt64(3), r.GetInt64(4), r.GetString(5)));
    var shown = rows.Where(p => (seeAll || !IsDraft(p)) && (all == true || p["stage"]!.GetValue<string>() != "filed" || p["updated"]!.GetValue<long>() > cutoff)).ToList();
    var live = db.Query("SELECT k,name FROM locks WHERE expires>$0", r => (k: r.GetString(0), name: r.GetString(1)), Now());
    foreach (var p in shown)
        p["locks"] = new JsonArray(live.Where(l => l.k.StartsWith(p["id"]!.GetValue<string>() + "|")).Select(l => (JsonNode)new JsonObject { ["k"] = l.k, ["name"] = l.name }).ToArray());
    return shown;
});

pk.MapGet("/{id}", (string id, ClaimsPrincipal u) => LoadPacket(id) is { } p && (GetMe(u)!.Has("coordinator") || !IsDraft(p.Data)) ? Results.Ok(p.ToJson()) : Results.NotFound());

pk.MapPost("", (ClaimsPrincipal u, HttpContext c, JsonObject body) =>
{
    var me = GetMe(u)!; if (!me.Has("coordinator")) return Results.Forbid();
    var bol = body["bol"]?.GetValue<string>()?.Trim(); var rows = body["rows"] as JsonArray;
    if (string.IsNullOrEmpty(bol) || rows == null || rows.Count == 0) return Results.BadRequest(new { error = "BOL # and at least one row are required." });
    if (db.Query("SELECT 1 FROM packets WHERE bol=$0", r => 1, bol).Count > 0) return Results.Conflict(new { error = $"BOL {bol} is already in the system." });
    var id = Guid.NewGuid().ToString("N")[..12];
    var data = new JsonObject
    {
        ["vendor"] = Str(body, "vendor"), ["ship"] = Str(body, "ship"), ["carrier"] = Str(body, "carrier"),
        ["rows"] = JsonNode.Parse(rows.ToJsonString()), ["forms"] = new JsonObject(), ["approvals"] = new JsonArray(), ["log"] = new JsonArray(), ["hasPdf"] = false, ["ready"] = false
    };
    AddLog(data, me.Name, "Packet indexed");
    db.Exec("INSERT INTO packets(id,bol,stage,created,updated,data) VALUES($0,$1,'new',$2,$2,$3)", id, bol, Now(), data.ToJsonString());
    var pkt = LoadPacket(id)!;
    db.Audit(me.Name, "packet_create", bol);
    return Results.Ok(pkt.ToJson());   // stays a draft until the PDF is attached, then receivers are notified
});

pk.MapPost("/{id}/pdf", async (string id, ClaimsPrincipal u, HttpContext c) =>
{
    var me = GetMe(u)!; if (!me.Has("coordinator")) return Results.Forbid();
    var p = LoadPacket(id); if (p == null) return Results.NotFound();
    var path = Path.Combine(dataDir, "pdfs", id + ".pdf");
    await using (var fs = File.Create(path)) await c.Request.Body.CopyToAsync(fs);
    var first = IsDraft(p.Data);
    p.Data["hasPdf"] = true; p.Data["ready"] = true;
    if (first) AddLog(p.Data, me.Name, "PDF attached, sent to receivers");
    p.Save();
    if (first) Notify("packet_created", p, me.Name, Origin(c));
    return Results.Ok();
});

pk.MapGet("/{id}/pdf", (string id) =>
{
    var path = Path.Combine(dataDir, "pdfs", Path.GetFileName(id) + ".pdf");
    return File.Exists(path) ? Results.File(path, "application/pdf") : Results.NotFound();
});

string FinalPath(string id) => Path.Combine(dataDir, "final", Path.GetFileName(id) + ".pdf");
byte[] BuildFinal(PacketRec p)
{
    var orig = Path.Combine(dataDir, "pdfs", Path.GetFileName(p.Id) + ".pdf");
    return FinalPacket.Build(p.Bol, p.Stage, p.Data, File.Exists(orig) ? orig : null, cfg.General().SiteName, Path.Combine(dataDir, "photos", Path.GetFileName(p.Id)));
}
void StoreFinal(PacketRec p) { try { var bytes = BuildFinal(p); File.WriteAllBytes(FinalPath(p.Id), bytes); Features.DropFinal(fctx, p, bytes); } catch (Exception ex) { app.Logger.LogError(ex, "Could not store final packet for {Bol}", p.Bol); } }

pk.MapGet("/{id}/final.pdf", (string id, string? inline, ClaimsPrincipal u) =>
{
    var p = LoadPacket(id); if (p == null || (IsDraft(p.Data) && !GetMe(u)!.Has("coordinator"))) return Results.NotFound();
    byte[] bytes;
    if (p.Stage == "filed")
    {
        if (!File.Exists(FinalPath(id))) StoreFinal(p);      // filed before storing existed
        bytes = File.Exists(FinalPath(id)) ? File.ReadAllBytes(FinalPath(id)) : BuildFinal(p);
    }
    else bytes = BuildFinal(p);                               // preview only, not stored
    return inline is "1" or "true" ? Results.File(bytes, "application/pdf") : Results.File(bytes, "application/pdf", $"BOL {p.Bol} final packet.pdf");
});

pk.MapGet("/{id}/csv", (string id) =>
{
    var p = LoadPacket(id); if (p == null) return Results.NotFound();
    return Results.File(Encoding.UTF8.GetPreamble().Concat(Encoding.UTF8.GetBytes(Features.DocuwareCsv(cfg, p.Bol, p.Data))).ToArray(), "text/csv", $"DocuWare index BOL {p.Bol}.csv");
});

pk.MapPost("/{id}/drop", (string id, ClaimsPrincipal u) =>
{
    var me = GetMe(u)!; if (!me.Has("coordinator")) return Results.Forbid();
    var p = LoadPacket(id); if (p == null) return Results.NotFound();
    if (p.Stage != "filed") return Results.Conflict(new { error = "Only a filed packet can be copied to the folder." });
    if (!File.Exists(FinalPath(id))) StoreFinal(p);
    var r = Features.DropFinal(fctx, p, File.Exists(FinalPath(id)) ? File.ReadAllBytes(FinalPath(id)) : BuildFinal(p));
    if (r == "") return Results.BadRequest(new { error = "The folder copy is switched off or has no folder. Set it in Settings > Integrations." });
    return r.StartsWith("ERR:") ? Results.BadRequest(new { error = r[4..] }) : Results.Ok(new { file = r });
});

pk.MapPut("/{id}/forms/{po}/{type}", (string id, string po, string type, ClaimsPrincipal u, HttpContext c, JsonObject body) =>
{
    var me = GetMe(u)!; if (!me.Has("receiver", "coordinator")) return Results.Forbid();
    var p = LoadPacket(id); if (p == null) return Results.NotFound();
    if (p.Stage is not ("new" or "inspecting")) return Results.Conflict(new { error = "Packet is past inspection." });
    var forms = p.Data["forms"]!.AsObject(); var key = po + "|" + type;
    if (forms[key] is JsonObject old && old["submitted"]?.GetValue<bool>() == true) return Results.Conflict(new { error = "Already submitted. Reopen to edit." });
    var (lockOk, holder) = TryLock(id + "|" + key, me);
    if (!lockOk) return Results.Conflict(new { error = $"{holder} has this form open. You can't save over their work.", holder });
    var submit = body["submit"]?.GetValue<bool>() == true;
    forms[key] = new JsonObject { ["submitted"] = submit, ["date"] = Str(body, "date"), ["inspector"] = me.Initials, ["by"] = me.Name, ["items"] = JsonNode.Parse(body["items"]?.ToJsonString() ?? "[]") };
    if (submit)
    {
        db.Exec("DELETE FROM locks WHERE k=$0", id + "|" + key);
        if (p.Stage == "new") p.Stage = "inspecting";
        AddLog(p.Data, me.Initials, $"Submitted {TypeName(type)} inspection for {po}");
    }
    p.Save();
    if (submit && forms[key]!["items"] is JsonArray its)
    {
        var labels = new Dictionary<string, string> { ["surface"] = "Surface", ["cert"] = "Cert.", ["visual"] = "Visual Insp." };
        var rej = new List<string>();
        foreach (var it in its.Select(i => i!.AsObject()))
        {
            if (it["skip"]?.ToString() is "True" or "true") continue;
            var bad = it.Where(a => a.Value?.ToString() == "bad").Select(a => labels.GetValueOrDefault(a.Key, a.Key)).ToList();
            if (bad.Count > 0) rej.Add($"CC {Str(it, "cc")} ({TypeName(type)}, PO {po}): {string.Join(", ", bad)}" + (Str(it, "comments") != "" ? " - " + Str(it, "comments") : ""));
        }
        if (rej.Count > 0) { AddLog(p.Data, "System", $"{rej.Count} rejected item(s) on the {TypeName(type)} inspection for {po}"); p.Save(); Notify("reject", p, me.Name, Origin(c), new Dictionary<string, string> { ["rejects"] = string.Join("\n", rej) }); }
    }
    return Results.Ok(p.ToJson());
});

pk.MapPost("/{id}/forms/{po}/{type}/reopen", (string id, string po, string type, ClaimsPrincipal u) =>
{
    var me = GetMe(u)!; if (!me.Has("receiver", "coordinator")) return Results.Forbid();
    var p = LoadPacket(id); if (p == null) return Results.NotFound();
    if (p.Stage is not ("new" or "inspecting")) return Results.Conflict(new { error = "Packet is past inspection." });
    if (p.Data["forms"]![po + "|" + type] is JsonObject f) { f["submitted"] = false; AddLog(p.Data, me.Initials, $"Reopened {TypeName(type)} inspection for {po}"); p.Save(); }
    return Results.Ok(p.ToJson());
});

pk.MapPost("/{id}/complete", (string id, ClaimsPrincipal u, HttpContext c) =>
{
    var me = GetMe(u)!; if (!me.Has("receiver", "coordinator")) return Results.Forbid();
    var p = LoadPacket(id); if (p == null) return Results.NotFound();
    if (p.Stage is not ("new" or "inspecting")) return Results.Conflict(new { error = "Already complete." });
    var forms = p.Data["forms"]!.AsObject();
    var missing = Pos(p.Data).Where(po => !forms.Any(kv => kv.Key.StartsWith(po + "|") && kv.Value?["submitted"]?.GetValue<bool>() == true)).ToList();
    if (missing.Count > 0) return Results.BadRequest(new { error = "No submitted inspection for " + string.Join(", ", missing) });
    var reviewers = db.Query("SELECT id,name FROM users WHERE active=1 AND (',' || roles || ',') LIKE '%,reviewer,%'", r => new JsonObject { ["id"] = r.GetInt64(0).ToString(), ["name"] = r.GetString(1) });
    if (p.Data["reviewerPick"] is JsonArray pick && pick.Count > 0) reviewers = pick.Select(x => (JsonObject)x!.DeepClone()).ToList();
    p.Data["requiredReviewers"] = new JsonArray(reviewers.Select(x => (JsonNode)x).ToArray());
    AddLog(p.Data, me.Name, "Inspection complete");
    if (reviewers.Count == 0) { p.Stage = "receive"; AddLog(p.Data, "System", "No reviewers configured, skipped review"); p.Save(); Notify("review_complete", p, me.Name, Origin(c)); }
    else { p.Stage = "review"; p.Save(); Notify("inspection_complete", p, me.Name, Origin(c)); }
    return Results.Ok(p.ToJson());
});

pk.MapPost("/{id}/approve", (string id, ClaimsPrincipal u, HttpContext c) =>
{
    var me = GetMe(u)!;
    var p = LoadPacket(id); if (p == null) return Results.NotFound();
    if (p.Stage != "review") return Results.Conflict(new { error = "Not in review." });
    var req = p.Data["requiredReviewers"]!.AsArray(); var apr = p.Data["approvals"]!.AsArray();
    if (!req.Any(r => r!["id"]!.GetValue<string>() == me.Id)) return Results.Forbid();
    if (apr.Any(a => a!["id"]!.GetValue<string>() == me.Id)) return Results.Ok(p.ToJson());
    apr.Add(new JsonObject { ["id"] = me.Id, ["n"] = me.Name, ["t"] = Now() });
    AddLog(p.Data, me.Name, "Approved");
    var done = cfg.General().ReviewRule == "any" || req.All(r => apr.Any(a => a!["id"]!.GetValue<string>() == r!["id"]!.GetValue<string>()));
    if (done) { p.Stage = "receive"; AddLog(p.Data, "System", "Review complete"); }
    p.Save();
    if (done) Notify("review_complete", p, me.Name, Origin(c));
    return Results.Ok(p.ToJson());
});

pk.MapPost("/{id}/receive", (string id, ClaimsPrincipal u, HttpContext c, JsonObject body) =>
{
    var me = GetMe(u)!; if (!me.Has("coordinator")) return Results.Forbid();
    var p = LoadPacket(id); if (p == null) return Results.NotFound();
    if (p.Stage != "receive") return Results.Conflict(new { error = "Not ready to receive." });
    var d365 = Str(body, "d365").Trim(); if (d365 == "") return Results.BadRequest(new { error = "D365 receipt # required." });
    p.Data["d365"] = d365; p.Stage = "authorize"; AddLog(p.Data, me.Name, $"Received in D365 ({d365})"); p.Save();
    Notify("received", p, me.Name, Origin(c));
    return Results.Ok(p.ToJson());
});

pk.MapPost("/{id}/authorize", (string id, ClaimsPrincipal u, HttpContext c) =>
{
    var me = GetMe(u)!; if (!me.Has("coordinator")) return Results.Forbid();
    var p = LoadPacket(id); if (p == null) return Results.NotFound();
    if (p.Stage != "authorize") return Results.Conflict(new { error = "Not ready to authorize." });
    p.Data["authBy"] = me.Name; p.Data["authAt"] = Now(); p.Stage = "filed"; AddLog(p.Data, me.Name, "Authorized, filed"); p.Save();
    StoreFinal(p);
    Notify("filed", p, me.Name, Origin(c));
    db.Audit(me.Name, "authorize", p.Bol);
    return Results.Ok(p.ToJson());
});

api.MapGet("/reviewers", (ClaimsPrincipal u) =>
{
    var me = GetMe(u); if (me == null || !me.Has("coordinator")) return Results.Forbid();
    return Results.Ok(db.Query("SELECT id,name FROM users WHERE active=1 AND (',' || roles || ',') LIKE '%,reviewer,%' ORDER BY name", r => new { id = r.GetInt64(0).ToString(), name = r.GetString(1) }));
}).RequireAuthorization();

// Intake can set who reviews a packet before inspection ends, and reassign while it is in review.
pk.MapPost("/{id}/reviewers", (string id, ClaimsPrincipal u, HttpContext c, JsonObject body) =>
{
    var me = GetMe(u)!; if (!me.Has("coordinator")) return Results.Forbid();
    var p = LoadPacket(id); if (p == null) return Results.NotFound();
    if (p.Stage is not ("new" or "inspecting" or "review")) return Results.Conflict(new { error = "Reviewers can only change before the packet is received." });
    var ids = (body["ids"] as JsonArray)?.Select(x => x!.ToString()).Distinct().ToList() ?? new List<string>();
    if (ids.Count == 0) return Results.BadRequest(new { error = "Pick at least one reviewer." });
    var valid = db.Query("SELECT id,name FROM users WHERE active=1 AND (',' || roles || ',') LIKE '%,reviewer,%'", r => (id: r.GetInt64(0).ToString(), name: r.GetString(1))).ToDictionary(x => x.id, x => x.name);
    if (ids.Any(i => !valid.ContainsKey(i))) return Results.BadRequest(new { error = "Only active users with the Reviewer role can be picked." });
    var picked = new JsonArray(ids.Select(i => (JsonNode)new JsonObject { ["id"] = i, ["name"] = valid[i] }).ToArray());
    var inReview = p.Stage == "review";
    var oldIds = ((inReview ? p.Data["requiredReviewers"] : p.Data["reviewerPick"]) as JsonArray)?.Select(x => x!["id"]!.GetValue<string>()).ToList() ?? new List<string>();
    var oldNames = ((inReview ? p.Data["requiredReviewers"] : p.Data["reviewerPick"]) as JsonArray)?.ToDictionary(x => x!["id"]!.GetValue<string>(), x => x!["name"]!.GetValue<string>()) ?? new Dictionary<string, string>();
    var added = ids.Except(oldIds).ToList(); var removed = oldIds.Except(ids).ToList();
    if (added.Count == 0 && removed.Count == 0) return Results.Ok(p.ToJson());
    p.Data[inReview ? "requiredReviewers" : "reviewerPick"] = picked;
    var parts = new List<string>();
    if (added.Count > 0) parts.Add("added " + string.Join(", ", added.Select(i => valid[i])));
    if (removed.Count > 0) parts.Add("removed " + string.Join(", ", removed.Select(i => oldNames.GetValueOrDefault(i, i))));
    AddLog(p.Data, me.Name, "Reviewers changed: " + string.Join("; ", parts));
    var advance = false;
    if (inReview)
    {
        var apr = p.Data["approvals"]!.AsArray();
        bool Approved(string i) => apr.Any(a => a!["id"]!.GetValue<string>() == i);
        advance = cfg.General().ReviewRule == "any" ? ids.Any(Approved) : ids.All(Approved);
        if (advance) { p.Stage = "receive"; AddLog(p.Data, "System", "Review complete"); }
    }
    p.Save();
    var origin = Origin(c);
    if (advance) Notify("review_complete", p, me.Name, origin);
    else if (inReview && added.Count > 0) NotifyUsers("inspection_complete", p, me.Name, origin, added);
    db.Audit(me.Name, "reviewers_changed", p.Bol + ": " + string.Join("; ", parts));
    return Results.Ok(p.ToJson());
});


/* ---------------- form locks, claims, overrides ---------------- */
const long LockMs = 3 * 60 * 1000;   // a form stays reserved for 3 minutes after its last heartbeat
(bool ok, string? holder) TryLock(string k, Me me)
{
    var now = Now();
    var rows = db.Query("SELECT user_id,name,expires FROM locks WHERE k=$0", r => (uid: r.GetString(0), name: r.GetString(1), exp: r.GetInt64(2)), k);
    if (rows.Count > 0 && rows[0].exp > now && rows[0].uid != me.Id) return (false, rows[0].name);
    db.Exec("INSERT INTO locks(k,user_id,name,expires) VALUES($0,$1,$2,$3) ON CONFLICT(k) DO UPDATE SET user_id=excluded.user_id,name=excluded.name,expires=excluded.expires", k, me.Id, me.Name, now + LockMs);
    return (true, null);
}

pk.MapPost("/{id}/forms/{po}/{type}/lock", (string id, string po, string type, ClaimsPrincipal u) =>
{
    var me = GetMe(u)!; if (!me.Has("receiver", "coordinator")) return Results.Forbid();
    var p = LoadPacket(id); if (p == null) return Results.NotFound();
    if (p.Stage is not ("new" or "inspecting")) return Results.Conflict(new { error = "Packet is past inspection." });
    if (p.Data["forms"]![po + "|" + type]?["submitted"]?.GetValue<bool>() == true) return Results.Ok(new { ok = true, readOnly = true });
    var (ok, holder) = TryLock(id + "|" + po + "|" + type, me);
    if (!ok) return Results.Conflict(new { error = $"{holder} is working on this form.", holder });
    if (p.Data["claimedBy"] == null && me.Roles.Contains("receiver"))
    {
        p.Data["claimedBy"] = new JsonObject { ["id"] = me.Id, ["name"] = me.Name, ["t"] = Now() };
        AddLog(p.Data, me.Name, "Claimed this packet"); p.Save();
    }
    return Results.Ok(new { ok = true });
});

pk.MapPost("/{id}/forms/{po}/{type}/unlock", (string id, string po, string type, ClaimsPrincipal u, JsonObject? body) =>
{
    var me = GetMe(u)!; var k = id + "|" + po + "|" + type;
    var force = body?["force"]?.GetValue<bool>() == true && me.Has("coordinator");
    if (force) { db.Exec("DELETE FROM locks WHERE k=$0", k); db.Audit(me.Name, "lock_released", k); }
    else db.Exec("DELETE FROM locks WHERE k=$0 AND user_id=$1", k, me.Id);
    return Results.Ok();
});

pk.MapPost("/{id}/claim", (string id, ClaimsPrincipal u) =>
{
    var me = GetMe(u)!; if (!me.Has("receiver", "coordinator")) return Results.Forbid();
    var p = LoadPacket(id); if (p == null) return Results.NotFound();
    if (p.Stage is not ("new" or "inspecting")) return Results.Conflict(new { error = "Packet is past inspection." });
    if (p.Data["claimedBy"] is JsonObject cur && Str(cur, "id") != me.Id) return Results.Conflict(new { error = $"{Str(cur, "name")} already claimed this packet." });
    p.Data["claimedBy"] = new JsonObject { ["id"] = me.Id, ["name"] = me.Name, ["t"] = Now() };
    AddLog(p.Data, me.Name, "Claimed this packet"); p.Save();
    return Results.Ok(p.ToJson());
});

pk.MapPost("/{id}/unclaim", (string id, ClaimsPrincipal u) =>
{
    var me = GetMe(u)!;
    var p = LoadPacket(id); if (p == null) return Results.NotFound();
    if (p.Data["claimedBy"] is JsonObject cur)
    {
        if (Str(cur, "id") != me.Id && !me.Has("coordinator")) return Results.Forbid();
        p.Data.Remove("claimedBy"); AddLog(p.Data, me.Name, "Released the claim on this packet"); p.Save();
    }
    return Results.Ok(p.ToJson());
});

// reviewer is out: intake can move the packet on, with a reason on the record
pk.MapPost("/{id}/skip-review", (string id, ClaimsPrincipal u, HttpContext c, JsonObject body) =>
{
    var me = GetMe(u)!; if (!me.Has("coordinator")) return Results.Forbid();
    var p = LoadPacket(id); if (p == null) return Results.NotFound();
    if (p.Stage != "review") return Results.Conflict(new { error = "Packet is not in review." });
    var reason = Str(body, "reason").Trim(); if (reason == "") return Results.BadRequest(new { error = "Give a reason." });
    p.Stage = "receive"; AddLog(p.Data, me.Name, "Review skipped: " + reason); p.Save();
    db.Audit(me.Name, "review_skipped", p.Bol + ": " + reason);
    Notify("review_complete", p, me.Name, Origin(c));
    return Results.Ok(p.ToJson());
});

// a filed packet can be unlocked: it goes back to "ready to authorize" and the saved final packet is discarded
pk.MapPost("/{id}/reopen", (string id, ClaimsPrincipal u, JsonObject body) =>
{
    var me = GetMe(u)!; if (!me.Has("coordinator")) return Results.Forbid();
    var p = LoadPacket(id); if (p == null) return Results.NotFound();
    if (p.Stage != "filed") return Results.Conflict(new { error = "Only a filed packet can be reopened." });
    var reason = Str(body, "reason").Trim(); if (reason == "") return Results.BadRequest(new { error = "Give a reason." });
    p.Stage = "authorize"; p.Data.Remove("authBy"); p.Data.Remove("authAt");
    AddLog(p.Data, me.Name, "Reopened: " + reason); p.Save();
    if (File.Exists(FinalPath(id))) File.Delete(FinalPath(id));
    db.Audit(me.Name, "packet_reopened", p.Bol + ": " + reason);
    return Results.Ok(p.ToJson());
});

pk.MapDelete("/{id}", (string id, ClaimsPrincipal u) =>
{
    var me = GetMe(u)!; if (!me.Has("coordinator")) return Results.Forbid();
    var p = LoadPacket(id); if (p == null) return Results.NotFound();
    if (p.Stage == "filed") return Results.Conflict(new { error = "Reopen a filed packet before deleting it." });
    var untouched = IsDraft(p.Data) || (p.Stage == "new" && !(p.Data["forms"] is JsonObject f && f.Count > 0));
    if (!untouched && !me.Admin) return Results.Conflict(new { error = "Only an admin can delete a packet that already has inspections." });
    DeleteOne(id); db.Audit(me.Name, "packet_deleted", p.Bol);
    return Results.Ok();
});

/* ---- saved layouts: where the fields sit on a vendor's BOL ---- */
var lay = api.MapGroup("/layouts").RequireAuthorization();
lay.MapGet("", (ClaimsPrincipal u) => GetMe(u)!.Has("coordinator") ? Results.Ok(db.Query("SELECT name,updated FROM layouts ORDER BY name", r => new { name = r.GetString(0), updated = r.GetInt64(1) })) : Results.Forbid());
lay.MapGet("/{name}", (string name, ClaimsPrincipal u) => !GetMe(u)!.Has("coordinator") ? Results.Forbid() : db.One("SELECT data FROM layouts WHERE name=$0", r => r.GetString(0), name) is { } d ? Results.Content(d, "application/json") : Results.NotFound());
lay.MapPut("/{name}", (string name, ClaimsPrincipal u, JsonObject body) =>
{
    if (!GetMe(u)!.Has("coordinator")) return Results.Forbid();
    if (string.IsNullOrWhiteSpace(name)) return Results.BadRequest(new { error = "Name is required." });
    db.Exec("INSERT INTO layouts(name,data,updated) VALUES($0,$1,$2) ON CONFLICT(name) DO UPDATE SET data=excluded.data,updated=excluded.updated", name.Trim(), body.ToJsonString(), Now());
    return Results.Ok();
});
lay.MapDelete("/{name}", (string name, ClaimsPrincipal u) => { if (!GetMe(u)!.Has("coordinator")) return Results.Forbid(); db.Exec("DELETE FROM layouts WHERE name=$0", name); return Results.Ok(); });

/* ---------------- admin ---------------- */
var ad = api.MapGroup("/admin").RequireAuthorization("Admin");

ad.MapGet("/users", () => db.Query("SELECT id,name,initials,email,roles,active,pin_hash IS NOT NULL,locked_until FROM users ORDER BY name",
    r => new { id = r.GetInt64(0), name = r.GetString(1), initials = r.GetString(2), email = r.GetString(3), roles = r.GetString(4).Split(',', StringSplitOptions.RemoveEmptyEntries), active = r.GetInt32(5) == 1, pinSet = r.GetInt32(6) == 1, locked = r.GetInt64(7) > Now() }));

ad.MapPost("/users", (ClaimsPrincipal u, UserReq q) =>
{
    var err = ValidateUser(q, true); if (err != null) return Results.BadRequest(new { error = err });
    var (h, s) = string.IsNullOrEmpty(q.Pin) ? ((string?)null, (string?)null) : Pin.Make(q.Pin);
    var id = db.Insert("INSERT INTO users(name,initials,email,roles,pin_hash,pin_salt,active,created,must_change) VALUES($0,$1,$2,$3,$4,$5,1,$6,$7)",
        q.Name!.Trim(), (q.Initials ?? Initials(q.Name!, "")).Trim().ToUpperInvariant(), (q.Email ?? "").Trim(), string.Join(",", q.Roles!), h, s, Now(), q.MustChange == true && !string.IsNullOrEmpty(q.Pin) ? 1 : 0);
    db.Audit(GetMe(u)!.Name, "user_create", q.Name!);
    return Results.Ok(new { id });
});

ad.MapPut("/users/{id:long}", (long id, ClaimsPrincipal u, UserReq q) =>
{
    var err = ValidateUser(q, false); if (err != null) return Results.BadRequest(new { error = err });
    db.Exec("UPDATE users SET name=$1,initials=$2,email=$3,roles=$4,active=$5 WHERE id=$0", id, q.Name!.Trim(), (q.Initials ?? "").Trim().ToUpperInvariant(), (q.Email ?? "").Trim(), string.Join(",", q.Roles!), q.Active == false ? 0 : 1);
    if (!string.IsNullOrEmpty(q.Pin)) { var (h, s) = Pin.Make(q.Pin); db.Exec("UPDATE users SET pin_hash=$1,pin_salt=$2,failed=0,locked_until=0,must_change=$3 WHERE id=$0", id, h, s, q.MustChange == true ? 1 : 0); }
    if (q.Unlock == true) db.Exec("UPDATE users SET failed=0,locked_until=0 WHERE id=$0", id);
    db.Audit(GetMe(u)!.Name, "user_update", q.Name!);
    return Results.Ok();
});

ad.MapGet("/admins", () => db.Query("SELECT account,name,email FROM admins ORDER BY account", r => new { account = r.GetString(0), name = r.GetString(1), email = r.GetString(2) }));
ad.MapPost("/admins", (ClaimsPrincipal u, AdminReq q) =>
{
    if (string.IsNullOrWhiteSpace(q.Account)) return Results.BadRequest(new { error = @"Account is required, like BG\first.last" });
    db.Exec("INSERT INTO admins(account,name,email,added_by,added_at) VALUES($0,$1,$2,$3,$4) ON CONFLICT(account) DO UPDATE SET name=excluded.name,email=excluded.email",
        q.Account.Trim(), q.Name ?? "", q.Email ?? "", GetMe(u)!.Name, Now());
    db.Audit(GetMe(u)!.Name, "admin_add", q.Account);
    return Results.Ok();
});
ad.MapDelete("/admins", (string account, ClaimsPrincipal u) =>
{
    if (db.Query("SELECT 1 FROM admins", r => 1).Count <= 1) return Results.BadRequest(new { error = "Cannot remove the last admin." });
    db.Exec("DELETE FROM admins WHERE account=$0", account);
    db.Audit(GetMe(u)!.Name, "admin_remove", account);
    return Results.Ok();
});

ad.MapGet("/settings", () =>
{
    var s = cfg.Smtp();
    return new { general = cfg.General(), smtp = new { s.Host, s.Port, s.Security, s.User, s.FromAddr, s.FromName, hasPassword = s.Password != "" }, notifs = cfg.Notifs() };
});
ad.MapPut("/settings", (ClaimsPrincipal u, SettingsReq q) =>
{
    var g = q.General; if (g.PinLength is < 4 or > 8) return Results.BadRequest(new { error = "PIN length must be 4 to 8." });
    if (g.IdleMinutes is < 1 or > 480) return Results.BadRequest(new { error = "Idle timeout must be 1 to 480 minutes." });
    cfg.SetGeneral(g);
    cfg.SetSmtp(new SmtpCfg { Host = q.Smtp.Host ?? "", Port = q.Smtp.Port, Security = q.Smtp.Security ?? "None", User = q.Smtp.User ?? "", FromAddr = q.Smtp.FromAddr ?? "", FromName = q.Smtp.FromName ?? "" }, q.Smtp.Password);
    cfg.SetNotifs(q.Notifs);
    db.Audit(GetMe(u)!.Name, "settings_update");
    return Results.Ok();
});
JsonObject SamplePacket() => JsonNode.Parse("""{"vendor":"Nucor Berkeley","ship":"08/22/26","carrier":"FTMG","d365":"PR-100482","rows":[{"po":"TX-0015373","heat":"1612252","cc":"161886","desc":"W12x30","len":"43' 0\"","wt":"7,740"},{"po":"TX-0015373","heat":"2612251","cc":"161887","desc":"W12x30","len":"43' 0\"","wt":"7,740"},{"po":"TX-0015478","heat":"1612390","cc":"161891","desc":"W12x26","len":"50' 0\"","wt":"7,800"}]}""")!.AsObject();

ad.MapPost("/test-email", async (ClaimsPrincipal u, HttpContext c, JsonObject body) =>
{
    var to = Str(body, "to"); if (to == "") return Results.BadRequest(new { error = "Enter an address." });
    var sent = new List<string>(); var failed = new List<string>(); var origin = Origin(c); var me = GetMe(u)!;
    foreach (var n in cfg.Notifs())
    {
        try
        {
            var (subject, text, html) = Compose(n.Event, n, SamplePacket(), "1929915", "review", "sample", me.Name, origin, false);
            await mail.SendNow(to, "[TEST] " + subject, text, html);
            sent.Add(n.Label);
        }
        catch (Exception ex) { failed.Add(n.Label + ": " + ex.Message); if (sent.Count == 0) break; }
    }
    db.Audit(me.Name, "test_emails", $"{to} sent={sent.Count} failed={failed.Count}");
    return failed.Count > 0 && sent.Count == 0 ? Results.BadRequest(new { error = failed[0] }) : Results.Ok(new { sent = sent.Count, failed });
});
ad.MapGet("/backups", () => backup.List());
ad.MapPost("/backups/run", (ClaimsPrincipal u) =>
{
    try { var f = backup.Run(); db.Audit(GetMe(u)!.Name, "backup", Path.GetFileName(f)); return Results.Ok(new { file = Path.GetFileName(f) }); }
    catch (Exception ex) { return Results.BadRequest(new { error = ex.Message }); }
});
ad.MapGet("/backups/{name}", (string name) => backup.Open(name) is { } fs ? Results.File(fs, "application/zip", Path.GetFileName(name)) : Results.NotFound());
ad.MapGet("/notif-defaults", () => SettingsStore.DefaultNotifs());
ad.MapPost("/preview-email", (HttpContext c, JsonObject body) =>
{
    var evt = Str(body, "event");
    var d = SamplePacket();
    var n = new NotifCfg { Event = evt, Subject = Str(body, "subject"), Body = Str(body, "body") };
    var (subject, _, html) = Compose(evt, n, d, "1929915", "review", "sample", GetMe(c.User)!.Name, Origin(c), true);
    return Results.Ok(new { subject, html });
});
void DeleteOne(string id)
{
    var f = Path.Combine(dataDir, "pdfs", Path.GetFileName(id) + ".pdf"); if (File.Exists(f)) File.Delete(f);
    var ff = Path.Combine(dataDir, "final", Path.GetFileName(id) + ".pdf"); if (File.Exists(ff)) File.Delete(ff);
    var pd = Path.Combine(dataDir, "photos", Path.GetFileName(id)); if (Directory.Exists(pd)) Directory.Delete(pd, true);
    db.Exec("DELETE FROM outbox WHERE packet_id=$0", id);
    db.Exec("DELETE FROM locks WHERE k LIKE $0", id + "|%");
    db.Exec("DELETE FROM packets WHERE id=$0", id);
}
int DeletePackets(string where)
{
    var ids = db.Query("SELECT id FROM packets WHERE " + where, r => r.GetString(0));
    foreach (var id in ids) DeleteOne(id);
    return ids.Count;
}
ad.MapPost("/clear-demo", (ClaimsPrincipal u) =>
{
    var packets = DeletePackets("json_extract(data,'$.demo')=1");
    var users = db.Exec("DELETE FROM users WHERE demo=1");
    db.Audit(GetMe(u)!.Name, "clear_demo", $"packets={packets} users={users}");
    return Results.Ok(new { packets, users });
});
ad.MapPost("/clear-packets", (ClaimsPrincipal u) =>
{
    var packets = DeletePackets("1=1");
    db.Audit(GetMe(u)!.Name, "clear_all_packets", $"packets={packets}");
    return Results.Ok(new { packets });
});
ad.MapPost("/seed-demo", (ClaimsPrincipal u) =>
{
    if (db.Query("SELECT 1 FROM packets", r => 1).Count > 0) return Results.BadRequest(new { error = "Packets already exist. Demo data only loads into an empty system." });
    var samples = Path.Combine(app.Environment.ContentRootPath, "samples");
    var demoDir = Directory.Exists(samples) ? samples : Path.GetFullPath(app.Configuration["DemoDir"] ?? @"..\..", app.Environment.ContentRootPath);
    long Ago(double h) => Now() - (long)(h * 3600000);
    long NewUser(string name, string ini, string role, string pin)
    {
        var ex = db.Query("SELECT id FROM users WHERE name=$0", r => r.GetInt64(0), name);
        if (ex.Count > 0) return ex[0];
        var (h, s) = Pin.Make(pin);
        return db.Insert("INSERT INTO users(name,initials,email,roles,pin_hash,pin_salt,active,created,demo) VALUES($0,$1,'',$2,$3,$4,1,$5,1)", name, ini, role, h, s, Now());
    }
    NewUser("Receiver One", "R1", "receiver", "1111"); NewUser("Receiver Two", "R2", "receiver", "2222");
    NewUser("Demo Coordinator", "DC", "coordinator", "3333"); var rev = NewUser("Demo Reviewer", "DR", "reviewer", "4444");
    void Add(string bol, string vendor, string ship, string carrier, string pdf, string stage, double hrs, object rows, object forms, object[] log, object[] approvals, object[] required, string d365 = "", string authBy = "", double authHrs = 0)
    {
        var id = Guid.NewGuid().ToString("N")[..12];
        var src = Path.Combine(demoDir, pdf); var has = File.Exists(src);
        if (has) File.Copy(src, Path.Combine(dataDir, "pdfs", id + ".pdf"), true);
        var d = JsonSerializer.SerializeToNode(new { vendor, ship, carrier, rows, forms, approvals, requiredReviewers = required, log, hasPdf = has, demo = true })!.AsObject();
        if (d365 != "") d["d365"] = d365;
        if (authBy != "") { d["authBy"] = authBy; d["authAt"] = Ago(authHrs); }
        db.Exec("INSERT INTO packets(id,bol,stage,created,updated,data) VALUES($0,$1,$2,$3,$4,$5)", id, bol, stage, Ago(hrs), Ago(hrs), d.ToJsonString());
    }
    object L(double h, string who, string what) => new { t = Ago(h), who, what };
    object Row(string po, string heat, string coil, string cc, string desc, string wt, string len = "") => new { po, heat, coil, cc, desc, len, wt };
    object F(string by, string ini, string date, params object[] items) => new { submitted = true, date, inspector = ini, by, items };
    object It(object row, object meas, int src)
    {
        var o = JsonSerializer.SerializeToNode(meas)!.AsObject(); var r = JsonSerializer.SerializeToNode(row)!.AsObject();
        o["src"] = src.ToString(); o["heat"] = r["heat"]?.DeepClone(); o["desc"] = r["desc"]?.DeepClone(); o["cc"] = r["cc"]?.DeepClone(); o["coil"] = r["coil"]?.DeepClone();
        return o;
    }

    Add("1487848", "Nucor Hickman (Arkansas)", "12/23/25", "Preston Richey Trucking", "B5 Completed Preliminary BOL-MTR Packet.pdf", "new", 1.5,
        new[] { Row("TX-0013183", "2157562", "2115023.1000", "156832", ".0940 x 14.0600 HRO", "13,406", "2833"), Row("TX-0013183", "2157562", "2115023.2000", "156833", ".0940 x 14.0600 HRO", "13,406", "2833"), Row("TX-0013183", "2157562", "2115023.3000", "156834", ".0940 x 14.0600 HRO", "13,406", "2833") },
        new { }, new[] { L(1.5, "Demo Coordinator", "Packet indexed, task created for receivers") }, Array.Empty<object>(), Array.Empty<object>());

    var berk = new[] { Row("TX-0015373", "1612252", "61123384", "161886", "W12x30", "7,740", "43' 0\""), Row("TX-0015373", "2612251", "61123486", "161887", "W12x30", "7,740", "43' 0\""), Row("TX-0015373", "2612253", "61123402", "161888", "W12x30", "7,740", "43' 0\""), Row("TX-0015373", "1612252", "61123386", "161889", "W12x30", "7,740", "43' 0\""), Row("TX-0015373", "1612252", "61123385", "161890", "W12x30", "7,740", "43' 0\""), Row("TX-0015478", "1612390", "61124736", "161891", "W12x26", "7,800", "50' 0\"") };
    Add("1929915", "Nucor Berkeley", "08/22/26", "FTMG", "Berkeley Multi PO, multi insp packet.pdf", "inspecting", 5, berk,
        new Dictionary<string, object>
        {
            ["TX-0015373|shape"] = F("Receiver One", "R1", "2026-08-24", It(berk[0], new { qty = "6", depth = "6 5/8", width = "12 3/8", thick = ".254", sweep = "84", visual = "ok", cert = "ok" }, 0), It(berk[1], new { qty = "6", depth = "6 5/8", width = "12 3/8", thick = ".254", sweep = "86", visual = "ok", cert = "ok" }, 1), It(berk[2], new { qty = "6", depth = "6 5/8", width = "12 3/8", thick = ".254", sweep = ".02", visual = "ok", cert = "ok" }, 2), It(berk[3], new { qty = "6", depth = "6 5/8", width = "12 3/8", thick = ".254", sweep = "86", visual = "ok", cert = "ok" }, 3), It(berk[4], new { qty = "6", depth = "6 5/8", width = "12 3/8", thick = ".254", sweep = "85", visual = "ok", cert = "ok" }, 4)),
            ["TX-0015478|shape"] = new { submitted = false, date = "2026-08-24", inspector = "R1", by = "Receiver One", items = new object[] { It(berk[5], new { qty = "6", depth = "6 3/8" }, 5) } }
        },
        new[] { L(5, "Demo Coordinator", "Packet indexed, task created for receivers"), L(3, "R1", "Submitted Beam/channel/angle inspection for TX-0015373") }, Array.Empty<object>(), Array.Empty<object>());

    var delta = new[] { Row("TX-0016400", "18720D", "", "161792", "Tubing 12 x 8 x 3/8 x 28'", "1,341", "28' 0\""), Row("TX-0016400", "19163D", "", "161793", "Tubing 6 x 6 x 3/8 x 24'", "660", "24' 0\""), Row("TX-0016400", "627667", "", "161794", "Wide flange 18 x 40# x 50'", "4,000", "50' 0\""), Row("TX-0016400", "b270501", "", "161795", "Channel 8 x 18.75# x 30'", "563", "30' 0\"") };
    Add("327874", "Delta Steel Inc", "08/18/26", "Classic Transport LLC", "Delta multi Insp sheet packet.pdf", "review", 30, delta,
        new Dictionary<string, object>
        {
            ["TX-0016400|tube"] = new { submitted = true, date = "2026-08-18", inspector = "R1", by = "Receiver One", items = new object[] { It(delta[0], new { qty = "1", wall = ".351", od = "8 x 12" }, 0), It(delta[1], new { qty = "1", wall = ".354", od = "6 x 6" }, 1) } },
            ["TX-0016400|shape"] = new { submitted = true, date = "2026-08-18", inspector = "R1", by = "Receiver One", items = new object[] { It(delta[2], new { qty = "2", depth = "18", width = "6", thick = ".327", visual = "ok", cert = "ok" }, 2), It(delta[3], new { qty = "1", depth = "8 5/8", width = "2 1/2", thick = ".277", visual = "ok", cert = "ok" }, 3) } }
        },
        new[] { L(30, "Demo Coordinator", "Packet indexed, task created for receivers"), L(27, "R1", "Submitted Rod/pipe/tube inspection for TX-0016400"), L(26, "R1", "Submitted Beam/channel/angle inspection for TX-0016400"), L(26, "Receiver One", "Inspection complete") },
        Array.Empty<object>(), new object[] { new { id = rev.ToString(), name = "Demo Reviewer" } });


    // ---- built-in packets (no scanned PDF): every inspection sheet type, filled in by the app ----
    var rv = new object[] { new { id = rev.ToString(), name = "Demo Reviewer" } };
    object Ap(double h) => new { id = rev.ToString(), n = "Demo Reviewer", t = Ago(h) };

    // Filed: coil + flat sheet + flat bar across two POs
    var steel = new List<object>();
    for (int i = 0; i < 3; i++) steel.Add(Row("TX-0017001", i < 2 ? "H90112" : "H90113", "2209001." + (i + 1) + "000", "16210" + (i + 1), ".0940 x 14.0600 HRO", "13,406", "2833"));
    for (int i = 0; i < 4; i++) steel.Add(Row("TX-0017002", "S4400" + (i / 2 + 1), "", "16211" + i, "16 GA G60 x 48 x 120 sheet", "1,150", "120\""));
    for (int i = 0; i < 3; i++) steel.Add(Row("TX-0017002", "B3310" + (i + 1), "", "16212" + i, "3/8 x 6 flat bar x 20'", "382", "20' 0\""));
    object Coil(int i) => new { id = "20", od = i == 2 ? "61 3/4" : "62", gauge = ".094", width = "14.0625", color = "Black", comments = i == 1 ? "Light oil film, wiped" : "" };
    object Sheet() => new { qty = "25", len = "120", width = "48", gauge = "16", comments = "" };
    object Bar(int i) => new { qty = "20", width = "6", thick = ".375", sweep = i == 2 ? ".3125" : ".25", surface = "ok", cert = "ok", comments = "" };
    Add("7700123", "Demo Steel Supply", "09/28/26", "Demo Freight Lines", "", "filed", 80, steel,
        new Dictionary<string, object>
        {
            ["TX-0017001|coil"] = F("Receiver One", "R1", "2026-09-29", It(steel[0], Coil(0), 0), It(steel[1], Coil(1), 1), It(steel[2], Coil(2), 2)),
            ["TX-0017002|sheet"] = F("Receiver Two", "R2", "2026-09-29", It(steel[3], Sheet(), 0), It(steel[4], Sheet(), 1), It(steel[5], Sheet(), 2), It(steel[6], Sheet(), 3)),
            ["TX-0017002|bar"] = F("Receiver Two", "R2", "2026-09-29", It(steel[7], Bar(0), 4), It(steel[8], Bar(1), 5), It(steel[9], Bar(2), 6)),
        },
        new[] { L(80, "Demo Coordinator", "Packet indexed, task created for receivers"), L(76, "R1", "Submitted Coil inspection for TX-0017001"), L(75, "R2", "Submitted Flat sheet inspection for TX-0017002"), L(75, "R2", "Submitted Flat bar inspection for TX-0017002"), L(74, "Receiver Two", "Inspection complete"), L(70, "Demo Reviewer", "Approved"), L(70, "System", "Review complete"), L(66, "Demo Coordinator", "Received in D365 (PR-100311)"), L(64, "Demo Coordinator", "Authorized, filed") },
        new[] { Ap(70) }, rv, "PR-100311", "Demo Coordinator", 64);

    // Ready to authorize: tube (one reject) + beam
    var pipe = new List<object>();
    for (int i = 0; i < 3; i++) pipe.Add(Row("TX-0017101", "T700" + (i + 1), "", "16220" + i, "Tubing 6 x 6 x 3/8 x 24'", "660", "24' 0\""));
    for (int i = 0; i < 2; i++) pipe.Add(Row("TX-0017101", "W551" + (i + 1), "", "16221" + i, "Beam W10x22 x 40'", "880", "40' 0\""));
    object Tube(int i) => new { qty = "1", wall = ".351", od = "6 x 6", surface = i == 1 ? "bad" : "ok", sweep = ".125", cert = "ok", comments = i == 1 ? "Scratch near end, vendor notified" : "" };
    object Beam(int i) => new { qty = "1", depth = "10", width = "5 3/4", visual = "ok", thick = ".240", sweep = ".375", cert = "ok", comments = "" };
    Add("7700456", "Demo Pipe and Tube", "10/01/26", "Demo Freight Lines", "", "authorize", 20, pipe,
        new Dictionary<string, object>
        {
            ["TX-0017101|tube"] = F("Receiver One", "R1", "2026-10-02", It(pipe[0], Tube(0), 0), It(pipe[1], Tube(1), 1), It(pipe[2], Tube(2), 2)),
            ["TX-0017101|shape"] = F("Receiver One", "R1", "2026-10-02", It(pipe[3], Beam(0), 3), It(pipe[4], Beam(1), 4)),
        },
        new[] { L(20, "Demo Coordinator", "Packet indexed, task created for receivers"), L(17, "R1", "Submitted Pipe, rod and tube inspection for TX-0017101"), L(17, "R1", "Submitted Beam/channel/angle inspection for TX-0017101"), L(16, "Receiver One", "Inspection complete"), L(12, "Demo Reviewer", "Approved"), L(12, "System", "Review complete"), L(8, "Demo Coordinator", "Received in D365 (PR-100500)") },
        new[] { Ap(12) }, rv, "PR-100500");

    db.Audit(GetMe(u)!.Name, "seed_demo");
    return Results.Ok(new { users = "Receiver One 1111, Receiver Two 2222, Demo Coordinator 3333, Demo Reviewer 4444", packets = 5 });
});
ad.MapGet("/outbox", () => db.Query("SELECT id,to_addr,subject,event,status,attempts,error,created,sent_at FROM outbox ORDER BY id DESC LIMIT 100",
    r => new { id = r.GetInt64(0), to = r.GetString(1), subject = r.GetString(2), evt = r.IsDBNull(3) ? "" : r.GetString(3), status = r.GetString(4), attempts = r.GetInt32(5), error = r.IsDBNull(6) ? "" : r.GetString(6), created = r.GetInt64(7), sentAt = r.IsDBNull(8) ? 0 : r.GetInt64(8) }));
ad.MapPost("/outbox/{id:long}/retry", (long id) => { db.Exec("UPDATE outbox SET status='pending',attempts=0,next_try=0 WHERE id=$0", id); return Results.Ok(); });

Features.Map(fctx);
app.MapFallbackToFile("index.html");
app.Run();

/* ---------------- helpers ---------------- */
Me? GetMe(ClaimsPrincipal u)
{
    if (u.Identity?.IsAuthenticated != true || u.Identity.AuthenticationType != CookieAuthenticationDefaults.AuthenticationScheme) return null;   // ignore a raw Windows identity from IIS
    return new Me(u.FindFirstValue("kind") ?? "pin", u.FindFirstValue(ClaimTypes.NameIdentifier) ?? "", u.FindFirstValue(ClaimTypes.Name) ?? "", u.FindFirstValue("initials") ?? "",
        u.FindAll(ClaimTypes.Role).Select(c => c.Value).ToArray(), u.FindFirstValue("mustchange") == "1");
}
object MeJson(Me m) => new { m.Kind, m.Id, m.Name, m.Initials, m.Roles, m.MustChange, idleMinutes = cfg.General().IdleMinutes };
ClaimsPrincipal Principal(Me m)
{
    var cl = new List<Claim> { new(ClaimTypes.NameIdentifier, m.Id), new(ClaimTypes.Name, m.Name), new("initials", m.Initials), new("kind", m.Kind) };
    if (m.MustChange) cl.Add(new Claim("mustchange", "1"));
    cl.AddRange(m.Roles.Select(r => new Claim(ClaimTypes.Role, r)));
    return new ClaimsPrincipal(new ClaimsIdentity(cl, CookieAuthenticationDefaults.AuthenticationScheme));
}
string Initials(string? name, string fallback)
{
    var n = string.IsNullOrWhiteSpace(name) ? fallback : name;
    var parts = n.Split(new[] { ' ', '.', '\\' }, StringSplitOptions.RemoveEmptyEntries);
    return string.Concat(parts.Take(2).Select(p => char.ToUpperInvariant(p[0])));
}
string? ValidateUser(UserReq q, bool isNew)
{
    if (string.IsNullOrWhiteSpace(q.Name)) return "Name is required.";
    if (q.Roles == null || q.Roles.Length == 0 || q.Roles.Any(r => !AllRoles.Contains(r))) return "Pick at least one role.";
    var len = cfg.General().PinLength;
    if (!string.IsNullOrEmpty(q.Pin) && (q.Pin.Length != len || !q.Pin.All(char.IsDigit))) return $"PIN must be {len} digits.";
    if (!string.IsNullOrWhiteSpace(q.Email) && !q.Email.Contains('@')) return "Email looks wrong.";
    return null;
}
string Str(JsonNode? n, string k) => n?[k] is JsonValue v && v.TryGetValue<string>(out var s) ? s : (n?[k]?.ToString() ?? "");
string TypeName(string t) => t switch { "coil" => "Coil", "sheet" => "Flat sheet", "bar" => "Flat bar", "shape" => "Beam/channel/angle", "tube" => "Rod/pipe/tube", _ => t };
IEnumerable<string> Pos(JsonObject d) => d["rows"]!.AsArray().Select(r => Str(r, "po")).Where(x => x != "").Distinct();
void AddLog(JsonObject d, string who, string what)
{
    if (d["log"] is not JsonArray a) d["log"] = a = new JsonArray();
    a.Add(new JsonObject { ["t"] = Now(), ["who"] = who, ["what"] = what });
}
string Origin(HttpContext c) { var b = cfg.General().BaseUrl.Trim().TrimEnd('/'); return b != "" ? b : $"{c.Request.Scheme}://{c.Request.Host}"; }
JsonObject PacketJson(string id, string bol, string stage, long created, long updated, string data)
{
    var o = JsonNode.Parse(data)!.AsObject(); o["id"] = id; o["bol"] = bol; o["stage"] = stage; o["created"] = created; o["updated"] = updated; return o;
}
PacketRec? LoadPacket(string id) =>
    db.One("SELECT id,bol,stage,created,data FROM packets WHERE id=$0", r => new PacketRec(db, r.GetString(0), r.GetString(1), r.GetString(2), r.GetInt64(3), JsonNode.Parse(r.GetString(4))!.AsObject()), id);

(string subject, string text, string html) Compose(string evt, NotifCfg n, JsonObject d, string bol, string stage, string id, string actor, string origin, bool preview, Dictionary<string, string>? extra = null)
{
    var vars = new Dictionary<string, string>
    {
        ["bol"] = bol, ["vendor"] = Str(d, "vendor"), ["pos"] = string.Join(", ", Pos(d)), ["items"] = d["rows"]!.AsArray().Count.ToString(),
        ["actor"] = actor, ["d365"] = Str(d, "d365"), ["stage"] = stage, ["link"] = $"{origin}/#/p/{id}"
    };
    if (extra != null) foreach (var kv in extra) vars[kv.Key] = kv.Value;
    if (!vars.ContainsKey("rejects")) vars["rejects"] = "CC 161886 (Tube, PO TX-0015373): Surface - scratch near end";
    var subject = Mailer.Render(n.Subject, vars); var intro = Mailer.Render(n.Body, vars);
    var facts = new List<(string, string)> { ("BOL #", bol), ("Vendor", Str(d, "vendor")), ("Ship date", Str(d, "ship")), ("Carrier", Str(d, "carrier")), ("PO #", string.Join(", ", Pos(d))) };
    if (evt is "received" or "filed") facts.Add(("D365 receipt", Str(d, "d365")));
    if (evt == "filed") facts.Add(("Authorized by", actor));
    facts.RemoveAll(f => string.IsNullOrWhiteSpace(f.Item2));
    var items = d["rows"]!.AsArray().Select(r => new MailHtml.Item(Str(r, "po"), Str(r, "heat"), Str(r, "cc"), Str(r, "desc"), Str(r, "len"), Str(r, "wt"))).ToList();
    var st = MailHtml.StyleFor(evt); var site = cfg.General().SiteName; var link = vars["link"];
    var html = MailHtml.Html(site, st, intro, facts, items, link, st.Button, intro.Split('\n')[0], preview ? mail.LogoDataUri() : "cid:logo");
    return (subject, MailHtml.Text(site, st, intro, facts, items, link), html);
}

void Notify(string evt, PacketRec p, string actor, string origin, Dictionary<string, string>? extra = null)
{
    var n = cfg.Notifs().FirstOrDefault(x => x.Event == evt); if (n == null || !n.Enabled) return;
    var to = new List<string>();
    foreach (var role in n.Roles)
        to.AddRange(db.Query("SELECT email FROM users WHERE active=1 AND email<>'' AND (',' || roles || ',') LIKE $0", r => r.GetString(0), "%," + role + ",%"));
    foreach (var uid in n.UserIds) to.AddRange(db.Query("SELECT email FROM users WHERE active=1 AND email<>'' AND id=$0", r => r.GetString(0), uid));
    to.AddRange(n.Extra.Split(new[] { ',', ';', ' ', '\n' }, StringSplitOptions.RemoveEmptyEntries));
    var (subject, text, html) = Compose(evt, n, p.Data, p.Bol, p.Stage, p.Id, actor, origin, false, extra);
    mail.Enqueue(evt, p.Id, to, subject, text, html);
}

void NotifyUsers(string evt, PacketRec p, string actor, string origin, IEnumerable<string> userIds)
{
    var n = cfg.Notifs().FirstOrDefault(x => x.Event == evt); if (n == null || !n.Enabled) return;
    var to = new List<string>();
    foreach (var uid in userIds) to.AddRange(db.Query("SELECT email FROM users WHERE active=1 AND email<>'' AND id=$0", r => r.GetString(0), long.Parse(uid)));
    var (subject, text, html) = Compose(evt, n, p.Data, p.Bol, p.Stage, p.Id, actor, origin, false);
    mail.Enqueue(evt, p.Id, to, subject, text, html);
}

record Me(string Kind, string Id, string Name, string Initials, string[] Roles, bool MustChange = false)
{
    public bool Admin => Roles.Contains("admin");
    public bool Has(params string[] r) => Admin || r.Any(Roles.Contains);
}
record PinReq(long UserId, string? Pin);
record UserReq(string? Name, string? Initials, string? Email, string[]? Roles, string? Pin, bool? Active, bool? Unlock, bool? MustChange);
record ChangePinReq(string? Current, string? New);
record AdminReq(string? Account, string? Name, string? Email);
record SmtpReq(string? Host, int Port, string? Security, string? User, string? FromAddr, string? FromName, string? Password);
record SettingsReq(GeneralCfg General, SmtpReq Smtp, List<NotifCfg> Notifs);

class PacketRec(Db db, string id, string bol, string stage, long created, JsonObject data)
{
    public string Id = id, Bol = bol; public string Stage = stage; public long Created = created; public JsonObject Data = data;
    public void Save() => db.Exec("UPDATE packets SET stage=$1,updated=$2,data=$3 WHERE id=$0", Id, Stage, DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(), Data.ToJsonString());
    public JsonObject ToJson()
    {
        var o = JsonNode.Parse(Data.ToJsonString())!.AsObject();
        o["id"] = Id; o["bol"] = Bol; o["stage"] = Stage; o["created"] = Created;
        o["locks"] = new JsonArray(db.Query("SELECT k,name FROM locks WHERE k LIKE $0 AND expires>$1", r => (JsonNode)new JsonObject { ["k"] = r.GetString(0), ["name"] = r.GetString(1) }, Id + "|%", DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()).ToArray());
        return o;
    }
}

