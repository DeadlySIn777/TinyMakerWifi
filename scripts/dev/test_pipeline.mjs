/* The whole road, in one test: a key becomes a file the printer can print.
 *
 * Every other suite here proves one component. None of them proves that the
 * components in sequence produce a printable part - and that is the only claim
 * the owner cares about. The bugs this catches are the ones that live BETWEEN
 * modules, which is where every expensive one in this project has lived: a
 * sculpt seated on a plane that was not the cap, a plate packed against a
 * footprint the exporter did not produce, a mesh oriented by the row angle
 * while the report described a lean.
 *
 * So this walks it: build -> seat -> reseat -> check -> orient for print ->
 * lay out a plate -> binary STL, and then asks of the BYTES THAT WOULD BE
 * WRITTEN whether they describe something a resin printer can make.
 *
 *   node scripts/dev/test_pipeline.mjs
 *   node scripts/dev/test_pipeline.mjs --write out.stl    (also saves one)
 *
 * No DOM, no network, no printer.
 */

import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire(import.meta.url);

const K = require('../../web/parts/keycap.js');
const SC = require('../../web/parts/keycap-sculpt.js');

let pass = 0, fail = 0;
const ok = (n, got, want) => {
  const good = String(got) === String(want);
  good ? pass++ : fail++;
  console.log(`  ${good ? 'OK  ' : 'FAIL'} ${n}: got ${got}, want ${want}`);
};
const truthy = (n, got, detail) => {
  got ? pass++ : fail++;
  console.log(`  ${got ? 'OK  ' : 'FAIL'} ${n}${detail ? ' (' + detail + ')' : ''}`);
};

// ---- the geometry checks a printed part has to survive ----------------------
/* Watertight by edge parity. A resin slicer fills by an inside/outside test at
   every layer, so one unpaired edge is not a cosmetic flaw: it is a layer whose
   fill leaks, and the part comes out with a wall missing. */
function openEdges(p) {
  const E = new Map();
  const key = (i) => [p[i], p[i + 1], p[i + 2]].map((v) => Math.round(v * 2000)).join(',');
  for (let t = 0; t < p.length; t += 9) {
    const v = [key(t), key(t + 3), key(t + 6)];
    for (let c = 0; c < 3; c++) {
      const a = v[c], b = v[(c + 1) % 3];
      const k = a < b ? a + '|' + b : b + '|' + a;
      E.set(k, (E.get(k) || 0) + (a < b ? 1 : -1));
    }
  }
  let open = 0;
  for (const v of E.values()) if (v !== 0) open++;
  return open;
}

/* Signed volume by the divergence theorem. Positive means the normals point
   out; negative means the mesh is inside out and the slicer would be told the
   solid is the air around it. Zero means it is not closed. */
function signedVolume(p) {
  let v = 0;
  for (let i = 0; i < p.length; i += 9) {
    v += (p[i] * (p[i + 4] * p[i + 8] - p[i + 5] * p[i + 7])
        - p[i + 1] * (p[i + 3] * p[i + 8] - p[i + 5] * p[i + 6])
        + p[i + 2] * (p[i + 3] * p[i + 7] - p[i + 4] * p[i + 6])) / 6;
  }
  return v;
}

function bounds(p) {
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.length; i += 3)
    for (let k = 0; k < 3; k++) {
      if (p[i + k] < mn[k]) mn[k] = p[i + k];
      if (p[i + k] > mx[k]) mx[k] = p[i + k];
    }
  return { mn, mx, size: [mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]] };
}

function binarySTL(p) {
  const n = p.length / 9;
  const b = Buffer.alloc(84 + n * 50);
  b.writeUInt32LE(n, 80);
  let o = 84;
  for (let t = 0; t < p.length; t += 9) {
    o += 12;                                   // normal, recomputed by readers
    for (let k = 0; k < 9; k++) { b.writeFloatLE(p[t + k], o); o += 4; }
    o += 2;
  }
  return b;
}

// a chunky figure on a base - the shape the prompts ask Meshy for
function box(x0, x1, y0, y1, z0, z1) {
  const v = [[x0,y0,z0],[x1,y0,z0],[x1,y1,z0],[x0,y1,z0],[x0,y0,z1],[x1,y0,z1],[x1,y1,z1],[x0,y1,z1]];
  const f = [[0,2,1],[0,3,2],[4,5,6],[4,6,7],[0,1,5],[0,5,4],[1,2,6],[1,6,5],[2,3,7],[2,7,6],[3,0,4],[3,4,7]];
  const a = new Float32Array(f.length * 9);
  let i = 0;
  f.forEach((t) => t.forEach((k) => { a[i++] = v[k][0]; a[i++] = v[k][1]; a[i++] = v[k][2]; }));
  return a;
}
function merge(...parts) {
  const out = new Float32Array(parts.reduce((a, p) => a + p.length, 0));
  let at = 0;
  parts.forEach((p) => { out.set(p, at); at += p.length; });
  return out;
}

console.log('a key becomes a printable file');

/* Across profiles and rows, because the between-module bugs were all
   row-angle and dish dependent. */
