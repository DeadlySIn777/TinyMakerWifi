/* Tests for web/parts/keycap-view3d.js - node scripts/dev/test_keycap_view3d.mjs
 *
 * WHY THESE TESTS EXIST. Writing this renderer produced three bugs that every
 * other kind of test would have sailed past, because each one is a SIGN and the
 * code runs perfectly with all of them wrong:
 *
 *   1. the back-face cull kept the wrong half, so you saw the inside of the cap
 *   2. the key light pointed away from the camera, so the cap rendered near
 *      black while its hidden back face lit up
 *   3. positive elevation looked UP from underneath, into the stem cavity
 *
 * All three were found by rendering and looking. These tests pin the
 * conventions so they cannot quietly come back: each asserts a property of the
 * finished image that only holds when the sign is right.
 *
 * The canvas is a stub - just enough 2d context to run the rasteriser.
 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

function makeCanvas(w, h) {
  const buf = new Uint8ClampedArray(w * h * 4);
  const ctx = {
    _d: buf, filter: '', globalAlpha: 1, fillStyle: '',
    clearRect() { buf.fill(0); },
    save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() {}, fill() {},
    getImageData(x, y, ww, hh) { return { data: buf, width: ww, height: hh }; },
    putImageData() {},
  };
  return { width: w, height: h, clientWidth: w, clientHeight: h,
           getContext: () => ctx, addEventListener() {}, _ctx: ctx };
}
global.window = { devicePixelRatio: 1, addEventListener() {} };
global.requestAnimationFrame = () => 0;
global.cancelAnimationFrame = () => {};

require('../../web/parts/mesh-health.js');
const K = require('../../web/parts/keycap.js');
const V = require('../../web/parts/keycap-view3d.js');

let pass = 0, fail = 0;
const ok = (n, got, want) => {
  const good = String(got) === String(want);
  console.log(`  ${good ? 'OK  ' : 'FAIL'} ${n}: got ${got}, want ${want}`);
  good ? pass++ : fail++;
};
const truthy = (n, v, detail) => {
  console.log(`  ${v ? 'OK  ' : 'FAIL'} ${n}${detail ? ' (' + detail + ')' : ''}`);
  v ? pass++ : fail++;
};
const near = (n, got, want, tol) => {
  const good = Math.abs(got - want) <= tol;
  console.log(`  ${good ? 'OK  ' : 'FAIL'} ${n}: got ${got}, want ${want} +/-${tol}`);
  good ? pass++ : fail++;
};

const S = 240;
function render(mesh, o) {
  const cv = makeCanvas(S, S);
  const v = V.attach(cv, Object.assign({ az: -0.62, el: 0.52, spin: false, dist: 3.0 }, o || {}));
  v.setMesh(mesh);
  v.draw();
  return cv._ctx._d;
}
function stats(d) {
  let lit = 0, sum = 0, minY = 1e9, maxY = -1e9;
  const rowW = new Array(S).fill(0);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const o = (y * S + x) * 4;
    if (!d[o + 3]) continue;
    lit++; sum += (d[o] + d[o + 1] + d[o + 2]) / 3;
    rowW[y]++;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { lit, mean: lit ? sum / lit : 0, rowW, minY, maxY };
}

const cap = K.build({ profile: 'XDA', row: 'R3', sizeU: 1, topGrid: 31 });

console.log('\nnormals: creases stay sharp, curves go smooth');
/* A cube: every corner meets three faces at 90 degrees, all well past the
   crease threshold, so each corner normal must equal its own face normal. If
   the threshold were ignored they would average to a corner-pointing vector
   and the cube would look like a beach ball. */
