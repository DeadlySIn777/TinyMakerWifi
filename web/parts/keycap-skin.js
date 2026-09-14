/* A generated mesh becomes a keycap legend.
 *
 * THIS IS THE POINT OF THE WHOLE SPLIT. Meshy is good at making an IFAK pouch
 * look like an IFAK pouch and has no business anywhere near a 1.23 mm stem
 * slot. So a generated model never becomes the cap - it becomes a HEIGHT FIELD
 * on the cap's top face, exactly the same kind of thing a hand-drawn icon
 * produces, and the engine builds every millimetre that has to fit a switch.
 *
 * Nothing downstream can tell which it was, which is the useful part: the
 * printability check, the preview, the plate layout and the slicer path are
 * identical for a drawn icon and a generated one.
 *
 * WHY A HEIGHT FIELD AND NOT A BOOLEAN. Welding an arbitrary generated mesh
 * onto the cap needs a real CSG kernel, and a 1.4 M-triangle mesh with 45 open
 * edges - which is what the last Meshy model measured - is exactly the input
 * that makes one produce garbage without saying so. Sampling it from outside
 * cannot fail that way: the worst case is a relief that looks wrong, and you
 * can see that in the preview before anything is printed.
 *
 * HOW IT LOOKS AT THE MODEL. A generated pouch is a full 3D object, and a
 * keycap wants its front. So the default is to sight down the model's SHORTEST
 * axis - for anything flat-ish, a pouch, a packet, a blister pack, that is the
 * front view - and take the nearest surface along it. Override with axis if the
 * model came out oriented oddly.
 *
 * No DOM, no imports - scripts/dev/test_keycap_skin.mjs runs it in node.
 */

