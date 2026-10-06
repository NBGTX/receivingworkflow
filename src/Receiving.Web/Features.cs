// Secondary API endpoints (reports, status, PO list, DocuWare mapping, photos, audit search)
// plus AlertService, the background check that emails admins when something needs attention.
using System.Security.Claims;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace Receiving.Web;

/// <summary>What the feature endpoints need from Program.cs, passed in because the helpers there are local functions.</summary>
internal sealed record FeatureCtx(WebApplication App, Db Db, SettingsStore Cfg, Mailer Mail, string DataDir,
    Func<ClaimsPrincipal, Me?> GetMe, Func<HttpContext, string> Origin, Func<string, PacketRec?> Load);

/// <summary>One DocuWare index column: its header, where its value comes from, and a constant (when Source is "const").</summary>
public record DwCol(string Header, string Source, string Const);

/// <summary>Reports, status, PO list, DocuWare index mapping, folder drop, photos, audit search.</summary>
internal static class Features
{
    static long Now() => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
    static string S(JsonNode? n, string k) => n?[k] is JsonValue v && v.TryGetValue<string>(out var s) ? s : (n?[k]?.ToString() ?? "");
    static bool IsDraft(JsonNode? n) => n?["ready"] is JsonValue v && v.TryGetValue<bool>(out var b) && !b;
    static readonly string[] StageOrder = ["new", "inspecting", "review", "receive", "authorize", "filed"];

    public static List<DwCol> DefaultMap() =>
    [
        new("BOL #", "bol", ""), new("Vendor", "vendor", ""), new("Ship date", "ship", ""), new("PO #", "po", ""), new("Heat #", "heat", ""),
        new("Mill coil / bundle #", "coil", ""), new("CC # (NBS#)", "cc", ""), new("Description", "desc", ""), new("Length", "len", ""),
        new("Weight", "wt", ""), new("D365 receipt #", "d365", ""), new("Authorized by", "authBy", ""),
    ];

    static string Source(DwCol c, string bol, JsonObject d, JsonNode? row)
    {
        string V(string k) => S(row, k);
        return c.Source switch
        {
            "bol" => bol, "vendor" => S(d, "vendor"), "ship" => S(d, "ship"), "carrier" => S(d, "carrier"), "d365" => S(d, "d365"), "authBy" => S(d, "authBy"),
            "authAt" => d["authAt"] is JsonNode a && long.TryParse(a.ToString(), out var t) && t > 0 ? DateTimeOffset.FromUnixTimeMilliseconds(t).ToLocalTime().ToString("MM/dd/yyyy") : "",
            "po" => V("po"), "heat" => V("heat"), "coil" => V("coil"), "cc" => V("cc"), "desc" => V("desc"), "len" => V("len"), "wt" => V("wt"),
            "const" => c.Const, _ => ""
        };
    }

    /// <summary>The DocuWare index sheet for a packet: one CSV row per item, columns as mapped in Settings.</summary>
    public static string DocuwareCsv(SettingsStore cfg, string bol, JsonObject d)
    {
        var map = cfg.GetJson("docuware", DefaultMap());
        string Q(string? s) => "\"" + (s ?? "").Replace("\"", "\"\"") + "\"";
        var sb = new StringBuilder();
        sb.AppendLine(string.Join(",", map.Select(c => Q(c.Header))));
        foreach (var r in d["rows"]!.AsArray())
            sb.AppendLine(string.Join(",", map.Select(c => Q(Source(c, bol, d, r)))));
        return sb.ToString();
    }

