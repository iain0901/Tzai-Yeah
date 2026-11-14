import { DatabaseSync, backup as sqliteBackup } from "node:sqlite";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, chmodSync, renameSync, rmSync, openSync, closeSync } from "node:fs";
import path from "node:path";

const stateKey = Symbol.for("tzai.sqlite.runtime");
const state = globalThis[stateKey] ??= { singleton: null, open: new Map() };

export function databasePath() {
  const filename = process.env.DATABASE_PATH || "data/tzai.sqlite";
  return filename === ":memory:" ? filename : path.resolve(filename);
}

function privateFile(filename) {
  if (process.platform !== "win32") chmodSync(filename, 0o600);
}

function ensureParent(filename) {
  mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
}

function assertHealthy(raw) {
  const results = raw.prepare("PRAGMA integrity_check").all();
  if (results.length !== 1 || results[0].integrity_check !== "ok") throw new Error("SQLite integrity check failed.");
  if (raw.prepare("PRAGMA foreign_key_check").all().length) throw new Error("SQLite foreign-key check failed.");
}

function finalizeSnapshot(filename) {
  // SQLite backup retains the source journal mode. Convert the detached copy
  // to DELETE mode so it remains one portable file, including on read-only
  // backup mounts where SQLite cannot create WAL/SHM sidecars.
  const check = new DatabaseSync(filename);
  try {
    const mode = check.prepare("PRAGMA journal_mode=DELETE").get();
    if (mode.journal_mode !== "delete") throw new Error("Could not create a self-contained SQLite backup.");
    assertHealthy(check);
  } finally { check.close(); }
}

function removeTemporaryDatabase(filename) {
  for (const suffix of ["", "-wal", "-shm", "-journal"]) {
    const artifact = `${filename}${suffix}`;
    if (existsSync(artifact)) rmSync(artifact);
  }
}

function migrationSources(directory) {
  if (!existsSync(directory)) throw new Error(`Migration directory is missing: ${directory}`);
  const files = readdirSync(directory).filter(name => name.endsWith(".sql")).sort();
  if (!files.length) throw new Error(`No SQL migrations found in: ${directory}`);
  return files.map(name => {
    const sql = readFileSync(path.join(directory, name), "utf8").replace(/\r\n/g, "\n");
    const hash = createHash("sha256").update(sql).digest("hex");
    return { name, sql, hash };
  });
}

function validateRestoreMigrations(raw, directory) {
  if (!raw.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='_tzai_migrations'").get()) {
    throw new Error("Backup has no _tzai_migrations ledger. Legacy Cloudflare/D1 databases require an explicit import, not restore.");
  }
  let applied;
  try { applied = raw.prepare("SELECT name,sha256,applied_at FROM _tzai_migrations ORDER BY name").all(); }
  catch { throw new Error("Backup migration ledger has an unsupported format."); }
  if (!applied.length) throw new Error("Backup migration ledger is empty; its schema cannot be verified.");
  const known = migrationSources(directory);
  const byName = new Map(known.map(migration => [migration.name, migration]));
  for (let index = 0; index < applied.length; index++) {
    const recorded = applied[index];
    const current = byName.get(recorded.name);
    if (!current) throw new Error(`Backup contains an unknown migration: ${recorded.name}. Restoring from a newer or different application version is unsupported; upgrade the application first.`);
    if (recorded.sha256 !== current.hash) throw new Error(`Backup migration checksum does not match this application: ${recorded.name}`);
    if (known[index]?.name !== recorded.name) throw new Error(`Backup migration ledger is incomplete or out of order at: ${recorded.name}`);
  }
}

function migrate(raw, directory) {
  const sources = migrationSources(directory);
  raw.exec("CREATE TABLE IF NOT EXISTS _tzai_migrations (name TEXT PRIMARY KEY NOT NULL, sha256 TEXT NOT NULL, applied_at TEXT NOT NULL)");
  for (const { name, sql, hash } of sources) {
    raw.exec("BEGIN IMMEDIATE");
    try {
      const existing = raw.prepare("SELECT sha256 FROM _tzai_migrations WHERE name=?").get(name);
      if (existing && existing.sha256 !== hash) throw new Error(`Applied migration was modified: ${name}`);
      if (!existing) {
        raw.exec(sql);
        raw.prepare("INSERT INTO _tzai_migrations (name,sha256,applied_at) VALUES (?,?,?)").run(name, hash, new Date().toISOString());
      }
      raw.exec("COMMIT");
    } catch (error) {
      raw.exec("ROLLBACK");
      throw error;
    }
  }
}

