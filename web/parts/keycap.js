/* Keycap engine.
 *
 * THE PREMISE. A generator is good at a sculpt and hopeless at a part that has
 * to fit a switch. The MX cross is a ~1.3 mm slot held to about a tenth of a
 * millimetre; at this printer's 127.5 micron pixel that slot is ten pixels
 * across. Nothing that arrived from a text prompt is going to land there.
 *
 * So the engine owns every mechanical surface - skirt, walls, stem post, cross -
 * built from exact numbers, and anything generated only ever supplies a HEIGHT
 * FIELD on the top face. Legends use that same height field. The stem is never
 * generated, never inferred from a mesh, never trusted to anything but this file.
 *
 * The output is one closed manifold, not two solids left overlapping for the
 * slicer to union. That matters here: the raster engine is WASM loaded at
 * runtime, its fill rule is not visible from this repo, and a mesh that relies
 * on an even-odd rasteriser unioning two solids would SUBTRACT one from the
 * other instead - silently, with no error, producing a cap with a hole where
 * the stem should be. Displacing one watertight surface has no such failure
 * mode. test_keycap.mjs asserts watertightness and positive volume on every
 * profile/row/size combination rather than trusting the construction.
 *
 * ORIENTATION. Built in keyboard space: +Z runs from the top face down to the
 * mouth, +Y is the back of the board. orientForPrint() then lays the top face's
 * mean plane on the plate, which is the printable orientation - see the note
 * there for why the other one cannot work.
 *
 * No DOM, no imports - scripts/dev/test_keycap.mjs runs it in node.
 */

