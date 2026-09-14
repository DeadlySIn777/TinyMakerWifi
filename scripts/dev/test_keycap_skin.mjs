/* Tests for web/parts/keycap-skin.js - node scripts/dev/test_keycap_skin.mjs
 *
 * This is the path a generated model takes onto a cap, so it is tested against
 * meshes whose height field is known in advance rather than against whatever a
 * generator happened to return. A wedge has a height that is a straight line; a
 * step block has two flat levels; a slab off to one side proves the thing lands
 * where it should instead of being centred by accident.
 *
 * The cap built from a generated skin is then checked for watertightness and
 * positive volume like any other, because the whole claim of this design is
 * that a generated legend cannot break the part.
 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
require('../../web/parts/mesh-health.js');
const K = require('../../web/parts/keycap.js');
const S = require('../../web/parts/keycap-skin.js');

let pass = 0, fail = 0;
const ok = (n, got, want) => {
  const good = String(got) === String(want);
  console.log(`  ${good ? 'OK  ' : 'FAIL'} ${n}: got ${got}, want ${want}`);
  good ? pass++ : fail++;
};
const near = (n, got, want, tol) => {
  const good = Math.abs(got - want) <= tol;
  console.log(`  ${good ? 'OK  ' : 'FAIL'} ${n}: got ${got}, want ${want} +/-${tol}`);
  good ? pass++ : fail++;
};
const truthy = (n, v) => ok(n, !!v, true);

function soup(tris) {
  const a = new Float32Array(tris.length * 9);
  tris.forEach((t, i) => t.flat().forEach((v, j) => { a[i * 9 + j] = v; }));
  return a;
}
/* An axis-aligned box as 12 triangles. Thin in Z so the shortest-axis rule
   picks Z and the "front view" is the XY face. */
function box(x0, x1, y0, y1, z0, z1) {
  const P = (x, y, z) => [x, y, z];
  const c = [P(x0,y0,z0),P(x1,y0,z0),P(x1,y1,z0),P(x0,y1,z0),
             P(x0,y0,z1),P(x1,y0,z1),P(x1,y1,z1),P(x0,y1,z1)];
  const q = (a,b,cc,d) => [[c[a],c[b],c[cc]],[c[a],c[cc],c[d]]];
  return [].concat(q(0,3,2,1), q(4,5,6,7), q(0,1,5,4), q(1,2,6,5), q(2,3,7,6), q(3,0,4,7));
}
function signedVolume(p) {
  let v = 0;
  for (let i = 0; i < p.length; i += 9) {
    const ax=p[i],ay=p[i+1],az=p[i+2], bx=p[i+3],by=p[i+4],bz=p[i+5], cx=p[i+6],cy=p[i+7],cz=p[i+8];
    v += (ax*(by*cz-bz*cy) - ay*(bx*cz-bz*cx) + az*(bx*cy-by*cx)) / 6;
  }
  return v;
}

console.log('\nit sights down the shortest axis - the front view of a flat item');
const flat = soup(box(-5, 5, -4, 4, -0.5, 0.5));      // thin in Z
ok('picked Z', S.heightField(flat, { grid: 32 }).axis, 2);
const tall = soup(box(-0.5, 0.5, -4, 4, -5, 5));      // thin in X
ok('picked X', S.heightField(tall, { grid: 32 }).axis, 0);
ok('and reports the in-plane pair', S.heightField(tall, { grid: 32 }).inPlane.join(','), '1,2');
ok('axis can be forced', S.heightField(flat, { grid: 32, axis: 1 }).axis, 1);

console.log('\na step block gives two levels, in the right places');
/* Left half 1 mm deep, right half 3 mm deep, both spanning the same footprint.
   Looking down +Z the near surface is the taller one on the right. */
const step = soup([].concat(box(-6, 0, -4, 4, 0, 1), box(0, 6, -4, 4, 0, 3)));
const f = S.heightField(step, { grid: 64 });
ok('sighted down Z', f.axis, 2);
const at = (u, v) => {
  const g = f.grid, x = Math.round((u + 1) / 2 * (g - 1)), y = Math.round((v + 1) / 2 * (g - 1));
  return f.h[y * g + x];
};
near('left side is the low step', at(-0.6, 0), 0, 0.02);
near('right side is the high step', at(0.6, 0), 1, 0.02);
truthy('and it covers the whole footprint', f.coverage > 0.97);

console.log('\nit does not silently centre things');
/* A slab in the top-right quadrant only. Its height field must be raised there
   and flat everywhere else, or the relief is landing in the wrong place. */
const corner = soup([].concat(box(-6, 6, -6, 6, 0, 0.4), box(1, 5, 1, 5, 0, 3)));
const fc = S.heightField(corner, { grid: 64 });
const atc = (u, v) => {
  const g = fc.grid, x = Math.round((u + 1) / 2 * (g - 1)), y = Math.round((v + 1) / 2 * (g - 1));
  return fc.h[y * g + x];
};
near('the slab is up', atc(0.5, 0.5), 1, 0.05);
near('the opposite corner is not', atc(-0.5, -0.5), 0, 0.05);
near('and so is the opposite side', atc(0.5, -0.5), 0, 0.05);

console.log('\nthe relief keeps the model\'s proportions');
const wide = soup(box(-8, 8, -2, 2, -0.4, 0.4));   // 16 x 4 mm, 4:1
const rel = S.skinFromMesh(wide, { grid: 48, depth: 0.5 });
// on a square face the model must stay 4:1, so it reaches the sides and not the top
truthy('reaches across', Math.abs(rel(0.85, 0, 13.7, 13.7)) > 0.1);
ok('but not up', rel(0, 0.85, 13.7, 13.7), -0);
truthy('raised gives a negative displacement', rel(0, 0, 13.7, 13.7) < 0);
const eng = S.skinFromMesh(wide, { grid: 48, depth: 0.5, raised: false });
truthy('engraved gives a positive one', eng(0, 0, 13.7, 13.7) > 0);

console.log('\na generated skin cannot break the cap');
const capSkin = K.build({ profile: 'XDA', row: 'R3', sizeU: 1, topGrid: 31,
                          relief: S.skinFromMesh(step, { grid: 64, depth: 0.55 }) });
const h = globalThis.meshHealth(capSkin.positions);
ok('watertight', h.watertight, true);
ok('no flipped winding', h.flippedEdges, 0);
truthy('solid', signedVolume(capSkin.positions) > 0);
truthy('the stem is untouched by it',
  Math.abs(capSkin.slotWidth - (K.MX.crossWide + K.MX.slotClearance)) < 1e-6);

console.log('\nit refuses what it cannot use');
let threw = '';
try { S.heightField(new Float32Array([1, 2, 3]), {}); } catch (e) { threw = 'not a soup'; }
ok('a stray array', threw, 'not a soup');
threw = '';
// zero thickness viewed FACE ON is fine - it is a flat plate. Sighting along
// an axis that leaves another zero-width one is not.
try { S.heightField(soup(box(-1, 1, -1, 1, 0, 0)), { axis: 0 }); } catch (e) { threw = 'flat'; }
ok('a model with no thickness on two axes', threw, 'flat');

console.log('\nprompts');
truthy('every drawn icon has a prompt to replace it', Object.keys(S.PROMPTS).length >= 8);
truthy('they ask for a shallow relief, not a hero prop', /bas relief/.test(S.promptFor('ifak')));
truthy('an unknown name still gets the tail', /bas relief/.test(S.promptFor('a rubber duck')));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
