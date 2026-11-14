import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { createDatabase, backupDatabase, restoreDatabase } from "../lib/server/sqlite-runtime.mjs";
import { clientAddress } from "../lib/server/client-address.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scratch = path.join(root, "work", "database-tests");
mkdirSync(scratch, { recursive: true });
const migrationsDirectory = path.join(root, "drizzle");

function fixture(t) {
  const directory = mkdtempSync(path.join(scratch, "case-"));
  const opened = [];
  t.after(() => {
    for (const database of opened) database.close();
    const resolved = path.resolve(directory);
    assert.ok(resolved.startsWith(`${path.resolve(scratch)}${path.sep}`));
    rmSync(resolved, { recursive: true, force: true });
  });
  return {
    directory,
    filename: path.join(directory, "event.sqlite"),
    open(filename = path.join(directory, "event.sqlite"), options = {}) {
      const database = createDatabase({ filename, migrationsDirectory, ...options });
      opened.push(database);
      return database;
    },
  };
}

test("client IP headers are used only behind an explicitly trusted proxy", () => {
  const original = process.env.TRUST_PROXY;
  try {
    delete process.env.TRUST_PROXY;
    const request = new Request("http://localhost/", { headers: { "x-forwarded-for": "1.2.3.4, 192.0.2.20", "cf-connecting-ip": "8.8.8.8" } });
    assert.equal(clientAddress(request), "direct-server");
    process.env.TRUST_PROXY = "true";
    assert.equal(clientAddress(request), "192.0.2.20");
    assert.equal(clientAddress(new Request("http://localhost/", { headers: { "x-forwarded-for": "1.2.3.4, invalid" } })), "direct-server");
    assert.equal(clientAddress(new Request("http://localhost/", { headers: { "cf-connecting-ip": "8.8.8.8" } })), "direct-server");
  } finally {
    if (original === undefined) delete process.env.TRUST_PROXY;
    else process.env.TRUST_PROXY = original;
  }
});

test("module import never opens a database or requires runtime secrets", t => {
  const f = fixture(t);
  const filename = path.join(f.directory, "unopened", "event.sqlite");
  const url = pathToFileURL(path.join(root, "lib/server/sqlite-runtime.mjs")).href;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", `await import(${JSON.stringify(url)});`], { env: { ...process.env, DATABASE_PATH: filename }, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(existsSync(filename), false);
  assert.equal(existsSync(path.dirname(filename)), false);
});

test("migrations persist on reopen and retain schema constraints", async t => {
  const f = fixture(t);
  const db = f.open();
  await db.prepare("INSERT INTO cards (id,serial,token,created_at) VALUES (?,?,?,?)").bind("c1", "001", "token-1", "2026-11-14").run();
  assert.ok(db.raw.prepare("SELECT COUNT(*) AS n FROM _tzai_migrations").get().n >= 2);
  await assert.rejects(db.prepare("INSERT INTO card_bindings (card_id,participant_id) VALUES (?,?)").bind("c1", "missing").run(), /FOREIGN KEY/);
  db.close();
  const reopened = f.open();
  assert.equal((await reopened.prepare("SELECT serial FROM cards WHERE id=?").bind("c1").first()).serial, "001");
  assert.equal(reopened.raw.prepare("PRAGMA journal_mode").get().journal_mode, "wal");
  assert.equal(reopened.raw.prepare("PRAGMA foreign_keys").get().foreign_keys, 1);
  if (process.platform !== "win32") assert.equal(statSync(f.filename).mode & 0o777, 0o600);
});