function cube() {
  const c = [[-1,-1,-1],[1,-1,-1],[1,1,-1],[-1,1,-1],[-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1]];
  const q = (a,b,cc,d) => [[c[a],c[b],c[cc]],[c[a],c[cc],c[d]]];
  const t = [].concat(q(0,3,2,1), q(4,5,6,7), q(0,1,5,4), q(1,2,6,5), q(2,3,7,6), q(3,0,4,7));
  const f = new Float32Array(t.length * 9);
  t.forEach((tr, i) => tr.flat().forEach((v, j) => { f[i * 9 + j] = v; }));
  return f;
}
const cn = V.weldNormals(cube());
let axisAligned = 0;
for (let i = 0; i < cn.length; i += 3) {
  const m = Math.max(Math.abs(cn[i]), Math.abs(cn[i+1]), Math.abs(cn[i+2]));
  if (m > 0.999) axisAligned++;
}
ok('every cube corner normal stays axis-aligned', axisAligned, cn.length / 3);

const capN = V.weldNormals(cap.positions);
let unit = 0;
for (let i = 0; i < capN.length; i += 3)
  if (Math.abs(Math.hypot(capN[i], capN[i+1], capN[i+2]) - 1) < 1e-3) unit++;
ok('and every cap normal is unit length', unit, capN.length / 3);
// the dish is smooth, so its normals must NOT all be axis aligned
let varied = 0;
for (let i = 0; i < capN.length; i += 3) {
  const m = Math.max(Math.abs(capN[i]), Math.abs(capN[i+1]), Math.abs(capN[i+2]));
  if (m < 0.999) varied++;
}
truthy('the dish is smoothed, not faceted', varied > capN.length / 3 * 0.2,
  varied + ' of ' + (capN.length / 3) + ' corners carry a blended normal');

console.log('\nthe light points at the camera, not away from it');
/* Bug 2: with lz positive the cap rendered near black. A lit mean below about
   40 means the light is behind the object again. */
const front = stats(render(cap.positions));
truthy('something is actually drawn', front.lit > S * S * 0.08, (front.lit / (S*S) * 100).toFixed(1) + '% covered');
truthy('and it is lit, not black', front.mean > 60, 'mean ' + front.mean.toFixed(0));
truthy('and not blown out', front.mean < 215, 'mean ' + front.mean.toFixed(0));

console.log('\nthe cap is the right way up');
/* Bug 3, and the one that matters most. Two separate signs decide it: setMesh
   turns the model over (the engine builds +Z from the top face DOWN to the
   mouth) and the camera negates elevation so positive means looking down. Test
   them one at a time through the camera rather than by guessing at the
   silhouette - a rotated square is pointy at BOTH ends, so measuring how wide
   the top and bottom rows are proves nothing at all. */
const probe = makeCanvas(S, S);
const pv = V.attach(probe, { az: 0, el: 0.52, spin: false, dist: 3.0 });
pv.setMesh(cap.positions);

// which display-z did the cap's top face (engine z = 0) end up at?
let engMinZ = Infinity, engMaxZ = -Infinity;
for (let i = 2; i < cap.positions.length; i += 3) {
  if (cap.positions[i] < engMinZ) engMinZ = cap.positions[i];
  if (cap.positions[i] > engMaxZ) engMaxZ = cap.positions[i];
}
let dispAtEngMin = -Infinity, dispAtEngMax = Infinity;
for (let i = 0; i < cap.positions.length; i += 3) {
  if (Math.abs(cap.positions[i + 2] - engMinZ) < 1e-4) dispAtEngMin = Math.max(dispAtEngMin, pv.pos[i + 2]);
  if (Math.abs(cap.positions[i + 2] - engMaxZ) < 1e-4) dispAtEngMax = Math.min(dispAtEngMax, pv.pos[i + 2]);
}
truthy('setMesh turns the cap over: the top face ends up highest',
  dispAtEngMin > dispAtEngMax,
  'top face at display z ' + dispAtEngMin.toFixed(3) + ', mouth at ' + dispAtEngMax.toFixed(3));
ok('and the mouth sits on the ground plane', Math.round(dispAtEngMax * 1000) / 1000, 0);

// with a positive elevation, higher in the world must be higher on screen
const hiPt = pv.project(0, 0, 0.5);
const loPt = pv.project(0, 0, 0.0);
truthy('a positive elevation looks DOWN, so up is up on screen',
  hiPt[1] < loPt[1],
  'cap top at screen y ' + hiPt[1].toFixed(0) + ', base at ' + loPt[1].toFixed(0));

