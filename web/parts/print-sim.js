/* How long will it take, and will the resin last.
 *
 * NOT an ESP32 emulator. The print loop is deterministic arithmetic - exposure,
 * lift, drop, settle, repeated per layer - and every number it uses lives in
 * the resin profile. Emulating the chip would model the wrong thing; the wait
 * is mechanical, not computational.
 *
 * Calibrated against a real run rather than assumed:
 *   32 mm diorama, 640 layers, 0.05 mm, Anycubic WW HD Gray profile
 *   (35 s base x 6, 14 s regular, 5 transition), measured 4h 01m remaining at
 *   layer 9 -> about 22.9 s per regular layer end to end.
 * The model reproduces that; scripts/dev/test_print_sim.mjs asserts it.
 *
 * The gap between "exposure + travel" and the measured 22.9 s is real overhead
 * the firmware spends per layer - reading and decoding the PNG off SD, pushing
 * it to the mask LCD, the settle waits around each move. It is carried as one
 * measured constant instead of being invented term by term, because a made-up
 * breakdown that happens to sum correctly is worse than an honest fudge factor.
 */

(function (root) {
  'use strict';

  /* FITTED to two real runs, not guessed. A first guess of 3.6 s overshot both
     by ~11%, which the tests caught. Solving from the printer's own reported
     totals - 640 layers in 4h03m and 1180 in 7h32m, same profile - puts it
     near 1 s. That is PNG read+decode off SD, the push to the mask LCD, and
     the settle waits, carried as one measured constant rather than invented
     term by term: a made-up breakdown that happens to sum right is worse
     than an honest fudge factor. */
  var PER_LAYER_OVERHEAD_S = 1.0;
  var HOMING_S = 55;                // observed: homing before layer 1

  /* profile: { baseExposure, baseLayers, regularExposure, transitionLayers,
                slowLiftDistance, fastLiftDistance, slowLiftFeedrate,
                fastLiftFeedrate, dropBackFeedrate }
     feedrates are mm/min, distances mm. */
  function layerSeconds(profile, index) {
    var p = profile;
    var base = p.baseLayers || 0;
    var trans = p.transitionLayers || 0;
    var expo;
    if (index <= base) expo = p.baseExposure;
    else if (index <= base + trans) {
      // the firmware ramps base -> regular across the transition layers
      var step = (p.baseExposure - p.regularExposure) / (trans + 1);
      expo = p.baseExposure - step * (index - base);
    } else expo = p.regularExposure;

    var slow = (p.slowLiftDistance || 0), fast = (p.fastLiftDistance || 0);
    var up = (slow / Math.max(p.slowLiftFeedrate || 1, 1)) * 60
           + (fast / Math.max(p.fastLiftFeedrate || 1, 1)) * 60;
    var down = ((slow + fast) / Math.max(p.dropBackFeedrate || 1, 1)) * 60;

    return expo + up + down + PER_LAYER_OVERHEAD_S;
  }

  function estimate(profile, layers, opts) {
    var o = opts || {};
    var total = o.includeHoming === false ? 0 : HOMING_S;
    var perLayer = [];
    for (var i = 1; i <= layers; i++) {
      var s = layerSeconds(profile, i);
      perLayer.push(s);
      total += s;
    }
    var tail = perLayer.length ? perLayer[perLayer.length - 1] : 0;
    return {
      seconds: Math.round(total),
      text: human(total),
      perRegularLayerS: +tail.toFixed(1),
      layers: layers,
      breakdown: {
        homingS: o.includeHoming === false ? 0 : HOMING_S,
        baseLayersS: Math.round(perLayer.slice(0, profile.baseLayers || 0).reduce(add, 0)),
        restS: Math.round(perLayer.slice(profile.baseLayers || 0).reduce(add, 0))
      }
    };
  }
  function add(a, b) { return a + b; }

  function human(sec) {
    sec = Math.max(0, Math.round(sec));
    var h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60);
    if (m === 60) { h++; m = 0; }
    return h ? (h + 'h ' + (m < 10 ? '0' : '') + m + 'm') : (m + 'm');
  }

  /* Will the resin last? Answers the question that actually ends prints, using
     the printer's own stop threshold rather than "is there some left". */
  function resinCheck(needMl, vatMl, stopMl) {
    var left = vatMl - needMl;
    return {
      needMl: +needMl.toFixed(2),
      vatMl: +vatMl.toFixed(2),
      leftMl: +left.toFixed(2),
      stopMl: stopMl,
      willFinish: left > stopMl,
      shortByMl: left > stopMl ? 0 : +(stopMl - left).toFixed(2),
      advice: left > stopMl
        ? 'Finishes with ' + left.toFixed(1) + ' ml to spare.'
        : 'Will hit the low-resin stop before the end - top the vat up by about '
          + (stopMl - left + 1).toFixed(0) + ' ml first.'
    };
  }

  root.printSim = {
    estimate: estimate, layerSeconds: layerSeconds,
    resinCheck: resinCheck, human: human,
    PER_LAYER_OVERHEAD_S: PER_LAYER_OVERHEAD_S
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.printSim;
})(typeof window !== 'undefined' ? window : globalThis);
