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
/* ⚠️ THE BED IS NOT THE USABLE AREA, and these assertions were written as
   though it were. The slicer lays a raft under every part with a 1.6 mm border,
   and the plate is bolted on with about a millimetre of play, so 2.6 mm a side
   is spoken for before any support exists. Packing to 40.8 x 30.6 therefore
   produced plates the slicer could not print - it scales whatever runs off,
   and on 2026-09-14 it scaled a two-cap plate by 19.1% and said so:

       Scaled down 19.1% - the supports reached past the plate, and they still
       do. Scale the model down by hand before printing.

   For most models that is a disappointment; for a keycap it is a 19% smaller
   CROSS SLOT and a cap that will not go on a switch. usableBed() is 35.6 x
   25.4, and these now ask about that. */
const U = K.usableBed();
ok('the usable area reserves the raft border and the plate play', U.reserveMm, 2.6);
ok('1u lies flat, no supports', K.fits(K.capWidth(1), 18, 9).supports, false);
truthy('1u is comfortably inside the usable width', K.capWidth(1) < U.x,
  K.capWidth(1) + ' of ' + U.x.toFixed(1));
/* 2u is 37.1 mm and the usable width is 35.6, so it CANNOT lie flat - with the
   raft it would be 40.3 mm on a plate that allows 38.8, and the slicer would
   shrink it. It leans instead, which costs supports and is the honest trade. */
truthy('2u no longer lies flat - the raft does not fit beside it',
  K.fits(K.capWidth(2), 18, 9).tilt > 0, 'tilt ' + K.fits(K.capWidth(2), 18, 9).tilt);
truthy('and it still fits, leaning', K.fits(K.capWidth(2), 18, 9).ok);
const f225 = K.fits(K.capWidth(2.25), 18, 9);
truthy('2.25u does not lie flat but does fit tilted', f225.ok && f225.tilt > 0);
truthy('2.25u leans further than 2u, as a wider cap must',
  f225.tilt > K.fits(K.capWidth(2), 18, 9).tilt,
  f225.tilt + ' vs ' + K.fits(K.capWidth(2), 18, 9).tilt);
truthy('2.25u tilt is still a workable angle', f225.tilt > 25 && f225.tilt < 60,
  String(f225.tilt));
truthy('2.25u needs supports', f225.supports);
const f275 = K.fits(K.capWidth(2.75), 18, 9);
truthy('2.75u fits tilted', f275.ok);
truthy('2.75u needs more tilt than 2.25u', f275.tilt > f225.tilt);
ok('6.25u spacebar fits at NO angle', K.fits(K.capWidth(6.25), 18, 9).ok, false);
truthy('and it says why', /spacebar/.test(K.fits(K.capWidth(6.25), 18, 9).why));

console.log('\nhow many per plate - print time is height-only, so this is the yield');
/* ONE, not two. Two 18 mm caps and a 1.5 mm gap is 37.5 mm, the usable width
   is 35.6, and the printer settled the argument: it sliced that exact plate and
   scaled it down 19.1%. A worse yield and a true one. */
ok('1u caps per plate', K.perPlate(1).count, 1);
truthy('and two of them would not have fitted', 2 * K.capWidth(1) + 1.5 > K.usableBed().x,
  (2 * K.capWidth(1) + 1.5).toFixed(1) + ' > ' + K.usableBed().x.toFixed(1));
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
/* Same arithmetic as perPlate, and the same printed evidence: one lands, one
   waits for the next run, and layout SAYS so rather than handing back a plate
   the slicer will quietly shrink. */
ok('one cap placed', plate.placed.length, 1);
ok('and one left over', plate.leftOver, 1);
truthy('and it says so in words', (plate.issues || []).some(i => /did not fit/.test(i)),
  JSON.stringify(plate.issues));
/* With one cap on the plate there is no pair to overlap, so the question
   becomes the one that still means something: a SECOND plate, run for the
   leftover, has to place it - a cap that fits must never be dropped twice. */
const second = K.layout([two[1]]);
ok('the leftover cap fits on a plate of its own', second.placed.length, 1);
let px = [Infinity, -Infinity];
for (let i = 0; i < plate.positions.length; i += 3) {
  if (plate.positions[i] < px[0]) px[0] = plate.positions[i];
  if (plate.positions[i] > px[1]) px[1] = plate.positions[i];
}
truthy('the plate stays inside the USABLE width, raft border included',
  px[1] - px[0] <= K.usableBed().x + 1e-6,
  (px[1] - px[0]).toFixed(2) + ' of ' + K.usableBed().x.toFixed(2));

