/* GLB -> triangle soup, with no library.
 *
 * WHY NOT GLTFLoader. The slicer does not want a scene graph; it wants the
 * Float32Array it already eats - 9 floats per triangle, unindexed, the same
 * thing parseSTL() hands to place(). GLTFLoader would bring a bare-specifier
 * import ("from 'three'"), ~23 KB of gzip into a page that lives in 4 MB of
 * flash, and optional Draco/KTX2 decoders we would then have to host. All to
 * produce a structure we immediately flatten.
 *
 * So this reads the container directly. It also yields UVs, which is what lets
 * the textured preview work without a loader either.
 *
 * WHAT IT DELIBERATELY DOES NOT DO. Draco and Basis/KTX2 compressed meshes are
 * refused by NAME rather than mis-parsed - the caller can then fall back to
 * asking the generator for an STL instead of printing something wrong. A reader
 * that quietly produces nonsense is worse than one that says "not this format".
 *
 * No DOM, no imports - scripts/dev/test_meshy_glb.mjs runs it in node.
 */

(function (root) {
  'use strict';

  var GLB_MAGIC = 0x46546C67;   // 'glTF'
  var CHUNK_JSON = 0x4E4F534A;  // 'JSON'
  var CHUNK_BIN  = 0x004E4942;  // 'BIN\0'

  var COMP = {            // accessor componentType -> [TypedArray, bytes]
    5120: [Int8Array, 1], 5121: [Uint8Array, 1],
    5122: [Int16Array, 2], 5123: [Uint16Array, 2],
    5125: [Uint32Array, 4], 5126: [Float32Array, 4]
  };
  var NUM = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

  function fail(msg) { var e = new Error(msg); e.glb = true; throw e; }

  // ---- matrices (column-major, as glTF stores them) -----------------------
  function ident() { return [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]; }
  function mul(a, b) {              // a * b
    var o = new Array(16);
    for (var c = 0; c < 4; c++) for (var r = 0; r < 4; r++) {
      var s = 0;
      for (var k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
      o[c * 4 + r] = s;
    }
    return o;
  }
  function fromTRS(t, r, s) {
    var x = r[0], y = r[1], z = r[2], w = r[3];
    var x2 = x + x, y2 = y + y, z2 = z + z;
    var xx = x * x2, xy = x * y2, xz = x * z2;
    var yy = y * y2, yz = y * z2, zz = z * z2;
    var wx = w * x2, wy = w * y2, wz = w * z2;
    var sx = s[0], sy = s[1], sz = s[2];
    return [
      (1 - (yy + zz)) * sx, (xy + wz) * sx, (xz - wy) * sx, 0,
      (xy - wz) * sy, (1 - (xx + zz)) * sy, (yz + wx) * sy, 0,
      (xz + wy) * sz, (yz - wx) * sz, (1 - (xx + yy)) * sz, 0,
      t[0], t[1], t[2], 1
    ];
  }
  function apply(m, x, y, z) {
    return [
      m[0] * x + m[4] * y + m[8]  * z + m[12],
      m[1] * x + m[5] * y + m[9]  * z + m[13],
      m[2] * x + m[6] * y + m[10] * z + m[14]
    ];
  }

  // ---- container ----------------------------------------------------------
  function splitGLB(buf) {
    var dv = new DataView(buf);
    if (buf.byteLength < 12) fail('not a GLB: too short');
    if (dv.getUint32(0, true) !== GLB_MAGIC) fail('not a GLB: bad magic');
    var ver = dv.getUint32(4, true);
    if (ver !== 2) fail('GLB version ' + ver + ' is not supported (need 2)');
    var json = null, bin = null, off = 12, total = dv.getUint32(8, true);
    var end = Math.min(total || buf.byteLength, buf.byteLength);
    while (off + 8 <= end) {
      var len = dv.getUint32(off, true), type = dv.getUint32(off + 4, true);
      var start = off + 8;
      if (start + len > buf.byteLength) fail('GLB chunk runs past the end of the file');
      if (type === CHUNK_JSON) json = new Uint8Array(buf, start, len);
      else if (type === CHUNK_BIN) bin = new Uint8Array(buf, start, len);
      off = start + len + ((4 - (len % 4)) % 4);   // chunks are 4-byte aligned
    }
    if (!json) fail('GLB has no JSON chunk');
    var text = (typeof TextDecoder !== 'undefined')
      ? new TextDecoder('utf-8').decode(json)
      : Buffer.from(json).toString('utf8');
    return { gltf: JSON.parse(text), bin: bin };
  }

  function readAccessor(g, bin, index) {
    var acc = g.accessors[index];
    if (!acc) fail('accessor ' + index + ' is missing');
    var n = NUM[acc.type];
    if (!n) fail('accessor type ' + acc.type + ' is not supported');
    var C = COMP[acc.componentType];
    if (!C) fail('component type ' + acc.componentType + ' is not supported');
    var Arr = C[0], bytes = C[1];
    var out = new Float32Array(acc.count * n);

    if (acc.bufferView == null) return out;      // sparse-only: zeros
    var bv = g.bufferViews[acc.bufferView];
    if (!bin) fail('GLB has no BIN chunk but an accessor needs one');
    var base = (bv.byteOffset || 0) + (acc.byteOffset || 0);
    var stride = bv.byteStride || (bytes * n);
    var dv = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);

    for (var i = 0; i < acc.count; i++) {
      var o = base + i * stride;
      for (var k = 0; k < n; k++) {
        var p = o + k * bytes, v;
        switch (acc.componentType) {
          case 5126: v = dv.getFloat32(p, true); break;
          case 5125: v = dv.getUint32(p, true); break;
          case 5123: v = dv.getUint16(p, true); break;
          case 5122: v = dv.getInt16(p, true); break;
          case 5121: v = dv.getUint8(p); break;
          default:   v = dv.getInt8(p); break;
        }
        out[i * n + k] = v;
      }
    }
    return out;
  }

  /* Returns { positions, uvs, triangles, sourceUp }.
     positions: Float32Array, 9 per triangle, unindexed - exactly what
     place()/slice() take. Axes are converted from glTF's Y-up to the printer's
     Z-up, because a model loaded without that lands on its face. */
  function parseGLB(buf, opts) {
    var o = opts || {};
    var s = splitGLB(buf);
    var g = s.gltf, bin = s.bin;

    var need = (g.extensionsRequired || []);
    for (var i = 0; i < need.length; i++) {
      if (/draco/i.test(need[i])) fail('this GLB is Draco-compressed - ask the generator for an uncompressed mesh or an STL');
      if (/basisu|ktx2/i.test(need[i])) fail('this GLB uses KTX2 textures - geometry may still load, but ask for a plain PNG texture');
    }
    if (!g.meshes || !g.meshes.length) fail('GLB has no meshes');

    // Walk the scene so node transforms are honoured. A generator that puts a
    // scale on the node - and many do - would otherwise be silently ignored.
    var tris = [];
    var haveUV = true;

    function visit(nodeIndex, parent) {
      var node = g.nodes[nodeIndex];
      if (!node) return;
      var local = node.matrix ? node.matrix.slice()
        : fromTRS(node.translation || [0,0,0], node.rotation || [0,0,0,1], node.scale || [1,1,1]);
      var world = mul(parent, local);
      if (node.mesh != null) collect(g.meshes[node.mesh], world);
      (node.children || []).forEach(function (c) { visit(c, world); });
    }

    function collect(mesh, m) {
      (mesh.primitives || []).forEach(function (prim) {
        if (prim.mode != null && prim.mode !== 4) return;   // triangles only
        var attr = prim.attributes || {};
        if (attr.POSITION == null) return;
        var pos = readAccessor(g, bin, attr.POSITION);
        var uv = (attr.TEXCOORD_0 != null) ? readAccessor(g, bin, attr.TEXCOORD_0) : null;
        if (!uv) haveUV = false;
        var idx = (prim.indices != null) ? readAccessor(g, bin, prim.indices) : null;
        var count = idx ? idx.length : (pos.length / 3);
        for (var t = 0; t + 2 < count; t += 3) {
          var tri = { p: [], uv: [] };
          for (var k = 0; k < 3; k++) {
            var vi = idx ? idx[t + k] : (t + k);
            var w = apply(m, pos[vi * 3], pos[vi * 3 + 1], pos[vi * 3 + 2]);
            tri.p.push(w);
            if (uv) tri.uv.push([uv[vi * 2], uv[vi * 2 + 1]]);
          }
          tris.push(tri);
        }
      });
    }

    var sceneIdx = (g.scene != null) ? g.scene : 0;
    var scene = (g.scenes && g.scenes[sceneIdx]) ? g.scenes[sceneIdx] : null;
    if (scene && scene.nodes) scene.nodes.forEach(function (n) { visit(n, ident()); });
    else if (g.nodes) g.nodes.forEach(function (_, i) { visit(i, ident()); });
    else g.meshes.forEach(function (m) { collect(m, ident()); });

    if (!tris.length) fail('GLB has no triangles (only points or lines?)');

    var yUp = (o.yUp === undefined) ? true : !!o.yUp;
    var positions = new Float32Array(tris.length * 9);
    var uvs = haveUV ? new Float32Array(tris.length * 6) : null;
    for (var t2 = 0; t2 < tris.length; t2++) {
      for (var k2 = 0; k2 < 3; k2++) {
        var p = tris[t2].p[k2];
        var x = p[0], y = p[1], z = p[2];
        // glTF Y-up -> printer Z-up: (x, y, z) -> (x, -z, y)
        var ox = x, oy = yUp ? -z : y, oz = yUp ? y : z;
        positions[t2 * 9 + k2 * 3]     = ox;
        positions[t2 * 9 + k2 * 3 + 1] = oy;
        positions[t2 * 9 + k2 * 3 + 2] = oz;
        if (uvs) {
          uvs[t2 * 6 + k2 * 2]     = tris[t2].uv[k2][0];
          uvs[t2 * 6 + k2 * 2 + 1] = tris[t2].uv[k2][1];
        }
      }
    }
    return { positions: positions, uvs: uvs, triangles: tris.length, yUpApplied: yUp };
  }

  root.meshyParseGLB = parseGLB;
  if (typeof module !== 'undefined' && module.exports) module.exports = { parseGLB: parseGLB };
})(typeof window !== 'undefined' ? window : globalThis);