    /// <summary>Copies a final packet (and its CSV, if enabled) to the configured folder. Returns "" when the drop is off, "ERR:..." on failure, else the PDF path.</summary>
    public static string DropFinal(FeatureCtx x, PacketRec p, byte[] pdf)
    {
        var g = x.Cfg.General();
        if (!g.DropEnabled || string.IsNullOrWhiteSpace(g.DropFolder)) return "";
        try
        {
            var folder = g.DropFolder.Trim(); Directory.CreateDirectory(folder);
            string Clean(string s) => string.Concat(s.Select(ch => Path.GetInvalidFileNameChars().Contains(ch) ? '_' : ch));
            var name = Clean((string.IsNullOrWhiteSpace(g.DropName) ? "BOL {bol} final packet" : g.DropName)
                .Replace("{bol}", p.Bol).Replace("{vendor}", S(p.Data, "vendor")).Replace("{date}", DateTime.Now.ToString("yyyy-MM-dd")));
            var path = Path.Combine(folder, name + ".pdf"); File.WriteAllBytes(path, pdf);
            if (g.DropCsv) File.WriteAllText(Path.Combine(folder, name + ".csv"), DocuwareCsv(x.Cfg, p.Bol, p.Data), new UTF8Encoding(true));
            x.Db.Audit("system", "drop_ok", p.Bol + " -> " + path);
            return path;
        }
        catch (Exception ex) { x.Db.Audit("system", "drop_failed", p.Bol + ": " + ex.Message); return "ERR:" + ex.Message; }
    }

    // ---------------------------------------------------------------- csv parsing
    static List<List<string>> ParseCsv(string text)
    {
        var rows = new List<List<string>>(); var row = new List<string>(); var cur = new StringBuilder(); bool q = false;
        for (int i = 0; i < text.Length; i++)
        {
            var c = text[i];
            if (q) { if (c == '"') { if (i + 1 < text.Length && text[i + 1] == '"') { cur.Append('"'); i++; } else q = false; } else cur.Append(c); }
            else if (c == '"') q = true;
            else if (c == ',') { row.Add(cur.ToString()); cur.Clear(); }
            else if (c == '\n' || c == '\r') { if (c == '\r' && i + 1 < text.Length && text[i + 1] == '\n') i++; row.Add(cur.ToString()); cur.Clear(); if (row.Any(v => v.Trim() != "")) rows.Add(row); row = new List<string>(); }
            else cur.Append(c);
        }
        row.Add(cur.ToString()); if (row.Any(v => v.Trim() != "")) rows.Add(row);
        return rows;
    }

    static int Col(List<string> header, params string[] names)
    {
        var norm = header.Select(h => new string(h.ToLowerInvariant().Where(char.IsLetterOrDigit).ToArray())).ToList();
        foreach (var n in names) { var i = norm.IndexOf(n); if (i >= 0) return i; }
        return -1;
    }

