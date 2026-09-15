/* Meshy card wiring: buttons -> meshy.js -> the slicer that is already here.
 *
 * Kept apart from meshy.js so the client stays testable in node with no DOM.
 * This file is the only part that touches elements.
 */
(function () {
  'use strict';
  function $(id) { return document.getElementById(id); }
  if (!$('meshyCard')) return;                 // card not on this page

  var last = null;      // { glb, task, name, positions, health }
  var loadVersion=0;
  function requireLoad(version){
    if(version!==loadVersion){var e=new Error('Another model was opened while this one loaded. Your existing Meshy task is kept for recovery.');e.staleModel=true;throw e;}
  }
  // Library reads may wait for IndexedDB or the slicer module. Register the
  // selection before either wait so an older import cannot replace it later.
  window.meshyBeginModelOpen=function(){loadVersion++;busy(false);return loadVersion;};
  window.meshyModelLoadCurrent=function(version){return version===loadVersion;};

  function say(el, msg, warn) {
    var e = $(el); if (!e) return;
    e.textContent = msg || '';
    e.style.color = warn ? 'var(--warncol)' : '';
  }
  function busy(on) {
    ['meshyGo', 'meshyRefine', 'meshyExport', 'meshyFile', 'meshyHeight', 'meshyFlat', 'meshyPoly'].forEach(function (id) {
      var e = $(id); if (e) e.disabled = !!on;
    });
    if (!on) {
      $('meshyRefine').disabled = !(last && last.previewId && !last.textured);
      $('meshyExport').disabled = !last;
    }
  }

  /* The engine loads on demand. slicerLoadMesh returns false without it, so ask
     for it here rather than letting the user meet a silent no-op - the file
     input already does exactly this. */
  function ensureEngine() {
    if (typeof slicerMod !== 'undefined' && slicerMod) return Promise.resolve(true);
    if (typeof slicerLoadMod !== 'function') return Promise.resolve(false);
    say('meshyState', 'loading the slicer engine…');
    return Promise.resolve(slicerLoadMod()).then(function () {
      return (typeof slicerMod !== 'undefined' && !!slicerMod);
    }).catch(function () { return false; });
  }

  function showHealth(h) {
    if (!h) { say('meshyHealth', ''); return; }
    if (h.severity === 'bad')       say('meshyHealth', '⚠ ' + h.advice, true);
    else if (h.severity === 'warn') say('meshyHealth', '⚠ ' + h.summary + ' - it will usually still slice.', true);
    else                            say('meshyHealth', h.triangles.toLocaleString() + ' triangles, ' + h.summary);
  }

  function loadIntoSlicer(buf, name, metadata, version) {
    var previous = last;
    return ensureEngine().then(function (ok) {
      if (!ok) throw new Error('Could not load the slicer engine. Open the STL slicer card once, then retry.');
      requireLoad(version);
      if (last !== previous) throw new Error('Another model was opened while this one loaded. Your existing Meshy task is kept for recovery.');
      var h = window.meshy.intoSlicer(
        buf, name,
        parseFloat($('meshyHeight').value) || null,
        $('meshyFlat').checked
      );
      last = metadata || last || {};
      last.glb = buf; last.name = name;
      last.positions = h.positions; last.health = h.health;
      showHealth(h.health);
      var sc = h.parsed && h.parsed.appliedScale;
      if (sc && sc.ok) {
        var r = sc.result;
        say('meshyInfo', 'Sized to ' + r.x.toFixed(1) + ' × ' + r.y.toFixed(1) + ' × ' + r.z.toFixed(1) + ' mm'
          + (sc.fits === false ? ' - too big: ' + sc.why : '') , sc.fits === false);
      }
      say('meshyState', 'ready to slice');
      var loaded = last;
      // Colour is a display reference, so an unavailable texture must never
      // discard otherwise usable geometry or its paid task recovery record.
      return Promise.resolve().then(function () {
        return window.keycapColor && window.keycapColor.fromGLB && h.parsed
          ? window.keycapColor.fromGLB(h.parsed) : null;
      }).catch(function () { return null; }).then(function (reference) {
        requireLoad(version);
        if (last !== loaded) throw new Error('Another model was opened while this one loaded. Your existing Meshy task is kept for recovery.');
        if (reference && reference.colors) {
          loaded.sourceColors = new Float32Array(reference.colors);
          loaded.sourceColorKind = reference.kind || 'material';
        }
        return h;
      });
    });
  }

  // ---- generate -----------------------------------------------------------
  function receiveModel(state, version) {
    if (!state || !state.glb) return Promise.resolve(null);
    requireLoad(version);
    var o = state.opts || {}, prompt = state.prompt || 'Recovered model';
    if (Number.isFinite(o.heightMm) && o.heightMm > 0) $('meshyHeight').value = o.heightMm;
    if (typeof o.flatBase === 'boolean') $('meshyFlat').checked = o.flatBase;
    $('meshyPrompt').value = prompt;
    return loadIntoSlicer(state.glb, prompt, {
      previewId: state.previewId, task: state.task, textured: !!state.refineId,
      deliveryId: state.deliveryId, prompt: prompt
    }, version).then(function () { requireLoad(version);return keepInLibrary(prompt, prompt); })
      .then(function (record) {
        if (record && record.id && state.refineId) {
          say('meshyInfo', 'Geometry saved in the Library. Export the GLB to keep its texture too; task recovery remains available until then.');
        } else if (record && record.id && window.meshy.acknowledge) window.meshy.acknowledge(state.deliveryId);
        return record;
      });
  }
  function recoverModel() {
    var p = window.meshy.pending && window.meshy.pending();
    if (!p || p.from !== 'model') return Promise.resolve(null);
    var version=++loadVersion;
    busy(true); say('meshyInfo', 'Recovering the existing task; no new generation is submitted.');
    return window.meshy.resume(function (m) { if(version===loadVersion)say('meshyState', m); })
      .then(function(state){return receiveModel(state,version);})
      .catch(function (e) { say('meshyState', ''); showFail(e); })
      .then(function () { if(version===loadVersion)busy(false); });
  }
  function generateModel(prompt) {
    var version=++loadVersion;
    busy(true); say('meshyInfo', ''); say('meshyHealth', '');
    return window.meshy.generate(prompt, {
      polycount: parseInt($('meshyPoly').value, 10) || 30000,
      heightMm: parseFloat($('meshyHeight').value) || null,
      flatBase: $('meshyFlat').checked, from: 'model',
      refine: false
    }, function (m) { if(version===loadVersion)say('meshyState', m); })
      .then(function(state){return receiveModel(state,version);})
      .catch(function (e) { say('meshyState', ''); showFail(e); })
      .then(function () { if(version===loadVersion)busy(false); });
  }
  $('meshyGo').addEventListener('click', function () {
    var prompt = ($('meshyPrompt').value || '').trim();
    if (!prompt) { say('meshyInfo', 'Type what you want first.', true); return; }
    if (!window.meshy.hasKey()) {
      var keyState = paintKeyStatus();
      say('meshyInfo', keyState.error || 'Add a Meshy API key below, or load a .glb instead.', true); return;
    }
    var p = window.meshy.pending && window.meshy.pending();
    if (p) {
      if (p.from !== 'model') {
        say('meshyInfo', 'A keycap generation is waiting to be saved. Recover it in the keycap editor before starting a model.', true);
        return;
      }
      var question = 'An earlier model is waiting to be recovered or saved. Recover it without a new generation?';
      var choice = typeof uiConfirm === 'function'
        ? uiConfirm(question, { ok: 'Recover model', cancel: 'Start a new model' })
        : Promise.resolve(confirm(question));
      return Promise.resolve(choice).then(function (yes) {
        if (yes) return recoverModel();
        // Native Cancel is not consent to spend credits. The custom dialog's
        // secondary button names the action, but confirm the lost recovery
        // record explicitly for either surface before replacing paid work.
        var replace = 'Start a new paid generation and replace this model\'s recovery record? The existing model remains in your Meshy task history.';
        var confirmNew = typeof uiConfirm === 'function'
          ? uiConfirm(replace, { ok: 'Generate new model', cancel: 'Keep existing task' })
          : Promise.resolve(confirm(replace));
        return Promise.resolve(confirmNew).then(function (approved) {
          if (!approved) return;
          if (!window.meshy.forgetPending(p.id)) { say('meshyInfo', 'The saved task changed. Recover the current task before replacing it.', true); return; }
          return generateModel(prompt);
        });
      });
    }
    return generateModel(prompt);
  });
  if (typeof setTimeout === 'function') setTimeout(function () {
    // Automatic recovery is only for an untouched startup. A model selected
    // while the page loads is newer intent; its pending task stays recoverable.
    if (loadVersion===0&&window.meshy.hasKey()) recoverModel();
  }, 1500);

  /* Same reasoning as the keycap card: a model that finished and cannot be
     fetched by script is still a model, and the link is what makes it one. */
  function bboxOf(p) {
    var mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity], i, k, v;
    for (i = 0; i < p.length; i += 3) for (k = 0; k < 3; k++) {
      v = p[i + k];
      if (v < mn[k]) mn[k] = v;
      if (v > mx[k]) mx[k] = v;
    }
    return [mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]];
  }

  function modelPositions() {
    if (!last || !last.positions) return null;
    var positions = last.positions;
    // Only apply the current slicer transform when it belongs to this model.
    // Opening another tool must not rotate/scale an older model's export.
    if (typeof slicerRaw !== 'undefined' && slicerRaw === positions &&
        typeof slicerMod !== 'undefined' && slicerMod && slicerMod.place &&
        typeof slicerTr !== 'undefined') positions = slicerMod.place(positions, slicerTr);
    return new Float32Array(positions);
  }

  function keepInLibrary(name, prompt) {
    if (!window.keycapLibrary || !last || !last.positions) {
      say('meshyInfo', 'Model loaded, but the Library is unavailable. Export a copy to keep it.', true);
      return Promise.resolve(null);
    }
    /* Keep the geometry in millimetres as it is posed in the preview. Reopening
       a saved model must not auto-size or auto-orient it a second time. Copy it
       before the asynchronous save, so later edits cannot change this record. */
    var model=last, savedName=name||last.name||'model';
    var positions = modelPositions();
    var sourceColors = last.sourceColors ? new Float32Array(last.sourceColors) : null;
    var sourceColorKind = last.sourceColorKind || null;
    var thumb = null;
    try {
      var c = document.getElementById('printPreviewCanvas');
      if (c && c.width) {
        var t = document.createElement('canvas');
        t.width = 160; t.height = 160;
        t.getContext('2d').drawImage(c, 0, 0, 160, 160);
        thumb = t.toDataURL('image/jpeg', 0.72);
      }
    } catch (e) { /* a thumbnail is a nicety; the mesh is the point */ }
    /* This path DOES have millimetres: intoSlicer scales a generated mesh to
       mm before anything keeps it ("a generated mesh arrives in whatever unit
       the generator felt like"). Pass them, so the Library card is measuring
       the same object the slicer will. */
    var mm = null;
    try {
      var b = bboxOf(positions);
      mm = { sizeMm: [+b[0].toFixed(2), +b[1].toFixed(2), +b[2].toFixed(2)] };
      if (window.keycap && window.keycap.volumeMm3)
        mm.resinMl = +(window.keycap.volumeMm3(positions) / 1000).toFixed(2);
    } catch (e) { mm = null; }
    return Promise.resolve().then(function () { return window.keycapLibrary.save({
      facts: mm,
      name: savedName,
      prompt: prompt || '',
      kind: 'model',
      positions: positions,
      sourceColors: sourceColors,
      sourceColorKind: sourceColorKind,
      thumb: thumb
    }); }).then(function (rec) {
      if (!rec || !rec.id) throw new Error('the Library returned no saved record');
      if(last===model)say('meshyInfo', 'kept in the Library');
      return rec;
    }).catch(function (err) {
      if(last===model)say('meshyInfo', 'Model loaded, but saving to the Library could not be confirmed: ' + err.message + '. Export a copy to keep it.', true);
      return null;
    });
  }

  /* Library restore updates this card's export state without importing again,
     spending a generation, or creating another Library record. */
  window.meshyModelOpened = function (name, positions, record, version) {
    if(version!=null)requireLoad(version);else loadVersion++;
    last = { name: name, positions: positions, textured: false,
      sourceColors: record && record.sourceColors ? new Float32Array(record.sourceColors) : null,
      sourceColorKind: record && record.sourceColorKind || null };
    showHealth(window.meshHealth ? window.meshHealth(positions) : null);
    say('meshyState', 'ready to slice');
    say('meshyInfo', 'Loaded ' + name + ' from the Library. Saved size and pose kept.');
    busy(false);
  };

  function showFail(e) {
    var n = $('meshyInfo');
    if (!n) { return; }
    if (!e || !e.modelUrl) { say('meshyInfo', e ? e.message : 'failed', true); return; }
    n.className = 'hint warn';
    n.textContent = e.message + ' ';
    var a = document.createElement('a');
    a.href = e.modelUrl; a.target = '_blank'; a.rel = 'noopener';
    a.textContent = 'Download the model \u2192';
    a.style.cssText = 'color:var(--link);font-weight:600;white-space:nowrap';
    n.appendChild(a);
  }

  // ---- refine (texture) ---------------------------------------------------
  $('meshyRefine').addEventListener('click', function () {
    if (!last || !last.previewId) return;
    var accepted = last, version=++loadVersion;
    busy(true);
    window.meshy.generateTexture(accepted.previewId, {
      from: 'model', prompt: accepted.prompt || accepted.name || '',
      heightMm: parseFloat($('meshyHeight').value) || null, flatBase: $('meshyFlat').checked
    }, function (m) { if(version===loadVersion)say('meshyState', m); }).then(function (state) {
      return receiveModel(state,version).then(function () {
        requireLoad(version);
        var tex = window.meshy.textureUrl(state.task);
        if (tex && window.gl3dTexMesh && last.positions) {
          return fetch(tex).then(function (r) { return r.blob(); })
            .then(function (b) { return createImageBitmap(b); })
            .then(function (img) { if(version===loadVersion)window.gl3dTexMesh(last.positions, null, img); })
            .catch(function () { /* preview stays untextured; not worth failing over */ });
        }
      });
    }).catch(function (e) { showFail(e); })
      .then(function () { if(version===loadVersion)busy(false); });
  });

  // ---- load a local file (works with no account at all) -------------------
  $('meshyFile').addEventListener('change', function (e) {
    var f = e.target.files && e.target.files[0];
    if (!f) return;
    var version=++loadVersion;
    busy(true); say('meshyState', 'reading ' + f.name + '…'); say('meshyInfo', '');
    var name = f.name.replace(/\.[^.]+$/, '') || f.name;
    return f.arrayBuffer().then(function (buf) {
      requireLoad(version);
      if (/\.stl$/i.test(f.name)) {
        return ensureEngine().then(function (ok) {
          requireLoad(version);
          if (!ok) throw new Error('Slicer engine not loaded.');
          if (!window.stlRead) throw new Error('The model reader is missing from this build.');
          var p = window.stlRead.readSTL(buf).positions;
          var h = window.meshHealth ? window.meshHealth(p) : null;
          showHealth(h);
          if (!window.slicerLoadMesh(p, f.name, f.size)) throw new Error('No usable triangles.');
          last = { name: name, textured: false, positions: p, health: h };
          say('meshyState', 'ready to slice');
        });
      }
      return loadIntoSlicer(buf, name, { textured: false }, version);
    }).then(function () { requireLoad(version);return keepInLibrary(name, ''); })
      .catch(function (err) { if(version===loadVersion){say('meshyState', ''); say('meshyInfo', err.message, true);} })
      .then(function () { if(version===loadVersion)busy(false); });
  });

  // ---- export -------------------------------------------------------------
  /* Load-bearing, not a nicety: Meshy deletes API assets after about three
     days and the signed URLs rot sooner, so whatever you want to keep has to
     leave the browser now. Bundles the GLB, a binary STL of exactly what was
     sliced, and a note carrying the prompt and task id. */
  function binarySTL(pos) {
    var n = pos.length / 9;
    var buf = new ArrayBuffer(84 + n * 50), dv = new DataView(buf);
    dv.setUint32(80, n, true);
    var o = 84;
    for (var t = 0; t < n; t++) {
      dv.setFloat32(o, 0, true); dv.setFloat32(o + 4, 0, true); dv.setFloat32(o + 8, 0, true);
      for (var k = 0; k < 9; k++) dv.setFloat32(o + 12 + k * 4, pos[t * 9 + k], true);
      dv.setUint16(o + 48, 0, true);
      o += 50;
    }
    return new Blob([buf], { type: 'model/stl' });
  }
  function save(blob, name) {
    var u = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = u; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(u); }, 4000);
  }
  $('meshyExport').addEventListener('click', function () {
    if (!last) return;
    var stamp = ($('slicerName') && $('slicerName').value) || 'model';
    try {
      if (last.glb) {
        save(new Blob([last.glb], { type: 'model/gltf-binary' }), stamp + '.glb');
        if (last.deliveryId && window.meshy.acknowledge) window.meshy.acknowledge(last.deliveryId);
      }
      if (last.positions) save(binarySTL(modelPositions()), stamp + '.stl');
      say('meshyInfo', (last.glb ? 'GLB and STL downloads started. Keep the GLB to preserve any texture. ' : 'STL download started; this Library entry contains geometry only. ') + 'Check your browser downloads before closing this page.');
    } catch (e) { say('meshyInfo', e.message, true); }
  });

  // ---- key ----------------------------------------------------------------
  function paintKeyStatus() {
    var s = window.meshy.keyStatus ? window.meshy.keyStatus()
          : { available: true, stored: window.meshy.hasKey(), error: '' };
    say('meshyKeyStatus', s.error || (s.stored
      ? 'Key saved in this browser. Use Test to check it; the field stays blank.'
      : 'No key saved at this printer address in this browser.'), !s.available);
    var remove = $('meshyKeyRemove');
    if (remove) remove.disabled = !s.available || !s.stored;
    return s;
  }
  $('meshyKeySave').addEventListener('click', function () {
    /* setKey refuses a key that cannot go in a header rather than storing one
       that will fail on every generation with a message about the network. */
    try {
      var entered = $('meshyKey').value || '';
      if (!entered.trim()) {
        var s = paintKeyStatus();
        say('meshyInfo', s.error || (s.stored
          ? 'Your saved key is unchanged. Choose Test to check it.'
          : 'Paste a Meshy API key before choosing Save.'), !s.available || !s.stored);
        return;
      }
      window.meshy.setKey(entered);
      var saved = paintKeyStatus();
      if (!saved.available || !saved.stored) {
        say('meshyInfo', saved.error || 'Paste a Meshy API key before choosing Save.', true);
        return;
      }
      $('meshyKey').value = '';
      say('meshyInfo', 'Key saved in this browser. Choose Test to check it.');
      say('meshyProbe', '');
    } catch (e) {
      say('meshyInfo', e.message, true);
      paintKeyStatus();
    }
  });
  var removeKeyBtn = $('meshyKeyRemove');
  if (removeKeyBtn) removeKeyBtn.addEventListener('click', function () {
    if (!confirm('Remove the saved Meshy API key from this browser?')) return;
    try {
      window.meshy.removeKey();
      $('meshyKey').value = '';
      say('meshyInfo', 'Meshy key removed from this browser.');
      say('meshyProbe', '');
    } catch (e) { say('meshyInfo', e.message, true); }
    paintKeyStatus();
  });
  paintKeyStatus();
  if (window.addEventListener) window.addEventListener('storage', function (event) {
    if (!event.key || event.key === 'tmMeshyKey') paintKeyStatus();
  });

  /* "Failed to fetch" cannot tell you whether the network is down or the key is
     wrong, because the browser will not say. This asks both questions
     separately and prints the one sentence that decides what you do next. */
  var testBtn = $('meshyTest');
  if (testBtn) testBtn.addEventListener('click', function () {
    if (!window.meshy || !window.meshy.probe) return;
    testBtn.disabled = true;
    say('meshyProbe', 'checking…');
    window.meshy.probe().then(function (r) {
      say('meshyProbe', r.verdict + '  (internet ' + (r.internet ? 'yes' : 'no') +
        ' · key ' + (r.storageError ? 'storage unavailable' : (r.key ? 'stored' : 'missing')) +
        ' · meshy ' + (r.meshy || '—') + ' · ' + r.ms + ' ms)',
        !(r.internet && r.meshy === 'ok'));
    }).catch(function (e) {
      say('meshyProbe', 'the check itself failed: ' + e.message, true);
    }).then(function () { testBtn.disabled = false; paintKeyStatus(); });
  });
})();
