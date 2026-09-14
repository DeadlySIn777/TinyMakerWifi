/* Tests for web/parts/keycap-sculpt.js - node scripts/dev/test_keycap_sculpt.mjs
 *
 * The load-bearing test here is the winding one. Seating a sculpt has to grow
 * it in -z, and negating an axis is a MIRROR: it flips handedness, so every
 * triangle winds backwards and every normal points into the object. Left
 * unfixed the sculpt rendered pitch black and would reach a winding-sensitive
 * slicer inside out. Nothing errors; it just looks wrong, which is exactly the
 * class of bug this project keeps finding by looking rather than by testing.
 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
require('../../web/parts/mesh-health.js');
const K = require('../../web/parts/keycap.js');
const SC = require('../../web/parts/keycap-sculpt.js');

let pass = 0, fail = 0;
const ok = (n, got, want) => {
  const good = String(got) === String(want);
  console.log(`  ${good ? 'OK  ' : 'FAIL'} ${n}: got ${got}, want ${want}`);
  good ? pass++ : fail++;
};
const truthy = (n, v, d) => {
  console.log(`  ${v ? 'OK  ' : 'FAIL'} ${n}${d ? ' (' + d + ')' : ''}`);
  v ? pass++ : fail++;
};

function box(x0,x1,y0,y1,z0,z1){
  const c=[[x0,y0,z0],[x1,y0,z0],[x1,y1,z0],[x0,y1,z0],[x0,y0,z1],[x1,y0,z1],[x1,y1,z1],[x0,y1,z1]];
  const q=(a,b,cc,d)=>[[c[a],c[b],c[cc]],[c[a],c[cc],c[d]]];
  const t=[].concat(q(0,3,2,1),q(4,5,6,7),q(0,1,5,4),q(1,2,6,5),q(2,3,7,6),q(3,0,4,7));
  const f=new Float32Array(t.length*9);
  t.forEach((tr,i)=>tr.flat().forEach((v,j)=>{f[i*9+j]=v;}));
  return f;
}
function signedVolume(p) {
  let v = 0;
  for (let i = 0; i < p.length; i += 9) {
    const ax=p[i],ay=p[i+1],az=p[i+2],bx=p[i+3],by=p[i+4],bz=p[i+5],cx=p[i+6],cy=p[i+7],cz=p[i+8];
    v += (ax*(by*cz-bz*cy) - ay*(bx*cz-bz*cx) + az*(bx*cy-by*cx)) / 6;
  }
  return v;
}

const cap = K.build({ profile: 'DSA', row: 'R3', sizeU: 1, topGrid: 21 });
cap.dishDepth = K.PROFILES.DSA.dishDepth;
const sculpt = box(-8, 8, -8, 8, -8, 8);

console.log('\nthe mirror does not leave the sculpt inside out');
/* Seating negates z. Without the winding reversal the sculpt's own signed
   volume comes back NEGATIVE - every face pointing inward. */
truthy('the sculpt starts outward-facing', signedVolume(sculpt) > 0,
  signedVolume(sculpt).toFixed(1));
const seated = SC.seat(cap, sculpt, { heightMm: 13 });
const justSculpt = seated.positions.slice(cap.positions.length);
truthy('and is STILL outward-facing after seating',
  signedVolume(justSculpt) > 0, signedVolume(justSculpt).toFixed(2));
truthy('the cap half is untouched and still outward-facing',
  signedVolume(seated.positions.slice(0, cap.positions.length)) > 0);

console.log('\nboth solids are present and separate');
ok('cap triangles', seated.capTriangles, cap.positions.length / 9);
ok('sculpt triangles', seated.sculptTriangles, sculpt.length / 9);
ok('and the soup holds both', seated.triangles, seated.capTriangles + seated.sculptTriangles);
/* The point of not booleaning: the cap's own geometry is byte-identical, so
   the stem cannot be disturbed by whatever arrived from a generator. */
let same = true;
for (let i = 0; i < cap.positions.length; i++)
  if (seated.positions[i] !== cap.positions[i]) { same = false; break; }
truthy('the cap geometry is byte-identical - the stem cannot be touched', same);

