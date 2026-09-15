/* Meshy: prompt -> mesh -> the slicer that is already here.
 *
 * The print leg is done (see slicerLoadMesh in slicer.js). This is only the
 * generation leg, and it plugs in at ONE point: Meshy hands back a GLB, and
 * meshy-glb.js already reads GLB. Nothing about slicing, supports or uploading
 * changes.
 *
 * Every API request funnels through meshyFetch(), and service errors carry the
 * HTTP status and response message. Request-contract tests use an inert fetch;
 * they do not establish the artistic quality of a real generated model.
 *
 * TWO-STAGE ON PURPOSE. Meshy's preview stage returns untextured geometry
 * first; refine spends additional credits on texture. So preview -> look at it
 * -> accept, and only then refine. Generating straight to textured would burn
 * credits on models you reject at a glance.
 */

(function (root) {
  'use strict';

  var API = 'https://api.meshy.ai/openapi/v2';
  var PROXY = null;          // set to e.g. 'https://tinymakerwifi.com/meshy' to
                             // route through a Worker that holds the key
  var KEY_STORE = 'tmMeshyKey';

  function storageProblem(action) {
    return new Error('Cannot ' + action + ' the Meshy key in this browser. Allow site storage for this printer address, then save and test again.');
  }
  function key() {
    try { return localStorage.getItem(KEY_STORE) || ''; }
    catch (e) { throw storageProblem('read'); }
  }
  // Presence only: callers never need the credential to explain its state.
  function keyStatus() {
    try { return { available: true, stored: !!key(), error: '' }; }
    catch (e) { return { available: false, stored: false, error: e.message }; }
  }
  /* A KEY IS PASTED, AND A PASTE BRINGS FRIENDS. Copying from a dashboard picks
     up a trailing newline, a non-breaking space from a styled <code> block, or
     the smart quotes a chat client added. Any of those go into an Authorization
     header, and the browser then throws a TypeError - the SAME class as a
     network failure, so "invalid header" and "you are offline" arrive looking
     identical and neither says which. Clean it here, once, where it is entered,
     rather than guessing later from an error that cannot tell you.

     Non-ASCII cannot go in a header at all, so a key carrying any is refused
     outright with a reason, instead of being stored and failing on every
     generation afterwards. */
  function cleanKey(k) {
    return String(k || '')
      .replace(/[\u00a0\u2000-\u200b\u202f\u3000]/g, ' ')  // exotic spaces
      .replace(/[\u2018\u2019\u201c\u201d]/g, '')            // smart quotes
      .trim();
  }
  function keyProblem(k) {
    if (!k) return null;
    if (/[^\x21-\x7e]/.test(k))
      return 'That key has a character that cannot go in an HTTP header - it was ' +
             'probably copied with formatting. Paste it as plain text.';
    if (k.length < 12) return 'That looks too short for a Meshy key.';
    return null;
  }
  function setKey(k) {
    var c = cleanKey(k);
    // Save clears the password field afterwards. A second click must be inert.
    // Deletion is a separate, explicitly confirmed UI action.
    if (!c) return false;
    var bad = keyProblem(c);
    if (bad) throw new Error(bad);
    var previous = key();
    if (previous === c) return false;
    try { localStorage.setItem(KEY_STORE, c); }
    catch (e) { throw storageProblem('save'); }
    try {
      if (key() !== c) throw storageProblem('verify');
    } catch (e) {
      // Restore the previous value if a browser accepted but did not retain it.
      // A denied setItem is atomic and leaves the previous value untouched.
      try { previous ? localStorage.setItem(KEY_STORE, previous) : localStorage.removeItem(KEY_STORE); } catch (ignored) {}
      throw storageProblem('verify');
    }
    return true;
  }
  function removeKey() {
    key(); // Refuse mutation when the existing state cannot be read.
    try { localStorage.removeItem(KEY_STORE); }
    catch (e) { throw storageProblem('remove'); }
    if (key()) throw storageProblem('remove');
  }

  /* One seam for direct-vs-proxy, so switching is a constant and not a rewrite.
     Direct needs the key in this page; the proxy keeps it server-side. The page
     is served from the printer over HTTP on the LAN. The key stays in this
     browser's origin storage; other LAN clients cannot read it simply by
     opening the printer. Use a trusted LAN because an attacker able to modify
     this HTTP page could inject script that reads its storage. */
  function meshyFetch(path, opts) {
    var o = opts || {};
    var url = PROXY ? (PROXY + path) : (API + path);
    var h = { 'Content-Type': 'application/json' };
    if (!PROXY) {
      var k;
      try { k = key(); } catch (e) { return Promise.reject(e); }
      if (!k) return Promise.reject(new Error('No Meshy API key set.'));
      var bad = keyProblem(k);
      if (bad) return Promise.reject(new Error(bad + ' (Saved keys are cleaned now; re-paste it.)'));
      h['Authorization'] = 'Bearer ' + k;
    }
    return fetch(url, {
      method: o.method || 'GET',
      headers: h,
      body: o.body ? JSON.stringify(o.body) : undefined
    }).catch(function (e) {
      /* A rejected fetch does not establish whether a paid POST reached Meshy.
         Network, CORS, browser policy, blockers and a lost response can all
         produce the same TypeError. Never promise an uncharged retry. */
      if (e && (e.name === 'TypeError' || /failed to fetch|load failed|networkerror/i.test(e.message || ''))) {
        var err = new Error(
          'This browser did not receive a usable response from Meshy. The request ' +
          'may have reached Meshy and used credits. Check your Meshy task history ' +
          'before generating again. Connection problems, CORS, browser blockers, ' +
          'a VPN or a lost response can cause this; check the connection and service status.');
        err.offline = true; // Legacy transport-failure flag, not proof of no internet.
        err.cause = e;
        throw err;
      }
      throw e;
    }).then(function (r) {
      return r.text().catch(function () {
        var e = new Error(o.method === 'POST'
          ? 'Meshy replied, but its response was interrupted before the task ID could be read. The request may have used credits. Check your Meshy task history before generating again.'
          : 'The Meshy response was interrupted. Your saved task is kept; recover it again when the connection is available.');
        e.offline = true;
        throw e;
      }).then(function (t) {
        var j = null;
        try { j = t ? JSON.parse(t) : null; } catch (e) {}
        if (!r.ok) {
          // Carry the status AND the body: a 402 is out of credits, a 401 is a
          // bad key, and a 400 usually names the field it disliked. Collapsing
          // those into "request failed" is how you lose an evening.
          var msg = (j && (j.message || j.error)) || t || ('HTTP ' + r.status);
          var e = new Error('Meshy ' + r.status + ': ' + String(msg).slice(0, 200));
          e.status = r.status;
          throw e;
        }
        return j;
      });
    });
  }

  // ---- the API surface ----------------------------------------------------

  function createPreview(prompt, opts) {
    var o = opts || {};
    if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 800)
      return Promise.reject(new Error('Meshy needs a description from 1 to 800 characters. Nothing has been submitted.'));
    var polycount = o.polycount == null ? 30000 : o.polycount;
    if (!Number.isInteger(polycount) || polycount < 100 || polycount > 300000)
      return Promise.reject(new Error('Meshy target polycount must be an integer from 100 to 300000. Nothing has been submitted.'));
    if (Object.prototype.hasOwnProperty.call(o, 'ultra') && typeof o.ultra !== 'boolean')
      return Promise.reject(new Error('Meshy Ultra must be on or off. Nothing has been submitted.'));
    return meshyFetch('/text-to-3d', {
      method: 'POST',
      body: {
        mode: 'preview',
        prompt: prompt,
        model_type: 'standard',
        ai_model: 'meshy-7',
        ultra_mode: o.ultra === true,
        should_remesh: true,
        // Remeshing makes target_polycount effective and bounds the requested
        // workload for this browser. Actual counts may differ; downstream
        // geometry checks still apply. A count alone does not prove detail.
        target_polycount: polycount
      }
    }).then(createdTaskId);
  }

  function refine(previewTaskId) {
    if (!validTaskId(previewTaskId)) return Promise.reject(new Error('Choose a completed preview before adding texture. Nothing has been submitted.'));
    return meshyFetch('/text-to-3d', {
      method: 'POST',
      body: { mode: 'refine', preview_task_id: previewTaskId }
    }).then(createdTaskId);
  }

  function validTaskId(id) { return typeof id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(id); }
  function createdTaskId(j) {
    var id = j && (j.result || j.id);
    if (!validTaskId(id)) {
      var e = new Error('Meshy accepted the request but did not return a usable task ID. It may have used credits. Check your Meshy task history before generating again.');
      e.submissionUncertain = true;
      throw e;
    }
    return id;
  }
  function task(id) {
    if (!validTaskId(id)) return Promise.reject(new Error('The saved Meshy task ID is invalid.'));
    return meshyFetch('/text-to-3d/' + encodeURIComponent(id));
  }

  /* Poll, not SSE: EventSource cannot set an Authorization header, and a held-
     open socket on a LAN page whose WiFi drops is worse than a poll loop.
     onTick gets (status, progress, raw) so the card can show something moving. */
  function waitFor(id, onTick, opts) {
    var o = opts || {};
    var everyMs = o.everyMs || 3000;
    var deadline = Date.now() + (o.timeoutMs || 15 * 60 * 1000);
    return new Promise(function (resolve, reject) {
      (function step() {
        if (Date.now() > deadline) return reject(new Error('Meshy took longer than expected - the task may still finish; check your Meshy dashboard.'));
        task(id).then(function (t) {
          var st = t && t.status;
          if (t && t.id != null && t.id !== id)
            return reject(new Error('Meshy returned a different task than requested. The original task is kept for recovery.'));
          if (onTick) { try { onTick(st, (t && t.progress) || 0, t); } catch (e) {} }
          if (st === 'SUCCEEDED') return resolve(t);
          if (st === 'FAILED' || st === 'CANCELED' || st === 'CANCELLED' || st === 'EXPIRED') {
            var why = (t && t.task_error && t.task_error.message) || st;
            var e = new Error('Meshy ' + String(st).toLowerCase() + ': ' + why);
            e.taskTerminal = true;
            e.taskId = id;
            return reject(e);
          }
          if (st !== 'PENDING' && st !== 'IN_PROGRESS')
            return reject(new Error('Meshy returned an unrecognized task response. The saved task is kept; try recovering it again.'));
          setTimeout(step, everyMs);
        }).catch(reject);
      })();
    });
  }

  /* Fetch the GLB bytes. Kept separate from the task call because the asset
     lives on a different host with its own CORS behaviour - if this is the
     thing that breaks, it breaks HERE and the message says so. */
  /* Getting the finished model, through whichever door is open.

     CORS IS A RULE ABOUT WHAT A SCRIPT MAY READ, not about what can be
     reached. api.meshy.ai returns Access-Control-Allow-Origin for this
     printer's origin; assets.meshy.ai, where the model actually lives, returns
     no such header at all - so the browser refuses to hand the page bytes it
     can otherwise fetch perfectly well. The model exists and the credits are
     spent; only the last hop is blocked.

     Three doors, in the order that costs the owner least:
       1. straight at the asset host, which works wherever Meshy allows it;
       2. the PRINTER, which is not a page and so is not subject to the rule -
          it fetches the signed URL itself and streams it back over the
          connection the browser already has open, same-origin;
       3. the owner, by hand, with the link - because a model that is paid for
          and finished should never end in three words and a dead stop.
     Whatever happens, the error carries the URL, so door three is always
     available even when doors one and two both fail. */
  function fetchModel(t, which) {
    var urls = (t && t.model_urls) || {};
    var u = urls[which || 'glb'];
    if (!u) throw new Error('That Meshy task returned no ' + (which || 'glb') + ' file.');

    function manual(why) {
      var e = new Error((why ? why + ' ' : '') +
        'Your finished task is kept for recovery. Download the existing model ' +
        'and load its .glb file, or recover this task again without generating another.');
      e.modelUrl = u;
      e.corsBlocked = true;
      return e;
    }

    function checkedBytes(buf) {
      // A 200 containing HTML, an empty body, or a truncated stream is not a
      // delivered GLB. Keep recovery intact before handing bytes to the parser.
      if (!buf || !Number.isFinite(buf.byteLength) || !buf.byteLength)
        throw manual('The model download was empty.');
      if (!which || which === 'glb') {
        if (buf.byteLength < 20) throw manual('The GLB download was incomplete.');
        var dv = new DataView(buf);
        if (dv.getUint32(0, true) !== 0x46546c67 || dv.getUint32(4, true) !== 2 || dv.getUint32(8, true) !== buf.byteLength)
          throw manual('The download was not a complete GLB model.');
      }
      return buf;
    }

    function viaPrinter(why) {
      /* X-TinyMaker, or the printer refuses its own dashboard. requestFromOwnUi
         accepts an Origin matching Host OR this header, and a same-origin GET
         from a browser sends NEITHER - browsers omit Origin on same-origin
         GET, and this call set no headers. Measured on the device: 403 without
         it, 200 with it. The whole printer-fetches-it feature was returning 403
         every time and quietly falling through to the manual link. Same origin,
         so a custom header triggers no preflight - which matters, because the
         printer cannot answer OPTIONS. */
      return fetch('/api/fetch?u=' + encodeURIComponent(u),
                   { cache: 'no-store', headers: { 'X-TinyMaker': '1' } })
        .then(function (r) {
          if (r.ok) return r.arrayBuffer().then(checkedBytes).catch(function (e) {
            if (e && e.modelUrl) throw e;
            throw manual('The printer download was interrupted.');
          });
          return r.json().catch(function () { return null; }).then(function (j) {
            throw manual((j && j.error)
              ? 'The printer could not fetch it either: ' + j.error + '.'
              : 'The printer could not fetch it either (' + r.status + ').');
          });
        }, function () {
          throw manual(why || 'This browser is not allowed to download it directly, ' +
                              'and the printer could not be reached.');
        });
    }

    var direct = PROXY ? (PROXY + '/asset?u=' + encodeURIComponent(u)) : u;
    return fetch(direct).then(function (r) {
      if (r.ok) return r.arrayBuffer().then(checkedBytes).catch(function () {
        return viaPrinter('The direct model download was incomplete.');
      });
      /* A real HTTP answer, so the bytes were reachable and Meshy said no -
         a signed URL that has expired, usually. The printer would be told the
         same thing, so do not make it try. */
      throw manual('Meshy refused the download (' + r.status + ').');
    }, function () {
      /* No HTTP answer at all: the browser blocked it before it started. This
         is the case the printer can solve. */
      return viaPrinter();
    });
  }

  function textureUrl(t) {
    var a = (t && t.texture_urls && t.texture_urls[0]) || null;
    return a ? (a.base_color || a.baseColor || null) : null;
  }

  /* ---- the whole generation leg, as one call --------------------------- */
  /* The task id, written down the instant it exists. See the file header:
     the model finishes whether or not this page is still watching, and the
     credits are spent either way. */
  var PENDING = 'tmMeshyPending';
  var generationActive = false;
  /* ⚠️ `from` SAYS WHICH CARD ASKED, and its absence was a real loss of work.
     There is ONE pending slot, two cards on the page generate models into it,
     and only the keycap card had a resumer - which claimed the slot 1.2 s
     after every load without checking. So a model started in "Generate a
     model", interrupted by a reload, came back SEATED ON A KEYCAP: the owner's
     model gone, a stranger on the cap, the credits spent. opts.from carries
     the answer; a record written before this field existed has none, and those
     still belong to the keycap card, because that is where they used to go. */
  function savedDesignCode(value) {
    // Local recipe metadata only. Its consumer must decode/validate the recipe.
    return typeof value === 'string' && value.length <= 4096 && /^TMK1-[A-Za-z0-9_-]+$/.test(value) ? value : null;
  }
  function savedTopperRecipe(value) {
    // Local editor snapshot only, never sent as a Meshy request parameter.
    return typeof value === 'string' && value.length <= 4096 ? value : null;
  }
  function savedOptions(opts) {
    if (!opts) return null;
    var saved = {};
    Object.keys(opts).forEach(function (k) { if (k !== 'designCode' && k !== 'topperRecipe') saved[k] = opts[k]; });
    return saved;
  }
  function remember(id, prompt, opts, previewId, stage) {
    try {
      localStorage.setItem(PENDING, JSON.stringify(
        { id: id, prompt: prompt, opts: savedOptions(opts), at: Date.now(),
          previewId: previewId || id, stage: stage || 'preview',
          from: (opts && opts.from) || null, designCode: savedDesignCode(opts && opts.designCode),
          topperRecipe: savedTopperRecipe(opts && opts.topperRecipe) }));
      var check = JSON.parse(localStorage.getItem(PENDING));
      if (!check || check.id !== id) throw new Error('not retained');
    } catch (ignored) {
      var e = new Error('Meshy created task ' + id + ', but this browser could not save its recovery record. Keep this task ID and recover the model from your Meshy task history.');
      e.taskId = id;
      throw e;
    }
  }
  /* Does this error prove the task can never be delivered? Anything else -
     offline, rate-limited, 5xx, timed out, or "the browser cannot read the
     asset" - leaves the record where it is. */
  function terminal(e) {
    if (!e) return false;
    if (e.modelUrl) return false;                 // the model exists, we just cannot fetch it
    if (e.status === 404 || e.status === 410) return true;
    return e.taskTerminal === true;
  }

  function forget(expectedId) {
    try {
      if (expectedId) {
        var saved = JSON.parse(localStorage.getItem(PENDING) || 'null');
        if (!saved || saved.id !== expectedId) return false;
      }
      localStorage.removeItem(PENDING);
      return localStorage.getItem(PENDING) === null;
    } catch (e) { return false; }
  }
  function acknowledge(id) { return validTaskId(id) && forget(id); }
  function pending() {
    var raw;
    try { raw = localStorage.getItem(PENDING); } catch (e) { return null; }
    if (!raw) return null;
    var d;
    try { d = JSON.parse(raw); } catch (e) { forget(); return null; }
    if (!d || !validTaskId(d.id)) { forget(); return null; }
    // The task ID outlives a signed download URL. Re-fetching the task obtains
    // its current URLs; elapsed time alone must never discard paid work.
    d.from = d.from || (d.opts && d.opts.from) || null;
    d.designCode = savedDesignCode(d.designCode) || savedDesignCode(d.opts && d.opts.designCode);
    d.topperRecipe = savedTopperRecipe(d.topperRecipe) || savedTopperRecipe(d.opts && d.opts.topperRecipe);
    return d;
  }

  function exclusiveGeneration(work) {
    if (generationActive) return Promise.reject(new Error('A Meshy generation or recovery is already active in this page. Wait for it before starting another.'));
    generationActive = true;
    return Promise.resolve().then(work).then(function (value) {
      generationActive = false; return value;
    }, function (error) { generationActive = false; throw error; });
  }
  function requireNoPending() {
    if (pending()) throw new Error('A Meshy task is waiting to be recovered or saved. Recover it in the card that created it before starting another generation. Nothing new has been submitted.');
    // Test storage before spending credits. This key contains no credentials.
    var checkKey = PENDING + 'StorageCheck', stamp = String(Date.now());
    try {
      localStorage.setItem(checkKey, stamp);
      if (localStorage.getItem(checkKey) !== stamp) throw new Error('not retained');
      localStorage.removeItem(checkKey);
    } catch (e) {
      throw new Error('Allow site storage in this browser so your generated model can be recovered. Nothing has been submitted.');
    }
  }

  /* Pick up a task that was already running. Deliberately the same waitFor and
     fetchModel the live call uses - a second code path for the resume is a
     second code path to keep correct. */
  function resume(ui) {
    return exclusiveGeneration(function () { return resumePending(ui); });
  }
  function resumePending(ui) {
    var say = ui || function () {};
    var d = pending();
    if (!d) return Promise.resolve(null);
    var state = { previewId: d.previewId || d.id, refineId: d.stage === 'refine' ? d.id : null,
      deliveryId: d.id, prompt: d.prompt, resumed: true, designCode: d.designCode, topperRecipe:d.topperRecipe,
      opts: savedOptions(d.opts) };
    say('picking up the generation that was running when the page closed\u2026');
    return waitFor(d.id, function (st, p) {
      say((d.stage === 'refine' ? 'Texture: ' : 'Preview: ') + String(st).toLowerCase() + ' ' + (p || 0) + '% (resumed)');
    }).then(function (t) {
      state.preview = t; state.task = t;
      say('Downloading the mesh\u2026');
      return fetchModel(t, 'glb');
    }).then(function (buf) {
      state.glb = buf;
      return state;
    }).catch(function (e) {
      /* ⚠️ ONLY FORGET WHAT CANNOT COME BACK. This used to forget() on ANY
         failure, and the failure it was written for is the common one: the
         phone screen locks mid-generation, the page reloads, the resume poll
         hits a three-second WiFi blip or a 429 from Meshy's edge, and the
         record for a task that is still running - and already billed - was
         deleted. Nothing could recover it afterwards; the only remedy was to
         pay for it again.

         A task is unrecoverable when Meshy says so: a 404/410 on the task
         itself, or a terminal FAILED/CANCELED status. A transport error, a
         rate limit, a 5xx, a deadline, and every fetchModel failure (those
         carry e.modelUrl - the model exists, this browser just cannot read
         it) all leave the record alone. generate() already has this rule: it
         forgets only once the bytes are in hand. */
      if (terminal(e)) forget(d.id);
      throw e;
    });
  }

  function generate(prompt, opts, ui) {
    // Keep the submitted settings even if the editor changes while it waits.
    var o = Object.assign({}, opts || {}), say = ui || function () {};
    var state = { opts: savedOptions(o), designCode: savedDesignCode(o.designCode), topperRecipe:savedTopperRecipe(o.topperRecipe), prompt: prompt };
    return exclusiveGeneration(function () {
      requireNoPending();
      say('Asking Meshy for a preview…');
      return createPreview(prompt, o).then(function (id) {
      state.previewId = id;
      state.deliveryId = id;
      remember(id, prompt, o);
      return waitFor(id, function (st, p) { say('Preview: ' + st.toLowerCase() + ' ' + (p || 0) + '%'); });
    }).then(function (t) {
      state.preview = t;
      if (!o.refine) return t;
      say('Preview done - refining for texture…');
      return refine(state.previewId).then(function (rid) {
        state.refineId = rid;
        state.deliveryId = rid;
        remember(rid, prompt, o, state.previewId, 'refine');
        return waitFor(rid, function (st, p) { say('Texture: ' + st.toLowerCase() + ' ' + (p || 0) + '%'); });
      });
    }).then(function (t) {
      state.task = t;
      say('Downloading the mesh…');
      return fetchModel(t, 'glb').then(function (buf) {
        state.glb = buf;
        // The caller acknowledges only after the parsed model is safely saved.
        // A parser/assembly/IndexedDB failure must not lose its paid task ID.
        return state;
      });
    }).catch(function (e) {
      if (state.deliveryId && terminal(e)) forget(state.deliveryId);
      throw e;
    });
    });
  }

  function generateTexture(previewId, opts, ui) {
    var o = Object.assign({}, opts || {}), say = ui || function () {};
    var state = { previewId: previewId, prompt: o.prompt || '', opts: savedOptions(o) };
    return exclusiveGeneration(function () {
      requireNoPending();
      say('Adding texture to the accepted preview…');
      return refine(previewId).then(function (id) {
        state.refineId = id; state.deliveryId = id;
        remember(id, state.prompt, o, previewId, 'refine');
        return waitFor(id, function (st, p) { say('Texture: ' + String(st).toLowerCase() + ' ' + (p || 0) + '%'); });
      }).then(function (t) {
        state.task = t;
        return fetchModel(t, 'glb');
      }).then(function (buf) { state.glb = buf; return state; })
        .catch(function (e) { if (state.deliveryId && terminal(e)) forget(state.deliveryId); throw e; });
    });
  }

  /* ---- generated mesh -> the slicer ------------------------------------ */
  function intoSlicer(glbBuffer, name, targetHeightMm, flatBase) {
    if (!root.meshyParseGLB) throw new Error('GLB reader missing.');
    var parsed = root.meshyParseGLB(glbBuffer);
    var health = root.meshHealth ? root.meshHealth(parsed.positions) : null;

    // Scale HERE, not at the slicer: a generated mesh arrives in whatever unit
    // the generator felt like, and "fit" alone would leave a microscopic model
    // untouched because it already fits.
    var pos = parsed.positions;
    if (root.modelTools) {
      var size = health ? health.size : null;
      if (!size) {
        var mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
        for (var i = 0; i < pos.length; i += 3)
          for (var k = 0; k < 3; k++) {
            if (pos[i + k] < mn[k]) mn[k] = pos[i + k];
            if (pos[i + k] > mx[k]) mx[k] = pos[i + k];
          }
        size = { x: mx[0] - mn[0], y: mx[1] - mn[1], z: mx[2] - mn[2] };
      }
      var sc = targetHeightMm
        ? root.modelTools.manualScale(size, { heightMm: targetHeightMm, flatBase: !!flatBase })
        : root.modelTools.autoScale(size, { mode: 'fill', flatBase: !!flatBase });
      if (sc && sc.ok && sc.scale && sc.scale !== 1) {
        var out = new Float32Array(pos.length);
        for (var j = 0; j < pos.length; j++) out[j] = pos[j] * sc.scale;
        pos = out;
      }
      parsed.appliedScale = sc;
    }

    if (!root.slicerLoadMesh) throw new Error('Slicer hook missing.');
    var okLoaded = root.slicerLoadMesh(pos, (name || 'meshy') + '.glb', glbBuffer.byteLength);
    if (!okLoaded) throw new Error('The slicer engine is not loaded yet - open the STL slicer card once, then retry.');
    return { parsed: parsed, health: health, positions: pos };
  }

  /* Is it the network, or is it Meshy? The message above cannot tell them
     apart, and the difference decides what the owner does next: fix the WiFi,
     or fix the key. So ask twice - once at a host that is always up and needs
     no key, and once at Meshy itself.

     The first request is deliberately no-cors: the answer is not read, only
     whether it completes, which is all that is needed to know the device has a
     route out. Nothing here sends the key anywhere it does not already go. */
  function probe() {
    var status = keyStatus();
    var out = { internet: null, meshy: null, key: status.stored, storageError: status.error };
    var t0 = Date.now();
    return fetch('https://cloudflare-dns.com/dns-query?name=api.meshy.ai&type=A',
                 { headers: { accept: 'application/dns-json' } })
      .then(function (r) { out.internet = r.ok; return r.json().catch(function () { return null; }); })
      .catch(function () { out.internet = false; return null; })
      .then(function (dns) {
        out.resolves = !!(dns && dns.Answer && dns.Answer.length);
        if (!out.internet) return null;
        /* A GET to the tasks list: cheap, generates nothing, and its STATUS is
           the answer - 200 fine, 401 the key is wrong, 402 out of credits. */
        /* ⚠️ NO KEY IS NOT A REFUSAL. meshyFetch rejects at its first line when
           nothing is stored - "No Meshy API key set." - before any request
           leaves the browser, and that rejection used to land in out.meshy and
           come back out as "Reached Meshy, and it refused". Nothing was
           reached and nothing refused. It is the sentence the owner acts on,
           so it has to be about the thing that is actually wrong. */
        if (out.storageError && !PROXY) { out.meshy = 'storage unavailable'; return null; }
        if (!out.key && !PROXY) { out.meshy = 'no key'; return null; }
        return meshyFetch('/text-to-3d?page_size=1')
          .then(function () { out.meshy = 'ok'; })
          .catch(function (e) {
            out.meshy = e && e.offline ? 'unreachable' : (e && e.message) || 'refused';
          });
      })
      .then(function () {
        out.ms = Date.now() - t0;
        out.verdict = out.storageError && !PROXY ? out.storageError : !out.internet
          ? 'The browser could not complete the internet connection check. Check its connection, blockers and DNS service; this does not prove the internet is unavailable.'
          : out.meshy === 'no key'
            ? 'The connection check succeeded. No Meshy key is stored at this printer address in this browser - paste one above.'
          : out.meshy === 'ok'
            ? 'Reachable, and the key works.'
            : out.meshy === 'unreachable'
              ? 'Meshy could not be reached from this browser. Check the connection, browser blockers and Meshy service status.'
              : 'The Meshy check failed: ' + out.meshy;
        return out;
      });
  }

  root.meshy = {
    setKey: setKey, removeKey: removeKey, keyStatus: keyStatus,
    hasKey: function () { return keyStatus().stored; },
    probe: probe,
    setProxy: function (p) { PROXY = p || null; },
    createPreview: createPreview, refine: refine, task: task, waitFor: waitFor,
    fetchModel: fetchModel, textureUrl: textureUrl,
    generate: generate, generateTexture: generateTexture, intoSlicer: intoSlicer,
    resume: resume, pending: pending, acknowledge: acknowledge,
    busy: function () { return generationActive; }, forgetPending: forget
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.meshy;
})(typeof window !== 'undefined' ? window : globalThis);
