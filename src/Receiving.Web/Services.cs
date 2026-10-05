using System.Security.Cryptography;
using System.Text.Json;
using System.Text.RegularExpressions;
using MailKit.Net.Smtp;
using MailKit.Security;
using Microsoft.AspNetCore.DataProtection;
using MimeKit;

namespace Receiving.Web;

public class SmtpCfg
{
    public string Host { get; set; } = "";
    public int Port { get; set; } = 25;
    public string Security { get; set; } = "None";   // None | StartTls | Ssl
    public string User { get; set; } = "";
    public string Password { get; set; } = "";       // stored encrypted
    public string FromAddr { get; set; } = "";
    public string FromName { get; set; } = "Steel Receiving";
}

public class GeneralCfg
{
    public string SiteName { get; set; } = "Steel Receiving";
    public string BaseUrl { get; set; } = "";
    public int IdleMinutes { get; set; } = 15;
    public int PinLength { get; set; } = 4;
    public int MaxFailed { get; set; } = 5;
    public int LockMinutes { get; set; } = 5;
    public string ReviewRule { get; set; } = "all";  // all | any
    public bool BackupEnabled { get; set; } = true;
    public string BackupTime { get; set; } = "02:00";
    public string BackupFolder { get; set; } = "";   // blank = data\backups
    public int BackupKeep { get; set; } = 14;
}

public class NotifCfg
{
    public string Event { get; set; } = "";
    public string Label { get; set; } = "";
    public bool Enabled { get; set; } = true;
    public string[] Roles { get; set; } = [];
    public long[] UserIds { get; set; } = [];
    public string Extra { get; set; } = "";
    public string Subject { get; set; } = "";
    public string Body { get; set; } = "";
}

public sealed class SettingsStore
{
    static readonly JsonSerializerOptions J = new(JsonSerializerDefaults.Web);
    readonly Db _db; readonly IDataProtector _dp;
    public SettingsStore(Db db, IDataProtectionProvider dp) { _db = db; _dp = dp.CreateProtector("Receiving.Smtp"); }

    T Get<T>(string key, Func<T> def)
    {
        var v = _db.One("SELECT value FROM settings WHERE key=$0", r => r.GetString(0), key);
        if (v == null) return def();
        try { return JsonSerializer.Deserialize<T>(v, J) ?? def(); } catch { return def(); }
    }
    void Put<T>(string key, T val) => _db.Exec("INSERT INTO settings(key,value) VALUES($0,$1) ON CONFLICT(key) DO UPDATE SET value=excluded.value", key, JsonSerializer.Serialize(val, J));

    public GeneralCfg General() => Get("general", () => new GeneralCfg());
    public void SetGeneral(GeneralCfg g) => Put("general", g);
    public SmtpCfg Smtp() => Get("smtp", () => new SmtpCfg());
    public string SmtpPassword() { var s = Smtp().Password; if (s == "") return ""; try { return _dp.Unprotect(s); } catch { return ""; } }
    public void SetSmtp(SmtpCfg c, string? newPassword)
    {
        var old = Smtp();
        c.Password = newPassword == null ? old.Password : (newPassword == "" ? "" : _dp.Protect(newPassword));
        Put("smtp", c);
    }
    public List<NotifCfg> Notifs()
    {
        var saved = Get("notifs", () => new List<NotifCfg>());
        return DefaultNotifs().Select(d =>
        {
            var s = saved.FirstOrDefault(x => x.Event == d.Event);
            if (s != null)
            {
                s.Label = d.Label;
                if (OldBodies.Contains(s.Body.Replace("\r", "")) || s.Body.Contains("{{link}}") || s.Body.Contains("BOL: {{bol}}")) s.Body = d.Body;   // earlier plain-text defaults: move to the new wording
            }
            return s ?? d;
        }).ToList();
    }
    public void SetNotifs(List<NotifCfg> n) => Put("notifs", n);

