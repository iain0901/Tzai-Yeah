const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

// Real route source and SQLite, with a controlled server clock and SQLite atomic batches.
function makeTree() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  for (const file of fs.readdirSync(path.join(__dirname, '../drizzle')).filter(x => x.endsWith('.sql')).sort()) sqlite.exec(fs.readFileSync(path.join(__dirname, '../drizzle', file), 'utf8'));
  let now = Date.parse('2026-11-21T08:00:00.000Z');
  let beforeWrite = null;
  class ServerDate extends Date {
    constructor(value) { super(arguments.length ? value : now); }
    static now() { return now; }
  }
  class Statement {
    constructor(sql, values = []) { this.sql = sql; this.values = values; }
    bind(...values) { return new Statement(this.sql, values); }
    async first() { return sqlite.prepare(this.sql).get(...this.values) || null; }
    async all() { return { results: sqlite.prepare(this.sql).all(...this.values), success: true }; }
    async run() { if (beforeWrite) beforeWrite(this.sql, this.values); const r = sqlite.prepare(this.sql).run(...this.values); return { success: true, meta: { changes: Number(r.changes) } }; }
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
    // Only the unit fixture accepts test headers. Production uses real signed session cookies.
    const localRequire = id => {
      if (id === './database') return { database: () => DB };
      if (id === './auth') return {
        publicOrigin: () => 'https://love.test',
        getSessionUser: request => {
          const user = request.headers.get('x-test-user-id');
          return user ? { id: user, email: user === 'admin' ? 'organizer@example.test' : user + '@example.test', name: user, role: user === 'admin' ? 'admin' : 'member' } : null;
        },
      };
      if (id.endsWith('.mjs')) return require(path.resolve(path.dirname(full), id));
      return id.startsWith('.') ? load(path.resolve(path.dirname(full), id + '.ts')) : require(id);
    };
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
  return { sqlite, client, card, helpers, advance: ms => { now += ms; }, beforeWrite: hook => { beforeWrite = hook; } };
}