test("bound queries support RETURNING, JSON, window functions and immutable bind", async t => {
  const f = fixture(t), db = f.open();
  const insert = db.prepare("INSERT INTO settings (id,value) VALUES (?,?) RETURNING id,value");
  const first = insert.bind("tree:a", JSON.stringify({ growth: 2 }));
  const second = insert.bind("tree:b", JSON.stringify({ growth: 5 }));
  const results = await db.batch([first, second]);
  assert.equal(results[0].results[0].id, "tree:a");
  assert.equal(results[0].meta.changes, 1);
  assert.equal(results[1].results[0].id, "tree:b");
  const ranks = await db.prepare("SELECT id,ROW_NUMBER() OVER (ORDER BY json_extract(value,'$.growth') DESC) AS rank FROM settings").all();
  assert.deepEqual(ranks.results, [{ id: "tree:b", rank: 1 }, { id: "tree:a", rank: 2 }]);
  assert.equal(await db.prepare("SELECT id FROM settings WHERE id=?").bind("tree:b").first("id"), "tree:b");
  assert.equal(await db.prepare("SELECT id FROM settings WHERE id=?").bind("not-present").first(), null);
  const literal = "x'); DROP TABLE settings; --";
  await insert.bind(literal, "{}").run();
  assert.equal(await db.prepare("SELECT id FROM settings WHERE id=?").bind(literal).first("id"), literal);
});

test("batch rollback is atomic and changes() guards audit records", async t => {
  const f = fixture(t), db = f.open();
  await db.prepare("INSERT INTO settings VALUES (?,?)").bind("record", "old").run();
  const update = db.prepare("UPDATE settings SET value=? WHERE id=? AND value=?");
  const audit = db.prepare("INSERT INTO audit(id,actor,action,detail,created_at) SELECT ?,'test','save','changed','2026-11-14' WHERE changes()>0");
  const success = await db.batch([update.bind("new", "record", "old"), audit.bind("a1")]);
  assert.equal(success[0].meta.changes, 1);
  const failure = await db.batch([update.bind("wrong", "record", "old"), audit.bind("a2")]);
  assert.equal(failure[0].meta.changes, 0);
  assert.equal(await db.prepare("SELECT COUNT(*) AS n FROM audit").first("n"), 1);
  await assert.rejects(db.batch([
    update.bind("would-rollback", "record", "new"),
    db.prepare("INSERT INTO settings VALUES ('record','duplicate')"),
  ]), /UNIQUE/);
  assert.equal(await db.prepare("SELECT value FROM settings WHERE id='record'").first("value"), "new");
  const snapshot = await db.batch([db.prepare("SELECT value FROM settings"), db.prepare("SELECT COUNT(*) AS n FROM audit")]);
  assert.equal(snapshot[0].results[0].value, "new");
  assert.equal(snapshot[1].results[0].n, 1);
});

test("competing compare-and-swap writes award growth once", async t => {
  const f = fixture(t), db = f.open();
  await db.prepare("INSERT INTO settings VALUES ('tree','{\"growth\":0,\"revision\":0}')").run();
  const expected = '{"growth":0,"revision":0}';
  const attempts = await Promise.all(Array.from({ length: 12 }, () => db.prepare("UPDATE settings SET value=? WHERE id='tree' AND value=?").bind('{"growth":1,"revision":1}', expected).run()));
  assert.equal(attempts.reduce((sum, result) => sum + result.meta.changes, 0), 1);
  assert.equal(await db.prepare("SELECT json_extract(value,'$.growth') AS growth FROM settings WHERE id='tree'").first("growth"), 1);
});

