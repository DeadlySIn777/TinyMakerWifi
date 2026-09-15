/* Mesh health check - run BEFORE slicing, on the raw triangle soup.
 *
 * WHY THIS EXISTS. The engine repairs exactly two things (wasm/bridge.cpp:609):
 * it welds coincident vertices, and if the whole mesh has negative volume it
 * flips every triangle. Its own comment says "PrusaSlicer does this in
 * repair(); this check is enough for us" - and for a slicer-exported STL it is.
 *
 * It is not enough for a mesh that came out of an AI generator. Those arrive
 * with holes, non-manifold edges and PATCHES of inverted winding - and that last
 * one slips through precisely because the engine's flip is global: a mesh that
 * is entirely inside-out gets fixed, a mesh that is half inside-out does not,
 * and it slices into something quietly wrong. You find out after the print.
 *
 * So this does not repair anything. It TELLS YOU, before you spend four hours.
 * Repair belongs in the engine or in the generator; an honest warning belongs
 * here, and it is the part that was missing.
 *
 * Input is the same Float32Array the slicer itself eats: 9 floats per triangle,
 * unindexed. No DOM, no imports - scripts/dev/test_mesh_health.mjs runs it in
 * node.
 */

(function (root) {
  'use strict';

  // Vertices are welded by position, like its_merge_vertices() does, because a
  // soup has no shared indices: without welding every edge looks like a hole.
  // The quantum is 1e-5 of the model's own size, so it scales with the part
  // instead of assuming millimetres - an AI export can arrive in any unit, as
  // we found the hard way with a mesh 1000x too large.
  function keyer(span) {
    var q = Math.max(span * 1e-5, 1e-9);
    return function (x, y, z) {
      return (Math.round(x / q)) + ',' + (Math.round(y / q)) + ',' + (Math.round(z / q));
    };
  }

  function meshHealth(pos) {
    function invalid(message, count) {
      return { ok: false, fatal: message, severity: 'bad', triangles: count || 0,
        watertight: false, boundaryEdges: 0, nonManifoldEdges: 0, flippedEdges: 0,
        degenerate: 0, size: { x: 0, y: 0, z: 0 }, surfaceArea: 0,
        problems: [message], advice: 'This mesh has no usable geometry. ' + message,
        summary: message };
    }
    if (!pos || pos.length < 9 || pos.length % 9 !== 0) {
      return invalid('not a complete triangle soup');
    }
    var triCount = pos.length / 9;

    // bounding box -> the weld quantum
    var mnx = Infinity, mny = Infinity, mnz = Infinity;
    var mxx = -Infinity, mxy = -Infinity, mxz = -Infinity;
    for (var i = 0; i < pos.length; i += 3) {
      var x = pos[i], y = pos[i + 1], z = pos[i + 2];
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z))
        return invalid('non-finite vertex coordinates', triCount);
      if (x < mnx) mnx = x; if (x > mxx) mxx = x;
      if (y < mny) mny = y; if (y > mxy) mxy = y;
      if (z < mnz) mnz = z; if (z > mxz) mxz = z;
    }
    var span = Math.max(mxx - mnx, mxy - mny, mxz - mnz);
    if (!Number.isFinite(span)) return invalid('coordinate range is too large', triCount);
    var key = keyer(span);

    var edges = new Map();     // "a|b" (a<b) -> {n, fwd, rev}
    var degenerate = 0;
    var area2 = 0;

    for (var t = 0; t < triCount; t++) {
      var o = t * 9;
      var ax = pos[o], ay = pos[o + 1], az = pos[o + 2];
      var bx = pos[o + 3], by = pos[o + 4], bz = pos[o + 5];
      var cx = pos[o + 6], cy = pos[o + 7], cz = pos[o + 8];

      // zero-area triangles: they carry no surface and confuse neighbour search
      var ux = bx - ax, uy = by - ay, uz = bz - az;
      var vx = cx - ax, vy = cy - ay, vz = cz - az;
      var nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      var mag = Math.sqrt(nx * nx + ny * ny + nz * nz);
      if (!Number.isFinite(mag)) return invalid('triangle area is out of range', triCount);
      if (!(mag > span * span * 1e-12)) { degenerate++; continue; }

      var ka = key(ax, ay, az), kb = key(bx, by, bz), kc = key(cx, cy, cz);
      if (ka === kb || kb === kc || kc === ka) { degenerate++; continue; }
      area2 += mag;

      var tri = [[ka, kb], [kb, kc], [kc, ka]];
      for (var e = 0; e < 3; e++) {
        var p = tri[e][0], q = tri[e][1];
        var flip = p > q;
        var id = flip ? (q + '|' + p) : (p + '|' + q);
        var rec = edges.get(id);
        if (!rec) { rec = { n: 0, fwd: 0, rev: 0 }; edges.set(id, rec); }
        rec.n++;
        if (flip) rec.rev++; else rec.fwd++;
      }
    }

    if (degenerate === triCount) {
      var empty = invalid('all triangles have zero usable area', triCount);
      empty.degenerate = degenerate;
      return empty;
    }
    var boundary = 0, nonManifold = 0, flipped = 0;
    edges.forEach(function (r) {
      if (r.n === 1) boundary++;
      else if (r.n > 2) nonManifold++;
      // A shared edge should be traversed once in each direction. Both the same
      // way means the two faces disagree about which side is out - this is the
      // patchwise inversion the engine's global flip cannot see.
      else if (r.n === 2 && (r.fwd === 2 || r.rev === 2)) flipped++;
    });

    var problems = [];
    if (boundary) problems.push(boundary + ' open edge' + (boundary === 1 ? '' : 's') + ' (holes)');
    if (nonManifold) problems.push(nonManifold + ' edge' + (nonManifold === 1 ? '' : 's') + ' shared by more than two faces');
    if (flipped) problems.push(flipped + ' edge' + (flipped === 1 ? '' : 's') + ' where neighbouring faces disagree which way is out');
    if (degenerate) problems.push(degenerate + ' zero-area triangle' + (degenerate === 1 ? '' : 's'));

    // Severity by what it actually costs you, not by how alarming it sounds.
    // A handful of open edges on a 300k mesh usually slices fine; inverted
    // patches are the ones that produce a wrong part in silence.
    var severity = 'ok';
    if (degenerate || (boundary > 0 && boundary <= triCount * 0.001)) severity = 'minor';
    if (boundary > triCount * 0.001 || nonManifold) severity = 'warn';
    if (flipped) severity = 'bad';

    var advice = '';
    if (severity === 'bad')
      advice = 'Parts of this mesh are inside-out. The slicer only flips a mesh that is ENTIRELY inverted, so this one can slice into a wrong shape without any error. Re-export it, or run it through a repair tool first.';
    else if (severity === 'warn')
      advice = 'This mesh is not watertight. It will usually still slice, but expect artefacts around the gaps.';
    else if (severity === 'minor')
      advice = 'Small defects; these normally slice fine.';

    return {
      ok: severity === 'ok' || severity === 'minor',
      severity: severity,
      triangles: triCount,
      boundaryEdges: boundary,
      nonManifoldEdges: nonManifold,
      flippedEdges: flipped,
      degenerate: degenerate,
      watertight: boundary === 0 && nonManifold === 0,
      size: { x: mxx - mnx, y: mxy - mny, z: mxz - mnz },
      surfaceArea: area2 / 2,
      problems: problems,
      advice: advice,
      summary: problems.length ? problems.join(', ') : 'watertight, consistent winding'
    };
  }

  root.meshHealth = meshHealth;
  if (typeof module !== 'undefined' && module.exports) module.exports = { meshHealth: meshHealth };
})(typeof window !== 'undefined' ? window : globalThis);