function storeLegacy(app, key, values = {}) {
  const tree = { id: 'preserved-public-player', name: '原本的小樹', growth: 23, revision: 7, createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-11-20T00:00:00.000Z', credit: 4.5, creditAt: Date.parse('2026-11-21T08:00:00.000Z'), requests: [{ id: 'legacy-request', awarded: 3 }], ...values };
  const raw = JSON.stringify(tree);
  app.sqlite.prepare('INSERT INTO settings(id,value) VALUES (?,?)').run(key, raw);
  return { tree, raw };
}

test('public visitors can read ranks but cannot create or operate a guest tree', async () => {
  const app = makeTree(), visitor = app.client();
  const legacy = storeLegacy(app, 'tree_player:guest:legacy-cookie-hash', { growth: 9000 });
  const oldGuest = app.client(`tzai_tree_guest=${'a'.repeat(64)}`);
  for (const client of [visitor, oldGuest]) {
    const initial = await client.get();
    assert.equal(initial.status, 200);
    assert.equal(initial.data.player, null);
    assert.equal(initial.headers.get('set-cookie'), null);
    for (const body of [{ action: 'register', name: '訪客小樹' }, { action: 'rename', name: '訪客改名' }, { action: 'grow', count: 1, requestId: 'guest-must-not-grow' }]) {
      const rejected = await client.action(body);
      assert.equal(rejected.status, 403); assert.equal(rejected.data.code, 'card_required');
      assert.equal(rejected.headers.get('set-cookie'), null);
    }
    const board = (await client.leaderboard()).data;
    assert.equal(board.total, 0); assert.equal(board.player, null); assert.equal(board.myRank, null);
    assert.deepEqual(board.entries, []);
  }
  assert.equal(app.sqlite.prepare("SELECT value FROM settings WHERE id='tree_player:guest:legacy-cookie-hash'").get().value, legacy.raw);
  assert.equal(app.sqlite.prepare("SELECT COUNT(*) AS n FROM settings WHERE id GLOB 'tree_player:*'").get().n, 1);
  app.sqlite.close();
});

test('leaderboard reads never initialize players or guest cookies, even for a valid unplayed card', async () => {
  const app = makeTree(), token = app.card('unplayed-card', '006', 'a');
  const visitor = app.client(), oldGuest = app.client(`tzai_tree_guest=${'b'.repeat(64)}`);
  for (const response of [await visitor.leaderboard(), await oldGuest.leaderboard(), await visitor.leaderboard(1, token)]) {
    assert.equal(response.status, 200);
    assert.equal(response.data.player, null); assert.equal(response.data.myRank, null);
    assert.equal(response.data.total, 0); assert.deepEqual(response.data.entries, []);
    assert.equal(response.headers.get('set-cookie'), null);
  }
  assert.equal(app.sqlite.prepare("SELECT COUNT(*) AS n FROM settings WHERE id GLOB 'tree_player:*'").get().n, 0);
  app.sqlite.close();
});

test('first card visits initialize one shared tree with its serial as the editable default name', async () => {
  const app = makeTree(), token = app.card('private-card-id', '027', 'a');
  const clients = Array.from({ length: 12 }, () => app.client());
  const results = await Promise.all(clients.map(client => client.get(token)));
  assert.ok(results.every(result => result.status === 200));
  const first = results[0].data.player;
  assert.equal(first.name, '#027'); assert.equal(first.cardSerial, '027');
  assert.equal(first.growth, 0); assert.equal(first.heightCm, 30); assert.equal(first.level, 1);
  assert.ok(results.every(result => result.data.player.id === first.id));
  assert.ok(results.every(result => result.headers.get('set-cookie') === null));
  assert.equal(app.sqlite.prepare("SELECT COUNT(*) AS n FROM settings WHERE id GLOB 'tree_player:*'").get().n, 1);
  const renamed = await clients[1].action({ action: 'rename', name: '  🌲暖暖小樹  ', token });
  assert.equal(renamed.status, 200); assert.equal(renamed.data.player.name, '🌲暖暖小樹');
  assert.equal(renamed.data.player.id, first.id); assert.equal(renamed.data.player.cardSerial, '027');
  assert.equal(renamed.data.player.createdAt, first.createdAt);
  assert.equal((await clients[0].get(token)).data.player.name, '🌲暖暖小樹');
  assert.equal((await clients[0].action({ action: 'register', name: '不能覆寫', token })).data.player.name, '🌲暖暖小樹');
  const otherToken = app.card('another-private-card', '028', 'b');
  const other = (await clients[0].get(otherToken)).data.player;
  assert.notEqual(other.id, first.id); assert.equal(other.name, '#028');
  const board = (await clients[0].leaderboard(1, token)).data;
  const publicJSON = JSON.stringify(board);
  assert.ok(!publicJSON.includes(token)); assert.ok(!publicJSON.includes('private-card-id'));
  assert.ok(!publicJSON.includes('tree_player:')); assert.ok(!publicJSON.includes('creditAt'));
  assert.equal(board.player.cardSerial, '027');
  assert.equal(app.sqlite.prepare('SELECT COUNT(*) AS n FROM participants').get().n, 0);
  app.sqlite.close();
});

test('existing card identity, nickname, growth, timestamps and request history survive initialization', async () => {
  const app = makeTree(), token = app.card('legacy-card', '003', 'c'), a = app.client();
  const old = storeLegacy(app, 'tree_player:card:legacy-card', { growth: 321 });
  const loaded = (await a.get(token)).data.player;
  assert.equal(loaded.id, old.tree.id); assert.equal(loaded.name, old.tree.name);
  assert.equal(loaded.cardSerial, '003'); assert.equal(loaded.growth, 321); assert.equal(loaded.level, 6);
  assert.equal(loaded.revision, old.tree.revision); assert.equal(loaded.createdAt, old.tree.createdAt);
  assert.equal(app.sqlite.prepare("SELECT value FROM settings WHERE id='tree_player:card:legacy-card'").get().value, old.raw);
  const replay = await a.action({ action: 'grow', token, count: 3, requestId: 'legacy-request' });
  assert.equal(replay.data.awarded, 3); assert.equal(replay.data.player.growth, 321);
  assert.equal(app.sqlite.prepare("SELECT value FROM settings WHERE id='tree_player:card:legacy-card'").get().value, old.raw);
  await a.action({ action: 'rename', token, name: '改名仍是同一張卡' });
  const renamed = (await a.get(token)).data.player;
  assert.equal(renamed.id, loaded.id); assert.equal(renamed.cardSerial, '003'); assert.equal(renamed.growth, 321);
  const stored = JSON.parse(app.sqlite.prepare("SELECT value FROM settings WHERE id='tree_player:card:legacy-card'").get().value);
  assert.deepEqual(stored.requests, old.tree.requests); assert.equal(stored.credit, old.tree.credit);
  assert.equal(stored.createdAt, old.tree.createdAt);
  app.sqlite.close();
});

test('legacy register clients remain idempotent and new card registration can omit a nickname', async () => {
  const app = makeTree(), a = app.client();
  const namedToken = app.card('named-card', '004', 'd'), defaultToken = app.card('default-card', '005', 'e');
  const named = await a.action({ action: 'register', token: namedToken, name: '原版客戶端的暱稱' });
  assert.equal(named.status, 200); assert.equal(named.data.player.name, '原版客戶端的暱稱');
  const retry = await a.action({ action: 'register', token: namedToken, name: '重試不可改名' });
  assert.equal(retry.data.player.id, named.data.player.id); assert.equal(retry.data.player.name, named.data.player.name);
  assert.equal((await a.get(namedToken)).data.player.name, named.data.player.name);
  const plain = await a.action({ action: 'register', token: defaultToken });
  assert.equal(plain.status, 200); assert.equal(plain.data.player.name, '#005');
  assert.equal(plain.data.player.cardSerial, '005');
  app.sqlite.close();
});

test('authoritative growth uses a 9-credit bucket, refills at 3/sec, and remembers duplicate requests', async () => {
  const app = makeTree(), a = app.client(), token = app.card('speed-card', '001', 'a');
  await a.get(token);
  const action = body => a.action({ ...body, token });
  const first = await action({ action: 'grow', count: 12, requestId: 'grow-first-0001', growth: 999999 });
  assert.equal(first.data.awarded, 9); assert.equal(first.data.player.growth, 9); assert.equal(first.data.player.heightCm, 48);
  const duplicate = await action({ action: 'grow', count: 1, requestId: 'grow-first-0001' });
  assert.equal(duplicate.data.awarded, 9); assert.equal(duplicate.data.player.growth, 9);
  assert.equal(duplicate.data.player.revision, first.data.player.revision);
  const empty = await action({ action: 'grow', count: 3, requestId: 'grow-empty-0002' });
  assert.equal(empty.data.awarded, 0);
  app.advance(1000);
  const refill = await action({ action: 'grow', count: 12, requestId: 'grow-refill-0003' });
  assert.equal(refill.data.awarded, 3); assert.equal(refill.data.player.growth, 12); assert.equal(refill.data.player.level, 2);
  app.advance(300000);
  const capped = await action({ action: 'grow', count: 12, requestId: 'grow-capped-0004' });
  assert.equal(capped.data.awarded, 9);
  for (let i = 0; i < 36; i++) { app.advance(400); await action({ action: 'grow', count: 1, requestId: `remember-${String(i).padStart(4, '0')}` }); }
  const stored = JSON.parse(app.sqlite.prepare("SELECT value FROM settings WHERE id GLOB 'tree_player:*'").get().value);
  assert.equal(stored.requests.length, 32);
  assert.equal(app.helpers.formatTreeHeight(30), '30 cm'); assert.equal(app.helpers.formatTreeHeight(120), '1.20 m');
  assert.equal(app.helpers.treeLevel(300), 6);
  app.sqlite.close();
});

test('concurrent growth cannot exceed the shared card token bucket or lose accepted updates', async () => {
  const app = makeTree(), token = app.card('one-card', '001', 'a');
  const clients = Array.from({ length: 12 }, () => app.client());
  await clients[0].get(token);
  const results = await Promise.all(clients.map((client, i) => client.action({ action: 'grow', token, count: 12, requestId: `concurrent-${i}` })));
  assert.ok(results.every(r => r.status === 200), JSON.stringify(results.map(r => r.data)));
  assert.equal(results.reduce((total, result) => total + result.data.awarded, 0), 9);
  assert.equal((await clients[0].get(token)).data.player.growth, 9);
  app.advance(1000);
  const refill = await Promise.all(clients.map((client, i) => client.action({ action: 'grow', token, count: 1, requestId: `refill-race-${i}` })));
  assert.equal(refill.reduce((total, result) => total + result.data.awarded, 0), 3);
  assert.equal((await clients[0].get(token)).data.player.growth, 12);
  const duplicate = await clients[11].action({ action: 'grow', token, count: 12, requestId: 'concurrent-0' });
  assert.equal(duplicate.data.awarded, results[0].data.awarded); assert.equal(duplicate.data.player.growth, 12);
  app.sqlite.close();
});

test('active-card leaderboard is largest-first with stable ties and excludes legacy guests and disabled cards', async () => {
  const app = makeTree(), clients = [], tokens = [];
  storeLegacy(app, 'tree_player:guest:old-guest', { id: 'old-guest', growth: 9000 });
  storeLegacy(app, 'tree_player:card:missing-card', { id: 'orphan-tree', growth: 8000 });
  app.card('disabled-card', '099', 'f', 0);
  storeLegacy(app, 'tree_player:card:disabled-card', { id: 'disabled-tree', growth: 7000 });
  for (let i = 0; i < 12; i++) {
    const client = app.client(), token = app.card(`card-${i}`, String(i + 1).padStart(3, '0'), (i + 1).toString(16));
    clients.push(client); tokens.push(token);
    await client.action({ action: 'register', token, name: `小樹${String(i + 1).padStart(2, '0')}` });
    if (i % 10) await client.action({ action: 'grow', token, count: i % 10, requestId: `rank-growth-${i}` });
    app.advance(1);
  }
  const first = (await clients[0].leaderboard(1, tokens[0])).data;
  const second = (await clients[0].leaderboard(2, tokens[0])).data;
  const third = (await clients[0].leaderboard(3, tokens[0])).data;
  assert.equal(first.total, 12); assert.equal(first.pageSize, 5);
  assert.equal(first.entries.length, 5); assert.equal(second.entries.length, 5); assert.equal(third.entries.length, 2);
  const all = [...first.entries, ...second.entries, ...third.entries];
  assert.deepEqual(all.map(p => p.rank), Array.from({ length: 12 }, (_, i) => i + 1));
  assert.deepEqual(all.map(p => p.growth), [...all.map(p => p.growth)].sort((a, b) => b - a));
  assert.equal(first.entries[0].name, '小樹10'); assert.equal(first.entries[0].cardSerial, '010');
  assert.equal(first.myRank, first.player.rank); assert.equal(first.myRank, all.find(p => p.id === first.player.id).rank);
  const sameGrowth = all.filter(p => p.growth === 1);
  assert.equal(sameGrowth[0].name, '小樹02'); assert.equal(sameGrowth[1].name, '小樹12');
  const oldRank = (await clients[0].get(tokens[0])).data.player.rank;
  await clients[0].action({ action: 'rename', token: tokens[0], name: '重新命名不換排名' });
  assert.equal((await clients[0].get(tokens[0])).data.player.rank, oldRank);
  assert.deepEqual((await clients[0].leaderboard(4)).data.entries, []);
  assert.equal((await clients[0].leaderboard(4)).data.total, 12);
  const publicBoard = (await app.client().leaderboard()).data;
  assert.equal(publicBoard.myRank, null); assert.equal(publicBoard.player, null); assert.equal(publicBoard.total, 12);
  assert.equal(app.sqlite.prepare("SELECT COUNT(*) AS n FROM settings WHERE id GLOB 'tree_player:*'").get().n, 15);
  app.sqlite.close();
});

test('invalid, cross-origin and inactive-card requests are rejected without creating trees', async () => {
  const app = makeTree(), a = app.client();
  const inactive = app.card('inactive-card', '001', 'a', 0), token = app.card('valid-card', '002', 'b');
  assert.equal((await a.action({ action: 'grow', token, count: 1, requestId: 'not-registered' })).data.code, 'tree_not_registered');
  assert.equal((await a.action({ action: 'rename', token, name: '尚未建立小樹' })).data.code, 'tree_not_registered');
  for (const name of ['短', '樹'.repeat(17), '名字\n換行', '\u200d\u200d']) assert.equal((await a.action({ action: 'register', token, name })).status, 400);
  assert.equal((await a.request('/api/tree', { body: { action: 'register', token, name: '跨站攻擊' }, origin: 'https://other.test' })).status, 403);
  assert.equal((await a.request('/api/tree', { body: { action: 'register', token, name: '缺少來源' }, origin: null })).status, 403);
  assert.equal((await a.action({ action: 'register', name: '停用的小卡', token: inactive })).status, 410);
  assert.equal((await a.get(inactive)).status, 410); assert.equal((await a.leaderboard(1, inactive)).status, 410);
  for (const missing of ['bad-token', '002', 'valid-card', 'c'.repeat(48)]) {
    assert.equal((await a.get(missing)).status, 404);
    assert.equal((await a.action({ action: 'register', name: '未知的小卡', token: missing })).status, 404);
  }
  assert.equal(app.sqlite.prepare("SELECT COUNT(*) AS n FROM settings WHERE id GLOB 'tree_player:*'").get().n, 0);
  assert.equal((await a.get(token)).status, 200);
  for (const count of [0, 13, 1.5, '3']) assert.equal((await a.action({ action: 'grow', token, count, requestId: 'invalid-count' })).status, 400);
  assert.equal((await a.action({ action: 'grow', token, count: 1, requestId: 'bad' })).status, 400);
  assert.equal((await a.request('/api/tree/leaderboard?page=0')).status, 400);
  assert.equal((await a.request('/api/tree/leaderboard?page=1.5')).status, 400);
  assert.equal((await a.get(token)).data.player.growth, 0);
  app.sqlite.close();
});

test('a card disabled between read and compare-and-swap cannot rename or grow', async () => {
  for (const action of [{ action: 'rename', name: '不應存入的暱稱' }, { action: 'grow', count: 3, requestId: 'disabled-during-write' }]) {
    const app = makeTree(), token = app.card('race-card', '007', 'a'), a = app.client();
    await a.get(token);
    const previous = app.sqlite.prepare("SELECT value FROM settings WHERE id='tree_player:card:race-card'").get().value;
    let attempts = 0;
    app.beforeWrite(sql => {
      if (!sql.startsWith('UPDATE settings SET value=')) return;
      attempts++;
      app.sqlite.prepare("UPDATE cards SET active=0 WHERE id='race-card'").run();
    });
    const response = await a.action({ ...action, token });
    assert.equal(response.status, 410); assert.equal(response.data.code, 'card_inactive');
    assert.equal(attempts, 1);
    assert.equal(app.sqlite.prepare("SELECT value FROM settings WHERE id='tree_player:card:race-card'").get().value, previous);
    assert.equal((await a.leaderboard()).data.total, 0);
    app.sqlite.close();
  }
});