test("failed migrations roll back and modified applied SQL is rejected", t => {
  const f = fixture(t), directory = path.join(f.directory, "migrations");
  mkdirSync(directory);
  const one = path.join(directory, "0000_initial.sql");
  writeFileSync(one, "CREATE TABLE example (id TEXT PRIMARY KEY);\r\n");
  const db = f.open(f.filename, { migrationsDirectory: directory });
  db.close();
  // Changing line endings between Windows and Linux is not a schema edit.
  writeFileSync(one, readFileSync(one, "utf8").replace(/\r\n/g, "\n"));
  f.open(f.filename, { migrationsDirectory: directory }).close();
  const two = path.join(directory, "0001_broken.sql");
  writeFileSync(two, "CREATE TABLE rolled_back (id TEXT); INSERT INTO missing VALUES (1);");
  assert.throws(() => f.open(f.filename, { migrationsDirectory: directory }), /no such table/);
  const check = f.open(f.filename, { migrate: false });
  assert.equal(check.raw.prepare("SELECT name FROM sqlite_master WHERE name='rolled_back'").get(), undefined);
  assert.equal(check.raw.prepare("SELECT COUNT(*) AS n FROM _tzai_migrations").get().n, 1);
  check.close();
  rmSync(two);
  writeFileSync(one, "CREATE TABLE example (id INTEGER PRIMARY KEY);");
  assert.throws(() => f.open(f.filename, { migrationsDirectory: directory }), /migration was modified/);
});

test("online backup includes WAL data and offline restore preserves the old database", async t => {
  const f = fixture(t), db = f.open();
  const output = path.join(f.directory, "snapshot.sqlite");
  await db.prepare("INSERT INTO settings VALUES ('event','original')").run();
  assert.equal(await backupDatabase(output, { database: db }), output);
  await assert.rejects(backupDatabase(output, { database: db }), /already exists/);
  await assert.rejects(restoreDatabase(output, { filename: f.filename, force: true }), /confirm-stopped/);
  await assert.rejects(restoreDatabase(output, { filename: f.filename, force: true, confirmStopped: true }), /still open/);
  await db.prepare("UPDATE settings SET value='newer' WHERE id='event'").run();
  db.close();
  await assert.rejects(restoreDatabase(output, { filename: f.filename, confirmStopped: true }), /already exists/);
  const restored = await restoreDatabase(output, { filename: f.filename, confirmStopped: true, force: true });
  assert.ok(existsSync(restored.previousBackup));
  const previous = f.open(restored.previousBackup);
  assert.equal(await previous.prepare("SELECT value FROM settings WHERE id='event'").first("value"), "newer");
  const current = f.open();
  assert.equal(await current.prepare("SELECT value FROM settings WHERE id='event'").first("value"), "original");
  assert.equal(existsSync(`${f.filename}.restore.lock`), false);
});

test("restore rejects corrupt or unrelated backups without replacing data", async t => {
  const f = fixture(t), db = f.open();
  await db.prepare("INSERT INTO settings VALUES ('event','keep-me')").run();
  db.close();
  const corrupt = path.join(f.directory, "corrupt.sqlite");
  writeFileSync(corrupt, "not a sqlite database");
  await assert.rejects(restoreDatabase(corrupt, { filename: f.filename, confirmStopped: true, force: true }), /not a database/);
  const unrelated = f.open(path.join(f.directory, "unrelated.sqlite"), { migrate: false });
  unrelated.raw.exec("CREATE TABLE unrelated (id TEXT)");
  unrelated.close();
  await assert.rejects(restoreDatabase(unrelated.filename, { filename: f.filename, confirmStopped: true, force: true }), /missing the event table/);
  const current = f.open();
  assert.equal(await current.prepare("SELECT value FROM settings WHERE id='event'").first("value"), "keep-me");
  assert.equal(existsSync(`${f.filename}.restore.lock`), false);
});