    static readonly HashSet<string> OldBodies =
    [
        "A new steel packet is ready for inspection.\n\nBOL: {{bol}}\nVendor: {{vendor}}\nPO(s): {{pos}}\nItems: {{items}}\n\nOpen it: {{link}}",
        "{{actor}} completed inspection for BOL {{bol}} ({{vendor}}).\nPO(s): {{pos}}\n\nPlease review and approve: {{link}}",
        "All reviewers approved BOL {{bol}} ({{vendor}}).\nPO(s): {{pos}}\n\nReceive in D365 and record the receipt number: {{link}}",
        "{{actor}} received BOL {{bol}} in D365 (receipt {{d365}}).\n\nAuthorize to finish: {{link}}",
        "BOL {{bol}} ({{vendor}}) was authorized by {{actor}} and filed.\nPO(s): {{pos}}\nD365 receipt: {{d365}}\n\nDetails and DocuWare index sheet: {{link}}",
    ];

    public static List<NotifCfg> DefaultNotifs() =>
    [
        new() { Event = "packet_created", Label = "New packet ready for inspection", Roles = ["receiver"],
            Subject = "New steel packet: BOL {{bol}} ({{vendor}})",
            Body = "A new steel packet is ready for inspection on the dock.\n\nOpen it to start the inspection for each PO." },
        new() { Event = "inspection_complete", Label = "Inspection complete, review needed", Roles = ["reviewer"],
            Subject = "Review needed: BOL {{bol}}",
            Body = "{{actor}} finished inspecting this packet.\n\nPlease review the inspections and approve." },
        new() { Event = "review_complete", Label = "All reviews approved, ready to receive", Roles = ["coordinator"],
            Subject = "Ready to receive in D365: BOL {{bol}}",
            Body = "Every reviewer approved this packet.\n\nReceive the PO lines in D365, then record the receipt number." },
        new() { Event = "received", Label = "Received in D365, ready to authorize", Roles = ["coordinator"],
            Subject = "Ready to authorize: BOL {{bol}}",
            Body = "{{actor}} received this packet in D365 (receipt {{d365}}).\n\nIt is ready for you to authorize." },
        new() { Event = "filed", Label = "Final: packet authorized and filed", Roles = ["coordinator", "reviewer"],
            Subject = "Receiving complete: BOL {{bol}}",
            Body = "{{actor}} authorized this packet and it is now filed.\n\nUpload the PDF to DocuWare and tag it with the index sheet from the packet page." },
    ];
}

public static class Pin
{
    public static (string hash, string salt) Make(string pin)
    {
        var salt = RandomNumberGenerator.GetBytes(16);
        return (Convert.ToBase64String(Rfc2898DeriveBytes.Pbkdf2(pin, salt, 100_000, HashAlgorithmName.SHA256, 32)), Convert.ToBase64String(salt));
    }
    public static bool Check(string pin, string? hash, string? salt)
    {
        if (string.IsNullOrEmpty(hash) || string.IsNullOrEmpty(salt)) return false;
        var calc = Rfc2898DeriveBytes.Pbkdf2(pin, Convert.FromBase64String(salt), 100_000, HashAlgorithmName.SHA256, 32);
        return CryptographicOperations.FixedTimeEquals(calc, Convert.FromBase64String(hash));
    }
}

public sealed class Mailer : BackgroundService
{
    readonly Db _db; readonly SettingsStore _s; readonly ILogger<Mailer> _log; readonly string _logo;
    public Mailer(Db db, SettingsStore s, ILogger<Mailer> log, IWebHostEnvironment env)
    {
        _db = db; _s = s; _log = log;
        _logo = Path.Combine(env.WebRootPath ?? Path.Combine(env.ContentRootPath, "wwwroot"), "icons", "icon-192.png");
        _db.Migrate();
    }

    public string LogoDataUri() => File.Exists(_logo) ? "data:image/png;base64," + Convert.ToBase64String(File.ReadAllBytes(_logo)) : "";