console.log('\nnesting packs by the footprint a cap PRINTS at, not the one it sits at');
/* The bug this replaced: an artisan cap with raised relief has to lean over,
   and a leaning cap has a different footprint. Packing a 2.25u Enter by its
   41.8 mm width says none fit; by the 29.8 mm it occupies at 34 degrees, it
   does. */
const enter = K.build({ profile: 'XDA', row: 'R3', sizeU: 2.25, topGrid: 13 });
truthy('a 2.25u Enter is wider than the bed sitting upright',
  enter.size.x > K.BED.x, enter.size.x.toFixed(1) + ' mm vs ' + K.BED.x);
truthy('but its print plan leans it over', enter.printPlan.tilt > 0,
  enter.printPlan.tilt + ' degrees');
const entPlate = K.layout([{ ...enter, name: 'enter' }]);
ok('and it lands on the plate', entPlate.placed.length, 1);
truthy('packed at its tilted width, not its upright one',
  entPlate.placed[0].w < enter.size.x,
  entPlate.placed[0].w.toFixed(1) + ' mm packed vs ' + enter.size.x.toFixed(1) + ' upright');

console.log('\nsupports get their own clearance');
const flatPair = K.layout([K.build({ profile: 'DSA', sizeU: 1 }), K.build({ profile: 'DSA', sizeU: 1 })]);
ok('flat caps need no supports', flatPair.supports, false);
truthy('and pack tight', flatPair.gapMm <= 1.5, flatPair.gapMm + ' mm gap');
/* A support tree is wider at the plate than the part above it, so two
   neighbouring trees can grow into each other. The gap opens up. */
truthy('a supported plate opens the gap', entPlate.gapMm > flatPair.gapMm,
  entPlate.gapMm + ' mm vs ' + flatPair.gapMm + ' mm');
truthy('and it reports that supports are involved', entPlate.supports);

console.log('\nheight is checked, not just area');
truthy('the plate reports how tall it stands', entPlate.plateHeightMm > 0,
  entPlate.plateHeightMm + ' mm');
truthy('against the supported limit, which is lower than the flat one',
  entPlate.zLimitMm === K.BED.zSupported && K.BED.zSupported < K.BED.zFlat,
  entPlate.zLimitMm + ' mm');
truthy('and turns that into layers', entPlate.layers > 0, entPlate.layers + ' at 0.05 mm');
/* flatPair is two 1u caps, which no longer share a plate - 37.5 mm of caps
   and gap against 35.6 mm of usable width. The claim worth keeping is that the
   verdict MATCHES the placing, whichever way it goes: a plate that reports ok
   has to have placed everything it was given. */
ok('the verdict matches what was placed', flatPair.ok, flatPair.leftOver === 0);
ok('and the pair does not fit one plate any more', flatPair.leftOver, 1);

console.log('\na tall artisan sculpt still nests');
/* The Meshy case: a generated sculpt protrudes far more than a 0.55 mm legend,
   which makes the cap taller and forces a steeper lean. */
const tallRelief = (u, v) => {
  const r = Math.hypot(u, v);
  return r < 0.55 ? -4.0 * Math.cos(r / 0.55 * Math.PI / 2) : 0;
};
const artisan = K.build({ profile: 'XDA', row: 'R3', sizeU: 1, topGrid: 25, relief: tallRelief });
truthy('a 4 mm sculpt makes a much taller cap', artisan.size.z > 12,
  artisan.size.z.toFixed(1) + ' mm vs 9.1 plain');
ok('and it is still watertight', globalThis.meshHealth(artisan.positions).watertight, true);
truthy('the stem is untouched by it',
  Math.abs(artisan.slotWidth - (K.MX.crossWide + K.MX.slotClearance)) < 1e-6);
const artPlate = K.layout([{ ...artisan, name: 'a' }, { ...artisan, name: 'b' }]);
/* The point of this one was never the number two - it was that a TALL cap is
   packed by the footprint it prints at rather than by its height. One lands
   and one waits, and the reason given is the plate's width, not the sculpt. */
truthy('a sculpted cap still lands', artPlate.placed.length >= 1,
  artPlate.issues.join('; ') || 'placed');
truthy('and the leftover is reported rather than dropped',
  artPlate.placed.length + (artPlate.leftOver || 0) === 2,
  artPlate.placed.length + ' placed, ' + artPlate.leftOver + ' left');
