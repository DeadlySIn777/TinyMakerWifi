/* Tests for web/parts/meshy-glb.js — node scripts/dev/test_meshy_glb.mjs
 *
 * Builds GLB files byte by byte so the expected geometry is known exactly.
 * A reader that "looks right" on a real file proves very little; one that
 * reproduces a triangle whose coordinates you chose proves the maths.
 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { parseGLB } = require('../../web/parts/meshy-glb.js');

let pass = 0, fail = 0;
const ok = (n, got, want) => {
  const good = String(got) === String(want);
  console.log(`  ${good ? 'OK  ' : 'FAIL'} ${n}: got ${got}, want ${want}`);
  good ? pass++ : fail++;
};
const truthy = (n, got, detail) => {
  if (got) { pass++; console.log('  OK   ' + n + (detail ? ' (' + detail + ')' : '')); }
  else { fail++; console.log('  FAIL ' + n + (detail ? ' (' + detail + ')' : '')); }
};
const near = (n, got, want, tol = 1e-4) => {
  const good = Math.abs(got - want) <= tol;
  console.log(`  ${good ? 'OK  ' : 'FAIL'} ${n}: got ${got}, want ${want}`);
  good ? pass++ : fail++;
};

/* ---- build a GLB ------------------------------------------------------- */
function buildGLB(gltf, binBytes) {
  const json = Buffer.from(JSON.stringify(gltf), 'utf8');
  const jpad = (4 - (json.length % 4)) % 4;
  const jchunk = Buffer.concat([json, Buffer.alloc(jpad, 0x20)]);
  const bin = binBytes || Buffer.alloc(0);
  const bpad = (4 - (bin.length % 4)) % 4;
  const bchunk = Buffer.concat([bin, Buffer.alloc(bpad, 0)]);
  const total = 12 + 8 + jchunk.length + (bin.length ? 8 + bchunk.length : 0);
  const out = Buffer.alloc(total);
  let o = 0;
  out.writeUInt32LE(0x46546C67, o); o += 4;   // 'glTF'
  out.writeUInt32LE(2, o); o += 4;
  out.writeUInt32LE(total, o); o += 4;
  out.writeUInt32LE(jchunk.length, o); o += 4;
  out.writeUInt32LE(0x4E4F534A, o); o += 4;   // JSON
  jchunk.copy(out, o); o += jchunk.length;
  if (bin.length) {
    out.writeUInt32LE(bchunk.length, o); o += 4;
    out.writeUInt32LE(0x004E4942, o); o += 4; // BIN
    bchunk.copy(out, o);
  }
  return out.buffer.slice(out.byteOffset, out.byteOffset + out.length);
}

// one triangle: (0,0,0) (1,0,0) (0,1,0) in glTF's Y-up space, + UVs
function oneTriangleGLB(extra = {}) {
  const verts = new Float32Array([0,0,0, 1,0,0, 0,1,0]);
  const uv    = new Float32Array([0,0, 1,0, 0,1]);
  const idx   = new Uint16Array([0,1,2, 0]);        // padded to 4-byte
  const bin = Buffer.concat([
    Buffer.from(verts.buffer), Buffer.from(uv.buffer), Buffer.from(idx.buffer)
  ]);
  const g = {
    asset: { version: '2.0' },
    scene: 0, scenes: [{ nodes: [0] }],
    nodes: [Object.assign({ mesh: 0 }, extra.node || {})],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, TEXCOORD_0: 1 }, indices: 2 }] }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' },
      { bufferView: 1, componentType: 5126, count: 3, type: 'VEC2' },
      { bufferView: 2, componentType: 5123, count: 3, type: 'SCALAR' }
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0,  byteLength: 36 },
      { buffer: 0, byteOffset: 36, byteLength: 24 },
      { buffer: 0, byteOffset: 60, byteLength: 6 }
    ],
    buffers: [{ byteLength: bin.length }]
  };
  if (extra.gltf) Object.assign(g, extra.gltf);
  return buildGLB(g, bin);
}

/* ---- 1. a plain triangle ----------------------------------------------- */
console.log('\none indexed triangle with UVs');
let r = parseGLB(oneTriangleGLB());
ok('triangles', r.triangles, 1);
ok('positions length', r.positions.length, 9);
ok('uvs present', !!r.uvs, true);

