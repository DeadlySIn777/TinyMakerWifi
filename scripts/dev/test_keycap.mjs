/* Tests for web/parts/keycap.js - node scripts/dev/test_keycap.mjs
 *
 * The load-bearing test is the manifold sweep: every profile x row x size is
 * built and checked for zero boundary edges, zero non-manifold edges, zero
 * flipped windings and a positive signed volume. That is the property the whole
 * design rests on - a cap that is not closed can slice into a shape with no
 * stem, silently - so it is asserted rather than reasoned about.
 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
require('../../web/parts/mesh-health.js');          // installs globalThis.meshHealth
const K = require('../../web/parts/keycap.js');

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

/* Signed volume via the divergence theorem. Positive means every normal points
   out; negative means the whole mesh is inside-out; near zero means it is not
   closed. mesh-health checks topology, this checks orientation. */
function signedVolume(p) {
  let v = 0;
  for (let i = 0; i < p.length; i += 9) {
    const ax=p[i],ay=p[i+1],az=p[i+2], bx=p[i+3],by=p[i+4],bz=p[i+5], cx=p[i+6],cy=p[i+7],cz=p[i+8];
    v += (ax*(by*cz-bz*cy) - ay*(bx*cz-bz*cx) + az*(bx*cy-by*cx)) / 6;
  }
  return v;
}

console.log('\nthe manifold sweep - every profile, every row, 1u');
let sweepBad = 0, built = 0;
for (const [pname, prof] of Object.entries(K.PROFILES)) {
  for (const rname of Object.keys(prof.rows)) {
    const c = K.build({ profile: pname, row: rname, sizeU: 1 });
    const h = globalThis.meshHealth(c.positions);
    const vol = signedVolume(c.positions);
    const bad = h.boundaryEdges || h.nonManifoldEdges || h.flippedEdges || vol <= 0;
    built++;
    if (bad) {
      sweepBad++;
      console.log(`  FAIL ${pname} ${rname}: boundary=${h.boundaryEdges} nonManifold=${h.nonManifoldEdges} flipped=${h.flippedEdges} vol=${vol.toFixed(2)}`);
    }
  }
}
ok(`${built} profile/row caps all closed, outward and solid`, sweepBad, 0);

console.log('\nsizes that lie flat stay closed too');
let sizeBad = 0;
for (const u of [1, 1.25, 1.5, 1.75, 2]) {
  const c = K.build({ profile: 'OEM', row: 'R3', sizeU: u });
  const h = globalThis.meshHealth(c.positions);
  if (h.boundaryEdges || h.nonManifoldEdges || h.flippedEdges || signedVolume(c.positions) <= 0) {
    sizeBad++; console.log(`  FAIL ${u}u: ${h.summary}`);
  }
}
ok('1u..2u all closed', sizeBad, 0);

console.log('\ngrid resolution never breaks the stem bridge');
let gridBad = 0;
for (const g of [7, 10, 13, 16, 19, 25, 31, 37]) {
  const c = K.build({ profile: 'DSA', sizeU: 1, topGrid: g });
  const h = globalThis.meshHealth(c.positions);
  if (!h.watertight || h.flippedEdges) { gridBad++; console.log(`  FAIL grid ${g}: ${h.summary}`); }
}
ok('every requested grid snaps to a workable one', gridBad, 0);

console.log('\nthe stem is the right size');
const cap = K.build({ profile: 'CHERRY', row: 'R3', sizeU: 1 });
near('slot = crossWide + clearance', cap.slotWidth, 1.23, 0.001);
near('slot in printer pixels', cap.slotPixels, 9.6, 0.2);

/* Pinned to the two reference CAD models these came out of - Signature
   Plastics' DSA R3 and a relegendable Cherry cap. If someone edits these back
   to a round number, this is what says so. */
near('cross arm length matches the reference caps', K.MX.crossLen, 4.00, 0.04);
near('post radius matches Signature Plastics', K.MX.postR, 2.756, 0.01);
truthy('the nominal slot sits between the two real caps', K.MX.crossWide >= 1.10 && K.MX.crossWide <= 1.194);
truthy('the slot has a lead-in chamfer', K.MX.crossChamfer > 0);
truthy('the hole floor sits below the dish', cap.floorZ > 0);
truthy('the stem ends short of the mouth', cap.postTopZ < cap.mouthZ);
near('Cherry R3 stands about 7.7 mm overall', cap.mouthZ, 7.75, 0.35);
near('and its quoted 6.9 mm is the FRONT edge', cap.mouthZ - cap.frontZ, 6.9, 0.01);

console.log('\nrefusals - the engine says no instead of emitting a broken cap');
let threw = '';
try { K.build({ profile: 'NOPE' }); } catch (e) { threw = 'unknown profile'; }
ok('unknown profile', threw, 'unknown profile');
threw = '';
try { K.build({ profile: 'DSA', row: 'R1' }); } catch (e) { threw = 'no such row'; }
ok('DSA has no R1 (it is uniform)', threw, 'no such row');
threw = '';
/* A roof that thick leaves under 3 mm for the stem, which no longer holds a
   switch - that is the point where it must refuse rather than auto-fit. */
