/* Tests for web/parts/mesh-health.js - run with: node scripts/dev/test_mesh_health.mjs
 *
 * Builds meshes whose defects are known by construction, so a pass means the
 * detector found the thing that is actually there rather than something that
 * merely looks plausible. The last case runs the real Meshy export if it is on
 * disk, because a synthetic cube proves nothing about a 1.37M-triangle AI mesh.
 */
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { meshHealth } = require('../../web/parts/mesh-health.js');

// ---- builders -------------------------------------------------------------
const V = [[0,0,0],[10,0,0],[10,10,0],[0,10,0],[0,0,10],[10,0,10],[10,10,10],[0,10,10]];
// outward-facing winding
const F = [[0,3,2],[0,2,1],[4,5,6],[4,6,7],[0,1,5],[0,5,4],
           [1,2,6],[1,6,5],[2,3,7],[2,7,6],[3,0,4],[3,4,7]];

function soup(faces) {
  const a = new Float32Array(faces.length * 9);
  faces.forEach((f, i) => f.forEach((vi, k) => {
    a[i*9 + k*3] = V[vi][0]; a[i*9 + k*3 + 1] = V[vi][1]; a[i*9 + k*3 + 2] = V[vi][2];
  }));
  return a;
}

let pass = 0, fail = 0;
function check(name, got, want) {
  const ok = got === want;
  console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${name}: got ${got}, want ${want}`);
  ok ? pass++ : fail++;
}

// ---- 1. a closed cube is clean -------------------------------------------
console.log('\nclosed cube');
let r = meshHealth(soup(F));
check('severity', r.severity, 'ok');
check('watertight', r.watertight, true);
check('boundary edges', r.boundaryEdges, 0);
check('flipped edges', r.flippedEdges, 0);

// ---- 2. remove one face -> a square hole, 4 open edges -------------------
console.log('\ncube with one face missing (a hole)');
r = meshHealth(soup(F.filter((_, i) => i !== 2 && i !== 3)));
check('boundary edges', r.boundaryEdges, 4);
check('watertight', r.watertight, false);
check('not ok', r.ok, false);

// ---- 3. flip ONE triangle -> winding disagreement, engine cannot see it ---
console.log('\ncube with one triangle inside-out');
const flipped = F.map((f, i) => (i === 6 ? [f[0], f[2], f[1]] : f));
r = meshHealth(soup(flipped));
check('severity', r.severity, 'bad');
check('flipped edges found', r.flippedEdges > 0, true);
check('flagged not-ok', r.ok, false);

// ---- 4. degenerate triangle ----------------------------------------------
console.log('\ncube plus a zero-area triangle');
const withDegen = new Float32Array(soup(F).length + 9);
withDegen.set(soup(F));
r = meshHealth(withDegen);           // trailing zeros = a degenerate tri
check('degenerate counted', r.degenerate, 1);

// ---- 5. the real Meshy export --------------------------------------------
const STL = process.env.TINYMAKER_MESH_STL;
console.log('\nreal Meshy export');
if (!STL) {
  console.log('  SKIP optional real-model check: set TINYMAKER_MESH_STL to a binary STL. Synthetic checks still run.');
} else {
  if (!existsSync(STL)) throw new Error('TINYMAKER_MESH_STL does not exist');
  const d = readFileSync(STL);
  const n = d.readUInt32LE(80);
  const pos = new Float32Array(n * 9);
  let o = 84;
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < 3; k++) {
      pos[i*9 + k*3]     = d.readFloatLE(o + 12 + k*12);
      pos[i*9 + k*3 + 1] = d.readFloatLE(o + 16 + k*12);
      pos[i*9 + k*3 + 2] = d.readFloatLE(o + 20 + k*12);
    }
    o += 50;
  }
  const t0 = Date.now();
  r = meshHealth(pos);
  console.log(`  ${r.triangles.toLocaleString()} triangles, checked in ${Date.now()-t0} ms`);
  console.log(`  severity      : ${r.severity}`);
  console.log(`  watertight    : ${r.watertight}`);
  console.log(`  open edges    : ${r.boundaryEdges}`);
  console.log(`  non-manifold  : ${r.nonManifoldEdges}`);
  console.log(`  winding clash : ${r.flippedEdges}`);
  console.log(`  degenerate    : ${r.degenerate}`);
  console.log(`  summary       : ${r.summary}`);
  if (r.advice) console.log(`  advice        : ${r.advice}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