console.log('\nit grows UP out of the top face, and sinks in far enough to fuse');
/* Engine z runs from the top face down to the mouth, so proud of the cap is
   NEGATIVE z. */
let minZ = Infinity, maxZ = -Infinity;
for (let i = 2; i < justSculpt.length; i += 3) {
  if (justSculpt[i] < minZ) minZ = justSculpt[i];
  if (justSculpt[i] > maxZ) maxZ = justSculpt[i];
}
truthy('it stands proud of the top face', minZ < 0, minZ.toFixed(2) + ' mm');
truthy('and its base sits inside the cap', maxZ > 0, '+' + maxZ.toFixed(2) + ' mm');
truthy('deeper than the dish, so no layer of it floats',
  maxZ > K.PROFILES.DSA.dishDepth, maxZ.toFixed(2) + ' > ' + K.PROFILES.DSA.dishDepth);

console.log('\nit is sized to a keyboard, not to the screen');
truthy('kept inside the key pitch', seated.footprintMm.x <= 19.05,
  seated.footprintMm.x + ' mm');
ok('and the check agrees', SC.check(seated).ok, true);
const huge = SC.seat(cap, sculpt, { scale: 3 });
ok('a sculpt bigger than the pitch is refused', SC.check(huge).ok, false);
truthy('and it says it will foul the next key', /foul/.test(SC.check(huge).issues.join(' ')));

console.log('\nand it changes how the cap prints');
const pose = SC.printPose(seated, cap);
/* printPose searches now and takes the SHALLOWEST lean that clears, so a
   small cap settles on the 40 degree floor rather than a fixed 55. */
truthy('it goes on its side', pose.tilt >= 40, pose.tilt + ' degrees');
ok('with supports', pose.supports, true);
ok('and says what forced it', pose.forcedBy, 'sculpt');
truthy('the reason names the real problem', /buries the sculpt/.test(pose.why));
truthy('the leaning height is taller than the piece standing up',
  pose.height > seated.totalHeightMm, pose.height + ' vs ' + seated.totalHeightMm);

console.log('\nit refuses what it cannot seat');
let threw = '';
try { SC.seat(cap, new Float32Array([1,2,3])); } catch (e) { threw = 'not a soup'; }
ok('a stray array', threw, 'not a soup');
threw = '';
try { SC.seat(cap, box(-8, 8, -8, 8, 0, 0)); } catch (e) { threw = 'flat'; }
ok('a flat sculpt has no form to seat', threw, 'flat');
threw = '';
try { SC.seat(null, sculpt); } catch (e) { threw = 'no cap'; }
ok('and no cap at all', threw, 'no cap');

console.log('\nA DIORAMA: several pieces, and the one that only looks attached');
/* This is what artisan caps are for - a scene with figures on it - and it is
   where the arrangement fails silently. Overlapping pieces fuse in the slicer,
   so figures touching a base are fine however many there are. A figure the
   generator left hovering a fraction clear looks perfect on screen and is a
   separate object in mid air on the plate. */
const base = box(-9, 9, -9, 9, 0, 2.5);
function merge(...parts) {
  const n = parts.reduce((a, p) => a + p.length, 0);
  const out = new Float32Array(n); let at = 0;
  parts.forEach(p => { out.set(p, at); at += p.length; });
  return out;
}
const scene = merge(base, box(-7,-1,-3,3, 2.0, 12), box(1, 7,-3,3, 2.0, 10));
const seatedScene = SC.seat(cap, scene, { heightMm: 14 });
const sceneChk = SC.check(seatedScene);
ok('three pieces are found', sceneChk.anchorage.shells, 3);
ok('all three are anchored', sceneChk.anchorage.floating.length, 0);
ok('so the scene is accepted', sceneChk.ok, true);
truthy('and it explains that overlapping pieces fuse',
  sceneChk.notes.some(n => /fuse in the slicer/.test(n)));

