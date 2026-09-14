/* Everything you have already made, kept.
 *
 * TWO COMPLAINTS, ONE CAUSE. "the prints it generates, I refresh and they
 * disappear" and "the library sucks, it should use all the stuff we've used in
 * the past" are the same missing thing: nothing kept the work. A generated
 * model lived in a variable, the page reloaded, and it was gone - and the
 * Library tab showed a set of hand-drawn icons I made up, which is exactly
 * what the owner said not to lead with.
 *
 * So the Library is now the shelf of things you have generated. Every
 * successful generation is filed here automatically, with the prompt and a
 * thumbnail, and picking one puts the SAME mesh back on the cap - no second
 * call, no credits, and bit-for-bit the model that was approved.
 *
 * WHY IndexedDB AND NOT localStorage. A generated model is about a megabyte of
 * Float32Array. localStorage is a ~5 MB string store: the mesh would have to be
 * base64'd, costing a third again in size, and three or four models would fill
 * it and start throwing on write. IndexedDB stores typed arrays as they are.
 *
 * Everything here degrades to an empty shelf rather than an exception - a
 * private window, a browser with storage disabled, a quota refusal. What it
 * will NOT do is fail silently: every call reports what happened, because a
 * save that quietly did not happen is the bug this module exists to fix.
 *
 * No DOM. scripts/dev/test_keycap_library.mjs runs the pure parts in node.
 */