    // ---------------------------------------------------------------- map everything
    /// <summary>Registers all the endpoints in this file.</summary>
    public static void Map(FeatureCtx x)
    {
        var app = x.App; var db = x.Db; var cfg = x.Cfg; var dataDir = x.DataDir;
        db.Exec("CREATE TABLE IF NOT EXISTS po_lines(po TEXT NOT NULL, vendor TEXT, item TEXT, descr TEXT, qty REAL, uom TEXT)");
        db.Exec("CREATE INDEX IF NOT EXISTS ix_po_lines_po ON po_lines(po)");
        var api = app.MapGroup("/api");
        var ad = api.MapGroup("/admin").RequireAuthorization("Admin");

        IEnumerable<(string id, string bol, string stage, long created, long updated, JsonObject d)> All() =>
            db.Query("SELECT id,bol,stage,created,updated,data FROM packets", r => (id: r.GetString(0), bol: r.GetString(1), stage: r.GetString(2), created: r.GetInt64(3), updated: r.GetInt64(4), d: JsonNode.Parse(r.GetString(5))!.AsObject()));

        /* ---------------- duplicate BOL check ---------------- */
        api.MapGet("/packets/exists", (string bol, ClaimsPrincipal u) =>
            x.GetMe(u) == null ? Results.Json(new { error = "Not signed in" }, statusCode: 440) : Results.Ok(new { exists = db.Query("SELECT 1 FROM packets WHERE bol=$0", r => 1, bol.Trim()).Count > 0 })).RequireAuthorization();

        /* ---------------- audit search ---------------- */
        ad.MapGet("/audit", (string? q, string? actor, string? action) =>
        {
            var sql = new StringBuilder("SELECT ts,actor,action,detail FROM audit WHERE 1=1"); var ps = new List<object?>();
            if (!string.IsNullOrWhiteSpace(q)) { sql.Append($" AND (detail LIKE ${ps.Count} OR actor LIKE ${ps.Count} OR action LIKE ${ps.Count})"); ps.Add("%" + q.Trim() + "%"); }
            if (!string.IsNullOrWhiteSpace(actor)) { sql.Append($" AND actor LIKE ${ps.Count}"); ps.Add("%" + actor.Trim() + "%"); }
            if (!string.IsNullOrWhiteSpace(action)) { sql.Append($" AND action = ${ps.Count}"); ps.Add(action.Trim()); }
            sql.Append(" ORDER BY id DESC LIMIT 300");
            return new
            {
                actions = db.Query("SELECT DISTINCT action FROM audit ORDER BY action", r => r.GetString(0)),
                rows = db.Query(sql.ToString(), r => new { ts = r.GetInt64(0), actor = r.IsDBNull(1) ? "" : r.GetString(1), action = r.GetString(2), detail = r.IsDBNull(3) ? "" : r.GetString(3) }, ps.ToArray())
            };
        });

        /* ---------------- status ---------------- */
        ad.MapGet("/status", () =>
        {
            var proc = System.Diagnostics.Process.GetCurrentProcess();
            long Cnt(string sql) => db.Query(sql, r => r.GetInt64(0)).FirstOrDefault();
            var dbFile = Path.Combine(dataDir, "receiving.db");
            double? free = null, total = null;
            try { var di = new DriveInfo(Path.GetPathRoot(Path.GetFullPath(dataDir))!); free = di.AvailableFreeSpace / 1073741824.0; total = di.TotalSize / 1073741824.0; } catch { }
            var last = db.One("SELECT value FROM settings WHERE key='backup_last'", r => r.GetString(0));
            var dropFails = Cnt("SELECT COUNT(*) FROM audit WHERE action='drop_failed' AND ts>" + (Now() - 86400000));
            return new
            {
                version = typeof(Program).Assembly.GetName().Version?.ToString() ?? "",
                uptimeHours = Math.Round((DateTime.Now - proc.StartTime).TotalHours, 1),
                dataDir, dbMB = File.Exists(dbFile) ? Math.Round(new FileInfo(dbFile).Length / 1048576.0, 1) : 0,
                diskFreeGB = free is null ? (double?)null : Math.Round(free.Value, 1), diskTotalGB = total is null ? (double?)null : Math.Round(total.Value, 1),
                packets = db.Query("SELECT stage,COUNT(*) FROM packets GROUP BY stage", r => new { stage = r.GetString(0), n = r.GetInt64(1) }),
                backup = new { enabled = cfg.General().BackupEnabled, last, time = cfg.General().BackupTime },
                mail = new { pending = Cnt("SELECT COUNT(*) FROM outbox WHERE status='pending'"), failed = Cnt("SELECT COUNT(*) FROM outbox WHERE status='failed'"), sentToday = Cnt("SELECT COUNT(*) FROM outbox WHERE status='sent' AND sent_at>" + (Now() - 86400000)), smtpSet = !string.IsNullOrWhiteSpace(cfg.Smtp().Host) },
                drop = new { enabled = cfg.General().DropEnabled, folder = cfg.General().DropFolder, failures24h = dropFails },
                users = Cnt("SELECT COUNT(*) FROM users WHERE active=1"), poLines = Cnt("SELECT COUNT(*) FROM po_lines"),
            };
        });

        /* ---------------- reports ---------------- */
        var rep = api.MapGroup("/reports").RequireAuthorization();
        rep.MapGet("/summary", (ClaimsPrincipal u) =>
        {
            if (x.GetMe(u) is not { } me || !me.Has("coordinator", "reviewer")) return Results.Forbid();
            var now = Now(); var list = All().Where(p => !IsDraft(p.d)).ToList();
            long? Find(JsonObject d, params string[] prefixes)
            {
                if (d["log"] is not JsonArray log) return null;
                foreach (var e in log) foreach (var pre in prefixes) if (S(e, "what").StartsWith(pre)) return long.Parse(e!["t"]!.ToString());
                return null;
            }
            var spans = new Dictionary<string, List<double>> { ["Inspection"] = new(), ["Review"] = new(), ["Receive in D365"] = new(), ["Authorize"] = new(), ["Start to filed"] = new() };
            foreach (var p in list)
            {
                var t0 = p.created; var ti = Find(p.d, "Inspection complete"); var tr = Find(p.d, "Review complete", "Review skipped"); var tv = Find(p.d, "Received in D365"); var tf = Find(p.d, "Authorized, filed");
                void Add(string k, long? a, long? b) { if (a != null && b != null && b >= a) spans[k].Add((b.Value - a.Value) / 3600000.0); }
                Add("Inspection", t0, ti); Add("Review", ti, tr); Add("Receive in D365", tr, tv); Add("Authorize", tv, tf); Add("Start to filed", t0, tf);
            }
            var stuck = list.Where(p => p.stage != "filed").Select(p =>
            {
                var last = p.d["log"] is JsonArray lg && lg.Count > 0 ? long.Parse(lg[^1]!["t"]!.ToString()) : p.created;
                return new { bol = p.bol, id = p.id, stage = p.stage, vendor = S(p.d, "vendor"), hours = Math.Round((now - last) / 3600000.0, 1) };
            }).Where(p => p.hours >= 24).OrderByDescending(p => p.hours).Take(20).ToList();
            var byVendor = new Dictionary<string, (int items, int rej)>(); var rejects = new List<object>(); var reasons = new Dictionary<string, int>();
            foreach (var p in list.OrderByDescending(p => p.updated))
            {
                var v = S(p.d, "vendor"); if (v == "") v = "(none)";
                if (p.d["forms"] is not JsonObject forms) continue;
                foreach (var kv in forms)
                {
                    if (kv.Value is not JsonObject f || f["submitted"]?.GetValue<bool>() != true || f["items"] is not JsonArray items) continue;
                    foreach (var it in items.Select(i => i!.AsObject()))
                    {
                        if (it["skip"]?.ToString() is "True" or "true") continue;
                        var bad = it.Where(a => a.Value?.ToString() == "bad").Select(a => a.Key).ToList();
                        var cur = byVendor.GetValueOrDefault(v); byVendor[v] = (cur.items + 1, cur.rej + (bad.Count > 0 ? 1 : 0));
                        foreach (var fld in bad) { var why = S(it, fld + "_why"); if (why == "") why = "(no reason given)"; reasons[why] = reasons.GetValueOrDefault(why) + 1; }
                        if (bad.Count > 0 && rejects.Count < 15) rejects.Add(new { bol = p.bol, id = p.id, vendor = v, po = kv.Key.Split('|')[0], sheet = kv.Key.Split('|')[1], cc = S(it, "cc"), fields = bad, date = S(f, "date") });
                    }
                }
            }
            var weeks = new List<object>(); var monday = DateTime.Today.AddDays(-(((int)DateTime.Today.DayOfWeek + 6) % 7));
            for (int i = 7; i >= 0; i--)
            {
                var a = monday.AddDays(-7 * i); var b = a.AddDays(7);
                var n = list.Count(p => { var c = DateTimeOffset.FromUnixTimeMilliseconds(p.created).ToLocalTime().DateTime; return c >= a && c < b; });
                weeks.Add(new { label = a.ToString("MMM d"), n });
            }
            return Results.Ok(new
            {
                byStage = StageOrder.Select(s => new { stage = s, n = list.Count(p => p.stage == s) }),
                averages = spans.Select(kv => new { step = kv.Key, hours = kv.Value.Count == 0 ? (double?)null : Math.Round(kv.Value.Average(), 1), samples = kv.Value.Count }),
                stuck, weeks,
                vendors = byVendor.Select(kv => new { vendor = kv.Key, items = kv.Value.items, rejected = kv.Value.rej }).OrderByDescending(v => v.rejected).ThenByDescending(v => v.items).Take(15),
                rejects, reasons = reasons.OrderByDescending(r => r.Value).Select(r => new { reason = r.Key, n = r.Value }), total = list.Count
            });
        });

        rep.MapGet("/export.csv", (ClaimsPrincipal u, string? from, string? to, string? vendor, string? stage) =>
        {
            if (x.GetMe(u) is not { } me || !me.Has("coordinator", "reviewer")) return Results.Forbid();
            DateTime? f = DateTime.TryParse(from, out var a) ? a : null, t = DateTime.TryParse(to, out var b) ? b.AddDays(1) : null;
            string Q(string? s) => "\"" + (s ?? "").Replace("\"", "\"\"") + "\"";
            var keys = new[] { "qty", "len", "width", "thick", "depth", "id", "od", "gauge", "color", "wall", "sweep", "visual", "surface", "cert" };
            var sb = new StringBuilder();
            sb.AppendLine(string.Join(",", new[] { "BOL #", "Vendor", "Ship date", "Stage", "PO #", "Sheet", "Inspector", "Inspection date", "Heat #", "CC # (NBS#)", "Coil #", "Description", "Rejected", "Rejected fields" }.Concat(keys.Select(k => k)).Select(Q)));
            foreach (var p in All().Where(p => !IsDraft(p.d)).OrderByDescending(p => p.created))
            {
                var c = DateTimeOffset.FromUnixTimeMilliseconds(p.created).ToLocalTime().DateTime;
                if ((f != null && c < f) || (t != null && c >= t)) continue;
                if (!string.IsNullOrWhiteSpace(vendor) && !S(p.d, "vendor").Contains(vendor, StringComparison.OrdinalIgnoreCase)) continue;
                if (!string.IsNullOrWhiteSpace(stage) && p.stage != stage) continue;
                if (p.d["forms"] is not JsonObject forms) continue;
                foreach (var kv in forms)
                {
                    if (kv.Value is not JsonObject fo || fo["submitted"]?.GetValue<bool>() != true || fo["items"] is not JsonArray items) continue;
                    var parts = kv.Key.Split('|');
                    foreach (var it in items.Select(i => i!.AsObject()))
                    {
                        if (it["skip"]?.ToString() is "True" or "true") continue;
                        var bad = it.Where(z => z.Value?.ToString() == "bad").Select(z => z.Key).ToList();
                        var cells = new List<string> { p.bol, S(p.d, "vendor"), S(p.d, "ship"), p.stage, parts[0], parts[1], S(fo, "inspector"), S(fo, "date"), S(it, "heat"), S(it, "cc"), S(it, "coil"), S(it, "desc"), bad.Count > 0 ? "Y" : "N", string.Join(" ", bad) };
                        cells.AddRange(keys.Select(k => S(it, k)));
                        sb.AppendLine(string.Join(",", cells.Select(Q)));
                    }
                }
            }
            return Results.File(Encoding.UTF8.GetPreamble().Concat(Encoding.UTF8.GetBytes(sb.ToString())).ToArray(), "text/csv", $"Inspections {DateTime.Now:yyyy-MM-dd}.csv");
        });

        /* ---------------- PO list ---------------- */
        ad.MapPost("/po-import", (JsonObject body) =>
        {
            var rows = ParseCsv(S(body, "csv")); if (rows.Count < 2) return Results.BadRequest(new { error = "The file has no data rows." });
            var h = rows[0]; var cPo = Col(h, "po", "purchid", "ponumber", "ponum", "purchaseorder", "pono", "purchaseordernumber");
            if (cPo < 0) return Results.BadRequest(new { error = "No PO column found. Name the column PO, PurchId or PO Number." });
            int cVen = Col(h, "vendor", "vendorname", "vendoraccount", "vendid"), cItem = Col(h, "item", "itemnumber", "itemid", "itemno"),
                cDesc = Col(h, "description", "descr", "itemname", "name", "producttext"), cQty = Col(h, "qty", "quantity", "ordered", "orderqty", "purchqty", "orderedqty"), cUom = Col(h, "uom", "unit", "purchunit");
            string G(List<string> r, int i) => i >= 0 && i < r.Count ? r[i].Trim() : "";
            var data = rows.Skip(1).Where(r => G(r, cPo) != "").ToList();
            db.Exec("DELETE FROM po_lines");
            for (int i = 0; i < data.Count; i += 150)
            {
                var chunk = data.Skip(i).Take(150).ToList(); var ps = new List<object?>(); var sql = new StringBuilder("INSERT INTO po_lines(po,vendor,item,descr,qty,uom) VALUES ");
                for (int k = 0; k < chunk.Count; k++)
                {
                    if (k > 0) sql.Append(','); var b0 = ps.Count;
                    sql.Append($"(${b0},${b0 + 1},${b0 + 2},${b0 + 3},${b0 + 4},${b0 + 5})");
                    double.TryParse(G(chunk[k], cQty).Replace(",", ""), out var qty);
                    ps.AddRange(new object?[] { G(chunk[k], cPo).ToUpperInvariant(), G(chunk[k], cVen), G(chunk[k], cItem), G(chunk[k], cDesc), qty, G(chunk[k], cUom) });
                }
                db.Exec(sql.ToString(), ps.ToArray());
            }
            db.Exec("INSERT INTO settings(key,value) VALUES('po_imported',$0) ON CONFLICT(key) DO UPDATE SET value=excluded.value", DateTime.Now.ToString("MMM d, yyyy h:mm tt"));
            return Results.Ok(new { lines = data.Count, pos = data.Select(r => G(r, cPo).ToUpperInvariant()).Distinct().Count() });
        });
        ad.MapGet("/po-list", () => new
        {
            lines = db.Query("SELECT COUNT(*) FROM po_lines", r => r.GetInt64(0)).FirstOrDefault(),
            pos = db.Query("SELECT COUNT(DISTINCT po) FROM po_lines", r => r.GetInt64(0)).FirstOrDefault(),
            imported = db.One("SELECT value FROM settings WHERE key='po_imported'", r => r.GetString(0)),
            sample = db.Query("SELECT po,vendor,item,descr,qty,uom FROM po_lines LIMIT 8", r => new { po = r.GetString(0), vendor = r.IsDBNull(1) ? "" : r.GetString(1), item = r.IsDBNull(2) ? "" : r.GetString(2), descr = r.IsDBNull(3) ? "" : r.GetString(3), qty = r.IsDBNull(4) ? 0 : r.GetDouble(4), uom = r.IsDBNull(5) ? "" : r.GetString(5) })
        });
        ad.MapDelete("/po-list", () => { db.Exec("DELETE FROM po_lines"); db.Exec("DELETE FROM settings WHERE key='po_imported'"); return Results.Ok(); });
        api.MapGet("/pos/check", (string pos, ClaimsPrincipal u) =>
        {
            if (x.GetMe(u) is not { } me || !me.Has("coordinator")) return Results.Forbid();
            var loaded = db.Query("SELECT COUNT(*) FROM po_lines", r => r.GetInt64(0)).FirstOrDefault() > 0;
            var res = pos.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).Distinct().Select(p =>
            {
                var lines = db.Query("SELECT vendor,item,descr,qty,uom FROM po_lines WHERE po=$0", r => new { vendor = r.IsDBNull(0) ? "" : r.GetString(0), item = r.IsDBNull(1) ? "" : r.GetString(1), descr = r.IsDBNull(2) ? "" : r.GetString(2), qty = r.IsDBNull(3) ? 0 : r.GetDouble(3), uom = r.IsDBNull(4) ? "" : r.GetString(4) }, p.ToUpperInvariant());
                return new { po = p, found = lines.Count > 0, vendor = lines.FirstOrDefault()?.vendor ?? "", lines = lines.Count, qty = lines.Sum(l => l.qty), uom = lines.FirstOrDefault()?.uom ?? "" };
            }).ToList();
            return Results.Ok(new { loaded, results = res });
        }).RequireAuthorization();