const broken = merge(base, box(-7,-1,-3,3, 2.0, 12), box(1, 7,-3,3, 4.0, 12));
const brokenChk = SC.check(SC.seat(cap, broken, { heightMm: 14 }));
ok('a hovering figure is caught', brokenChk.anchorage.floating.length, 1);
ok('and the scene is refused', brokenChk.ok, false);
truthy('the reason says it only looks attached',
  /looks attached/.test(brokenChk.issues.join(' ')));
truthy('and it reports how big the floater is',
  brokenChk.anchorage.floating[0].sizeMm.every(v => v > 0),
  brokenChk.anchorage.floating[0].sizeMm.join(' x ') + ' mm');

/* Anchoring is transitive: a figure standing on a figure standing on the base
   is attached, even though it never touches the cap itself. */
const stacked = merge(base, box(-4, 4, -4, 4, 2.0, 8), box(-2, 2, -2, 2, 7.5, 13));
ok('anchoring carries up a stack', SC.check(SC.seat(cap, stacked, { heightMm: 15 })).anchorage.floating.length, 0);


console.log('\nAND THEN IT LANDS THEM - the detector grew hands');
/* Catching the floater was only ever half of it. check() used to hand back a
   sentence and the unchanged mesh went to the plate anyway. reseat() lowers a
   floating piece onto whatever is beneath it, biting in far enough that the
   slicer unions the two instead of printing a kiss. */
const brokenSeat = SC.seat(cap, broken, { heightMm: 14 });
const landed = SC.reseat(brokenSeat);
ok('the floater is landed', landed.stillFloating, 0);
ok('and it says so, once', landed.moved.length, 1);
truthy('with the drop in millimetres', landed.moved[0].dropMm > 0,
  landed.moved[0].dropMm + ' mm');
ok('nothing floats any more', SC.check(landed).anchorage.floating.length, 0);
ok('so the scene is accepted now', SC.check(landed).ok, true);

/* The bite is the whole point: touching is not fusing. After the drop the
   piece has to REACH INTO what is under it, not rest on its skin. */
const shellsAfter = SC.shellParts(landed.positions.subarray(landed.capTriangles * 9));
truthy('the landed piece overlaps the one below it in z',
  shellsAfter.length === 3 &&
  shellsAfter.some(a => shellsAfter.some(b => a !== b &&
    a.mn[2] < b.mn[2] && a.mx[2] > b.mn[2])));

/* Nothing may move sideways. Two characters placed beside each other stay
   beside each other - only their height changes. */
const beforeXY = SC.bounds(brokenSeat.positions.subarray(brokenSeat.capTriangles * 9));
const afterXY = SC.bounds(landed.positions.subarray(landed.capTriangles * 9));
truthy('the plan view is untouched',
  Math.abs(beforeXY.size[0] - afterXY.size[0]) < 1e-4 &&
  Math.abs(beforeXY.size[1] - afterXY.size[1]) < 1e-4);
truthy('and the cap itself is not touched',
  landed.positions.subarray(0, landed.capTriangles * 9)
    .every((v, i) => v === brokenSeat.positions[i]));
truthy('the caller keeps their own mesh', brokenSeat.positions !== landed.positions);

/* A scene that was already sound must come back untouched, not "fixed". */
const soundAgain = SC.reseat(seatedScene);
ok('a sound scene is moved nowhere', soundAgain.moved.length, 0);
truthy('and its height is unchanged',
  Math.abs(soundAgain.totalHeightMm - seatedScene.totalHeightMm) < 0.02,
  soundAgain.totalHeightMm + ' vs ' + seatedScene.totalHeightMm);

/* Landing a piece can only make the finished part shorter, never taller, and
   the reported height has to follow it - a stale number feeds the bed check a
   part that is not the one being printed. (Here it is unchanged: the floater
   was not the tallest thing on the cap, so lowering it moved no ceiling.) */
/* 1e-6 was the wrong tolerance for a figure both sides round to two decimals:
   the two heights are derived differently and land 0.01 mm apart, which is a
   fifth of a layer and well under the 127.5 micron mask pixel. The claim worth
   holding is that landing a piece does not make the part MEASURABLY taller. */
truthy('the reported height never grows measurably',
  landed.totalHeightMm <= brokenSeat.totalHeightMm + 0.02,
  landed.totalHeightMm + ' vs ' + brokenSeat.totalHeightMm);

