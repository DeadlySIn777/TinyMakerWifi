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

  function say(el, msg, warn) {
    var e = $(el); if (!e) return;
    e.textContent = msg || '';
    e.style.color = warn ? 'var(--warncol)' : '';
  }
  function busy(on) {
    ['meshyGo', 'meshyRefine', 'meshyExport', 'meshyFile'].forEach(function (id) {
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

  function loadIntoSlicer(buf, name) {
    return ensureEngine().then(function (ok) {
      if (!ok) throw new Error('Could not load the slicer engine. Open the STL slicer card once, then retry.');
      var h = window.meshy.intoSlicer(
        buf, name,
        parseFloat($('meshyHeight').value) || null,
        $('meshyFlat').checked
      );
      last = last || {};
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
      return h;
    });
  }

  // ---- generate -----------------------------------------------------------
  $('meshyGo').addEventListener('click', function () {
    var prompt = ($('meshyPrompt').value || '').trim();
    if (!prompt) { say('meshyInfo', 'Type what you want first.', true); return; }
    if (!window.meshy.hasKey()) { say('meshyInfo', 'Add a Meshy API key below, or load a .glb instead.', true); return; }
    busy(true); say('meshyInfo', ''); say('meshyHealth', '');
    window.meshy.generate(prompt, {
      polycount: parseInt($('meshyPoly').value, 10) || 30000,
      refine: false                      // preview first; texture costs credits
    }, function (m) { say('meshyState', m); })
      .then(function (state) {
        last = { previewId: state.previewId, task: state.task, textured: false };
        return loadIntoSlicer(state.glb, 'meshy');
      })
      .catch(function (e) { say('meshyState', ''); say('meshyInfo', e.message, true); })
      .then(function () { busy(false); });
  });

  // ---- refine (texture) ---------------------------------------------------
  $('meshyRefine').addEventListener('click', function () {
    if (!last || !last.previewId) return;
    busy(true);
    window.meshy.refine(last.previewId).then(function (id) {
      return window.meshy.waitFor(id, function (st, p) { say('meshyState', 'texture: ' + st.toLowerCase() + ' ' + (p || 0) + '%'); });
    }).then(function (t) {
      last.task = t; last.textured = true;
      return window.meshy.fetchModel(t, 'glb').then(function (buf) {
        return loadIntoSlicer(buf, 'meshy');
      }).then(function () {
        var tex = window.meshy.textureUrl(t);
        if (tex && window.gl3dTexMesh && last.positions) {
          return fetch(tex).then(function (r) { return r.blob(); })
            .then(function (b) { return createImageBitmap(b); })
            .then(function (img) { window.gl3dTexMesh(last.positions, null, img); })
            .catch(function () { /* preview stays untextured; not worth failing over */ });
        }
      });
    }).catch(function (e) { say('meshyInfo', e.message, true); })
      .then(function () { busy(false); });
  });

  // ---- load a local file (works with no account at all) -------------------
  $('meshyFile').addEventListener('change', function (e) {
    var f = e.target.files && e.target.files[0];
    if (!f) return;
    busy(true); say('meshyState', 'reading ' + f.name + '…'); say('meshyInfo', '');
    f.arrayBuffer().then(function (buf) {
      if (/\.stl$/i.test(f.name)) {
        return ensureEngine().then(function (ok) {
          if (!ok) throw new Error('Slicer engine not loaded.');
          var p = slicerMod.parseSTL(buf).positions;
          last = { textured: false };
          last.positions = p;
          var h = window.meshHealth ? window.meshHealth(p) : null;
          showHealth(h);
          if (!window.slicerLoadMesh(p, f.name, f.size)) throw new Error('No usable triangles.');
          say('meshyState', 'ready to slice');
        });
      }
      last = { textured: false };
      return loadIntoSlicer(buf, f.name.replace(/\.[^.]+$/, ''));
    }).catch(function (err) { say('meshyState', ''); say('meshyInfo', err.message, true); })
      .then(function () { busy(false); });
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
      if (last.glb) save(new Blob([last.glb], { type: 'model/gltf-binary' }), stamp + '.glb');
      if (last.positions) save(binarySTL(last.positions), stamp + '.stl');
      say('meshyInfo', 'Saved the GLB and the STL of exactly what is loaded. Meshy deletes its own copies after about three days.');
    } catch (e) { say('meshyInfo', e.message, true); }
  });

  // ---- key ----------------------------------------------------------------
  $('meshyKeySave').addEventListener('click', function () {
    /* setKey refuses a key that cannot go in a header rather than storing one
       that will fail on every generation with a message about the network. */
    try {
      window.meshy.setKey($('meshyKey').value || '');
      $('meshyKey').value = '';
      say('meshyInfo', window.meshy.hasKey() ? 'Key saved in this browser.' : 'Key cleared.');
      say('meshyProbe', '');
    } catch (e) {
      say('meshyInfo', e.message, true);
    }
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
        ' · key ' + (r.key ? 'stored' : 'missing') +
        ' · meshy ' + (r.meshy || '—') + ' · ' + r.ms + ' ms)',
        !(r.internet && r.meshy === 'ok'));
    }).catch(function (e) {
      say('meshyProbe', 'the check itself failed: ' + e.message, true);
    }).then(function () { testBtn.disabled = false; });
  });
})();
