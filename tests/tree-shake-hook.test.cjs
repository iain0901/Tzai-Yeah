const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
function load(file, requireFn) {
  const source = fs.readFileSync(file, 'utf8');
  const code = ts.transpileModule(source, {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
  const exports = {}; new Function('exports','require',code)(exports, requireFn); return exports;
}
function setup({secure=true, motion=class {}, policy, visibility='visible'}={}) {
  const slots=[]; let index=0; const effects=[]; const listeners={}; const timers=new Map(); let nextTimer=0, hits=0;
  const react={
    useRef(value){ const i=index++; return slots[i] ||= {current:value}; },
    useState(value){ const i=index++; if (!(i in slots)) slots[i]=value; return [slots[i],v=>{slots[i]=typeof v==='function'?v(slots[i]):v;}]; },
    useCallback(fn){index++; return fn;},
    useEffect(fn){const i=index++; if (!(i in slots)) { slots[i]=true; effects.push(fn); }},
  };
  global.window={isSecureContext:secure, DeviceMotionEvent:motion, screen:{orientation:{angle:0}}, addEventListener:(n,f)=>{listeners[n]=f;}, removeEventListener:(n)=>{delete listeners[n];}};
  global.document={visibilityState:visibility, permissionsPolicy:policy, addEventListener:(n,f)=>{listeners[n]=f;}, removeEventListener:(n)=>{delete listeners[n];}};
  const oldSet=global.setTimeout, oldClear=global.clearTimeout;
  global.setTimeout=(f)=>{const id=++nextTimer; timers.set(id,f); return id;}; global.clearTimeout=id=>timers.delete(id);
  const detector=load('lib/tree-shake.ts',require);
  const hook=load('components/event/useTreeShake.ts', name=>name==='react'?react:name==='@/lib/tree-shake'?detector:require(name)).useTreeShake;
  function render(){index=0;return hook({onShake:()=>hits++,enabled:true});}
  render(); const cleanup=effects.map(f=>f());
  return {render, listeners, timers, hits:()=>hits, close(){cleanup.forEach(f=>f?.()); global.setTimeout=oldSet;global.clearTimeout=oldClear;delete global.window;delete global.document;}};
}
test('iOS permission is requested synchronously from start and denial is explained', async()=>{
  let calls=0; class Motion {static requestPermission(){calls++;return Promise.resolve('denied');}}
  const h=setup({motion:Motion}); try {const promise=h.render().start(); assert.equal(calls,1); await promise; assert.equal(h.render().status,'denied'); assert.match(h.render().message,/設定|允許/);} finally {h.close();}
});
test('insecure context gives actionable HTTPS guidance', async()=>{
  const h=setup({secure:false}); try {await h.render().start();assert.equal(h.render().status,'unavailable');assert.match(h.render().message,/HTTPS/);} finally {h.close();}
});
test('blocked accelerometer policy is explained without starting listener', async()=>{
  const h=setup({policy:{allowsFeature:feature=>feature!=='accelerometer'}}); try {await h.render().start();assert.equal(h.render().status,'unavailable');assert.match(h.render().message,/權限|限制/);assert.equal(h.listeners.devicemotion,undefined);} finally {h.close();}
});
test('Android without permission API listens and reports no sensor data', async()=>{
  const h=setup(); try {await h.render().start();assert.equal(h.render().status,'listening');assert.equal(typeof h.listeners.devicemotion,'function');[...h.timers.values()].forEach(f=>f());assert.equal(h.render().status,'unavailable');assert.match(h.render().message,/點|瀏覽器/);assert.equal(h.listeners.devicemotion,undefined);} finally {h.close();}
});
test('grant attaches listener, usable data cancels timeout, and background removes listener', async()=>{
  class Motion {static requestPermission(){return Promise.resolve('granted');}}
  const h=setup({motion:Motion}); try {await h.render().start();h.listeners.devicemotion({acceleration:{x:0,y:0,z:0}});assert.equal(h.timers.size,0);document.visibilityState='hidden';h.listeners.visibilitychange();assert.equal(h.render().status,'paused');assert.equal(h.listeners.devicemotion,undefined);} finally {h.close();}
});
test('late iOS grant after pause does not attach sensor', async()=>{
  let resolve; class Motion {static requestPermission(){return new Promise(r=>{resolve=r;});}}
  const h=setup({motion:Motion}); try {const promise=h.render().start();h.render().stop();resolve('granted');await promise;assert.equal(h.render().status,'paused');assert.equal(h.listeners.devicemotion,undefined);} finally {h.close();}
});
