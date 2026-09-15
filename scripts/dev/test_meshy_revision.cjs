'use strict';
// Real production client with inert fetch/storage. No Meshy, printer or paid calls.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../../web/parts/meshy.js'), 'utf8');
const PENDING = 'tmMeshyPending', V1 = 'https://api.meshy.ai/openapi/v1/';
const V2 = 'https://api.meshy.ai/openapi/v2/text-to-3d';
const ASSET = 'https://inert.invalid/revised.glb';
const IMAGE = 'data:image/png;base64,iVBORw0KGgo=';
const OPTIONS = { imageDataUrl: IMAGE, from: 'keycap', designCode: 'TMK1-test', polycount: 100000, texture: true };
const tick = () => new Promise(setImmediate);
const plain = value => JSON.parse(JSON.stringify(value));
function glb() {
  const b = new ArrayBuffer(24), d = new DataView(b);
  d.setUint32(0, 0x46546c67, true); d.setUint32(4, 2, true); d.setUint32(8, 24, true);
  d.setUint32(12, 4, true); d.setUint32(16, 0x4e4f534a, true);
  new Uint8Array(b, 20).set([123,125,32,32]); return b;
}
function reply(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) };
}
function fixture(storage = new Map()) {
  const f = { storage, requests: [], writes: [] };
  const ctx = { Promise, Date, Math, setTimeout, console,
    localStorage: {
      getItem: key => storage.get(key) || null,
      setItem: (key, value) => {
        if (f.failWrite && f.failWrite(key, value)) throw Error('inert storage full');
        f.writes.push({ key, value }); storage.set(key, value);
      }, removeItem: key => storage.delete(key)
    },
    fetch: async (url, options = {}) => {
      const req = { url, method: options.method || 'GET', body: options.body ? JSON.parse(options.body) : null,
        pending: JSON.parse(storage.get(PENDING) || 'null') };
      f.requests.push(req);
      if (f.intercept) {
        const overridden = await f.intercept(req);
        if (overridden !== undefined) return overridden;
      }
      if (req.method === 'POST') {
        if (url === V1 + 'image-to-image') return reply({ result: 'edited-image' });
        if (url === V1 + 'image-to-3d') return reply({ result: 'revised-model' });
        if (url === V2) return reply({ result: 'legacy-task' });
      }
      if (url === V1 + 'image-to-image/edited-image') return reply({ id: 'edited-image', status: 'SUCCEEDED', image_urls: ['https://inert.invalid/edited.png'] });
      if (url === V1 + 'image-to-3d/revised-model') return reply({ id: 'revised-model', status: 'SUCCEEDED', model_urls: { glb: ASSET } });
      if (url === V2 + '/legacy-task') return reply({ id: 'legacy-task', status: 'SUCCEEDED', model_urls: { glb: ASSET } });
      if (url === ASSET) return { ok: true, arrayBuffer: async () => glb() };
      throw Error('Unexpected inert request: ' + url);
    }
  };
  ctx.window = ctx; vm.createContext(ctx); vm.runInContext(source, ctx, { filename: 'meshy.js' });
  f.api = ctx.meshy; f.api.setKey('inert-revision-test-key');
  f.posts = () => f.requests.filter(r => r.method === 'POST');
  f.seed = record => storage.set(PENDING, JSON.stringify(record));
  return f;
}
let passed = 0;
async function test(name, run) { await run(); passed++; console.log('PASS ' + name); }
(async () => {
  await test('revision submits the two documented schemas with durable before-POST markers', async () => {
    const f = fixture(), state = await f.api.reviseFromImage('Make the face broader; retain the character.', OPTIONS);
    const posts = f.posts(); assert.equal(posts.length, 2);
    assert.equal(posts[0].url, V1 + 'image-to-image');
    assert.deepEqual(posts[0].body, { ai_model: 'nano-banana-2', prompt: 'Make the face broader; retain the character.', reference_image_urls: [IMAGE], remove_background: true });
    assert.equal(posts[0].pending.stage, 'image-submitting');
    assert.equal(posts[0].pending.family, 'visual-revision');
    assert.equal(posts[1].url, V1 + 'image-to-3d');
    assert.deepEqual(posts[1].body, { input_task_id: 'edited-image', model_type: 'standard', ai_model: 'meshy-7', image_enhancement: false, should_texture: true, should_remesh: true, target_polycount: 100000, target_formats: ['glb'] });
    assert.equal(posts[1].pending.stage, 'model-submitting'); assert.equal(posts[1].pending.imageId, 'edited-image');
    assert.equal(state.sourceFamily, 'image-to-3d'); assert.equal(state.modelId, 'revised-model');
    assert.equal(state.imageId, 'edited-image'); assert.equal(state.deliveryId, 'revised-model');
    assert.equal(state.glb.byteLength, 24); assert.equal(state.designCode, 'TMK1-test');
    assert.equal(Object.hasOwn(state, 'previewId'), false); assert.equal(Object.hasOwn(state, 'refineId'), false);
    assert.equal(f.api.pending().id, 'revised-model');
    assert.equal(f.storage.get(PENDING).includes('base64'), false);
    assert.deepEqual(plain(state.opts), { from: 'keycap', polycount: 100000, texture: true });
  });
  await test('texture defaults on and explicit geometry-only revisions keep the requested detail', async () => {
    const f = fixture(); await f.api.reviseFromImage('Round ears', { imageDataUrl: IMAGE });
    assert.equal(f.posts()[1].body.should_texture, true); assert.equal(f.posts()[1].body.target_polycount, 100000);
    const g = fixture(); await g.api.reviseFromImage('Round ears', { ...OPTIONS, texture: false, polycount: 30000 });
    assert.equal(g.posts()[1].body.should_texture, false); assert.equal(g.posts()[1].body.target_polycount, 30000);
  });
  await test('source settings are captured before asynchronous work and the PNG is never persisted', async () => {
    const f = fixture(), opts = { ...OPTIONS };
    const job = f.api.reviseFromImage('Keep a round face', opts);
    opts.from = 'model'; opts.polycount = 30000; opts.texture = false; opts.designCode = 'TMK1-other'; opts.imageDataUrl = 'changed';
    const state = await job;
    assert.equal(state.designCode, 'TMK1-test'); assert.equal(state.opts.from, 'keycap'); assert.equal(state.opts.polycount, 100000);
    assert.equal(f.posts()[0].body.reference_image_urls[0], IMAGE);
    assert.ok(f.writes.filter(w => w.key === PENDING).every(w => !w.value.includes('base64')));
  });
  await test('reload during image polling resumes the image then submits only the authorized model', async () => {
    const f = fixture(); f.intercept = req => { if (req.url === V1 + 'image-to-image/edited-image') throw TypeError('Failed to fetch'); };
    await assert.rejects(f.api.reviseFromImage('Bigger cheeks', OPTIONS));
    assert.equal(f.api.pending().stage, 'image'); assert.equal(f.posts().length, 1);
    const g = fixture(f.storage), state = await g.api.resume();
    assert.equal(g.requests[0].url, V1 + 'image-to-image/edited-image');
    assert.equal(g.posts().length, 1); assert.equal(g.posts()[0].url, V1 + 'image-to-3d');
    assert.equal(state.resumed, true); assert.equal(state.designCode, OPTIONS.designCode);
  });
  await test('reload during model polling or after delivery never resubmits either paid task', async () => {
    const f = fixture(); f.intercept = req => { if (req.url === V1 + 'image-to-3d/revised-model') throw TypeError('Failed to fetch'); };
    await assert.rejects(f.api.reviseFromImage('Bigger cheeks', OPTIONS)); assert.equal(f.api.pending().stage, 'model');
    const g = fixture(f.storage), state = await g.api.resume(); assert.equal(g.posts().length, 0);
    assert.equal(g.requests[0].url, V1 + 'image-to-3d/revised-model'); assert.equal(state.deliveryId, 'revised-model');
    const h = fixture(f.storage); await h.api.resume(); assert.equal(h.posts().length, 0);
    assert.equal(h.api.acknowledge('edited-image'), false); assert.equal(h.api.acknowledge('revised-model'), true); assert.equal(h.api.pending(), null);
  });
  await test('uncertain first or second POST cannot be repeated by reload, resume, or new generation', async () => {
    for (const phase of ['image-to-image', 'image-to-3d']) {
      for (const failure of ['transport', 'body', 'invalid-id', 'server']) {
        const f = fixture(); f.intercept = req => {
          if (req.url !== V1 + phase || req.method !== 'POST') return;
          if (failure === 'transport') throw TypeError('Failed to fetch');
          if (failure === 'body') return { ok: true, text: async () => { throw Error('interrupted'); } };
          if (failure === 'invalid-id') return reply({ result: null });
          return reply({ message: 'server failure' }, 503);
        };
        await assert.rejects(f.api.reviseFromImage('Cut back the extra ear', OPTIONS), e => e.submissionUncertain === true);
        assert.equal(f.api.pending().stage, phase === 'image-to-image' ? 'image-submitting' : 'model-submitting');
        const g = fixture(f.storage);
        await assert.rejects(g.api.resume(), e => e.submissionUncertain && e.recoveryNeeded && /will not repeat/.test(e.message));
        await assert.rejects(g.api.reviseFromImage('Try another', OPTIONS), /waiting to be recovered/);
        await assert.rejects(g.api.generate('legacy attempt'), /waiting to be recovered/);
        assert.equal(g.requests.length, 0, phase + ' ' + failure);
      }
    }
  });
  await test('actual page loss while either POST is outstanding leaves a nonrepeatable marker', async () => {
    for (const phase of ['image-to-image', 'image-to-3d']) {
      const f = fixture(); let release;
      const held = new Promise(resolve => { release = resolve; });
      f.intercept = async req => { if (req.method === 'POST' && req.url === V1 + phase) await held; };
      const job = f.api.reviseFromImage('Cute round face', OPTIONS); await tick();
      assert.equal(f.api.pending().stage, phase === 'image-to-image' ? 'image-submitting' : 'model-submitting');
      const g = fixture(f.storage); await assert.rejects(g.api.resume(), /could not be verified/); assert.equal(g.posts().length, 0);
      release(); await job;
    }
  });
  await test('credit rejection clears only an uncreated first task and retains an already paid image', async () => {
    for (const phase of ['image-to-image', 'image-to-3d']) {
      const f = fixture(); f.intercept = req => req.url === V1 + phase && req.method === 'POST' ? reply({ message: 'Insufficient credits' }, 402) : undefined;
      await assert.rejects(f.api.reviseFromImage('Bigger eyes', OPTIONS), /402.*Insufficient credits/);
      if (phase === 'image-to-image') assert.equal(f.api.pending(), null);
      else {
        assert.equal(f.api.pending().stage, 'blocked'); assert.equal(f.api.pending().imageId, 'edited-image');
        const g = fixture(f.storage); await assert.rejects(g.api.resume(), /402/); assert.equal(g.requests.length, 0);
      }
    }
  });
  await test('same-page simultaneous revisions and legacy generations are mutually exclusive', async () => {
    const f = fixture(); let release; const hold = new Promise(resolve => { release = resolve; });
    f.intercept = async req => { if (req.url === V1 + 'image-to-image' && req.method === 'POST') await hold; };
    const first = f.api.reviseFromImage('First', OPTIONS); await tick();
    await assert.rejects(f.api.reviseFromImage('Second', OPTIONS), /already active/);
    await assert.rejects(f.api.generate('legacy dog'), /already active/);
    await assert.rejects(f.api.generateTexture('preview'), /already active/);
    await assert.rejects(f.api.resume(), /already active/);
    assert.equal(f.posts().length, 1); release(); await first; assert.equal(f.api.busy(), false);
  });
  await test('another card or tab keeps ownership of its pending task', async () => {
    const f = fixture(); f.seed({ id: 'other-paid-task', prompt: 'model', from: 'model' });
    await assert.rejects(f.api.reviseFromImage('Change dog', OPTIONS), /waiting to be recovered/);
    assert.equal(f.requests.length, 0); assert.equal(f.api.pending().id, 'other-paid-task');
    const g = fixture(); g.intercept = req => {
      if (req.url === V1 + 'image-to-image/edited-image') g.seed({ id: 'new-other-task', from: 'topper' });
    };
    await assert.rejects(g.api.reviseFromImage('Change dog', OPTIONS), /changed the saved Meshy task/);
    assert.equal(g.posts().length, 1); assert.equal(g.api.pending().id, 'new-other-task');
  });
  await test('competing image recovery in two pages cannot double-create the model', async () => {
    const seed = fixture(); seed.intercept = req => { if (req.url === V1 + 'image-to-image/edited-image') throw Error('stop after saved image'); };
    await assert.rejects(seed.api.reviseFromImage('Cute face', OPTIONS));
    const a = fixture(seed.storage), b = fixture(seed.storage); let release;
    const wait = new Promise(resolve => { release = resolve; });
    a.intercept = async req => { if (req.url === V1 + 'image-to-image/edited-image') await wait; };
    b.intercept = a.intercept;
    const ja = a.api.resume(), jb = b.api.resume(); await tick(); release();
    const results = await Promise.allSettled([ja, jb]);
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    assert.equal(a.posts().length + b.posts().length, 1);
    assert.equal(a.api.pending().id, 'revised-model');
  });
  await test('a task ID returned after another tab takes ownership is exposed without overwriting that tab', async () => {
    const f = fixture(); f.intercept = req => {
      if (req.url === V1 + 'image-to-image' && req.method === 'POST') f.seed({ id: 'other-tab-model', from: 'model' });
    };
    await assert.rejects(f.api.reviseFromImage('Round cheeks', OPTIONS), e => e.taskId === 'edited-image' && /edited-image/.test(e.message));
    assert.equal(f.api.pending().id, 'other-tab-model'); assert.equal(f.posts().length, 1);
  });
  await test('invalid input and unavailable key/storage stop before any paid request', async () => {
    const cases = [ ['', OPTIONS], ['x'.repeat(801), OPTIONS], ['Cute', { ...OPTIONS, imageDataUrl: 'https://external.invalid/ref.png' }],
      ['Cute', { ...OPTIONS, imageDataUrl: 'data:image/png;base64,abc!' }], ['Cute', { ...OPTIONS, polycount: 123 }],
      ['Cute', { ...OPTIONS, texture: 'true' }], ['Cute', { ...OPTIONS, from: 'other' }] ];
    for (const args of cases) { const f = fixture(); await assert.rejects(f.api.reviseFromImage(...args), /Nothing has been submitted/); assert.equal(f.requests.length, 0); assert.equal(f.api.pending(), null); }
    const noKey = fixture(); noKey.api.removeKey(); await assert.rejects(noKey.api.reviseFromImage('Cute', OPTIONS), /valid Meshy API key/); assert.equal(noKey.requests.length, 0);
    const noStore = fixture(); noStore.failWrite = () => true; await assert.rejects(noStore.api.reviseFromImage('Cute', OPTIONS), /site storage/); assert.equal(noStore.requests.length, 0);
  });
  await test('storage failure persisting a returned paid ID keeps the pre-POST uncertainty marker', async () => {
    for (const stage of ['image', 'model']) {
      const f = fixture(); f.failWrite = (key, value) => key === PENDING && JSON.parse(value).stage === stage;
      await assert.rejects(f.api.reviseFromImage('Cute', OPTIONS), e => e.recoveryNeeded && e.taskId === (stage === 'image' ? 'edited-image' : 'revised-model'));
      assert.equal(f.api.pending().stage, stage + '-submitting');
      const g = fixture(f.storage); await assert.rejects(g.api.resume(), /could not be verified/); assert.equal(g.requests.length, 0);
    }
  });
  await test('failed image tasks stop; failed model tasks preserve the paid reference without retry', async () => {
    for (const phase of ['image-to-image', 'image-to-3d']) {
      const f = fixture(); f.intercept = req => req.url.startsWith(V1 + phase + '/') ? reply({ id: phase === 'image-to-image' ? 'edited-image' : 'revised-model', status: 'FAILED', task_error: { message: 'inert failure' } }) : undefined;
      await assert.rejects(f.api.reviseFromImage('Cute', OPTIONS), /inert failure/);
      if (phase === 'image-to-image') assert.equal(f.api.pending(), null);
      else { assert.equal(f.api.pending().stage, 'blocked'); assert.equal(f.api.pending().imageId, 'edited-image'); }
    }
  });
  await test('malformed or mismatched image task output cannot trigger a paid model', async () => {
    for (const extra of [{ image_urls: [] }, { image_urls: ['one','two'] }, { image_urls: null }, { id: 'wrong-task' }, { id: null }, { status: 'UNRECOGNIZED' }]) {
      const f = fixture(); f.intercept = req => req.url === V1 + 'image-to-image/edited-image' ? reply({ id: 'edited-image', status: 'SUCCEEDED', image_urls: ['https://inert.invalid/ref.png'], ...extra }) : undefined;
      await assert.rejects(f.api.reviseFromImage('Cute', OPTIONS)); assert.equal(f.posts().length, 1); assert.equal(f.api.pending().id, 'edited-image');
    }
  });
  await test('asset delivery failure keeps the finished model for an uncharged retry', async () => {
    const f = fixture(); f.intercept = req => req.url === ASSET ? { ok: false, status: 403 } : undefined;
    await assert.rejects(f.api.reviseFromImage('Cute', OPTIONS), e => e.modelUrl === ASSET);
    assert.equal(f.api.pending().stage, 'model'); const g = fixture(f.storage); await g.api.resume(); assert.equal(g.posts().length, 0);
  });
  await test('legacy preview/refine behavior and legacy recovery still use only v2', async () => {
    const f = fixture(), old = await f.api.generate('legacy dog', { from: 'model', refine: true });
    assert.equal(f.posts().length, 2); assert.ok(f.requests.filter(r => r.url !== ASSET).every(r => r.url.startsWith(V2)));
    assert.equal(old.previewId, 'legacy-task'); assert.equal(old.refineId, 'legacy-task');
    assert.equal(f.api.pending().family, undefined);
    const g = fixture(f.storage), resumed = await g.api.resume(); assert.equal(g.posts().length, 0); assert.equal(resumed.refineId, 'legacy-task');
  });
  await test('unknown saved task families and stages never fall back to a different endpoint', async () => {
    const f = fixture(); f.seed({ id: 'future-task', family: 'future-api' });
    await assert.rejects(f.api.resume(), /unsupported family/); assert.equal(f.requests.length, 0); assert.equal(f.api.pending().id, 'future-task');
    await assert.rejects(f.api.task('id', '../../other'), /not supported/); assert.equal(f.requests.length, 0);
    const g = fixture(); await g.api.reviseFromImage('Cute', OPTIONS); const d = g.api.pending(); d.stage = 'future'; g.seed(d);
    const h = fixture(g.storage); await assert.rejects(h.api.resume(), /not recognized/); assert.equal(h.requests.length, 0);
  });
  console.log(JSON.stringify({ suite: 'meshy visual revision', groups: passed, serviceRequests: 0 }));
})().catch(e => { console.error(e); process.exitCode = 1; });
