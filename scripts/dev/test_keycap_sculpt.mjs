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
truthy('it goes on its side', pose.tilt >= 45, pose.tilt + ' degrees');
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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
