import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
const require = createRequire(import.meta.url);
const folder = path.dirname(fileURLToPath(import.meta.url));
const compiled = ts.transpileModule(fs.readFileSync(path.join(folder, '../components/admin/NfcBatchWriter.tsx'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const exported = {};
new Function('exports', 'require', compiled)(exported, name => name === './NfcWriter' ? { default: () => null } : require(name));
const { createNfcQueue, compareHouseNames, isInactiveForBatch } = exported;
const person = (id, house, householdNumber, changes = {}) => ({ id, name: id, house, householdNumber, url: null, linkActive: false, ...changes });

test('queue sorts numeric and Chinese numbered houses, then household numbers, without mutating the roster', () => {
  const roster = [person('12-1', '第十二家', 1), person('2-3', '第2家', 3), person('1-2', '第一家', 2), person('2-1', '第2家', 1), person('1-1', '第一家', 1), person('10-1', '第十家', 1)];
  const before = structuredClone(roster);
  assert.deepEqual(createNfcQueue(roster).ids, ['1-1', '1-2', '2-1', '2-3', '10-1', '12-1']);
  assert.deepEqual(roster, before);
});

test('named houses use natural numbers; missing house or household number sorts last and ties retain roster order', () => {
  const roster = [person('blank', '', 1), person('A10', 'A10', 1), person('A2-null', 'A2', null), person('A2-first', 'A2', 2), person('A2-second', 'A2', 2), person('A2-1', 'A2', 1), person('A2-null2', 'A2', null)];
  assert.deepEqual(createNfcQueue(roster).ids, ['A2-1', 'A2-first', 'A2-second', 'A2-null', 'A2-null2', 'A10', 'blank']);
});

test('only inactive existing links are excluded; unprovisioned people stay in the queue', () => {
  const roster = [person('new', '1家', 1), person('active', '1家', 2, { url: 'https://example.org/t/a', linkActive: true }), person('inactive', '1家', 3, { url: 'https://example.org/t/b', linkActive: false })];
  assert.deepEqual(createNfcQueue(roster), { ids: ['new', 'active'], excludedInactive: 1 });
  assert.equal(isInactiveForBatch(roster[0]), false); assert.equal(isInactiveForBatch(roster[2]), true);
});

test('house selection is exact after trimming and excluded counts belong only to that selection', () => {
  const roster = [person('one', ' 第一家 ', 1), person('two', '第二家', 1), person('off', '第二家', 2, { url: 'https://example.org/t/a', linkActive: false }), person('blank', '', null)];
  assert.deepEqual(createNfcQueue(roster, '第一家'), { ids: ['one'], excludedInactive: 0 });
  assert.deepEqual(createNfcQueue(roster, '第二家'), { ids: ['two'], excludedInactive: 1 });
  assert.deepEqual(createNfcQueue(roster, ''), { ids: ['blank'], excludedInactive: 0 });
});

test('house comparator is a total order across numeric aliases, names and blank houses', () => {
  const names = ['一家', '2家', 'A家', '第1家', '第十家', 'House 2', 'House 10', '', '第一家', '十二家'];
  for (const a of names) for (const b of names) {
    assert.equal(Math.sign(compareHouseNames(a, b)) + Math.sign(compareHouseNames(b, a)), 0);
    for (const c of names) if (compareHouseNames(a, b) <= 0 && compareHouseNames(b, c) <= 0) assert.ok(compareHouseNames(a, c) <= 0, `${a},${b},${c}`);
  }
  const sorted = [...names].sort(compareHouseNames);
  assert.equal(sorted.at(-1), '');
  assert.ok(sorted.indexOf('2家') < sorted.indexOf('A家'));
  assert.notEqual(compareHouseNames('一家', '第1家'), 0);
});

test('a frozen queue keeps its IDs after the caller changes the live roster', () => {
  const roster = [person('first', '1家', 1), person('second', '2家', 1)];
  const queue = createNfcQueue(roster);
  roster.reverse(); roster.push(person('new', '1家', 0)); roster[0].linkActive = false;
  assert.deepEqual(queue.ids, ['first', 'second']);
});
