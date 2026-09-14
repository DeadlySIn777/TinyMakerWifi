/* Legends for the keycap engine: signed-distance shapes, turned into the same
 * height field a generated skin uses. One mechanism, two sources.
 *
 * DRAWN AS OBJECTS, NOT SYMBOLS. The first pass of these was a set of generic
 * outline pictograms and they looked it. The item art these are modelled on is
 * a solid thing with its construction showing - webbing, a zip seam, a cross
 * patch sewn into a square, a carry handle - and that happens to be the right
 * call for a printer too: a filled body with cut-outs holds its edges at 127.5
 * microns, where a 0.4 mm outline stroke turns to mush.
 *
 * Order matters. Fills union, cuts subtract from everything listed before
 * them, and a fill after a cut puts material back - which is exactly how the
 * cross sits inside its recessed patch.
 *
 * ⚠️ RAISED COSTS SUPPORTS. Engraved is free: the cap prints top face down, so
 * a recess just starts a few layers late. Raised is not, and not for the reason
 * it looks like - it is not that the legend is fragile, it is that the legend
 * reaches the plate FIRST and the whole top face around it then begins in
 * mid-air with nothing under it. A dish does not save it either: a bump in the
 * middle of a bowl is still an island. So raised means tilting the cap and
 * supporting the leading edge, and keycapPrintPlan() says so with the angle.
 *
 * ⚠️ WHAT SURVIVES AT 127.5 MICRONS. checkLegend() measures the PARAMETERS;
 * checkLegendField() rasterises the finished field at printer resolution and
 * measures what is actually there - every separate blob and every gap between
 * them - because a fill-with-cut-outs has no stroke width to inspect and the
 * thing that fails is nearly always the gap, not the line.
 *
 * Coordinates are a -1..1 box over the cap's top face, y up. No DOM, no
 * imports - scripts/dev/test_keycap_icons.mjs runs it in node.
 */

