/* An artisan cap: a sculpted object standing ON a keycap.
 *
 * WHY THIS EXISTS, AND WHY THE HEIGHT FIELD WAS NOT ENOUGH. keycap-skin.js
 * samples a generated model into a height on the top face, which protects the
 * stem completely and is the right answer for a legend. It is the WRONG answer
 * for an artisan cap, and looking at one printed makes that obvious: a height
 * field can only extrude a 2D shape upward. It has no undercuts, no overhangs,
 * no silhouette. You get an icon pushed up out of the plastic - embossing, not
 * sculpture - and at 2 mm it reads as a stamped plate.
 *
 * An artisan cap is an OBJECT on a cap. So the sculpt stays a real mesh: it is
 * scaled, seated, and emitted ALONGSIDE the cap as a second solid that
 * overlaps it.
 *
 * NO BOOLEAN, AND NO NEED FOR ONE. The slicer here is PrusaSlicer's libslic3r
 * compiled to WebAssembly, and it rasterises overlapping solids as their union
 * - the same thing that happens when you drop two intersecting parts into
 * PrusaSlicer on a desktop. That is what makes this safe without a CSG kernel:
 * a generated mesh with open edges and flipped windings cannot corrupt the cap,
 * because the two are never combined topologically. The cap is still built by
 * the engine, the stem is still exact, and the sculpt is just something sitting
 * on top of it.
 *
 * ⚠️ THE SEATING IS LOAD-BEARING. The sculpt must SINK into the cap far enough
 * that the union is one connected solid at every layer. Seated too shallow on a
 * dished top and the first layers of the sculpt are islands floating over the
 * dish. seatDepth defaults to more than the dish is deep for exactly that
 * reason, and check() refuses a seating that cannot bridge it.
 *
 * ⚠️ AND IT CHANGES HOW THE CAP PRINTS. A cap with a figure on top cannot be
 * printed face down - that buries the sculpt against the plate. It goes on its
 * side, leaning, supports on the skirt. printPose() works out the angle.
 *
 * No DOM, no imports - scripts/dev/test_keycap_sculpt.mjs runs it in node.
 */

