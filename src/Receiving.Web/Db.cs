using Microsoft.Data.Sqlite;

namespace Receiving.Web;

public sealed class Db
{
    readonly string _cs;

    public Db(string path)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(path))!);
        _cs = new SqliteConnectionStringBuilder { DataSource = path, Mode = SqliteOpenMode.ReadWriteCreate }.ToString();
        Exec(@"
CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, initials TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '',
  roles TEXT NOT NULL DEFAULT 'receiver', pin_hash TEXT, pin_salt TEXT, active INTEGER NOT NULL DEFAULT 1,
  failed INTEGER NOT NULL DEFAULT 0, locked_until INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS admins(account TEXT PRIMARY KEY COLLATE NOCASE, name TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '', added_by TEXT, added_at INTEGER);
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS packets(id TEXT PRIMARY KEY, bol TEXT NOT NULL UNIQUE, stage TEXT NOT NULL, created INTEGER NOT NULL, updated INTEGER NOT NULL, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS outbox(id INTEGER PRIMARY KEY AUTOINCREMENT, to_addr TEXT NOT NULL, subject TEXT NOT NULL, body TEXT NOT NULL,
  event TEXT, packet_id TEXT, status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0, next_try INTEGER NOT NULL DEFAULT 0,
  error TEXT, created INTEGER NOT NULL, sent_at INTEGER);
CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, actor TEXT, action TEXT, detail TEXT);
");
    }

    public void Migrate()
    {
        try { Exec("ALTER TABLE outbox ADD COLUMN html TEXT"); } catch { /* already there */ }
        try { Exec("ALTER TABLE users ADD COLUMN demo INTEGER NOT NULL DEFAULT 0"); } catch { /* already there */ }
        // demo data loaded before the demo flag existed
        Exec("UPDATE users SET demo=1 WHERE demo=0 AND name IN ('Receiver One','Receiver Two','Demo Coordinator','Demo Reviewer')");
        Exec("UPDATE packets SET data=json_set(data,'$.demo',json('true')) WHERE bol IN ('1487848','1929915','327874') AND json_extract(data,'$.demo') IS NULL");
    }

    SqliteConnection Open()
    {
        var c = new SqliteConnection(_cs);
        c.Open();
        using var p = c.CreateCommand();
        p.CommandText = "PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;";
        p.ExecuteNonQuery();
        return c;
    }

    static void Bind(SqliteCommand cmd, object?[] ps)
    {
        for (int i = 0; i < ps.Length; i++) cmd.Parameters.AddWithValue("$" + i, ps[i] ?? DBNull.Value);
    }

    public int Exec(string sql, params object?[] ps)
    {
        using var c = Open(); using var cmd = c.CreateCommand();
        cmd.CommandText = sql; Bind(cmd, ps);
        return cmd.ExecuteNonQuery();
    }

    public long Insert(string sql, params object?[] ps)
    {
        using var c = Open(); using var cmd = c.CreateCommand();
        cmd.CommandText = sql + "; SELECT last_insert_rowid();"; Bind(cmd, ps);
        return Convert.ToInt64(cmd.ExecuteScalar());
    }

    public List<T> Query<T>(string sql, Func<SqliteDataReader, T> map, params object?[] ps)
    {
        using var c = Open(); using var cmd = c.CreateCommand();
        cmd.CommandText = sql; Bind(cmd, ps);
        using var r = cmd.ExecuteReader();
        var list = new List<T>();
        while (r.Read()) list.Add(map(r));
        return list;
    }

    public T? One<T>(string sql, Func<SqliteDataReader, T> map, params object?[] ps) where T : class
        => Query(sql, map, ps).FirstOrDefault();

    public void Audit(string actor, string action, string detail = "")
        => Exec("INSERT INTO audit(ts,actor,action,detail) VALUES($0,$1,$2,$3)", DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(), actor, action, detail);
}
