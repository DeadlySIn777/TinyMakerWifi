/* Bounded physical sizing for artisan artwork. The caller owns the actual
 * seat / attachment / exact-socket / print-layout checks. This controller
 * changes only requested height and uniform scale; it never edits a mesh,
 * invents a repair, or treats an unresolved check as printable.
 *
 * run({initial:{heightMm,scalePercent,rotationDeg}, evaluate(candidate),
 *      mode:'preserve-height'|'fill', maxHeightMm, minHeightMm:6,
 *      minScalePercent:50, heightStepMm:0, scaleStepPercent:0,
 *      maxEvaluations:12, timeBudgetMs:6000,
 *      signal, isCancelled, onProgress, yieldControl, now, requiredChecks})
 *
 * evaluate returns {checks:[{name,status:'pass'|'fail'|'unresolved',reason?}],
 * score: actual positive uniform geometry scale, metrics?, value?, terminal?}.
 * `value` is retained only for the best passing candidate, never every mesh.
 * `terminal:true` stops a failed search (e.g. an invalid source mesh).
 *
 * The result describes the largest passing candidate TESTED, not an aesthetic
 * judgement or a global optimum. A time budget is checked between evaluations;
 * an individual synchronous geometry check must retain its own work limits.
 */
(function (root) {
  'use strict';

  var REQUIRED_CHECKS = ['geometry', 'attachment', 'socket', 'print-fit'];
  function finite(n) { return typeof n === 'number' && Number.isFinite(n); }
  function copy(c) { return { heightMm:c.heightMm, scalePercent:c.scalePercent, rotationDeg:c.rotationDeg }; }
  function key(c) { return c.heightMm + '/' + c.scalePercent + '/' + c.rotationDeg; }
  function candidate(height, scale, rotation) {
    return Object.freeze({heightMm:height, scalePercent:scale, rotationDeg:rotation});
  }
  function clock() { return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now(); }
  function yieldTask() { return new Promise(function (resolve) { setTimeout(resolve, 0); }); }
  function validateInitial(c) {
    if (!c || !finite(c.heightMm) || c.heightMm <= 0 || !finite(c.scalePercent) ||
        c.scalePercent < 50 || c.scalePercent > 100 || !finite(c.rotationDeg) ||
        c.rotationDeg < 0 || c.rotationDeg > 360)
      throw new TypeError('Autofinish needs a positive height, 50–100% scale and 0–360° rotation.');
  }
  function checked(raw, required) {
    var checks = [], names = Object.create(null), malformed = false;
    if (!raw || !Array.isArray(raw.checks) || !raw.checks.length) malformed = true;
    else raw.checks.forEach(function (c) {
      if (!c || typeof c.name !== 'string' || !c.name.trim() || names[c.name] ||
          ['pass','fail','unresolved'].indexOf(c.status) < 0) { malformed = true; return; }
      names[c.name] = true;
      checks.push({name:c.name, status:c.status, reason:typeof c.reason === 'string' ? c.reason : ''});
    });
    required.forEach(function (name) {
      if (!names[name]) checks.push({name:name, status:'unresolved', reason:'The evaluator did not complete this check.'});
    });
    if (malformed) checks.push({name:'evaluation', status:'unresolved', reason:'The evaluator returned incomplete or malformed checks.'});
    if (!raw || !finite(raw.score) || raw.score <= 0)
      checks.push({name:'measured-scale', status:'unresolved', reason:'The actual artwork scale was not measured.'});
    return {checks:checks, ok:checks.length > 0 && checks.every(function (c) { return c.status === 'pass'; })};
  }

  async function run(options) {
    var o = options || {};
    validateInitial(o.initial);
    if (typeof o.evaluate !== 'function') throw new TypeError('Autofinish needs a geometry evaluator.');
    var mode = o.mode == null ? 'preserve-height' : o.mode;
    if (mode !== 'preserve-height' && mode !== 'fill') throw new TypeError('Unknown autofinish sizing mode.');
    var initial = candidate(o.initial.heightMm, o.initial.scalePercent, o.initial.rotationDeg);
    var ceiling = mode === 'fill' && o.maxHeightMm != null ? o.maxHeightMm : initial.heightMm;
    if (!finite(ceiling) || ceiling <= 0) throw new TypeError('Invalid autofinish height limit.');
    // Even an explicit lower limit must not create a candidate taller than it.
    var floor = o.minHeightMm == null ? Math.min(6, ceiling, initial.heightMm) : o.minHeightMm;
    var minScale = o.minScalePercent == null ? 50 : o.minScalePercent;
    if (!finite(floor) || floor <= 0 || floor > ceiling || !finite(minScale) || minScale < 50 || minScale > 100)
      throw new TypeError('Invalid autofinish search bounds.');
    var heightStep = o.heightStepMm == null ? 0 : o.heightStepMm;
    var scaleStep = o.scaleStepPercent == null ? 0 : o.scaleStepPercent;
    function validStep(step, minimum) {
      return finite(step) && step >= 0 && (!step || Math.abs(minimum/step-Math.round(minimum/step)) < 1e-9);
    }
    if (!validStep(heightStep,floor) || !validStep(scaleStep,minScale))
      throw new TypeError('Sizing steps must be nonnegative and align with the minimum search bounds.');
    function down(value, step, minimum) {
      if (!step) return value;
      var multiple=Math.floor(value/step), rounded=multiple*step;
      // No epsilon added before flooring: a near-boundary passing candidate
      // must never grow because a slider has coarser resolution.
      if (rounded>value) rounded=(multiple-1)*step;
      return Math.max(minimum,rounded);
    }
    var limit = o.maxEvaluations == null ? 12 : o.maxEvaluations;
    var budget = o.timeBudgetMs == null ? 6000 : o.timeBudgetMs;
    if (!Number.isInteger(limit) || limit < 1 || limit > 32 || !finite(budget) || budget <= 0 || budget > 30000)
      throw new TypeError('Autofinish needs 1–32 evaluations and a time budget of at most 30 seconds.');
    var required = o.requiredChecks == null ? REQUIRED_CHECKS.slice() : o.requiredChecks;
    if (!Array.isArray(required) || !required.length || required.some(function (s,i) {
      return typeof s !== 'string' || !s.trim() || required.indexOf(s) !== i;
    })) throw new TypeError('Autofinish needs unique named physical checks.');
    required = required.slice();
    var now = typeof o.now === 'function' ? o.now : clock;
    var pause = typeof o.yieldControl === 'function' ? o.yieldControl : yieldTask;
    var start = now(), attempts = [], seen = Object.create(null), best = null, stop = '', terminal = false;
    function cancelled() { return !!((o.signal && o.signal.aborted) || (o.isCancelled && o.isCancelled())); }
    function canContinue() {
      if (cancelled()) { stop = 'cancelled'; return false; }
      if (attempts.length >= limit) { stop = 'evaluations'; return false; }
      if (now() - start >= budget) { stop = 'time'; return false; }
      return !terminal;
    }
    function notify(phase, c, record) {
      if (typeof o.onProgress === 'function') o.onProgress({phase:phase, candidate:copy(c),
        completed:attempts.length, maximum:limit, accepted:record ? record.ok : false,
        checks:record ? record.checks.map(function (v) { return Object.assign({},v); }) : []});
    }
    async function attempt(c) {
      var id = key(c);
      if (seen[id]) return seen[id];
      if (!canContinue()) return null;
      // A macrotask permits both painting and a user's Cancel click to run.
      await pause();
      if (!canContinue()) return null;
      notify('checking',c);
      var raw;
      try { raw = await o.evaluate(c); }
      catch (e) {
        raw = {checks:[{name:'evaluation',status:'unresolved',reason:e && e.message || 'The geometry check did not finish.'}]};
      }
      var verified = checked(raw,required);
      var record = {candidate:copy(c),checks:verified.checks,ok:verified.ok,
        score:raw && finite(raw.score) && raw.score > 0 ? raw.score : null};
      seen[id] = record; attempts.push(record);
      // Cancellation after an asynchronous evaluator must never expose a
      // candidate for the caller to apply to a newer selected model.
      if (cancelled()) { stop = 'cancelled'; return record; }
      if (record.ok && (!best || record.score > best.score + 1e-9))
        best = {candidate:copy(c),checks:record.checks,score:record.score,metrics:raw.metrics,value:raw.value};
      terminal = !!(raw && raw.terminal && !record.ok);
      if (terminal) stop = 'terminal';
      notify('checked',c,record);
      await pause();
      if (cancelled()) stop = 'cancelled';
      return record;
    }
    function at(level) {
      // This continuous path spans the physical uniform scales without
      // exceeding the requested height. First vary scale at maximum height;
      // below the minimum scale, lower the requested height as well.
      var height=level>=0.5?ceiling:floor+(ceiling-floor)*level*2;
      var scale=level>=0.5?minScale+(100-minScale)*(level-0.5)*2:minScale;
      return candidate(down(height,heightStep,floor),down(scale,scaleStep,minScale),initial.rotationDeg);
    }
    // Preserve a passing current design as a fallback. Do not silently exceed
    // an explicit fill ceiling if the caller is deliberately reducing it.
    if (initial.heightMm <= ceiling && initial.scalePercent >= minScale) await attempt(initial);
    var maximum = !terminal && stop !== 'cancelled' ? await attempt(at(1)) : null;
    if (!(maximum && maximum.ok) && !terminal && stop !== 'cancelled') {
      var high = 1, low = null;
      for (var i=1; i<=4 && canContinue(); i++) {
        var level = 1-i/4, result = await attempt(at(level));
        if (!result || stop === 'cancelled' || terminal) break;
        if (result.ok) { low = level; break; }
        high = level;
      }
      while (low !== null && high-low > 1/1024 && canContinue()) {
        var middle = (low+high)/2, refined = await attempt(at(middle));
        if (!refined || stop === 'cancelled' || terminal) break;
        if (refined.ok) low = middle; else high = middle;
      }
    }
    var isCancelled = stop === 'cancelled' || cancelled();
    var unresolved = attempts.some(function (a) { return a.checks.some(function (c) { return c.status === 'unresolved'; }); });
    var status = isCancelled ? 'cancelled' : best ? 'accepted' : unresolved ? 'unresolved' : 'failed';
    var reason = isCancelled ? 'Sizing was cancelled; the current design is unchanged.' :
      best ? 'Every recorded physical check passed. This is the largest passing artwork size tested.' :
      unresolved ? 'No candidate passed every physical check. An incomplete check cannot be treated as printable.' :
      'No tested artwork size passed every physical check. The current design is unchanged.';
    var actions = [];
    if (best && !isCancelled) {
      if (best.candidate.heightMm !== initial.heightMm) actions.push({name:'height',from:initial.heightMm,to:best.candidate.heightMm,unit:'mm'});
      if (best.candidate.scalePercent !== initial.scalePercent) actions.push({name:'uniform-scale',from:initial.scalePercent,to:best.candidate.scalePercent,unit:'percent'});
    }
    return {status:status,original:copy(initial),candidate:best && !isCancelled ? copy(best.candidate) : null,
      checks:best && !isCancelled ? best.checks : attempts.length ? attempts[attempts.length-1].checks : [],
      score:best && !isCancelled ? best.score : null,metrics:best && !isCancelled ? best.metrics : null,
      value:best && !isCancelled ? best.value : null,actions:actions,attempts:attempts,reason:reason,
      exhausted:stop === 'time' || stop === 'evaluations',stopReason:stop || 'complete',elapsedMs:Math.max(0,now()-start)};
  }
  var api = {run:run,REQUIRED_CHECKS:Object.freeze(REQUIRED_CHECKS.slice())};
  root.keycapAutoFinish = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
