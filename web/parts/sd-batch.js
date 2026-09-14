/* Deleting more than one model at a time.
 *
 * The SD manager deletes one model per click, and each folder delete is queued
 * to the printer's idle loop and takes seconds - so clearing a card meant
 * sitting through them one at a time. Worse, a delete makes the printer busy,
 * which blocks a firmware flash, so "I'm still deleting" and "I can't update"
 * were the same wait.
 *
 * THIS DOES NOT TOUCH THE ROW RENDERER. The SD list is built deep inside the
 * dashboard and threading checkboxes through it means changing code that
 * already works. Instead this is a self-contained panel: it asks /api/files
 * what is on the card, shows it with checkboxes, and then issues the SAME
 * single-delete endpoint the buttons use, one after another.
 *
 * SEQUENTIAL, NOT PARALLEL, and that is not laziness. The printer is a
 * single-threaded web server and a folder delete is queued to its idle loop -
 * firing five at once gets four rejected with "printer busy" and leaves the
 * user to work out which ones actually went. So: one at a time, each waiting
 * for the printer to go idle again, with a count of what has gone and what is
 * left. It can be stopped part way, and says exactly where it stopped.
 */

(function (root) {
  'use strict';

  var state = { running: false, stop: false };

  function api(path, opts, ms) {
    /* The page's own helper carries the X-TinyMaker header the printer
       requires on writes (issue #95); fall back only if it is not there. */
    if (typeof root.api === 'function') return root.api(path, opts, ms);
    var o = Object.assign({ cache: 'no-store' }, opts || {});
    o.headers = Object.assign({ 'X-TinyMaker': '1' }, o.headers || {});
    return fetch(path, o).then(function (r) { return r.json(); });
  }

  function list() {
    return api('/api/files', null, 15000).then(function (d) {
      return ((d && d.items) || []).filter(function (i) { return i.type === 'model'; });
    });
  }

  /* Wait for the printer to finish whatever the last delete queued. Folder
     deletes return {queued:true} immediately and the work happens afterwards,
     so without this the next request arrives while it is still going and comes
     back 409. */
  function waitIdle(timeoutMs) {
    var until = Date.now() + (timeoutMs || 90000);
    return new Promise(function (res, rej) {
      (function poll() {
        if (state.stop) return res('stopped');
        if (Date.now() > until) return rej(new Error('the printer stayed busy for too long'));
        api('/api/status', null, 5000).then(function (s) {
          if (s && !s.busy) return res('idle');
          setTimeout(poll, 700);
        }).catch(function () { setTimeout(poll, 900); });
      })();
    });
  }

  function deleteOne(name) {
    return api('/api/files/delete?name=' + encodeURIComponent(name),
               { method: 'POST' }, 30000);
  }

  /* onStep(done, total, name, note) is called as it goes. Resolves with what
     actually happened rather than throwing on the first refusal - a batch that
     dies silently half way through is worse than no batch. */
  function run(names, onStep) {
    if (state.running) return Promise.reject(new Error('a batch delete is already running'));
    state.running = true; state.stop = false;
    var done = [], failed = [], i = 0;

    function next() {
      if (state.stop || i >= names.length) return Promise.resolve();
      var name = names[i++];
      if (onStep) onStep(done.length, names.length, name, 'deleting');
      return deleteOne(name)
        .then(function () { return waitIdle(); })
        .then(function () { done.push(name); })
        .catch(function (e) {
          failed.push({ name: name, why: (e && e.message) || 'refused' });
        })
        .then(next);
    }

    return next().then(function () {
      state.running = false;
      return { deleted: done, failed: failed, stopped: state.stop,
               total: names.length };
    }, function (e) {
      state.running = false;
      throw e;
    });
  }

  function stop() { state.stop = true; }
  function running() { return state.running; }

  root.sdBatch = { list: list, run: run, stop: stop, running: running,
                   waitIdle: waitIdle, deleteOne: deleteOne };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.sdBatch;
})(typeof window !== 'undefined' ? window : globalThis);
