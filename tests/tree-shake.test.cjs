const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const source = fs.readFileSync(path.join(__dirname, '../lib/tree-shake.ts'), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const exported = {};
new Function('exports', compiled)(exported);
const { createTreeShakeState, detectTreeShake, TREE_SHAKE_COOLDOWN_MS } = exported;
function play(samples) {
  let state = createTreeShakeState();
  const hits = [];
  for (const sample of samples) { const result = detectTreeShake(state, sample); state = result.state; if (result.shake) hits.push(sample.at); }
  return { state, hits };
}
function samples(duration, value) { const result = []; for (let at = 0; at <= duration; at += 16) result.push({ at, ...value(at) }); return result; }
const net = (x,y=0,z=0) => ({ acceleration:{x,y,z} });
const gravity = (x,y=9.80665,z=0) => ({ includingGravity:{x,y,z} });

test('stationary readings and small hand jitter never score', () => {
  const quiet = samples(5000, t => net(Math.sin(t/37)*.4, Math.cos(t/53)*.3, .2));
  assert.deepEqual(play(quiet).hits, []);
});
test('pure tilt and rotation of gravity are rejected without a gyroscope', () => {
  const tilt = samples(5000, t => gravity(9.80665*Math.sin(t/180),9.80665*Math.cos(t/180),0));
  assert.deepEqual(play(tilt).hits, []);
});
test('sustained gentle horizontal reversals score, with at least 350 ms between hits', () => {
  const wave = samples(5000, t => net(10*Math.sin(t/1000*Math.PI*4.8)));
  const hits = play(wave).hits;
  assert.ok(hits.length >= 6, `expected repeated shakes, got ${hits.length}`);
  for(let i=1;i<hits.length;i++) assert.ok(hits[i]-hits[i-1] >= TREE_SHAKE_COOLDOWN_MS);
});
test('gravity-only hardware still recognizes horizontal shakes after initial calibration', () => {
  const wave = samples(5000, t => gravity(t<320 ? 0 : 10*Math.sin((t-320)/1000*Math.PI*4.8)));
  assert.ok(play(wave).hits.length >= 5);
});
test('vertical movement does not count as a left-right shake', () => {
  assert.deepEqual(play(samples(3000,t=>net(0,10*Math.sin(t/1000*Math.PI*4.8),0))).hits,[]);
});
test('landscape uses the declared horizontal axis', () => {
  const wave = samples(3000,t=>({...net(0,10*Math.sin(t/1000*Math.PI*4.8),0),horizontalAxis:'y'}));
  assert.ok(play(wave).hits.length >= 3);
});
test('isolated sensor spikes and implausible accelerations never score', () => {
  const noise = samples(5000,t=>net(t%400===0 ? (t%800===0?20:-20) : 0));
  assert.deepEqual(play(noise).hits,[]);
  assert.deepEqual(play(samples(3000,t=>net(t%32 ? 120 : -120))).hits,[]);
});
test('missing sensor vectors are unavailable, while stationary real data is usable', () => {
  const initial=createTreeShakeState();
  assert.equal(detectTreeShake(initial,{at:0,acceleration:{x:null,y:null,z:null}}).usable,false);
  assert.equal(detectTreeShake(initial,{at:0,...net(0)}).usable,true);
  assert.equal(detectTreeShake(initial,{at:0,...gravity(0)}).usable,true);
});
test('a long pause cannot join two unrelated movements into one shake', () => {
  const first=samples(160,()=>net(10));
  const second=samples(160,()=>net(-10)).map(sample=>({...sample,at:sample.at+1600}));
  assert.deepEqual(play([...first,...second]).hits,[]);
});
test('out-of-order samples cannot update detector time or create hits', () => {
  const state=play(samples(160,()=>net(10))).state;
  const result=detectTreeShake(state,{at:80,...net(-10)});
  assert.equal(result.state,state); assert.equal(result.shake,false);
});