        /* ---------------- DocuWare index mapping + folder drop ---------------- */
        ad.MapGet("/docuware", () => new { columns = cfg.GetJson("docuware", DefaultMap()), sources = new[] { "bol", "vendor", "ship", "carrier", "po", "heat", "coil", "cc", "desc", "len", "wt", "d365", "authBy", "authAt", "const" } });
        ad.MapPut("/docuware", (JsonObject body) =>
        {
            var cols = JsonSerializer.Deserialize<List<DwCol>>(body["columns"]?.ToJsonString() ?? "[]", new JsonSerializerOptions(JsonSerializerDefaults.Web)) ?? new();
            cols = cols.Where(c => !string.IsNullOrWhiteSpace(c.Header)).ToList();
            if (cols.Count == 0) return Results.BadRequest(new { error = "Keep at least one column." });
            cfg.PutJson("docuware", cols); return Results.Ok();
        });
        ad.MapPost("/drop-test", (ClaimsPrincipal u) =>
        {
            var g = cfg.General(); if (string.IsNullOrWhiteSpace(g.DropFolder)) return Results.BadRequest(new { error = "Set a folder first and save." });
            try { Directory.CreateDirectory(g.DropFolder.Trim()); var f = Path.Combine(g.DropFolder.Trim(), "receiving-drop-test.txt"); File.WriteAllText(f, "Steel Receiving test file " + DateTime.Now); return Results.Ok(new { file = f }); }
            catch (Exception ex) { return Results.BadRequest(new { error = ex.Message }); }
        });