test("restore rejects missing, altered or future migration ledgers before touching the existing database", async t => {
  const cases = [
    { name: "legacy D1 file without a ledger", sql: "DROP TABLE _tzai_migrations", error: /no _tzai_migrations ledger.*explicit import/ },
    { name: "changed applied migration", sql: "UPDATE _tzai_migrations SET sha256='incorrect-checksum' WHERE name=(SELECT MIN(name) FROM _tzai_migrations)", error: /checksum does not match/ },
    { name: "future application version", sql: "INSERT INTO _tzai_migrations VALUES ('9999_future.sql','future-hash','2027-01-01')", error: /unknown migration.*newer or different application version/ },
    { name: "empty ledger", sql: "DELETE FROM _tzai_migrations", error: /ledger is empty/ },
    { name: "missing baseline entry", sql: "DELETE FROM _tzai_migrations WHERE name=(SELECT MIN(name) FROM _tzai_migrations)", error: /ledger is incomplete or out of order/ },
    { name: "unsupported ledger schema", sql: "DROP TABLE _tzai_migrations; CREATE TABLE _tzai_migrations (name TEXT)", error: /ledger has an unsupported format/ },
  ];
  for (const item of cases) await t.test(item.name, async child => {
    const f = fixture(child), current = f.open();
    await current.prepare("INSERT INTO settings VALUES ('event','keep-current-event')").run();
    current.close();
    const original = readFileSync(f.filename);
    const incoming = f.open(path.join(f.directory, "incompatible.sqlite"));
    incoming.raw.exec(item.sql);
    incoming.close();
    await assert.rejects(restoreDatabase(incoming.filename, { filename: f.filename, migrationsDirectory, force: true, confirmStopped: true }), item.error);
    assert.deepEqual(readFileSync(f.filename), original, "rejected restore must not change the current database bytes");
    assert.equal(readdirSync(f.directory).some(name => name.includes("before-restore")), false);
    assert.equal(existsSync(`${f.filename}.restore.lock`), false);
  });
});

test("a verified older backup is migrated in staging before replacing the database", async t => {
  const f = fixture(t), current = f.open();
  current.close();
  const oldDirectory = path.join(f.directory, "old-migrations");
  mkdirSync(oldDirectory);
  const firstMigration = readdirSync(migrationsDirectory).filter(name => name.endsWith(".sql")).sort()[0];
  writeFileSync(path.join(oldDirectory, firstMigration), readFileSync(path.join(migrationsDirectory, firstMigration)));
  const older = f.open(path.join(f.directory, "older.sqlite"), { migrationsDirectory: oldDirectory });
  await older.prepare("INSERT INTO settings VALUES ('event','older-event-data')").run();
  older.close();
  const oldBytes = readFileSync(older.filename);
  await restoreDatabase(older.filename, { filename: f.filename, migrationsDirectory, force: true, confirmStopped: true });
  assert.deepEqual(readFileSync(older.filename), oldBytes, "the backup source remains unchanged");
  const restored = f.open();
  assert.equal(await restored.prepare("SELECT value FROM settings WHERE id='event'").first("value"), "older-event-data");
  assert.ok(restored.raw.prepare("SELECT COUNT(*) AS n FROM _tzai_migrations").get().n >= 2);
  assert.ok(restored.raw.prepare("SELECT name FROM sqlite_master WHERE name='auth_users'").get());
});

test("a pending migration failure during restore cannot replace the current database", async t => {
  const f = fixture(t), current = f.open();
  await current.prepare("INSERT INTO settings VALUES ('event','preserve-on-upgrade-failure')").run();
  const snapshot = path.join(f.directory, "valid-backup.sqlite");
  await backupDatabase(snapshot, { database: current });
  current.close();
  const original = readFileSync(f.filename);
  const futureDirectory = path.join(f.directory, "failing-upgrade");
  mkdirSync(futureDirectory);
  for (const name of readdirSync(migrationsDirectory).filter(name => name.endsWith(".sql"))) {
    writeFileSync(path.join(futureDirectory, name), readFileSync(path.join(migrationsDirectory, name)));
  }
  writeFileSync(path.join(futureDirectory, "9999_failed_upgrade.sql"), "CREATE TABLE temporary_table (id TEXT); INSERT INTO missing_table VALUES (1);");
  await assert.rejects(restoreDatabase(snapshot, { filename: f.filename, migrationsDirectory: futureDirectory, force: true, confirmStopped: true }), /no such table/);
  assert.deepEqual(readFileSync(f.filename), original);
  assert.equal(readdirSync(f.directory).some(name => name.includes("before-restore")), false);
  assert.equal(existsSync(`${f.filename}.restore.lock`), false);
});
