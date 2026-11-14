const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

// Exercise the actual route implementation against SQLite with the transactional batch contract.
// This does not replace final production HTTP/mobile checks.
function makeApp() {
  const sqlite = new DatabaseSync(':memory:');
  let beforeBatch = null;
  sqlite.exec('PRAGMA foreign_keys=ON');
  const migrations = fs.readdirSync(path.join(__dirname, '../drizzle')).filter(x => x.endsWith('.sql')).sort();
  for (const file of migrations) sqlite.exec(fs.readFileSync(path.join(__dirname, '../drizzle', file), 'utf8'));
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
      try { const out = []; for (const statement of statements) out.push(await statement.run()); sqlite.exec('COMMIT'); return out; }
      catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    },
  };
  const cache = new Map();
  function load(file) {
    const full = path.resolve(file);
    if (cache.has(full)) return cache.get(full).exports;
    const module = { exports: {} }; cache.set(full, module);
    const source = ts.transpileModule(fs.readFileSync(full, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
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
    new Function('require', 'module', 'exports', source)(localRequire, module, module.exports);
    return module.exports;
  }
  const { handleApi } = load(path.join(__dirname, '../lib/server/api.ts'));
  async function req(route, { method = 'GET', body, user = 'admin', origin = true } = {}) {
    const headers = {};
    if (user) {
      headers['x-test-user-id'] = user;
      headers['x-test-user-email'] = user === 'admin' ? 'organizer@example.test' : `${user}@example.test`;
    }
    if (method === 'POST') { headers['content-type'] = 'application/json'; if (origin) headers.origin = 'https://love.test'; }
    const response = await handleApi(new Request(`https://love.test${route}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }));
    const text = await response.text();
    let data; try { data = JSON.parse(text); } catch { data = text; }
    return { status: response.status, data, headers: response.headers };
  }
  const action = (body, opts = {}) => req('/api/admin/action', { method: 'POST', body, ...opts });
  return { req, action, sqlite, setBeforeBatch: hook => { beforeBatch = hook; } };
}

test('household numbers are local, validated, atomic and preserve legacy edits', async () => {
  const { req, action, sqlite } = makeApp();
  assert.equal((await action({ action: 'saveParticipant', name: '同名', house: '甲', householdNumber: 1 })).status, 200);
  assert.equal((await action({ action: 'saveParticipant', name: '同名', house: '乙', householdNumber: 1 })).status, 200);
  assert.equal((await action({ action: 'saveParticipant', name: '同名', house: '甲', householdNumber: 1 })).status, 409);
  assert.equal((await action({ action: 'saveParticipant', name: '甲', house: '甲', householdNumber: 0 })).status, 400);
  assert.equal((await action({ action: 'saveParticipant', name: '甲', householdNumber: 1 })).status, 400);
  let people = (await req('/api/admin')).data.participants;
  const first = people.find(p => p.house === '甲');
  assert.equal((await action({ action: 'saveParticipant', id: first.id, name: '改名', house: '甲' })).status, 200);
  assert.equal((await req('/api/admin')).data.participants.find(p => p.id === first.id).householdNumber, 1);
  assert.equal((await action({ action: 'importParticipants', rows: [{ name: '甲', house: '甲', householdNumber: 2 }, { name: '乙', house: '甲', householdNumber: 1 }] })).status, 409);
  people = (await req('/api/admin')).data.participants;
  assert.equal(people.length, 2);
  assert.match((await req('/api/admin/export?kind=participants')).data, /家內編號/);
  sqlite.close();
});

test('anonymous access, admin boundaries, CSRF and validation', async () => {
  const { req, action, sqlite } = makeApp();
  const publicData = await req('/api/event', { user: null });
  assert.equal(publicData.status, 200); assert.equal(publicData.data.event.phase, 'before'); assert.equal(publicData.data.card, null);
  assert.equal(publicData.headers.get('cache-control'), 'no-store, max-age=0');
  assert.equal((await req('/api/admin', { user: null })).status, 401);
  assert.equal((await req('/api/admin/export', { user: null })).status, 401);
  assert.equal((await req('/api/admin', { user: 'visitor' })).status, 403);
  assert.equal((await action({ action: 'generateCards' }, { origin: false })).status, 403);
  assert.equal((await action({ action: 'saveEvent', event: { date: '2026-02-30' } })).status, 400);
  assert.equal((await action({ action: 'saveEvent', event: { doors: '18:00' } })).status, 400);
  assert.equal((await action({ action: 'saveEvent', event: { videoUrl: 'https://evil.test/watch?v=abcdefghijk' } })).status, 400);
  assert.equal((await action({ action: 'saveEvent', event: { videoUrl: 'https://youtube.com/shorts/abcdefghijk' } })).status, 200);
  assert.equal((await req('/api/event')).data.event.videoUrl, 'https://www.youtube.com/watch?v=abcdefghijk');
  sqlite.close();
});

test('150 cards, transactional binding/import, publication isolation and explicit check-in', async () => {
  const { req, action, sqlite } = makeApp();
  assert.equal((await action({ action: 'generateCards' })).data.count, 150);
  let admin = (await req('/api/admin')).data;
  assert.equal(admin.cards.length, 150); assert.equal(new Set(admin.cards.map(c => c.token)).size, 150);
  assert.ok(admin.cards.every(c => /^[a-f0-9]{48}$/.test(c.token)));
  const tokens = admin.cards.map(c => c.token);
  assert.equal((await action({ action: 'generateCards', count: 150 })).data.count, 0);
  assert.deepEqual((await req('/api/admin')).data.cards.map(c => c.token), tokens);
  await action({ action: 'saveGroup', id: 'red', name: '紅色拼圖', location: 'A 區', color: '#c55b4f' });
  await action({ action: 'saveGroup', id: 'green', name: '綠色拼圖', location: 'B 區' });
  const badImport = await action({ action: 'importParticipants', rows: [{ name: '有效', groupId: 'red', cardSerial: '001' }, { name: '無效', groupId: 'absent' }] });
  assert.equal(badImport.status, 400); assert.equal((await req('/api/admin')).data.participants.length, 0);
  const rows = [{ name: '=HYPERLINK("https://evil.test")', house: '第一家', groupId: 'red', cardSerial: '001' }, { name: '林同學', house: '第二家', groupId: 'green', cardSerial: '002' }];
  assert.equal((await action({ action: 'importParticipants', rows })).data.count, 2);
  assert.equal((await action({ action: 'importParticipants', rows })).data.count, 0);
  assert.equal((await req(`/api/event?token=${tokens[0]}`, { user: null })).data.card.group, null);
  assert.equal((await action({ action: 'publishGroups' })).status, 200);
  await action({ action: 'saveEvent', event: { phase: 'live', revealOpen: false } });
  assert.equal((await req(`/api/event?token=${tokens[0]}`, { user: null })).data.card.group, null);
  await action({ action: 'saveEvent', event: { revealOpen: true } });
  assert.equal((await req(`/api/event?token=${tokens[0]}`, { user: null })).data.card.group.name, '紅色拼圖');
  await action({ action: 'saveGroup', id: 'red', name: '新的草稿', location: 'C 區' });
  assert.equal((await req(`/api/event?token=${tokens[0]}`, { user: null })).data.card.group.name, '紅色拼圖');
  assert.equal((await action({ action: 'publishGroups' })).status, 200);
  assert.equal((await req(`/api/event?token=${tokens[0]}`, { user: null })).data.card.group.name, '新的草稿');
  admin = (await req('/api/admin')).data;
  const p = admin.participants[0];
  const conflict = await action({ action: 'saveParticipant', id: p.id, name: '不應儲存', cardId: admin.cards[1].id, groupId: 'red' });
  assert.equal(conflict.status, 409);
  assert.equal((await req('/api/admin')).data.participants[0].name, p.name);
  assert.equal((await action({ action: 'saveParticipant', id: p.id, name: p.name, house: p.house, groupId: 'red', cardId: admin.cards[2].id })).status, 200);
  assert.equal((await req(`/api/event?token=${tokens[0]}`, { user: null })).status, 410);
  assert.equal((await req(`/api/event?token=${tokens[2]}`, { user: null })).status, 200);
  assert.equal((await req('/api/admin')).data.stats.checkedIn, 0);
  await action({ action: 'checkIn', participantId: p.id });
  assert.equal((await req('/api/admin')).data.stats.checkedIn, 1);
  const csv = await req('/api/admin/export?kind=offline');
  assert.equal(csv.status, 200); assert.match(csv.data, /'=HYPERLINK/); assert.match(csv.data, /新的草稿/);
  const results = await Promise.all(Array.from({ length: 150 }, (_, i) => req(`/api/event?token=${tokens[i % 149 + 1]}`, { user: null })));
  assert.ok(results.every(r => r.status === 200));
  assert.ok(results.every(r => !JSON.stringify(r.data).includes('owner_id') && !JSON.stringify(r.data).includes('claim_hash')));
  sqlite.close();
});


test('card links edit only their bound profile without account login', async () => {
  const { req, action, sqlite } = makeApp();
  await action({ action: 'generateCards', count: 3 });
  const [card, otherCard, unbound] = (await req('/api/admin')).data.cards;
  await action({ action: 'saveParticipant', name: '持卡甲', cardId: card.id });
  await action({ action: 'saveParticipant', name: '持卡乙', cardId: otherCard.id });
  const people = (await req('/api/admin')).data.participants;
  const person = people.find(p => p.cardId === card.id);
  const otherPerson = people.find(p => p.cardId === otherCard.id);
  const save = (token, extra = {}, options = {}) => req('/api/profile', { method: 'POST', body: { token, displayName: '', bio: '卡片自己的介紹', url: '', mode: 'page', ...extra }, user: null, ...options });
  const first = await req(`/api/me?token=${card.token}`, { user: null });
  assert.equal(first.status, 200); assert.equal(first.data.user, null);
  assert.equal(first.data.isOwner, false); assert.equal(first.data.canEdit, true);
  assert.equal(first.data.serial, card.serial); assert.equal(first.data.bound, true);
  assert.equal(first.data.profile.displayName, `#${card.serial}`);
  assert.equal(first.headers.get('cache-control'), 'no-store, max-age=0');
  assert.equal(first.headers.get('referrer-policy'), 'no-referrer');
  assert.equal((await save(card.token, { participantId: otherPerson.id, owner_id: 'attacker', name: '不能更改名單' })).status, 200);
  assert.equal((await req(`/api/me?token=${card.token}`, { user: 'different-account' })).data.profile.bio, '卡片自己的介紹');
  assert.equal((await req(`/api/me?token=${otherCard.token}`, { user: null })).data.profile.bio, '');
  assert.equal(sqlite.prepare('SELECT name,owner_id FROM participants WHERE id=?').get(person.id).name, '持卡甲');
  assert.equal(sqlite.prepare('SELECT owner_id FROM participants WHERE id=?').get(person.id).owner_id, null);
  assert.equal((await save(card.token, { displayName: '自訂卡名' }, { user: 'different-account' })).status, 200);
  assert.equal((await req(`/api/me?token=${card.token}`, { user: null })).data.profile.displayName, '自訂卡名');
  assert.equal((await save(card.token, { displayName: '   ' })).status, 200);
  assert.equal((await req(`/api/me?token=${card.token}`, { user: null })).data.profile.displayName, `#${card.serial}`);
  assert.equal((await req('/api/me', { user: null })).status, 400);
  assert.equal((await save(undefined)).status, 400);
  for (const token of ['not-a-card', '0'.repeat(48)]) {
    assert.equal((await req(`/api/me?token=${token}`, { user: null })).status, 404);
    assert.equal((await save(token)).status, 404);
  }
  assert.equal((await req(`/api/me?token=${unbound.token}`, { user: null })).status, 409);
  assert.equal((await save(unbound.token)).status, 409);
  assert.equal((await save(card.token, {}, { origin: false })).status, 403);
  assert.equal((await save(card.token, { url: 'javascript:alert(1)' })).status, 400);
  assert.equal((await save(card.token, { url: 'https://love.test/t/anything' })).status, 400);
  await action({ action: 'saveEvent', event: { phase: 'after' } });
  assert.equal((await req(`/api/event?token=${card.token}`, { user: null })).data.card.profile.displayName, `#${card.serial}`);
  await action({ action: 'setCardActive', cardId: card.id, active: false });
  assert.equal((await req(`/api/me?token=${card.token}`, { user: null })).status, 410);
  assert.equal((await save(card.token)).status, 410);
  assert.equal((await req('/api/admin', { user: null })).status, 401);
  assert.equal((await req('/api/admin', { user: 'different-account' })).status, 403);
  const audits = sqlite.prepare("SELECT actor,detail FROM audit WHERE action='saveProfile'").all();
  assert.ok(audits.every(a => a.actor === `card:${card.id}` && !a.detail.includes(card.token)));
  assert.equal(sqlite.prepare('SELECT owner_id,claim_hash FROM participants WHERE id=?').get(person.id).claim_hash, null);
  sqlite.close();
});

test('profile writes recheck card binding and token at commit time', async () => {
  for (const mutation of ['disable', 'rebind', 'rotate']) {
    const { req, action, sqlite, setBeforeBatch } = makeApp();
    await action({ action: 'generateCards', count: 1 });
    const card = (await req('/api/admin')).data.cards[0];
    await action({ action: 'saveParticipant', name: '原參加者', cardId: card.id });
    await action({ action: 'saveParticipant', name: '另位參加者' });
    const people = (await req('/api/admin')).data.participants;
    const original = people.find(p => p.cardId === card.id);
    const other = people.find(p => !p.cardId);
    setBeforeBatch(() => {
      if (mutation === 'disable') sqlite.prepare('UPDATE cards SET active=0 WHERE id=?').run(card.id);
      if (mutation === 'rebind') sqlite.prepare('UPDATE card_bindings SET participant_id=? WHERE card_id=?').run(other.id, card.id);
      if (mutation === 'rotate') sqlite.prepare('UPDATE cards SET token=? WHERE id=?').run('f'.repeat(48), card.id);
    });
    const saved = await req('/api/profile', { method: 'POST', body: { token: card.token, displayName: '不應寫入', bio: '', url: '', mode: 'page' }, user: null });
    assert.equal(saved.status, 409, mutation); assert.equal(saved.data.code, 'card_access_changed', mutation);
    for (const person of [original, other]) assert.equal(JSON.parse(sqlite.prepare('SELECT profile FROM participants WHERE id=?').get(person.id).profile).displayName, '', mutation);
    assert.equal(sqlite.prepare("SELECT count(*) AS n FROM audit WHERE action='saveProfile'").get().n, 0, mutation);
    sqlite.close();
  }
});

test('legacy claims retain expiring codes and owner metadata without gating card-link editing', async () => {
  const { req, action, sqlite } = makeApp();
  await action({ action: 'generateCards', count: 2 });
  let admin = (await req('/api/admin')).data;
  const card = admin.cards[0];
  await action({ action: 'saveParticipant', name: '持卡同學', cardId: card.id });
  admin = (await req('/api/admin')).data;
  const person = admin.participants[0];
  assert.equal((await action({ action: 'publishGroups' })).status, 409);
  const save = body => req('/api/profile', { method: 'POST', body: { token: card.token, displayName: '我的名字', bio: '很高興相遇', url: 'https://example.org/me', mode: 'page', ...body }, user: 'alice' });
  assert.equal((await save({})).status, 200);
  const issued = await action({ action: 'issueClaimCode', participantId: person.id });
  assert.match(issued.data.code, /^[a-f0-9]{32}$/);
  assert.equal(sqlite.prepare('SELECT claim_hash FROM participants WHERE id=?').get(person.id).claim_hash.length, 64);
  const claim = (code, user = 'alice') => req('/api/claim', { method: 'POST', body: { token: card.token, code }, user });
  assert.equal((await claim(issued.data.code, null)).status, 401);
  assert.equal((await claim('wrong-code')).status, 400);
  assert.equal((await claim(issued.data.code)).status, 200);
  assert.equal((await req(`/api/me?token=${card.token}`, { user: 'alice' })).data.isOwner, true);
  assert.equal((await req(`/api/me?token=${card.token}`, { user: 'bob' })).data.isOwner, false);
  assert.equal((await claim(issued.data.code, 'bob')).status, 409);
  assert.equal((await save({ url: 'javascript:alert(1)' })).status, 400);
  assert.equal((await save({ url: 'https://love.test/t/loop' })).status, 400);
  assert.equal((await save({ mode: 'redirect', url: '' })).status, 400);
  assert.equal((await save({})).status, 200);
  assert.equal((await req(`/api/event?token=${card.token}`, { user: null })).data.card.profile.url, '');
  await action({ action: 'saveEvent', event: { phase: 'after' } });
  assert.equal((await req(`/api/event?token=${card.token}`, { user: null })).data.card.profile.url, 'https://example.org/me');
  assert.equal((await action({ action: 'issueClaimCode', participantId: person.id })).status, 409);
  const recovery = await action({ action: 'issueClaimCode', participantId: person.id, resetOwner: true });
  assert.equal((await save({})).status, 200);
  assert.equal((await claim(recovery.data.code, 'bob')).status, 200);
  assert.equal((await req(`/api/me?token=${card.token}`, { user: 'bob' })).data.isOwner, true);
  sqlite.close();
});

test('claim codes expire and repeated guesses are limited', async () => {
  const { req, action, sqlite } = makeApp();
  await action({ action: 'generateCards', count: 1 });
  const card = (await req('/api/admin')).data.cards[0];
  await action({ action: 'saveParticipant', name: '限流測試', cardId: card.id });
  const person = (await req('/api/admin')).data.participants[0];
  const issued = await action({ action: 'issueClaimCode', participantId: person.id });
  sqlite.prepare('UPDATE participants SET claim_created_at=? WHERE id=?').run('2000-01-01T00:00:00Z', person.id);
  const claim = code => req('/api/claim', { method: 'POST', body: { token: card.token, code }, user: 'alice' });
  assert.equal((await claim(issued.data.code)).status, 400);
  for (let i = 0; i < 7; i++) assert.equal((await claim('wrong')).status, 400);
  assert.equal((await claim('wrong')).status, 429);
  sqlite.close();
});

test('concurrent admin edits cannot publish incomplete groups or report false profile saves', async () => {
  const { req, action, sqlite, setBeforeBatch } = makeApp();
  await action({ action: 'generateCards', count: 1 });
  const card = (await req('/api/admin')).data.cards[0];
  await action({ action: 'saveGroup', id: 'group-one', name: '第一組' });
  await action({ action: 'saveParticipant', name: '併發測試', groupId: 'group-one', cardId: card.id });
  const person = (await req('/api/admin')).data.participants[0];
  await action({ action: 'publishGroups' });
  const previous = sqlite.prepare("SELECT value FROM settings WHERE id='publication'").get().value;
  setBeforeBatch(() => sqlite.prepare('UPDATE participants SET group_id=NULL WHERE id=?').run(person.id));
  assert.equal((await action({ action: 'publishGroups' })).status, 409);
  assert.equal(sqlite.prepare("SELECT value FROM settings WHERE id='publication'").get().value, previous);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM audit WHERE action='publishGroups'").get().n, 1);
  const issued = await action({ action: 'issueClaimCode', participantId: person.id });
  await req('/api/claim', { method: 'POST', body: { token: card.token, code: issued.data.code }, user: 'alice' });
  setBeforeBatch(() => sqlite.prepare('UPDATE cards SET active=0 WHERE id=?').run(card.id));
  const save = await req('/api/profile', { method: 'POST', body: { token: card.token, displayName: '不應儲存', url: 'https://example.org', mode: 'page' }, user: 'alice' });
  assert.equal(save.status, 409);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM audit WHERE action='saveProfile'").get().n, 0);
  assert.equal(JSON.parse(sqlite.prepare('SELECT profile FROM participants WHERE id=?').get(person.id).profile).displayName, '');
  sqlite.close();
});
