import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

// Run after npm run build. Every request uses a disposable server and database.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (!existsSync(path.join(root, '.next/standalone/server.js'))) throw new Error('Run npm run build before the standalone HTTP checks.');
const directory = mkdtempSync(path.join(os.tmpdir(), 'tzai-http-'));
const port = await new Promise((resolve, reject) => { const server = net.createServer(); server.once('error', reject); server.listen(0, '127.0.0.1', () => { const number = server.address().port; server.close(() => resolve(number)); }); });
const base = `http://127.0.0.1:${port}`;
const password = randomBytes(24).toString('base64url');
const env = { ...process.env, PUBLIC_ORIGIN: base, PORT: String(port), HOSTNAME: '127.0.0.1', DATABASE_PATH: path.join(directory, 'event.sqlite'), SECRETS_DIR: path.join(directory, 'secrets'), SESSION_SECRET_FILE: path.join(directory, 'secrets', 'session-secret'), SESSION_SECRET: '', MIGRATIONS_DIR: path.join(root, 'drizzle'), ADMIN_EMAIL: 'http-admin@example.test', ADMIN_NAME: 'HTTP 管理員', ADMIN_PASSWORD: password, INIT_CARD_COUNT: '3', ALLOW_REGISTRATION: 'true', TRUST_PROXY: 'false', NFC_IMPORT_FILE: '', NEXT_TELEMETRY_DISABLED: '1' };
let server = null;
let exited = Promise.resolve();