/* ---- 2. the Y-up -> Z-up conversion ------------------------------------ */
// glTF (x,y,z) -> printer (x, -z, y). Vertex 3 is (0,1,0) so it must land at
// (0, 0, 1) - i.e. UP the printer's Z, not along its Y.
console.log('\nglTF Y-up converted to printer Z-up');
near('v3 x', r.positions[6], 0);
near('v3 y', r.positions[7], 0);
near('v3 z (was glTF Y)', r.positions[8], 1);

console.log('\n  ...and with yUp:false it is left alone');
let raw = parseGLB(oneTriangleGLB(), { yUp: false });
near('v3 y stays 1', raw.positions[7], 1);
near('v3 z stays 0', raw.positions[8], 0);

/* ---- 3. node transforms are honoured ----------------------------------- */
// A generator that puts scale on the NODE is common; ignoring it silently
// produces a model of the wrong size - exactly the class of bug that cost a
// print this session.
console.log('\nnode scale is applied (not silently ignored)');
let scaled = parseGLB(oneTriangleGLB({ node: { mesh: 0, scale: [10, 10, 10] } }));
near('v2 x scaled 10x', scaled.positions[3], 10);

console.log('\nnode translation is applied');
let moved = parseGLB(oneTriangleGLB({ node: { mesh: 0, translation: [5, 0, 0] } }));
near('v1 x offset by 5', moved.positions[0], 5);

/* ---- 4. unindexed geometry --------------------------------------------- */
console.log('\nunindexed primitive (no indices accessor)');
{
  const verts = new Float32Array([0,0,0, 2,0,0, 0,2,0]);
  const bin = Buffer.from(verts.buffer);
  const g = {
    asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36 }],
    buffers: [{ byteLength: 36 }]
  };
  const u = parseGLB(buildGLB(g, bin));
  ok('triangles', u.triangles, 1);
  ok('no uvs reported', u.uvs, null);
  near('v2 x', u.positions[3], 2);
}

/* ---- 5. refusals, by name rather than by garbage ------------------------ */
console.log('\nrefusals');
const refuses = (name, buf) => {
  try { parseGLB(buf); console.log(`  FAIL ${name}: did not refuse`); fail++; }
  catch (e) { console.log(`  OK   ${name}: "${e.message.slice(0, 62)}"`); pass++; }
};
refuses('not a GLB', new Uint8Array([1,2,3,4,5,6,7,8,9,10,11,12]).buffer);
refuses('Draco', oneTriangleGLB({ gltf: { extensionsRequired: ['KHR_draco_mesh_compression'] } }));
refuses('KTX2', oneTriangleGLB({ gltf: { extensionsRequired: ['KHR_texture_basisu'] } }));

/* ---- 6. feeds the slicer's own shape ----------------------------------- */
console.log('\noutput is what the slicer eats');
ok('Float32Array', r.positions instanceof Float32Array, true);
ok('9 floats per triangle', r.positions.length % 9, 0);

/* ---- 7. and the health checker accepts it ------------------------------ */
const { meshHealth } = require('../../web/parts/mesh-health.js');
const h = meshHealth(r.positions);
console.log(`\nmesh-health on the parsed triangle: ${h.triangles} tri, ${h.summary}`);
ok('health ran', h.triangles, 1);


console.log('\nWHAT A GENERATOR CAN HAND YOU THAT USED TO GO WRONG QUIETLY');
/* Every one of these produced a mesh that looked plausible and was wrong -
   which is the only kind of bug that reaches a printed part. */

