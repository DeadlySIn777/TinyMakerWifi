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
 * WHAT IT DELIBERATELY DOES NOT DO. Draco/meshopt compressed geometry is
 * refused by NAME rather than mis-parsed - the caller can then fall back to
 * asking the generator for an STL instead of printing something wrong. A reader
 * that quietly produces nonsense is worse than one that says "not this format".
 *
 * Appearance is optional: unsupported textures never discard valid geometry.
 * No DOM, no imports - scripts/dev/test_meshy_glb.mjs runs it in node.
 */

(function (root) {
  'use strict';

  var GLB_MAGIC = 0x46546C67;   // 'glTF'
  var CHUNK_JSON = 0x4E4F534A;  // 'JSON'
  var CHUNK_BIN  = 0x004E4942;  // 'BIN\0'
  var MAX_TRIS = 3000000;

  var COMP = {            // accessor componentType -> [TypedArray, bytes]
    5120: [Int8Array, 1], 5121: [Uint8Array, 1],
    5122: [Int16Array, 2], 5123: [Uint16Array, 2],
    5125: [Uint32Array, 4], 5126: [Float32Array, 4]
  };
  var NUM = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

  function fail(msg) { var e = new Error(msg); e.glb = true; throw e; }
  function uint(v) { return Number.isSafeInteger(v) && v >= 0; }
  function vector(v, n, label) {
    if (!Array.isArray(v) || v.length !== n || !v.every(Number.isFinite))
      fail('GLB has an invalid ' + label);
    return v;
  }

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
    if (total !== buf.byteLength) fail('GLB length does not match the complete file');
    while (off < total) {
      if (off + 8 > total) fail('GLB has an incomplete chunk header');
      var len = dv.getUint32(off, true), type = dv.getUint32(off + 4, true);
      var start = off + 8;
      if (len % 4 || start + len > total) fail('GLB chunk has an invalid length');
      if (off === 12 && type !== CHUNK_JSON) fail('GLB must begin with its JSON chunk');
      if (type === CHUNK_JSON) {
        if (json) fail('GLB has duplicate JSON chunks');
        json = new Uint8Array(buf, start, len);
      } else if (type === CHUNK_BIN) {
        if (bin) fail('GLB has duplicate BIN chunks');
        bin = new Uint8Array(buf, start, len);
      }
      off = start + len;
    }
    if (!json) fail('GLB has no JSON chunk');
    var text = (typeof TextDecoder !== 'undefined')
      ? new TextDecoder('utf-8').decode(json)
      : Buffer.from(json).toString('utf8');
    var g;
    try { g = JSON.parse(text); } catch (_) { fail('GLB contains invalid JSON'); }
    if (!g || !g.asset || g.asset.version !== '2.0') fail('GLB requires a glTF 2.0 asset');
    return { gltf: g, bin: bin };
  }

  function readAccessor(g, bin, index, semantic) {
    var acc = uint(index) && g.accessors && g.accessors[index];
    if (!acc) fail('accessor ' + index + ' is missing');
    if (acc.sparse) fail('Sparse GLB accessors are not supported; export a flattened mesh or STL');
    if (!uint(acc.count) || acc.count < 1 || acc.count > MAX_TRIS * 3)
      fail('GLB accessor has an invalid or excessive count');
    if (semantic === 'POSITION' && (acc.type !== 'VEC3' || acc.componentType !== 5126 || acc.normalized))
      fail('GLB POSITION must contain unnormalized float VEC3 coordinates');
    if (semantic === 'UV' && (acc.type !== 'VEC2' ||
        !((acc.componentType === 5126 && !acc.normalized) ||
          ([5121,5123].indexOf(acc.componentType) >= 0 && acc.normalized === true))))
      fail('GLB texture coordinates must contain float or normalized unsigned VEC2 values');
    if (semantic === 'COLOR' && (['VEC3','VEC4'].indexOf(acc.type) < 0 ||
        !((acc.componentType === 5126 && !acc.normalized) ||
          ([5121,5123].indexOf(acc.componentType) >= 0 && acc.normalized === true))))
      fail('GLB vertex colors must contain float or normalized unsigned RGB/RGBA values');
    if (semantic === 'INDEX' && (acc.type !== 'SCALAR' || acc.normalized ||
        [5121,5123,5125].indexOf(acc.componentType) < 0))
      fail('GLB triangle indices must be unsigned integer SCALAR values');
    var n = NUM[acc.type];
    if (!n) fail('accessor type ' + acc.type + ' is not supported');
    var C = COMP[acc.componentType];
    if (!C) fail('component type ' + acc.componentType + ' is not supported');
    var bytes = C[1];

    /* AN ACCESSOR WITH NO bufferView IS NOT "ZEROS". This returned a
       zero-filled array and called it sparse - and a Draco-compressed
       primitive's accessors have exactly that shape, so a compressed mesh that
       slipped past the extension check came back as a cloud of vertices all at
       the origin: no error, no triangles anybody could see, just nothing. This
       file's own header promises the opposite ("a reader that quietly produces
       nonsense is worse than one that says 'not this format'"). A genuinely
       sparse accessor is rare, is not what arrives here, and would need its
       substitution applied rather than ignored - so say so and stop. */
    if (acc.bufferView == null)
      fail('accessor ' + index + ' has no bufferView - the mesh is almost ' +
           'certainly compressed (Draco), which this reader does not decode');
    var bv = uint(acc.bufferView) && g.bufferViews && g.bufferViews[acc.bufferView];
    if (!bv) fail('GLB accessor references a missing bufferView');
    if (!bin) fail('GLB has no BIN chunk but an accessor needs one');
    var buffer = g.buffers && g.buffers[0];
    if (bv.buffer !== 0 || !buffer || buffer.uri != null || !uint(buffer.byteLength) ||
        buffer.byteLength > bin.byteLength || bin.byteLength - buffer.byteLength > 3)
      fail('GLB accessor requires a complete embedded BIN buffer');
    var viewOffset = bv.byteOffset == null ? 0 : bv.byteOffset;
    var accOffset = acc.byteOffset == null ? 0 : acc.byteOffset;
    var stride = bv.byteStride == null ? bytes * n : bv.byteStride;
    if (!uint(viewOffset) || !uint(bv.byteLength) || !uint(accOffset) || !uint(stride) ||
        stride < bytes * n || (bv.byteStride != null && (stride > 252 || stride % 4)) ||
        (semantic === 'INDEX' && bv.byteStride != null) ||
        accOffset % bytes || viewOffset % bytes ||
        viewOffset + bv.byteLength > buffer.byteLength ||
        accOffset + (acc.count - 1) * stride + bytes * n > bv.byteLength)
      fail('GLB accessor exceeds its bufferView or has invalid alignment/stride');
    var base = viewOffset + accOffset;
    var dv = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
    var out = semantic === 'INDEX' ? new Uint32Array(acc.count) : new Float32Array(acc.count * n);

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
        if (!Number.isFinite(v)) fail('GLB accessor has non-finite coordinates');
        if (acc.normalized) v /= acc.componentType === 5121 ? 255 : 65535;
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

    /* BOTH LISTS. A generator that writes Draco into extensionsUsed but not
       extensionsRequired - which is legal, and means "you may ignore this if
       you cannot read it" - got past a check that looked only at the required
       list, and then every accessor came back with no bufferView. The reader
       either has to decode it or say so by name; quietly producing a cloud of
       vertices at the origin is the one thing this file promises not to do. */
    /* TWO LISTS, TWO QUESTIONS - and conflating them refuses good models.

       GEOMETRY compression (Draco, meshopt) is fatal to this reader wherever it
       is declared: an accessor with no bufferView cannot be decoded, and a
       generator may legally put Draco in extensionsUsed ONLY, meaning "ignore
       this if you cannot read it" - which got past a check that looked at
       extensionsRequired alone and left every vertex at the origin.

       TEXTURE compression is a different matter. KTX2 in extensionsUsed is
       ordinary and touches nothing the geometry reader needs. Unreadable color
       falls back to a chosen reference palette without discarding the mesh. */
    var reqd = (g.extensionsRequired || []);
    var used = reqd.concat(g.extensionsUsed || []);
    for (var i = 0; i < used.length; i++)
      if (/draco|meshopt/i.test(used[i]))
        fail('this GLB is geometry-compressed (' + used[i] + ') - ask the ' +
             'generator for an uncompressed mesh or an STL');
    // Unsupported appearance is optional for an STL-producing application.
    // Keep valid geometry and mark its color reference incomplete below.
    if (!g.meshes || !g.meshes.length) fail('GLB has no meshes');

    // Walk the scene so node transforms are honoured. A generator that puts a
    // scale on the node - and many do - would otherwise be silently ignored.
    var tris = [];
    var haveUV = true;
    var haveColor = false, haveVertexColor = false, haveMaterialColor = false;
    var colorPartial = false, textureJobs = [], textureBytes = 0;
    var visiting = new Set();

    function appearance(prim, attr, vertexCount) {
      var result = { factor: [1,1,1], vertex: null, size: 3, source: false, texture: null };
      var mat = uint(prim.material) && g.materials && g.materials[prim.material];
      if (prim.material != null && !mat) colorPartial = true;
      var pbr = mat && mat.pbrMetallicRoughness;
      if (pbr && pbr.baseColorFactor != null) {
        var f = pbr.baseColorFactor;
        if (Array.isArray(f) && f.length === 4 && f.every(function (v) { return Number.isFinite(v) && v >= 0 && v <= 1; })) {
          result.factor = f.slice(0,3); result.source = haveMaterialColor = true;
        } else colorPartial = true;
      }
      if (attr.COLOR_0 != null) {
        try {
          var c = readAccessor(g, bin, attr.COLOR_0, 'COLOR');
          var n = NUM[g.accessors[attr.COLOR_0].type];
          if (c.length !== vertexCount * n) throw new Error('color count');
          for (var ci = 0; ci < c.length; ci++) if (c[ci] < 0 || c[ci] > 1) throw new Error('color range');
          result.vertex = c; result.size = n; result.source = haveVertexColor = true;
        } catch (_) { colorPartial = true; }
      }
      var ti = pbr && pbr.baseColorTexture;
      if (ti) {
        // Decode only embedded standard images; never request an external URI.
        var tx = uint(ti.index) && g.textures && g.textures[ti.index];
        var im = tx && uint(tx.source) && g.images && g.images[tx.source];
        var bv = im && uint(im.bufferView) && g.bufferViews && g.bufferViews[im.bufferView];
        var bo = bv && (bv.byteOffset == null ? 0 : bv.byteOffset);
        var sm = tx && tx.sampler != null && g.samplers && g.samplers[tx.sampler];
        var tr = ti.extensions && ti.extensions.KHR_texture_transform;
        var coord = tr && tr.texCoord != null ? tr.texCoord : (ti.texCoord == null ? 0 : ti.texCoord);
        var off = tr && tr.offset || [0,0], scale = tr && tr.scale || [1,1], rot = tr && tr.rotation || 0;
        var wraps = [sm && sm.wrapS != null ? sm.wrapS : 10497, sm && sm.wrapT != null ? sm.wrapT : 10497];
        var valid = coord === 0 && attr.TEXCOORD_0 != null && im && !im.uri &&
          ['image/png','image/jpeg'].indexOf(im.mimeType) >= 0 && bin && bv && bv.buffer === 0 &&
          uint(bo) && uint(bv.byteLength) && bv.byteLength > 0 && bo + bv.byteLength <= g.buffers[0].byteLength &&
          textureBytes + bv.byteLength <= 16 * 1024 * 1024 &&
          textureJobs.length < 16 &&
          Array.isArray(off) && off.length === 2 && off.every(Number.isFinite) &&
          Array.isArray(scale) && scale.length === 2 && scale.every(Number.isFinite) && Number.isFinite(rot) &&
          wraps.every(function (w) { return [33071,33648,10497].indexOf(w) >= 0; });
        if (valid) {
          result.texture = {mime: im.mimeType, bytes: bin.slice(bo, bo + bv.byteLength),
            offset: off, scale: scale, rotation: rot, wrapS: wraps[0], wrapT: wraps[1]};
          textureBytes += bv.byteLength;
          result.source = true;
        } else colorPartial = true;
      }
      if (result.source) haveColor = true;
      return result;
    }

    function visit(nodeIndex, parent) {
      var node = uint(nodeIndex) && g.nodes && g.nodes[nodeIndex];
      if (!node) fail('GLB references a missing scene node');
      if (visiting.has(nodeIndex) || visiting.size >= 256) fail('GLB node hierarchy is cyclic or too deep');
      if (node.skin != null) fail('Skinned GLB meshes are not supported; export a posed static mesh or STL');
      if (node.weights != null) fail('GLB morph weights are not supported; export a flattened mesh or STL');
      visiting.add(nodeIndex);
      var local = node.matrix ? vector(node.matrix, 16, 'node matrix').slice()
        : fromTRS(vector(node.translation || [0,0,0], 3, 'translation'),
                  vector(node.rotation || [0,0,0,1], 4, 'rotation'),
                  vector(node.scale || [1,1,1], 3, 'scale'));
      if (local[3] || local[7] || local[11] || local[15] !== 1)
        fail('GLB node matrix is not an affine transform');
      var world = mul(parent, local);
      if (!world.every(Number.isFinite)) fail('GLB node transform is out of range');
      if (node.mesh != null) {
        if (!uint(node.mesh) || !g.meshes[node.mesh]) fail('GLB references a missing mesh');
        collect(g.meshes[node.mesh], world);
      }
      (node.children || []).forEach(function (c) { visit(c, world); });
      visiting.delete(nodeIndex);
    }

    function collect(mesh, m) {
      if (mesh.weights != null) fail('GLB morph weights are not supported; export a flattened mesh or STL');
      (mesh.primitives || []).forEach(function (prim) {
        if (prim.targets && prim.targets.length)
          fail('GLB morph targets are not supported; export a flattened mesh or STL');
        if (prim.mode != null && prim.mode !== 4)
          fail('This GLB contains non-triangle primitives; export a triangulated mesh or STL');
        var attr = prim.attributes || {};
        if (attr.JOINTS_0 != null || attr.WEIGHTS_0 != null)
          fail('Skinned GLB attributes are not supported; export a posed static mesh or STL');
        if (attr.POSITION == null) fail('GLB primitive has no POSITION coordinates');
        var pos = readAccessor(g, bin, attr.POSITION, 'POSITION');
        var uv = (attr.TEXCOORD_0 != null) ? readAccessor(g, bin, attr.TEXCOORD_0, 'UV') : null;
        if (uv && uv.length / 2 !== pos.length / 3)
          fail('GLB texture coordinate count does not match its vertices');
        if (!uv) haveUV = false;
        var idx = (prim.indices != null) ? readAccessor(g, bin, prim.indices, 'INDEX') : null;
        var count = idx ? idx.length : (pos.length / 3);
        if (count % 3) fail('GLB contains an incomplete triangle');
        if (tris.length + count / 3 > MAX_TRIS) fail('That GLB has too many triangles to open here');
        if (idx) for (var ii = 0; ii < idx.length; ii++)
          if (idx[ii] >= pos.length / 3) fail('GLB triangle index points past its vertex list');
        var paint = appearance(prim, attr, pos.length / 3);
        var job = paint.texture;
        if (job) {
          job.start = tris.length * 9; job.count = count;
          job.uvs = new Float32Array(count * 2);
          textureJobs.push(job);
        }
        /* A MIRRORING NODE FLIPS EVERY TRIANGLE. apply() applies the world
           matrix without asking what it does to handedness, so a node with
           scale [-1,1,1] - or any matrix whose upper-left 3x3 has a negative
           determinant - hands back geometry wound inside out. Nothing
           downstream catches it: seat()'s ORDER swap exists to undo seat's own
           z-negation and preserves whatever arrived, check() sees a closed mesh
           and says fine, and the preview's weldNormals just produces inward
           normals. The cap renders black and the slicer is told the solid is
           the air around it. One determinant, one swap. */
        var d3 = m[0] * (m[5] * m[10] - m[6] * m[9])
               - m[4] * (m[1] * m[10] - m[2] * m[9])
               + m[8] * (m[1] * m[6]  - m[2] * m[5]);
        var flip = d3 < 0;
        for (var t = 0; t + 2 < count; t += 3) {
          var tri = { p: [], uv: [], c: paint.source ? [] : null };
          for (var k = 0; k < 3; k++) {
            var kk = flip ? (2 - k) : k;
            var vi = idx ? idx[t + kk] : (t + kk);
            var w = apply(m, pos[vi * 3], pos[vi * 3 + 1], pos[vi * 3 + 2]);
            tri.p.push(w);
            if (uv) tri.uv.push([uv[vi * 2], uv[vi * 2 + 1]]);
            if (tri.c) {
              for (var rgb = 0; rgb < 3; rgb++) tri.c.push(paint.factor[rgb] *
                (paint.vertex ? paint.vertex[vi * paint.size + rgb] : 1));
            }
            if (job) {
              var ux = uv[vi * 2] * job.scale[0], uy = uv[vi * 2 + 1] * job.scale[1];
              var cs = Math.cos(job.rotation), sn = Math.sin(job.rotation);
              job.uvs[(t + k) * 2] = job.offset[0] + cs * ux - sn * uy;
              job.uvs[(t + k) * 2 + 1] = job.offset[1] + sn * ux + cs * uy;
            }
          }
          tris.push(tri);
        }
      });
    }

    var sceneIdx = (g.scene != null) ? g.scene : 0;
    if (g.scene != null && (!uint(g.scene) || !g.scenes || !g.scenes[g.scene]))
      fail('GLB references a missing default scene');
    var scene = (g.scenes && g.scenes[sceneIdx]) ? g.scenes[sceneIdx] : null;
    if (scene && scene.nodes) {
      scene.nodes.forEach(function (n) { visit(n, ident()); });
    } else if (g.nodes) {
      /* VISIT ONLY THE ROOTS. visit() already recurses into node.children, so
         walking every node as if it were a root walks every child TWICE - once
         with its parent's world matrix and once more with the identity, which
         strips its ancestors' translation, rotation and scale. The result is
         doubled geometry with the second copy in the wrong place, and nothing
         downstream can tell that from a model that genuinely has two of
         something. `scenes` is optional in glTF 2.0, so this branch is not
         exotic - an asset used as a node library has none. */
      var isChild = Object.create(null);
      g.nodes.forEach(function (nd) {
        if (nd && nd.children) nd.children.forEach(function (c) { isChild[c] = true; });
      });
      g.nodes.forEach(function (_, i) { if (!isChild[i]) visit(i, ident()); });
    } else {
      g.meshes.forEach(function (m) { collect(m, ident()); });
    }

    if (!tris.length) fail('GLB has no triangles (only points or lines?)');

    var yUp = (o.yUp === undefined) ? true : !!o.yUp;
    var positions = new Float32Array(tris.length * 9);
    var uvs = haveUV ? new Float32Array(tris.length * 6) : null;
    var colors = haveColor ? new Float32Array(positions.length) : null;
    for (var t2 = 0; t2 < tris.length; t2++) {
      for (var k2 = 0; k2 < 3; k2++) {
        var p = tris[t2].p[k2];
        var x = p[0], y = p[1], z = p[2];
        // glTF Y-up -> printer Z-up: (x, y, z) -> (x, -z, y)
        var ox = x, oy = yUp ? -z : y, oz = yUp ? y : z;
        positions[t2 * 9 + k2 * 3]     = ox;
        positions[t2 * 9 + k2 * 3 + 1] = oy;
        positions[t2 * 9 + k2 * 3 + 2] = oz;
        if (colors) for (var channel = 0; channel < 3; channel++)
          colors[t2 * 9 + k2 * 3 + channel] = tris[t2].c ? tris[t2].c[k2 * 3 + channel] : 1;
        if (uvs) {
          uvs[t2 * 6 + k2 * 2]     = tris[t2].uv[k2][0];
          uvs[t2 * 6 + k2 * 2 + 1] = tris[t2].uv[k2][1];
        }
      }
    }
    /* ⚠️ NaN TRAVELS, AND NOTHING DOWNSTREAM STOPS IT. An index pointing past
       the end of the POSITION accessor reads undefined; apply() turns that into
       NaN; and from there it is invisible. mesh-health's bounding box compares
       with < and >, both of which are FALSE for NaN, so the model reports a
       plausible size; the broken triangle grades as "1 zero-area triangle",
       which reads like rounding; and the slicer prints a part with a hole where
       that face should have been. stl-read.js:105 sweeps for exactly this and
       says why it has to; the GLB reader beside it did not.

       Checked once, here, over the finished array rather than per-vertex in the
       hot loop - one pass over a few hundred thousand floats is nothing against
       the parse that produced them. */
    for (var q = 0; q < positions.length; q++) {
      if (!isFinite(positions[q]))
        throw new Error('This model has broken numbers in it - an index points past ' +
                        'its own vertex list, or the download was truncated.');
    }
    return { positions: positions, uvs: uvs, triangles: tris.length, yUpApplied: yUp,
      colors: colors, colorReference: {
        kind: colorPartial ? 'partial' : textureJobs.length ? 'pending' : haveVertexColor ? 'vertex' : haveMaterialColor ? 'material' : 'none',
        textureJobs: textureJobs, hasBaseColor: haveVertexColor || haveMaterialColor,
        note: colorPartial ? 'Some source appearance could not be read. Color is a reference only.' : ''
      } };
  }

  root.meshyParseGLB = parseGLB;
  if (typeof module !== 'undefined' && module.exports) module.exports = { parseGLB: parseGLB };
})(typeof window !== 'undefined' ? window : globalThis);