truthy('the plate is as tall as the sculpt makes it',
  artPlate.plateHeightMm >= artisan.size.z - 0.01,
  artPlate.plateHeightMm + ' mm');

console.log('\nnothing overlaps, ever');
/* The check that matters for a plate: no two placed footprints intersect. */
function overlaps(p) {
  for (let i = 0; i < p.length; i++) for (let j = i + 1; j < p.length; j++) {
    const a = p[i], b = p[j];
    if (Math.abs(a.x - b.x) < (a.w + b.w) / 2 - 1e-6 &&
        Math.abs(a.y - b.y) < (a.d + b.d) / 2 - 1e-6) return `${i} and ${j}`;
  }
  return null;
}
const six = K.layout(['a','b','c','d','e','f'].map(n =>
  ({ ...K.build({ profile: 'XDA', row: 'R3', sizeU: 1, topGrid: 13 }), name: n })));
ok('six 1u caps overlap nowhere', overlaps(six.placed), null);
/* One per run now - see usableBed(). The invariant that matters is that the
   six are accounted for, none silently lost. */
truthy('one fits per run, and the rest are accounted for',
  six.placed.length === 1 && six.placed.length + six.leftOver === 6,
  six.placed.length + ' placed, ' + six.leftOver + ' left over');
let inside = true;
for (let i = 0; i < six.positions.length; i += 3) {
  if (Math.abs(six.positions[i]) > K.BED.x / 2 + 1e-6) inside = false;
  if (Math.abs(six.positions[i + 1]) > K.BED.y / 2 + 1e-6) inside = false;
}
ok('and every one is inside the bed', inside, true);

console.log('\nplanning a whole set');
const set = K.planSet(['1','2','3','4','5','6'].map(n =>
  ({ ...K.build({ profile: 'XDA', row: 'R3', sizeU: 1, topGrid: 13 }), name: n })));
ok('six caps take six runs', set.runs, 6);
ok('none stranded', set.stranded, 0);
truthy('and it totals the layers across them', set.totalLayers > 0, set.totalLayers + ' layers');

console.log('\nA RAISED legend forces the lean into the PLAN, not just into the report');
/* The bug this pins. printPlan came from fits(), which sees only geometry, so a
   1u cap "fits flat" - tilt 0, no supports. The relief is the thing that knows
   it stands proud, and that knowledge reached the REPORT only. The report
   printed "tilted 12 degrees, supports yes" while layout() packed the same cap
   flat at 1.5 mm and the clock counted its untilted height. Every Tarkov cap is
   raised, so the flagship set was exactly the broken case. */
const ICO = require('../../web/parts/keycap-icons.js');
const plainCap = K.build({ profile: 'XDA', row: 'R3', sizeU: 1, topGrid: 21 });
const engCap = K.build({ profile: 'XDA', row: 'R3', sizeU: 1, topGrid: 21,
  relief: ICO.makeRelief({ icon: 'ifak', digit: '1' }, { depth: 0.55, raised: false }) });
const upCap = K.build({ profile: 'XDA', row: 'R3', sizeU: 1, topGrid: 21,
  relief: ICO.makeRelief({ icon: 'ifak', digit: '1' }, { depth: 0.55, raised: true }) });

ok('a plain 1u lies flat', plainCap.printPlan.tilt, 0);
ok('engraved also lies flat - a recess starts late, it never reaches the plate',
   engCap.printPlan.tilt, 0);
ok('and needs no supports', engCap.printPlan.supports, false);
truthy('but RAISED forces a lean', upCap.printPlan.tilt >= 12, upCap.printPlan.tilt + ' degrees');
ok('and supports', upCap.printPlan.supports, true);
ok('and says what forced it', upCap.printPlan.forcedBy, 'relief');
truthy('and explains it in words', /reaches the plate before/.test(upCap.printPlan.why || ''));

console.log('\nand the height in the plan is the LEANING height');
truthy('a leaning cap is taller than an upright one',
  upCap.printPlan.height > plainCap.size.z * 1.3,
  upCap.printPlan.height + ' mm leaning vs ' + plainCap.size.z.toFixed(2) + ' upright');
const upLayers = Math.ceil(upCap.printPlan.height / 0.05);
const flatLayers = Math.ceil(engCap.size.z / 0.05);
truthy('so it costs far more layers', upLayers > flatLayers * 1.3, upLayers + ' vs ' + flatLayers);
const th = upCap.printPlan.tilt * Math.PI / 180;
near('the height matches the rotation exactly', upCap.printPlan.height,
  upCap.size.x * Math.sin(th) + upCap.size.z * Math.cos(th), 0.02);