/* Two floaters, one above the other, resolve from the bottom up. */
const twoUp = merge(base, box(-3, 3, -3, 3, 4.0, 9), box(-2, 2, -2, 2, 11.0, 15));
const twoSeat = SC.seat(cap, twoUp, { heightMm: 15 });
ok('both are floating to start with', SC.check(twoSeat).anchorage.floating.length, 2);
const twoLanded = SC.reseat(twoSeat);
ok('and both are landed', twoLanded.stillFloating, 0);
ok('in two reported moves', twoLanded.moved.length, 2);
truthy('and THAT one does get shorter - the top piece came down',
  twoLanded.totalHeightMm < twoSeat.totalHeightMm - 0.5,
  twoLanded.totalHeightMm + ' vs ' + twoSeat.totalHeightMm);
truthy('the upper one landed on the lower one, not on the cap',
  twoLanded.moved.some(m => m.onto === 'the piece under it'),
  twoLanded.moved.map(m => m.onto).join(' / '));

/* It refuses nonsense rather than mangling it. */
let rethrew = '';
try { SC.reseat({ positions: new Float32Array(9) }); } catch (e) { rethrew = 'needs a seat'; }
ok('reseat wants a seated result', rethrew, 'needs a seat');


console.log('\nLANDING ON THE CAP - the plane that was not the cap');
/* The first reseat() landed pieces on z = 0. z = 0 is where build() normalises
   the cap's HIGHEST point, not its face: the dish and the row angle put the
   real surface 0.8 to 2.8 mm further down. So a piece was moved from one patch
   of air to another, marked anchored, and check() flipped from ok:false to
   ok:true - the detector talked out of a correct refusal by its own repair.

   Every reseat fixture above uses a full-width base, so the "onto the cap"
   branch was never once exercised. This is that branch: two rocks with a gap,
   and a figure hovering over the gap with nothing beneath it. */
/* No base: with one, the figure lands on the base and the cap branch is still
   never reached. Two rocks standing straight on the cap, and the gap between
   them is genuinely cap. */
const gapScene = merge(box(-8, -5, -3, 3, 0, 9),            // left rock
                       box(5, 8, -3, 3, 0, 9),              // right rock
                       box(-1.5, 1.5, -1.5, 1.5, 2.0, 7));  // the figure, over the gap
const gapSeat = SC.seat(cap, gapScene, { heightMm: 14 });
/* All three read as floating here, and that is not a fault in the fixture - it
   is seat() doing its job. It spreads a sculpt across the cap's full 18 mm
   width while the DSA top FACE is only 12.70 mm, so anything out near the edge
   overhangs onto the shoulder and its surface is 3.4 mm down rather than 1.1.
   A real generated sculpt is one connected shell whose centre is over the face,
   so it anchors; three separate boxes each get judged where they individually
   stand. What matters is that every one of them is landed on the material that
   is actually beneath it. */
truthy('the hovering figure is caught', SC.check(gapSeat).anchorage.floating.length >= 1,
  SC.check(gapSeat).anchorage.floating.length + ' pieces not touching anything');
const gapLanded = SC.reseat(gapSeat);
ok('and it is landed', gapLanded.stillFloating, 0);
ok('onto the cap, not onto a rock', gapLanded.moved[0].onto, 'the cap');

/* THE ASSERTION THAT WOULD HAVE CAUGHT IT. Measure the cap's own surface under
   the piece and require the piece to have reached it - not merely to have
   crossed z = 0. */
const landedShells = SC.shellParts(gapLanded.positions.subarray(gapLanded.capTriangles * 9));
/* The figure is the shell over the middle of the cap - the rocks straddle the
   shoulder. Picking by triangle count picked a rock, and then measured the
   skirt instead of the top face. */
