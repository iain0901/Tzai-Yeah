const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

// Actual API source, SQLite constraints and atomic D1-style batches; no production data/network.
function makeGame() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  for (const file of fs.readdirSync(path.join(__dirname, '../drizzle')).filter(x => x.endsWith('.sql')).sort()) sqlite.exec(fs.readFileSync(path.join(__dirname, '../drizzle', file), 'utf8'));
  let beforeBatch = null;
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
      if (beforeBatch) { const hook = beforeBatch; beforeBatch = null; hook(); }
      sqlite.exec('BEGIN');
      try {
        const out = statements.map(s => { const r = sqlite.prepare(s.sql).run(...s.values); return { success: true, meta: { changes: Number(r.changes) } }; });
        sqlite.exec('COMMIT'); return out;
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
    new Function('require', 'module', 'exports', compiled)(localRequire, module, module.exports);
    return module.exports;
  }
  const { handleApi } = load(path.join(__dirname, '../lib/server/api.ts'));
  function client() {
    let cookie = '';
    async function request(route, { body, origin = 'https://love.test', useCookie = true, protocol = 'https:' } = {}) {
      const headers = {};
      if (useCookie && cookie) headers.cookie = cookie;
      if (body !== undefined) {
        headers['content-type'] = 'application/json';
        if (origin) headers.origin = origin;
      }
      const response = await handleApi(new Request(`${protocol}//love.test${route}`, { method: body === undefined ? 'GET' : 'POST', headers, body: body === undefined ? undefined : JSON.stringify(body) }));
      const nextCookie = response.headers.get('set-cookie');
      if (nextCookie) cookie = nextCookie.split(';')[0];
      return { status: response.status, data: await response.json(), headers: response.headers };
    }
    return { request, action: body => request('/api/game', { body }), poll: code => request(`/api/game?room=${code}`), memory: token => request(`/api/game/memory?token=${token}`), cookie: () => cookie };
  }
  function card(id, serial, tokenChar, active = 1) {
    const token = tokenChar.repeat(48);
    sqlite.prepare('INSERT INTO cards(id,serial,token,active,created_at) VALUES (?,?,?,?,?)').run(id, serial, token, active, new Date().toISOString());
    return token;
  }
  function stored(code) { return JSON.parse(sqlite.prepare('SELECT value FROM settings WHERE id=?').get(`game_room:${code}`).value); }
  function change(code, mutate) { const room = stored(code); mutate(room); sqlite.prepare('UPDATE settings SET value=? WHERE id=?').run(JSON.stringify(room), `game_room:${code}`); }
  return { sqlite, client, card, stored, change, setBeforeBatch: fn => { beforeBatch = fn; } };
}

async function twoPlayers(game, tokens = []) {
  const a = game.client(), b = game.client();
  const created = await a.action({ action: 'create', token: tokens[0] });
  assert.equal(created.status, 200, JSON.stringify(created.data));
  const code = created.data.room.code;
  assert.equal((await b.action({ action: 'join', code, token: tokens[1] })).status, 200);
  assert.equal((await a.action({ action: 'start', code })).status, 200);
  return { a, b, code };
}
async function finish(a, b, code, from = 0) {
  for (let index = from; index < 24; index += 2) {
    const results = await Promise.all([a.action({ action: 'light', code, bulb: index }), b.action({ action: 'light', code, bulb: index + 1 })]);
    assert.ok(results.every(r => r.status === 200), JSON.stringify(results.map(r => r.data)));
  }
  return (await a.poll(code)).data.room;
}

test('guest rooms use private cookies; join, host controls, capacity and lobby leave', async () => {
  const game = makeGame();
  const a = game.client(), b = game.client();
  const created = await a.action({ action: 'create' });
  assert.equal(created.status, 200);
  const room = created.data.room;
  assert.match(room.code, /^[A-HJ-NP-Z2-9]{6}$/);
  assert.match(created.headers.get('set-cookie'), /HttpOnly/);
  assert.match(created.headers.get('set-cookie'), /SameSite=Lax/);
  assert.match(created.headers.get('set-cookie'), /Secure/);
  assert.equal(room.meId, room.hostId);
  assert.equal(room.members[0].label, '星光朋友1');
  assert.ok(!JSON.stringify(created.data).includes('sessionHash'));
  assert.ok(!JSON.stringify(created.data).includes(a.cookie().split('=')[1]));
  assert.equal((await b.poll(room.code)).status, 403);
  assert.equal((await a.action({ action: 'start', code: room.code })).data.code, 'need_more_players');
  const joined = await b.action({ action: 'join', code: room.code.toLowerCase() });
  assert.equal(joined.status, 200);
  assert.equal(joined.data.room.members[1].label, '星光朋友2');
  assert.equal((await b.action({ action: 'start', code: room.code })).status, 403);
  assert.equal((await b.action({ action: 'join', code: room.code })).data.room.members.length, 2);
  assert.equal((await b.poll(room.code)).data.room.meId, joined.data.room.meId);
  for (let i = 0; i < 4; i++) assert.equal((await game.client().action({ action: 'join', code: room.code })).status, 200);
  assert.equal((await game.client().action({ action: 'join', code: room.code })).data.code, 'room_full');
  const left = await a.action({ action: 'leave', code: room.code });
  assert.equal(left.data.room.meId, null);
  assert.equal(left.data.room.hostId, joined.data.room.meId);
  assert.equal((await a.poll(room.code)).status, 403);
  assert.equal((await b.action({ action: 'start', code: room.code })).status, 200);
  assert.equal((await b.action({ action: 'leave', code: room.code })).data.code, 'round_started');
  game.sqlite.close();
});