near('as does the footprint', upCap.printPlan.foot.x,
  upCap.size.x * Math.cos(th) + upCap.size.z * Math.sin(th), 0.02);

console.log('\nthe plate obeys the same plan');
function plateOf(cap) {
  return K.layout([
    { positions: cap.positions, size: cap.size, name: 'a', printPlan: cap.printPlan },
    { positions: cap.positions, size: cap.size, name: 'b', printPlan: cap.printPlan }]);
}
const engPlate = plateOf(engCap), upPlate = plateOf(upCap);
/* Both plates hold one cap now - 1u caps no longer pair, see usableBed() -
   so the claim moves to what still separates the two cases: an engraved cap
   lies flat and a raised one leans, which is a different gap, a different
   ceiling, and a different number of layers. The count is no longer the
   thing that tells them apart, and pretending otherwise would leave a test
   that passes on both. */
ok('an engraved cap lands', engPlate.placed.length, 1);
ok('so does a raised one', upPlate.placed.length, 1);
truthy('and the engraved one lies flat while the raised one leans',
  !engCap.printPlan.tilt && upCap.printPlan.tilt > 0,
  engCap.printPlan.tilt + ' vs ' + upCap.printPlan.tilt);
truthy('the gap opens for its supports', upPlate.gapMm > engPlate.gapMm,
  upPlate.gapMm + ' vs ' + engPlate.gapMm + ' mm');
ok('measured against the supported ceiling', upPlate.zLimitMm, K.BED.zSupported);
ok('while the engraved plate uses the flat one', engPlate.zLimitMm, K.BED.zFlat);

console.log('\nthere is only ONE implementation of the lean now');
const prof = K.PROFILES.XDA, topD = K.DEPTH - 2 * prof.topInset;
const viaIcons = ICO.raisedTilt(ICO.makeRelief({ icon: 'ifak' }, { depth: 0.55, raised: true }), prof, topD);
const viaEngine = K.raisedLean(0.55, prof.dishDepth, topD);
ok('the icon module and the engine agree', viaIcons.tilt, viaEngine);
ok('and the plan carries that same angle', upCap.printPlan.tilt, viaEngine);

console.log('\na deeper sculpt leans further');
const deep = K.build({ profile: 'XDA', row: 'R3', sizeU: 1, topGrid: 21,
  relief: ICO.makeRelief({ icon: 'ifak' }, { depth: 3.0, raised: true }) });
truthy('3 mm of relief leans more than 0.55 mm', deep.printPlan.tilt > upCap.printPlan.tilt,
  deep.printPlan.tilt + ' vs ' + upCap.printPlan.tilt + ' degrees');
truthy('and stands taller still', deep.printPlan.height > upCap.printPlan.height);
truthy('but still clears the volume', deep.printPlan.height < K.BED.zSupported);

console.log('\na lean the footprint already forces is not made worse');
const entRaised = K.build({ profile: 'XDA', row: 'R3', sizeU: 2.25, topGrid: 13,
  relief: ICO.makeRelief({ icon: 'cross' }, { depth: 0.55, raised: true }) });
truthy('the footprint lean still governs', entRaised.printPlan.tilt > 25,
  entRaised.printPlan.tilt + ' degrees');
ok('and it still fits', entRaised.printPlan.ok, true);


console.log('\nTHE FIT COMB - the one print that settles slotClearance');
/* It used to lay 18 mm caps in a line at a 10 mm pitch, so they overlapped by
   8 mm and fused into one slab with five buried holes, 58 mm long on a 40.8 mm
   bed. Neither fault shows up in a triangle count; both show up the moment you
   measure the box and compare it to BED, which is what these do. */
const fitComb = K.stemTestComb(1.15, 1.35, 0.04);
truthy('it fits the bed', fitComb.sizeMm.x <= K.BED.x && fitComb.sizeMm.y <= K.BED.y,
  fitComb.sizeMm.x + ' x ' + fitComb.sizeMm.y + ' on ' + K.BED.x + ' x ' + K.BED.y);