const cAt = g => Math.abs((g.mn[0] + g.mx[0]) / 2) + Math.abs((g.mn[1] + g.mx[1]) / 2);
const fig = landedShells.reduce((a, b) => (cAt(a) <= cAt(b) ? a : b));
const capZ = SC.surfaceUnder(gapLanded.positions, null, 0, gapLanded.capTriangles, fig, 5);
truthy('the cap surface under it is well below z = 0', capZ > 0.4, capZ.toFixed(2) + ' mm down');
truthy('and the piece reaches that surface, not the z=0 plane',
  fig.mx[2] >= capZ, 'piece bottom ' + fig.mx[2].toFixed(2) + ' vs surface ' + capZ.toFixed(2));
truthy('with enough bite to fuse rather than kiss',
  fig.mx[2] - capZ >= 0.55, (fig.mx[2] - capZ).toFixed(2) + ' mm of overlap');
truthy('and the old z=0 landing would NOT have reached it', capZ > 0.6,
  'the old code stopped at 0.60 mm; the surface is at ' + capZ.toFixed(2) +
  ' - ' + (capZ - 0.6).toFixed(2) + ' mm of air it called landed');

console.log('\nA HOLE IS NOT A FLOOR');
/* The other half of the same fault: landing on a target shell's bounding-box
   top. An arch, a ring or a horseshoe has a box with nothing in the middle, so
   a piece over the opening was "landed" onto air - and then the box test
   agreed, because reseat had moved it until the boxes touched. It manufactured
   the evidence for its own success. A piece translation cannot save must stay
   refused. */
const arch = merge(box(-8, -4, -8, 8, 0, 8),      // left tower
                   box(4, 8, -8, 8, 0, 8),         // right tower
                   box(-4, 4, -8, -4, 0, 2),       // the ledge that joins them
                   box(-2, 2, 0, 4, 12, 16));      // a figure over the opening
const archSeat = SC.seat(cap, arch, { heightMm: 15 });
const archChk = SC.check(archSeat);
truthy('the piece over the opening is caught', archChk.anchorage.floating.length >= 1);
const archLanded = SC.reseat(archSeat);
truthy('and reseat does NOT claim to have landed it', archLanded.stillFloating >= 1,
  archLanded.stillFloating + ' still floating, ' + archLanded.moved.length + ' moved');
ok('so the scene is still refused', SC.check(archLanded).ok, false);
truthy('and the refusal still says why',
  /floating/.test(SC.check(archLanded).issues.join(' ')));

/* stillFloating must be measured from the moved mesh, not read off the flags
   reseat set on itself - asking your own bookkeeping whether you succeeded is
   how it came to report 0 floaters in a scene that had one. */
ok('stillFloating agrees with an independent check of the same mesh',
  archLanded.stillFloating, SC.check(archLanded).anchorage.floating.length);
ok('and it agrees on the sound scene too', SC.reseat(seatedScene).stillFloating,
  SC.check(seatedScene).anchorage.floating.length);

console.log('\nTHE FACE IS NOT LEVEL, AND THE BASE PLANE WAS');
/* seat() wrote one constant z for the whole underside while keycap.js tilts the
   top face by the row angle - so on a sculpted row the figure was welded to the
   high side and hung over air on the low one. The old anchor test compared
   against z = 0, the cap's HIGHEST point, which the high side satisfies on its
   own, so nothing noticed. */
function baseSweep(profile, row) {
  const cap = K.build({ profile, row, topGrid: 31 });
  cap.dishDepth = K.PROFILES[profile].dishDepth; cap.sizeU = 1;
  const s = SC.seat(cap, box(-8, 8, -8, 8, 0, 10), { heightMm: 12 });
  const sc = s.positions.subarray(s.capTriangles * 9);
  let front = -Infinity, back = -Infinity, fy = Infinity, by = -Infinity;
  for (let i = 0; i < sc.length; i += 3) {
    const y = sc[i + 1], z = sc[i + 2];
    if (y < fy) fy = y;
    if (y > by) by = y;
  }
  for (let i = 0; i < sc.length; i += 3) {
    const y = sc[i + 1], z = sc[i + 2];
    if (y < fy + 0.5 && z > front) front = z;
    if (y > by - 0.5 && z > back) back = z;
  }
  return { sweep: back - front, span: by - fy, angle: cap.angle };
}
for (const [p, r] of [['DSA','R3'], ['SA','R1'], ['SA','R4'], ['CHERRY','R4'], ['OEM','R4']]) {
  const b = baseSweep(p, r);
  const want = Math.tan(b.angle * Math.PI / 180) * b.span;
  truthy(p + ' ' + r + ': the base follows the face at ' + b.angle + String.fromCharCode(176),
    Math.abs(b.sweep - want) < 0.15,
    'sweeps ' + b.sweep.toFixed(2) + ' mm, the face wants ' + want.toFixed(2));
}
truthy('a level row still seats level',
  Math.abs(baseSweep('DSA', 'R3').sweep) < 1e-6);


