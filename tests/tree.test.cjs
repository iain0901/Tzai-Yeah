const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

// Real route source and SQLite, with a controlled server clock and D1-style atomic batches.
function makeTree() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  for (const file of fs.readdirSync(path.join(__dirname, '../drizzle')).filter(x => x.endsWith('.sql')).sort()) sqlite.exec(fs.readFileSync(path.join(__dirname, '../drizzle', file), 'utf8'));
  let now = Date.parse('2026-11-21T08:00:00.000Z');
  class ServerDate extends Date {
    constructor(value) { super(arguments.length ? value : now); }
    static now() { return now; }
  }
  class Statement {
    constructor(sql, values = []) { this.sql = sql; this.values = values; }
    bind(...values) { return new Statement(this.sql, values); }
    async first() { return sqlite.prepare(this.sql).get(...this.values) || null; }
    async all() { return { results: sqlite.prepare(this.sql).all(...this.values), success: true }; }
    async run() { const r = sqlite.prepare(this.sql).run(...this.values); return { success: true, meta: { changes: Number(r.changes) } }; }
  }
  const DB = {
    prepare: sql => new Statement(sql),
    async batch(statements) {
      sqlite.exec('BEGIN');
      try {
        const results = statements.map(s => {
          const statement = sqlite.prepare(s.sql);
          if (statement.columns().length) return { success: true, results: statement.all(...s.values), meta: { changes: 0 } };
          const r = statement.run(...s.values); return { success: true, results: [], meta: { changes: Number(r.changes) } };
        });
        sqlite.exec('COMMIT'); return results;
      } catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    },
  };
  const cache = new Map();
  function load(file) {
    const full = path.resolve(file);
    if (cache.has(full)) return cache.get(full).exports;
    const module = { exports: {} }; cache.set(full, module);
    const compiled = ts.transpileModule(fs.readFileSync(full, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
    const localRequire = id => id === 'cloudflare:workers' ? { env: { DB, ADMIN_EMAILS: 'organizer@example.test' } } : id.startsWith('.') ? load(path.resolve(path.dirname(full), `${id}.ts`)) : require(id);
    new Function('require', 'module', 'exports', 'Date', compiled)(localRequire, module, module.exports, ServerDate);
    return module.exports;
  }
  const { handleApi } = load(path.join(__dirname, '../lib/server/api.ts'));
  const helpers = load(path.join(__dirname, '../lib/tree-contracts.ts'));
  function client(initialCookie = '') {
    let cookie = initialCookie;
    async function request(route, { body, origin = 'https://love.test' } = {}) {
      const headers = {};
      if (cookie) headers.cookie = cookie;
      if (body !== undefined) { headers['content-type'] = 'application/json'; if (origin) headers.origin = origin; }
      const response = await handleApi(new Request(`https://love.test${route}`, { method: body === undefined ? 'GET' : 'POST', headers, body: body === undefined ? undefined : JSON.stringify(body) }));
      const nextCookie = response.headers.get('set-cookie');
      if (nextCookie) cookie = nextCookie.split(';')[0];
      return { status: response.status, data: await response.json(), headers: response.headers };
    }
    return {
      request, action: body => request('/api/tree', { body }),
      get: token => request(`/api/tree${token ? `?token=${token}` : ''}`),
      leaderboard: (page = 1, token) => request(`/api/tree/leaderboard?page=${page}${token ? `&token=${token}` : ''}`),
      cookie: () => cookie,
    };
  }
  function card(id, serial, tokenChar, active = 1) {
    const token = tokenChar.repeat(48);
    sqlite.prepare('INSERT INTO cards(id,serial,token,active,created_at) VALUES (?,?,?,?,?)').run(id, serial, token, active, new ServerDate().toISOString());
    return token;
  }
  return { sqlite, client, card, helpers, advance: ms => { now += ms; } };
}

test('guest registration persists by private cookie, nickname edits and identities stay separate', async () => {
  const app = makeTree(), a = app.client(), b = app.client();
  const initial = await a.get();
  assert.equal(initial.data.player, null);
  assert.match(initial.headers.get('set-cookie'), /HttpOnly/);
  const initialCookie = a.cookie();
  const made = await a.action({ action: 'register', name: '  暖暖小樹  ' });
  assert.equal(made.status, 200);
  assert.equal(made.data.player.name, '暖暖小樹');
  assert.equal(made.data.player.growth, 0);
  assert.equal(made.data.player.heightCm, 30);
  assert.equal(made.data.player.level, 1);
  assert.match(made.headers.get('set-cookie'), /HttpOnly/);
  assert.match(made.headers.get('set-cookie'), /SameSite=Lax/);
  assert.match(made.headers.get('set-cookie'), /Secure/);
  assert.match(made.headers.get('set-cookie'), /Max-Age=31536000/);
  const restored = app.client(a.cookie());
  assert.equal((await restored.get()).data.player.id, made.data.player.id);
  assert.equal((await a.action({ action: 'register', name: '不應覆寫' })).data.player.name, '暖暖小樹');
  // A separate client retaining only the pre-registration cookie models a lost POST response.
  const retryAfterLostResponse = app.client(initialCookie);
  assert.equal((await retryAfterLostResponse.action({ action: 'register', name: '重送也同一棵' })).data.player.id, made.data.player.id);
  assert.equal(app.sqlite.prepare("SELECT COUNT(*) AS n FROM settings WHERE id GLOB 'tree_player:*'").get().n, 1);
  const renamed = await restored.action({ action: 'rename', name: '🌲✨' });
  assert.equal(renamed.data.player.name, '🌲✨');
  assert.equal(renamed.data.player.createdAt, made.data.player.createdAt);
  assert.equal((await a.get()).data.player.name, '🌲✨');
  assert.equal((await b.get()).data.player, null);
  const second = await b.action({ action: 'register', name: '另一棵小樹' });
  assert.notEqual(second.data.player.id, made.data.player.id);
  const publicJSON = JSON.stringify((await a.leaderboard()).data);
  assert.ok(!publicJSON.includes(a.cookie().split('=')[1]));
  assert.ok(!publicJSON.includes('tree_player:'));
  assert.ok(!publicJSON.includes('creditAt'));
  app.sqlite.close();
});

test('one active NFC card has one cross-browser tree, without borrowing guest or profile identity', async () => {
  const app = makeTree(), a = app.client(), b = app.client();
  const token = app.card('private-card-id', '001', 'a');
  await a.action({ action: 'register', name: '訪客的小樹' });
  const guestId = (await a.get()).data.player.id;
  const results = await Promise.all([
    a.action({ action: 'register', name: '卡片小樹', token }),
    b.action({ action: 'register', name: '同卡另一瀏覽器', token }),
  ]);
  assert.ok(results.every(r => r.status === 200));
  assert.equal(results[0].data.player.id, results[1].data.player.id);
  assert.notEqual(results[0].data.player.id, guestId);
  assert.equal((await b.get(token)).data.player.id, results[0].data.player.id);
  const renamed = await b.action({ action: 'rename', name: '跨手機同一棵', token });
  assert.equal((await a.get(token)).data.player.name, renamed.data.player.name);
  assert.equal((await a.get()).data.player.name, '訪客的小樹');
  const publicJSON = JSON.stringify((await a.leaderboard(1, token)).data);
  assert.ok(!publicJSON.includes(token)); assert.ok(!publicJSON.includes('private-card-id'));
  assert.equal(app.sqlite.prepare('SELECT COUNT(*) AS n FROM participants').get().n, 0);
  assert.equal(app.sqlite.prepare('SELECT COUNT(*) AS n FROM cards').get().n, 1);
  app.sqlite.close();
});

test('authoritative growth uses a 9-credit bucket, refills at 3/sec, and remembers duplicate requests', async () => {
  const app = makeTree(), a = app.client();
  await a.action({ action: 'register', name: '速度測試小樹' });
  const first = await a.action({ action: 'grow', count: 12, requestId: 'grow-first-0001', growth: 999999 });
  assert.equal(first.data.awarded, 9); assert.equal(first.data.player.growth, 9); assert.equal(first.data.player.heightCm, 48);
  const duplicate = await a.action({ action: 'grow', count: 1, requestId: 'grow-first-0001' });
  assert.equal(duplicate.data.awarded, 9); assert.equal(duplicate.data.player.growth, 9);
  assert.equal(duplicate.data.player.revision, first.data.player.revision);
  const empty = await a.action({ action: 'grow', count: 3, requestId: 'grow-empty-0002' });
  assert.equal(empty.data.awarded, 0);
  app.advance(1000);
  const refill = await a.action({ action: 'grow', count: 12, requestId: 'grow-refill-0003' });
  assert.equal(refill.data.awarded, 3); assert.equal(refill.data.player.growth, 12); assert.equal(refill.data.player.level, 2);
  app.advance(300000);
  const capped = await a.action({ action: 'grow', count: 12, requestId: 'grow-capped-0004' });
  assert.equal(capped.data.awarded, 9);
  for (let i = 0; i < 36; i++) { app.advance(400); await a.action({ action: 'grow', count: 1, requestId: `remember-${String(i).padStart(4, '0')}` }); }
  const stored = JSON.parse(app.sqlite.prepare("SELECT value FROM settings WHERE id GLOB 'tree_player:*'").get().value);
  assert.equal(stored.requests.length, 32);
  assert.equal(app.helpers.formatTreeHeight(30), '30 cm');
  assert.equal(app.helpers.formatTreeHeight(120), '1.20 m');
  assert.equal(app.helpers.treeLevel(300), 6);
  app.sqlite.close();
});

test('concurrent growth cannot exceed the shared card token bucket or lose accepted updates', async () => {
  const app = makeTree(), token = app.card('one-card', '001', 'a');
  const clients = Array.from({ length: 12 }, () => app.client());
  await clients[0].action({ action: 'register', name: '一起搖也有限速', token });
  const results = await Promise.all(clients.map((client, i) => client.action({ action: 'grow', token, count: 12, requestId: `concurrent-${i}` })));
  assert.ok(results.every(r => r.status === 200), JSON.stringify(results.map(r => r.data)));
  assert.equal(results.reduce((total, result) => total + result.data.awarded, 0), 9);
  assert.equal((await clients[0].get(token)).data.player.growth, 9);
  app.advance(1000);
  const refill = await Promise.all(clients.map((client, i) => client.action({ action: 'grow', token, count: 1, requestId: `refill-race-${i}` })));
  assert.equal(refill.reduce((total, result) => total + result.data.awarded, 0), 3);
  assert.equal((await clients[0].get(token)).data.player.growth, 12);
  const duplicate = await clients[11].action({ action: 'grow', token, count: 12, requestId: 'concurrent-0' });
  assert.equal(duplicate.data.awarded, results[0].data.awarded);
  assert.equal(duplicate.data.player.growth, 12);
  app.sqlite.close();
});

test('leaderboard is largest-first with stable ties, five-row pages and consistent personal rank', async () => {
  const app = makeTree();
  const clients = [];
  for (let i = 0; i < 12; i++) {
    const client = app.client(); clients.push(client);
    await client.action({ action: 'register', name: `小樹${String(i + 1).padStart(2, '0')}` });
    if (i % 10) await client.action({ action: 'grow', count: i % 10, requestId: `rank-growth-${i}` });
    app.advance(1);
  }
  const first = (await clients[0].leaderboard(1)).data;
  const second = (await clients[0].leaderboard(2)).data;
  const third = (await clients[0].leaderboard(3)).data;
  assert.equal(first.total, 12); assert.equal(first.pageSize, 5);
  assert.equal(first.entries.length, 5); assert.equal(second.entries.length, 5); assert.equal(third.entries.length, 2);
  const all = [...first.entries, ...second.entries, ...third.entries];
  assert.deepEqual(all.map(p => p.rank), Array.from({ length: 12 }, (_, i) => i + 1));
  assert.deepEqual(all.map(p => p.growth), [...all.map(p => p.growth)].sort((a, b) => b - a));
  assert.equal(first.entries[0].name, '小樹10');
  assert.equal(first.myRank, first.player.rank);
  assert.equal(first.myRank, all.find(p => p.id === first.player.id).rank);
  const sameGrowth = all.filter(p => p.growth === 1);
  assert.equal(sameGrowth[0].name, '小樹02'); assert.equal(sameGrowth[1].name, '小樹12');
  const oldRank = (await clients[0].get()).data.player.rank;
  await clients[0].action({ action: 'rename', name: '重新命名不換排名' });
  assert.equal((await clients[0].get()).data.player.rank, oldRank);
  assert.deepEqual((await clients[0].leaderboard(4)).data.entries, []);
  assert.equal((await clients[0].leaderboard(4)).data.total, 12);
  assert.equal((await app.client().leaderboard()).data.myRank, null);
  app.sqlite.close();
});

test('unregistered, invalid, cross-origin and inactive-card requests are rejected without side effects', async () => {
  const app = makeTree(), a = app.client();
  const inactive = app.card('inactive-card', '001', 'a', 0);
  assert.equal((await a.action({ action: 'grow', count: 1, requestId: 'not-registered' })).data.code, 'tree_not_registered');
  assert.equal((await a.action({ action: 'rename', name: '未註冊小樹' })).data.code, 'tree_not_registered');
  for (const name of ['短', '樹'.repeat(17), '名字\n換行', '\u200d\u200d']) assert.equal((await a.action({ action: 'register', name })).status, 400);
  assert.equal((await a.request('/api/tree', { body: { action: 'register', name: '跨站攻擊' }, origin: 'https://other.test' })).status, 403);
  assert.equal((await a.request('/api/tree', { body: { action: 'register', name: '缺少來源' }, origin: null })).status, 403);
  assert.equal((await a.action({ action: 'register', name: '停用的小卡', token: inactive })).status, 410);
  assert.equal((await a.get(inactive)).status, 410);
  assert.equal((await a.leaderboard(1, inactive)).status, 410);
  assert.equal((await a.action({ action: 'register', name: '未知的小卡', token: 'bad-token' })).status, 404);
  assert.equal(app.sqlite.prepare("SELECT COUNT(*) AS n FROM settings WHERE id GLOB 'tree_player:*'").get().n, 0);
  assert.equal((await a.action({ action: 'register', name: '樹'.repeat(16) })).status, 200);
  for (const count of [0, 13, 1.5, '3']) assert.equal((await a.action({ action: 'grow', count, requestId: 'invalid-count' })).status, 400);
  assert.equal((await a.action({ action: 'grow', count: 1, requestId: 'bad' })).status, 400);
  assert.equal((await a.request('/api/tree/leaderboard?page=0')).status, 400);
  assert.equal((await a.request('/api/tree/leaderboard?page=1.5')).status, 400);
  assert.equal((await a.get()).data.player.growth, 0);
  app.sqlite.close();
});