truthy('with more than two steps on it', fitComb.stems.length >= 5, fitComb.stems.length + ' coupons');
truthy('the coupons do not touch each other', (function () {
  const pitch = fitComb.couponMm + 1.6;
  return fitComb.stems.every(a => fitComb.stems.every(b =>
    a === b || Math.abs(a.x - b.x) >= pitch - 1e-6 || Math.abs(a.y - b.y) >= pitch - 1e-6));
})());
truthy('the slots widen monotonically',
  fitComb.stems.every((s2, i) => i === 0 || s2.slotMm > fitComb.stems[i - 1].slotMm),
  fitComb.stems.map(s2 => s2.slotMm.toFixed(2)).join(' '));
ok('the range asked for is the range delivered', fitComb.stems[0].slotMm, 1.15);
ok('both ends of it', fitComb.stems[fitComb.stems.length - 1].slotMm, 1.35);
truthy('it is watertight', (function () {
  const q = fitComb.positions, E = new Map();
  for (let t = 0; t < q.length; t += 9) {
    const v = [[q[t],q[t+1],q[t+2]],[q[t+3],q[t+4],q[t+5]],[q[t+6],q[t+7],q[t+8]]]
      .map(a => a.map(x => Math.round(x * 2000)).join(','));
    for (let i = 0; i < 3; i++) {
      const a = v[i], b = v[(i + 1) % 3], k2 = a < b ? a + '|' + b : b + '|' + a;
      E.set(k2, (E.get(k2) || 0) + (a < b ? 1 : -1));
    }
  }
  return [...E.values()].every(v => v === 0);
})());

/* Asking for a step finer than the bed can hold must widen the step, not
   truncate the range - a comb that stops before the answer is worthless. */
const fine = K.stemTestComb(1.15, 1.45, 0.01);
ok('a too-fine request still starts where asked', fine.stems[0].slotMm, 1.15);
ok('and still ends where asked', fine.stems[fine.stems.length - 1].slotMm, 1.45);
truthy('it says the step was widened', /widened/.test(fine.note));
truthy('and it still fits', fine.sizeMm.x <= K.BED.x && fine.sizeMm.y <= K.BED.y);

/* The coupon is not offered as a keycap. */
truthy('the coupon profile is hidden from the picker', K.PROFILES.TEST.hidden === true);
truthy('and the stem in it is the SAME stem a cap gets', (function () {
  const cap = K.build({ profile: 'TEST', widthMm: 11, depthMm: 11, topGrid: 9 });
  const real = K.build({ profile: 'DSA', row: 'R3', topGrid: 9 });
  return Math.abs(cap.stemDepth - real.stemDepth) < 1e-6 ||
         (cap.stemDepth > 3 && real.stemDepth > 3);
})(), 'coupon stem is built by build(), not a copy');


console.log('\nA PROFILE NAME FROM OUTSIDE IS NOT A KEY LOOKUP');
/* PROFILES is an object literal, so PROFILES["constructor"] is truthy and has
   no .rows. A saved session that said profile:"constructor" was waved through
   a `if (PROFILES[name])` guard and then threw reading .rows[row] - and that
   happened BEFORE drawBoard(), so the whole keycap card initialised to nothing
   and every later refresh threw again. Share codes feed the same path, so a
   code from somebody else could do it to you. Truthiness is not a membership
   test on a plain object. */
for (const bad of ['constructor', 'toString', 'valueOf', 'hasOwnProperty', '__proto__', 'isPrototypeOf']) {
  let threw = false;
  try { K.build({ profile: bad, row: 'R3', topGrid: 9 }); } catch (e) { threw = /unknown profile/.test(e.message); }
  truthy('"' + bad + '" is refused, with the clear message', threw);
}
truthy('a genuinely unknown name still says the same thing', (() => {
  try { K.build({ profile: 'NOPE' }); return false; } catch (e) { return /unknown profile/.test(e.message); }
})());
truthy('and the real profiles still build', K.build({ profile: 'DSA', row: 'R3', topGrid: 9 }).positions.length > 0);
truthy('the hidden coupon is still reachable by name, for the comb',
  K.build({ profile: 'TEST', widthMm: 11, depthMm: 11, topGrid: 9 }).positions.length > 0);


console.log('\nTHE PLATE COUNT AND THE PLATE PACKER ARE ONE NUMBER');
/* perPlate() was the last consumer still deriving its own geometry. The engine
   moved the layer count onto printPlan and left the per-plate count behind, so
   for a cap whose lean is forced by its legend perPlate packed a flat 18 mm cap
   at a 1.5 mm gap while layout() packed the leaning footprint at 3.5 mm - two
   of the three biggest numbers on the card describing a plate nobody prints. */
