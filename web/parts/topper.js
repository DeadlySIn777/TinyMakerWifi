/* Decorative removable pencil/marker/stylus topper geometry, in millimetres.
 * The measured socket is owned by this engine; artwork belongs above the roof.
 * Z-up: socket mouth at z=0, socket floor at depth, roof at depth + roofMm.
 * Clearance is added to the full diameter/across-flats measurement, not per side.
 * No DOM, dependencies, generated fit dimensions, or automatic mesh scaling.
 */
(function (root) {
  'use strict';
  var BED = Object.freeze({ x: 40.8, y: 30.6, z: 58 });
  var PRESETS = Object.freeze({
    'pencil-round': Object.freeze({ label: 'Round pencil — 7 mm starting point', shape: 'round', nominalMm: 7, note: 'Measure your pencil with calipers before printing; 7 mm is a starting point.' }),
    'pencil-hex': Object.freeze({ label: 'Hex pencil — 7 mm across-flats starting point', shape: 'hex', nominalMm: 7, note: 'Measure across two opposite flat faces with calipers; 7 mm is a starting point.' }),
    'marker': Object.freeze({ label: 'Marker — enter measured back-end diameter', shape: 'round', note: 'Measure the back end. This decorative topper does not replace an airtight writing-tip cap.' }),
    'apple-stylus': Object.freeze({ label: 'Apple stylus — enter model and measured diameter', shape: 'round', modelRequired: true, note: 'Enter the exact model and measured attachment diameter; no Apple model dimensions are assumed.' }),
    'samsung-stylus': Object.freeze({ label: 'Samsung stylus — enter model and measured diameter', shape: 'round', modelRequired: true, note: 'Enter the exact model and measured attachment diameter; no Samsung model dimensions are assumed.' }),
    'custom': Object.freeze({ label: 'Custom — enter measured size', shape: 'round', note: 'Measure the attachment area with calipers before printing.' })
  });
  function number(v, fallback, label, lo, hi) {
    if (v === undefined) v = fallback;
    if (typeof v !== 'number' || !Number.isFinite(v) || v < lo || v > hi) {
      throw new Error(label + ' must be a finite number from ' + lo + ' to ' + hi + ' mm.');
    }
    return v;
  }
  function build(opts) {
    opts = opts === undefined ? {} : opts;
    if (!opts || typeof opts !== 'object' || Array.isArray(opts)) throw new Error('Enter topper dimensions as an object.');
    var presetName = opts.preset === undefined ? 'pencil-round' : opts.preset;
    var preset = typeof presetName === 'string' && Object.prototype.hasOwnProperty.call(PRESETS, presetName) && PRESETS[presetName];
    if (!preset) throw new Error('Choose a supported topper preset.');
    var shape = opts.socketShape === undefined ? (opts.profile === undefined ? preset.shape : opts.profile) : opts.socketShape;
    if (shape !== 'round' && shape !== 'hex' && shape !== 'oval') throw new Error('Socket shape must be round, hex, or oval.');
    var model = typeof opts.modelLabel === 'string' ? opts.modelLabel.trim() : '';
    if (model.length > 120) throw new Error('Keep the model name to 120 characters or fewer.');
    if (preset.modelRequired && !model) throw new Error('Enter the exact stylus model and its measured attachment diameter.');
    var requested = shape === 'hex' && opts.acrossFlatsMm !== undefined ? opts.acrossFlatsMm : opts.diameterMm;
    var nominal = number(requested, preset.nominalMm, shape === 'hex' ? 'Measured across-flats size' : 'Measured diameter', 0.5, 40);
    var secondAxis = shape === 'oval' ? number(opts.secondAxisMm, undefined, 'Measured second oval axis', 0.5, 40) : nominal;
    var clearance = number(opts.clearanceMm, 0.2, 'Socket clearance', 0, 0.8);
    var depth = number(opts.socketDepthMm, 12, 'Socket depth', 1, 50);
    var wall = number(opts.wallMm, 1.6, 'Nominal wall thickness', 1, 8);
    var roof = number(opts.roofMm, 2, 'Roof thickness', 2, 8);
    var segments = opts.segments === undefined ? 96 : opts.segments;
    if (!Number.isInteger(segments) || segments < 24 || segments > 384 || segments % 12) throw new Error('Use 24–384 segments in multiples of 12.');
    var nominalR = shape === 'hex' ? nominal / Math.sqrt(3) : Math.max(nominal, secondAxis) / 2;
    var opening = nominal + clearance;
    var openingSecond = secondAxis + clearance;
    var innerR = shape === 'hex' ? opening / Math.sqrt(3) : Math.max(opening, openingSecond) / 2;
    // Deliberately independent of clearance: fit adjustments only move socket walls.
    var outerDiameter = number(opts.outerDiameterMm, 2 * (nominalR + wall), 'Outer diameter', 1, 80);
    var outerR = outerDiameter / 2, minWall = outerR - innerR;
    if (minWall < 1 - 1e-9) throw new Error('The socket leaves less than 1 mm of wall. Increase the outer diameter or wall thickness, or reduce clearance.');
    // The top rounding stays entirely above the socket floor and outside its rim.
    var edge = number(opts.edgeRadiusMm, Math.min(0.5, roof / 2, wall * 0.25), 'Top edge radius', 0, 2);
    if (edge > Math.min(roof * 0.75, minWall * 0.75) + 1e-9) throw new Error('Reduce the top edge radius to preserve the roof and socket wall.');
    var height = depth + roof, rings = [], p = [], n = segments;
    function circle(radius, z) {
      var r = [];
      for (var i = 0; i < n; i++) { var t = 2 * Math.PI * i / n; r.push([radius * Math.cos(t), radius * Math.sin(t), z]); }
      return r;
    }
    function socketRing(z) {
      if (shape === 'round') return circle(innerR, z);
      if (shape === 'oval') {
        var ellipse = [];
        for (var i = 0; i < n; i++) { var t = 2 * Math.PI * i / n; ellipse.push([opening / 2 * Math.cos(t), openingSecond / 2 * Math.sin(t), z]); }
        return ellipse;
      }
      var r = [], perSide = n / 6;
      for (var side = 0; side < 6; side++) {
        var a = side * Math.PI / 3, b = (side + 1) * Math.PI / 3;
        var ax = innerR * Math.cos(a), ay = innerR * Math.sin(a), bx = innerR * Math.cos(b), by = innerR * Math.sin(b);
        for (var j = 0; j < perSide; j++) { var f = j / perSide; r.push([ax + f * (bx - ax), ay + f * (by - ay), z]); }
      }
      return r;
    }
    function tri(a, b, c) { p.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]); }
    var outerBottom = circle(outerR, 0), innerBottom = socketRing(0), innerTop = socketRing(depth);
    rings.push(outerBottom, circle(outerR, height - edge));
    if (edge > 0) for (var s = 1; s <= 4; s++) {
      var angle = s * Math.PI / 8;
      rings.push(circle(outerR - edge + edge * Math.cos(angle), height - edge + edge * Math.sin(angle)));
    }
    var outerTop = rings[rings.length - 1];
    for (var ring = 0; ring < rings.length - 1; ring++) for (var i = 0; i < n; i++) {
      var j = (i + 1) % n, lo = rings[ring], hi = rings[ring + 1];
      tri(lo[i], lo[j], hi[j]); tri(lo[i], hi[j], hi[i]);
    }
    for (var i = 0; i < n; i++) {
      var j = (i + 1) % n;
      tri(outerBottom[i], innerBottom[i], innerBottom[j]); tri(outerBottom[i], innerBottom[j], outerBottom[j]);
      tri(innerBottom[i], innerTop[i], innerTop[j]); tri(innerBottom[i], innerTop[j], innerBottom[j]);
      tri([0, 0, depth], innerTop[j], innerTop[i]);
      tri([0, 0, height], outerTop[i], outerTop[j]);
    }
    var positions = new Float32Array(p), lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (var i = 0; i < positions.length; i += 3) for (var k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k], positions[i + k]); hi[k] = Math.max(hi[k], positions[i + k]);
    }
    var size = { x: hi[0] - lo[0], y: hi[1] - lo[1], z: hi[2] - lo[2] }, issues = [];
    if (size.x > BED.x + 1e-5 || size.y > BED.y + 1e-5 || size.z > BED.z + 1e-5) issues.push('This topper exceeds the TinyMaker 40.8 × 30.6 × 58 mm build volume. Reduce its dimensions; socket geometry has not been scaled.');
    return {
      positions: positions, triangles: positions.length / 9, size: size, bounds: { lo: lo, hi: hi },
      socket: { shape: shape, nominalMm: nominal, openingMm: opening, secondAxisMm: secondAxis, openingSecondAxisMm: openingSecond, clearanceMm: clearance, depthMm: depth, minimumWallMm: minWall },
      roofMm: roof, outerDiameterMm: outerDiameter, edgeRadiusMm: edge, modelLabel: model, preset: presetName,
      availableArtHeightMm: Math.max(0, BED.z - height), ok: issues.length === 0, issues: issues,
      notes: [preset.note, 'Clearance adjusts the full socket diameter or across-flats size. Print a plain fit test and adjust from physical feedback.', 'Added artwork and supports must also fit the build volume.']
    };
  }
  var api = { build: build, PRESETS: PRESETS, BED: BED };
  root.topper = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
