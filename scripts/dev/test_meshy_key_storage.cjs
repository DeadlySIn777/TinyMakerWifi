'use strict';
// Actual production persistence and UI handlers. Only inert in-memory keys;
// no browser profiles, real credentials, printer or external network are used.
const fs = require('node:fs'), path = require('node:path');
const vm = require('node:vm'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../..');
const read = name => fs.readFileSync(path.join(root, 'web/parts', name), 'utf8');
const KEY = 'tmMeshyKey', ORIGINAL = 'inert-original-sentinel', REPLACEMENT = 'inert-replacement-sentinel';
function fixture(shared = new Map()) {
  const nodes = new Map(), calls = [], events = {};
  const faults = { read: false, write: false, remove: false, dropWrite: false };
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, {
      value: '', textContent: '', disabled: false, style: {}, handlers: {},
      addEventListener(type, fn) { this.handlers[type] = fn; }
    });
    return nodes.get(id);
  };
  const ctx = {
    Promise, Date, console,
    document: { getElementById: node },
    confirm: () => { calls.push('confirm'); return ctx.confirmResult; }, confirmResult: false,
    addEventListener: (type, fn) => { events[type] = fn; },
    localStorage: {
      getItem(k) { if (faults.read) throw Error('inert read error containing '+ORIGINAL); return shared.get(k) || null; },
      setItem(k, value) {
        calls.push('write');
        if (faults.write) throw Error('inert write error containing '+value);
        if (!faults.dropWrite) shared.set(k, value);
      },
      removeItem(k) { calls.push('remove'); if (faults.remove) throw Error('inert remove error '+ORIGINAL); shared.delete(k); }
    },
    fetch: async url => {
      calls.push(url.includes('cloudflare-dns') ? 'dns' : 'api');
      return { ok: true, json: async () => ({ Answer: [{ data: 'inert-address' }] }), text: async () => '{"result":[]}' };
    }
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(read('meshy.js'), ctx, { filename: 'meshy.js' });
  vm.runInContext(read('meshy-ui.js'), ctx, { filename: 'meshy-ui.js' });
  const click = id => node(id).handlers.click();
  const messages = () => [...nodes.values()].map(n => n.textContent).join('\n');
  return { api: ctx.meshy, ctx, node, click, shared, calls, faults, events, messages };
}
const flush = () => new Promise(setImmediate);
let count = 0;
async function test(name, fn) { await fn(); count++; console.log('PASS '+name); }
(async () => {
  await test('visible presence and separate Remove action are present without exposing a key', () => {
    const html = read('meshy-card.html');
    assert.match(html, /id='meshyKeyStatus'/); assert.match(html, /id='meshyKeyRemove'/);
    const f = fixture(new Map([[KEY, ORIGINAL]]));
    assert.match(f.node('meshyKeyStatus').textContent, /Key saved/);
    assert.equal(f.node('meshyKey').value, ''); assert.equal(f.node('meshyKeyRemove').disabled, false);
    assert.ok(!f.messages().includes(ORIGINAL));
  });
  await test('successful Save clears only the input; immediate second Save preserves the key', () => {
    const f = fixture(); f.node('meshyKey').value = ORIGINAL;
    f.click('meshyKeySave'); f.click('meshyKeySave');
    assert.equal(f.shared.get(KEY), ORIGINAL); assert.equal(f.node('meshyKey').value, '');
    assert.match(f.node('meshyInfo').textContent, /unchanged/);
    assert.equal(f.calls.filter(x => x === 'write').length, 1); assert.ok(!f.calls.includes('remove'));
    assert.ok(!f.messages().includes(ORIGINAL));
  });
  await test('same-origin script reload retains the saved key and shows its presence', () => {
    const f = fixture(); f.api.setKey(ORIGINAL);
    const next = fixture(f.shared);
    assert.equal(next.api.hasKey(), true); assert.match(next.node('meshyKeyStatus').textContent, /Key saved/);
    next.click('meshyKeySave'); assert.equal(next.shared.get(KEY), ORIGINAL);
  });
  await test('blank or formatting-only Save never removes an existing key or invents a save', () => {
    const f = fixture(new Map([[KEY, ORIGINAL]]));
    for (const value of ['', '  ', '\u200b']) { f.node('meshyKey').value = value; f.click('meshyKeySave'); }
    assert.equal(f.shared.get(KEY), ORIGINAL); assert.ok(!f.calls.includes('remove'));
    const empty = fixture(); empty.node('meshyKey').value = '\u200b'; empty.click('meshyKeySave');
    assert.equal(empty.api.hasKey(), false); assert.match(empty.node('meshyInfo').textContent, /Paste a Meshy API key/);
  });
  await test('invalid replacement refuses before mutation and preserves the original', () => {
    const f = fixture(new Map([[KEY, ORIGINAL]]));
    for (const value of ['q7z9', 'invalid\nheader-sentinel', 'invalid-key-\u2603']) {
      f.node('meshyKey').value = value; f.click('meshyKeySave');
      assert.equal(f.shared.get(KEY), ORIGINAL); assert.equal(f.node('meshyKey').value, value);
      assert.ok(!f.messages().includes(ORIGINAL)); assert.ok(!f.messages().includes(value));
    }
    assert.ok(!f.calls.includes('write'));
  });
  await test('storage write failure is actionable and leaves the old key and entered replacement intact', () => {
    const f = fixture(new Map([[KEY, ORIGINAL]])); f.faults.write = true;
    f.node('meshyKey').value = REPLACEMENT; f.click('meshyKeySave');
    assert.equal(f.shared.get(KEY), ORIGINAL); assert.equal(f.node('meshyKey').value, REPLACEMENT);
    assert.match(f.node('meshyInfo').textContent, /Cannot save.*Allow site storage/);
    assert.ok(!f.messages().includes(ORIGINAL)); assert.ok(!f.messages().includes(REPLACEMENT));
  });
  await test('storage read failure is not treated as a missing key and prevents a replacement write', async () => {
    const f = fixture(new Map([[KEY, ORIGINAL]])); f.faults.read = true;
    assert.doesNotThrow(() => f.api.hasKey()); assert.equal(f.api.hasKey(), false);
    assert.equal(f.api.keyStatus().available, false);
    f.node('meshyKey').value = REPLACEMENT; f.click('meshyKeySave');
    assert.equal(f.shared.get(KEY), ORIGINAL); assert.ok(!f.calls.includes('write'));
    assert.match(f.node('meshyInfo').textContent, /Cannot read.*Allow site storage/);
    const result = await f.api.probe(); assert.match(result.verdict, /Cannot read/);
    assert.equal(result.meshy, 'storage unavailable'); assert.ok(!f.calls.includes('api'));
    await assert.rejects(f.api.createPreview('an inert cat', { polycount: 30000 }), /Cannot read/);
    assert.ok(!f.messages().includes(ORIGINAL)); assert.ok(!f.messages().includes(REPLACEMENT));
  });
  await test('Remove canceled preserves key and does not touch storage', () => {
    const f = fixture(new Map([[KEY, ORIGINAL]])); f.click('meshyKeyRemove');
    assert.equal(f.shared.get(KEY), ORIGINAL); assert.deepEqual(f.calls, ['confirm']);
  });
  await test('Remove confirmed deletes key, clears input and refreshes status', () => {
    const f = fixture(new Map([[KEY, ORIGINAL]])); f.ctx.confirmResult = true;
    f.node('meshyKey').value = REPLACEMENT; f.click('meshyKeyRemove');
    assert.equal(f.api.hasKey(), false); assert.equal(f.node('meshyKey').value, '');
    assert.match(f.node('meshyInfo').textContent, /removed/); assert.equal(f.node('meshyKeyRemove').disabled, true);
    assert.equal(f.calls.filter(x => x === 'remove').length, 1);
  });
  await test('Remove failure does not claim success or expose the underlying storage error', () => {
    const f = fixture(new Map([[KEY, ORIGINAL]])); f.ctx.confirmResult = true; f.faults.remove = true;
    f.click('meshyKeyRemove'); assert.equal(f.shared.get(KEY), ORIGINAL);
    assert.match(f.node('meshyInfo').textContent, /Cannot remove/); assert.ok(!f.messages().includes(ORIGINAL));
  });
  await test('an unretained write is detected; existing key stays intact and Save reports failure', () => {
    const f = fixture(new Map([[KEY, ORIGINAL]])); f.faults.dropWrite = true;
    f.node('meshyKey').value = REPLACEMENT; f.click('meshyKeySave');
    assert.equal(f.shared.get(KEY), ORIGINAL); assert.match(f.node('meshyInfo').textContent, /Cannot verify/);
    assert.equal(f.node('meshyKey').value, REPLACEMENT);
  });
  await test('Test checks saved state with no Save, sends no generation and refreshes status', async () => {
    const f = fixture(new Map([[KEY, ORIGINAL]])); f.click('meshyTest'); await flush(); await flush();
    assert.match(f.node('meshyProbe').textContent, /key works.*key stored/);
    assert.deepEqual(f.calls, ['dns', 'api']); assert.equal(f.node('meshyTest').disabled, false);
    assert.ok(!f.messages().includes(ORIGINAL));
  });
  await test('Test reports storage unavailable instead of key missing and re-enables itself', async () => {
    const f = fixture(); f.faults.read = true; f.click('meshyTest'); await flush(); await flush();
    assert.match(f.node('meshyProbe').textContent, /key storage unavailable/);
    assert.doesNotMatch(f.node('meshyProbe').textContent, /key missing/);
    assert.equal(f.node('meshyTest').disabled, false); assert.equal(f.node('meshyKeyRemove').disabled, true);
  });
  await test('another tab changing this key refreshes presence without loading its value into the input', () => {
    const f = fixture(); f.shared.set(KEY, ORIGINAL); f.events.storage({ key: KEY });
    assert.match(f.node('meshyKeyStatus').textContent, /Key saved/); assert.equal(f.node('meshyKey').value, '');
    f.shared.delete(KEY); f.events.storage({ key: KEY });
    assert.match(f.node('meshyKeyStatus').textContent, /No key saved/);
  });
  await test('lost generation response acknowledges unknown completion and credits before any retry', async () => {
    const f = fixture(new Map([[KEY, ORIGINAL]])); let requests = 0;
    f.ctx.fetch = async () => { requests++; throw new TypeError('Failed to fetch'); };
    await assert.rejects(f.api.createPreview('an inert cat', { polycount: 100000 }), error => {
      assert.match(error.message, /may have reached Meshy and used credits/);
      assert.match(error.message, /task history before generating again/);
      assert.match(error.message, /CORS/);
      assert.doesNotMatch(error.message, /nothing was sent|nothing was charged|never left|never CORS/);
      assert.equal(error.offline, true); return true;
    });
    assert.equal(requests, 1);
  });
  await test('failed diagnostics do not assert a specific internet or blocking cause', async () => {
    const f = fixture(new Map([[KEY, ORIGINAL]]));
    f.ctx.fetch = async () => { throw new TypeError('Failed to fetch'); };
    const dnsFailure = await f.api.probe();
    assert.match(dnsFailure.verdict, /could not complete.*does not prove/);
    f.ctx.fetch = async url => {
      if (url.includes('cloudflare-dns')) return { ok: true, json: async () => ({ Answer: [{}] }) };
      throw new TypeError('Failed to fetch');
    };
    const serviceFailure = await f.api.probe();
    assert.match(serviceFailure.verdict, /could not be reached.*service status/);
    assert.doesNotMatch(serviceFailure.verdict, /is blocked/);
  });
  await test('pending generation and resumed result preserve only bounded local recipe metadata', async () => {
    const source = read('meshy.js'), begin = source.indexOf("  var PENDING = 'tmMeshyPending';");
    const end = source.indexOf('  function generate(prompt, opts, ui)', begin);
    assert.ok(begin > 0 && end > begin);
    const memory = new Map();
    const ctx = {
      Date, Promise, validTaskId: id => typeof id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(id),
      localStorage: { getItem: k => memory.get(k) || null, setItem: (k,v) => memory.set(k,v), removeItem: k => memory.delete(k) },
      waitFor: async id => ({ id, status: 'SUCCEEDED' }), fetchModel: async () => new ArrayBuffer(8)
    };
    vm.createContext(ctx); vm.runInContext(source.slice(begin, end), ctx);
    const SH = require(path.join(root, 'web/parts/keycap-share.js'));
    const design = { profile:'DSA',row:'R3',sizeU:1,legendOn:false,sculptHeightMm:19,meshyPolycount:100000,sculptStyle:'cuteartisan',prompt:'inert kitten' };
    const code = SH.encode(design);
    ctx.remember('inert-task', 'inert prompt', { from:'keycap',polycount:100000,designCode:code });
    assert.equal(ctx.pending().designCode, code);
    assert.equal(JSON.parse(memory.get('tmMeshyPending')).opts.designCode, undefined);
    const resumed = await ctx.resume(); assert.equal(resumed.designCode, code);
    assert.deepEqual(SH.decode(resumed.designCode), design); assert.equal(ctx.pending().id, resumed.deliveryId); assert.equal(ctx.acknowledge(resumed.deliveryId), true); assert.equal(ctx.pending(), null);
    for (const invalid of ['TMK1-'+ 'a'.repeat(4096), 'not-a-code', { key:'inert' }]) {
      ctx.remember('inert-task', 'inert prompt', { from:'keycap',designCode:invalid });
      assert.equal(ctx.pending().designCode, null);
    }
    memory.set('tmMeshyPending', JSON.stringify({id:'legacy',at:Date.now(),opts:{from:'keycap',designCode:code}}));
    assert.equal(ctx.pending().designCode, code);
    memory.set('tmMeshyPending', JSON.stringify({id:'legacy-no-code',at:Date.now()}));
    assert.equal((await ctx.resume()).designCode, null);
  });
  await test('local pending recipe metadata is never added to the Meshy API payload', async () => {
    const f = fixture(new Map([[KEY, ORIGINAL]])); let body;
    f.ctx.fetch = async (url, opts) => { body = JSON.parse(opts.body); return {ok:true,text:async () => '{"result":"inert-id"}'}; };
    await f.api.createPreview('inert cat', {polycount:100000,designCode:'TMK1-inertSentinel'});
    assert.equal(body.designCode, undefined); assert.equal(body.target_polycount, 100000);
    assert.equal(body.prompt, 'inert cat');
  });
  console.log('\n'+count+' Meshy key persistence groups passed. All credentials and network responses were inert fixtures.');
})().catch(error => { console.error(error); process.exitCode = 1; });