test('two sessions cooperate with CAS retries, idempotent lights, and per-card win memory', async () => {
  const game = makeGame();
  const tokenA = game.card('card-a', '001', 'a');
  const tokenB = game.card('card-b', '002', 'b');
  const { a, b, code } = await twoPlayers(game, [tokenA, tokenB]);
  const started = (await a.poll(code)).data.room;
  assert.equal(started.endsAt - started.startedAt, 60000);
  assert.deepEqual(started.members.map(m => m.label), ['卡片 #001', '卡片 #002']);
  assert.equal((await a.action({ action: 'light', code, bulb: 1 })).data.code, 'not_your_bulb');
  assert.equal((await a.action({ action: 'light', code, bulb: 2 })).data.code, 'out_of_order');
  assert.equal((await a.action({ action: 'light', code, bulb: 24 })).data.code, 'invalid_bulb');
  assert.equal((await b.action({ action: 'restart', code })).status, 403);
  const concurrent = await Promise.all([a.action({ action: 'light', code, bulb: 0 }), a.action({ action: 'light', code, bulb: 0 }), b.action({ action: 'light', code, bulb: 1 })]);
  assert.ok(concurrent.every(r => r.status === 200));
  const afterRace = (await a.poll(code)).data.room;
  assert.deepEqual(afterRace.lit, [0, 1]);
  assert.equal(afterRace.revision, started.revision + 2);
  const won = await finish(a, b, code, 2);
  assert.equal(won.status, 'won'); assert.equal(won.lit.length, 24);
  const replay = await Promise.all([b.action({ action: 'light', code, bulb: 23 }), a.poll(code), b.poll(code)]);
  assert.ok(replay.every(r => r.data.room.status === 'won'));
  assert.equal((await a.memory(tokenA)).data.wins, 1);
  assert.equal((await b.memory(tokenB)).data.wins, 1);
  assert.match((await a.memory(tokenA)).data.lastCompletedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(game.sqlite.prepare("SELECT COUNT(*) AS n FROM settings WHERE id LIKE 'game_win:%'").get().n, 2);
  assert.equal((await b.action({ action: 'restart', code })).status, 403);
  const restart = await a.action({ action: 'restart', code });
  assert.equal(restart.data.room.status, 'lobby'); assert.equal(restart.data.room.round, 2);
  assert.equal(restart.data.room.lit.length, 0);
  await a.action({ action: 'start', code });
  assert.equal((await finish(a, b, code)).status, 'won');
  assert.equal((await a.memory(tokenA)).data.wins, 2);
  const finishedLeave = await b.action({ action: 'leave', code });
  assert.equal(finishedLeave.status, 200);
  assert.equal(finishedLeave.data.room.meId, null);
  assert.equal(finishedLeave.data.room.members.length, 1);
  assert.equal((await b.memory(tokenB)).data.wins, 2);
  assert.equal((await a.action({ action: 'leave', code })).status, 200);
  assert.equal((await a.poll(code)).status, 410);
  game.sqlite.close();
});

test('expiry is server-authoritative; lost rounds do not create wins and expired rooms reject', async () => {
  const game = makeGame();
  const token = game.card('card-a', '001', 'a');
  const { a, b, code } = await twoPlayers(game, [token]);
  game.change(code, room => { room.endsAt = Date.now() - 1; });
  const expired = await b.poll(code);
  assert.equal(expired.data.room.status, 'lost');
  assert.equal((await a.memory(token)).data.wins, 0);
  assert.equal((await a.action({ action: 'light', code, bulb: 0 })).data.code, 'round_not_playing');
  assert.equal((await b.action({ action: 'leave', code })).status, 200);
  assert.equal((await a.action({ action: 'restart', code })).data.room.status, 'lobby');
  game.change(code, room => { room.expiresAt = Date.now() - 1; });
  assert.equal((await a.poll(code)).status, 410);
  assert.equal((await game.client().action({ action: 'join', code })).status, 410);
  game.sqlite.close();
});

test('creation cleans only expired game rows and keeps win records plus room-code tombstones', async () => {
  const game = makeGame();
  const a = game.client();
  const made = await a.action({ action: 'create' });
  const code = made.data.room.code;
  game.change(code, room => { room.expiresAt = Date.now() - 1; });
  const fixture = game.sqlite.prepare('INSERT INTO settings(id,value) VALUES (?,?)');
  fixture.run('game_rate:old-counter', JSON.stringify({ count: 5, expiresAt: 1 }));
  fixture.run('game_win:preserved:ABCDEF:1', JSON.stringify({ completedAt: '2026-11-21T12:00:00Z' }));
  fixture.run('event', JSON.stringify({ phase: 'before', expiresAt: 1 }));
  assert.equal((await a.action({ action: 'create' })).status, 200);
  const tombstone = game.stored(code);
  assert.deepEqual(Object.keys(tombstone).sort(), ['code', 'expired', 'expiresAt']);
  assert.equal(tombstone.code, code);
  assert.equal((await a.poll(code)).status, 410);
  assert.equal(game.sqlite.prepare("SELECT COUNT(*) AS n FROM settings WHERE id='game_rate:old-counter'").get().n, 0);
  assert.equal(game.sqlite.prepare("SELECT COUNT(*) AS n FROM settings WHERE id='game_win:preserved:ABCDEF:1'").get().n, 1);
  assert.equal(game.sqlite.prepare("SELECT COUNT(*) AS n FROM settings WHERE id='event'").get().n, 1);
  game.sqlite.close();
});

test('leave at the deadline removes the member while an expired light still returns lost', async () => {
  const game = makeGame();
  const { a, b, code } = await twoPlayers(game);
  game.change(code, room => { room.endsAt = Date.now() - 1; });
  const leave = await b.action({ action: 'leave', code });
  assert.equal(leave.status, 200);
  assert.equal(leave.data.room.status, 'lost');
  assert.equal(leave.data.room.meId, null);
  assert.equal(leave.data.room.members.length, 1);
  assert.equal((await b.poll(code)).status, 403);
  assert.equal((await a.poll(code)).data.room.status, 'lost');
  await a.action({ action: 'restart', code });
  await b.action({ action: 'join', code });
  await a.action({ action: 'start', code });
  game.change(code, room => { room.endsAt = Date.now() - 1; });
  const light = await a.action({ action: 'light', code, bulb: 0 });
  assert.equal(light.status, 200);
  assert.equal(light.data.room.status, 'lost');
  assert.deepEqual(light.data.room.lit, []);
  assert.equal(light.data.room.members.length, 2);
  game.sqlite.close();
});

test('a stale winning write cannot overwrite a newer state or create a false win record', async () => {
  const game = makeGame();
  const token = game.card('card-a', '001', 'a');
  const { a, b, code } = await twoPlayers(game, [token]);
  for (let index = 0; index < 23; index++) assert.equal((await (index % 2 ? b : a).action({ action: 'light', code, bulb: index })).status, 200);
  game.setBeforeBatch(() => game.change(code, room => { room.status = 'lost'; room.revision++; }));
  assert.equal((await b.action({ action: 'light', code, bulb: 23 })).status, 409);
  assert.equal(game.stored(code).status, 'lost');
  assert.equal(game.stored(code).lit.length, 23);
  assert.equal((await a.memory(token)).data.wins, 0);
  game.sqlite.close();
});

test('Origin, card validity, request bounds and session create limits are enforced', async () => {
  const game = makeGame();
  const valid = game.card('card-valid', '001', 'a');
  const inactive = game.card('card-inactive', '002', 'b', 0);
  const a = game.client();
  assert.equal((await a.request('/api/game', { body: { action: 'create' }, origin: 'https://other.test' })).status, 403);
  assert.equal((await a.request('/api/game', { body: { action: 'create' }, origin: null })).status, 403);
  assert.equal((await a.action({ action: 'create', token: inactive })).status, 410);
  assert.equal((await a.action({ action: 'create', token: 'bad' })).status, 404);
  assert.equal((await a.memory(inactive)).status, 410);
  assert.equal((await a.action({ action: 'create', extra: 'x'.repeat(2100) })).status, 413);
  const created = await a.action({ action: 'create', token: valid });
  assert.equal(created.data.room.meCardSerial, '001');
  assert.equal((await game.client().action({ action: 'join', code: created.data.room.code, token: inactive })).status, 410);
  for (let i = 0; i < 5; i++) assert.equal((await a.action({ action: 'create' })).status, 200);
  assert.equal((await a.action({ action: 'create' })).status, 429);
  game.sqlite.close();
});

test('same-card guests record one win per room round; session secrets never appear in public views', async () => {
  const game = makeGame();
  const token = game.card('shared-card', '001', 'a');
  const { a, b, code } = await twoPlayers(game, [token, token]);
  const room = await finish(a, b, code);
  assert.equal((await a.memory(token)).data.wins, 1);
  const publicJSON = JSON.stringify(room);
  const stored = game.stored(code);
  for (const m of stored.members) assert.ok(!publicJSON.includes(m.sessionHash));
  assert.ok(!publicJSON.includes(token));
  assert.ok(!publicJSON.includes('shared-card'));
  assert.ok(!publicJSON.includes(a.cookie().split('=')[1]));
  game.sqlite.close();
});