(function (root) {
  'use strict';

  function bounds(p) {
    var mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    for (var i = 0; i < p.length; i += 3) for (var k = 0; k < 3; k++) {
      if (p[i+k] < mn[k]) mn[k] = p[i+k];
      if (p[i+k] > mx[k]) mx[k] = p[i+k];
    }
    return { mn: mn, mx: mx,
             size: [mx[0]-mn[0], mx[1]-mn[1], mx[2]-mn[2]],
             mid: [(mn[0]+mx[0])/2, (mn[1]+mx[1])/2, (mn[2]+mx[2])/2] };
  }

  /* Seat a sculpt on a cap and hand back one triangle soup containing both.
     The cap keeps the engine's coordinates - z from the top face DOWN to the
     mouth - so the sculpt has to grow in -z, out of the top. */
  function seat(cap, sculptPositions, opts) {
    var o = opts || {};
    if (!cap || !cap.positions) throw new Error('keycap-sculpt: no cap');
    if (!sculptPositions || sculptPositions.length < 9 || sculptPositions.length % 9)
      throw new Error('keycap-sculpt: the sculpt is not a triangle soup');

    var sb = bounds(sculptPositions);
    if (sb.size[0] <= 0 || sb.size[1] <= 0 || sb.size[2] <= 0)
      throw new Error('keycap-sculpt: the sculpt is flat in one axis - it has no form to seat');

    var capW = cap.size.x, capD = cap.size.y;
    /* Artisans let a sculpt overhang the cap a little; the hard limit is the
       key pitch, or it fouls its neighbour on the board. */
    var spread = o.spread == null ? 1.06 : o.spread;
    var maxW = Math.min(capW * spread, (o.pitch || 19.05) - 0.4);
    var maxD = Math.min(capD * spread, (o.pitch || 19.05) - 0.4);
    var maxH = o.heightMm == null ? capW * 0.85 : o.heightMm;

    var k = Math.min(maxW / sb.size[0], maxD / sb.size[1], maxH / sb.size[2]);
    if (o.scale) k = o.scale;

    /* How deep it sinks into the cap. It has to clear the dish, or the first
       layers of the sculpt hang over a hollow. */
    var seatDepth = o.seatDepth == null
      ? Math.max(0.8, (cap.dishDepth || 0.8) + 0.5)
      : o.seatDepth;

    /* The cap's z runs from its top face DOWN to the mouth, so the sculpt has
       to grow in -z. Negating one axis is a MIRROR, not a rotation: it flips
       the handedness, and with it every triangle's winding and every normal.
       Left alone the sculpt renders pitch black with its faces pointing into
       itself, and a slicer that cares about winding would see it inside out.
       So each triangle's last two corners are swapped back as it is written -
       one mirror, one reversal, handedness restored. */
    var out = new Float32Array(sculptPositions.length);
    var t, c, sx = o.x || 0, sy = o.y || 0;
    var ORDER = [0, 2, 1];                       // the winding fix
    for (t = 0; t < sculptPositions.length; t += 9) {
      for (c = 0; c < 3; c++) {
        var src = t + ORDER[c] * 3, dst = t + c * 3;
        out[dst]     = (sculptPositions[src]     - sb.mid[0]) * k + sx;
        out[dst + 1] = (sculptPositions[src + 1] - sb.mid[1]) * k + sy;
        out[dst + 2] = -((sculptPositions[src + 2] - sb.mn[2]) * k) + seatDepth;
      }
    }

    var both = new Float32Array(cap.positions.length + out.length);
    both.set(cap.positions, 0);
    both.set(out, cap.positions.length);

    var fb = bounds(out);
    return {
      positions: both,
      capTriangles: cap.positions.length / 9,
      sculptTriangles: out.length / 9,
      triangles: both.length / 9,
      scale: +k.toFixed(4),
      seatDepth: +seatDepth.toFixed(2),
      sculptMm: { x: +(sb.size[0]*k).toFixed(2), y: +(sb.size[1]*k).toFixed(2),
                  z: +(sb.size[2]*k).toFixed(2) },
      /* Total height of the finished piece: the cap plus however far the sculpt
         stands proud of its top face. */
      totalHeightMm: +(cap.size.z + (sb.size[2]*k - seatDepth)).toFixed(2),
      footprintMm: { x: +Math.max(capW, fb.size[0]).toFixed(2),
                     y: +Math.max(capD, fb.size[1]).toFixed(2) },
      overhangs: +(Math.max(0, fb.size[0] - capW) / 2).toFixed(2)
    };
  }

  /* Does the finished piece work - on a board, and in the machine? */
  function check(seated, opts) {
    var o = opts || {}, issues = [], notes = [];
    var pitch = o.pitch || 19.05;
    var bed = o.bed || { x: 40.8, y: 30.6, zSupported: 52 };

    if (seated.footprintMm.x > pitch || seated.footprintMm.y > pitch)
      issues.push('it is ' + seated.footprintMm.x.toFixed(1) + ' × ' +
        seated.footprintMm.y.toFixed(1) + ' mm across the widest point, over the ' +
        pitch + ' mm key pitch - it will foul the key next to it');
    else if (seated.overhangs > 0.05)
      notes.push('the sculpt overhangs the cap by ' + seated.overhangs.toFixed(1) +
        ' mm a side, which is still inside the key pitch');

    if (seated.sculptMm.z < 1.5)
      notes.push('a ' + seated.sculptMm.z.toFixed(1) +
        ' mm sculpt is barely more than a relief - raise the height to get a silhouette');
    if (seated.seatDepth < 0.6)
      issues.push('seated only ' + seated.seatDepth.toFixed(2) +
        ' mm into the cap; it needs to sink past the dish or its first layers hang over a hollow');

    if (seated.totalHeightMm > bed.zSupported)
      issues.push('the finished piece stands ' + seated.totalHeightMm.toFixed(1) +
        ' mm and the volume allows ' + bed.zSupported);

    notes.push('the cap and the sculpt are two overlapping solids; the slicer ' +
      'rasterises them as a union, so the stem is never touched by the sculpt');
    return { ok: !issues.length, issues: issues, notes: notes };
  }

  /* How it has to go on the plate.

     Face down buries the sculpt against the plate. Mouth down makes the cap's
     roof an island over its own cavity. So it goes on its SIDE - far enough
     over that every layer grows out of the one below, with the supports landing
     on the skirt and the leading edge rather than on the sculpt. */
  function printPose(seated, cap, opts) {
    var o = opts || {};
    var deg = o.tilt == null ? 55 : o.tilt;
    var r = deg * Math.PI / 180;
    var L = Math.max(seated.footprintMm.x, cap.size.x);
    var h = seated.totalHeightMm;
    return {
      tilt: deg, supports: true,
      foot: { x: +(L * Math.cos(r) + h * Math.sin(r)).toFixed(2), y: seated.footprintMm.y },
      height: +(L * Math.sin(r) + h * Math.cos(r)).toFixed(2),
      forcedBy: 'sculpt',
      why: 'a cap with a figure on it cannot print face down - that buries the ' +
           'sculpt against the plate - so it goes on its side at ' + deg +
           '° with the supports on the skirt.'
    };
  }

  root.keycapSculpt = { seat: seat, check: check, printPose: printPose, bounds: bounds };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.keycapSculpt;
})(typeof window !== 'undefined' ? window : globalThis);
