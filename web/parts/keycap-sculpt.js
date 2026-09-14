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
       key pitch, or it fouls its neighbour on the board.

       THE PITCH IS NOT 19.05 FOR EVERY KEY. It is 19.05 PER UNIT, so a 2.25u
       Shift is allowed 42.86 mm and a 1u is allowed 19.05. Assuming the 1u
       number everywhere squeezed a Shift-key sculpt down to 18.65 mm - less
       than half the room it actually has - and for a scene with two figures on
       it that is the difference between two characters and two blobs. Depth is
       always one unit: keys are wider than 1u, never deeper. */
    var pitchW = o.pitch || (19.05 * (cap.sizeU || 1));
    var pitchD = o.pitchD || 19.05;
    var spread = o.spread == null ? 1.06 : o.spread;
    var maxW = Math.min(capW * spread, pitchW - 0.4);
    var maxD = Math.min(capD * spread, pitchD - 0.4);
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
      overhangs: +(Math.max(0, fb.size[0] - capW) / 2).toFixed(2),
      pitchMm: { x: +pitchW.toFixed(2), y: +pitchD.toFixed(2) },
      sizeU: cap.sizeU || 1
    };
  }

  /* ---- the diorama problem ----------------------------------------------
     A scene with two figures on it is the thing artisan caps are FOR, and it
     is also where this arrangement can fail silently.

     The cap and the sculpt print as a union because they overlap, and that
     works for any number of pieces - two figures that touch each other, or a
     base, fuse into one solid the same way. What does NOT work is a piece that
     touches nothing: a generator asked for "two Pokemon on a rock" can return
     one of them hovering a fraction of a millimetre off the rock, and it looks
     perfect on screen because the eye cannot see the gap. On the machine it is
     a separate object floating in mid air with no support under it, and it
     either fails or lands somewhere else in the vat.

     So: split the sculpt into connected shells, and work out which of them are
     anchored. A shell is anchored if it reaches down into the cap, or if it
     overlaps something else that is. Bounding boxes, deliberately - a true
     mesh intersection test is expensive and the answer only has to be
     conservative in the safe direction: boxes overlap MORE often than the
     meshes inside them, so this reports a floater only when the pieces are
     genuinely far apart. */
  function shells(p) {
    var n = p.length / 9, parent = new Int32Array(n), i;
    for (i = 0; i < n; i++) parent[i] = i;
    function find(a) { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; }
    function join(a, b) { a = find(a); b = find(b); if (a !== b) parent[b] = a; }
    var map = Object.create(null);
    for (i = 0; i < n; i++) for (var c = 0; c < 3; c++) {
      var q = i*9 + c*3;
      var key = Math.round(p[q]*200) + ',' + Math.round(p[q+1]*200) + ',' + Math.round(p[q+2]*200);
      if (map[key] === undefined) map[key] = i; else join(map[key], i);
    }
    var groups = {};
    for (i = 0; i < n; i++) {
      var r = find(i);
      var g = groups[r] || (groups[r] = { tris: 0, mn: [1e9,1e9,1e9], mx: [-1e9,-1e9,-1e9] });
      g.tris++;
      for (var v = 0; v < 9; v += 3) for (var k = 0; k < 3; k++) {
        var val = p[i*9 + v + k];
        if (val < g.mn[k]) g.mn[k] = val;
        if (val > g.mx[k]) g.mx[k] = val;
      }
    }
    return Object.keys(groups).map(function (k) { return groups[k]; });
  }

  function boxesTouch(a, b, slack) {
    for (var k = 0; k < 3; k++)
      if (a.mn[k] - slack > b.mx[k] || b.mn[k] - slack > a.mx[k]) return false;
    return true;
  }

  /* Which pieces of a seated sculpt are actually attached to something. */
  function anchorage(seatedPositions, capTriangles, opts) {
    var o = opts || {};
    var slack = o.slack == null ? 0.15 : o.slack;   // mm of tolerable gap
    var sc = seatedPositions.slice(capTriangles * 9);
    var parts = shells(sc);
    // a shell reaching z >= 0 is down inside the cap
    var anchored = parts.map(function (g) { return g.mx[2] >= 0; });
    var changed = true, i, j;
    while (changed) {
      changed = false;
      for (i = 0; i < parts.length; i++) {
        if (anchored[i]) continue;
        for (j = 0; j < parts.length; j++) {
          if (i === j || !anchored[j]) continue;
          if (boxesTouch(parts[i], parts[j], slack)) { anchored[i] = true; changed = true; break; }
        }
      }
    }
    var floating = [];
    for (i = 0; i < parts.length; i++)
      if (!anchored[i] && parts[i].tris > 2)
        floating.push({ triangles: parts[i].tris,
                        sizeMm: [ +(parts[i].mx[0]-parts[i].mn[0]).toFixed(2),
                                  +(parts[i].mx[1]-parts[i].mn[1]).toFixed(2),
                                  +(parts[i].mx[2]-parts[i].mn[2]).toFixed(2) ],
                        gapMm: +(-parts[i].mx[2]).toFixed(2) });
    return { shells: parts.length, anchored: anchored.filter(Boolean).length,
             floating: floating };
  }

  /* Does the finished piece work - on a board, and in the machine? */
  function check(seated, opts) {
    var o = opts || {}, issues = [], notes = [];
    /* Same correction as seat(): the pitch is per unit, so a 2.25u key has
       42.86 mm to play with and only its DEPTH is limited to one unit. */
    var pitchW = o.pitch || (seated.pitchMm ? seated.pitchMm.x : 19.05);
    var pitchD = o.pitchD || (seated.pitchMm ? seated.pitchMm.y : 19.05);
    var bed = o.bed || { x: 40.8, y: 30.6, zSupported: 52 };

    if (seated.footprintMm.x > pitchW || seated.footprintMm.y > pitchD)
      issues.push('it is ' + seated.footprintMm.x.toFixed(1) + ' × ' +
        seated.footprintMm.y.toFixed(1) + ' mm across the widest point, over the ' +
        pitchW.toFixed(2) + ' × ' + pitchD.toFixed(2) +
        ' mm this key is allowed - it will foul the key next to it');
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

    /* The diorama check. Only runs when the caller hands over the seated mesh,
       because it needs the real geometry rather than the summary. */
    var anchors = null;
    if (seated.positions && seated.capTriangles != null) {
      anchors = anchorage(seated.positions, seated.capTriangles, o);
      if (anchors.shells > 1)
        notes.push('the sculpt is ' + anchors.shells + ' separate pieces; ' +
          anchors.anchored + ' of them are attached to the cap or to each other, ' +
          'and overlapping pieces fuse in the slicer');
      anchors.floating.forEach(function (f) {
        issues.push('a piece ' + f.sizeMm.join(' × ') + ' mm is floating ' +
          f.gapMm.toFixed(2) + ' mm clear of everything else. On screen it looks ' +
          'attached; on the plate it is a separate object in mid air with nothing ' +
          'under it. Seat it deeper, or have the generator put the figures on a base.');
      });
    }
    return { ok: !issues.length, issues: issues, notes: notes, anchorage: anchors };
  }

  /* How it has to go on the plate.

     Face down buries the sculpt against the plate. Mouth down makes the cap's
     roof an island over its own cavity. So it goes on its SIDE - far enough
     over that every layer grows out of the one below, with the supports landing
     on the skirt and the leading edge rather than on the sculpt. */
  function printPose(seated, cap, opts) {
    var o = opts || {};
    var bed = o.bed || { x: 40.8, y: 30.6, zSupported: 52 };
    var L = Math.max(seated.footprintMm.x, cap.size.x);
    var D = seated.footprintMm.y;
    var h = seated.totalHeightMm;

    /* MIN_LEAN is the point of the exercise: below it the sculpt is still
       pointing at the plate and the supports would land on the artwork. */
    var MIN_LEAN = o.minTilt == null ? 40 : o.minTilt;
    var MAX_LEAN = 88;

    /* Search rather than assume. This was pinned at 55 degrees, and 55 is fine
       for a 1u - but a 2.25u Shift with a scene on it is 41.8 mm long, and at
       55 degrees it lands 43.5 mm across a 40.8 mm bed and simply does not fit.
       Leaning FURTHER shrinks the footprint, so the answer was never "it does
       not fit", it was "not at that angle". Take the shallowest lean that
       clears, because every extra degree is more overhang and more support. */
    var pick = null;
    for (var t = MIN_LEAN; t <= MAX_LEAN; t += 0.5) {
      var r = t * Math.PI / 180;
      var fx = L * Math.cos(r) + h * Math.sin(r);
      var fz = L * Math.sin(r) + h * Math.cos(r);
      if (fx <= bed.x - 0.5 && D <= bed.y && fz <= bed.zSupported) {
        pick = { deg: t, foot: fx, height: fz };
        break;
      }
    }
    if (o.tilt != null) {
      var rr = o.tilt * Math.PI / 180;
      pick = { deg: o.tilt, foot: L * Math.cos(rr) + h * Math.sin(rr),
               height: L * Math.sin(rr) + h * Math.cos(rr) };
    }
    if (!pick) {
      return { ok: false, tilt: null, supports: true,
        foot: { x: null, y: D }, height: null, forcedBy: 'sculpt',
        why: 'a ' + L.toFixed(1) + ' × ' + D.toFixed(1) + ' × ' + h.toFixed(1) +
             ' mm piece does not clear the ' + bed.x + ' × ' + bed.y + ' × ' +
             bed.zSupported + ' mm volume at any lean between ' + MIN_LEAN + ' and ' +
             MAX_LEAN + ' degrees. Make the sculpt shorter, or the key narrower.' };
    }
    return {
      ok: true, tilt: +pick.deg.toFixed(1), supports: true,
      foot: { x: +pick.foot.toFixed(2), y: D },
      height: +pick.height.toFixed(2),
      forcedBy: 'sculpt',
      why: 'a cap with a figure on it cannot print face down - that buries the ' +
           'sculpt against the plate - so it goes on its side at ' +
           pick.deg.toFixed(1) + '° with the supports on the skirt.'
    };
  }

  root.keycapSculpt = { seat: seat, check: check, printPose: printPose, bounds: bounds,
                        shells: shells, anchorage: anchorage };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.keycapSculpt;
})(typeof window !== 'undefined' ? window : globalThis);