(function (root) {
  'use strict';

  var MIN_STROKE_MM = 0.45;

  // ---- signed distance primitives ----------------------------------------
  // negative inside, in box units
  function dSeg(px, py, ax, ay, bx, by, halfW) {
    var vx = bx - ax, vy = by - ay, wx = px - ax, wy = py - ay;
    var len2 = vx*vx + vy*vy;
    var t = len2 > 0 ? Math.max(0, Math.min(1, (wx*vx + wy*vy) / len2)) : 0;
    return Math.hypot(wx - vx*t, wy - vy*t) - halfW;
  }
  function dRRect(px, py, cx, cy, hw, hh, r) {
    var qx = Math.abs(px - cx) - (hw - r), qy = Math.abs(py - cy) - (hh - r);
    return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
  }
  function dCircle(px, py, cx, cy, r) { return Math.hypot(px - cx, py - cy) - r; }

  function rot(px, py, cx, cy, deg) {
    var a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
    var x = px - cx, y = py - cy;
    return [x*c + y*s + cx, -x*s + y*c + cy];
  }

  function prim(s, px, py) {
    var x = px, y = py;
    if (s.rot) { var r = rot(px, py, s.rx || 0, s.ry || 0, s.rot); x = r[0]; y = r[1]; }
    if (s.t === 'seg')      return dSeg(x, y, s.a[0], s.a[1], s.b[0], s.b[1], s.w/2);
    if (s.t === 'rect')     return dRRect(x, y, s.c[0], s.c[1], s.hw, s.hh, s.r || 0);
    if (s.t === 'rectline') return Math.abs(dRRect(x, y, s.c[0], s.c[1], s.hw, s.hh, s.r || 0)) - s.w/2;
    if (s.t === 'circle')   return dCircle(x, y, s.c[0], s.c[1], s.r);
    if (s.t === 'ring')     return Math.abs(dCircle(x, y, s.c[0], s.c[1], s.r)) - s.w/2;
    if (s.t === 'path') {
      var e = Infinity;
      for (var k = 0; k < s.pts.length - 1; k++)
        e = Math.min(e, dSeg(x, y, s.pts[k][0], s.pts[k][1], s.pts[k+1][0], s.pts[k+1][1], s.w/2));
      return e;
    }
    if (s.t === 'poly') {   // filled polygon: winding for inside, edges for distance
      var inside = false, ed = Infinity, n = s.pts.length;
      for (var i = 0, j = n - 1; i < n; j = i++) {
        var a = s.pts[i], b = s.pts[j];
        if ((a[1] > y) !== (b[1] > y) && x < (b[0]-a[0]) * (y-a[1]) / (b[1]-a[1]) + a[0]) inside = !inside;
        ed = Math.min(ed, dSeg(x, y, a[0], a[1], b[0], b[1], 0));
      }
      return inside ? -ed : ed;
    }
    return Infinity;
  }

  function evalShape(shape, px, py) {
    var d = Infinity;
    for (var i = 0; i < shape.length; i++) {
      var e = prim(shape[i], px, py);
      if (e === Infinity) continue;
      if (shape[i].cut) d = Math.max(d, -e); else d = Math.min(d, e);
    }
    return d;
  }

  /* Height, not silhouette. The first pass of these was one flat plateau with
     everything either on it or cut clean through to the cap - which reads as an
     outline under diffuse light, because a flat top shades exactly like the
     flat surface beside it. Real item art is an object with detail sunk INTO
     it, so this paints heights in order: a fill paints its level, a cut paints
     a lower one, a later fill paints back up. A groove at 0.45 is still proud
     of the cap, and that difference is what catches the light.

     lvl is a fraction of the legend's full height; a cut with lvl 0 goes all
     the way down to the cap surface. */
  function evalHeight(shape, px, py, soft) {
    var h = 0;
    for (var i = 0; i < shape.length; i++) {
      var sp = shape[i], e = prim(sp, px, py);
      if (e === Infinity) continue;
      var t = 1 - Math.max(0, Math.min(1, (e + soft) / (2 * soft)));
      t = t * t * (3 - 2 * t);
      var lvl = sp.lvl != null ? sp.lvl : (sp.cut ? 0.45 : 1);
      var target = sp.cut ? Math.min(h, lvl) : Math.max(h, lvl);
      h = h * (1 - t) + target * t;
    }
    return h;
  }

  function scaleShape(shape, k, dx, dy) {
    return shape.map(function (s) {
      var o = Object.assign({}, s);
      var P = function (p) { return [p[0]*k + dx, p[1]*k + dy]; };
      if (o.a) { o.a = P(o.a); o.b = P(o.b); }
      if (o.c) o.c = P(o.c);
      if (o.pts) o.pts = o.pts.map(P);
      if (o.rx != null) { o.rx = o.rx*k + dx; o.ry = o.ry*k + dy; }
      if (o.w != null) o.w *= k;
      if (o.r != null) o.r *= k;
      if (o.hw != null) { o.hw *= k; o.hh *= k; }
      return o;
    });
  }

  /* Chaikin corner cutting - lets a shape be authored as a handful of points
     and still read as a curve. */
  function smooth(pts, iters, closed) {
    for (var it = 0; it < (iters || 2); it++) {
      var out = [], n = pts.length;
      if (!closed) out.push(pts[0]);
      var last = closed ? n : n - 1;
      for (var i = 0; i < last; i++) {
        var a = pts[i], b = pts[(i + 1) % n];
        out.push([a[0]*0.75 + b[0]*0.25, a[1]*0.75 + b[1]*0.25]);
        out.push([a[0]*0.25 + b[0]*0.75, a[1]*0.25 + b[1]*0.75]);
      }
      if (!closed) out.push(pts[n-1]); else out.push(out[0]);
      pts = out;
    }
    return pts;
  }

  /* Turn a bitmap into fills. Blocky art wants to stay blocky, and a grid of
     squares is also about the friendliest thing there is to print: every
     feature is one cell wide. A hair of corner rounding keeps two diagonal
     cells from meeting at a knife edge. */
  function pixelIcon(rows, opts) {
    var o = opts || {}, span = o.span == null ? 1.76 : o.span;
    var h = rows.length, w = rows[0].length, cell = span / Math.max(w, h);
    var out = [];
    for (var r = 0; r < h; r++) for (var c = 0; c < w; c++) {
      if (rows[r][c] === ' ' || rows[r][c] === '.') continue;
      out.push({ t: 'rect', r: cell * 0.09,
        c: [(c - (w - 1) / 2) * cell, ((h - 1) / 2 - r) * cell],
        hw: cell / 2 * 1.02, hh: cell / 2 * 1.02 });
    }
    return out;
  }

  // a cross as FILL, for dropping back inside a recessed patch
  function crossFill(cx, cy, size, w) {
    return [{ t: 'rect', c: [cx, cy], hw: size, hh: w/2, r: w*0.2 },
            { t: 'rect', c: [cx, cy], hw: w/2, hh: size, r: w*0.2 }];
  }

  /* ---- the items --------------------------------------------------------
     Each is the object with its construction showing, not a pictogram of it. */
  var ICONS = {
    /* IFAK - the grey pouch: rounded body, zip seam inset from the edge, the
       cross sewn into a square patch, a grab tab at the top. */
    ifak: { name: 'IFAK', shape: [].concat(
      [{ t: 'rect', c: [0, -0.02], hw: 0.62, hh: 0.72, r: 0.17 },
       { t: 'rect', c: [0, 0.76], hw: 0.17, hh: 0.09, r: 0.04 },              // grab tab
       { t: 'rectline', c: [0, -0.02], hw: 0.49, hh: 0.59, r: 0.12, w: 0.095, cut: true, lvl: 0.55 }, // zip
       { t: 'rect', c: [0, 0.02], hw: 0.27, hh: 0.27, r: 0.04, cut: true, lvl: 0.42 }],  // patch recess
      crossFill(0, 0.02, 0.145, 0.105)) },

    /* AFAK - the black MOLLE pouch: webbing rows crossed by stitch columns,
       pull tab off one shoulder. */
    afak: { name: 'AFAK', shape: [
      { t: 'rect', c: [0, -0.02], hw: 0.60, hh: 0.68, r: 0.19 },
      { t: 'rect', c: [0.36, 0.74], hw: 0.13, hh: 0.10, r: 0.04 },            // pull tab
      { t: 'rect', c: [0,  0.30], hw: 0.60, hh: 0.04, r: 0.02, cut: true, lvl: 0.4 },   // webbing
      { t: 'rect', c: [0,  0.00], hw: 0.60, hh: 0.04, r: 0.02, cut: true, lvl: 0.4 },
      { t: 'rect', c: [0, -0.30], hw: 0.60, hh: 0.04, r: 0.02, cut: true, lvl: 0.4 },
      { t: 'rect', c: [-0.28, 0.00], hw: 0.04, hh: 0.52, r: 0.02, cut: true, lvl: 0.4 },// stitching
      { t: 'rect', c: [ 0.28, 0.00], hw: 0.04, hh: 0.52, r: 0.02, cut: true, lvl: 0.4 }] },

    /* Salewa - the hard kit: carry handle, lid seam, cross in a round patch. */
    salewa: { name: 'Salewa', shape: [].concat(
      [{ t: 'rect', c: [0, -0.12], hw: 0.64, hh: 0.60, r: 0.13 },
       { t: 'rect', c: [0, 0.58], hw: 0.25, hh: 0.15, r: 0.07 },              // handle
       { t: 'rect', c: [0, 0.58], hw: 0.13, hh: 0.062, r: 0.03, cut: true, lvl: 0 },
       { t: 'rect', c: [0, 0.14], hw: 0.64, hh: 0.045, r: 0.02, cut: true, lvl: 0.45 },  // lid seam
       { t: 'circle', c: [0, -0.14], r: 0.25, cut: true, lvl: 0.42 }],                   // patch recess
      crossFill(0, -0.14, 0.17, 0.10),
      [{ t: 'rect', c: [0, -0.50], hw: 0.32, hh: 0.075, r: 0.03, cut: true, lvl: 0.4 }]) }, // label

    /* Aseptic bandage - the gauze roll end-on, tail unwinding off it. */
    bandage: { name: 'Bandage', shape: [
      { t: 'poly', pts: [[-0.30, -0.28], [0.42, -0.30], [0.72, -0.72], [-0.12, -0.70]] }, // tail
      { t: 'circle', c: [-0.10, 0.22], r: 0.60 },                            // the roll
      { t: 'ring', c: [-0.10, 0.22], r: 0.38, w: 0.10, cut: true, lvl: 0.5 },
      { t: 'circle', c: [-0.10, 0.22], r: 0.17, cut: true, lvl: 0.1 },       // core
      { t: 'seg', a: [0.06, -0.36], b: [0.52, -0.40], w: 0.09, cut: true, lvl: 0.5 }] },

    /* CALOK-B - the hemostatic sachet: foil packet, serrated top, tear notch,
       a drop struck into the label. */
    hemostat: { name: 'Hemostatic', shape: [
      { t: 'rect', c: [0, -0.08], hw: 0.52, hh: 0.66, r: 0.07 },
      { t: 'poly', cut: true, pts: [[-0.85, 0.42], [-0.52, 0.42], [-0.347, 0.66], [-0.173, 0.42],
                                    [0.00, 0.66], [0.173, 0.42], [0.347, 0.66], [0.52, 0.42],
                                    [0.85, 0.42], [0.85, 1.20], [-0.85, 1.20]] },
      { t: 'circle', c: [0.58, 0.06], r: 0.12, cut: true, lvl: 0 },                   // tear notch
      { t: 'poly', cut: true, lvl: 0.4, pts: smooth([[0, 0.20], [0.25, -0.14], [0.27, -0.35],
                                           [0, -0.49], [-0.27, -0.35], [-0.25, -0.14]], 2, true) }] },

    /* Aluminium splint - the flat strip, part of it still rolled. */
    splint: { name: 'Splint', shape: [
      { t: 'rect', c: [0, 0], hw: 0.29, hh: 0.90, r: 0.26, rot: -14, rx: 0, ry: 0 },
      { t: 'rect', c: [0, 0], hw: 0.17, hh: 0.77, r: 0.15, rot: -14, rx: 0, ry: 0, cut: true, lvl: 0.6 },
      { t: 'circle', c: [0,  0.50], r: 0.093, cut: true, lvl: 0.1, rot: -14, rx: 0, ry: 0 },
      { t: 'circle', c: [0,  0.17], r: 0.093, cut: true, lvl: 0.1, rot: -14, rx: 0, ry: 0 },
      { t: 'circle', c: [0, -0.17], r: 0.093, cut: true, lvl: 0.1, rot: -14, rx: 0, ry: 0 },
      { t: 'circle', c: [0, -0.50], r: 0.093, cut: true, lvl: 0.1, rot: -14, rx: 0, ry: 0 }] },

    /* Analgin - the blister pack, pills punched out of it. */
    pills: { name: 'Painkillers', shape: [
      { t: 'rect', c: [0, 0], hw: 0.60, hh: 0.70, r: 0.11 },
      { t: 'circle', c: [-0.27, 0.42], r: 0.155, cut: true, lvl: 0.5 },
      { t: 'circle', c: [ 0.27, 0.42], r: 0.155, cut: true, lvl: 0.5 },
      { t: 'circle', c: [-0.27, 0.00], r: 0.155, cut: true, lvl: 0.5 },
      { t: 'circle', c: [ 0.27, 0.00], r: 0.155, cut: true, lvl: 0.5 },
      { t: 'circle', c: [-0.27, -0.42], r: 0.155, cut: true, lvl: 0.5 },
      { t: 'circle', c: [ 0.27, -0.42], r: 0.155, cut: true, lvl: 0.5 }] },

    /* Creeper. Straight off the texture - and the one icon here that needs no
       compromise at all for the printer, because it is already made of squares
       1.2 mm on a side. */
    creeper: { name: 'Creeper', shape: pixelIcon([
      '........',
      '.XX..XX.',
      '.XX..XX.',
      '...XX...',
      '..XXXX..',
      '..XXXX..',
      '..X..X..',
      '........']) },

    /* A plain cross, for anything else medical. */
    cross: { name: 'Cross', shape: [
      { t: 'rect', c: [0, 0], hw: 0.66, hh: 0.21, r: 0.05 },
      { t: 'rect', c: [0, 0], hw: 0.21, hh: 0.66, r: 0.05 }] }
  };

  /* Digits as stroke paths in a -1..1 box. Hand-placed rather than a font,
     because a font would have to be embedded and these are ten glyphs. */
  var DIGITS = {
    '1': [[[-0.30, 0.44], [0.02, 0.80], [0.02, -0.80]], [[-0.40, -0.80], [0.44, -0.80]]],
    '2': [[[-0.46, 0.48], [-0.20, 0.78], [0.20, 0.78], [0.46, 0.48], [0.40, 0.16],
           [-0.46, -0.62], [-0.46, -0.80], [0.48, -0.80]]],
    '3': [[[-0.42, 0.54], [0.02, 0.80], [0.44, 0.50], [0.10, 0.06]],
          [[0.10, 0.06], [0.48, -0.28], [0.22, -0.72], [-0.34, -0.66]]],
    '4': [[[0.22, 0.80], [-0.48, -0.16], [0.50, -0.16]], [[0.22, 0.80], [0.22, -0.80]]],
    '5': [[[0.44, 0.80], [-0.36, 0.80], [-0.42, 0.10], [0.04, 0.24], [0.44, -0.10],
           [0.30, -0.60], [-0.16, -0.80], [-0.44, -0.58]]],
    '6': [[[0.36, 0.72], [0.00, 0.80], [-0.36, 0.44], [-0.44, -0.30], [-0.10, -0.78],
           [0.32, -0.62], [0.44, -0.22], [0.10, 0.08], [-0.36, -0.02]]],
    '7': [[[-0.44, 0.80], [0.46, 0.80], [-0.06, -0.80]]],
    '8': [[[0.00, 0.80], [0.40, 0.54], [0.02, 0.06], [0.44, -0.30], [0.04, -0.78],
           [-0.42, -0.34], [0.02, 0.06], [-0.38, 0.52], [0.00, 0.80]]],
    '9': [[[-0.34, -0.70], [0.02, -0.80], [0.38, -0.44], [0.44, 0.30], [0.10, 0.78],
           [-0.32, 0.62], [-0.44, 0.22], [-0.10, -0.08], [0.36, 0.02]]],
    '0': [[[0.00, 0.80], [0.42, 0.40], [0.42, -0.40], [0.00, -0.80], [-0.42, -0.40],
           [-0.42, 0.40], [0.00, 0.80]]]
  };

  /* ---- real type, when there is a browser to draw it -------------------
     The digits below are polylines I drew by hand, and they look it - at any
     mesh resolution a hand-plotted 7 is a hand-plotted 7. A browser already
     has properly hinted typefaces, so the glyph is rasterised once to an
     offscreen canvas and its coverage becomes the height field. Real
     typography, no font file to embed, and it falls back to the polylines in
     node where there is no canvas.

     Coverage rather than a threshold: the canvas antialiases the edge, and
     using that ramp directly gives a clean shoulder instead of a staircase. */
  function glyphRelief(text, opts) {
    var o = opts || {};
    var doc = root.document;
    if (!doc || !doc.createElement) return null;
    var N = o.samples || 256;
    var c = doc.createElement('canvas');
    c.width = N; c.height = N;
    var g = c.getContext('2d', { willReadFrequently: true });
    if (!g) return null;
    g.clearRect(0, 0, N, N);
    g.fillStyle = '#fff';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    var weight = o.weight || 700;
    var family = o.family || 'ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif';
    // shrink until the glyph fits the box with a margin
    var px = N * 0.82;
    for (var tries = 0; tries < 8; tries++) {
      g.font = weight + ' ' + px + 'px ' + family;
      var m = g.measureText(text);
      var w = m.width;
      var h = (m.actualBoundingBoxAscent || px * 0.7) + (m.actualBoundingBoxDescent || px * 0.2);
      if (w <= N * 0.86 && h <= N * 0.86) break;
      px *= Math.min(N * 0.86 / Math.max(w, 1), N * 0.86 / Math.max(h, 1)) * 0.98;
    }
    g.font = weight + ' ' + px + 'px ' + family;
    var mm = g.measureText(text);
    var asc = mm.actualBoundingBoxAscent || px * 0.7;
    var desc = mm.actualBoundingBoxDescent || px * 0.2;
    g.fillText(text, N / 2, N / 2 + (asc - desc) / 2);
    var data;
    try { data = g.getImageData(0, 0, N, N).data; } catch (e) { return null; }
    var cov = new Float32Array(N * N);
    for (var i = 0, k = 3; i < cov.length; i++, k += 4) cov[i] = data[k] / 255;

    var depth = o.depth == null ? 0.55 : o.depth;
    var raised = !!o.raised;
    var f = function (u, v) {
      var x = (u + 1) / 2 * (N - 1), y = (1 - v) / 2 * (N - 1);
      if (x < 0 || y < 0 || x > N - 1 || y > N - 1) return 0;
      var x0 = x | 0, y0 = y | 0, x1 = Math.min(N - 1, x0 + 1), y1 = Math.min(N - 1, y0 + 1);
      var fx = x - x0, fy = y - y0;
      var a = cov[y0*N+x0]*(1-fx)*(1-fy) + cov[y0*N+x1]*fx*(1-fy) +
              cov[y1*N+x0]*(1-fx)*fy     + cov[y1*N+x1]*fx*fy;
      if (a <= 0.02) return 0;
      var t = a * a * (3 - 2 * a);
      return raised ? -depth * t : depth * t;
    };
    f.depth = depth; f.raised = raised; f.parts = []; f.glyph = text;
    return f;
  }

  function digitShape(ch, w) {
    var paths = DIGITS[String(ch)];
    if (!paths) return [];
    return paths.map(function (pts) {
      return { t: 'path', pts: pts.length > 2 ? smooth(pts, 2, false) : pts, w: w };
    });
  }

  /* ---- the relief -------------------------------------------------------
     Returns the function keycap.build() wants. Positive output is deeper INTO
     the cap, so engraved is positive and raised is negative.

     The digit is its own group unioned on top of the icon, NOT part of it, so
     a cut inside the icon cannot eat into it. */
  function makeRelief(spec, opts) {
    var o = opts || {};
    var depth = o.depth == null ? 0.45 : o.depth;
    var raised = !!o.raised;
    var soft = o.soft == null ? 0.012 : o.soft;   // box units, about one pixel
    var groups = [];

    if (spec.icon) {
      var ic = ICONS[spec.icon];
      if (!ic) throw new Error('keycap-icons: no icon "' + spec.icon + '" (have ' +
        Object.keys(ICONS).join(', ') + ')');
      var k = spec.iconScale == null ? 0.74 : spec.iconScale;
      groups.push(scaleShape(ic.shape, k, spec.iconX || 0, spec.iconY == null ? -0.17 : spec.iconY));
    }
    if (spec.digit != null && spec.digit !== '') {
      var ds = spec.digitScale == null ? 0.31 : spec.digitScale;
      groups.push(scaleShape(digitShape(spec.digit, 0.235), ds,
        spec.digitX == null ? -0.65 : spec.digitX,
        spec.digitY == null ? 0.67 : spec.digitY));
    }
    if (spec.shape) groups.push(spec.shape);
    groups = groups.filter(function (g) { return g && g.length; });
    if (!groups.length) return null;

    /* ROUND THINGS HAVE TO STAY ROUND. The relief contract normalises x and y
       INDEPENDENTLY - u = x/(topW/2), v = y/(topD/2) - so on any cap wider than
       it is deep, a shape that is square in (u,v) comes out topW/topD times
       wider than it is tall. On a 6.25u spacebar that is a factor of six: the
       cross in the first-aid icon became a letter box, and the corner digit
       became a smear.

       keycap-braille works in real millimetres and keycap-skin takes one
       uniform scale k = fit * min(topW/su, topD/sv) for exactly this reason.
       This path never did. Undo the stretch here, where the artwork is
       evaluated, by shrinking the LONG axis' input so the shape occupies the
       same millimetres either way and stays centred. topW and topD are handed
       in by build(); when they are not (the 1u preview path, where they are
       equal anyway) nothing changes. */
    var f = function (u, v, topW, topD) {
      var h = 0;
      if (topW && topD) {
        if (topW > topD) u *= topW / topD;
        else if (topD > topW) v *= topD / topW;
      }
      if (u < -1 || u > 1 || v < -1 || v > 1) return 0;   // off the artwork
      for (var g = 0; g < groups.length; g++) h = Math.max(h, evalHeight(groups[g], u, v, soft));
      return raised ? -depth * h : depth * h;
    };
    f.groups = groups;
    f.parts = groups.reduce(function (a, g) { return a.concat(g); }, []);
    f.depth = depth;
    f.raised = raised;
    return f;
  }

  /* ---- will it survive the printer? -------------------------------------
     The parameter check: every stroke width, in mm on this cap. Cheap, and
     blind to fills and cut-outs - use checkLegendField for those. */
  function checkLegend(relief, topWmm, opts) {
    var o = opts || {};
    var floor = o.minStrokeMm || MIN_STROKE_MM;
    var px = o.pixelMm || (40.8 / 320);
    if (!relief || !relief.parts) return { ok: true, strokes: [], issues: [] };
    var half = topWmm / 2, issues = [], strokes = [];
    relief.parts.forEach(function (s, i) {
      if (s.w == null) return;
      var mm = s.w * half;
      strokes.push({ i: i, type: s.t, cut: !!s.cut, mm: +mm.toFixed(3), px: +(mm / px).toFixed(1) });
      if (mm < floor) issues.push('a ' + (s.cut ? 'cut ' : '') + s.t + ' is ' + mm.toFixed(2) +
        ' mm (' + (mm / px).toFixed(1) + ' pixels) - under the ' + floor + ' mm that holds its shape');
    });
    if (Math.abs(relief.depth) < 0.2) issues.push('a ' + Math.abs(relief.depth).toFixed(2) +
      ' mm legend is shallower than four layers and will barely show');
    return { ok: !issues.length, strokes: strokes, issues: issues,
             thinnestMm: strokes.length ? Math.min.apply(null, strokes.map(function (s) { return s.mm; })) : null };
  }

  /* ---- the real check ---------------------------------------------------
     Rasterise the finished field at printer resolution and measure what is
     actually on the mask: the narrowest width of every separate blob, and of
     every gap between them. This is the check that matters, because a filled
     icon with cut-outs has no stroke to inspect and what fails is nearly
     always the gap between two cuts, not a line.

     Distance transform is the two-pass 3-4 chamfer; blobs come from a flood
     fill. Both are cheap at this size - a 13 mm face is about 200 samples. */
  function checkLegendField(relief, topWmm, topDmm, opts) {
    var o = opts || {};
    var px = o.pixelMm || (40.8 / 320);
    var floor = o.minStrokeMm || MIN_STROKE_MM;
    if (!relief) return { ok: true, issues: [], blobs: 0 };
    var sub = o.samplesPerPixel || 2;
    var nx = Math.max(16, Math.min(400, Math.round(topWmm / px * sub)));
    var ny = Math.max(16, Math.min(400, Math.round((topDmm || topWmm) / px * sub)));
    var mmPer = topWmm / nx;
    var on = new Uint8Array(nx * ny), i, x, y;
    var thresh = Math.abs(relief.depth) * 0.5;
    for (y = 0; y < ny; y++) for (x = 0; x < nx; x++) {
      var u = (x + 0.5) / nx * 2 - 1, v = 1 - (y + 0.5) / ny * 2;
      on[y*nx + x] = Math.abs(relief(u, v)) >= thresh ? 1 : 0;
    }

    function dt(mask) {                      // chamfer distance to nearest 0
      var D = new Float32Array(nx * ny), BIG = 1e9, k, d;
      for (i = 0; i < D.length; i++) D[i] = mask[i] ? BIG : 0;
      for (y = 0; y < ny; y++) for (x = 0; x < nx; x++) {
        k = y*nx + x; d = D[k];
        if (y > 0)             d = Math.min(d, D[k-nx] + 3);
        if (x > 0)             d = Math.min(d, D[k-1] + 3);
        if (y > 0 && x > 0)    d = Math.min(d, D[k-nx-1] + 4);
        if (y > 0 && x < nx-1) d = Math.min(d, D[k-nx+1] + 4);
        D[k] = d;
      }
      for (y = ny-1; y >= 0; y--) for (x = nx-1; x >= 0; x--) {
        k = y*nx + x; d = D[k];
        if (y < ny-1)             d = Math.min(d, D[k+nx] + 3);
        if (x < nx-1)             d = Math.min(d, D[k+1] + 3);
        if (y < ny-1 && x < nx-1) d = Math.min(d, D[k+nx+1] + 4);
        if (y < ny-1 && x > 0)    d = Math.min(d, D[k+nx-1] + 4);
        D[k] = d;
      }
      for (i = 0; i < D.length; i++) D[i] /= 3;
      return D;
    }

    /* Widest point of each connected blob. A blob whose widest point is under
       the floor cannot survive anywhere along its length - that is the one
       worth reporting. */
    function blobWidths(mask) {
      var D = dt(mask), seen = new Uint8Array(nx * ny), out = [], stack = [];
      for (var s = 0; s < mask.length; s++) {
        if (!mask[s] || seen[s]) continue;
        var best = 0, count = 0;
        stack.length = 0; stack.push(s); seen[s] = 1;
        while (stack.length) {
          var k = stack.pop(); count++;
          if (D[k] > best) best = D[k];
          var kx = k % nx, ky = (k - kx) / nx;
          if (kx > 0    && mask[k-1]  && !seen[k-1])  { seen[k-1] = 1;  stack.push(k-1); }
          if (kx < nx-1 && mask[k+1]  && !seen[k+1])  { seen[k+1] = 1;  stack.push(k+1); }
          if (ky > 0    && mask[k-nx] && !seen[k-nx]) { seen[k-nx] = 1; stack.push(k-nx); }
          if (ky < ny-1 && mask[k+nx] && !seen[k+nx]) { seen[k+nx] = 1; stack.push(k+nx); }
        }
        if (count > 3) out.push({ widthMm: +(best * 2 * mmPer).toFixed(3), samples: count });
      }
      return out;
    }

    var marks = blobWidths(on);
    var off = new Uint8Array(nx * ny);
    for (i = 0; i < off.length; i++) off[i] = on[i] ? 0 : 1;
    // the background is a blob too; drop it, keep the gaps inside the artwork
    var gaps = blobWidths(off).filter(function (g) { return g.samples < nx * ny * 0.45; });

    var issues = [];
    var thinMark = marks.length ? Math.min.apply(null, marks.map(function (m) { return m.widthMm; })) : null;
    var thinGap  = gaps.length  ? Math.min.apply(null, gaps.map(function (m) { return m.widthMm; }))  : null;
    if (thinMark !== null && thinMark < floor)
      issues.push('the narrowest feature is ' + thinMark.toFixed(2) + ' mm (' +
        (thinMark / px).toFixed(1) + ' pixels) - under the ' + floor + ' mm that holds its shape');
    if (thinGap !== null && thinGap < floor)
      issues.push('two features are only ' + thinGap.toFixed(2) + ' mm apart (' +
        (thinGap / px).toFixed(1) + ' pixels) and will merge into one blob');
    if (Math.abs(relief.depth) < 0.2)
      issues.push('a ' + Math.abs(relief.depth).toFixed(2) +
        ' mm legend is shallower than four layers and will barely show');

    return { ok: !issues.length, issues: issues, blobs: marks.length, gaps: gaps.length,
             thinnestMarkMm: thinMark, thinnestGapMm: thinGap,
             grid: { nx: nx, ny: ny, mmPerSample: +mmPer.toFixed(4) } };
  }

  /* ---- what a raised legend costs ---------------------------------------
     Raised means the legend touches the plate before the face around it does,
     so that face starts in mid-air. Tilting fixes it: once the cap leans far
     enough that height varies across the face by more than the legend stands
     proud, every layer grows out of the one below and the supports land on the
     leading edge instead of on the artwork. */
  function raisedTilt(relief, prof, topDmm) {
    if (!relief || !relief.raised) return { tilt: 0, supports: false };
    /* Delegates to the engine. This used to compute the angle itself, and the
       result was two implementations of the same physical fact with only one of
       them reaching the plate and the clock. */
    var deg = (root.keycap && root.keycap.raisedLean)
      ? root.keycap.raisedLean(relief.depth, prof && prof.dishDepth, topDmm)
      : Math.max(12, Math.min(35, Math.ceil(
          Math.atan2((Math.abs(relief.depth) + (prof && prof.dishDepth ? prof.dishDepth : 0)) * 1.6,
                     topDmm) * 180 / Math.PI)));
    return { tilt: deg, supports: true,
      why: 'a raised legend reaches the plate before the face around it does, so the cap ' +
           'has to lean at least ' + deg + '° and take supports on its leading edge. ' +
           'Engraved needs none of that.' };
  }

  /* ---- the Tarkov quick-slot set ---------------------------------------- */
  var SETS = {
    tarkovMeds: {
      name: 'Tarkov quick slots',
      profile: 'XDA', row: 'R3', raised: true, depth: 0.55,
      note: 'the 1-6 med binds, numbered in the corner the way the HUD shows them. ' +
            'XDA because it is uniform - no row angle to match - and has the biggest ' +
            'top face of the five to put an item on.',
      keys: [
        { key: '1', icon: 'ifak',     label: 'IFAK' },
        { key: '2', icon: 'salewa',   label: 'Salewa' },
        { key: '3', icon: 'bandage',  label: 'Light bleed' },
        { key: '4', icon: 'hemostat', label: 'Heavy bleed' },
        { key: '5', icon: 'splint',   label: 'Splint' },
        { key: '6', icon: 'pills',    label: 'Painkillers' }
      ]
    }
  };

  root.keycapIcons = {
    ICONS: ICONS, DIGITS: DIGITS, SETS: SETS, MIN_STROKE_MM: MIN_STROKE_MM,
    makeRelief: makeRelief, checkLegend: checkLegend, checkLegendField: checkLegendField,
    evalHeight: evalHeight,
    raisedTilt: raisedTilt,
    evalShape: evalShape, scaleShape: scaleShape, digitShape: digitShape,
    glyphRelief: glyphRelief,
    smooth: smooth, pixelIcon: pixelIcon
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.keycapIcons;
})(typeof window !== 'undefined' ? window : globalThis);