(function (root) {
  'use strict';

  /* Sample a triangle soup into a height grid by casting a ray at every cell
     and keeping the nearest surface. Triangles are binned by their 2D bounding
     box first, or a 96x96 grid against a 30k-triangle mesh would be 280 million
     ray-triangle tests; binned it is a few hundred thousand. */
  function heightField(positions, opts) {
    var o = opts || {};
    if (!positions || positions.length < 9 || positions.length % 9)
      throw new Error('keycap-skin: not a triangle soup');
    var n = Math.max(24, Math.min(256, o.grid || 96));

    // bounds
    var mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity], i, k;
    for (i = 0; i < positions.length; i += 3) for (k = 0; k < 3; k++) {
      if (positions[i+k] < mn[k]) mn[k] = positions[i+k];
      if (positions[i+k] > mx[k]) mx[k] = positions[i+k];
    }
    var span = [mx[0]-mn[0], mx[1]-mn[1], mx[2]-mn[2]];

    /* Sight down the shortest axis unless told otherwise - for a flat-ish item
       that is the front view, which is the one that reads on a keycap. */
    var axis = o.axis != null ? o.axis : span.indexOf(Math.min(span[0], span[1], span[2]));
    var ax = [0,1,2].filter(function (a) { return a !== axis; });   // the two in-plane axes
    var au = ax[0], av = ax[1];
    if (span[au] <= 0 || span[av] <= 0) throw new Error('keycap-skin: the model is flat in two axes');

    // bin triangles by their footprint in the (au, av) plane
    var tris = positions.length / 9;
    var bins = new Array(n * n), b;
    for (b = 0; b < bins.length; b++) bins[b] = null;
    function cellU(x) { return Math.floor((x - mn[au]) / span[au] * n); }
    function cellV(y) { return Math.floor((y - mn[av]) / span[av] * n); }
    for (var t = 0; t < tris; t++) {
      var p = t * 9;
      var u0 = Math.min(positions[p+au], positions[p+3+au], positions[p+6+au]);
      var u1 = Math.max(positions[p+au], positions[p+3+au], positions[p+6+au]);
      var v0 = Math.min(positions[p+av], positions[p+3+av], positions[p+6+av]);
      var v1 = Math.max(positions[p+av], positions[p+3+av], positions[p+6+av]);
      var cu0 = Math.max(0, Math.min(n-1, cellU(u0))), cu1 = Math.max(0, Math.min(n-1, cellU(u1)));
      var cv0 = Math.max(0, Math.min(n-1, cellV(v0))), cv1 = Math.max(0, Math.min(n-1, cellV(v1)));
      for (var cv = cv0; cv <= cv1; cv++) for (var cu = cu0; cu <= cu1; cu++) {
        var idx = cv * n + cu;
        if (!bins[idx]) bins[idx] = [];
        bins[idx].push(p);
      }
    }

    /* Moller-Trumbore, specialised: the ray always runs along `axis`, so the
       2D containment test is a plain barycentric one in the (au, av) plane and
       the hit is that point's coordinate on `axis`. */
    var H = new Float32Array(n * n), hit = new Uint8Array(n * n);
    var far = mx[axis], near = mn[axis];
    var hiMost = -Infinity, loMost = Infinity, any = 0;
    for (var gv = 0; gv < n; gv++) for (var gu = 0; gu < n; gu++) {
      var qu = mn[au] + (gu + 0.5) / n * span[au];
      var qv = mn[av] + (gv + 0.5) / n * span[av];
      var list = bins[gv * n + gu];
      if (!list) continue;
      var best = -Infinity;
      for (var e = 0; e < list.length; e++) {
        var q = list[e];
        var ax0 = positions[q+au],   ay0 = positions[q+av],   az0 = positions[q+axis];
        var ax1 = positions[q+3+au], ay1 = positions[q+3+av], az1 = positions[q+3+axis];
        var ax2 = positions[q+6+au], ay2 = positions[q+6+av], az2 = positions[q+6+axis];
        var d = (ay1-ay2)*(ax0-ax2) + (ax2-ax1)*(ay0-ay2);
        if (d === 0 || !isFinite(d)) continue;
        var l0 = ((ay1-ay2)*(qu-ax2) + (ax2-ax1)*(qv-ay2)) / d;
        if (l0 < -1e-6 || l0 > 1 + 1e-6) continue;
        var l1 = ((ay2-ay0)*(qu-ax2) + (ax0-ax2)*(qv-ay2)) / d;
        if (l1 < -1e-6 || l1 > 1 + 1e-6) continue;
        var l2 = 1 - l0 - l1;
        if (l2 < -1e-6 || l2 > 1 + 1e-6) continue;
        var z = l0*az0 + l1*az1 + l2*az2;
        if (z > best) best = z;          // nearest surface looking down +axis
      }
      if (best === -Infinity) continue;
      H[gv * n + gu] = best; hit[gv * n + gu] = 1; any++;
      if (best > hiMost) hiMost = best;
      if (best < loMost) loMost = best;
    }
    if (!any) throw new Error('keycap-skin: the ray cast hit nothing - is the model empty?');

    // normalise to 0..1, with misses reading as the cap surface
    var range = hiMost - loMost;
    for (i = 0; i < H.length; i++) H[i] = hit[i] && range > 0 ? (H[i] - loMost) / range : 0;

    return { grid: n, h: H, hit: hit, axis: axis, inPlane: [au, av],
             spanMm: { u: span[au], v: span[av], depth: span[axis] },
             coverage: +(any / (n * n)).toFixed(3) };
  }

  /* Turn a height field into the relief function keycap.build() wants.

     The cap tells it how big the face is - build() calls relief(u, v, topW,
     topD) - so the model keeps its own proportions instead of being stretched
     to whatever square the caller happened to have. Bilinear, because a 96-cell
     grid shows its steps otherwise on a 13 mm face. */
  function reliefFromField(field, opts) {
    var o = opts || {};
    var depth = o.depth == null ? 0.55 : o.depth;
    var raised = o.raised !== false;          // a generated item wants to stand proud
    var fit = o.fit == null ? 0.92 : o.fit;   // fraction of the face it fills
    var floorAt = o.floor == null ? 0.06 : o.floor;  // below this reads as background
    var n = field.grid, H = field.h;
    var su = field.spanMm.u, sv = field.spanMm.v;

    var f = function (u, v, topW, topD) {
      topW = topW || 13.7; topD = topD || topW;
      // biggest uniform scale that fits the model inside the face
      var k = fit * Math.min(topW / su, topD / sv);
      // cap-space mm -> field coordinates in -1..1
      var fu = (u * topW / 2) / (k * su / 2);
      var fv = (v * topD / 2) / (k * sv / 2);
      if (fu < -1 || fu > 1 || fv < -1 || fv > 1) return 0;
      // field row 0 is the BOTTOM of the model, so +v maps to the last row
      var gx = (fu + 1) / 2 * (n - 1), gy = (fv + 1) / 2 * (n - 1);
      var x0 = Math.max(0, Math.floor(gx)), y0 = Math.max(0, Math.floor(gy));
      var x1 = Math.min(n - 1, x0 + 1), y1 = Math.min(n - 1, y0 + 1);
      var dx = gx - x0, dy = gy - y0;
      var h = H[y0*n+x0]*(1-dx)*(1-dy) + H[y0*n+x1]*dx*(1-dy) +
              H[y1*n+x0]*(1-dx)*dy     + H[y1*n+x1]*dx*dy;
      if (h <= floorAt) return 0;
      h = (h - floorAt) / (1 - floorAt);
      return raised ? -depth * h : depth * h;
    };
    f.depth = depth;
    f.raised = raised;
    f.fromMesh = true;
    f.field = field;
    /* No parts to inspect - which is exactly why checkLegendField rasterises
       the finished field instead of reading stroke widths. A generated skin
       gets held to the same 0.45 mm as a drawn one. */
    f.parts = [];
    return f;
  }

  function skinFromMesh(positions, opts) {
    return reliefFromField(heightField(positions, opts), opts);
  }

  /* ---- prompts ----------------------------------------------------------
     A generator asked for "an IFAK" returns a hero prop with straps and
     shadows; asked for a shallow front-facing relief it returns something that
     survives being flattened onto a 13 mm square. These say so explicitly.
     Untested against the real service - nobody here has a key yet. */
  var PROMPT_TAIL = ', front facing, shallow bas relief, flat back, bold simple ' +
    'shapes, no thin details, centered, game item icon, clean silhouette';
  var PROMPTS = {
    ifak:     'a military IFAK first aid pouch, grey camouflage nylon, zipper, ' +
              'medical cross patch sewn on the front' + PROMPT_TAIL,
    afak:     'a black MOLLE nylon first aid pouch with horizontal webbing straps ' +
              'and a pull tab' + PROMPT_TAIL,
    salewa:   'a hard plastic first aid kit case with a carry handle and a medical ' +
              'cross on the lid' + PROMPT_TAIL,
    bandage:  'a rolled gauze bandage with a loose tail hanging from it' + PROMPT_TAIL,
    hemostat: 'a foil hemostatic powder sachet with a serrated tear top' + PROMPT_TAIL,
    splint:   'a perforated aluminium finger splint, a flat bar with round holes' + PROMPT_TAIL,
    pills:    'a pharmaceutical blister pack of round pills' + PROMPT_TAIL,
    creeper:  'a Minecraft creeper face, blocky pixel squares, flat' + PROMPT_TAIL
  };
  function promptFor(name, extra) {
    var p = PROMPTS[name] || (String(name || '') + PROMPT_TAIL);
    return extra ? (p + ', ' + extra) : p;
  }

  root.keycapSkin = {
    heightField: heightField, reliefFromField: reliefFromField,
    skinFromMesh: skinFromMesh, PROMPTS: PROMPTS, promptFor: promptFor
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.keycapSkin;
})(typeof window !== 'undefined' ? window : globalThis);