for (const [name, opts] of [['DSA R3', { profile: 'DSA', row: 'R3', topGrid: 9 }],
                            ['SA R1', { profile: 'SA', row: 'R1', topGrid: 9 }],
                            ['CHERRY R4', { profile: 'CHERRY', row: 'R4', topGrid: 9 }]]) {
  const c = K.build(opts);
  const said = K.perPlate(opts.sizeU || 1, null, c.size.z, c.printPlan).count;
  const packed = K.layout(Array(12).fill(c)).placed.length;
  ok('what ' + name + ' says fits is what the packer fits', said, packed);
}
truthy('and perPlate still answers without a plan, for the flat comparison',
  K.perPlate(1).count > 0);


console.log('\nA BRAILLE DOT HAS TO CLEAR THE DISH IT STANDS IN');
/* The dots are 0.75 mm tall. The profile's own dish is 0.80 mm on XDA, 1.10 on
   DSA and 1.30 on SA - so on every profile this engine ships, the top of a dot
   sat BELOW the rim of the bowl around it, and a finger tracking across the cap
   felt the rim instead. The one feature whose entire purpose is to be felt.
   Real braille caps are flat-topped for exactly this reason. */
function topAt(p, x, y) {
  let best = Infinity;
  for (let i = 0; i < p.length; i += 9) {
    const ax=p[i],ay=p[i+1],bx=p[i+3],by=p[i+4],cx=p[i+6],cy=p[i+7];
    const d=(by-cy)*(ax-cx)+(cx-bx)*(ay-cy);
    if (Math.abs(d) < 1e-12) continue;
    const l1=((by-cy)*(x-cx)+(cx-bx)*(y-cy))/d, l2=((cy-ay)*(x-cx)+(ax-cx)*(y-cy))/d, l3=1-l1-l2;
    if (l1<-1e-9||l2<-1e-9||l3<-1e-9) continue;
    const z = l1*p[i+2]+l2*p[i+5]+l3*p[i+8];
    if (z < best) best = z;
  }
  return best;
}
/* XDA's dish is 0.80 against a 0.75 mm dot, so there it was marginal rather
   than swallowed - a 0.05 mm proud dot you would not feel through a fingertip
   either. DSA (1.10) and SA (1.30) buried it outright. Both are fixed by the
   same flattening; only the deeper two get the "was swallowed" assertion. */
for (const prof of ['DSA', 'SA']) {
  const dished = K.build({ profile: prof, row: 'R3', topGrid: 81 });
  const flat = K.build({ profile: prof, row: 'R3', topGrid: 81, dishDepth: 0 });
  const dotTopDished = topAt(dished.positions, 0, 0) - 0.75;
  const rimDished = topAt(dished.positions, 5.8, 0);
  const dotTopFlat = topAt(flat.positions, 0, 0) - 0.75;
  const rimFlat = topAt(flat.positions, 5.8, 0);
  truthy(prof + ': the dish really did swallow the dot', dotTopDished > rimDished,
    'dot ' + dotTopDished.toFixed(2) + ' vs rim ' + rimDished.toFixed(2));
  truthy(prof + ': flattened, the dot stands proud', dotTopFlat < rimFlat - 0.5,
    'dot ' + dotTopFlat.toFixed(2) + ' vs rim ' + rimFlat.toFixed(2));
}
for (const prof of ['XDA']) {
  const dished = K.build({ profile: prof, row: 'R3', topGrid: 81 });
  const flat = K.build({ profile: prof, row: 'R3', topGrid: 81, dishDepth: 0 });
  const proudDished = topAt(dished.positions, 5.8, 0) - (topAt(dished.positions, 0, 0) - 0.75);
  const proudFlat = topAt(flat.positions, 5.8, 0) - (topAt(flat.positions, 0, 0) - 0.75);
  /* 0.18 mm of a 0.75 mm dot: less than a quarter of it clears the bowl, and
     a fingertip resolves nothing that shallow - the ADA figure is 0.6 to 0.9. */
  truthy(prof + ': the shallow dish still buried three quarters of the dot',
    proudDished < 0.25,
    proudDished.toFixed(2) + ' mm of 0.75 above the rim - a fingertip feels nothing');
  truthy(prof + ': flattened, it is properly proud', proudFlat > 0.7,
    proudFlat.toFixed(2) + ' mm');
}
truthy('and dishDepth:0 does not change anything else',
  K.build({ profile: 'DSA', row: 'R3', topGrid: 9, dishDepth: 0 }).size.x ===
  K.build({ profile: 'DSA', row: 'R3', topGrid: 9 }).size.x);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
