import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { parseCsv } from '../scripts/self-host/cards.mjs';
import { verifyPassword } from '../lib/server/auth-core.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scratch = path.join(root, 'work', 'self-host-tests');
mkdirSync(scratch, { recursive: true });

function fixture(t) {
  const directory = mkdtempSync(path.join(scratch, 'case-'));
  const filename = path.join(directory, 'data', 'event.sqlite');
  const secrets = path.join(directory, 'secrets');
  const env = { ...process.env };
  for (const name of ['SESSION_SECRET', 'SESSION_SECRET_FILE', 'ADMIN_PASSWORD', 'ADMIN_NAME', 'NFC_IMPORT_FILE', 'INIT_CARD_COUNT', 'TRUST_PROXY']) delete env[name];
  Object.assign(env, {
    DATABASE_PATH: filename,
    SECRETS_DIR: secrets,
    MIGRATIONS_DIR: path.join(root, 'drizzle'),
    PUBLIC_ORIGIN: 'https://christmas.example.test',
    ADMIN_EMAIL: 'host-admin@example.test',
  });
  t.after(() => {
    const resolved = path.resolve(directory);
    assert.ok(resolved.startsWith(`${path.resolve(scratch)}${path.sep}`));
    rmSync(resolved, { recursive: true, force: true });
  });
  return {
    directory, filename, secrets, env,
    run(script, args = [], overrides = {}) {
      const result = spawnSync(process.execPath, [path.join(root, 'scripts', 'self-host', script), ...args], {
        cwd: directory, env: { ...env, ...overrides }, encoding: 'utf8', timeout: 30000,
      });
      assert.equal(result.error, undefined, result.error?.message);
      return result;
    },
    query(sql) {
      const db = new DatabaseSync(filename, { readOnly: true });
      try { return db.prepare(sql).all().map(row => ({ ...row })); }
      finally { db.close(); }
    },
  };
}

function successful(result) {
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return `${result.stdout}\n${result.stderr}`;
}

function noLeaks(output, values) {
  for (const value of values) if (value) assert.equal(output.includes(value), false, 'CLI output must not include a private value');
}

test('first setup creates 150 unique cards, private secrets and a working administrator', async t => {
  const f = fixture(t);
  const output = successful(f.run('setup.mjs'));
  const cards = f.query('SELECT id,serial,token,active FROM cards ORDER BY CAST(serial AS INTEGER)');
  assert.equal(cards.length, 150);
  assert.equal(new Set(cards.map(card => card.token)).size, 150);
  assert.equal(cards[0].serial, '001');
  assert.equal(cards.at(-1).serial, '150');
  for (const card of cards) { assert.match(card.token, /^[a-f0-9]{48}$/); assert.equal(card.active, 1); }
  const secretFile = path.join(f.secrets, 'session-secret');
  const secret = readFileSync(secretFile, 'utf8').trim();
  assert.match(secret, /^[a-f0-9]{64}$/);
  const loginFile = path.join(f.secrets, 'admin-login.txt');
  const login = readFileSync(loginFile, 'utf8');
  assert.ok(login.includes(`${f.env.PUBLIC_ORIGIN}/admin`));
  const password = /^密碼：(.+)$/m.exec(login)?.[1];
  assert.ok(password && password.length >= 12);
  const users = f.query('SELECT id,email,password_hash,role,enabled FROM auth_users');
  assert.equal(users.length, 1);
  assert.equal(users[0].email, f.env.ADMIN_EMAIL);
  assert.equal(users[0].role, 'admin');
  assert.equal(users[0].enabled, 1);
  assert.notEqual(users[0].password_hash, password);
  assert.equal(await verifyPassword(password, users[0].password_hash), true);
  assert.equal(await verifyPassword('wrong-password-value', users[0].password_hash), false);
  assert.ok(f.query('SELECT name FROM _tzai_migrations').length >= 2);
  assert.ok(output.includes(f.env.PUBLIC_ORIGIN));
  noLeaks(output, [secret, password, users[0].password_hash, ...cards.map(card => card.token)]);
  if (process.platform !== 'win32') {
    for (const filename of [f.filename, secretFile, loginFile]) assert.equal(statSync(filename).mode & 0o777, 0o600);
    assert.equal(statSync(f.secrets).mode & 0o777, 0o700);
  }
});