(function (root) {
  'use strict';

  var DB = 'tmKeycaps', STORE = 'designs', VERSION = 1;
  var MAX = 60;

  function open() {
    return new Promise(function (res, rej) {
      var idb = root.indexedDB;
      if (!idb) return rej(new Error('This browser has no IndexedDB, so nothing can be kept here.'));
      var rq;
      try { rq = idb.open(DB, VERSION); }
      catch (e) { return rej(new Error('Storage is blocked in this browser (' + (e.name || 'refused') + ').')); }
      rq.onupgradeneeded = function () {
        var db = rq.result;
        if (!db.objectStoreNames.contains(STORE)) {
          var os = db.createObjectStore(STORE, { keyPath: 'id' });
          os.createIndex('at', 'at');
        }
      };
      rq.onsuccess = function () { res(rq.result); };
      rq.onerror = function () { rej(new Error('Could not open the design store: ' +
        ((rq.error && rq.error.message) || 'refused'))); };
      rq.onblocked = function () { rej(new Error('Another tab is holding the design store open.')); };
    });
  }

  function tx(mode, fn) {
    return open().then(function (db) {
      return new Promise(function (res, rej) {
        var t = db.transaction(STORE, mode), os = t.objectStore(STORE), out;
        try { out = fn(os); } catch (e) { rej(e); return; }
        t.oncomplete = function () { db.close(); res(out && out.result !== undefined ? out.result : out); };
        t.onerror = function () { db.close(); rej(new Error((t.error && t.error.message) || 'store write failed')); };
        t.onabort = function () { db.close();
          rej(new Error(t.error && t.error.name === 'QuotaExceededError'
            ? 'This browser is out of room for saved designs - delete a few.'
            : 'The design store aborted the write.')); };
      });
    });
  }

  function newId() {
    /* Time-ordered so a plain key scan comes back newest-last without an index
       lookup, with a random tail so two saves in the same millisecond differ. */
    return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  }

  /* Everything about a mesh that a LIST needs, measured once, here, while the
     mesh is in hand.

     The Library room asked for resin, size and storage per card and got a row
     of em-dashes, because it computed them from rec.positions and list()
     deliberately does not return positions - twenty cards would be twenty
     megabytes of Float32Array to render a grid of captions. Both halves were
     right on their own: the list must stay light, and the facts must be there.
     So the facts are measured at save and travel with the summary. */
  function measure(positions) {
    if (!positions || !positions.length) return null;
    var mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9], i, k, v;
    for (i = 0; i < positions.length; i += 3)
      for (k = 0; k < 3; k++) {
        v = positions[i + k];
        if (v < mn[k]) mn[k] = v;
        if (v > mx[k]) mx[k] = v;
      }
    /* ⚠️ THESE ARE NOT MILLIMETRES. `positions` is the mesh as the generator
       produced it - meshy-glb applies node transforms and the Y-up flip and
       nothing else - so on a typical Meshy asset this box is about 1 x 1 x 1
       in glTF units, and calling it sizeMm made the Library card say a cap
       that really prints 18 x 18 x 17.5 mm was 1 mm across and cost 0.00 ml.
       The unit is unknown, so the field is named for what it is; anything that
       wants millimetres passes them in (see `facts` below), because the cap
       that will be printed is what the card is actually about. */
    var out = { sizeRaw: [+(mx[0]-mn[0]).toFixed(3), +(mx[1]-mn[1]).toFixed(3),
                          +(mx[2]-mn[2]).toFixed(3)],
                bytes: positions.length * 4 };
    return out;
  }

  /* entry: { name, prompt, kind:'sculpt'|'skin'|'icon', positions?, thumb?, design?,
             facts? }

     `facts` is what the SEATED CAP measures - { sizeMm: [x,y,z], resinMl,
     profile, row, sizeU } - handed in by whoever saves, because only they
     know the scale the raw mesh was seated at. Without it a card can say
     how many triangles a design has and not how big it prints, which is
     the honest answer; with it the card says what will come off the
     plate. */
  function withRaw(facts, raw) {
    var out = {};
    if (raw) { out.sizeRaw = raw.sizeRaw; out.bytes = raw.bytes; }
    if (facts) Object.keys(facts).forEach(function (k) { out[k] = facts[k]; });
    return out;
  }

  function save(entry) {
    var e = entry || {};
    if (!e.name && !e.prompt) return Promise.reject(new Error('A saved design needs a name or a prompt.'));
    var rec = {
      id: e.id || newId(),
      at: e.at || Date.now(),
      name: e.name || e.prompt.slice(0, 60),
      prompt: e.prompt || '',
      kind: e.kind || 'sculpt',
      thumb: e.thumb || null,
      design: e.design || null,
      /* Stored as the typed array it already is. This is the whole reason for
         IndexedDB, and the reason picking one costs nothing. */
      positions: e.positions || null,
      triangles: e.positions ? e.positions.length / 9 : 0,
      /* The caller's own measurements win, because only the caller knows the
         scale. measure() contributes what it honestly can from the raw mesh:
         its byte size, and its extent in whatever unit the generator used. */
      facts: withRaw(e.facts, measure(e.positions))
    };
    return tx('readwrite', function (os) { os.put(rec); return rec; })
      .then(function (r) { return trim().then(function () { return r; }); });
  }

  /* Newest first. Meshes are left behind on purpose - a shelf of twenty models
     is twenty megabytes, and the list only needs names and thumbnails. */
  function list() {
    return tx('readonly', function (os) {
      var out = [];
      os.openCursor().onsuccess = function (ev) {
        var c = ev.target.result;
        if (!c) return;
        var v = c.value;
        out.push({ id: v.id, at: v.at, name: v.name, prompt: v.prompt,
                   kind: v.kind, thumb: v.thumb, triangles: v.triangles,
                   design: v.design,
                   /* Measured at save. A record written before this existed has
                      none, and the card says so for those two fields rather
                      than loading a megabyte to fill in a caption. */
                   facts: v.facts || null });
        c.continue();
      };
      return { get result() { return out; } };
    }).then(function (rows) { return rows.sort(function (a, b) { return b.at - a.at; }); });
  }

  function get(id) {
    return tx('readonly', function (os) { return os.get(id); });
  }
  function remove(id) {
    return tx('readwrite', function (os) { os.delete(id); return true; });
  }
  function clear() {
    return tx('readwrite', function (os) { os.clear(); return true; });
  }

  /* Drop the oldest beyond MAX. Called after every save so the shelf cannot
     grow until a quota error is the thing that tells you about it. */
  function trim(max) {
    max = max || MAX;
    return list().then(function (rows) {
      if (rows.length <= max) return 0;
      var doomed = rows.slice(max);
      return Promise.all(doomed.map(function (r) { return remove(r.id); }))
        .then(function () { return doomed.length; });
    });
  }

  /* How much room the shelf is taking, when the browser will say. */
  function usage() {
    if (!root.navigator || !navigator.storage || !navigator.storage.estimate)
      return Promise.resolve({ known: false });
    return navigator.storage.estimate().then(function (e) {
      return { known: true, usedBytes: e.usage || 0, quotaBytes: e.quota || 0,
               pct: e.quota ? Math.round((e.usage / e.quota) * 100) : 0 };
    }).catch(function () { return { known: false }; });
  }

  root.keycapLibrary = { save: save, list: list, get: get, remove: remove,
                         measure: measure,
                         clear: clear, trim: trim, usage: usage,
                         newId: newId, MAX: MAX };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.keycapLibrary;
})(typeof window !== 'undefined' ? window : globalThis);
