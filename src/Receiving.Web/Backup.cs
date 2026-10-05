using System.IO.Compression;

namespace Receiving.Web;

public record DataPaths(string DataDir);

/// <summary>Nightly backup: a consistent snapshot of the database plus packet PDFs, final packets and encryption keys, in one zip.</summary>
public sealed class BackupService : BackgroundService
{
    readonly Db _db; readonly SettingsStore _s; readonly DataPaths _p; readonly ILogger<BackupService> _log;
    static readonly object Gate = new();
    public BackupService(Db db, SettingsStore s, DataPaths p, ILogger<BackupService> log) { _db = db; _s = s; _p = p; _log = log; }

    public string Folder() { var g = _s.General(); return string.IsNullOrWhiteSpace(g.BackupFolder) ? Path.Combine(_p.DataDir, "backups") : g.BackupFolder.Trim(); }

    public string Run()
    {
        lock (Gate)
        {
            var folder = Folder(); Directory.CreateDirectory(folder);
            var stamp = DateTime.Now.ToString("yyyyMMdd-HHmmss");
            var snap = Path.Combine(Path.GetTempPath(), $"receiving-{stamp}.db");
            _db.Exec("VACUUM INTO '" + snap.Replace("'", "''") + "'");
            var zipPath = Path.Combine(folder, $"receiving-backup-{stamp}.zip");
            try
            {
                using var z = ZipFile.Open(zipPath, ZipArchiveMode.Create);
                z.CreateEntryFromFile(snap, "receiving.db");
                foreach (var sub in new[] { "pdfs", "final", "keys" })
                {
                    var dir = Path.Combine(_p.DataDir, sub); if (!Directory.Exists(dir)) continue;
                    foreach (var f in Directory.GetFiles(dir)) z.CreateEntryFromFile(f, sub + "/" + Path.GetFileName(f));
                }
            }
            finally { try { File.Delete(snap); } catch { } }
            var keep = Math.Max(1, _s.General().BackupKeep);
            foreach (var old in new DirectoryInfo(folder).GetFiles("receiving-backup-*.zip").OrderByDescending(f => f.Name).Skip(keep))
                try { old.Delete(); } catch { }
            _db.Exec("INSERT INTO settings(key,value) VALUES('backup_last',$0) ON CONFLICT(key) DO UPDATE SET value=excluded.value", DateTime.Now.ToString("yyyy-MM-dd"));
            return zipPath;
        }
    }

    public object List()
    {
        var folder = Folder(); var files = Directory.Exists(folder) ? new DirectoryInfo(folder).GetFiles("receiving-backup-*.zip").OrderByDescending(f => f.Name).Take(60) : Enumerable.Empty<FileInfo>();
        return new { folder, files = files.Select(f => new { name = f.Name, size = f.Length, time = new DateTimeOffset(f.LastWriteTime).ToUnixTimeMilliseconds() }) };
    }

    public FileStream? Open(string name)
    {
        name = Path.GetFileName(name); if (!name.StartsWith("receiving-backup-") || !name.EndsWith(".zip")) return null;
        var path = Path.Combine(Folder(), name); return File.Exists(path) ? new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read) : null;
    }

    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            try { await Task.Delay(TimeSpan.FromMinutes(1), ct); } catch (TaskCanceledException) { return; }
            try
            {
                var g = _s.General();
                if (!g.BackupEnabled || !TimeSpan.TryParse(g.BackupTime, out var at)) continue;
                var today = DateTime.Now.ToString("yyyy-MM-dd");
                var last = _db.One("SELECT value FROM settings WHERE key='backup_last'", r => r.GetString(0));
                if (last == today || DateTime.Now.TimeOfDay < at) continue;
                var f = Run(); _db.Audit("system", "backup", Path.GetFileName(f));
            }
            catch (Exception ex)
            {
                _log.LogError(ex, "Backup failed");
                try { _db.Exec("INSERT INTO settings(key,value) VALUES('backup_last',$0) ON CONFLICT(key) DO UPDATE SET value=excluded.value", DateTime.Now.ToString("yyyy-MM-dd")); _db.Audit("system", "backup_failed", ex.Message); } catch { }
            }
        }
    }
}
