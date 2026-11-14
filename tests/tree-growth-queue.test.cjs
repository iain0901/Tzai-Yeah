const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const sourcePath = path.resolve(__dirname, '../components/event/tree-growth-queue.ts');
const code = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const loaded = new Module(sourcePath, module); loaded.filename = sourcePath; loaded.paths = module.paths; loaded._compile(code, sourcePath);
const { GrowthQueue } = loaded.exports;

function setup() {
  const data = new Map();
  const storage = { getItem: key => data.get(key) || null, setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key) };
  let tail = Promise.resolve(), sequence = 0, time = 1000;
  const lock = work => { const next = tail.then(work, work); tail = next.then(() => {}, () => {}); return next; };
  const make = (owner = 'player-one', target = storage) => new GrowthQueue('growth', owner, target, lock, () => `request-${++sequence}`, () => time);
  return { make, storage, advance: ms => { time += ms; } };
}

test('two tabs enqueue without lost updates; concurrent senders share one request ID', async () => {
  const { make } = setup(); const a = make(), b = make();
  const accepted = await Promise.all(Array.from({ length: 20 }, (_, i) => (i % 2 ? a : b).enqueue()));
  assert.equal(accepted.filter(x => x.accepted).length, 20);
  assert.equal((await a.refresh()).waiting, 20);
  const [first, second] = await Promise.all([a.take(), b.take()]);
  assert.deepEqual(first.batch, second.batch);
  assert.equal(first.batch.count, 3);
  assert.equal((await b.refresh()).waiting, 17);
});

test('late acknowledgement cannot erase a newer batch or concurrently enqueued work', async () => {
  const { make, advance } = setup(); const a = make(), b = make();
  await Promise.all(Array.from({ length: 8 }, () => a.enqueue()));
  const first = await a.take();
  await Promise.all([b.enqueue(), a.enqueue(), b.acknowledge(first.batch.requestId)]);
  assert.equal((await a.refresh()).waiting, 7);
  advance(1000); const second = await b.take();
  await a.acknowledge(first.batch.requestId);
  const snapshot = await a.refresh();
  assert.equal(snapshot.batch.requestId, second.batch.requestId);
  assert.equal(snapshot.waiting, 4);
});

test('interleaved retries and duplicated HTTP responses deliver each accepted shake once', async () => {
  const { make, advance } = setup(); const a = make(), b = make();
  const requests = new Map();
  await Promise.all(Array.from({ length: 24 }, (_, i) => (i % 2 ? a : b).enqueue()));
  assert.equal((await b.enqueue()).accepted, false);
  for (let round = 0; round < 8; round++) {
    const [x, y] = await Promise.all([a.take(), b.take()]);
    assert.equal(x.batch.requestId, y.batch.requestId);
    for (const batch of [x.batch, y.batch]) if (!requests.has(batch.requestId)) requests.set(batch.requestId, batch.count);
    await Promise.all([a.acknowledge(x.batch.requestId), b.acknowledge(y.batch.requestId)]);
    advance(1000);
  }
  assert.equal([...requests.values()].reduce((a, b) => a + b, 0), 24);
  assert.equal(requests.size, 8);
  assert.equal((await a.refresh()).waiting, 0);
  assert.equal((await b.refresh()).batch, null);
});

test('global batch pacing prevents multiple tabs draining faster than three per second', async () => {
  const { make, advance } = setup(); const a = make(), b = make();
  await Promise.all(Array.from({ length: 6 }, () => a.enqueue()));
  const first = await a.take(); await a.acknowledge(first.batch.requestId);
  const early = await b.take(); assert.equal(early.batch, null); assert.equal(early.waitMs, 1000);
  advance(1000); assert.equal((await b.take()).batch.count, 3);
});

test('reload reuses the pending ID, and an old owner cannot clear a newer owner queue', async () => {
  const { make } = setup(); const a = make(); await a.enqueue(); const first = await a.take();
  const reloaded = make(); assert.equal((await reloaded.take()).batch.requestId, first.batch.requestId);
  const anotherOwner = make('player-two'); await anotherOwner.enqueue(); await a.clear();
  assert.equal((await anotherOwner.refresh()).waiting, 1);
});

test('tab-local fallback storage cannot restore or duplicate another tab pending queue', async () => {
  const { make } = setup();
  function isolated() { const map = new Map(); return { getItem: key => map.get(key) || null, setItem: (key, value) => map.set(key, value), removeItem: key => map.delete(key) }; }
  const a = make('player-one', isolated()), b = make('player-one', isolated());
  await a.enqueue(); assert.equal((await b.refresh()).waiting, 0); assert.equal((await b.take()).batch, null);
});