function bindValue(value) {
  if (typeof value === "boolean") return value ? 1 : 0;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  return value;
}

class PreparedStatement {
  constructor(owner, sql, values = []) { this.owner = owner; this.sql = sql; this.values = values; }
  bind(...values) { return new PreparedStatement(this.owner, this.sql, values.map(bindValue)); }
  execute() {
    this.owner.assertOpen();
    const raw = this.owner.raw;
    const statement = raw.prepare(this.sql);
    // Consume RETURNING rows completely before another statement can use changes().
    let results = [];
    let info;
    if (statement.columns().length) {
      const before = raw.prepare("SELECT total_changes() AS n").get().n;
      results = statement.all(...this.values).map(row => ({ ...row }));
      const after = raw.prepare("SELECT total_changes() AS n, changes() AS changes, last_insert_rowid() AS id").get();
      info = { changes: Number(after.n === before ? 0 : after.changes), last_row_id: Number(after.id) };
    } else {
      const result = statement.run(...this.values);
      info = { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) };
    }
    return { results, success: true, meta: info };
  }
  async first(columnName) {
    const row = this.execute().results[0];
    if (!row) return null;
    return columnName === undefined ? row : row[columnName] ?? null;
  }
  async all() { return this.execute(); }
  async run() { return this.execute(); }
}

