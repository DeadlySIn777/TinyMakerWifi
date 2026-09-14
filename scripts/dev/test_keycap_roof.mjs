/* IS THERE MATERIAL WHERE THERE IS SUPPOSED TO BE MATERIAL.
 *
 * node scripts/dev/test_keycap_roof.mjs
 *
 * Every other suite in this directory asks a question about a NUMBER the engine
 * reported. This one asks a question about the SOLID, because the bug it was
 * written for was invisible to all of them at once: an engraved legend deeper
 * than the 1.20 mm roof cut a hole clean through the top face into the stem
 * cavity, and
 *
 *   - build() returned warnings: []
 *   - keycap.validate() returned issues: []
 *   - mesh-health reported watertight: true, severity "ok"
 *   - costOf() billed the volume of it
 *
 * all of which were correct. The mesh IS closed. It is closed and
 * self-intersecting: the roof underside passes through the top face, and a
 * closed surface that crosses itself still has a hole in the object it bounds.
 * No count, no bounding box and no Euler characteristic can see that. Only
 * asking "how much material is in this column" can.
 *
 * WHAT IT DOES. For each of a grid of vertical lines through the top face, it
 * collects every triangle the line crosses, sorts the crossings by z, and walks
 * them carrying the winding number from the triangle normals. Where the winding
 * is >= 1 there is solid; the total of those stretches is the material in that
 * column. A column over the middle of the cap with zero material is a hole
 * through the part.
 *
 * This is a proper ray-parity integration and not a "does the first hit face
 * up" test, because the failure shows up as INVERTED ordering - the underside
 * arriving before the face above it - and only the winding sum distinguishes
 * that from an honest pocket.
 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
require('../../web/parts/mesh-health.js');
const K = require('../../web/parts/keycap.js');
const ICONS = require('../../web/parts/keycap-icons.js');

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

/* Material along the vertical line at (x, y): the summed length of every
   stretch of z where the winding number is at least 1. */
function materialAt(p, x, y) {
  const hits = [];
  for (let i = 0; i < p.length; i += 9) {
    const ax = p[i],   ay = p[i+1], az = p[i+2];
    const bx = p[i+3], by = p[i+4], bz = p[i+5];
    const cx = p[i+6], cy = p[i+7], cz = p[i+8];
    const d = (by-cy)*(ax-cx) + (cx-bx)*(ay-cy);
    if (Math.abs(d) < 1e-12) continue;
    const l1 = ((by-cy)*(x-cx) + (cx-bx)*(y-cy)) / d;
    const l2 = ((cy-ay)*(x-cx) + (ax-cx)*(y-cy)) / d;
    const l3 = 1 - l1 - l2;
    /* STRICTLY inside. A ray through a shared vertex or edge is counted once
       per incident triangle and the winding sum is then nonsense - which is how
       this harness first "proved" that a plain DSA cap is hollow. The sample
       grid below is offset off the lattice so no ray lands on one. */
    if (l1 <= 1e-9 || l2 <= 1e-9 || l3 <= 1e-9) continue;
    /* z of the normal decides which way the surface faces, and it is the same
       determinant `d`. The solid is at LARGER z, so the top face points -Z:
       marching upward in z, a -Z face is where you ENTER material. */
    hits.push([l1*az + l2*bz + l3*cz, d < 0 ? 1 : -1]);
  }
  if (!hits.length) return 0;
  hits.sort((a, b) => a[0] - b[0]);
  let w = 0, solid = 0, from = 0;
  for (const [z, s] of hits) {
    if (w >= 1) solid += z - from;
    w += s;
    from = z;
  }
  return solid;
}

/* The middle of the top face, where a legend lives and where there must always
   be material: never the rim, never outside the walls. */
function faceSamples(cap, profile, sizeU, per) {
  const pr = K.PROFILES[profile];
  const topW = K.capWidth(sizeU) - 2*pr.topInset, topD = K.DEPTH - 2*pr.topInset;
  const w = (topW/2 - 1.6), d = (topD/2 - 1.6);
  const out = [];
  /* Off the lattice on purpose - see materialAt. 0.0137 / 0.0091 mm is far
     below the 0.1275 mm mask pixel, so it changes nothing about what is being
     measured, and it keeps every ray strictly inside the triangles it meets. */
  for (let i = 0; i < per; i++) for (let j = 0; j < per; j++)
    out.push([-w + 2*w*i/(per-1) + 0.0137, -d + 2*d*j/(per-1) + 0.0091]);
  return out;
}