test('running setup again preserves card URLs, secret, administrator and first-login record', t => {
  const f = fixture(t);
  successful(f.run('setup.mjs'));
  const beforeCards = f.query('SELECT * FROM cards ORDER BY serial');
  const beforeUsers = f.query('SELECT * FROM auth_users ORDER BY id');
  const beforeSecret = readFileSync(path.join(f.secrets, 'session-secret'), 'utf8');
  const beforeLogin = readFileSync(path.join(f.secrets, 'admin-login.txt'), 'utf8');
  const changedPassword = 'Do-not-reset-this-password-2026';
  const output = successful(f.run('setup.mjs', [], {
    ADMIN_PASSWORD: changedPassword,
    ADMIN_EMAIL: 'replacement@example.test',
    INIT_CARD_COUNT: '200',
  }));
  assert.deepEqual(f.query('SELECT * FROM cards ORDER BY serial'), beforeCards);
  assert.deepEqual(f.query('SELECT * FROM auth_users ORDER BY id'), beforeUsers);
  assert.equal(readFileSync(path.join(f.secrets, 'session-secret'), 'utf8'), beforeSecret);
  assert.equal(readFileSync(path.join(f.secrets, 'admin-login.txt'), 'utf8'), beforeLogin);
  assert.deepEqual(readdirSync(f.secrets).sort(), ['admin-login.txt', 'session-secret']);
  noLeaks(output, [changedPassword, beforeSecret.trim(), beforeUsers[0].password_hash, ...beforeCards.map(card => card.token)]);
});

test('CSV import preserves issued tokens and rolls back a conflict after an earlier insert', t => {
  const f = fixture(t), tokenOne = 'a'.repeat(48), tokenThree = 'c'.repeat(48);
  const imported = path.join(f.directory, 'issued-cards.csv');
  writeFileSync(imported, '\uFEFF"卡套流水號","NFC網址","啟用","姓名","家別"\r\n' +
    `"1","https://old.example.test/t/${tokenOne}","1","雪人,隊長 ""A""",""\r\n` +
    `"003","https://old.example.test/t/${tokenThree}","0","",""\r\n`);
  const output = successful(f.run('setup.mjs', [], { NFC_IMPORT_FILE: imported }));
  const cards = f.query('SELECT serial,token,active FROM cards ORDER BY serial');
  assert.deepEqual(cards, [
    { serial: '001', token: tokenOne, active: 1 },
    { serial: '003', token: tokenThree, active: 0 },
  ]);
  // Setup must not fill the remaining serials with new tokens when issued cards exist.
  assert.equal(cards.length, 2);
  noLeaks(output, [tokenOne, tokenThree]);
  successful(f.run('cards.mjs', ['import', imported]));
  assert.deepEqual(f.query('SELECT serial,token,active FROM cards ORDER BY serial'), cards);
  const conflict = path.join(f.directory, 'conflicting-cards.csv');
  const tokenTwo = 'b'.repeat(48), replacement = 'd'.repeat(48);
  writeFileSync(conflict, `serial,token,active\n002,${tokenTwo},1\n001,${replacement},1\n`);
  const rejected = f.run('cards.mjs', ['import', conflict]);
  assert.equal(rejected.status, 1);
  assert.ok(rejected.stderr.includes('001'));
  assert.deepEqual(f.query('SELECT serial,token,active FROM cards ORDER BY serial'), cards);
  noLeaks(`${rejected.stdout}\n${rejected.stderr}`, [tokenOne, tokenTwo, tokenThree, replacement]);
});

test('NFC export uses PUBLIC_ORIGIN and writes private links to its CSV, never the console', t => {
  const f = fixture(t);
  successful(f.run('setup.mjs', [], { INIT_CARD_COUNT: '3' }));
  const cards = f.query('SELECT serial,token,active FROM cards ORDER BY serial');
  const secret = readFileSync(path.join(f.secrets, 'session-secret'), 'utf8').trim();
  const login = readFileSync(path.join(f.secrets, 'admin-login.txt'), 'utf8');
  const password = /^密碼：(.+)$/m.exec(login)?.[1];
  const origin = 'https://nfc.example.test';
  const filename = path.join(f.directory, 'export', 'cards.csv');
  const output = successful(f.run('cards.mjs', ['export', filename], { PUBLIC_ORIGIN: origin }));
  assert.ok(existsSync(filename));
  const contents = readFileSync(filename, 'utf8');
  assert.equal(contents[0], '\uFEFF');
  const rows = parseCsv(contents);
  assert.deepEqual(rows[0], ['卡套流水號', 'NFC網址', '啟用', '姓名', '家別']);
  assert.equal(rows.length, 4);
  for (let i = 0; i < cards.length; i++) assert.deepEqual(rows[i + 1], [cards[i].serial, `${origin}/t/${cards[i].token}`, '1', '', '']);
  noLeaks(output, [secret, password, ...cards.map(card => card.token)]);
  noLeaks(contents, [secret, password]);
  assert.ok(output.includes(filename));
  if (process.platform !== 'win32') assert.equal(statSync(filename).mode & 0o777, 0o600);
});
