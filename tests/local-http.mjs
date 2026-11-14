import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { performance } from 'node:perf_hooks';

const base = 'http://127.0.0.1:5173';
const mode = process.argv[2] || 'prepare';
const login = await fetch(`${base}/signin-with-chatgpt?return_to=/`, { redirect: 'manual' });
const cookie = login.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
assert.ok(cookie, 'Loopback mock login must issue a cookie');
async function req(path, { body, auth = true, origin = true } = {}) {
  const headers = {};
  if (auth) headers.cookie = cookie;
  if (body !== undefined) {
    headers['content-type'] = 'application/json';
    if (origin) headers.origin = base;
  }
  const response = await fetch(`${base}${path}`, { method: body === undefined ? 'GET' : 'POST', headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await response.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: response.status, data, headers: response.headers };
}
const action = body => req('/api/admin/action', { body });
const logs = [];
function passed(label) { logs.push(label); console.log(`PASS ${label}`); }
if (mode === 'prepare') {
  assert.equal((await req('/api/admin', { auth: false })).status, 401);
  assert.equal((await req('/api/admin/export?kind=cards', { auth: false })).status, 401);
  assert.equal((await req('/api/admin/action', { body: { action: 'generateCards' }, origin: false })).status, 403);
  passed('Anonymous admin/export access and absent-Origin writes rejected');
  const first = await action({ action: 'generateCards', count: 150 });
  assert.equal(first.status, 200, JSON.stringify(first.data));
  let admin = await req('/api/admin');
  assert.equal(admin.status, 200, JSON.stringify(admin.data));
  assert.equal(admin.data.cards.length, 150);
  assert.equal(new Set(admin.data.cards.map(c => c.token)).size, 150);
  const tokens = admin.data.cards.map(c => c.token);
  assert.equal((await action({ action: 'generateCards', count: 150 })).data.count, 0);
  assert.deepEqual((await req('/api/admin')).data.cards.map(c => c.token), tokens);
  passed('150 persistent random card URLs; repeat generation preserves all URLs');
  assert.equal((await action({ action: 'saveGroup', id: 'qa-http-group', name: '[QA] 暖光拼圖', location: '[QA] 教育館 A 區', note: '僅供本機測試', color: '#c55b4f' })).status, 200);
  let person = admin.data.participants.find(p => p.name === '[QA] 手機測試同學');
  if (!person) {
    const created = await action({ action: 'saveParticipant', name: '[QA] 手機測試同學', house: '[QA] 測試家', groupId: 'qa-http-group', cardId: admin.data.cards[0].id });
    assert.equal(created.status, 200, JSON.stringify(created.data));
  }
  assert.equal((await action({ action: 'publishGroups' })).status, 200);
  admin = await req('/api/admin');
  person = admin.data.participants.find(p => p.name === '[QA] 手機測試同學');
  const publicCard = await req(`/api/event?token=${tokens[0]}`, { auth: false });
  assert.equal(publicCard.status, 200);
  assert.equal(publicCard.data.card.group, null);
  assert.ok(!JSON.stringify(publicCard.data).includes('[QA] 手機測試同學'));
  assert.equal(admin.data.event.phase, 'before');
  passed('Published assignments remain hidden before live reveal; names stay private');
  const stored = { token: tokens[0], participantId: person.id, cardId: admin.data.cards[0].id };
  await fs.mkdir('work', { recursive: true });
  await fs.writeFile('work/local-qa.json', JSON.stringify(stored));
  console.log(`LOCAL_QA ${JSON.stringify(stored)}`);
} else if (mode === 'verify') {
  const state = JSON.parse(await fs.readFile('work/local-qa.json', 'utf8'));
  const original = (await req('/api/admin')).data.event;
  try {
    assert.equal((await action({ action: 'saveEvent', event: { phase: 'live', revealOpen: false } })).status, 200);
    assert.equal((await req(`/api/event?token=${state.token}`, { auth: false })).data.card.group, null);
    await action({ action: 'saveEvent', event: { revealOpen: true } });
    const revealed = await req(`/api/event?token=${state.token}`, { auth: false });
    assert.equal(revealed.data.card.group.name, '[QA] 暖光拼圖');
    passed('Actual D1 published group reveals only in live/open state');
    await action({ action: 'saveGroup', id: 'qa-http-group', name: '[QA] 草稿尚未發布', location: '[QA] B 區', note: '草稿測試' });
    assert.equal((await req(`/api/event?token=${state.token}`, { auth: false })).data.card.group.name, '[QA] 暖光拼圖');
    await action({ action: 'saveGroup', id: 'qa-http-group', name: '[QA] 暖光拼圖', location: '[QA] 教育館 A 區', note: '僅供本機測試', color: '#c55b4f' });
    passed('Draft edits do not leak through the actual D1 publication snapshot');
    const claim = await action({ action: 'issueClaimCode', participantId: state.participantId, resetOwner: true });
    assert.equal(claim.status, 200);
    assert.equal((await req('/api/claim', { body: { token: state.token, code: claim.data.code } })).status, 200);
    assert.equal((await req(`/api/me?token=${state.token}`)).data.isOwner, true);
    assert.equal((await req('/api/profile', { body: { token: state.token, displayName: '[QA] 我的載耶小卡', bio: '本機流程測試', url: 'https://example.org', mode: 'page' } })).status, 200);
    assert.equal((await req('/api/profile', { auth: false, body: { token: state.token, displayName: '侵入測試', url: 'https://example.org', mode: 'page' } })).status, 401);
    passed('Actual D1 claim, ownership, profile save and anonymous rejection');
    await action({ action: 'saveEvent', event: { phase: 'after' } });
    assert.equal((await req(`/api/event?token=${state.token}`, { auth: false })).data.card.profile.displayName, '[QA] 我的載耶小卡');
    passed('Personal profile appears in after-event state');
    await action({ action: 'setCardActive', cardId: state.cardId, active: false });
    assert.equal((await req(`/api/event?token=${state.token}`, { auth: false })).status, 410);
    await action({ action: 'setCardActive', cardId: state.cardId, active: true });
    passed('Inactive NFC card returns 410, reactivation restores lookup');
    const cards = (await req('/api/admin')).data.cards;
    const started = performance.now();
    const reads = await Promise.all(cards.slice(0, 150).map(async card => {
      const begin = performance.now();
      const result = await req(`/api/event?token=${card.token}`, { auth: false });
      return { status: result.status, ms: performance.now() - begin };
    }));
    const elapsed = performance.now() - started;
    assert.equal(reads.length, 150);
    assert.ok(reads.every(r => r.status === 200), `Statuses: ${JSON.stringify(reads.map(r => r.status))}`);
    const times = reads.map(r => r.ms).sort((a, b) => a - b);
    const metrics = { requests: 150, success: 150, errors: 0, wallMs: Math.round(elapsed), p50Ms: Math.round(times[74]), p95Ms: Math.round(times[142]), maxMs: Math.round(times[149]) };
    passed(`150 concurrent actual HTTP/D1 lookups: ${JSON.stringify(metrics)}`);
    const csv = await req('/api/admin/export?kind=offline');
    assert.equal(csv.status, 200); assert.match(csv.data, /\[QA\] 暖光拼圖/); assert.match(csv.data, /\[QA\] 手機測試同學/);
    passed('Offline CSV exports published group and participant records');
    await fs.mkdir('docs', { recursive: true });
    await fs.appendFile('docs/VALIDATION.md', `\n## Actual local HTTP and D1 validation\n\nDate: 2026-11-14 (Asia/Taipei). Environment: Vinext dev on loopback, real local Cloudflare D1; mock ChatGPT login via the supported local sign-in route. No production records changed.\n\n${logs.map(line => `- ${line}`).join('\n')}\n\nLoad measurements are local-dev observations, not a production capacity guarantee. Browser/device/network QA remains separate. The local event was restored to before/reveal-closed, with 150 local blank cards and one clearly labelled QA participant/group.\n`);
  } finally {
    await action({ action: 'setCardActive', cardId: state.cardId, active: true });
    await action({ action: 'saveEvent', event: { phase: 'before', revealOpen: false, videoUrl: original.videoUrl } });
    console.log('RESTORED phase=before revealOpen=false card=active');
  }
} else throw new Error('Use prepare or verify');
