const test = require('node:test');
const assert = require('node:assert/strict');
const ts = require('typescript');
const fs = require('node:fs');
const path = require('node:path');
const compiled = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../lib/card-entry.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const moduleValue = { exports: {} };
new Function('exports', compiled)(moduleValue.exports);
const { rememberedCard, rememberCard, forgetCard } = moduleValue.exports;
function store() { const map = new Map(); return { getItem: key => map.get(key) || null, setItem: (key, value) => map.set(key, value), removeItem: key => map.delete(key) }; }
test('valid card visits persist and a new card supersedes the previous public link', () => {
  const storage = store(), first = 'a'.repeat(48), second = 'b'.repeat(48);
  assert.equal(rememberedCard(storage), ''); rememberCard(storage, first); assert.equal(rememberedCard(storage), first);
  rememberCard(storage, second); forgetCard(storage, first); assert.equal(rememberedCard(storage), second);
  forgetCard(storage, second); assert.equal(rememberedCard(storage), '');
});
test('invalid storage values, denied storage and malformed tokens cannot become card entries', () => {
  const storage = store(); rememberCard(storage, '/admin'); assert.equal(rememberedCard(storage), '');
  storage.setItem('tzai:last-card', 'https://example.org/'); assert.equal(rememberedCard(storage), '');
  const denied = { getItem() { throw Error(); }, setItem() { throw Error(); }, removeItem() { throw Error(); } };
  assert.equal(rememberedCard(denied), ''); assert.doesNotThrow(() => rememberCard(denied, 'c'.repeat(48))); assert.doesNotThrow(() => forgetCard(denied, 'c'.repeat(48)));
});