/* The camera orbits on the +Y side, so display +Y is the NEAR side and lands
   lower on screen when looking down. This is the convention the whole file
   hangs off: it is why setMesh sends the board's BACK to display -Y, which is
   what puts the cap's front towards the viewer. */
const nearPt = pv.project(0, 0.5, 0.2);
const farPt = pv.project(0, -0.5, 0.2);
truthy('+Y is the near side and sits lower on screen',
  nearPt[1] > farPt[1],
  'near y ' + nearPt[1].toFixed(0) + ' vs far y ' + farPt[1].toFixed(0));
truthy('and the near side is genuinely closer to the camera',
  nearPt[2] < farPt[2],
  'depth ' + nearPt[2].toFixed(2) + ' vs ' + farPt[2].toFixed(2));

/* setMesh must therefore send the board's back edge to display -Y, or the
   default view is of the back of the cap and a sculpted row leans backwards. */
let engBackY = -Infinity, idxBack = -1;
for (let i = 1; i < cap.positions.length; i += 3)
  if (cap.positions[i] > engBackY) { engBackY = cap.positions[i]; idxBack = i; }
truthy('the board\'s back edge ends up on the far side',
  pv.pos[idxBack] < 0,
  'engine y ' + engBackY.toFixed(1) + ' -> display y ' + pv.pos[idxBack].toFixed(3));

// flipping elevation must swap which side is near
const sgnUp = Math.sign(pv.project(0, 0.5, 0.2)[1] - pv.project(0, -0.5, 0.2)[1]);
pv.el = -0.52;
const sgnDown = Math.sign(pv.project(0, 0.5, 0.2)[1] - pv.project(0, -0.5, 0.2)[1]);
pv.el = 0.52;
ok('flipping elevation swaps near for far', sgnDown, -sgnUp);

console.log('\nthe camera actually moves');
/* A square cap has four-fold symmetry, so a 90 degree turn looks almost
   identical and proves nothing. Turn 45 degrees, and use a cap carrying an
   asymmetric legend so there is something to tell apart. */
const I = require('../../web/parts/keycap-icons.js');
const legended = K.build({
  profile: 'XDA', row: 'R3', sizeU: 1, topGrid: 31,
  relief: I.makeRelief({ icon: 'ifak', digit: '1' }, { depth: 0.55, raised: true })
}).positions;
const b0 = render(legended, { az: -0.62 });
const b1 = render(legended, { az: -0.62 + Math.PI / 4 });
let moved = 0;
for (let i = 0; i < b0.length; i += 4) if (Math.abs(b0[i] - b1[i]) > 8) moved++;
truthy('a 45 degree turn changes the image', moved > S * S * 0.04,
  (moved / (S * S) * 100).toFixed(1) + '% of pixels changed');

/* Straight down, the silhouette collapses to the cap footprint, which is
   square - so its bounding box must be close to 1:1. At a 3/4 angle it is not. */
function bbox(d) {
  let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    if (!d[(y * S + x) * 4 + 3]) continue;
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return (x1 - x0) / Math.max(1, y1 - y0);
}
const straightDown = bbox(render(cap.positions, { el: 1.5 }));
near('straight down, a 1u cap is square', straightDown, 1.0, 0.12);

console.log('\nprofiles are visibly different objects');
const sa = stats(render(K.build({ profile: 'SA', row: 'R1', sizeU: 1, topGrid: 31 }).positions));
const dsa = stats(render(K.build({ profile: 'DSA', row: 'R3', sizeU: 1, topGrid: 31 }).positions));
truthy('SA R1 covers more frame than DSA - it is 9 mm taller',
  sa.lit > dsa.lit * 1.15, sa.lit + ' vs ' + dsa.lit);

console.log('\nit survives being handed nothing');
const empty = makeCanvas(S, S);
const ev = V.attach(empty, { spin: false });
ev.setMesh(null);
ev.draw();
let anyLit = 0;
for (let i = 3; i < empty._ctx._d.length; i += 4) if (empty._ctx._d[i]) anyLit++;
ok('an empty mesh draws nothing rather than throwing', anyLit, 0);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
