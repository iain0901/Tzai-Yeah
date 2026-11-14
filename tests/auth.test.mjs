import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { getRawDatabase, closeDatabase } from '../lib/server/sqlite-runtime.mjs';
import { createLocalUser, getSessionSecret, getSessionUser, handleAuth, hashPassword, safeReturnPath, verifyPassword } from '../lib/server/auth-core.mjs';

const directory = mkdtempSync(path.join(os.tmpdir(), 'tzai-auth-'));
process.env.DATABASE_PATH = path.join(directory, 'event.sqlite');
process.env.SESSION_SECRET = randomBytes(32).toString('hex');
process.env.PUBLIC_ORIGIN = 'https://love.test';
process.env.TRUST_PROXY = 'false';
process.env.ALLOW_REGISTRATION = 'true';
const password = 'a warm Christmas password';
const require = createRequire(import.meta.url);
const ts = require('typescript');
const base = path.dirname(fileURLToPath(import.meta.url));
const modules = new Map();

// Transpile route TypeScript for Node while using the real SQLite/auth modules.
// No identity headers or permission mocks are used by these integration tests.
function load(file) {
  const full = path.resolve(file);
  if (modules.has(full)) return modules.get(full).exports;
  const loaded = { exports: {} }; modules.set(full, loaded);
  const source = ts.transpileModule(readFileSync(full, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const localRequire = id => id.startsWith('.') ? id.endsWith('.mjs') ? require(path.resolve(path.dirname(full), id)) : load(path.resolve(path.dirname(full), `${id}.ts`)) : require(id);
  new Function('require', 'module', 'exports', source)(localRequire, loaded, loaded.exports);
  return loaded.exports;
}
const { handleApi } = load(path.join(base, '../lib/server/api.ts'));
function request(route, body, cookie, extra = {}) {
  return new Request(`http://127.0.0.1:3000${route}`, { method: body === undefined ? 'GET' : 'POST', headers: { ...(body === undefined ? {} : { origin: 'https://love.test', 'content-type': 'application/json' }), ...(cookie ? { cookie } : {}), ...extra }, body: body === undefined ? undefined : JSON.stringify(body) });
}
async function auth(route, body, cookie, extra) { return handleAuth(request(`/api/auth/${route}`, body, cookie, extra)); }
function cookie(response) { return response.headers.get('set-cookie')?.split(';')[0]; }
async function login(email, extra = {}) { const response = await auth('login', { email, password, ...extra }); assert.equal(response.status, 200); return cookie(response); }
after(() => { closeDatabase(); rmSync(directory, { recursive: true, force: true }); });

test('salted scrypt hashes, password bounds, secret file and redirect validation', async () => {
  const a = await hashPassword(password), b = await hashPassword(password);
  assert.notEqual(a, b); assert.ok(!a.includes(password));
  assert.equal(await verifyPassword(password, a), true);
  assert.equal(await verifyPassword('wrong password', a), false);
  assert.equal(await verifyPassword(password, 'invalid'), false);
  await assert.rejects(hashPassword('short'), { status: 400 });
  await assert.rejects(hashPassword('x'.repeat(129)), { status: 400 });
  for (const value of ['https://evil.test', '//evil.test', '/\\evil.test', '/login', '/api/auth/logout', '/\n/evil.test']) assert.equal(safeReturnPath(value), '/');
  assert.equal(safeReturnPath('/t/abc?edit=1#profile'), '/t/abc?edit=1#profile');
  const secret = process.env.SESSION_SECRET;
  try {
    delete process.env.SESSION_SECRET;
    process.env.SESSION_SECRET_FILE = path.join(directory, 'missing-secret');
    assert.throws(getSessionSecret, { status: 503 });
    writeFileSync(process.env.SESSION_SECRET_FILE, 'not-a-valid-secret');
    assert.throws(getSessionSecret, { status: 503 });
    writeFileSync(process.env.SESSION_SECRET_FILE, secret);
    assert.equal(getSessionSecret(), secret);
  } finally { process.env.SESSION_SECRET = secret; delete process.env.SESSION_SECRET_FILE; }
});

test('real sessions enforce roles; forged gateway headers grant no access', async () => {
  await createLocalUser({ email: 'organizer@example.test', name: '主辦同學', password, role: 'admin' });
  const adminCookie = await login('ORGANIZER@example.test');
  const registered = await auth('register', { email: 'member@example.test', name: '小樹', password, role: 'admin', returnTo: '//evil.test' });
  assert.equal(registered.status, 200);
  const registration = await registered.json();
  assert.equal(registration.user.role, 'member'); assert.equal(registration.returnTo, '/');
  const memberCookie = cookie(registered);
  assert.match(registered.headers.get('set-cookie'), /HttpOnly; SameSite=Lax; Max-Age=604800; Secure$/);
  assert.match(memberCookie, /^tzai_session=[a-f0-9]{64}$/);
  const spoof = { 'oai-authenticated-user-id': 'admin', 'oai-authenticated-user-email': 'organizer@example.test', 'x-forwarded-user': 'organizer@example.test', 'x-auth-role': 'admin' };
  assert.equal(getSessionUser(request('/api/admin', undefined, undefined, spoof)), null);
  assert.equal((await handleApi(request('/api/admin', undefined, undefined, spoof))).status, 401);
  assert.equal((await handleApi(request('/api/admin/export', undefined, memberCookie, spoof))).status, 403);
  assert.equal((await handleApi(request('/api/admin/action', { action: 'generateCards' }, memberCookie, spoof))).status, 403);
  assert.equal((await handleApi(request('/api/event'))).status, 200);
  assert.equal((await handleApi(request('/api/admin', undefined, adminCookie))).status, 200);
  const sessionRows = getRawDatabase().prepare('SELECT token_hash FROM auth_sessions').all();
  assert.ok(sessionRows.every(row => ![adminCookie.split('=')[1], memberCookie.split('=')[1]].includes(row.token_hash)));
  assert.equal(getRawDatabase().prepare('SELECT count(*) AS n FROM participants WHERE owner_id IS NOT NULL').get().n, 0);
  getRawDatabase().prepare("UPDATE auth_users SET role='member' WHERE email='organizer@example.test'").run();
  assert.equal((await handleApi(request('/api/admin', undefined, adminCookie))).status, 403);
  getRawDatabase().prepare("UPDATE auth_users SET role='admin' WHERE email='organizer@example.test'").run();
  getRawDatabase().prepare("UPDATE auth_users SET enabled=0 WHERE email='member@example.test'").run();
  assert.equal(getSessionUser(request('/', undefined, memberCookie)), null);
  assert.equal((await auth('login', { email: 'member@example.test', password })).status, 401);
  getRawDatabase().prepare("UPDATE auth_users SET enabled=1 WHERE email='member@example.test'").run();
  closeDatabase();
  assert.equal(getSessionUser(request('/', undefined, adminCookie)).role, 'admin', 'sessions survive a database restart');
});

test('canonical origin protects writes behind proxy and card exports use public hostname', async () => {
  const adminCookie = await login('organizer@example.test');
  for (const headers of [{ origin: '' }, { origin: 'https://evil.test' }, { origin: 'http://127.0.0.1:3000' }, { 'sec-fetch-site': 'cross-site' }]) {
    assert.equal((await auth('logout', {}, adminCookie, headers)).status, 403);
    assert.equal((await handleApi(request('/api/admin/action', { action: 'generateCards' }, adminCookie, headers))).status, 403);
  }
  assert.equal((await auth('logout', {}, adminCookie, { 'content-type': 'text/plain' })).status, 415);
  assert.equal((await auth('logout', undefined, adminCookie)).status, 404);
  const generated = await handleApi(request('/api/admin/action', { action: 'generateCards', count: 1 }, adminCookie));
  assert.equal(generated.status, 200);
  const admin = await (await handleApi(request('/api/admin', undefined, adminCookie))).json();
  assert.ok(admin.cards.length > 0); assert.ok(admin.cards.every(card => card.url.startsWith('https://love.test/t/')));
  assert.equal((await auth('login', { email: 'organizer@example.test', password, returnTo: '/admin' })).status, 200, 'canonical origin works with loopback request URL');
});

test('logout, passive expiry and password reset invalidate persisted sessions', async () => {
  const memberCookie = await login('member@example.test');
  const logout = await auth('logout', {}, memberCookie);
  assert.equal(logout.status, 200); assert.match(logout.headers.get('set-cookie'), /Max-Age=0/);
  assert.equal(getSessionUser(request('/', undefined, memberCookie)), null);
  const expiringCookie = await login('member@example.test');
  getRawDatabase().prepare("UPDATE auth_sessions SET expires_at=0 WHERE user_id=(SELECT id FROM auth_users WHERE email='member@example.test')").run();
  assert.equal(getSessionUser(request('/', undefined, expiringCookie)), null);
  const firstCookie = await login('member@example.test'), secondCookie = await login('member@example.test');
  assert.equal((await auth('password', { currentPassword: 'wrong', password: 'another long password' }, firstCookie)).status, 401);
  const changed = await auth('password', { currentPassword: password, password: 'another long password' }, firstCookie);
  assert.equal(changed.status, 200);
  assert.equal(getSessionUser(request('/', undefined, firstCookie)), null); assert.equal(getSessionUser(request('/', undefined, secondCookie)), null);
  assert.equal(getSessionUser(request('/', undefined, cookie(changed))).email, 'member@example.test');
  assert.equal((await auth('login', { email: 'member@example.test', password })).status, 401);
  assert.equal((await auth('login', { email: 'member@example.test', password: 'another long password' })).status, 200);
});

test('registration closes without escalation and missing secret fails before account creation', async () => {
  process.env.ALLOW_REGISTRATION = 'false';
  assert.equal((await auth('session')).status, 200);
  assert.equal((await auth('register', { email: 'closed@example.test', name: 'Closed', password })).status, 403);
  process.env.ALLOW_REGISTRATION = 'true';
  const secret = process.env.SESSION_SECRET;
  try {
    delete process.env.SESSION_SECRET; process.env.SESSION_SECRET_FILE = path.join(directory, 'does-not-exist');
    assert.equal((await auth('register', { email: 'missing@example.test', name: 'Missing', password })).status, 503);
    assert.equal(getRawDatabase().prepare("SELECT count(*) AS n FROM auth_users WHERE email='missing@example.test'").get().n, 0);
  } finally { process.env.SESSION_SECRET = secret; delete process.env.SESSION_SECRET_FILE; }
});

test('login throttling persists and forged client IP headers cannot bypass it', async () => {
  for (let index = 0; index < 20; index++) {
    assert.equal((await auth('login', { email: 'missing-account@example.test', password }, undefined, { 'cf-connecting-ip': `203.0.113.${index}`, 'x-forwarded-for': `203.0.113.${index}` })).status, 401);
  }
  closeDatabase();
  assert.equal((await auth('login', { email: 'missing-account@example.test', password }, undefined, { 'cf-connecting-ip': '198.51.100.24' })).status, 429);
  assert.equal(getRawDatabase().prepare("SELECT count(DISTINCT substr(key,1,instr(substr(key,15),':')+13)) AS n FROM auth_limits WHERE key LIKE 'entry-network:%'").get().n, 1);
});
