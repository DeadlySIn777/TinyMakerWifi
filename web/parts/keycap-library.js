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
  var MAX = 60; // Legacy explicit trim() default; saves never remove older work.

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
    // Measurements and cap settings are JSON data, but can contain nested
    // arrays/objects owned by the editor. Capture them with the source mesh.
    if (facts) {var snapshot=JSON.parse(JSON.stringify(facts));Object.keys(snapshot).forEach(function (k) { out[k] = snapshot[k]; });}
    return out;
  }

  /* A finished product is a second mesh: the checked assembly in print pose.
     Keep the source artwork separately for editing. Snapshot before opening
     IndexedDB so edits made while storage opens cannot change this save. */
  function copyProduct(p, includePositions) {
    if (!p) return null;
    var out = { version: p.version, kind: p.kind, state: p.state,
      issues: Array.isArray(p.issues) ? p.issues.slice() : [], checkedAt: p.checkedAt,
      fit: p.fit ? { slotMm: p.fit.slotMm } : null,
      sizeMm: Array.isArray(p.sizeMm) ? p.sizeMm.slice() : null,
      triangles: p.triangles, recipe: p.recipe, signature: p.signature };
    if (includePositions) {
      if (p.positions != null && Object.prototype.toString.call(p.positions) !== '[object Float32Array]')
        throw new Error('The finished product mesh must be a Float32Array. Rebuild and save it again.');
      out.positions = p.positions == null ? null : new Float32Array(p.positions);
    }
    return out;
  }

  function save(entry) {
    var e = entry || {};
    if (!e.name && !e.prompt) return Promise.reject(new Error('A saved design needs a name or a prompt.'));
    var product, positions=null, facts, topperRecipe=null, topperSource=null;
    try {
      product = copyProduct(e.product, true);
      if(e.positions!=null){
        if(Object.prototype.toString.call(e.positions)!=='[object Float32Array]')
          throw new Error('The source artwork must be a Float32Array. Reopen and save it again.');
        positions=new Float32Array(e.positions);
      }
      facts=withRaw(e.facts,measure(positions));
      if(e.topperRecipe!=null)topperRecipe=copyTopperRecipe(e.topperRecipe);
      if(e.topperSource!=null){
        if(!topperRecipe||Object.prototype.toString.call(e.topperSource)!=='[object Float32Array]'||
          !e.topperSource.length||e.topperSource.length%9||e.topperSource.length>2700000)
          throw new Error('The original topper artwork could not be saved.');
        for(var ti=0;ti<e.topperSource.length;ti++)if(!Number.isFinite(e.topperSource[ti]))throw new Error('The topper artwork contains invalid coordinates.');
        topperSource=new Float32Array(e.topperSource);
      }
    }
    catch (error) { return Promise.reject(error); }
    var rec = {
      id: e.id || newId(),
      at: e.at || Date.now(),
      name: e.name || e.prompt.slice(0, 60),
      prompt: e.prompt || '',
      kind: e.kind || 'sculpt',
      thumb: e.thumb || null,
      design: e.design || null,
      /* The source, product, colors and measurements all describe this same
         save, even if the editor changes while IndexedDB is opening. */
      positions: positions,
      sourceColors: copySourceColors(e.sourceColors,positions),
      sourceColorKind: /^(material|vertex|texture|partial)$/.test(e.sourceColorKind||'')?e.sourceColorKind:null,
      topperRecipe:topperRecipe, topperSource:topperSource,
      triangles: positions ? positions.length / 9 : 0,
      /* The caller's own measurements win, because only the caller knows the
         scale. measure() contributes what it honestly can from the raw mesh:
         its byte size, and its extent in whatever unit the generator used. */
      facts: facts,
      product: product
    };
    // Storage-full errors reach the caller. Never erase paid generations or
    // finished products to make room for a new one.
    return tx('readwrite', function (os) { os.put(rec); return rec; });
  }

  function copyTopperRecipe(recipe){
    if(!recipe||recipe.version!==1||!recipe.fields||typeof recipe.fields!=='object'||Array.isArray(recipe.fields))
      throw new Error('The saved topper settings are unsupported.');
    var fields={},keys=['tpPreset','tpModel','tpShape','tpWidth','tpSecondWidth','tpDepth','tpWall','tpFit','tpArtHeight','tpArtRotation','tpPrompt'];
    keys.forEach(function(key){var value=recipe.fields[key];
      if(typeof value!=='string'||value.length>(key==='tpPrompt'?180:key==='tpModel'?60:200))throw new Error('The saved topper settings are incomplete or too long.');
      fields[key]=value;
    });
    return {version:1,fields:fields};
  }

  function copySourceColors(colors,positions){
    if(!colors||!positions||colors.length!==positions.length||Object.prototype.toString.call(colors)!=='[object Float32Array]')return null;
    for(var i=0;i<colors.length;i++)if(!Number.isFinite(colors[i])||colors[i]<0||colors[i]>1)return null;
    return new Float32Array(colors);
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
                   facts: v.facts || null,
                   product: copyProduct(v.product, false) });
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

  /* Legacy explicit maintenance API only. Never called by save or the UI;
     deleting older work requires a deliberate caller action. */
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
                         measure: measure, copyTopperRecipe:copyTopperRecipe,
                         clear: clear, trim: trim, usage: usage,
                         newId: newId, MAX: MAX };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.keycapLibrary;
})(typeof window !== 'undefined' ? window : globalThis);
