import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const compiled = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../components/admin/NfcWriter.tsx'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const exported = {};
new Function('exports', 'require', compiled)(exported, require);
const { NfcWriterSession, validateNfcUrl } = exported;
const URL_VALUE = 'https://tzai-yeah-love-2026.lovely-bull-4753.chatgpt.site/t/' + 'a'.repeat(48);
const tick = () => new Promise(resolve => setImmediate(resolve));

function fixture({ timeout = 30000, url = URL_VALUE, environment } = {}) {
  const readers = [], states = [];
  class Reader extends EventTarget {
    constructor() { super(); readers.push(this); this.writes = []; this.scans = []; }
    write(message, options) {
      this.writes.push({ message, options });
      return new Promise((resolve, reject) => { this.resolveWrite = resolve; this.rejectWrite = reject; });
    }
    scan(options) { this.scans.push(options); return Promise.resolve(); }
    read(records) {
      const event = new Event('reading');
      event.message = { records };
      this.dispatchEvent(event);
    }
  }
  const session = new NfcWriterSession(url, state => states.push(state), () => ({ secure: true, topLevel: true, Reader, ...environment }), timeout);
  session.activate();
  return { readers, states, session };
}
function record(url = URL_VALUE, recordType = 'url') {
  const bytes = new TextEncoder().encode(url);
  return { recordType, data: new DataView(bytes.buffer) };
}

test('only canonical HTTPS participant URLs without credentials, queries or fragments are accepted', () => {
  assert.equal(validateNfcUrl(URL_VALUE), URL_VALUE);
  for (const unsafe of [URL_VALUE.replace('https:', 'http:'), URL_VALUE.replace('https://', 'https://user:pass@'), URL_VALUE + '?edit=1', URL_VALUE + '#edit', URL_VALUE + '/', URL_VALUE.replace('/t/', '/admin/'), URL_VALUE.replace(/a$/, 'g'), ' ' + URL_VALUE, 'javascript:alert(1)']) {
    assert.throws(() => validateNfcUrl(unsafe), undefined, unsafe);
  }
});

test('HTTPS, top-level and reader availability gates prevent any hardware call', () => {
  for (const environment of [{ secure: false }, { topLevel: false }, { Reader: undefined }]) {
    const f = fixture({ environment }); f.session.start('write');
    assert.equal(f.readers.length, 0); assert.equal(f.states.at(-1).status, 'error'); f.session.dispose();
  }
  const invalid = fixture({ url: 'https://example.org/admin' }); invalid.session.start('verify');
  assert.equal(invalid.readers.length, 0); invalid.session.dispose();
});

test('write starts synchronously from the click, with exactly one URL and overwrite false', async () => {
  const f = fixture(); f.session.start('write');
  assert.equal(f.readers.length, 1);
  const reader = f.readers[0], call = reader.writes[0];
  assert.deepEqual(call.message, { records: [{ recordType: 'url', data: URL_VALUE }] });
  assert.equal(call.options.overwrite, false); assert.equal(call.options.signal.aborted, false);
  assert.equal(reader.scans.length, 0); assert.equal(f.states.at(-1).status, 'writing');
  reader.resolveWrite(); await tick();
  assert.equal(f.states.at(-1).status, 'written'); assert.equal(call.options.signal.aborted, true);
  f.session.dispose();
});

test('double taps cannot start parallel writes or an implicit verification', () => {
  const f = fixture(); f.session.start('write'); f.session.start('write'); f.session.start('verify');
  assert.equal(f.readers.length, 1); assert.equal(f.readers[0].writes.length, 1); assert.equal(f.readers[0].scans.length, 0);
  f.session.dispose();
});

test('a successful write cannot be repeated in this modal, including after a verification mismatch', async () => {
  const f = fixture(); f.session.start('write'); f.readers[0].resolveWrite(); await tick();
  assert.equal(f.states.at(-1).written, true);
  f.session.start('write'); assert.equal(f.readers.length, 1);
  f.session.start('verify'); assert.equal(f.readers.length, 2);
  f.readers[1].read([record(URL_VALUE.replace(/a$/, 'b'))]);
  assert.equal(f.states.at(-1).status, 'error'); assert.equal(f.states.at(-1).written, true);
  f.session.start('write'); assert.equal(f.readers.length, 2);
  f.session.start('verify'); assert.equal(f.readers.length, 3); f.session.dispose();
});

