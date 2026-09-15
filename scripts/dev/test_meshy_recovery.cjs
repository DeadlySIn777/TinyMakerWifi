'use strict';
// Exercise production transport/recovery against inert responses. No service,
// credentials, printer commands or paid generations are used.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../../web/parts/meshy.js'), 'utf8');
const PENDING = 'tmMeshyPending', API = 'https://api.meshy.ai/openapi/v2/text-to-3d';
const asset = 'https://inert.invalid/model.glb';
const tick = () => new Promise(setImmediate);
function glb() {
  const b = new ArrayBuffer(24), d = new DataView(b);
  d.setUint32(0, 0x46546c67, true); d.setUint32(4, 2, true); d.setUint32(8, 24, true);
  d.setUint32(12, 4, true); d.setUint32(16, 0x4e4f534a, true);
  new Uint8Array(b, 20).set([123,125,32,32]); return b;
}
function fixture(storage = new Map()) {
  const f = { storage, requests: [], seq: 0, writeFail: false, pollFail: false, brokenAsset: false };
  const reply = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) });
  const ctx = { Promise, Date, setTimeout, console,
    localStorage: {
      getItem: k => storage.get(k) || null,
      setItem: (k,v) => { if (f.writeFail) throw Error('inert write failure'); storage.set(k,v); },
      removeItem: k => storage.delete(k)
    },
    fetch: async (url, options = {}) => {
      const req = { url, method: options.method || 'GET', body: options.body ? JSON.parse(options.body) : null };
      f.requests.push(req);
      if (req.method === 'POST') {
        if (f.holdPost) await f.holdPost;
        if (f.postResponse) return f.postResponse;
        return reply({ result: 'task-' + (++f.seq) });
      }
      if (url.startsWith(API + '/')) {
        if (f.pollFail) throw new TypeError('Failed to fetch');
        const id = url.slice(API.length + 1);
        if (f.pollResponse) return f.pollResponse(id);
        return reply({ id, status: 'SUCCEEDED', progress: 100, model_urls: { glb: asset } });
      }
      if (url === asset || url.startsWith('/api/fetch?')) {
        if (f.failDirectBody && url === asset) return { ok: true, arrayBuffer: async () => { throw Error('interrupted body'); } };
        return { ok: true, arrayBuffer: async () => f.brokenAsset ? new ArrayBuffer(24) : glb() };
      }
      throw Error('Unexpected inert URL: ' + url);
    }
  };
  ctx.window = ctx; vm.createContext(ctx); vm.runInContext(source, ctx);
  f.api = ctx.meshy; f.api.setKey('inert-recovery-test-key');
  f.seed = (id = 'task-old', extra = {}) => storage.set(PENDING, JSON.stringify({ id, prompt: 'saved dog', from: 'keycap', at: Date.now(), ...extra }));
  f.posts = () => f.requests.filter(x => x.method === 'POST');
  return f;
}
let passed = 0;
async function test(name, run) { await run(); passed++; console.log('PASS ' + name); }
(async () => {
  await test('a completed download stays recoverable until its saved result is acknowledged', async () => {
    const f = fixture(), state = await f.api.generate('inert dog', {from:'keycap'});
    assert.equal(f.api.pending().id, state.deliveryId);
    assert.equal(f.api.acknowledge('wrong-task'), false);
    assert.equal(f.api.pending().id, state.deliveryId);
    assert.equal(f.api.acknowledge(state.deliveryId), true); assert.equal(f.api.pending(), null);
  });
  await test('a stale result cannot acknowledge a newer task from another tab', async () => {
    const f = fixture(), state = await f.api.generate('inert dog'); f.seed('newer-task');
    assert.equal(f.api.acknowledge(state.deliveryId), false); assert.equal(f.api.pending().id, 'newer-task');
  });
  await test('tasks remain recoverable after an overnight interruption and refresh their task URLs', async () => {
    const f = fixture(); f.seed('task-old', {at:Date.now() - 24*60*60*1000});
    const state = await f.api.resume();
    assert.equal(state.deliveryId, 'task-old'); assert.equal(state.glb.byteLength, 24);
    assert.equal(f.posts().length, 0); assert.equal(f.api.pending().id, 'task-old');
  });
  await test('resuming a texture stage polls the refined task and retains the preview identity', async () => {
    const f = fixture(); f.seed('refined-task', {previewId:'accepted-preview',stage:'refine',from:'model'});
    const state = await f.api.resume();
    assert.equal(state.previewId, 'accepted-preview'); assert.equal(state.refineId, 'refined-task');
    assert.equal(f.requests[0].url, API + '/refined-task'); assert.equal(f.posts().length, 0);
  });
  await test('a new texture task is persisted before its first poll and can resume after failure', async () => {
    const f = fixture(); f.pollFail = true;
    await assert.rejects(f.api.generateTexture('accepted-preview',{from:'model',prompt:'saved puppy'}));
    assert.equal(f.api.pending().stage, 'refine'); assert.equal(f.api.pending().previewId, 'accepted-preview');
    const next = fixture(f.storage); const state = await next.api.resume();
    assert.equal(state.refineId, 'task-1'); assert.equal(next.posts().length, 0);
  });
  await test('the combined preview/refine path recovers the texture task without another paid request', async () => {
    const f = fixture(), state = await f.api.generate('inert fox',{refine:true,from:'model'});
    assert.equal(f.posts().length, 2); assert.equal(f.api.pending().id, state.refineId);
    assert.equal(f.api.pending().previewId, state.previewId);
    const next = fixture(f.storage); const recovered = await next.api.resume();
    assert.equal(recovered.refineId, state.refineId); assert.equal(next.posts().length, 0);
  });
  await test('failed/canceled/expired tasks clear recovery using explicit status, not message casing', async () => {
    for (const status of ['FAILED','CANCELED','CANCELLED','EXPIRED']) {
      const f = fixture(); f.seed();
      f.pollResponse = id => ({ok:true,text:async()=>JSON.stringify({id,status,task_error:{message:'inert cause'}})});
      await assert.rejects(f.api.resume(), error => error.taskTerminal === true);
      assert.equal(f.api.pending(), null, status);
    }
  });
  await test('transient errors mentioning EXPIRED do not delete a task without terminal status', async () => {
    const f = fixture(); f.seed();
    f.pollResponse = () => ({ok:false,status:503,text:async()=>JSON.stringify({message:'EXPIRED upstream cache'})});
    await assert.rejects(f.api.resume(), /503/); assert.equal(f.api.pending().id,'task-old');
  });
  await test('an unrecognized or mismatched task response cannot deliver somebody else\'s model', async () => {
    for (const response of [{id:'different-task',status:'SUCCEEDED'}, {id:'task-old',status:'STRANGE'}]) {
      const f=fixture();f.seed();f.pollResponse=()=>({ok:true,text:async()=>JSON.stringify(response)});
      await assert.rejects(f.api.resume(), /task|response/); assert.equal(f.api.pending().id,'task-old');
      assert.equal(f.requests.length,1);
    }
  });
  await test('bad or missing task IDs report credit uncertainty and never poll an invented ID', async () => {
    for (const response of [{result:null},{result:{id:'nested'}},{result:'../wrong'},{result:'x'.repeat(129)}]) {
      const f=fixture();f.postResponse={ok:true,text:async()=>JSON.stringify(response)};
      await assert.rejects(f.api.generate('inert dog'), e=>e.submissionUncertain===true);
      assert.equal(f.requests.length,1);assert.equal(f.api.pending(),null);
    }
  });
  await test('a POST response interrupted after headers still explains uncertain credits', async () => {
    const f=fixture();f.postResponse={ok:true,text:async()=>{throw Error('body interrupted');}};
    await assert.rejects(f.api.generate('inert dog'), /may have used credits.*task history/);
    assert.equal(f.requests.length,1);
  });
  await test('broken GLB bytes try the printer but never discard the task or become a successful result', async () => {
    const f=fixture();f.brokenAsset=true;
    await assert.rejects(f.api.generate('inert dog'),e=>e.modelUrl===asset && /complete GLB/.test(e.message));
    assert.equal(f.api.pending().id,'task-1'); assert.ok(f.requests.some(x=>x.url.startsWith('/api/fetch?')));
  });
  await test('an interrupted direct asset body falls back to the printer without another generation', async () => {
    const f=fixture();f.failDirectBody=true;const result=await f.api.generate('inert dog');
    assert.equal(result.glb.byteLength,24);assert.equal(f.posts().length,1);assert.equal(f.api.pending().id,result.deliveryId);
  });
  await test('two cards cannot submit simultaneous paid requests before the first task ID exists', async () => {
    const f=fixture();let release;f.holdPost=new Promise(resolve=>{release=resolve;});
    const first=f.api.generate('first inert dog');await tick();
    assert.equal(f.api.busy(),true);await assert.rejects(f.api.generate('second inert dog'),/already active/);
    assert.equal(f.posts().length,1);release();await first;assert.equal(f.api.busy(),false);
  });
  await test('starting a new model never silently replaces another card\'s pending paid task', async () => {
    const f=fixture();f.seed('keycap-task');
    await assert.rejects(f.api.generate('new inert model',{from:'model'}),/waiting to be recovered or saved/);
    assert.equal(f.posts().length,0);assert.equal(f.api.pending().id,'keycap-task');
  });
  await test('unavailable recovery storage refuses before a paid request', async () => {
    const f=fixture();f.writeFail=true;
    await assert.rejects(f.api.generate('inert dog'),/Allow site storage.*Nothing has been submitted/);
    assert.equal(f.requests.length,0);assert.equal(f.api.busy(),false);
  });
  console.log(passed+' Meshy recovery groups passed; no live requests.');
})().catch(e=>{console.error(e);process.exitCode=1;});