console.log('\nTHE SCULPT HAS TO TOUCH THE CAP - MEASURED, NOT ASSUMED');
/* The slope test above passes on geometry that never touches the cap at all,
   which is exactly what shipped: seat() derived the face from the dish depth
   and the row angle, got the constant wrong, and left the sculpt hanging.
   Measured overlap at the centre of the face before the fix - DSA R3 +0.50,
   XDA R3 +0.50, SA R1 -1.00, SA R4 -0.18, CHERRY R3 -0.26, CHERRY R4 -0.93,
   OEM R3 -0.25, OEM R4 -0.91. Negative is a second solid in mid air sharing no
   volume with the keycap, which the slicer prints as a separate object.

   So this measures the OFFSET, not the slope: ray-cast the cap's top face and
   the sculpt's underside at the same (x,y) and require real overlap. */
function rayAt(p, lo, hi, x, y, pick) {
  let best = null;
  for (let t = lo * 9; t < hi * 9; t += 9) {
    const ax=p[t],ay=p[t+1],az=p[t+2],bx=p[t+3],by=p[t+4],bz=p[t+5],cx=p[t+6],cy=p[t+7],cz=p[t+8];
    const d = (by-cy)*(ax-cx) + (cx-bx)*(ay-cy);
    if (Math.abs(d) < 1e-12) continue;
    const l1 = ((by-cy)*(x-cx) + (cx-bx)*(y-cy)) / d;
    const l2 = ((cy-ay)*(x-cx) + (ax-cx)*(y-cy)) / d;
    const l3 = 1 - l1 - l2;
    if (l1 < -1e-9 || l2 < -1e-9 || l3 < -1e-9) continue;
    const z = l1*az + l2*bz + l3*cz;
    if (best === null || (pick === 'max' ? z > best : z < best)) best = z;
  }
  return best;
}
for (const [prof, row] of [['DSA','R3'],['XDA','R3'],['SA','R1'],['SA','R2'],['SA','R4'],
                           ['CHERRY','R1'],['CHERRY','R3'],['CHERRY','R4'],
                           ['OEM','R1'],['OEM','R3'],['OEM','R4']]) {
  const pr = K.PROFILES[prof];
  const c = K.build({ profile: prof, row, sizeU: 1, topGrid: 61 });
  c.dishDepth = pr.dishDepth; c.sizeU = 1;
  const ct = c.positions.length / 9;
  const s = SC.seat(c, box(-8, 8, -8, 8, 0, 10), { heightMm: 12 });
  const tot = s.positions.length / 9;
  const half = (18 - 2 * pr.topInset) / 2 * 0.75;
  let worst = Infinity;
  for (const [x, y] of [[0,0], [-half,0], [half,0], [0,-half], [0,half]]) {
    const capZ = rayAt(s.positions, 0, ct, x, y, 'min');
    const scZ = rayAt(s.positions, ct, tot, x, y, 'max');
    if (capZ === null || scZ === null) continue;
    worst = Math.min(worst, scZ - capZ);
  }
  truthy(prof + ' ' + row + ': the sculpt is really inside the cap',
    worst >= 0.6 && worst < 1e8, worst > 1e8 ? 'no rays hit' : worst.toFixed(2) + ' mm of overlap');
}