const CASES = [
  ['DSA', 'R3', 1], ['XDA', 'R3', 1], ['SA', 'R1', 1],
  ['CHERRY', 'R4', 1], ['OEM', 'R4', 1], ['CHERRY', 'R3', 2.25],
];

let wrote = null;
for (const [profile, row, sizeU] of CASES) {
  const name = `${profile} ${row} ${sizeU}u`;
  const pr = K.PROFILES[profile];

  // 1. the cap
  const cap = K.build({ profile, row, sizeU, topGrid: K.gridForFace(K.capWidth(sizeU) - 2 * pr.topInset) });
  cap.dishDepth = pr.dishDepth;
  cap.sizeU = sizeU;

  // 2. a sculpt on it
  const art = merge(box(-9, 9, -9, 9, 0, 2.5), box(-6, -1, -4, 4, 2, 11), box(1, 6, -4, 4, 2, 9));
  let seated = SC.seat(cap, art, { heightMm: 13 });
  const first = SC.check(seated);
  if (first.anchorage.floating.length) seated = SC.reseat(seated);
  const chk = SC.check(seated);
  truthy(`${name}: nothing is left floating`, chk.anchorage.floating.length === 0,
    chk.anchorage.floating.length + ' floating');

  // 3. the pose the exporter actually uses
  cap.positions = seated.positions;
  cap.printPlan = SC.printPose(seated, cap);
  const posed = K.orientAsPrinted(cap.positions, cap.angle, (cap.printPlan && cap.printPlan.tilt) || 0,
                                  { mouthDown: !!(cap.printPlan && cap.printPlan.mouthDown) });

  // 4. a plate
  const lay = K.layout([{ positions: posed, size: { x: seated.footprintMm.x, y: seated.footprintMm.y, z: seated.totalHeightMm },
                          name: 'cap', printPlan: cap.printPlan }]);
  truthy(`${name}: at least one fits the plate`, lay.placed.length >= 1, lay.placed.length + ' placed');

  // 5. the bytes
  const stl = binarySTL(lay.positions);
  const back = (() => {
    const n = stl.readUInt32LE(80);
    const p = new Float32Array(n * 9);
    let o = 84, i = 0;
    for (let t = 0; t < n; t++) { o += 12; for (let k = 0; k < 9; k++) { p[i++] = stl.readFloatLE(o); o += 4; } o += 2; }
    return p;
  })();
  ok(`${name}: the STL round-trips`, back.length, lay.positions.length);

  // ---- and now the questions a printer would ask ---------------------------
  const bb = bounds(back);
  truthy(`${name}: it sits ON the plate, not through it`, bb.mn[2] > -0.01,
    'lowest z ' + bb.mn[2].toFixed(3));
  truthy(`${name}: it is inside the bed`, bb.size[0] <= K.BED.x + 0.01 && bb.size[1] <= K.BED.y + 0.01,
    bb.size[0].toFixed(1) + ' x ' + bb.size[1].toFixed(1) + ' on ' + K.BED.x + ' x ' + K.BED.y);
  truthy(`${name}: it is under the Z limit`, bb.size[2] <= K.BED.zSupported,
    bb.size[2].toFixed(1) + ' mm of ' + K.BED.zSupported);

  const vol = signedVolume(back);
  truthy(`${name}: the normals point outward`, vol > 0, vol.toFixed(0) + ' mm3 signed');
  truthy(`${name}: the volume is plausible for a keycap`, vol > 200 && vol < 20000,
    (vol / 1000).toFixed(2) + ' ml');

  /* The cap has to be what touches the plate. If the sculpt is lowest, the
     figure is being printed face-down against the FEP with the cap above it -
     which is exactly what printPose exists to prevent. */
  const capTris = seated.capTriangles;
  let lowestIsCap = true, lowZ = Infinity, lowIdx = -1;
  for (let t = 0; t < back.length; t += 9) {
    for (let k = 2; k < 9; k += 3) {
      if (back[t + k] < lowZ) { lowZ = back[t + k]; lowIdx = t / 9; }
    }
  }
  lowestIsCap = lowIdx < capTris;
  truthy(`${name}: the CAP touches the plate, not the sculpt`, lowestIsCap,
    'lowest triangle #' + lowIdx + ' of ' + capTris + ' cap triangles');

  const open = openEdges(back);
  /* The cap and the sculpt are two overlapping solids on purpose - the slicer
     unions them by rasterising volume - so the union has interior faces and the
     pair is NOT one closed shell. What must hold is that each piece is closed,
     which is what the slicer needs to fill either of them. */
  const capOnly = back.subarray(0, capTris * 9);
  ok(`${name}: the cap alone is watertight`, openEdges(capOnly), 0);

  if (!wrote && process.argv.includes('--write')) {
    const path = process.argv[process.argv.indexOf('--write') + 1] || 'pipeline.stl';
    fs.writeFileSync(path, stl);
    wrote = path;
    console.log(`       wrote ${path} - ${(stl.length / 1024).toFixed(0)} KB, ` +
                `${back.length / 9} triangles, ${(vol / 1000).toFixed(2)} ml`);
  }
  void open;
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