        /* ---------------- merge several PDFs into one packet PDF ---------------- */
        api.MapPost("/pdf/merge", async (HttpRequest req, ClaimsPrincipal u) =>
        {
            if (x.GetMe(u) is not { } me || !me.Has("coordinator")) return Results.Forbid();
            try
            {
                var form = await req.ReadFormAsync();
                if (form.Files.Count == 0) return Results.BadRequest(new { error = "Pick at least one PDF." });
                var streams = new List<Stream>();
                foreach (var f in form.Files) { var ms = new MemoryStream(); await f.CopyToAsync(ms); ms.Position = 0; streams.Add(ms); }
                return Results.File(FinalPacket.Merge(streams), "application/pdf");
            }
            catch (Exception ex) { return Results.BadRequest(new { error = "Could not merge those files: " + ex.Message }); }
        }).RequireAuthorization();

        /* ---------------- photos (rejects, damage) ---------------- */
        var pk = api.MapGroup("/packets").RequireAuthorization();
        pk.MapPost("/{id}/photo", async (string id, ClaimsPrincipal u, HttpContext c) =>
        {
            if (x.GetMe(u) is not { } me || !me.Has("receiver", "coordinator")) return Results.Forbid();
            if (x.Load(id) == null) return Results.NotFound();
            var dir = Path.Combine(dataDir, "photos", Path.GetFileName(id)); Directory.CreateDirectory(dir);
            var name = Guid.NewGuid().ToString("N")[..10] + ".jpg";
            await using (var fs = File.Create(Path.Combine(dir, name))) await c.Request.Body.CopyToAsync(fs);
            return Results.Ok(new { name });
        });
        pk.MapGet("/{id}/photo/{name}", (string id, string name) =>
        {
            var path = Path.Combine(dataDir, "photos", Path.GetFileName(id), Path.GetFileName(name));
            return File.Exists(path) ? Results.File(path, "image/jpeg") : Results.NotFound();
        });
    }
}