function holesIn(cap, profile, sizeU, per) {
  let n = 0, worst = 0;
  for (const [x, y] of faceSamples(cap, profile, sizeU, per || 40)) {
    const m = materialAt(cap.positions, x, y);
    if (m < 0.05) { n++; if (0.05 - m > worst) worst = 0.05 - m; }
  }
  return { holes: n, worst: +worst.toFixed(3) };
}

console.log('\nA CAP WITH NOTHING ON IT IS SOLID ALL THE WAY ACROSS');
for (const [prof, row] of [['DSA','R3'], ['XDA','R3'], ['SA','R1'],
                           ['CHERRY','R3'], ['CHERRY','R4'], ['OEM','R3'], ['OEM','R4']]) {
  const c = K.build({ profile: prof, row, sizeU: 1, topGrid: 41 });
  const h = holesIn(c, prof, 1, 26);
  ok(prof + ' ' + row + ': columns with no material', h.holes, 0);
}

console.log('\nAND SO IS ONE WITH A LEGEND THE OWNER ASKED FOR');
/* These are the exact cases the audit reproduced a hole in. 1.50 mm and 2.00 mm
   are both past the 1.20 mm roof, which is the point: the engine has to either
   make room or refuse, and it may not quietly ship a cap with a hole. */
const CASES = [
  ['XDA',    'R3', 'afak',      1.50],
  ['XDA',    'R3', 'afak',      2.00],
  ['OEM',    'R3', 'hemostat',  1.50],
  ['OEM',    'R3', 'splint',    1.25],
  ['DSA',    'R3', 'pills',     1.80],
  ['CHERRY', 'R3', 'afak',      1.50],
  ['SA',     'R1', 'afak',      2.50],
  ['XDA',    'R3', 'afak',      0.55],   // the default, which was always fine
];
for (const [prof, row, icon, depth] of CASES) {
  const name = `${prof} ${row} ${icon} engraved ${depth.toFixed(2)} mm`;
  let c = null, refused = null;
  try {
    c = K.build({ profile: prof, row, sizeU: 1, topGrid: 61,
                  relief: ICONS.makeRelief({ icon }, { depth, raised: false }) });
  } catch (e) { refused = e.message; }
  if (refused) {
    /* Refusing is a correct answer - there may genuinely not be room - but it
       has to SAY it is about the legend, or the owner cannot act on it. */
    truthy(name + ': refused, and the message names the legend',
      /legend|artwork/i.test(refused), refused.slice(0, 90));
    continue;
  }
  const h = holesIn(c, prof, 1, 40);
  ok(name + ': columns with no material', h.holes, 0);
  /* And when the engine had to take room from the stem to manage it, that is
     the owner's cap changing shape - it does not happen quietly. */
  if (depth > 1.2)
    truthy(name + ': the deepening is reported',
      c.warnings.some(w => /roof under it was deepened/.test(w)),
      c.warnings.join(' | ').slice(0, 80) || 'no warnings');
}

console.log('\nTHE STEM SURVIVES THE DEEPENING, OR THE CAP IS REFUSED');
for (const [prof, row, icon, depth] of CASES) {
  let c = null;
  try {
    c = K.build({ profile: prof, row, sizeU: 1, topGrid: 41,
                  relief: ICONS.makeRelief({ icon }, { depth, raised: false }) });
  } catch (e) { continue; }
  const v = K.validate(c.positions);
  truthy(`${prof} ${row} ${icon} ${depth}: still a usable stem`,
    v.issues.length === 0, v.issues.join('; ').slice(0, 80) || 'clean');
}

console.log('\nTHE GUARD ITSELF CAN FAIL - proof it is not vacuous');
/* A test that cannot fail is worse than no test. minRoof: 0 with the lift
   disabled is the OLD behaviour, and it has to show the hole the audit found.
   If this ever stops reporting a hole, the check above has stopped checking. */
const broken = K.build({ profile: 'XDA', row: 'R3', sizeU: 1, topGrid: 61,
                         roof: 1.20, minRoof: -99,
                         relief: ICONS.makeRelief({ icon: 'afak' }, { depth: 2.00, raised: false }) });
const bh = holesIn(broken, 'XDA', 1, 40);
truthy('with the lift defeated, the 2.00 mm engraving does open a hole',
  bh.holes > 0, bh.holes + ' columns with no material');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