test('cancel aborts pending hardware work and ignores late success while a newer verification runs', async () => {
  const f = fixture(); f.session.start('write'); const old = f.readers[0];
  f.session.cancel(); assert.equal(old.writes[0].options.signal.aborted, true);
  assert.equal(f.states.at(-1).status, 'cancelled');
  f.session.start('verify'); old.resolveWrite(); await tick();
  assert.equal(f.states.at(-1).status, 'verifying');
  f.readers[1].read([record()]); assert.equal(f.states.at(-1).status, 'verified'); f.session.dispose();
});

test('scan resolution only means listening; an exact single URL record is required for verified', async () => {
  const f = fixture(); f.session.start('verify'); const reader = f.readers[0]; await tick();
  assert.equal(f.states.at(-1).status, 'verifying'); assert.equal(reader.writes.length, 0);
  reader.read([record()]); assert.equal(f.states.at(-1).status, 'verified'); assert.equal(reader.scans[0].signal.aborted, true);
  const count = f.states.length; reader.read([record('https://example.org/')]); assert.equal(f.states.length, count); f.session.dispose();
});

test('wrong, additional, text-only, empty or invalid UTF-8 records never verify', () => {
  for (const records of [[record(URL_VALUE.replace(/a$/, 'b'))], [record(), record()], [record(URL_VALUE, 'text')], [], [{ recordType: 'url', data: new DataView(new Uint8Array([0xff]).buffer) }]]) {
    const f = fixture(); f.session.start('verify'); f.readers[0].read(records);
    assert.equal(f.states.at(-1).status, 'error'); assert.match(f.states.at(-1).message, /不一致/); f.session.dispose();
  }
});

test('readingerror stops scanning and permission or nonempty-card errors never retry with overwrite', async () => {
  const scan = fixture(); scan.session.start('verify'); const reader = scan.readers[0];
  reader.dispatchEvent(new Event('readingerror')); assert.equal(scan.states.at(-1).status, 'error'); assert.equal(reader.scans[0].signal.aborted, true); scan.session.dispose();
  const write = fixture(); write.session.start('write'); write.readers[0].rejectWrite(new DOMException('denied', 'NotAllowedError')); await tick();
  assert.equal(write.states.at(-1).status, 'error'); assert.match(write.states.at(-1).message, /權限.*已有內容/); assert.equal(write.readers[0].writes.length, 1); write.session.dispose();
});

test('timeout aborts both write and verify, and late resolution cannot overwrite timeout status', async () => {
  for (const kind of ['write', 'verify']) {
    const f = fixture({ timeout: 10 }); f.session.start(kind); const reader = f.readers[0];
    await new Promise(resolve => setTimeout(resolve, 25));
    assert.equal(f.states.at(-1).status, 'timeout');
    assert.equal((kind === 'write' ? reader.writes[0].options : reader.scans[0]).signal.aborted, true);
    if (kind === 'write') reader.resolveWrite(); else reader.read([record()]);
    await tick(); assert.equal(f.states.at(-1).status, 'timeout'); f.session.dispose();
  }
});

test('unmount/url replacement aborts and silences pending work; strict-mode reactivation is usable', async () => {
  const f = fixture(); f.session.start('write'); const old = f.readers[0], count = f.states.length;
  f.session.dispose(); assert.equal(old.writes[0].options.signal.aborted, true);
  old.rejectWrite(new DOMException('aborted', 'AbortError')); await tick(); assert.equal(f.states.length, count);
  f.session.start('write'); assert.equal(f.readers.length, 1);
  f.session.activate(); f.session.start('verify'); assert.equal(f.readers.length, 2);
  f.session.dispose(); const after = f.states.length; f.readers[1].read([record()]); assert.equal(f.states.length, after);
});
