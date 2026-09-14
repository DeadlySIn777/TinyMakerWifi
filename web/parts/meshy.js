/* Meshy: prompt -> mesh -> the slicer that is already here.
 *
 * The print leg is done (see slicerLoadMesh in slicer.js). This is only the
 * generation leg, and it plugs in at ONE point: Meshy hands back a GLB, and
 * meshy-glb.js already reads GLB. Nothing about slicing, supports or uploading
 * changes.
 *
 * ⚠️ UNVERIFIED AGAINST THE REAL SERVICE. Written to Meshy's documented v2
 * shape; nobody here has an API key, so no call in this file has ever received
 * a real response. Treat the endpoint paths and field names as the first thing
 * to check when it misbehaves - exactly like the UVtools invocation earlier in
 * this project, which was right in syntax and wrong in how it read the result.
 * The failure is designed to be loud: every request funnels through meshyFetch()
 * and every error carries the HTTP status and the body.
 *
 * TWO-STAGE ON PURPOSE. Meshy's preview stage returns untextured geometry
 * cheaply; refine spends the real credits on texture. So preview -> look at it
 * -> accept, and only then refine. Generating straight to textured would burn
 * credits on models you reject at a glance.
 */

(function (root) {
  'use strict';

  var API = 'https://api.meshy.ai/openapi/v2';
  var PROXY = null;          // set to e.g. 'https://tinymakerwifi.com/meshy' to
                             // route through a Worker that holds the key
  var KEY_STORE = 'tmMeshyKey';

  function key() {
    try { return localStorage.getItem(KEY_STORE) || ''; } catch (e) { return ''; }
  }
  function setKey(k) {
    try { k ? localStorage.setItem(KEY_STORE, k) : localStorage.removeItem(KEY_STORE); } catch (e) {}
  }

  /* One seam for direct-vs-proxy, so switching is a constant and not a rewrite.
     Direct needs the key in this page; the proxy keeps it server-side. The page
     is served from the printer over PLAIN HTTP on the LAN, so a key stored here
     is readable by anyone who can reach the printer - that is a real trade, and
     the card says so rather than hiding it. */
  function meshyFetch(path, opts) {
    var o = opts || {};
    var url = PROXY ? (PROXY + path) : (API + path);
    var h = { 'Content-Type': 'application/json' };
    if (!PROXY) {
      var k = key();
      if (!k) return Promise.reject(new Error('No Meshy API key set.'));
      h['Authorization'] = 'Bearer ' + k;
    }
    return fetch(url, {
      method: o.method || 'GET',
      headers: h,
      body: o.body ? JSON.stringify(o.body) : undefined
    }).then(function (r) {
      return r.text().then(function (t) {
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
    return meshyFetch('/text-to-3d', {
      method: 'POST',
      body: {
        mode: 'preview',
        prompt: String(prompt || '').slice(0, 600),
        art_style: o.artStyle || 'realistic',
        should_remesh: true,
        // Ask for the polycount we actually want rather than downloading a
        // 1.4M-triangle mesh and decimating: the browser slicer's own note says
        // ~490k triangles costs 226 MB of WASM and 22 s, and at a 128 micron
        // pixel nothing above ~300k is visible anyway.
        target_polycount: o.polycount || 30000
      }
    }).then(function (j) { return (j && (j.result || j.id)) || null; });
  }

  function refine(previewTaskId) {
    return meshyFetch('/text-to-3d', {
      method: 'POST',
      body: { mode: 'refine', preview_task_id: previewTaskId }
    }).then(function (j) { return (j && (j.result || j.id)) || null; });
  }

  function task(id) { return meshyFetch('/text-to-3d/' + encodeURIComponent(id)); }

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
          if (onTick) { try { onTick(st, (t && t.progress) || 0, t); } catch (e) {} }
          if (st === 'SUCCEEDED') return resolve(t);
          if (st === 'FAILED' || st === 'CANCELED') {
            var why = (t && t.task_error && t.task_error.message) || st;
            return reject(new Error('Meshy ' + String(st).toLowerCase() + ': ' + why));
          }
          setTimeout(step, everyMs);
        }).catch(reject);
      })();
    });
  }

  /* Fetch the GLB bytes. Kept separate from the task call because the asset
     lives on a different host with its own CORS behaviour - if this is the
     thing that breaks, it breaks HERE and the message says so. */
  function fetchModel(t, which) {
    var urls = (t && t.model_urls) || {};
    var u = urls[which || 'glb'];
    if (!u) throw new Error('That Meshy task returned no ' + (which || 'glb') + ' file.');
    var url = PROXY ? (PROXY + '/asset?u=' + encodeURIComponent(u)) : u;
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error('Could not download the model (' + r.status + '). If this is a CORS error, the Worker proxy is the fix.');
      return r.arrayBuffer();
    });
  }

  function textureUrl(t) {
    var a = (t && t.texture_urls && t.texture_urls[0]) || null;
    return a ? (a.base_color || a.baseColor || null) : null;
  }

  /* ---- the whole generation leg, as one call --------------------------- */
  function generate(prompt, opts, ui) {
    var o = opts || {}, say = ui || function () {};
    var state = {};
    say('Asking Meshy for a preview…');
    return createPreview(prompt, o).then(function (id) {
      if (!id) throw new Error('Meshy did not return a task id.');
      state.previewId = id;
      return waitFor(id, function (st, p) { say('Preview: ' + st.toLowerCase() + ' ' + (p || 0) + '%'); });
    }).then(function (t) {
      state.preview = t;
      if (!o.refine) return t;
      say('Preview done - refining for texture…');
      return refine(state.previewId).then(function (rid) {
        state.refineId = rid;
        return waitFor(rid, function (st, p) { say('Texture: ' + st.toLowerCase() + ' ' + (p || 0) + '%'); });
      });
    }).then(function (t) {
      state.task = t;
      say('Downloading the mesh…');
      return fetchModel(t, 'glb').then(function (buf) {
        state.glb = buf;
        return state;
      });
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

  root.meshy = {
    setKey: setKey, hasKey: function () { return !!key(); },
    setProxy: function (p) { PROXY = p || null; },
    createPreview: createPreview, refine: refine, task: task, waitFor: waitFor,
    fetchModel: fetchModel, textureUrl: textureUrl,
    generate: generate, intoSlicer: intoSlicer
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.meshy;
})(typeof window !== 'undefined' ? window : globalThis);