async function start() {
  server = spawn(process.execPath, ['scripts/self-host/start.mjs'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, detached: process.platform !== 'win32' });
  // Drain logs without printing secrets, cookies or NFC URLs if a check fails.
  server.stdout.on('data', () => {}); server.stderr.on('data', () => {});
  let failure;
  server.on('error', error => { failure = error; });
  exited = new Promise(resolve => server.once('exit', resolve));
  for (let count = 0; count < 180; count++) {
    if (failure || server.exitCode !== null) throw new Error('Isolated standalone server could not start.');
    try { const result = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(1000) }); if (result.status === 200) return; } catch { /* Wait for Next to listen. */ }
    await delay(250);
  }
  throw new Error('Isolated standalone server did not become healthy within 45 seconds.');
}
async function stop() {
  if (!server) return;
  const owned = server;
  if (owned.exitCode === null) {
    if (process.platform === 'win32') {
      await new Promise(resolve => { const killer = spawn('taskkill.exe', ['/PID', String(owned.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }); killer.once('error', resolve); killer.once('exit', resolve); });
    } else {
      try { process.kill(-owned.pid, 'SIGTERM'); } catch { /* Already stopped. */ }
    }
    await Promise.race([exited, delay(5000)]);
    if (owned.exitCode === null && owned.signalCode === null) {
      if (process.platform === 'win32') owned.kill();
      else { try { process.kill(-owned.pid, 'SIGKILL'); } catch { /* Already stopped. */ } }
      await Promise.race([exited, delay(1000)]);
    }
  }
  server = null;
}
function client() {
  const jar = new Map();
  return {
    async request(route, body, headers = {}) {
      const response = await fetch(`${base}${route}`, { method: body === undefined ? 'GET' : 'POST', redirect: 'manual', signal: AbortSignal.timeout(10000), headers: { ...(body === undefined ? {} : { origin: base, 'content-type': 'application/json' }), cookie: [...jar].map(([name, value]) => `${name}=${value}`).join('; '), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
      for (const value of response.headers.getSetCookie()) {
        const pair = value.split(';')[0], separator = pair.indexOf('=');
        const key = pair.slice(0, separator), content = pair.slice(separator + 1);
        if (content) jar.set(key, content); else jar.delete(key);
      }
      const raw = await response.text();
      let data; try { data = JSON.parse(raw); } catch { data = raw; }
      return { status: response.status, data, headers: response.headers };
    },
  };
}
function status(response, expected, label) { assert.equal(response.status, expected, label); return response.data; }
function passed(label) { console.log(`PASS ${label}`); }

try {
  await start();
  const guest = client(), admin = client(), member = client(), stranger = client();
  const home = status(await guest.request('/'), 200, 'Public home renders without login');
  assert.ok(home.includes('載耶'));
  const loginPage = status(await guest.request('/login?return_to=%2Fadmin'), 200, 'Local login renders');
  assert.ok(loginPage.includes('A LITTLE PLACE FOR YOU'));
  const asset = loginPage.match(/(?:src|href)="(\/_next\/static\/[^"?]+(?:\?[^\"]*)?)"/);
  assert.ok(asset, 'Production HTML includes static assets');
  status(await guest.request(asset[1].replaceAll('&amp;', '&')), 200, 'Standalone static assets are packaged');
  status(await guest.request('/api/event'), 200, 'Public event API');
  status(await guest.request('/api/admin'), 401, 'Anonymous admin rejected');
  passed('Production public page, login page and static assets render without external login');

  const spoof = { 'oai-authenticated-user-id': 'admin', 'oai-authenticated-user-email': 'http-admin@example.test', 'x-forwarded-user': 'http-admin@example.test' };
  status(await guest.request('/api/admin', undefined, spoof), 401, 'Spoofed identity has no session');
  status(await admin.request('/api/auth/login', { email: 'http-admin@example.test', password, returnTo: '/admin' }), 200, 'Real admin login');
  const registered = status(await member.request('/api/auth/register', { email: 'http-member@example.test', name: '暖暖', password, role: 'admin', returnTo: '//evil.test' }), 200, 'Local member registration');
  assert.equal(registered.user.role, 'member'); assert.equal(registered.returnTo, '/');
  status(await member.request('/api/admin', undefined, spoof), 403, 'Member cannot become admin via headers');
  status(await member.request('/api/admin/export'), 403, 'Member cannot export private NFC links');
  status(await member.request('/api/admin/action', { action: 'generateCards' }), 403, 'Member cannot administer');
  status(await admin.request('/api/admin/action', { action: 'generateCards' }, { origin: 'https://evil.test' }), 403, 'Foreign origin rejected');
  status(await admin.request('/api/auth/logout', {}, { origin: '' }), 403, 'Auth requires origin');
  passed('Real password/cookie login, member roles, forged headers and CSRF boundaries');

  let data = status(await admin.request('/api/admin'), 200, 'Admin data');
  assert.equal(data.cards.length, 3);
  const initialTokens = data.cards.map(card => card.token);
  const card = data.cards[0];
  assert.equal(card.url, `${base}/t/${card.token}`);
  const action = async body => status(await admin.request('/api/admin/action', body), 200, `Admin ${body.action}`);
  await action({ action: 'saveGroup', id: 'http-warm-team', name: '暖光組', location: '教育館 A 區', note: 'HTTP test', color: '#c55b4f' });
  await action({ action: 'saveParticipant', name: 'HTTP 測試同學', house: '測試家', cardId: card.id, groupId: 'http-warm-team' });
  await action({ action: 'publishGroups' });
  assert.equal(status(await guest.request(`/api/event?token=${card.token}`), 200, 'Card before event').card.group, null);
  await action({ action: 'saveEvent', event: { phase: 'live', revealOpen: true } });
  assert.equal(status(await guest.request(`/api/event?token=${card.token}`), 200, 'Card live event').card.group.name, '暖光組');
  data = status(await admin.request('/api/admin'), 200, 'Bound card data');
  const participant = data.participants[0];
  assert.equal(status(await member.request(`/api/me?token=${card.token}`), 200, 'Member ownership before claim').isOwner, false);
  const claim = await action({ action: 'issueClaimCode', participantId: participant.id });
  status(await guest.request('/api/claim', { token: card.token, code: claim.code }), 401, 'Claim requires member login');
  status(await member.request('/api/claim', { token: card.token, code: claim.code }), 200, 'Private code claims card');
  const profile = { token: card.token, displayName: '暖暖的小卡', bio: '把冬天的回憶留起來', url: 'https://example.org/me', mode: 'page' };
  status(await member.request('/api/profile', profile), 200, 'Owner saves profile');
  status(await stranger.request('/api/auth/register', { email: 'stranger@example.test', name: '其他會員', password }), 200, 'Second member');
  status(await stranger.request('/api/profile', { ...profile, displayName: '錯誤的人' }), 403, 'Other member cannot change profile');
  status(await member.request('/api/profile', { ...profile, url: base }), 400, 'Self redirect is rejected');
  await action({ action: 'saveEvent', event: { phase: 'after' } });
  assert.equal(status(await guest.request(`/api/event?token=${card.token}`), 200, 'After-event profile').card.profile.displayName, profile.displayName);
  passed('Unique NFC URLs, binding, published groups, private claim code and owner-only profile editing');

  status(await guest.request('/api/tree', { action: 'register', token: card.token, name: '暖暖耶誕樹' }), 200, 'Card tree registration');
  const grown = status(await guest.request('/api/tree', { action: 'grow', token: card.token, count: 7, requestId: 'http-grow-once' }), 200, 'Tree growth');
  assert.equal(grown.player.growth, 7);
  const replay = status(await guest.request('/api/tree', { action: 'grow', token: card.token, count: 7, requestId: 'http-grow-once' }), 200, 'Tree replay');
  assert.equal(replay.player.growth, 7);
  const leaderboard = status(await guest.request(`/api/tree/leaderboard?token=${card.token}`), 200, 'Public leaderboard');
  assert.equal(leaderboard.entries[0].name, '暖暖耶誕樹'); assert.equal(leaderboard.myRank, 1);
  passed('Individual tree growth, replay protection and public leaderboard');

  await stop(); await start();
  data = status(await admin.request('/api/admin'), 200, 'Admin session persists across restart');
  assert.ok(data.cards.every((item, index) => item.token === initialTokens[index]), 'Restart preserves every NFC URL');
  assert.equal(data.participants[0].name, 'HTTP 測試同學');
  assert.equal(status(await member.request(`/api/me?token=${card.token}`), 200, 'Owner persists').isOwner, true);
  assert.equal(status(await guest.request(`/api/event?token=${card.token}`), 200, 'Profile persists').card.profile.displayName, profile.displayName);
  assert.equal(status(await guest.request(`/api/tree?token=${card.token}`), 200, 'Tree persists').player.growth, 7);
  assert.equal(status(await guest.request('/api/tree/leaderboard'), 200, 'Rank persists').entries[0].growth, 7);
  status(await member.request('/api/auth/logout', {}), 200, 'Member logout');
  assert.equal(status(await member.request('/api/auth/session'), 200, 'Logged out session').user, null);
  status(await member.request('/api/profile', profile), 401, 'Logout revokes profile access');
  status(await admin.request('/api/auth/logout', {}), 200, 'Admin logout');
  status(await admin.request('/api/admin'), 401, 'Logout revokes admin access');
  passed('Restart preserves cards, users, sessions, profiles and scores; logout revokes access');
} catch (error) {
  // Avoid accidental secret output in assertion diagnostics.
  console.error(String(error?.message || error).replace(/[A-Za-z0-9_-]{32,}/g, '[redacted]'));
  process.exitCode = 1;
} finally {
  await stop();
  rmSync(directory, { recursive: true, force: true });
}