/* ======================================================================== */
console.log('\nA BOWL IS NOT A FLAT FACE - the centre ray is only for the cap');
/* surfaceUnder() took the centre ray for EVERYTHING, and justified it with a
   fact about keycaps: a dished top varies a few tenths of a millimetre across
   a footprint, so the middle stands for the whole. A generated shell makes no
   such promise. Ask the centre of a bowl and it answers with the FLOOR of the
   bowl - so a figure standing on the rim got "repaired" by being dropped
   inside it, and reseat() reported success.

   The mesh below is that bowl: a floor down at z 8-10 and one wall coming back
   up to z 0. z runs DOWNWARD into the cap, so the wall's top (z = 0) is the
   high ground and the floor (z = 8) is 8 mm below it. */
const bowl = merge(box(-10, 10, -10, 10, 8, 10),      // the floor
                   box(-10, -8, -10, 10, 0, 10));     // one wall, up to z = 0
const bowlTris = bowl.length / 9;
const wholeFoot = { mn: [-10, -10, 0], mx: [10, 10, 0] };
ok('asked as a cap, the centre ray answers with the floor',
   SC.surfaceUnder(bowl, null, 0, bowlTris, wholeFoot, 5, true), 8);
ok('asked as a shell, the grid answers with the rim',
   SC.surfaceUnder(bowl, null, 0, bowlTris, wholeFoot, 5, false), 0);
truthy('and a shell never gets the centre ray by default',
  SC.surfaceUnder(bowl, null, 0, bowlTris, wholeFoot, 5) === 0,
  String(SC.surfaceUnder(bowl, null, 0, bowlTris, wholeFoot, 5)));

console.log('\nA NUDGE IS MEASURED AGAINST THE PIECE, NOT THE FIGURE');
/* The bound used to be 0.6 * the WHOLE sculpt's z-extent, so one tall object
   raised the ceiling for every other piece in the scene. Here a 2 mm bolt sits
   8 mm above the base - four times its own height, plainly where the generator
   put it on purpose - next to a 38 mm tower. Under the old rule the tower
   bought the bolt a 24 mm allowance and the bolt was dragged down onto the
   base. It must now be left alone, and the scene must go on failing. */
const tower = merge(box(-9, 9, -9, 9, 0, 2),          // base, meets the cap
                    box(4, 8, -8, 8, 2, 40),          // the tower
                    box(-8, -6, -8, -6, 10, 12));     // the bolt, floating
const towerSeat = SC.seat(cap, tower, { heightMm: 40 });
ok('the bolt is floating to start with',
   SC.check(towerSeat).anchorage.floating.length, 1);
const towerLanded = SC.reseat(towerSeat);
ok('and a 2 mm bolt is NOT dragged 8 mm down onto the base',
   towerLanded.moved.length, 0);
ok('so it is still floating, and still reported',
   SC.check(towerLanded).anchorage.floating.length, 1);
truthy('which means the scene is still refused',
  SC.check(towerLanded).ok === false);

console.log('\nTHE SUMMARY DESCRIBES THE MESH THAT WAS WRITTEN');
/* sculptMm and totalHeightMm were computed as input-size times scale. seat()
   tilts the base by the row angle, which makes the seated sculpt taller than
   that by the rise across its depth - and printPose() picks its lean from
   these numbers, so under-reporting the height chose a lean whose real
   footprint ran off the plate. Measure the mesh. */
for (const [prof, row] of [['SA','R1'], ['CHERRY','R4'], ['OEM','R4'], ['DSA','R3']]) {
  const c = K.build({ profile: prof, row, sizeU: 1, topGrid: 41 });
  c.dishDepth = K.PROFILES[prof].dishDepth; c.sizeU = 1;
  const sc = SC.seat(c, box(-7, 7, -7, 7, 0, 10), { heightMm: 12 });
  const real = SC.bounds(sc.positions.subarray(sc.capTriangles * 9));
  truthy(prof + ' ' + row + ': sculptMm.z is the mesh, to 0.01',
    Math.abs(sc.sculptMm.z - real.size[2]) <= 0.011,
    sc.sculptMm.z + ' vs ' + real.size[2].toFixed(2));
  truthy(prof + ' ' + row + ': sculptMm.x/y are the mesh too',
    Math.abs(sc.sculptMm.x - real.size[0]) <= 0.011 &&
    Math.abs(sc.sculptMm.y - real.size[1]) <= 0.011);
  /* The finished part is the cap plus whatever stands proud of z = 0. */
  truthy(prof + ' ' + row + ': totalHeightMm is cap + proud',
    Math.abs(sc.totalHeightMm - (c.size.z + Math.max(0, -real.mn[2]))) <= 0.011,
    sc.totalHeightMm + ' vs ' + (c.size.z + Math.max(0, -real.mn[2])).toFixed(2));
  /* And the whole part really does fit inside that figure. */
  const all = SC.bounds(sc.positions);
  truthy(prof + ' ' + row + ': and nothing sticks out past it',
    all.size[2] <= sc.totalHeightMm + 0.02,
    all.size[2].toFixed(2) + ' <= ' + sc.totalHeightMm);
}

