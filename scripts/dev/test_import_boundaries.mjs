/* Offline malformed-import regressions, plus valid controls. No printer I/O.
 * Fixtures reproduce import audit groups 4–6 without using a live model/service.
 * node scripts/dev/test_import_boundaries.mjs
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { parseGLB } = require('../../web/parts/meshy-glb.js');
const { readModelFile } = require('../../web/parts/stl-read.js');
const { meshHealth } = require('../../web/parts/mesh-health.js');

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('OK ' + name); }
const arrayBuffer = b => b.buffer.slice(b.byteOffset, b.byteOffset + b.length);
const f32 = a => Buffer.from(new Float32Array(a).buffer);
const triangle = f32([0,0,0, 1,0,0, 0,1,0]);
function document() {
  return { asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }], meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36 }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' }] };
}
function glb(g, bytes = triangle) {
  if (!g.buffers) g.buffers = [{ byteLength: bytes.length }];
  let json = Buffer.from(JSON.stringify(g));
  json = Buffer.concat([json, Buffer.alloc((4-json.length%4)%4, 32)]);
  const bin = Buffer.concat([bytes, Buffer.alloc((4-bytes.length%4)%4)]);
  const out = Buffer.alloc(28 + json.length + bin.length);
  out.writeUInt32LE(0x46546c67, 0); out.writeUInt32LE(2, 4); out.writeUInt32LE(out.length, 8);
  out.writeUInt32LE(json.length, 12); out.writeUInt32LE(0x4e4f534a, 16); json.copy(out, 20);
  out.writeUInt32LE(bin.length, 20+json.length); out.writeUInt32LE(0x004e4942, 24+json.length);
  bin.copy(out, 28+json.length);
  return arrayBuffer(out);
}
function refuses(name, edit, pattern, bytes = triangle) {
  test(name, () => { const g = document(); edit(g);
    assert.throws(() => readModelFile(glb(g, bytes), 'fixture.glb'), pattern); });
}

test('valid ordinary GLB through actual file-reader entry point', () => {
  const r = readModelFile(glb(document()), 'valid.glb');
  assert.equal(r.triangles, 1);
  assert.deepEqual(Array.from(r.positions), [0,-0,0, 1,-0,0, 0,-0,1]);
});
test('legal BIN padding is not mistaken for truncation', () => {
  const g = document();
  g.bufferViews.push({ buffer: 0, byteOffset: 36, byteLength: 6 });
  g.accessors.push({ bufferView: 1, componentType: 5123, type: 'SCALAR', count: 3 });
  g.meshes[0].primitives[0].indices = 1;
  const r = parseGLB(glb(g, Buffer.concat([triangle, Buffer.from(new Uint16Array([0,1,2]).buffer)])));
  assert.equal(r.triangles, 1); // 42 declared bytes, 44-byte padded BIN
});
test('interleaved POSITION respects byteStride and accessor offset', () => {
  const g = document();
  g.bufferViews[0].byteLength = 48; g.bufferViews[0].byteStride = 16;
  g.accessors[0].byteOffset = 4;
  const r = parseGLB(glb(g, f32([42,0,0,0, 42,1,0,0, 42,0,1,0])));
  assert.deepEqual(Array.from(r.positions), [0,-0,0, 1,-0,0, 0,-0,1]);
});
for (const [componentType, Ctor, maximum] of [[5121, Uint8Array, 255], [5123, Uint16Array, 65535]]) {
  test('normalized unsigned UVs decode correctly: ' + componentType, () => {
    const g = document(), uv = Buffer.from(new Ctor([0,0, maximum,0, 0,maximum]).buffer);
    g.bufferViews.push({ buffer: 0, byteOffset: 36, byteLength: uv.length });
    g.accessors.push({ bufferView: 1, componentType, type: 'VEC2', count: 3, normalized: true });
    g.meshes[0].primitives[0].attributes.TEXCOORD_0 = 1;
    assert.deepEqual(Array.from(parseGLB(glb(g, Buffer.concat([triangle, uv]))).uvs), [0,0,1,0,0,1]);
  });
}

refuses('sparse replacement with a real base view is explicitly unsupported', g => {
  g.bufferViews.push({ buffer: 0, byteOffset: 36, byteLength: 1 }, { buffer: 0, byteOffset: 40, byteLength: 12 });
  g.accessors[0].sparse = { count: 1, indices: { bufferView: 1, componentType: 5121 }, values: { bufferView: 2 } };
}, /sparse/i, Buffer.concat([triangle, Buffer.from([2,0,0,0]), f32([0,7,0])]));
refuses('sparse accessor without a base view is explicitly unsupported', g => {
  delete g.accessors[0].bufferView; g.accessors[0].sparse = { count: 1 };
}, /sparse/i);
refuses('weighted morph does not silently return the base shape', g => {
  g.meshes[0].weights = [1];
  g.meshes[0].primitives[0].targets = [{ POSITION: 1 }];
  g.bufferViews.push({ buffer: 0, byteOffset: 36, byteLength: 36 });
  g.accessors.push({ bufferView: 1, componentType: 5126, type: 'VEC3', count: 3 });
}, /morph/i, Buffer.concat([triangle, f32([0,0,0, 0,0,0, 0,6,0])]));
refuses('morph target without explicit weights is also named', g => {
  g.meshes[0].primitives[0].targets = [{ POSITION: 0 }];
}, /morph/i);
refuses('node morph weights are not silently discarded', g => { g.nodes[0].weights = [1]; }, /morph/i);
refuses('skin node is explicitly refused before bind-pose import', g => {
  g.nodes[0].skin = 0; g.skins = [{ joints: [0] }];
}, /skinned/i);
refuses('joint attributes are not silently ignored', g => {
  g.meshes[0].primitives[0].attributes.JOINTS_0 = 1;
}, /skinned/i);
refuses('complete GLB with index 99 against 3 vertices is refused', g => {
  g.bufferViews.push({ buffer: 0, byteOffset: 36, byteLength: 6 });
  g.accessors.push({ bufferView: 1, componentType: 5123, type: 'SCALAR', count: 3 });
  g.meshes[0].primitives[0].indices = 1;
}, /index.*past/i, Buffer.concat([triangle, Buffer.from(new Uint16Array([0,1,99]).buffer)]));
refuses('accessor cannot consume a neighbouring bufferView', g => {
  g.accessors[0].count = 6;
  g.bufferViews.push({ buffer: 0, byteOffset: 36, byteLength: 36 });
}, /bufferView/i, Buffer.concat([triangle, f32([10,10,10,11,10,10,10,11,10])]));
for (const [label, edit] of [
  ['negative accessor offset', g => { g.accessors[0].byteOffset = -4; }],
  ['misaligned accessor offset', g => { g.accessors[0].byteOffset = 1; }],
  ['negative bufferView offset', g => { g.bufferViews[0].byteOffset = -4; }],
  ['short stride', g => { g.bufferViews[0].byteStride = 8; }],
  ['misaligned stride', g => { g.bufferViews[0].byteStride = 13; }],
  ['bufferView extends beyond BIN', g => { g.bufferViews[0].byteLength = 40; }],
  ['missing view reference', g => { g.accessors[0].bufferView = 4; }],
  ['missing accessor reference', g => { g.meshes[0].primitives[0].attributes.POSITION = 4; }],
  ['zero accessor count', g => { g.accessors[0].count = 0; }],
  ['fractional accessor count', g => { g.accessors[0].count = 2.5; }],
  ['negative accessor count', g => { g.accessors[0].count = -3; }],
  ['excessive accessor count before allocation', g => { g.accessors[0].count = 1e12; }],
  ['wrong position arity', g => { g.accessors[0].type = 'VEC2'; }],
  ['integer position representation', g => { g.accessors[0].componentType = 5123; }],
  ['normalized float position', g => { g.accessors[0].normalized = true; }],
  ['partial unindexed triangle', g => { g.accessors[0].count = 2; }],
  ['external buffer reference', g => { g.bufferViews[0].buffer = 1; }],
  ['external buffer URI', g => { g.buffers = [{ byteLength: 36, uri: 'other.bin' }]; }],
  ['oversize declared buffer', g => { g.buffers = [{ byteLength: 40 }]; }],
  ['truncated matrix', g => { g.nodes[0].matrix = [1,0,0]; }],
  ['non-affine matrix', g => { g.nodes[0].matrix = [1,0,0,1,0,1,0,0,0,0,1,0,0,0,0,1]; }],
  ['invalid translation', g => { g.nodes[0].translation = ['1',0,0]; }],
  ['missing scene node', g => { g.scenes[0].nodes = [2]; }],
  ['missing mesh', g => { g.nodes[0].mesh = 3; }],
  ['missing default scene', g => { g.scene = 3; }],
  ['cycle in node hierarchy', g => { g.nodes[0].children = [0]; }],
  ['mixed point/triangle mesh must not be partially imported', g => {
    g.meshes[0].primitives.push({ attributes: { POSITION: 0 }, mode: 0 });
  }],
]) refuses(label, edit, /GLB|accessor|POSITION|bufferView/i);

for (const value of [NaN, Infinity, -Infinity]) {
  refuses('non-finite binary vertex ' + value, () => {}, /non-finite/i, f32([0,0,0, 1,0,0, 0,value,0]));
}
refuses('finite transform overflowing Float32 storage is refused', g => {
  g.nodes[0].scale = [1e300,1e300,1e300];
}, /broken numbers|out of range/i);
test('container length must match, not clamp to available bytes', () => {
  for (const delta of [-4, 4]) {
    const b = glb(document()); new DataView(b).setUint32(8, b.byteLength + delta, true);
    assert.throws(() => parseGLB(b), /length/i);
  }
});
test('chunk length must fit the declared container', () => {
  const b = glb(document()); new DataView(b).setUint32(12, b.byteLength, true);
  assert.throws(() => parseGLB(b), /chunk.*length/i);
});
test('wrong index component type is refused rather than rounded', () => {
  const g = document(); g.bufferViews.push({ buffer: 0, byteOffset: 36, byteLength: 12 });
  g.accessors.push({ bufferView: 1, componentType: 5126, type: 'SCALAR', count: 3 });
  g.meshes[0].primitives[0].indices = 1;
  assert.throws(() => parseGLB(glb(g, Buffer.concat([triangle, f32([0,1,1.5])]))), /indices.*integer/i);
});
test('UV count must match vertex count', () => {
  const g = document(); g.bufferViews.push({ buffer: 0, byteOffset: 36, byteLength: 16 });
  g.accessors.push({ bufferView: 1, componentType: 5126, type: 'VEC2', count: 2 });
  g.meshes[0].primitives[0].attributes.TEXCOORD_0 = 1;
  assert.throws(() => parseGLB(glb(g, Buffer.concat([triangle, f32([0,0,1,0])]))), /count.*vertices/i);
});

const facet = points => 'facet normal 0 0 1\nouter loop\n' +
  points.map(v => 'vertex ' + v.join(' ')).join('\n') + '\nendloop\nendfacet\n';
const validFacet = facet([[0,0,0], [1,0,0], [0,1,0]]);
const ascii = text => readModelFile(arrayBuffer(Buffer.from(text)), 'fixture.stl');
const solid = body => 'solid named model\n' + body + 'endsolid named model\n';
test('valid ASCII STL preserves negative exponents and signed decimals', () => {
  const r = ascii(solid(facet([['1.0e-003','-.5','+1.'], [1,0,0], [0,1,0]])));
  assert.equal(r.triangles, 1); assert.ok(Math.abs(r.positions[0] - .001) < 1e-9);
  assert.equal(r.positions[1], -.5); assert.equal(r.positions[2], 1);
});
test('ASCII body accepts flexible whitespace, CRLF, uppercase tokens', () => {
  assert.equal(ascii('SOLID test\r\n' + validFacet.toUpperCase().replace(/\n/g, ' \t') + '\r\nENDSOLID test').triangles, 1);
});
test('multiple complete solids remain supported', () => {
  assert.equal(ascii(solid(validFacet) + solid(validFacet)).triangles, 2);
});
for (const [label, text] of [
  ['unfinished final facet', 'solid a\n'+validFacet+'facet normal 0 0 1\nouter loop\nvertex 0 0 2\nvertex 1 0 2\n'],
  ['2 + 4 vertex facets cannot regroup', solid(facet([[0,0,0],[1,0,0]])+facet([[10,10,0],[11,10,0],[10,11,0],[11,11,0]]))],
  ['NaN vertex must not be dropped', solid(validFacet+facet([[0,0,2],[1,0,2],['NaN',1,2]]))],
  ['coordinate suffix is not a partial numeric match', solid(facet([[0,0,'2x'],[1,0,2],[0,1,2]]))],
  ['infinite exponent is refused', solid(facet([[0,0,'1e999'],[1,0,2],[0,1,2]]))],
  ['missing endsolid', 'solid a\n'+validFacet],
  ['missing endfacet', solid(validFacet.replace('endfacet\n',''))],
  ['missing endloop', solid(validFacet.replace('endloop\n',''))],
  ['extra vertex in facet', solid(facet([[0,0,0],[1,0,0],[0,1,0],[1,1,0]]))],
  ['vertex outside a facet', solid(validFacet+'vertex 0 0 0\n')],
  ['trailing garbage after closed solid', solid(validFacet)+'vertex 0 0 0\n'],
]) test('ASCII rejects ' + label, () => assert.throws(() => ascii(text), /ASCII STL.*damaged|broken numbers/i));
test('binary STL beginning with solid is still read as binary', () => {
  const b = Buffer.alloc(134); b.write('solid deceptive header'); b.writeUInt32LE(1, 80);
  triangle.copy(b, 96);
  const r = readModelFile(arrayBuffer(b), 'valid.stl');
  assert.equal(r.format, 'binary'); assert.equal(r.triangles, 1);
  assert.deepEqual(Array.from(r.positions), [0,0,0,1,0,0,0,1,0]);
});

for (const [label, pos] of [
  ['empty', new Float32Array(0)], ['incomplete', new Float32Array(10)],
  ['NaN only', new Float32Array(9).fill(NaN)], ['zero area only', new Float32Array(9)],
  ['collinear only', new Float32Array([0,0,0,1,1,1,2,2,2])],
  ['valid face plus NaN tail', new Float32Array([0,0,0,1,0,0,0,1,0,NaN,0,0,0,0,0,0,0,0])],
  ['valid face plus Infinity', new Float32Array([0,0,0,1,0,0,0,1,Infinity])],
]) test('health refuses ' + label, () => {
  const h = meshHealth(pos); assert.equal(h.ok, false); assert.equal(h.severity, 'bad');
  assert.equal(h.watertight, false); assert.ok(h.fatal); assert.ok(h.advice);
});
test('health keeps usable open mesh as warning, not fatal', () => {
  const h = meshHealth(new Float32Array([0,0,0,1,0,0,0,1,0]));
  assert.equal(h.severity, 'warn'); assert.equal(h.fatal, undefined); assert.equal(h.surfaceArea, .5);
});
console.log(`${passed} import/health regression groups passed; no network or printer access.`);