(function (root) {
  'use strict';

  /* ---- mechanical constants -------------------------------------------
     These are the numbers that decide whether the cap fits a switch. */
  var MX = {
    /* MEASURED, not assumed. Two independent CAD models of real MX-compatible
       caps were pulled apart for these - Signature Plastics' own DSA R3 (drawn
       in inches) and a relegendable Cherry-profile cap (mm) - and they agree:

         arm length   4.038 (SP)   4.00 (relegendable)   -> 4.00
         post radius  2.756 (SP)   3.40 (relegendable)   -> 2.76
         SLOT WIDTH   1.194 (SP)   1.10 (relegendable)   -> 1.15 nominal

       The slot number is the one that matters and the one I had wrong: I was
       carrying 1.30 mm, which is 0.1-0.2 mm wider than either real cap. Both
       of those are injection moulded, though, and cured resin spreads past the
       mask edge - so a PRINTED cap still wants the modelled slot a little over
       nominal. That margin is slotClearance, and it is the only number here
       that is still a guess. */
    crossLen:   4.00,
    crossWide:  1.15,   // nominal moulded slot, mean of the two reference caps
    crossDepth: 4.20,   // switch stem stands 3.6 mm proud; this clears it
    postR:      2.76,
    /* The relegendable cap flares its slot over the first stretch of depth so
       the switch finds its way in - 1.50 mm at the mouth closing to 1.10. That
       lead-in is worth copying twice over on a printed cap, where the first
       layers of the opening are the roughest part of the whole part. */
    crossChamfer:   0.20,   // extra width at the mouth of the slot
    crossChamferZ:  0.45,   // over this much depth
    /* ⚠️ STILL A TUNING VALUE. Print stemTestComb(), keep the first stem that
       clicks on without force, and set this to that slot minus crossWide.
       Nothing in this project has yet put a switch on a printed stem. */
    slotClearance: 0.08 // -> a 1.23 mm slot, between the two reference caps
  };

  /* ---- profiles ---------------------------------------------------------
     Heights are mm from the mouth plane to the highest point of the cap; angle
     is the row's tilt in degrees, positive meaning the BACK edge stands further
     from the plate (how a top row leans toward you). topInset is PER SIDE, so a
     1u top face is 18.00 - 2*topInset across: 12.70 for DSA, 13.70 for XDA,
     13.00 for SA, 12.40 for Cherry, 12.20 for OEM.

     ⚠️ These are the community-measured figures keycap makers trade, not
     manufacturer drawings - vendors disagree by a few tenths and nobody here
     has put calipers on a real cap. They are a table on purpose: correct one
     against a cap you own and every cap in that row follows. */
  var PROFILES = {
    DSA:    { dish: 'spherical',   uniform: true,  topInset: 2.65, dishDepth: 1.10,
              rows: { R3: { h:  7.4, angle:  0 } },
              note: 'uniform - one shape for every row' },
    XDA:    { dish: 'spherical',   uniform: true,  topInset: 2.15, dishDepth: 0.80,
              rows: { R3: { h:  9.1, angle:  0 } },
              note: 'uniform, taller and flatter than DSA - the big top face' },
    SA:     { dish: 'spherical',   uniform: false, topInset: 2.50, dishDepth: 1.30,
              rows: { R1: { h: 16.5, angle: -13 }, R2: { h: 14.0, angle: -6 },
                      R3: { h: 12.5, angle:   0 }, R4: { h: 13.7, angle:  6 } },
              note: 'tall and sculpted - the most material and the longest print' },
    CHERRY: { dish: 'cylindrical', uniform: false, topInset: 2.80, dishDepth: 0.85,
              rows: { R1: { h:  9.4, angle: -1 }, R2: { h: 8.2, angle: 3 },
                      R3: { h:  6.9, angle:  7 }, R4: { h: 7.6, angle: 13 } },
              note: 'low and sculpted - the shortest print of the five' },
    OEM:    { dish: 'cylindrical', uniform: false, topInset: 2.90, dishDepth: 0.90,
              rows: { R1: { h: 11.2, angle: -3 }, R2: { h: 9.5, angle: 3 },
                      R3: { h:  9.0, angle:  7 }, R4: { h: 9.4, angle: 13 } },
              note: 'sculpted, a bit taller than Cherry - the stock-keyboard shape' },
    /* NOT A KEYCAP AND NOT OFFERED AS ONE - hidden:true keeps it out of the
       picker. It exists so stemTestComb can print a coupon small enough to
       tile a 40.8 x 30.6 mm bed: the real cap is 18 mm square and only two of
       those fit, which makes a fit comb of two useless steps. Nearly no inset
       and no dish, so an 11 mm block still leaves the top face wide enough for
       the post the guard insists on. The stem is not reimplemented here - it
       comes out of the same build() as every cap, which is the entire reason
       the number this measures can be trusted. */
    TEST:   { dish: 'spherical',   uniform: true,  topInset: 0.60, dishDepth: 0.00,
              hidden: true,
              rows: { R3: { h:  7.0, angle:  0 } },
              note: 'stem fit coupon - not a keycap' }
  };

  var UNIT = 19.05;       // key pitch
  var CAP_GAP = 1.05;     // pitch minus cap, so 1u is 18.00 mm
  var DEPTH = 18.00;      // every cap is 1u deep
  var BED = { x: 40.8, y: 30.6, zFlat: 58.0, zSupported: 52.0 };
  var PIXEL_MM = 40.8 / 320;

  function capWidth(sizeU) { return UNIT * sizeU - CAP_GAP; }

  // ---- soup ---------------------------------------------------------------
  function Soup() { this.t = []; }
  Soup.prototype.tri = function (a, b, c) { this.t.push(a, b, c); };
  Soup.prototype.quad = function (a, b, c, d) { this.tri(a, b, c); this.tri(a, c, d); };
  Soup.prototype.count = function () { return this.t.length / 3; };
  Soup.prototype.toFloat32 = function () {
    var o = new Float32Array(this.t.length * 3), t = this.t;
    for (var i = 0; i < t.length; i++) { o[i*3] = t[i][0]; o[i*3+1] = t[i][1]; o[i*3+2] = t[i][2]; }
    return o;
  };

  /* Join two rings of EQUAL length, vertex i to vertex i. `outward` gives the
     side wall a normal pointing away from the ring's axis; the reverse is for a
     cavity wall, where out-of-the-solid points inward. Also does a flat annulus
     when both rings share a z - see flatRing. */
  function band(s, lo, hi, outward) {
    for (var i = 0; i < lo.length; i++) {
      var j = (i + 1) % lo.length;
      if (outward) s.quad(lo[i], lo[j], hi[j], hi[i]);
      else         s.quad(lo[i], hi[i], hi[j], lo[j]);
    }
  }
  /* A flat annulus between two coplanar rings. `up` = +Z normal. Derived, not
     guessed: for CCW rings seen from +Z, quad(outer[i],outer[j],inner[j],inner[i])
     has a +Z cross product. */
  function flatRing(s, outer, inner, up) {
    for (var i = 0; i < outer.length; i++) {
      var j = (i + 1) % outer.length;
      if (up) s.quad(outer[i], outer[j], inner[j], inner[i]);
      else    s.quad(outer[i], inner[i], inner[j], outer[j]);
    }
  }
  /* Cap a ring with a centre fan. Valid only for a ring that is star-shaped
     about its centroid - true for the rectangles here and, less obviously, for
     the cross: every point of a + is visible from its centre. */
  function fan(s, ring, up) {
    var cx = 0, cy = 0, n = ring.length;
    for (var i = 0; i < n; i++) { cx += ring[i][0]; cy += ring[i][1]; }
    var c = [cx/n, cy/n, ring[0][2]];
    for (var k = 0; k < n; k++) {
      var a = ring[k], b = ring[(k+1) % n];
      if (up) s.tri(c, a, b); else s.tri(c, b, a);
    }
  }
  /* Bridge a big ring to a small one whose count divides it. Each small vertex
     fans to a contiguous arc of the big ring. `offset` aligns small[0] with the
     big vertex nearest it in angle; because both rings are star-shaped about
     the origin, nested, and stepped monotonically in angle, every triangle
     stays inside its own angular wedge and none can invert. */
  function bridgeUneven(s, big, small, up) {
    bridgeTris(big, small).forEach(function (t) {
      if (up) s.tri(t[0], t[1], t[2]); else s.tri(t[0], t[2], t[1]);
    });
  }

  /* The same walk, handed back instead of emitted. It exists so that the roof
     clearance check and the roof itself cannot disagree: the check measures the
     triangles that will actually be built, not an idealisation of them. */
  function bridgeTris(big, small) {
    var m = big.length, n = small.length, per = m / n, out = [];
    if (per !== Math.floor(per)) throw new Error('keycap: ring counts must divide (' + m + '/' + n + ')');
    var a0 = Math.atan2(small[0][1], small[0][0]), best = 0, bestD = Infinity;
    for (var q = 0; q < m; q++) {
      var d = Math.abs(angDiff(Math.atan2(big[q][1], big[q][0]), a0));
      if (d < bestD) { bestD = d; best = q; }
    }
    for (var k = 0; k < n; k++) {
      var apex = small[k], b = best + k * per;
      for (var e = 0; e < per; e++)
        out.push([apex, big[(b + e) % m], big[(b + e + 1) % m]]);
      out.push([apex, big[(b + per) % m], small[(k + 1) % n]]);
    }
    return out;
  }

  /* How far a set of triangles has to move in +z before every one of `pts`
     clears it by `want`. The triangles are the roof underside; the points are
     the top face. z grows INTO the cap, so "underside below the top" means
     triZ >= topZ + want, and a shortfall is topZ + want - triZ. Returns 0 when
     nothing is violated, which is the ordinary case. */
  function liftOver(tris, pts, want) {
    var extra = 0, t, i, j, k;
    for (t = 0; t < tris.length; t++) {
      var a = tris[t][0], b = tris[t][1], c = tris[t][2];
      var mnx = Math.min(a[0], b[0], c[0]), mxx = Math.max(a[0], b[0], c[0]);
      var mny = Math.min(a[1], b[1], c[1]), mxy = Math.max(a[1], b[1], c[1]);
      var d = (b[1]-c[1])*(a[0]-c[0]) + (c[0]-b[0])*(a[1]-c[1]);
      if (Math.abs(d) < 1e-12) continue;                    // degenerate in plan
      for (k = 0; k < pts.length; k++) {
        var x = pts[k][0], y = pts[k][1];
        if (x < mnx || x > mxx || y < mny || y > mxy) continue;
        var l1 = ((b[1]-c[1])*(x-c[0]) + (c[0]-b[0])*(y-c[1])) / d;
        var l2 = ((c[1]-a[1])*(x-c[0]) + (a[0]-c[0])*(y-c[1])) / d;
        var l3 = 1 - l1 - l2;
        if (l1 < -1e-9 || l2 < -1e-9 || l3 < -1e-9) continue;
        var z = l1*a[2] + l2*b[2] + l3*c[2];
        var need = pts[k][2] + want - z;
        if (need > extra) extra = need;
      }
    }
    return extra;
  }
  function angDiff(a, b) { var d = a - b; while (d > Math.PI) d -= 2*Math.PI; while (d < -Math.PI) d += 2*Math.PI; return d; }

  /* A rectangle walked CCW from (-w/2,-d/2) with n points per side, so its
     ordering matches gridPerimeter() vertex for vertex. */
  function subdivRect(w, d, n, z) {
    var out = [], hx = w/2, hy = d/2, i;
    for (i = 0; i < n; i++)     out.push([-hx + w*i/(n-1), -hy, z]);
    for (i = 1; i < n; i++)     out.push([ hx, -hy + d*i/(n-1), z]);
    for (i = n-2; i >= 0; i--)  out.push([-hx + w*i/(n-1),  hy, z]);
    for (i = n-2; i >= 1; i--)  out.push([-hx, -hy + d*i/(n-1), z]);
    return out;
  }
  function gridPerimeter(n) {
    var out = [], i;
    for (i = 0; i < n; i++)    out.push([i, 0]);
    for (i = 1; i < n; i++)    out.push([n-1, i]);
    for (i = n-2; i >= 0; i--) out.push([i, n-1]);
    for (i = n-2; i >= 1; i--) out.push([0, i]);
    return out;
  }

  /* The cross outline as one closed 12-point ring, CCW. */
  function crossRing(len, wide, z) {
    var L = len/2, W = wide/2;
    return [[ W,-L,z],[ W,-W,z],[ L,-W,z],[ L, W,z],[ W, W,z],[ W, L,z],
            [-W, L,z],[-W, W,z],[-L, W,z],[-L,-W,z],[-W,-W,z],[-W,-L,z]];
  }
  /* The post ring reuses the cross's angles at a fixed radius, so post-to-cross
     is a clean radial band instead of an arbitrary polygon match. */
  function postRing(cross, r, z) {
    return cross.map(function (p) {
      var m = Math.hypot(p[0], p[1]);
      return [p[0]/m*r, p[1]/m*r, z];
    });
  }

  /* Grid resolution has to leave the top perimeter (4n-4) divisible by the
     cross's 12, so bridgeUneven gets a whole number. */
  function snapGrid(n) {
    /* The ceiling was 61, which put a 13.7 mm top face on a 0.23 mm grid -
       nearly twice the printer's 0.1275 mm pixel. Every legend was therefore
       discarded at better than half the resolution the machine can print,
       before the slicer ever saw it: a 0.5 mm digit stroke landed on two
       samples and came out mangled. 151 lets the grid reach the pixel. */
    n = Math.max(7, Math.min(151, Math.round(n)));
    while ((4*n - 4) % 12) n++;
    return n;
  }
  /* The grid that matches the machine: about one sample per printer pixel
     across the face. Finer than that is detail the mask cannot hold. */
  function gridForFace(topWmm, pixelMm) {
    return snapGrid(Math.ceil(topWmm / (pixelMm || PIXEL_MM)) + 1);
  }


  // ---- the top surface ----------------------------------------------------
  /* z grows from the top face INTO the cap, so a dish - which removes material
     from the middle of the face - is deepest at the centre. */
  function topField(opts) {
    var w = opts.topW, d = opts.topD, prof = opts.profile;
    var dd = opts.dishDepth, tan = Math.tan(opts.angle * Math.PI / 180);
    return function (x, y) {
      var dish;
      if (prof.dish === 'cylindrical') {
        var u = x / (w/2);
        dish = dd * Math.max(0, 1 - u*u);
      } else {
        var r = Math.hypot(x / (w/2), y / (d/2));
        dish = dd * Math.max(0, 1 - r*r);
      }
      return dish + y * tan;
    };
  }

  /* ---- the build --------------------------------------------------------- */
  function build(opts) {
    var o = opts || {};
    var pname = (o.profile || 'CHERRY').toUpperCase();
    /* hasOwnProperty, not a truthiness check: PROFILES is an object literal, so
       PROFILES["CONSTRUCTOR"] - or TOSTRING, or VALUEOF - comes back truthy and
       the next line reads .rows off a function. The caller then gets a
       TypeError from deep inside the engine instead of the clear message
       below, which is how a bad saved session took out the whole card. */
    var prof = Object.prototype.hasOwnProperty.call(PROFILES, pname)
             ? PROFILES[pname] : null;
    if (!prof || !prof.rows) throw new Error('keycap: unknown profile "' + pname + '"');
    var rname = o.row || (prof.uniform ? Object.keys(prof.rows)[0] : 'R3');
    var row = prof.rows[rname];
    if (!row) throw new Error('keycap: ' + pname + ' has no row ' + rname +
      ' (has ' + Object.keys(prof.rows).join(', ') + ')');

    var mx = Object.assign({}, MX, o.mx || {});
    var sizeU = o.sizeU || 1;
    /* Size normally comes from the unit count, because that is what a keycap
       is. A coupon is not on a keyboard and has no unit count, so it may state
       its own - nothing else about the build changes. */
    var W = o.widthMm || capWidth(sizeU), D = o.depthMm || DEPTH;
    var wall = o.wall || 1.35;
    /* The roof is the material between the dish and the top of the stem hole,
       and it FOLLOWS the top contour rather than sitting at one flat height.
       That distinction decides whether the low profiles exist at all: a flat
       roof set below the cap's highest point makes a tilted Cherry R3 almost
       4 mm thick at the front, and the stem then does not fit inside a 6.9 mm
       cap. Real caps are thin and follow the curve, so this one does too. */
    var roof = o.roof || 1.20;
    var topW = W - 2*prof.topInset, topD = D - 2*prof.topInset;
    var n = snapGrid(o.topGrid || 25);
    var warn = [];

    var field = topField({ topW: topW, topD: topD, profile: prof,
                           dishDepth: (o.dishDepth != null ? o.dishDepth : prof.dishDepth),
                           angle: (o.angle != null ? o.angle : row.angle) });
    /* Legends and any generated skin are the same thing: an extra displacement
       on this one surface. Nothing downstream has to know which it was. */
    var relief = o.relief || null;
    function raw(x, y) {
      var z = field(x, y);
      if (relief) z += relief(x / (topW/2), y / (topD/2), topW, topD);
      return z;
    }

    // normalise so the cap's highest point is z = 0 and z grows into the cap
    var i, j, minZ = Infinity;
    for (i = 0; i < n; i++) for (j = 0; j < n; j++) {
      var zz = raw(-topW/2 + topW*i/(n-1), -topD/2 + topD*j/(n-1));
      if (zz < minZ) minZ = zz;
    }
    function surf(x, y) { return raw(x, y) - minZ; }

    var gp = [], maxZ = -Infinity;
    for (i = 0; i < n; i++) {
      gp.push([]);
      for (j = 0; j < n; j++) {
        var x = -topW/2 + topW*i/(n-1), y = -topD/2 + topD*j/(n-1), z = surf(x, y);
        if (z > maxZ) maxZ = z;
        gp[i].push([x, y, z]);
      }
    }

    /* Profile height tables quote the FRONT edge, not the overall height - a
       sculpted cap's back edge stands taller by the row angle. Measuring from
       the front is what makes the published numbers land on a real cap. */
    var zFront = surf(0, -topD/2);
    var mouthZ = row.h + zFront;

    var slot = mx.crossWide + mx.slotClearance;
    var crossXY = crossRing(mx.crossLen, slot, 0);
    var postXY = postRing(crossXY, mx.postR, 0);

    var innerW = topW - 2*wall, innerD = topD - 2*wall;

    /* ⚠️ HOW MUCH MATERIAL IS ACTUALLY LEFT OVER THE CAVITY.

       The roof underside is not a surface with an equation - it is a BRIDGE
       between two rings (the inner wall and the post), linear in between,
       while the top face is the full n x n grid of surf(). Wherever the top
       bulges above its own two-ring interpolation the underside passes through
       it and the cap has a hole. An engraved legend in the middle of the face
       does precisely that, and nothing here looked: the only check was floorZ
       below, which samples thirteen points, every one of them under the post,
       where the flat floor already covers the case.

       Measured on the shipped code: XDA R3 1u with the drawn 'afak' icon
       engraved 1.50 mm put 244 of 14400 vertical rays clean through the cap,
       worst void 0.149 mm; at 2.00 mm, 556 rays and 0.579 mm. warnings was
       empty, validate() found nothing, and mesh-health called it watertight -
       which it is. It is watertight and self-intersecting, and it prints with
       a hole in the top.

       So measure it. bridgeTris() is the same walk bridgeUneven() emits, so
       what is checked is what gets built; liftOver() drops the top grid onto
       those triangles and returns the worst shortfall. Pushing BOTH rings down
       by that much restores the clearance without flattening the roof - which
       matters, because a flat roof is what makes a tilted Cherry R3 4 mm thick
       at the front and leaves no room for a stem (see `roof` above). */
    var MIN_ROOF = o.minRoof == null ? 0.5 : o.minRoof;   // ~10 layers at 0.05
    var inPts = [], inPost = [];
    for (i = 0; i < n; i++) for (j = 0; j < n; j++) {
      var px = gp[i][j][0], py = gp[i][j][1];
      if (Math.abs(px) > innerW/2 || Math.abs(py) > innerD/2) continue;
      (px*px + py*py <= mx.postR*mx.postR ? inPost : inPts).push(gp[i][j]);
    }
    var roofRing0 = subdivRect(innerW, innerD, n, 0).map(function (q) {
      return [q[0], q[1], surf(q[0], q[1]) + roof];
    });
    var poLo0 = postXY.map(function (q) { return [q[0], q[1], surf(q[0], q[1]) + roof]; });
    var roofExtra = liftOver(bridgeTris(roofRing0, poLo0), inPts, MIN_ROOF);

    /* The hole floor is flat, so the switch bottoms out evenly, and it sits at
       the deepest the roof gets anywhere under the post - otherwise a dish or a
       legend could push the roof up through the floor and open a hole in the
       top of the cap.

       It now sweeps the whole post DISC, not the twelve ring vertices and the
       centre: a legend stroke can cross the disc without touching any of those
       thirteen points, and thirteen samples of a surface is not a bound on it. */
    var floorZ = surf(0, 0) + roof + roofExtra;
    postXY.forEach(function (p) {
      var z = surf(p[0], p[1]) + roof + roofExtra; if (z > floorZ) floorZ = z; });
    inPost.forEach(function (q) {
      var z = q[2] + Math.max(roof, MIN_ROOF) + roofExtra; if (z > floorZ) floorZ = z; });
    /* A low sculpted row cannot hold a full-depth stem - Cherry R4 is 8.45 mm
       tall and a 4.2 mm stem under a 1.2 mm roof wants 8.58. Real caps shorten
       the stem rather than not existing, so this does too: take what the cap
       has, down to the 3.0 mm that still holds a switch, and say so. Below
       that it refuses. */
    var wantDepth = mx.crossDepth;
    var haveDepth = mouthZ - 0.3 - floorZ;
    var useDepth = Math.min(wantDepth, haveDepth);
    var postTopZ = floorZ + useDepth;

    // ---- refuse to emit a cap that cannot work ---------------------------
    if (innerW <= 2*mx.postR + 1 || innerD <= 2*mx.postR + 1)
      throw new Error('keycap: the ' + pname + ' top face is ' + topW.toFixed(1) +
        ' mm, too small for a ' + (mx.postR*2).toFixed(1) + ' mm post inside ' + wall + ' mm walls');
    if (useDepth < 3.0)
      throw new Error('keycap: ' + pname + ' ' + rname + ' stands ' + mouthZ.toFixed(2) +
        ' mm, which leaves only ' + Math.max(0, haveDepth).toFixed(2) +
        ' mm for the stem under a ' + (roof + roofExtra).toFixed(2) + ' mm roof' +
        (roofExtra > 0.005
          ? ' (deepened by ' + roofExtra.toFixed(2) + ' mm to keep material under the ' +
            'artwork - a shallower legend would give the stem that back)'
          : '') +
        ' - a switch needs at least 3.0. Use a taller row, a shallower legend, ' +
        'or a thinner roof.');
    if (useDepth < wantDepth - 0.01)
      warn.push('the stem is ' + useDepth.toFixed(2) + ' mm deep instead of ' + wantDepth +
        ' - that is all ' + pname + ' ' + rname + ' has room for. It still holds a switch ' +
        '(the stem stands 3.6 mm proud) but sits slightly higher on it.');
    /* Not silent. The roof got thicker, the stem got shorter, and the owner
       chose neither - so it is said out loud, in millimetres. */
    if (roofExtra > 0.005)
      warn.push('the artwork reaches ' + (roof + roofExtra).toFixed(2) +
        ' mm into the cap, so the roof under it was deepened by ' +
        roofExtra.toFixed(2) + ' mm and the stem is that much shorter. ' +
        'Without it the legend would have opened a hole through the top.');
    if (mx.postR * 2 <= mx.crossLen)
      throw new Error('keycap: postR ' + mx.postR + ' is smaller than the ' +
        mx.crossLen + ' mm cross - the slot would break out of the post');
    if (sizeU >= 2) warn.push('a ' + sizeU + 'u cap needs stabiliser stems at ±11.94 mm; ' +
      'this engine only makes the centre stem, so it will bind on a stabilised key');

    var s = new Soup();

    // top surface: solid is at larger z, so the outward normal is -Z
    for (i = 0; i < n-1; i++) for (j = 0; j < n-1; j++)
      s.quad(gp[i][j], gp[i][j+1], gp[i+1][j+1], gp[i+1][j]);

    // rings, all 4n-4 long so every join is vertex-to-vertex
    var per = gridPerimeter(n);
    var topRing = per.map(function (q) { return gp[q[0]][q[1]]; });
    var mouthOut = subdivRect(W, D, n, mouthZ);
    var mouthIn  = subdivRect(W - 2*wall, D - 2*wall, n, mouthZ);
    // the roof underside follows the top contour, so its ring is not planar
    var roofRing = roofRing0.map(function (q) { return [q[0], q[1], q[2] + roofExtra]; });

    band(s, topRing, mouthOut, true);      // outer skirt
    flatRing(s, mouthOut, mouthIn, true);  // the rim that sits on the switch plate
    band(s, roofRing, mouthIn, false);     // cavity wall

    // ---- the stem --------------------------------------------------------
    var poLo = poLo0.map(function (q) { return [q[0], q[1], q[2] + roofExtra]; });
    var poHi = postXY.map(function (q) { return [q[0], q[1], postTopZ]; });
    var crLo = crossXY.map(function (q) { return [q[0], q[1], floorZ]; });

    /* The slot mouth is flared, then steps down to full size - the lead-in the
       relegendable reference cap uses, which matters more on a printed stem
       than a moulded one. Set crossChamfer to 0 for a straight slot. */
    var cham = Math.max(0, mx.crossChamfer || 0);
    var chamZ = Math.max(0, Math.min(mx.crossChamferZ || 0, useDepth * 0.5));
    var crHi = crossRing(mx.crossLen + cham, slot + cham, postTopZ);
    var crMid = cham > 0 ? crossXY.map(function (q) { return [q[0], q[1], postTopZ - chamZ]; }) : null;

    bridgeUneven(s, roofRing, poLo, true); // roof underside, around the post
    band(s, poLo, poHi, true);             // post wall
    flatRing(s, poHi, crHi, true);         // the post's free end
    if (crMid) {
      band(s, crMid, crHi, false);         // the flared lead-in
      band(s, crLo, crMid, false);         // the slot proper
    } else {
      band(s, crLo, crHi, false);
    }
    fan(s, crLo, true);                    // the floor the switch bottoms out on

    var pos = s.toFloat32();
    return {
      positions: pos,
      triangles: s.count(),
      profile: pname, row: rname, sizeU: sizeU,
      size: { x: W, y: D, z: +mouthZ.toFixed(3) },
      slotWidth: +slot.toFixed(3),
      slotPixels: +(slot / PIXEL_MM).toFixed(1),
      angle: (o.angle != null ? o.angle : row.angle),
      mouthZ: +mouthZ.toFixed(3), frontZ: +zFront.toFixed(3),
      roofMm: roof, floorZ: +floorZ.toFixed(3), postTopZ: +postTopZ.toFixed(3),
      stemDepth: +useDepth.toFixed(3),
      printPlan: (function () {
        /* MEASURED IN KEYBOARD SPACE, PRINTED IN PRINT SPACE. Every export
           calls orientForPrint/orientAsPrinted first, which stands the cap on
           the plate at the row angle - and on a 13-degree row that is a
           different height from the one measured here, so the layer count and
           the clock derived from it were short by up to five per cent. The
           positions and the angle are both in hand at this point, so measure
           the pose that will actually be printed instead of assuming the two
           are the same. */
        var oriented = orientForPrint(pos, (o.angle != null ? o.angle : row.angle));
        var oz = 0;
        for (var q = 2; q < oriented.length; q += 3) if (oriented[q] > oz) oz = oriented[q];
        var plan = fits(W, D, oz > 0 ? oz : mouthZ);
        /* The relief knows whether it stands proud; the geometry does not. This
           is the one place that has both. */
        var deg = (relief && relief.raised)
          ? raisedLean(relief.depth, (o.dishDepth != null ? o.dishDepth : prof.dishDepth), topD)
          : 0;
        return leanPlan(plan, W, D, mouthZ, deg);
      })(),
      warnings: warn
    };
  }

  /* ---- print orientation -------------------------------------------------
     Lay the top face's mean plane on the plate: rotate by -angle about X, then
     drop to z=0.

     The other orientation does not work, and it is worth writing down why. Mouth
     down puts the roof last, spanning the hollow cavity - an 11 mm island with
     nothing under it, which needs supports INSIDE the cap where they cannot be
     cleaned off the stem. Top down, every layer sits on the one below and no
     support touches a functional surface. The cost is that the dish rim meets
     the plate as a ring rather than a face, so the over-exposed base layers
     land on the cap's visible top edge - that is the real trade, and it is the
     better half of it. */
  function orientForPrint(positions, angleDeg) {
    var a = -(angleDeg || 0) * Math.PI / 180, c = Math.cos(a), sn = Math.sin(a);
    var out = new Float32Array(positions.length), minZ = Infinity, k;
    for (k = 0; k < positions.length; k += 3) {
      var y = positions[k+1], z = positions[k+2];
      out[k] = positions[k];
      out[k+1] = y*c - z*sn;
      out[k+2] = y*sn + z*c;
      if (out[k+2] < minZ) minZ = out[k+2];
    }
    for (k = 2; k < out.length; k += 3) out[k] -= minZ;
    return out;
  }

  /* The pose the machine will actually build it in: laid top-face-down, then
     leaned over by whatever the fit and the relief demand.

     This exists because the preview was quietly dishonest. You judge a cap
     standing upright, and then it prints leaning at 34 degrees on a raft of
     supports, and the first time you see that is when you open the slicer. The
     lean is where support scars land and where an overhang gets rough, so it
     is worth being able to look at before committing resin to it. */
  /* Turn it over so the open mouth takes the plate. Negating z is a MIRROR,
     not a rotation, so the winding reverses with it and has to be put back -
     the third time this project has met that fact, hence the note.

     A cap with a figure on its top face cannot be laid top-face-down, which is
     what orientForPrint does and what is right for a plain cap. Measured before
     this existed: the sculpt sat 5.8 to 7.0 mm BELOW the cap on every profile,
     at every tilt from 0 to 88 degrees - the artwork bearing the whole part
     against the FEP. Leaning a part that is already upside down only changes
     which corner of it is crushed first. */
  function mouthDown(p) {
    var flipped = new Float32Array(p.length), mn = Infinity, i;
    for (i = 0; i < p.length; i += 3) {
      flipped[i] = p[i];
      flipped[i + 1] = p[i + 1];
      flipped[i + 2] = -p[i + 2];
      if (flipped[i + 2] < mn) mn = flipped[i + 2];
    }
    for (i = 2; i < flipped.length; i += 3) flipped[i] -= mn;
    var out = new Float32Array(p.length), ORDER = [0, 2, 1], t, c;
    for (t = 0; t < flipped.length; t += 9) {
      for (c = 0; c < 3; c++) {
        var src = t + ORDER[c] * 3, dst = t + c * 3;
        out[dst] = flipped[src];
        out[dst + 1] = flipped[src + 1];
        out[dst + 2] = flipped[src + 2];
      }
    }
    return out;
  }

  function orientAsPrinted(positions, rowAngleDeg, tiltDeg, opts) {
    var p = orientForPrint(positions, rowAngleDeg || 0);
    if (opts && opts.mouthDown) p = mouthDown(p);
    if (!tiltDeg) return p;
    var a = tiltDeg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
    var out = new Float32Array(p.length), minZ = Infinity, i;
    for (i = 0; i < p.length; i += 3) {
      var x = p[i], z = p[i + 2];
      out[i]     = x * c + z * s;          // lean about Y, which is the axis
      out[i + 1] = p[i + 1];               // tiltFit measures the footprint on
      out[i + 2] = -x * s + z * c;         // so the two agree by construction
      if (out[i + 2] < minZ) minZ = out[i + 2];
    }
    for (i = 2; i < out.length; i += 3) out[i] -= minZ;
    return out;
  }

  /* ---- validate anything claiming to be a keycap -------------------------
     Used on generated meshes. It reports; it does not repair. */
  function validate(positions, opts) {
    var o = opts || {}, issues = [], notes = [];
    var px = o.pixelMm || PIXEL_MM;
    var sizeU = o.sizeU || 1;
    if (!positions || !positions.length || positions.length % 9)
      return { ok: false, issues: ['not a triangle soup'], notes: [] };

    var mn = [Infinity,Infinity,Infinity], mxx = [-Infinity,-Infinity,-Infinity];
    for (var i = 0; i < positions.length; i += 3) for (var k = 0; k < 3; k++) {
      if (positions[i+k] < mn[k]) mn[k] = positions[i+k];
      if (positions[i+k] > mxx[k]) mxx[k] = positions[i+k];
    }
    var size = { x: mxx[0]-mn[0], y: mxx[1]-mn[1], z: mxx[2]-mn[2] };

    var wantW = capWidth(sizeU);
    if (size.x > UNIT * sizeU) issues.push('it is ' + size.x.toFixed(1) +
      ' mm wide - a ' + sizeU + 'u cap must stay under the ' + (UNIT*sizeU).toFixed(2) +
      ' mm pitch or it binds on its neighbour');
    if (size.y > UNIT) issues.push('it is ' + size.y.toFixed(1) +
      ' mm deep - over the ' + UNIT + ' mm row pitch');
    if (size.x < wantW - 3 || size.y < DEPTH - 3)
      notes.push('smaller than a ' + sizeU + 'u cap (' + wantW.toFixed(1) + ' × ' +
        DEPTH + ' mm) - scale it up before slicing');
    if (size.z > 20) issues.push('it is ' + size.z.toFixed(1) + ' mm tall; the tallest profile here is SA R1 at 16.5 mm');

    var fit = fits(size.x, size.y, size.z);
    if (!fit.ok) issues.push(fit.why);
    else if (fit.tilt) notes.push(fit.why);

    var mx = Object.assign({}, MX, o.mx || {});
    var slot = mx.crossWide + mx.slotClearance, pxAcross = slot / px;
    notes.push('stem slot ' + slot.toFixed(2) + ' mm = ' + pxAcross.toFixed(1) + ' pixels');
    if (pxAcross < 8) issues.push('the slot is only ' + pxAcross.toFixed(1) +
      ' pixels across - under about 8 it will not hold its shape');

    var h = root.meshHealth ? root.meshHealth(positions) : null;
    if (h && h.severity === 'bad') issues.push('mesh: ' + h.advice);
    else if (h && !h.watertight) notes.push('mesh: ' + h.summary);

    return { ok: !issues.length, size: size, slotWidth: +slot.toFixed(3),
             slotPixels: +pxAcross.toFixed(1), issues: issues, notes: notes, health: h };
  }

  /* ---- what the bed will take -------------------------------------------
     Print time depends on height alone, so a full plate costs the same as one
     cap. Packing is therefore the whole game.

     A cap too long to lie flat is NOT out of reach: tilting it about the depth
     axis trades footprint for height, and height is the axis with 52 mm spare.
     A 2.25u cap is 41.81 mm on a 40.8 mm bed and misses flat by a millimetre -
     but at 30 deg it is 29.8 mm across and 40 mm tall, and fits easily. The
     envelope below is computed, not assumed, and it says 3u is the ceiling: a
     6.25u spacebar is 118 mm and clears at no angle at all. That is the single
     key this printer cannot make in one piece.

     Tilting about Y keeps the stem printable, which is the part that would
     otherwise rule it out. The post grows out of the roof, so the roof has to
     be laid down first; that holds for any tilt under 90 deg, because the
     post's axis keeps a positive vertical component. Supports land on the
     leading edge of the cap and never inside the stem cavity. */
  function tiltFit(len, depth, h, opts) {
    var o = opts || {};
    /* A lean means supports, so the room a lean needs is the whole reserve:
       the plate's edge allowance, the raft's border and a support foot. This
       used to be `BED.x - 1.0` - the edge allowance alone - which left the
       pad and the feet unaccounted for, and the slicer then scaled the part
       down to make them fit. `margin` stays as extra slack a caller can ask
       for on top. */
    var margin = o.margin == null ? 0 : o.margin;
    var leanLimit = usableBed().x - margin;
    var zLimit = o.zLimit || BED.zSupported;
    if (depth > BED.y) return { ok: false };
    var lo = null, hi = null;
    for (var t = 0; t <= 860; t++) {
      var r = t / 10 * Math.PI / 180;
      var fx = len * Math.cos(r) + h * Math.sin(r);
      var fz = len * Math.sin(r) + h * Math.cos(r);
      /* A lean means supports, so the room a lean needs is the full reserve.
         `margin` was 1.0 - the slicer's edge allowance alone - which left the
         pad and the feet unaccounted for. */
      if (fx <= leanLimit && fz <= zLimit) { if (lo === null) lo = t/10; hi = t/10; }
    }
    if (lo === null) return { ok: false };
    /* Take the shallowest angle that clears: less tilt is less overhang, less
       support contact, and a shorter print. */
    var use = lo, rr = use * Math.PI / 180;
    return { ok: true, deg: +use.toFixed(1), degMin: lo, degMax: hi,
             footX: +(len*Math.cos(rr) + h*Math.sin(rr)).toFixed(2),
             height: +(len*Math.sin(rr) + h*Math.cos(rr)).toFixed(2) };
  }

  function fits(w, d, h, opts) {
    h = h || 9.0;
    /* AGAINST THE USABLE AREA, NOT THE BED. This asked `w <= BED.x` and so
       called a 2u cap printable while perPlate - which now reserves the
       raft's border - put zero of them on a plate. One of those two was
       going to be a surprise at the printer, and it was: the slicer scales
       whatever it cannot fit, and a scaled keycap does not go on a switch.
       Flat means no supports, so the reserve here is the edge plus the pad.
       A lean adds feet, and tiltFit's own margin below accounts for them. */
    var flat = usableBed();
    if (w <= flat.x && d <= flat.y)
      return { ok: true, tilt: 0, rotate: false, supports: false, foot: { x: w, y: d }, height: h };
    if (d <= flat.x && w <= flat.y)
      return { ok: true, tilt: 0, rotate: true, supports: false, foot: { x: d, y: w }, height: h };
    var t = tiltFit(w, d, h, opts);
    if (t.ok) return { ok: true, tilt: t.deg, tiltRange: [t.degMin, t.degMax], rotate: false,
      supports: true, foot: { x: t.footX, y: d }, height: t.height,
      why: 'too long to lie flat, but it clears at ' + t.deg + '° - ' + t.footX +
           ' mm across and ' + t.height + ' mm tall. Tilted means supports; they land on the ' +
           'leading edge, not in the stem.' };
    return { ok: false, tilt: null, rotate: false, supports: true,
      why: 'a ' + w.toFixed(1) + ' × ' + d.toFixed(1) + ' mm cap clears the ' +
        BED.x + ' × ' + BED.y + ' × ' + BED.zSupported +
        ' mm volume at no angle. Above about 3u - which on a keyboard means only the ' +
        'spacebar - the cap has to be split and joined.' };
  }

  /* WHY A RAISED LEGEND FORCES A LEAN, and why this lives here rather than in
     the icon module where it started.

     A cap prints top face down. A raised legend therefore reaches the plate
     BEFORE the face around it does, so that face begins in mid air. A dish does
     not save it - a bump in the middle of a bowl is still an island. Leaning
     the cap far enough that its height varies across the face by more than the
     legend stands proud makes every layer grow out of the one below.

     This was computed in keycap-icons.js and merged into the report for
     DISPLAY only, so build(), layout() and the layer count never saw it: the
     report said "tilted 12 degrees, supports yes" while the plate packed the
     same cap flat at 1.5 mm spacing and the clock counted its untilted height.
     Two sources of truth, disagreeing silently, with the correct one on screen
     making the wrong one look authoritative. One source now - printPlan. */
  function raisedLean(reliefDepthMm, dishDepthMm, topDmm) {
    var rise = Math.abs(reliefDepthMm || 0) + (dishDepthMm || 0);
    if (rise <= 0) return 0;
    var deg = Math.atan2(rise * 1.6, topDmm || 13.7) * 180 / Math.PI;  // 1.6 = margin
    return Math.max(12, Math.min(35, Math.ceil(deg)));
  }

  /* Fold a forced lean into a plan that thought the cap could lie flat. The
     footprint shrinks and the height grows, exactly as tiltFit computes them,
     so the picture, the packing and the clock cannot drift apart. */
  function leanPlan(plan, len, depth, h, deg) {
    if (!deg || !plan.ok) return plan;
    if (plan.tilt >= deg) return plan;                 // already leaning further
    var r = deg * Math.PI / 180;
    return {
      ok: true, tilt: deg, rotate: false, supports: true,
      foot: { x: +(len * Math.cos(r) + h * Math.sin(r)).toFixed(2), y: depth },
      height: +(len * Math.sin(r) + h * Math.cos(r)).toFixed(2),
      forcedBy: 'relief',
      why: 'a raised legend reaches the plate before the face around it does, so ' +
           'the cap leans ' + deg + '\u00b0 and takes supports on its leading edge. ' +
           'Engraved needs neither.'
    };
  }

  /* ⚠️ THIS WAS THE LAST CONSUMER STILL DERIVING ITS OWN GEOMETRY. The comment
     further down says "one source now - printPlan", and the layer count was
     moved onto it; the per-plate count was not. perPlate recomputed everything
     from fits(), which is pure geometry and cannot see a raised legend - so for
     any cap whose lean is FORCED by its legend, perPlate packed an 18 x 18 mm
     flat cap at a 1.5 mm gap while layout() packed a 19.61 mm leaning footprint
     at 3.5 mm. Two of the three biggest numbers on the card disagreed with the
     plate the owner was about to print. Hand it the plan instead. */
  /* One pair of numbers for both packers. layout() opens the gap when anything
     on the plate needs supports, because supports are wider than the part. */
  /* THE BED IS NOT THE USABLE AREA. The slicer puts a raft pad under the part
     with a 1.6 mm border, and support feet with a 1.5 mm radius, and both of
     those live OUTSIDE anything the model measures. Packing to BED.x meant the
     real footprint - the one the slicer measures after it has built them - ran
     off the plate, and the slicer then did exactly what it is built to do:
     sliced again, smaller, and said so in one line.

     Measured, on the printer, not reasoned about: two DSA R3 1u caps,
     engraved, flat, laid out at 37.5 x 18.0 mm on a 40.8 x 30.6 mm bed. The
     slicer built 33 pillars and a pad around them and reported

         Scaled down 19.1% - the supports reached past the plate, and they
         still do. Scale the model down by hand before printing.

     For most models a 19% reduction is a disappointment. For a keycap it is a
     19% reduction in the CROSS SLOT, and the cap will not go on a switch at
     all - the entire point of the object, destroyed silently, because two
     components each did their job correctly. Reserve the room here, where the
     packing is decided.

     The honest cost: 34.6 x 24.4 mm of usable area means a 1u plate holds ONE
     cap and not two. A worse number, and the true one. */
  /* The three terms, each from slicer-wasm.js and each per side:
       EDGE  1.0  the plate is bolted on with play, so a part can stand about
                  a millimetre from where it is expected (KRASTO_ATSARGA_MM)
       PAD   1.6  the raft's border, added around whatever it carries
       FOOT  1.5  a support foot's radius, and only where supports stand
     The slicer measures the REAL footprint after building those and refuses
     anything past PLATE/2 - EDGE. So what the model itself may occupy is the
     plate less twice the terms that apply - which depends on whether this
     plate needs supports, so it is asked rather than assumed. */
  var EDGE_MM = 1.0, PAD_MM = 1.6, FOOT_MM = 1.5;

  /* WHAT IS RESERVED, AND WHAT IS NOT.

     EDGE 1.0 and PAD 1.6 always apply: the plate is bolted on with play, and
     the raft carries a border around whatever sits on it. Both are geometry
     that exists before a single support is placed, and packing to BED.x
     ignored them.

     FOOT 1.5 is NOT reserved here, deliberately. A support foot only exists
     where a support stands, and slicer-wasm.js says in as many words that
     subtracting it from the whole model was the old approach and that it left
     the part 68% of the plate - it measures the real footprint after building
     the supports instead. Reserving it again here would be the same mistake at
     one remove, and it costs real caps: an SA R1 with a figure on it is 22.50
     mm deep posed, and a blanket reserve leaves 22.40.

     Which leaves the case this was all found by - two 1u caps whose supports
     did run off the plate. That is not fixed by guessing a bigger number. It
     is fixed by refusing to print a SCALED keycap at all, which is what
     slicer.js now does: the slicer measures the truth, and a cap that has been
     shrunk to fit is a cap that no longer fits a switch. */
  var EDGE_MM = 1.0, PAD_MM = 1.6;
  function usableBed() {
    var r = EDGE_MM + PAD_MM;
    return { x: BED.x - 2 * r, y: BED.y - 2 * r, reserveMm: +r.toFixed(2) };
  }

  var FLAT_GAP = 1.5, SUPPORT_GAP = 3.5;

  function perPlate(sizeU, gap, h, plan) {
    h = h || 9.0;
    var f = plan || fits(capWidth(sizeU), DEPTH, h);
    gap = gap == null ? (f.supports ? SUPPORT_GAP : FLAT_GAP) : gap;
    if (!f.ok && f.ok !== undefined) return { count: 0, sizeU: sizeU, why: f.why };
    if (!f.foot) return { count: 0, sizeU: sizeU, why: 'no footprint in the plan' };
    var a = f.foot.x, b = f.foot.y;
    var bed = usableBed();             // not BED - see usableBed()
    var cols = Math.floor((bed.x + gap) / (a + gap)), rows = Math.floor((bed.y + gap) / (b + gap));
    return { count: Math.max(0, cols) * Math.max(0, rows), cols: cols, rows: rows,
             sizeU: sizeU, tilt: f.tilt, supports: f.supports, capMm: f.foot };
  }

  /* Lay caps out on the bed.

     THE THING THIS GETS RIGHT that the first version did not: a cap is packed
     by the footprint it will actually occupy WHEN PRINTED, not by its size
     sitting upright. An artisan cap with raised relief has to lean over - a
     raised legend reaches the plate before the face around it does - and a
     leaning cap has a different footprint and is far taller. Packing 2.25u
     Enters by their 41.8 mm width would say none fit; packing them by the
     29.8 mm they occupy at 34 degrees says two do.

     Supports need room too. A tilted cap is held up off the plate, so its
     supports splay out past its own footprint; the gap grows when any cap on
     the plate needs them.

     Height is checked as well as area, because a leaning 2.75u cap stands
     about 50 mm and the volume only has 52. */
  function layout(caps, opts) {
    var o = opts || {};
    caps = (caps || []).filter(Boolean);

    // work out how each cap actually sits on the plate
    var items = caps.map(function (c, i) {
      var plan = c.printPlan || fits(c.size.x, c.size.y, c.size.z);
      var w = plan.foot ? plan.foot.x : c.size.x;
      var d = plan.foot ? plan.foot.y : c.size.y;
      var h = plan.height || c.size.z;
      return { c: c, i: i, w: w, d: d, h: h, tilt: plan.tilt || 0,
               supports: !!plan.supports, ok: plan.ok !== false };
    });

    var anySupport = items.some(function (t) { return t.supports; });
    /* 1.5 mm is enough between two flat caps. Supported ones get 3.5: the
       support tree is wider at the plate than the part above it, and two
       neighbouring trees growing into each other is how a plate fails late. */
    var gap = o.gap == null ? (anySupport ? SUPPORT_GAP : FLAT_GAP) : o.gap;

    /* Shelf packing, tallest first. Sorting by depth first is what makes rows
       fill instead of leaving a strip of dead bed under every short cap. */
    var order = items.slice().sort(function (a, b) { return b.d - a.d; });

    var usable = usableBed();
    var placed = [], left = [], parts = [], total = 0;
    var cx = 0, cy = 0, rowD = 0, maxH = 0;
    order.forEach(function (t) {
      if (!t.ok) { left.push(t.c); return; }
      // turn a cap 90 degrees if that is the only way it lands
      var w = t.w, d = t.d, turned = false;
      /* PACKED INTO WHAT IS FREE, not into the bed - see usableBed(). The
         slicer's pad and support feet occupy the rest of it, and when they
         run off the plate it scales the whole model down to compensate. */
      /* TURN IT WHENEVER THAT IS WHAT LANDS IT, not only when it is too WIDE.
         A leaning cap grows along the direction it leans, so a 1u cap with a
         28 mm figure is 18.6 across and 32.5 deep - inside the usable width
         and well past the usable depth. This asked only about the width, saw
         18.6 was fine, never considered turning, and dropped the cap. */
      if ((w > usable.x || d > usable.y) && d <= usable.x && w <= usable.y)
        { w = t.d; d = t.w; turned = true; }
      if (w > usable.x || d > usable.y) { left.push(t.c); return; }
      if (cx > 0 && cx + w > usable.x + 1e-6) { cx = 0; cy += rowD + gap; rowD = 0; }
      if (cy + d > usable.y + 1e-6) { left.push(t.c); return; }

      var dx = cx + w / 2 - usable.x / 2, dy = cy + d / 2 - usable.y / 2;
      var p = t.c.positions, out = new Float32Array(p.length);
      for (var k = 0; k < p.length; k += 3) {
        var px = p[k], py = p[k + 1];
        if (turned) { var sw = px; px = -py; py = sw; }
        out[k] = px + dx; out[k + 1] = py + dy; out[k + 2] = p[k + 2];
      }
      parts.push(out); total += p.length;
      if (t.h > maxH) maxH = t.h;
      placed.push({ name: t.c.name || null, x: +dx.toFixed(2), y: +dy.toFixed(2),
                    w: +w.toFixed(2), d: +d.toFixed(2), turned: turned,
                    tilt: t.tilt, supports: t.supports });
      cx += w + gap; rowD = Math.max(rowD, d);
    });

    var all = new Float32Array(total), at = 0;
    parts.forEach(function (p) { all.set(p, at); at += p.length; });

    var zLimit = anySupport ? BED.zSupported : BED.zFlat;
    var issues = [];
    if (maxH > zLimit) issues.push('the tallest cap on this plate stands ' +
      maxH.toFixed(1) + ' mm and the volume allows ' + zLimit);
    if (left.length) issues.push(left.length + ' cap' + (left.length > 1 ? 's' : '') +
      ' did not fit and need another run');

    return {
      positions: all, triangles: all.length / 9,
      placed: placed, leftOver: left.length, notPlaced: left,
      gapMm: gap, supports: anySupport,
      plateHeightMm: +maxH.toFixed(2), zLimitMm: zLimit,
      /* Print time is height-only, so this is what a plate actually costs. */
      layers: Math.ceil(maxH / (o.layerMm || 0.05)),
      ok: !issues.length, issues: issues,
      runs: 1 + (placed.length ? Math.ceil(left.length / placed.length) : left.length)
    };
  }

  /* Will this whole set fit, and in how many runs? Answers the question an
     artisan set actually raises - not "does one cap fit" but "can I make the
     six I want, and how many times do I come back to the machine". */
  function planSet(caps, opts) {
    var remaining = (caps || []).slice(), runs = [], guard = 0;
    while (remaining.length && guard++ < 64) {
      var r = layout(remaining, opts);
      if (!r.placed.length) break;              // nothing fits; stop rather than spin
      runs.push({ caps: r.placed.length, layers: r.layers,
                  heightMm: r.plateHeightMm, supports: r.supports });
      remaining = r.notPlaced;
    }
    return { runs: runs.length, perRun: runs, stranded: remaining.length,
             totalLayers: runs.reduce(function (a, r) { return a + r.layers; }, 0) };
  }

  /* ---- what it costs ----------------------------------------------------
     The argument for making a cap instead of buying one is mostly this number,
     so it is computed from the mesh rather than estimated from the bounding
     box: the divergence theorem over a closed surface gives the exact volume,
     and the cap is hollow, so a bounding-box guess would be out by a factor of
     three or four.

     Resin prices are per litre and vary enormously; the default here is a
     mid-range tough resin. Supports and the raft are added as a fraction
     because their volume depends on the slicer's settings, not on this mesh. */
  function volumeMm3(positions, from, to) {
    var v = 0, lo = from == null ? 0 : from, hi = to == null ? positions.length : to;
    for (var i = lo; i < hi; i += 9) {
      var ax=positions[i],   ay=positions[i+1], az=positions[i+2],
          bx=positions[i+3], by=positions[i+4], bz=positions[i+5],
          cx=positions[i+6], cy=positions[i+7], cz=positions[i+8];
      v += (ax*(by*cz - bz*cy) - ay*(bx*cz - bz*cx) + az*(bx*cy - by*cx)) / 6;
    }
    return Math.abs(v);
  }

  /* The resin a SEATED cap costs, which is not the sum of its two solids.

     A cap with a figure on it is deliberately two overlapping closed shells -
     keycap-sculpt's own check() says so: "the cap and the sculpt are two
     overlapping solids; the slicer rasterises them as a union". The divergence
     theorem over all of it therefore counts the seated part of the figure
     TWICE, while the printer pays for it once. Measured on an XDA R3 1u with a
     13 mm sculpt seated 1.6 mm deep, the bill was over by the whole buried
     plug.

     Each shell is summed on its own and taken absolute first - so a sculpt that
     arrived wound inside out adds instead of cancelling the cap - and the
     overlap is then taken off. The overlap is estimated as the sculpt's own
     footprint times how far it is buried, which is exact for the common case
     (a figure with a flat-ish base sunk into the face) and conservative
     otherwise: it is the plug the seat cut, not a bounding box. */
  function seatedVolumeMm3(cap) {
    var p = cap.positions;
    if (!cap.capTriangles || cap.capTriangles * 9 >= p.length)
      return volumeMm3(p);
    var split = cap.capTriangles * 9;
    var vCap = volumeMm3(p, 0, split);
    var vSculpt = volumeMm3(p, split, p.length);
    var buried = Math.max(0, cap.seatDepth || 0);
    var foot = cap.sculptMm ? Math.max(0, cap.sculptMm.x) * Math.max(0, cap.sculptMm.y) : 0;
    var overlap = Math.min(vSculpt, foot * buried);
    return Math.max(0, vCap + vSculpt - overlap);
  }

  function costOf(cap, opts) {
    var o = opts || {};
    var perLitre = o.resinPerLitre == null ? 45 : o.resinPerLitre;   // currency per L
    var mm3 = cap.capTriangles ? seatedVolumeMm3(cap) : volumeMm3(cap.positions);
    var supportFrac = (cap.printPlan && cap.printPlan.supports) ? (o.supportFrac == null ? 0.35 : o.supportFrac) : 0;
    var ml = mm3 / 1000 * (1 + supportFrac);
    return {
      volumeMm3: +mm3.toFixed(1),
      resinMl: +ml.toFixed(3),
      supportsAdd: supportFrac,
      cost: +(ml / 1000 * perLitre).toFixed(3),
      perLitre: perLitre,
      /* An artisan cap sells for a lot more than this, which is the point. */
      note: 'resin only - the machine time is the other half'
    };
  }

  /* ---- the tuning print --------------------------------------------------
     Several stems, each slot a little wider than the last. Print it, try a
     switch in each, keep the first that clicks on without force, then set
     mx.slotClearance to that slot minus crossWide. This is how the number gets
     found; assuming it is how twenty caps come out unusable.

     ⚠️ THIS USED TO BUILD A PART THAT COULD NOT BE PRINTED, and it is the one
     function in the file where that is unforgivable - it is the only thing
     standing between a guessed slotClearance and twenty ruined caps.

     It laid 18 mm caps in a line at a 10 mm pitch. Two things wrong with that,
     both fatal and neither visible in a triangle count. The caps INTERPENETRATE
     by 8 mm, so the slicer unions them into one slab of plastic with five holes
     buried in it - you cannot get a switch in, let alone judge the fit. And the
     line came to 58 mm on a 40.8 mm bed, so the slicer would have refused it
     anyway. Both were found by measuring the bounding box of what came out and
     comparing it to BED, which is now an assertion rather than an afterthought.

     So: a real pitch (the cap plus a finger's worth of gap), a grid packed into
     the bed the long way first, and a hard check at the end. And when the range
     asks for more coupons than the bed holds, the STEP is widened to cover the
     same range with the number that fit - a coarser answer you can print beats
     a precise one you cannot. What it will not do is hand back a part that does
     not fit and let the printer be the one to say so. */
  function stemTestComb(from, to, step, opts) {
    var o = opts || {};
    var profile = o.profile || 'TEST';
    var sizeU = o.sizeU || 1;
    var gap = o.gapMm == null ? 1.6 : o.gapMm;     // enough to get a fingernail in
    var bed = o.bed || BED;

    /* A coupon, not a cap. An 18 mm keycap leaves room for two on this bed and
       a two-step fit comb answers nothing; an 11 mm coupon tiles six. */
    var coupon = profile === 'TEST' ? (o.couponMm || 11) : 0;
    var w = coupon || capWidth(sizeU), d = coupon || DEPTH;
    var pitchX = w + gap, pitchY = d + gap;
    /* The bed's own edge is not usable - the mask's first and last columns are
       the least even on any MSLA machine - so keep a margin off each side. */
    var margin = o.marginMm == null ? 1.0 : o.marginMm;
    var cols = Math.max(1, Math.floor((bed.x - 2 * margin + gap) / pitchX));
    var rows = Math.max(1, Math.floor((bed.y - 2 * margin + gap) / pitchY));
    var room = cols * rows;

    var want = Math.max(1, Math.round((to - from) / step) + 1);
    var n = Math.min(want, room);
    /* Cover the SAME range with however many fit, rather than truncating it -
       a comb that stops before the answer is worse than a coarse one. */
    var useStep = n > 1 ? (to - from) / (n - 1) : 0;

    var s = new Soup(), stems = [], i, j;
    for (i = 0; i < n; i++) {
      var slot = from + useStep * i;
      var one = build({
        profile: profile, sizeU: sizeU, topGrid: o.topGrid || 9,
        widthMm: coupon || undefined, depthMm: coupon || undefined,
        mx: Object.assign({}, MX, o.mx || {}, { slotClearance: slot - MX.crossWide })
      });
      var col = i % cols, row = Math.floor(i / cols);
      var ox = col * pitchX, oy = row * pitchY;
      var q = one.positions;
      for (j = 0; j < q.length; j += 9) {
        s.tri([q[j]+ox, q[j+1]+oy, q[j+2]],
              [q[j+3]+ox, q[j+4]+oy, q[j+5]],
              [q[j+6]+ox, q[j+7]+oy, q[j+8]]);
      }
      stems.push({ index: i + 1, x: +ox.toFixed(2), y: +oy.toFixed(2),
                   col: col + 1, row: row + 1, slotMm: +slot.toFixed(3),
                   clearanceMm: +(slot - MX.crossWide).toFixed(3) });
    }

    var positions = s.toFloat32();
    var mn = [1e9, 1e9, 1e9], mx2 = [-1e9, -1e9, -1e9];
    for (i = 0; i < positions.length; i += 3)
      for (j = 0; j < 3; j++) {
        var v = positions[i + j];
        if (v < mn[j]) mn[j] = v;
        if (v > mx2[j]) mx2[j] = v;
      }
    var sizeMm = { x: +(mx2[0]-mn[0]).toFixed(2), y: +(mx2[1]-mn[1]).toFixed(2),
                   z: +(mx2[2]-mn[2]).toFixed(2) };
    /* The assertion the old one did not have. If this ever throws the layout
       is wrong, and a throw here is a hundred times cheaper than a failed
       print and a still-unknown clearance. */
    if (sizeMm.x > bed.x || sizeMm.y > bed.y)
      throw new Error('keycap: the fit comb came out ' + sizeMm.x + ' × ' + sizeMm.y +
        ' mm on a ' + bed.x + ' × ' + bed.y + ' mm bed - the layout is wrong');

    var note = n + ' cap' + (n > 1 ? 's' : '') + ', slot ' + from.toFixed(2) +
      ' to ' + (from + useStep * (n - 1)).toFixed(2) + ' mm in ' +
      useStep.toFixed(3) + ' mm steps. They read left to right along the front ' +
      'row first, then the row behind it. Put a switch in each and keep the ' +
      'first that clicks on without force.';
    if (n < want)
      note += ' The ' + step + ' mm step you asked for needs ' + want +
        ' caps and the bed holds ' + room + ', so the step was widened to cover ' +
        'the whole range in one print.';

    return { positions: positions, triangles: s.count(), stems: stems,
             sizeMm: sizeMm, cols: cols, rows: rows, perPlate: room,
             stepMm: +useStep.toFixed(4), capWidthMm: +w.toFixed(2),
             couponMm: coupon || null,
             fitsBed: true, note: note };
  }

  root.keycap = {
    MX: MX, PROFILES: PROFILES, UNIT: UNIT, DEPTH: DEPTH, BED: BED, PIXEL_MM: PIXEL_MM,
    capWidth: capWidth, build: build, orientForPrint: orientForPrint,
    seatedVolumeMm3: seatedVolumeMm3, usableBed: usableBed,
    gridForFace: gridForFace,
    orientAsPrinted: orientAsPrinted, mouthDown: mouthDown,
    validate: validate, fits: fits, tiltFit: tiltFit, perPlate: perPlate,
    layout: layout, planSet: planSet, volumeMm3: volumeMm3, costOf: costOf,
    raisedLean: raisedLean, leanPlan: leanPlan,
    stemTestComb: stemTestComb
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.keycap;
})(typeof window !== 'undefined' ? window : globalThis);