/// <summary>Watches for trouble and emails the admins, once per problem per day.</summary>
public sealed class AlertService : BackgroundService
{
    readonly Db _db; readonly SettingsStore _s; readonly Mailer _m; readonly DataPaths _p; readonly ILogger<AlertService> _log;
    public AlertService(Db db, SettingsStore s, Mailer m, DataPaths p, ILogger<AlertService> log) { _db = db; _s = s; _m = m; _p = p; _log = log; }

    void Alert(string key, string title, string detail)
    {
        var today = DateTime.Now.ToString("yyyy-MM-dd"); var k = "alert_" + key;
        if (_db.One("SELECT value FROM settings WHERE key=$0", r => r.GetString(0), k) == today) return;
        var g = _s.General(); var to = new List<string>();
        to.AddRange(g.AlertEmails.Split(new[] { ',', ';', ' ', '\n' }, StringSplitOptions.RemoveEmptyEntries));
        to.AddRange(_db.Query("SELECT email FROM admins WHERE email<>''", r => r.GetString(0)));
        if (to.Count == 0) return;
        var site = g.SiteName; var link = string.IsNullOrWhiteSpace(g.BaseUrl) ? null : g.BaseUrl.TrimEnd('/') + "/#/settings";
        var st = new MailHtml.Style(title, "Needs attention", "#FBE4E4", "#A12626", "Open Settings");
        var facts = new List<(string, string)> { ("Server", Environment.MachineName), ("Time", DateTime.Now.ToString("MMM d, yyyy h:mm tt")) };
        _m.Enqueue("alert", null, to, $"[{site}] {title}", MailHtml.Text(site, st, detail, facts, null, link), MailHtml.Html(site, st, detail, facts, null, link, st.Button, title, "cid:logo"));
        _db.Exec("INSERT INTO settings(key,value) VALUES($0,$1) ON CONFLICT(key) DO UPDATE SET value=excluded.value", k, today);
        _db.Audit("system", "alert_sent", title);
    }

    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        await Task.Delay(TimeSpan.FromMinutes(2), ct).ContinueWith(_ => { });
        while (!ct.IsCancellationRequested)
        {
            try
            {
                var g = _s.General();
                var failed = _db.Query("SELECT COUNT(*) FROM outbox WHERE status='failed'", r => r.GetInt64(0)).FirstOrDefault();
                if (failed > 0) Alert("mail_failed", "Emails are failing", $"{failed} email(s) could not be sent after several tries. Check the email server settings and the Sent mail tab, then retry them.");
                var last = _db.One("SELECT value FROM settings WHERE key='backup_last'", r => r.GetString(0));
                if (g.BackupEnabled && DateTime.TryParse(last, out var ld) && (DateTime.Today - ld.Date).TotalDays >= 2) Alert("backup_stale", "No recent backup", $"The last backup was on {ld:MMM d}. Look at Settings > Backups and the audit log.");
                if (_db.Query("SELECT COUNT(*) FROM audit WHERE action='backup_failed' AND ts>$0", r => r.GetInt64(0), DateTimeOffset.UtcNow.AddHours(-24).ToUnixTimeMilliseconds()).FirstOrDefault() > 0) Alert("backup_failed", "A backup failed", "The nightly backup raised an error. Check that its folder exists and the app has write access to it.");
                if (_db.Query("SELECT COUNT(*) FROM audit WHERE action='drop_failed' AND ts>$0", r => r.GetInt64(0), DateTimeOffset.UtcNow.AddHours(-24).ToUnixTimeMilliseconds()).FirstOrDefault() > 0) Alert("drop_failed", "Could not copy a final packet to the DocuWare folder", "Check the folder path and that the app has write access to it in Settings > Integrations.");
                try { var di = new DriveInfo(Path.GetPathRoot(Path.GetFullPath(_p.DataDir))!); if (di.AvailableFreeSpace < 5L * 1073741824) Alert("disk_low", "Disk space is low", $"Only {di.AvailableFreeSpace / 1073741824.0:0.0} GB is free on the drive that holds the receiving data."); } catch { }
            }
            catch (Exception ex) { _log.LogError(ex, "Alert check failed"); }
            try { await Task.Delay(TimeSpan.FromMinutes(10), ct); } catch (TaskCanceledException) { return; }
        }
    }
}
