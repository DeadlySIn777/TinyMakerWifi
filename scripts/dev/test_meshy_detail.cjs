'use strict';
// Production request and recovery code, with an inert transport and storage.
// No credentials, service calls, printer state, or paid tasks are involved.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const source = fs.readFileSync(path.resolve(__dirname, '../../web/parts/meshy.js'), 'utf8');
const API = 'https://api.meshy.ai/openapi/v2/text-to-3d';
const ASSET = 'https://inert.invalid/finished.glb';
const PENDING = 'tmMeshyPending';
const plain = value => JSON.parse(JSON.stringify(value));
function validGLB() { const b = new ArrayBuffer(24), d = new DataView(b); d.setUint32(0, 0x46546c67, true); d.setUint32(4, 2, true); d.setUint32(8, 24, true); d.setUint32(12, 4, true); d.setUint32(16, 0x4e4f534a, true); new Uint8Array(b,20).set([123,125,32,32]); return b; }
function fixture(storage = new Map()) {
  const calls = [];
  const reply = body => ({ ok: true, text: async () => JSON.stringify(body) });
  const f = { calls, storage, pollFailure: false, failPost: false };
  const ctx = {
    Promise, Date, setTimeout, console,
    localStorage: {
      getItem: name => storage.get(name) || null,
      setItem: (name, value) => storage.set(name, value),
      removeItem: name => storage.delete(name)
    },
    fetch: async (url, options = {}) => {
      calls.push({ url, method: options.method || 'GET',
        body: options.body ? JSON.parse(options.body) : null });
      if (options.method === 'POST') {
        if (f.failPost) throw new TypeError('Failed to fetch');
        if (f.beforePostResponse) await f.beforePostResponse();
        return reply({ result: 'inert-task' });
      }
      if (url === API + '/inert-task') {
        if (f.pollFailure) throw new Error('inert polling interruption');
        return reply({ status: 'SUCCEEDED', progress: 100, model_urls: { glb: ASSET } });
      }
      if (url === ASSET) return { ok: true, arrayBuffer: async () => validGLB() };
      throw new Error('Unexpected inert request: ' + url);
    }
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(source, ctx, { filename: 'meshy.js' });
  f.api = ctx.meshy;
  f.api.setKey('inert-request-test-sentinel');
  return f;
}
let count = 0;
async function test(name, run) {
  await run(); count++; console.log('PASS ' + name);
}
(async () => {
  await test('default preview pins standard Meshy 7 and leaves Ultra explicitly off', async () => {
    const f = fixture();
    assert.equal(await f.api.createPreview('inert cute dog'), 'inert-task');
    assert.deepEqual(f.calls, [{ url: API, method: 'POST', body: {
      mode: 'preview', prompt: 'inert cute dog', model_type: 'standard',
      ai_model: 'meshy-7', ultra_mode: false, should_remesh: true, target_polycount: 30000
    } }]);
  });
  await test('Ultra requests finer generation without dropping the bounded remesh target', async () => {
    const f = fixture();
    await f.api.createPreview('inert sculpted dog head', { ultra: true, polycount: 100000 });
    const body = f.calls[0].body;
    assert.equal(body.ultra_mode, true); assert.equal(body.ai_model, 'meshy-7');
    assert.equal(body.model_type, 'standard'); assert.equal(body.should_remesh, true);
    assert.equal(body.target_polycount, 100000);
    assert.equal(Object.hasOwn(body, 'decimation_mode'), false);
  });
  await test('explicit off remains off rather than becoming a truthy string', async () => {
    const f = fixture();
    await f.api.createPreview('inert dog', { ultra: false, polycount: 30000 });
    assert.equal(f.calls[0].body.ultra_mode, false);
  });
  await test('malformed Ultra values are refused before any network request or pending mutation', async () => {
    for (const ultra of ['true', 'false', 1, 0, null, undefined, [], {}]) {
      const f = fixture(); f.storage.set(PENDING, 'prior pending sentinel');
      await assert.rejects(f.api.createPreview('inert dog', { ultra }), /Ultra.*Nothing has been submitted/);
      assert.equal(f.calls.length, 0); assert.equal(f.storage.get(PENDING), 'prior pending sentinel');
    }
  });
  await test('inclusive polycount bounds are accepted with Ultra', async () => {
    for (const polycount of [100, 300000]) {
      const f = fixture(); await f.api.createPreview('inert dog', { ultra: true, polycount });
      assert.equal(f.calls[0].body.target_polycount, polycount);
    }
  });
  await test('invalid triangle targets never reach the paid endpoint', async () => {
    for (const polycount of [99, 300001, 30000.5, '100000', NaN, Infinity, -Infinity]) {
      const f = fixture();
      await assert.rejects(f.api.generate('inert dog', { ultra: true, polycount }), /polycount.*Nothing has been submitted/);
      assert.equal(f.calls.length, 0); assert.equal(f.api.pending(), null);
    }
  });
  await test('empty or oversized prompts still reject before POST', async () => {
    for (const prompt of ['', '   ', 'a'.repeat(801), null]) {
      const f = fixture();
      await assert.rejects(f.api.createPreview(prompt, { ultra: true }), /description.*Nothing has been submitted/);
      assert.equal(f.calls.length, 0);
    }
  });
  await test('local recipe and UI metadata do not leak into the service request', async () => {
    const f = fixture();
    await f.api.createPreview('inert dog', {
      ultra: true, polycount: 100000, from: 'keycap', designCode: 'TMK1-inert',
      refine: false, socketMm: 1.25, ai_model: 'unexpected', should_remesh: false
    });
    assert.deepEqual(Object.keys(f.calls[0].body).sort(), [
      'ai_model', 'mode', 'model_type', 'prompt', 'should_remesh', 'target_polycount', 'ultra_mode'
    ]);
    assert.equal(f.calls[0].body.ai_model, 'meshy-7'); assert.equal(f.calls[0].body.should_remesh, true);
  });
  await test('successful generation returns the chosen settings and clears only delivered pending work', async () => {
    const f = fixture();
    const result = await f.api.generate('inert dog', {
      ultra: true, polycount: 100000, refine: false, from: 'keycap', designCode: 'TMK1-inert'
    });
    assert.deepEqual(plain(result.opts), { ultra: true, polycount: 100000, refine: false, from: 'keycap' });
    assert.equal(result.designCode, 'TMK1-inert'); assert.equal(result.glb.byteLength, 24);
    assert.equal(f.api.pending().id, result.deliveryId);
    assert.equal(f.api.acknowledge(result.deliveryId), true);
    assert.equal(f.api.pending(), null);
    assert.equal(f.calls.filter(call => call.method === 'POST').length, 1);
  });
  await test('editor changes while POST is pending cannot rewrite the submitted option snapshot', async () => {
    const f = fixture(); f.pollFailure = true;
    const opts = { ultra: true, polycount: 100000, refine: false, from: 'keycap', designCode: 'TMK1-before' };
    f.beforePostResponse = () => {
      opts.ultra = false; opts.polycount = 30000; opts.designCode = 'TMK1-after';
    };
    await assert.rejects(f.api.generate('inert dog', opts), /polling interruption/);
    const saved = f.api.pending();
    assert.equal(saved.opts.ultra, true); assert.equal(saved.opts.polycount, 100000);
    assert.equal(saved.designCode, 'TMK1-before');
    assert.equal(f.calls[0].body.ultra_mode, true);
  });
  for (const ultra of [true, false]) await test('interrupted Ultra ' + ultra + ' request resumes without a second paid POST', async () => {
    const first = fixture(); first.pollFailure = true;
    await assert.rejects(first.api.generate('inert dog', {
      ultra, polycount: 100000, refine: false, from: 'keycap', designCode: 'TMK1-inert'
    }), /polling interruption/);
    assert.equal(first.api.pending().opts.ultra, ultra);
    const next = fixture(first.storage), result = await next.api.resume();
    assert.equal(result.resumed, true); assert.equal(result.opts.ultra, ultra);
    assert.equal(result.opts.polycount, 100000); assert.equal(result.designCode, 'TMK1-inert');
    assert.equal(result.glb.byteLength, 24); assert.equal(next.api.pending().id, result.deliveryId); assert.equal(next.api.acknowledge(result.deliveryId), true); assert.equal(next.api.pending(), null);
    assert.deepEqual(next.calls.map(call => call.method), ['GET', 'GET']);
  });
  await test('legacy pending work without Ultra is resumed unchanged rather than recreated on Meshy 7', async () => {
    const f = fixture();
    f.storage.set(PENDING, JSON.stringify({ id: 'inert-task', prompt: 'legacy dog', at: Date.now(),
      opts: { polycount: 30000, from: 'keycap' } }));
    const result = await f.api.resume();
    assert.deepEqual(plain(result.opts), { polycount: 30000, from: 'keycap' });
    assert.equal(f.calls.some(call => call.method === 'POST'), false);
  });
  await test('lost Ultra POST response keeps credit uncertainty and never retries automatically', async () => {
    const f = fixture(); f.failPost = true;
    await assert.rejects(f.api.generate('inert dog', { ultra: true }), /may have reached Meshy and used credits/);
    assert.equal(f.calls.length, 1); assert.equal(f.api.pending(), null);
  });
  await test('refine remains a separate texture request and does not inherit preview-only Ultra fields', async () => {
    const f = fixture(); await f.api.refine('inert-preview-id');
    assert.deepEqual(f.calls[0].body, { mode: 'refine', preview_task_id: 'inert-preview-id' });
  });
  console.log(count + ' Meshy detail/request checks passed; no live requests.');
})().catch(error => { console.error(error); process.exitCode = 1; });