try { K.build({ profile: 'CHERRY', row: 'R3', roof: 4.0 }); }
catch (e) { threw = 'too short'; }
ok('a cap with no room for a stem is refused', threw, 'too short');

/* Short of that it shortens the stem instead of refusing, the way a real low
   sculpted cap does - but it has to SAY so. */
const r4 = K.build({ profile: 'CHERRY', row: 'R4' });
truthy('Cherry R4 gets a shortened stem, not an error', r4.stemDepth < K.MX.crossDepth);
truthy('and it still holds a switch', r4.stemDepth >= 3.0);
truthy('and it warns', r4.warnings.some(w => /stem is/.test(w)));
ok('a tall row keeps the full stem', K.build({ profile: 'SA', row: 'R1' }).stemDepth, K.MX.crossDepth);

console.log('\nwhat fits the bed - the thing that decides what is printable');
ok('1u lies flat, no supports', K.fits(K.capWidth(1), 18, 9).supports, false);
ok('2u lies flat', K.fits(K.capWidth(2), 18, 9).tilt, 0);
const f225 = K.fits(K.capWidth(2.25), 18, 9);
truthy('2.25u does not lie flat but does fit tilted', f225.ok && f225.tilt > 0);
truthy('2.25u tilt is a real angle under 45', f225.tilt > 25 && f225.tilt < 45);
truthy('2.25u needs supports', f225.supports);
const f275 = K.fits(K.capWidth(2.75), 18, 9);
truthy('2.75u fits tilted', f275.ok);
truthy('2.75u needs more tilt than 2.25u', f275.tilt > f225.tilt);
ok('6.25u spacebar fits at NO angle', K.fits(K.capWidth(6.25), 18, 9).ok, false);
truthy('and it says why', /spacebar/.test(K.fits(K.capWidth(6.25), 18, 9).why));

console.log('\nhow many per plate - print time is height-only, so this is the yield');
ok('1u caps per plate', K.perPlate(1).count, 2);
ok('1.5u caps per plate', K.perPlate(1.5).count, 1);
ok('spacebar per plate', K.perPlate(6.25).count, 0);

console.log('\nprint orientation');
const flat = K.build({ profile: 'OEM', row: 'R1', sizeU: 1 });   // R1 leans -3 deg
const rot = K.orientForPrint(flat.positions, flat.angle);
let minZ = Infinity, maxZ = -Infinity;
for (let i = 2; i < rot.length; i += 3) { if (rot[i] < minZ) minZ = rot[i]; if (rot[i] > maxZ) maxZ = rot[i]; }
near('sits on the plate', minZ, 0, 1e-4);
truthy('still a sane height', maxZ > 5 && maxZ < 20);
ok('rotating does not break the mesh', globalThis.meshHealth(rot).watertight, true);
truthy('rotating keeps it outward-facing', signedVolume(rot) > 0);

console.log('\nvalidate() - the gate a generated mesh has to pass');
const good = K.validate(cap.positions, { sizeU: 1 });
ok('an engine cap passes its own validator', good.ok, true);
// a cap scaled to 1.5x is over the key pitch and must be caught
const big = new Float32Array(cap.positions.length);
for (let i = 0; i < big.length; i++) big[i] = cap.positions[i] * 1.5;
const bigV = K.validate(big, { sizeU: 1 });
ok('an oversized cap is rejected', bigV.ok, false);
truthy('and the reason names the pitch', /pitch/.test(bigV.issues.join(' ')));
ok('not-a-mesh is rejected', K.validate(new Float32Array([1,2,3]), {}).ok, false);

console.log('\nthe stem tuning comb');
const comb = K.stemTestComb(1.20, 1.40, 0.05);
ok('five stems', comb.stems.length, 5);
near('first slot', comb.stems[0].slotMm, 1.20, 1e-6);
near('last slot', comb.stems[4].slotMm, 1.40, 1e-6);
truthy('the comb is a real mesh', comb.triangles > 100);

console.log('\nplate layout');
const two = [
  { ...K.build({ profile: 'DSA', sizeU: 1 }), name: 'a' },
  { ...K.build({ profile: 'DSA', sizeU: 1 }), name: 'b' }
];
const plate = K.layout(two);
ok('both caps placed', plate.placed.length, 2);
ok('none left over', plate.leftOver, 0);
truthy('they do not overlap', Math.abs(plate.placed[0].x - plate.placed[1].x) >= 18);
let px = [Infinity, -Infinity];
for (let i = 0; i < plate.positions.length; i += 3) {
  if (plate.positions[i] < px[0]) px[0] = plate.positions[i];
  if (plate.positions[i] > px[1]) px[1] = plate.positions[i];
}
truthy('the plate stays inside the bed', px[1] - px[0] <= K.BED.x + 1e-6);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