/** Open an isolated connection. The application normally uses the lazy singleton below. */
export function createDatabase(options = {}) {
  const filename = options.filename === ":memory:" ? ":memory:" : path.resolve(options.filename || databasePath());
  const directory = path.resolve(options.migrationsDirectory || process.env.MIGRATIONS_DIR || "drizzle");
  if (filename !== ":memory:") {
    ensureParent(filename);
    if (existsSync(`${filename}.restore.lock`)) throw new Error("Database restore is in progress. Remove a stale .restore.lock only after checking that no restore process is running.");
    try { closeSync(openSync(filename, "wx", 0o600)); } catch (error) { if (error.code !== "EEXIST") throw error; }
  }
  const raw = new DatabaseSync(filename);
  let closed = false;
  try {
    if (filename !== ":memory:") privateFile(filename);
    raw.exec("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
    if (filename !== ":memory:") raw.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;");
    if (options.migrate !== false) migrate(raw, directory);
  } catch (error) { raw.close(); throw error; }
  const owner = {
    raw, filename,
    assertOpen() { if (closed) throw new Error("Database connection is closed."); },
    prepare(sql) { owner.assertOpen(); return new PreparedStatement(owner, sql); },
    async batch(statements) {
      owner.assertOpen();
      if (statements.some(statement => !(statement instanceof PreparedStatement) || statement.owner !== owner)) throw new Error("All batch statements must use this database connection.");
      // No await inside the transaction: compare-and-swap, audit changes(), and
      // leaderboard reads share one indivisible SQLite snapshot.
      raw.exec("BEGIN IMMEDIATE");
      try {
        const results = statements.map(statement => statement.execute());
        raw.exec("COMMIT");
        return results;
      } catch (error) { raw.exec("ROLLBACK"); throw error; }
    },
    async exec(sql) { owner.assertOpen(); raw.exec(sql); return { success: true }; },
    close() {
      if (closed) return;
      raw.close(); closed = true;
      state.open.get(filename)?.delete(owner);
      if (!state.open.get(filename)?.size) state.open.delete(filename);
      if (state.singleton === owner) state.singleton = null;
    },
  };
  if (!state.open.has(filename)) state.open.set(filename, new Set());
  state.open.get(filename).add(owner);
  return owner;
}

export function getDatabase() {
  const filename = databasePath();
  if (state.singleton && state.singleton.filename !== filename) throw new Error("DATABASE_PATH cannot change while the database is open.");
  return state.singleton ??= createDatabase({ filename });
}
export function getRawDatabase() { return getDatabase().raw; }
export function closeDatabase() { state.singleton?.close(); }

/** Consistent online snapshot, including committed WAL contents. */
export async function backupDatabase(destination, options = {}) {
  const target = path.resolve(destination);
  const source = options.database || getDatabase();
  if (target === source.filename) throw new Error("Backup destination must differ from the database path.");
  if (existsSync(target) && !options.force) throw new Error("Backup already exists; choose another filename or pass --force.");
  ensureParent(target);
  const temporary = `${target}.${randomUUID()}.tmp`;
  try {
    closeSync(openSync(temporary, "wx", 0o600));
    await sqliteBackup(source.raw, temporary);
    privateFile(temporary);
    finalizeSnapshot(temporary);
    if (existsSync(target) && !options.force) throw new Error("Backup destination was created by another process.");
    renameSync(temporary, target);
    return target;
  } finally { removeTemporaryDatabase(temporary); }
}

/** Offline only. Caller must explicitly confirm all application instances stopped. */
export async function restoreDatabase(sourceFilename, options = {}) {
  if (!options.confirmStopped) throw new Error("Stop every application instance, then pass --confirm-stopped.");
  const target = path.resolve(options.filename || databasePath());
  const source = path.resolve(sourceFilename);
  const directory = path.resolve(options.migrationsDirectory || process.env.MIGRATIONS_DIR || "drizzle");
  if (target === source) throw new Error("Restore source must differ from the database path.");
  if (state.open.get(target)?.size) throw new Error("Database is still open in this process. Stop the application before restoring.");
  if (existsSync(target) && !options.force) throw new Error("Database already exists; pass --force to restore and preserve a safety backup.");
  ensureParent(target);
  const lock = `${target}.restore.lock`;
  const descriptor = openSync(lock, "wx", 0o600);
  closeSync(descriptor);
  const staged = `${target}.${randomUUID()}.restore`;
  let previousBackup = null;
  try {
    const incoming = new DatabaseSync(source, { readOnly: true });
    try { assertHealthy(incoming); closeSync(openSync(staged, "wx", 0o600)); await sqliteBackup(incoming, staged); } finally { incoming.close(); }
    privateFile(staged);
    const check = new DatabaseSync(staged);
    try {
      check.exec("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
      assertHealthy(check);
      // Reject unrelated valid SQLite files before replacing the event database.
      for (const table of ["cards", "participants", "settings", "audit"]) {
        if (!check.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table)) throw new Error(`Backup is missing the event table: ${table}`);
      }
      validateRestoreMigrations(check, directory);
      // Upgrade an older, verified backup in isolation. If any pending migration
      // fails, the running installation's database has not been touched.
      migrate(check, directory);
      assertHealthy(check);
    } finally { check.close(); }
    if (existsSync(target)) {
      if (!options.force) throw new Error("Database appeared during restore. Pass --force only after stopping the application.");
      const current = new DatabaseSync(target);
      try {
        current.exec("PRAGMA busy_timeout=5000;");
        const checkpoint = current.prepare("PRAGMA wal_checkpoint(TRUNCATE)").get();
        if (checkpoint.busy) throw new Error("Database is busy; stop all application instances before restoring.");
        previousBackup = `${target}.before-restore-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}.sqlite`;
        closeSync(openSync(previousBackup, "wx", 0o600));
        await sqliteBackup(current, previousBackup);
        privateFile(previousBackup);
        finalizeSnapshot(previousBackup);
      } finally { current.close(); }
    }
    // The service is stopped and its WAL checkpointed. Never retain old sidecars
    // next to a replacement database, since they belong to the previous file.
    for (const suffix of ["-wal", "-shm"]) if (existsSync(`${target}${suffix}`)) rmSync(`${target}${suffix}`);
    renameSync(staged, target);
    privateFile(target);
    return { filename: target, previousBackup };
  } finally {
    removeTemporaryDatabase(staged);
    rmSync(lock);
  }
}