    public static string Render(string tpl, Dictionary<string, string> v) =>
        Regex.Replace(tpl, @"\{\{(\w+)\}\}", m => v.TryGetValue(m.Groups[1].Value, out var x) ? x : m.Value);

    public void Enqueue(string evt, string? packetId, IEnumerable<string> to, string subject, string body, string? html = null)
    {
        var addrs = to.Where(a => !string.IsNullOrWhiteSpace(a)).Select(a => a.Trim()).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
        if (addrs.Count == 0) return;
        _db.Exec("INSERT INTO outbox(to_addr,subject,body,html,event,packet_id,created) VALUES($0,$1,$2,$3,$4,$5,$6)",
            string.Join(",", addrs), subject, body, html, evt, packetId, DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
    }

    public async Task SendNow(string to, string subject, string body, string? html = null, CancellationToken ct = default)
    {
        var c = _s.Smtp();
        if (string.IsNullOrWhiteSpace(c.Host)) throw new InvalidOperationException("SMTP host is not set.");
        if (string.IsNullOrWhiteSpace(c.FromAddr)) throw new InvalidOperationException("From address is not set.");
        var msg = new MimeMessage();
        msg.From.Add(new MailboxAddress(c.FromName, c.FromAddr));
        foreach (var a in to.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)) msg.To.Add(MailboxAddress.Parse(a));
        msg.Subject = subject;
        if (html == null) msg.Body = new TextPart("plain") { Text = body };
        else
        {
            var bb = new BodyBuilder { TextBody = body, HtmlBody = html };
            if (html.Contains("cid:logo") && File.Exists(_logo)) { var img = bb.LinkedResources.Add(_logo); img.ContentId = "logo"; }
            msg.Body = bb.ToMessageBody();
        }
        using var smtp = new SmtpClient();
        var sec = c.Security switch { "Ssl" => SecureSocketOptions.SslOnConnect, "StartTls" => SecureSocketOptions.StartTls, _ => SecureSocketOptions.None };
        await smtp.ConnectAsync(c.Host, c.Port, sec, ct);
        if (!string.IsNullOrWhiteSpace(c.User)) await smtp.AuthenticateAsync(c.User, _s.SmtpPassword(), ct);
        await smtp.SendAsync(msg, ct);
        await smtp.DisconnectAsync(true, ct);
    }

    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            try
            {
                var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
                var jobs = _db.Query("SELECT id,to_addr,subject,body,attempts,html FROM outbox WHERE status='pending' AND next_try<=$0 ORDER BY id LIMIT 10",
                    r => (id: r.GetInt64(0), to: r.GetString(1), sub: r.GetString(2), body: r.GetString(3), att: r.GetInt32(4), html: r.IsDBNull(5) ? null : r.GetString(5)), now);
                foreach (var j in jobs)
                {
                    try
                    {
                        await SendNow(j.to, j.sub, j.body, j.html, ct);
                        _db.Exec("UPDATE outbox SET status='sent',sent_at=$1,error=NULL,attempts=attempts+1 WHERE id=$0", j.id, DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
                    }
                    catch (Exception ex)
                    {
                        var att = j.att + 1;
                        var st = att >= 5 ? "failed" : "pending";
                        var next = DateTimeOffset.UtcNow.AddMinutes(Math.Pow(2, att)).ToUnixTimeMilliseconds();
                        _db.Exec("UPDATE outbox SET status=$1,attempts=$2,next_try=$3,error=$4 WHERE id=$0", j.id, st, att, next, ex.Message);
                        _log.LogWarning("Mail {Id} failed: {Msg}", j.id, ex.Message);
                    }
                }
            }
            catch (Exception ex) { _log.LogError(ex, "Mailer loop"); }
            try { await Task.Delay(5000, ct); } catch (TaskCanceledException) { }
        }
    }
}
