/* Scaling and naming, for anything that arrives as a raw mesh.
 *
 * Both of these were done by hand, badly, during one long session:
 *   - an AI export arrived 1000x too large and the scale was worked out with a
 *     calculator, twice, wrongly the first time
 *   - the send tool produced "DreamerFla_SL1_005_8_2026_09_13_22_39_36", which
 *     carries every fact you want at slice time and none you want three days
 *     later when you are hunting for the good one
 *
 * No DOM, no imports - scripts/dev/test_model_tools.mjs runs it in node.
 */

(function (root) {
  'use strict';

  /* ---- the machine ------------------------------------------------------
     Kept here as data rather than scattered through the callers. The two
     heights are NOT the same number and confusing them is what made a 55 mm
     model fail to slice: supports reserve a lift below the part, a flat base
     does not. */
  var VOLUME = {
    x: 40.8, y: 30.6,
    zSupported: 52.0,   // measured, not assumed: 53 failed to slice, 52 passed
    zFlat: 58.0,        // base sits on the plate, only a thin pad below
    pixelMm: 40.8 / 320 // 0.1275 mm - nothing finer than this can print
  };

  function bbox(size) {
    return { x: Math.abs(size.x || 0), y: Math.abs(size.y || 0), z: Math.abs(size.z || 0) };
  }

  /* ---- AUTO scale -------------------------------------------------------
     Two jobs people confuse:
       fit    - shrink until it fits. Never enlarges.
       fill   - scale (up OR down) until it just touches the tightest wall.
     An AI export usually needs ENLARGING by 1000x, so "fit" alone silently
     leaves it microscopic - it already fits. */
  function autoScale(size, opts) {
    var o = opts || {};
    var s = bbox(size);
    if (!(s.x > 0 && s.y > 0 && s.z > 0)) return { ok: false, why: 'model has no size' };

    var flat = !!o.flatBase;
    var margin = (o.margin == null) ? 0.9 : o.margin;   // keep off the walls
    var zMax = (flat ? VOLUME.zFlat : VOLUME.zSupported);

    var byX = (VOLUME.x * margin) / s.x;
    var byY = (VOLUME.y * margin) / s.y;
    var byZ = (zMax * margin) / s.z;
    var limit = Math.min(byX, byY, byZ);
    var axis = (limit === byX) ? 'X' : (limit === byY) ? 'Y' : 'Z';

    var scale = (o.mode === 'fit') ? Math.min(1, limit) : limit;
    return {
      ok: true,
      scale: scale,
      limitedBy: axis,
      fitsAlready: limit >= 1,
      result: { x: s.x * scale, y: s.y * scale, z: s.z * scale },
      zCeiling: zMax,
      note: flat
        ? 'base flat on the plate - the full ' + zMax + ' mm is available'
        : 'on supports - ' + zMax + ' mm, the rest is the support lift'
    };
  }

  /* ---- MANUAL scale -----------------------------------------------------
     Three ways people actually say it: a percentage, a target height, or a
     target longest-edge. All three return the same shape, and all three report
     whether the answer still fits rather than letting the slicer refuse later. */
  function manualScale(size, want) {
    var s = bbox(size);
    if (!(s.x > 0 && s.y > 0 && s.z > 0)) return { ok: false, why: 'model has no size' };
    var scale;
    if (want.percent != null)      scale = want.percent / 100;
    else if (want.heightMm != null) scale = want.heightMm / s.z;
    else if (want.longestMm != null) scale = want.longestMm / Math.max(s.x, s.y, s.z);
    else return { ok: false, why: 'give percent, heightMm or longestMm' };
    if (!(scale > 0) || !isFinite(scale)) return { ok: false, why: 'that scale is not a number' };

    var r = { x: s.x * scale, y: s.y * scale, z: s.z * scale };
    var zMax = want.flatBase ? VOLUME.zFlat : VOLUME.zSupported;
    var over = [];
    if (r.x > VOLUME.x) over.push('X by ' + (r.x - VOLUME.x).toFixed(1) + ' mm');
    if (r.y > VOLUME.y) over.push('Y by ' + (r.y - VOLUME.y).toFixed(1) + ' mm');
    if (r.z > zMax)     over.push('Z by ' + (r.z - zMax).toFixed(1) + ' mm');

    return {
      ok: true, scale: scale, result: r, fits: over.length === 0,
      over: over,
      why: over.length ? ('too big: ' + over.join(', ')) : ''
    };
  }

  /* Detail you can actually print, at a given printed size. Answers the
     question "is this mesh finer than the machine?" honestly instead of
     chasing triangle counts. */
  function detailAdvice(resultSize, triangles) {
    var px = VOLUME.pixelMm;
    var msg = 'pixel is ' + (px * 1000).toFixed(0) + ' microns - features finer than that cannot print';
    var tooFine = triangles && resultSize.z > 0 && (triangles > 400000);
    return {
      pixelMm: px,
      note: msg,
      suggestSimplify: !!tooFine,
      simplifyTo: tooFine ? 300000 : null
    };
  }

  /* ---- SMART RENAME -----------------------------------------------------
     Turns a machine name back into something a person can scan. The send tool
     writes  <model>_<printer>_<layer>_<exposure>_<Y_M_D_H_M_S>  where layer and
     exposure have had their dots stripped by the firmware's own name rule
     (safeModelName keeps only [A-Za-z0-9_-]) - so "005" means 0.05 mm and "8"
     means 8 s. Reading that back is the whole trick. */
  function parseDescribedName(name) {
    if (!name) return null;
    // timestamp is the anchor: six numeric groups at the end
    var m = /^(.*?)_(\d{4})_(\d{2})_(\d{2})_(\d{2})_(\d{2})_(\d{2})$/.exec(name);
    if (!m) return null;
    var head = m[1], date = m[2] + '-' + m[3] + '-' + m[4], time = m[5] + ':' + m[6];
    var bits = head.split('_');
    var model = bits.shift() || 'Model';
    var out = { model: model, date: date, time: time, printer: null, layerMm: null, exposureS: null };
    bits.forEach(function (b) {
      if (/^\d{3}$/.test(b) && out.layerMm == null) out.layerMm = (parseInt(b, 10) / 100).toFixed(2);
      // /100, not /1000: the send tool writes 0.05 as "005" by deleting the
      // dot (the firmware's name rule keeps only [A-Za-z0-9_-]), so the point
      // goes back after the FIRST digit. 005 -> 0.05, 010 -> 0.10.
      else if (/^\d{1,2}$/.test(b) && out.exposureS == null) out.exposureS = parseInt(b, 10);
      else if (out.printer == null) out.printer = b;
    });
    return out;
  }

  /* The suggestion. Short, human, and STILL unique - the date survives as
     day-month, because "Dreamer 0.05" twice in a list is the problem we are
     trying to solve, not the one we want to create. */
  function smartName(name, extra) {
    var p = parseDescribedName(name);
    var e = extra || {};
    var parts = [];
    if (p) {
      parts.push(prettyWords(p.model));
      if (e.heightMm) parts.push(Math.round(e.heightMm) + 'mm');
      if (p.layerMm) parts.push(p.layerMm);
      parts.push(p.date.slice(5).replace('-', ''));   // MMDD
    } else {
      parts.push(prettyWords(name || 'Model'));
      if (e.heightMm) parts.push(Math.round(e.heightMm) + 'mm');
    }
    // The firmware keeps [A-Za-z0-9_-] and 40 chars (safeModelName,
    // src/Import.ino) - so produce something that survives the trip rather
    // than something that looks nice here and arrives truncated.
    var s = parts.join('_').replace(/[^A-Za-z0-9_-]/g, '');
    return s.slice(0, 40) || 'Model';
  }

  // CamelCase / run-together words -> spaced, then re-joined by the caller.
  function prettyWords(s) {
    return String(s)
      .replace(/[-_]+/g, '')
      .replace(/([a-z0-9])([A-Z])/g, '$1$2');
  }

  root.modelTools = {
    VOLUME: VOLUME,
    autoScale: autoScale,
    manualScale: manualScale,
    detailAdvice: detailAdvice,
    parseDescribedName: parseDescribedName,
    smartName: smartName
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.modelTools;
})(typeof window !== 'undefined' ? window : globalThis);
