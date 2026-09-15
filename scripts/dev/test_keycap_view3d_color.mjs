/* Pixel tests for paint references. The canvas stores the actual software
   renderer output: no screenshot comparison, browser, printer or paid API. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
global.window = { devicePixelRatio: 1, addEventListener() {} };
global.requestAnimationFrame = () => 0;
global.cancelAnimationFrame = () => {};
const V = require('../../web/parts/keycap-view3d.js');

function canvas() {
  const data = new Uint8ClampedArray(240 * 240 * 4);
  const ctx = {
    clearRect() { data.fill(0); }, save() {}, restore() {}, beginPath() {},
    moveTo() {}, lineTo() {}, fill() {}, getImageData() { return { data }; }, putImageData() {},
  };
  return { width: 240, height: 240, clientWidth: 240, clientHeight: 240,
    getContext: () => ctx, addEventListener() {}, data };
}
function block(width, depth, z0, z1) {
  const x = width / 2, y = depth / 2;
  const p = [[-x,-y,z0],[x,-y,z0],[x,y,z0],[-x,y,z0],[-x,-y,z1],[x,-y,z1],[x,y,z1],[-x,y,z1]];
  const faces = [[0,3,2,1],[4,5,6,7],[0,1,5,4],[1,2,6,5],[2,3,7,6],[3,0,4,7]];
  return new Float32Array(faces.flatMap(([a,b,c,d]) => [...p[a],...p[b],...p[c],...p[a],...p[c],...p[d]]));
}
const base = block(18, 18, 0, 8), art = block(12, 12, -8, 0);
const combined = new Float32Array(base.length + art.length);
combined.set(base); combined.set(art, base.length);
const original = new Float32Array(combined);
const c = canvas(), v = V.attach(c, { spin: false, az: -0.62, el: 0.52 });
const pixels = () => new Uint8ClampedArray(c.data);
function dominant(channel) {
  let n = 0;
  for (let i = 0; i < c.data.length; i += 4)
    if (c.data[i+3] && c.data[i+channel] > c.data[i+(channel+1)%3]+25 &&
        c.data[i+channel] > c.data[i+(channel+2)%3]+25) n++;
  return n;
}
let passed = 0;
function check(name, run) { run(); passed++; console.log('PASS ' + name); }

v.setMesh(combined);
const legacy = pixels();
check('solid view renders and color round trip preserves every pixel', () => {
  assert.ok(legacy.filter((n, i) => i % 4 === 3 && n === 255).length > 3000);
  v.setAppearance({ mode: 'color', base: '#e82331', art: '#2565ed' });
  v.setMesh(combined, { artStart: base.length });
  assert.ok(dominant(0) > 500, 'base is red');
  assert.ok(dominant(2) > 500, 'art is blue');
  assert.notDeepEqual(pixels(), legacy);
  v.setAppearance({ mode: 'solid' });
  assert.deepEqual(pixels(), legacy);
});
check('appearance never modifies geometry, normals, camera or caller data', () => {
  const pos = v.pos, nrm = v.nrm, az = v.az, el = v.el, height = v.height;
  v.setAppearance({ mode: 'color', base: '#e82331', art: '#2565ed' });
  assert.equal(v.pos, pos); assert.equal(v.nrm, nrm);
  assert.equal(v.az, az); assert.equal(v.el, el); assert.equal(v.height, height);
  assert.deepEqual(combined, original);
});
check('material boundary is an exact triangle-aligned float offset', () => {
  for (const artStart of [-9, 1, 3, 9.5, Infinity, NaN, '108', combined.length+9]) {
    v.setMesh(combined, { artStart });
    assert.equal(v.artStart, null);
    assert.equal(dominant(2), 0);
  }
  v.setMesh(combined, { artStart: 0 });
  assert.equal(dominant(0), 0); assert.ok(dominant(2) > 1000);
  v.setMesh(combined, { artStart: combined.length });
  assert.ok(dominant(0) > 1000); assert.equal(dominant(2), 0);
});
check('loading a plain cap clears previous artwork and source color metadata', () => {
  v.setMesh(combined, { artStart: 0, artColors: new Float32Array(combined.length).fill(0.5) });
  assert.ok(v.artColors);
  v.setMesh(base);
  assert.equal(v.artStart, null); assert.equal(v.artColors, null);
  assert.ok(dominant(0) > 1000); assert.equal(dominant(2), 0);
});
check('linear source RGB is encoded once and agrees with matching sRGB paint', () => {
  const grayLinear = Math.pow((128/255 + 0.055)/1.055, 2.4);
  const source = new Float32Array(art.length).fill(grayLinear), copy = new Float32Array(source);
  v.setAppearance({ mode: 'color', art: '#808080', useSourceColors: false });
  v.setMesh(combined, { artStart: base.length, artColors: source });
  const uniform = pixels();
  v.setAppearance({ useSourceColors: true });
  // Float32 source precision may move a channel by one quantization step.
  assert.ok(pixels().every((n, i) => Math.abs(n - uniform[i]) <= 1));
  assert.deepEqual(source, copy);
});
check('source RGB follows corners and interpolates within a triangle', () => {
  const triangle = new Float32Array([-1,-1,0, 1,-1,0, 0,1,0]);
  const colors = new Float32Array([1,0,0, 0,1,0, 0,0,1]);
  v.setMesh(triangle, { artStart: 0, artColors: colors });
  assert.ok(dominant(0) > 10); assert.ok(dominant(1) > 10); assert.ok(dominant(2) > 10);
  let mixed = 0;
  for (let i = 0; i < c.data.length; i += 4)
    if (c.data[i+3] && c.data[i]>70 && c.data[i+1]>70 && c.data[i+2]>70) mixed++;
  assert.ok(mixed > 50, 'interior must blend vertex colors instead of painting a flat face');
  const rotatedColors = new Float32Array([0,0,1, 1,0,0, 0,1,0]), before = pixels();
  v.setMesh(triangle, { artStart: 0, artColors: rotatedColors });
  assert.notDeepEqual(pixels(), before, 'per-corner indexing controls visible placement');
});
check('turning original model colors off uses the selected artwork paint', () => {
  v.setAppearance({ art: '#2565ed', useSourceColors: true });
  const green = new Float32Array(art.length);
  for (let i = 1; i < green.length; i += 3) green[i] = 1;
  v.setMesh(combined, { artStart: base.length, artColors: green });
  assert.ok(dominant(1) > 500); assert.equal(dominant(2), 0);
  v.setAppearance({ useSourceColors: false });
  assert.equal(dominant(1), 0); assert.ok(dominant(2) > 500);
  v.setAppearance({ mode: 'solid', useSourceColors: true });
  assert.deepEqual(pixels(), legacy);
});
check('invalid source colors fall back to artwork paint without corrupt pixels', () => {
  v.setAppearance({ mode: 'color', art: '#2565ed', useSourceColors: true });
  const bad = [new Float32Array(art.length-3)];
  for (const val of [NaN, Infinity, -1, 1.1, '0.5']) {
    const colors = Array(art.length).fill(0.5); colors[4] = val; bad.push(colors);
  }
  for (const artColors of bad) {
    v.setMesh(combined, { artStart: base.length, artColors });
    assert.equal(v.artColors, null); assert.ok(dominant(2) > 500);
  }
});
check('invalid appearance input preserves the valid state and draw can be deferred', () => {
  const state = { ...v.appearance }, before = pixels();
  v.setAppearance({ mode: 'fake', base: 'url(secret)', art: [300,-1,0], useSourceColors: 'false' });
  assert.deepEqual(v.appearance, state); assert.deepEqual(pixels(), before);
  assert.equal(v.setAppearance({ base: '#00FF00' }, { draw: false }), v);
  assert.equal(v.appearance.base, '#00ff00'); assert.deepEqual(pixels(), before);
  v.draw(); assert.notDeepEqual(pixels(), before);
});
check('empty mesh clears color regions and pixels without losing appearance', () => {
  assert.equal(v.setMesh(null), v);
  assert.equal(v.pos, null); assert.equal(v.nrm, null); assert.equal(v.artStart, null); assert.equal(v.artColors, null);
  assert.ok(c.data.every(n => n === 0)); assert.equal(v.appearance.mode, 'color');
});
check('static paint guide captures never register canvas or global event handlers', () => {
  let handlers = 0;
  const originalGlobalListener = global.window.addEventListener;
  global.window.addEventListener = () => { handlers++; };
  try {
    for (let i = 0; i < 4; i++) {
      const c = canvas(); c.addEventListener = () => { handlers++; };
      V.attach(c, { spin: false, interactive: false }).setMesh(combined);
      assert.ok(c.data.some(n => n > 0));
    }
    assert.equal(handlers, 0);
  } finally { global.window.addEventListener = originalGlobalListener; }
});
console.log(`${passed} color reference renderer groups passed.`);