/* A node library with no `scenes`. visit() recurses into children, so walking
   every node as a root walked each child TWICE: once placed by its parent and
   once more with the identity, stripping the parent's transform. Doubled
   geometry, second copy in the wrong place. */
{
  const tri = [0,0,0, 4,0,0, 0,4,0];
  const g = buildGLB({
    asset: { version: '2.0' },
    // no `scenes` at all - legal, and the branch that was broken
    nodes: [ { mesh: 0, children: [1], translation: [10, 0, 0] },
             { mesh: 0 } ],
    meshes: [ { primitives: [ { attributes: { POSITION: 0 } } ] } ],
    accessors: [ { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' } ],
    bufferViews: [ { buffer: 0, byteOffset: 0, byteLength: 36 } ],
    buffers: [ { byteLength: 36 } ]
  }, Buffer.from(new Float32Array(tri).buffer));
  const r = parseGLB(g);
  ok('a GLB with no scenes yields each node once', r.triangles, 2);
}

/* A mirroring node. apply() applied the world matrix without asking what it
   did to handedness, so scale [-1,1,1] handed back geometry wound inside out -
   renders black, and tells a slicer the solid is the air around it. */
{
  const tri = [0,0,0, 4,0,0, 0,4,0];
  const mk = (scale) => parseGLB(buildGLB({
    asset: { version: '2.0' },
    scenes: [ { nodes: [0] } ], scene: 0,
    nodes: [ { mesh: 0, scale } ],
    meshes: [ { primitives: [ { attributes: { POSITION: 0 } } ] } ],
    accessors: [ { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' } ],
    bufferViews: [ { buffer: 0, byteOffset: 0, byteLength: 36 } ],
    buffers: [ { byteLength: 36 } ]
  }, Buffer.from(new Float32Array(tri).buffer)));
  /* The real normal, not a flattened stand-in. The first version of this
     computed a cross product with two hard-coded zeros in it and returned 0 for
     both cases - a test that could not fail, which is worse than no test. */
  const normal = (p) => {
    const ux=p[3]-p[0], uy=p[4]-p[1], uz=p[5]-p[2];
    const vx=p[6]-p[0], vy=p[7]-p[1], vz=p[8]-p[2];
    return [uy*vz - uz*vy, uz*vx - ux*vz, ux*vy - uy*vx];
  };
  const dominant = (n) => {
    let i = 0;
    for (let k = 1; k < 3; k++) if (Math.abs(n[k]) > Math.abs(n[i])) i = k;
    return { axis: i, sign: Math.sign(n[i]) };
  };
  const a1 = dominant(normal(mk([1,1,1]).positions));
  const a2 = dominant(normal(mk([-1,1,1]).positions));
  truthy('the normal is actually measurable', a1.sign !== 0, JSON.stringify(a1));
  truthy('a mirrored node does not come back inside out',
    a1.axis === a2.axis && a1.sign === a2.sign,
    'plain axis ' + a1.axis + ' sign ' + a1.sign +
    ', mirrored axis ' + a2.axis + ' sign ' + a2.sign);
}

/* Draco in extensionsUsed only - legal, means "skip if you cannot read it" -
   used to slip past a check that read extensionsRequired alone, and then every
   accessor had no bufferView and every vertex came back at the origin. */
for (const [where, key] of [['extensionsRequired','extensionsRequired'],
                            ['extensionsUsed','extensionsUsed']]) {
  const doc = {
    asset: { version: '2.0' }, [key]: ['KHR_draco_mesh_compression'],
    scenes: [ { nodes: [0] } ], scene: 0, nodes: [ { mesh: 0 } ],
    meshes: [ { primitives: [ { attributes: { POSITION: 0 } } ] } ],
    accessors: [ { componentType: 5126, count: 3, type: 'VEC3' } ],
    bufferViews: [], buffers: []
  };
  let msg = '';
  try { parseGLB(buildGLB(doc, Buffer.alloc(0))); } catch (e) { msg = e.message; }
  truthy('Draco in ' + where + ' is refused by name', /compressed/i.test(msg), msg.slice(0, 70));
}

/* KTX2 is a TEXTURE extension. Refusing it from extensionsUsed would throw out
   models whose geometry is perfectly readable. */
{
  const tri = [0,0,0, 4,0,0, 0,4,0];
  const doc = {
    asset: { version: '2.0' }, extensionsUsed: ['KHR_texture_basisu'],
    scenes: [ { nodes: [0] } ], scene: 0, nodes: [ { mesh: 0 } ],
    meshes: [ { primitives: [ { attributes: { POSITION: 0 } } ] } ],
    accessors: [ { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' } ],
    bufferViews: [ { buffer: 0, byteOffset: 0, byteLength: 36 } ],
    buffers: [ { byteLength: 36 } ]
  };
  let okLoad = false;
  try { okLoad = parseGLB(buildGLB(doc, Buffer.from(new Float32Array(tri).buffer))).triangles === 1; } catch (e) {}
  truthy('KTX2 in extensionsUsed still loads its geometry', okLoad);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