console.log('\nA GAP IS TO THE NEAREST THING, AND IT SAYS WHICH');
/* check() prints this number as "floating N mm clear of everything else", and
   it was wrong twice over. It was -mx[2]: the piece's height above z = 0, which
   is where build() puts the cap's HIGHEST point - so on a dished or tilted face
   (every face this engine makes) it was the distance to a plane nothing is on.
   And then, measured properly, it was measured to the CAP only, while
   anchorage() had just spent its whole body reasoning about shell-to-shell
   support: a figure 6 mm above a base that is itself on the cap was reported as
   8.20 mm "clear of everything else". Both numbers were true of something.
   Neither was true of the sentence. */
const gapS2 = SC.seat(cap, merge(box(-8, 8, -8, 8, 0, 3),
                                 box(-3, 3, -3, 3, 9, 12)), { heightMm: 12 });
const fl2 = SC.check(gapS2).anchorage.floating;
ok('one floater', fl2.length, 1);
const pieces2 = SC.shellParts(gapS2.positions.subarray(gapS2.capTriangles * 9));
/* z runs DOWN into the cap, so the piece with the SMALLEST mx[2] is the high
   one and the largest is the base sitting on the face. */
const high2 = pieces2.reduce((a, b) => (a.mx[2] < b.mx[2] ? a : b));
const base2 = pieces2.reduce((a, b) => (a.mx[2] > b.mx[2] ? a : b));
truthy('the gap is to the piece underneath, not past it to the cap',
  Math.abs(fl2[0].gapMm - (base2.mn[2] - high2.mx[2])) <= 0.02,
  fl2[0].gapMm + ' vs ' + (base2.mn[2] - high2.mx[2]).toFixed(2));
ok('and it names what it is clear of', fl2[0].gapOf, 'the piece under it');

/* With nothing but the cap under it, it measures to the cap - and to the cap's
   real surface, not to the normalisation plane. */
/* Two pieces that do NOT share ground in plan, so the raised one has only the
   cap beneath it and the answer has to come from the cap. */
const capOnlyScene = SC.seat(cap, merge(box(-8, -2, -8, 8, 0, 3),
                                        box(2, 8, -8, 8, 9, 12)), { heightMm: 12 });
const fl3 = SC.check(capOnlyScene).anchorage.floating;
ok('one floater over bare cap', fl3.length, 1);
const only = SC.shellParts(capOnlyScene.positions.subarray(capOnlyScene.capTriangles * 9))
               .reduce((a, b) => (a.mx[2] < b.mx[2] ? a : b));
const face = SC.surfaceUnder(capOnlyScene.positions.subarray(0, capOnlyScene.capTriangles * 9),
                             null, 0, capOnlyScene.capTriangles,
                             { mn: [2, -8, 0], mx: [8, 8, 0] }, 5, true);
ok('it names the cap', fl3[0].gapOf, 'the cap');
truthy('measured to the cap surface, not to z = 0',
  Math.abs(fl3[0].gapMm - (face - only.mx[2])) <= 0.02,
  fl3[0].gapMm + ' vs ' + (face - only.mx[2]).toFixed(2));
truthy('which is a DIFFERENT number from the old z = 0 rule',
  Math.abs(fl3[0].gapMm - (-only.mx[2])) > 0.05,
  'the old rule would have said ' + (-only.mx[2]).toFixed(2));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
