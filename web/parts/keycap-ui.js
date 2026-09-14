/* Keycap card wiring: a keyboard you point at, then three steps.
 *
 * The board is step one because the key you pick already answers three
 * questions - its width, its row, and whether this printer can make it - and
 * answering them by pointing beats answering them in three dropdowns. The
 * shading on the board IS the build volume: solid keys lie flat, dashed keys
 * only fit leaning over with supports, and the spacebar is greyed out because
 * at 118 mm it clears the bed at no angle at all.
 *
 * Kept apart from keycap.js and keycap-icons.js so both stay node-testable.
 * This file is the only part that touches the DOM.
 */
(function () {
  'use strict';
  function $(id) { return document.getElementById(id); }
  if (!$('kcCard') || !window.keycap) return;

  var K = window.keycap, ICO = window.keycapIcons;

  /* 60% ANSI. w is width in units; row is the profile row the key sits in on a
     sculpted set (R1 at the number row down to R4 at the bottom). */
  var LAYOUT = [
    [['`',1,'R1'],['1',1,'R1'],['2',1,'R1'],['3',1,'R1'],['4',1,'R1'],['5',1,'R1'],['6',1,'R1'],
     ['7',1,'R1'],['8',1,'R1'],['9',1,'R1'],['0',1,'R1'],['-',1,'R1'],['=',1,'R1'],['Bksp',2,'R1']],
    [['Tab',1.5,'R2'],['Q',1,'R2'],['W',1,'R2'],['E',1,'R2'],['R',1,'R2'],['T',1,'R2'],['Y',1,'R2'],
     ['U',1,'R2'],['I',1,'R2'],['O',1,'R2'],['P',1,'R2'],['[',1,'R2'],[']',1,'R2'],['\\',1.5,'R2']],
    [['Caps',1.75,'R3'],['A',1,'R3'],['S',1,'R3'],['D',1,'R3'],['F',1,'R3'],['G',1,'R3'],['H',1,'R3'],
     ['J',1,'R3'],['K',1,'R3'],['L',1,'R3'],[';',1,'R3'],["'",1,'R3'],['Enter',2.25,'R3']],
    [['Shift',2.25,'R4'],['Z',1,'R4'],['X',1,'R4'],['C',1,'R4'],['V',1,'R4'],['B',1,'R4'],['N',1,'R4'],
     ['M',1,'R4'],[',',1,'R4'],['.',1,'R4'],['/',1,'R4'],['Shift',2.75,'R4']],
    [['Ctrl',1.25,'R4'],['Win',1.25,'R4'],['Alt',1.25,'R4'],['Space',6.25,'R4'],['Alt',1.25,'R4'],
     ['Win',1.25,'R4'],['Menu',1.25,'R4'],['Ctrl',1.25,'R4']]
  ];

  /* The profile the printer was running tonight. printSim was fitted against
     two real runs on it, so the minutes it reports are measured, not invented -
     but they are for THIS profile. A different resin moves them. */
  var PROFILE_ANY = {
    baseExposure: 35, baseLayers: 6, regularExposure: 14, transitionLayers: 5,
    slowLiftDistance: 1, fastLiftDistance: 2,
    slowLiftFeedrate: 40, fastLiftFeedrate: 50, dropBackFeedrate: 50
  };

  var st = { step: 1, key: null, profile: 'XDA', row: 'R3', sizeU: 1,
             icon: null, digit: '', depth: 0.55, raised: true, plate: [],
             skin: null, skinFrom: '' };
  var built = null;

  function say(id, msg, cls) {
    var e = $(id); if (!e) return;
    e.textContent = msg || '';
    e.className = 'hint' + (cls ? ' ' + cls : '');
  }

  // ---- step 1: the board --------------------------------------------------
  function drawBoard() {
    var el = $('kcBoard'); if (!el) return;
    el.innerHTML = '';
    var U = 26;                                   // px per unit
    LAYOUT.forEach(function (row) {
      var r = document.createElement('div');
      r.className = 'kcRow';
      row.forEach(function (k) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'kcKey';
        b.style.width = (k[1] * U + (k[1] - 1) * 4) + 'px';
        b.textContent = k[0];
        var fit = K.fits(K.capWidth(k[1]), K.DEPTH, 9);
        if (!fit.ok) { b.classList.add('no'); b.disabled = true;
                       b.title = fit.why; }
        else if (fit.tilt) { b.classList.add('tilt');
                             b.title = k[1] + 'u - ' + fit.why; }
        else b.title = k[1] + 'u, ' + K.capWidth(k[1]).toFixed(1) + ' mm - lies flat, no supports';
        b.addEventListener('click', function () { pickKey(k, b); });
        r.appendChild(b);
      });
      el.appendChild(r);
    });
  }

  function pickKey(k, btn) {
    Array.prototype.forEach.call($('kcBoard').querySelectorAll('.kcKey'),
      function (e) { e.classList.remove('sel'); });
    btn.classList.add('sel');
    st.key = k[0]; st.sizeU = k[1]; st.row = k[2];
    // a digit key gets its own digit for free; anything else starts blank
    st.digit = /^[0-9]$/.test(k[0]) ? k[0] : '';
    if ($('kcDigit')) $('kcDigit').value = st.digit;
    if (K.PROFILES[st.profile].uniform) st.row = Object.keys(K.PROFILES[st.profile].rows)[0];
    go(2);
  }

  // ---- steps -------------------------------------------------------------
  function go(n) {
    st.step = n;
    Array.prototype.forEach.call($('kcSteps').children, function (li) {
      var s = +li.getAttribute('data-step');
      li.classList.toggle('on', s === n);
      li.classList.toggle('done', s < n);
    });
    Array.prototype.forEach.call($('kcCard').querySelectorAll('.kcPane'), function (p) {
      p.hidden = p.getAttribute('data-pane').split(' ').indexOf(String(n)) < 0;
    });
    Array.prototype.forEach.call($('kcCard').querySelectorAll('.kcGroup'), function (g) {
      g.hidden = g.getAttribute('data-for') !== String(n);
    });
    $('kcNext').textContent = n >= 4 ? 'Done' : 'Next';
    $('kcBack').disabled = false;
    if (n >= 2) refresh();
  }

  // ---- tiles -------------------------------------------------------------
  function tiles(host, items, isOn, onPick) {
    var el = $(host); if (!el) return;
    el.innerHTML = '';
    items.forEach(function (it) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'kcTile' + (isOn(it) ? ' on' : '');
      b.innerHTML = it.sub ? (it.label + '<small>' + it.sub + '</small>') : it.label;
      if (it.title) b.title = it.title;
      b.addEventListener('click', function () { onPick(it); });
      el.appendChild(b);
    });
  }

  function drawProfiles() {
    tiles('kcProfiles', Object.keys(K.PROFILES).map(function (p) {
      var pr = K.PROFILES[p], rows = Object.keys(pr.rows);
      var h = pr.rows[rows[0]].h;
      return { id: p, label: p, sub: pr.uniform ? 'uniform' : rows.length + ' rows',
               title: pr.note };
    }), function (it) { return it.id === st.profile; }, function (it) {
      st.profile = it.id;
      var pr = K.PROFILES[it.id];
      if (!pr.rows[st.row]) st.row = Object.keys(pr.rows)[0];
      drawProfiles(); drawRows(); refresh();
    });
    say('kcProfileNote', K.PROFILES[st.profile].note);
  }

  function drawRows() {
    var pr = K.PROFILES[st.profile], rows = Object.keys(pr.rows);
    tiles('kcRows', rows.map(function (r) {
      return { id: r, label: r, sub: pr.rows[r].h + ' mm',
               title: pr.rows[r].angle + '° tilt, ' + pr.rows[r].h + ' mm at the front edge' };
    }), function (it) { return it.id === st.row; }, function (it) {
      st.row = it.id; drawRows(); refresh();
    });
  }

  // ---- the Meshy route ---------------------------------------------------
  function genBusy(on) {
    ['kcGen', 'kcGenClear', 'kcNext', 'kcBack'].forEach(function (id) {
      var e = $(id); if (e) e.disabled = !!on;
    });
    if (!on) $('kcGenClear').disabled = !st.skin;
  }

  $('kcGen').addEventListener('click', function () {
    var typed = ($('kcPrompt').value || '').trim();
    /* An icon picked from the drawn set doubles as a starting prompt - the
       wording that asks for a shallow front-facing relief rather than a hero
       prop is the difference between something that flattens onto a 13 mm
       square and something that does not. */
    var prompt = typed || (st.icon ? window.keycapSkin.promptFor(st.icon) : '');
    if (!prompt) { say('kcGenNote', 'Type what you want, or pick a drawn icon to start from.', 'bad'); return; }
    if (!window.meshy || !window.meshy.hasKey()) {
      say('kcGenNote', 'No Meshy key yet - add it under "Meshy API key" in the Generate a model card, then come back.', 'bad');
      return;
    }
    if (!window.meshyParseGLB || !window.keycapSkin) {
      say('kcGenNote', 'The GLB reader is missing from this build.', 'bad'); return;
    }
    genBusy(true);
    say('kcGenNote', 'asking Meshy\u2026');
    window.meshy.generate(prompt, { polycount: 30000, refine: false },
      function (m) { say('kcGenNote', m); })
      .then(function (state) {
        var parsed = window.meshyParseGLB(state.glb);
        st.skin = window.keycapSkin.heightField(parsed.positions, { grid: 96 });
        st.skinFrom = prompt;
        var cov = Math.round(st.skin.coverage * 100);
        say('kcGenNote', 'sampled a relief from ' + (parsed.positions.length / 9).toLocaleString() +
          ' triangles, ' + cov + '% of the frame covered' +
          (cov < 25 ? ' - that is sparse, the model may be off to one side' : ''),
          cov < 25 ? 'bad' : '');
        refresh();
      })
      .catch(function (e) { say('kcGenNote', e.message, 'bad'); })
      .then(function () { genBusy(false); });
  });

  $('kcGenClear').addEventListener('click', function () {
    st.skin = null; st.skinFrom = '';
    $('kcGenClear').disabled = true;
    say('kcGenNote', 'back to the drawn set.');
    refresh();
  });

  function drawIcons() {
    var list = [{ id: null, label: 'none' }].concat(Object.keys(ICO.ICONS).map(function (n) {
      return { id: n, label: ICO.ICONS[n].name };
    }));
    tiles('kcIcons', list, function (it) { return it.id === st.icon; }, function (it) {
      st.icon = it.id;
      // picking a drawn icon also loads its prompt, so Generate replaces it
      if (it.id && $('kcPrompt') && !$('kcPrompt').value.trim() && window.keycapSkin)
        $('kcPrompt').value = window.keycapSkin.promptFor(it.id);
      drawIcons(); refresh();
    });
  }

  // ---- the model ---------------------------------------------------------
  /* A generated skin wins over a drawn icon when there is one - that is the
     intended route, and the drawn set is the fallback that works with no
     account. Both arrive here as the same kind of function, so nothing below
     this point knows or cares which it was. */
  function relief() {
    if (st.skin) {
      var f = window.keycapSkin.reliefFromField(st.skin,
        { depth: st.depth, raised: st.raised });
      if (!st.digit) return f;
      // keep the corner digit over a generated skin: take whichever stands proud
      var d = ICO.makeRelief({ digit: st.digit }, { depth: st.depth, raised: st.raised });
      var both = function (u, v, w, h) {
        var a = f(u, v, w, h), b = d(u, v, w, h);
        return st.raised ? Math.min(a, b) : Math.max(a, b);
      };
      both.depth = st.depth; both.raised = st.raised; both.parts = [];
      return both;
    }
    if (!st.icon && !st.digit) return null;
    return ICO.makeRelief({ icon: st.icon || undefined, digit: st.digit },
                          { depth: st.depth, raised: st.raised });
  }

  function refresh() {
    var rel = null, err = null;
    try { rel = relief(); } catch (e) { err = e.message; }
    try {
      built = K.build({ profile: st.profile, row: st.row, sizeU: st.sizeU,
                        relief: rel, topGrid: 31 });
      built.relief = rel;
      built.name = (st.key || 'cap') + '-' + (st.icon || 'plain');
    } catch (e) { built = null; err = e.message; }
    drawTop(rel);
    drawSide();
    if (err) { say('kcState', err, 'bad'); } else say('kcState', '');
    dims(); legendWarn(rel); report();
  }

  /* Top view, lit. A flat plateau shades exactly like the flat cap beside it,
     so height carries part of the tone - otherwise raised artwork renders as
     line art and you cannot tell raised from engraved at a glance. */
  function drawTop(rel) {
    var c = $('kcTop'); if (!c) return;
    var g = c.getContext('2d'), W = c.width, H = c.height;
    var img = g.createImageData(W, H);
    var pr = K.PROFILES[st.profile], dd = pr.dishDepth;
    var topW = K.capWidth(st.sizeU) - 2 * pr.topInset;
    var topD = K.DEPTH - 2 * pr.topInset;
    var half = topW / 2, aspect = topW / topD;
    var tanA = Math.tan((pr.rows[st.row] || { angle: 0 }).angle * Math.PI / 180);
    function surf(u, v) {
      var dish = pr.dish === 'cylindrical' ? dd * Math.max(0, 1 - u * u)
                                           : dd * Math.max(0, 1 - (u * u + v * v));
      return dish + v * (topD / 2) * tanA + (rel ? rel(u, v) : 0);
    }
    var e = 1.4 / Math.min(W, H) * 2;
    for (var y = 0; y < H; y++) for (var x = 0; x < W; x++) {
      var u = (x + 0.5) / W * 2 - 1, v = 1 - (y + 0.5) / H * 2;
      var i = (y * W + x) * 4, m = Math.max(Math.abs(u), Math.abs(v));
      if (m > 0.995) { img.data[i] = 16; img.data[i+1] = 17; img.data[i+2] = 20; img.data[i+3] = 255; continue; }
      var gx = (surf(u + e, v) - surf(u - e, v)) / (2 * e * half);
      var gy = (surf(u, v + e) - surf(u, v - e)) / (2 * e * half * aspect);
      var L = 1 / Math.hypot(gx, gy, 1);
      var lam = Math.max(0, (gx * -0.40 + gy * 0.46 + 0.79) * L);
      var hgt = rel ? Math.max(0, Math.min(1, Math.abs(rel(u, v)) / st.depth)) : 0;
      if (rel && !st.raised) hgt = -hgt;                 // engraved reads darker
      var sh = (0.30 + 0.78 * lam) * (0.80 + 0.34 * hgt);
      var sp = Math.pow(Math.max(0, lam), 30) * 0.7;
      var edge = m > 0.965 ? 0.68 : 1;
      var base = [188, 180, 168];
      for (var k = 0; k < 3; k++)
        img.data[i + k] = Math.max(0, Math.min(255, Math.round((base[k] * sh + sp * 255) * edge)));
      img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
  }

  /* Front elevation, to scale, with the stem drawn where it actually is. This
     is the view that makes a too-short row obvious - you can see the stem
     running out of cap. */
  function drawSide() {
    var c = $('kcSide'); if (!c || !built) return;
    var g = c.getContext('2d'), W = c.width, H = c.height;
    var css = getComputedStyle(document.documentElement);
    var ink = css.getPropertyValue('--text').trim() || '#eee';
    var acc = css.getPropertyValue('--accent').trim() || '#e5484d';
    var line = css.getPropertyValue('--line2').trim() || '#333';
    g.clearRect(0, 0, W, H);
    var pr = K.PROFILES[st.profile];
    var capW = K.capWidth(st.sizeU), capH = built.mouthZ;
    var s = Math.min((W - 40) / capW, (H - 28) / capH);
    var ox = W / 2, oy = 14;
    function X(mm) { return ox + mm * s; }
    function Y(mm) { return oy + mm * s; }          // z grows downward here
    var topW = capW - 2 * pr.topInset, dd = pr.dishDepth;
    var tanA = Math.tan((pr.rows[st.row] || { angle: 0 }).angle * Math.PI / 180);

    g.strokeStyle = ink; g.lineWidth = 1.4; g.beginPath();
    // the dished top, sampled
    for (var i = 0; i <= 48; i++) {
      var u = i / 48 * 2 - 1, x = u * topW / 2;
      var dish = pr.dish === 'cylindrical' ? dd * Math.max(0, 1 - u * u)
                                           : dd * Math.max(0, 1 - u * u);
      var z = dish + (built.frontZ - (dd + 0)) * 0;  // front elevation: no y term
      if (i === 0) g.moveTo(X(x), Y(dish)); else g.lineTo(X(x), Y(dish));
    }
    g.lineTo(X(capW / 2), Y(capH));
    g.lineTo(X(-capW / 2), Y(capH));
    g.closePath(); g.stroke();

    // the cavity and the stem
    g.strokeStyle = line; g.lineWidth = 1;
    g.beginPath();
    g.moveTo(X(-capW / 2 + 1.35), Y(capH));
    g.lineTo(X(-topW / 2 + 1.35), Y(built.floorZ));
    g.lineTo(X(topW / 2 - 1.35), Y(built.floorZ));
    g.lineTo(X(capW / 2 - 1.35), Y(capH));
    g.stroke();

    g.fillStyle = acc; g.globalAlpha = 0.85;
    g.fillRect(X(-K.MX.postR), Y(built.floorZ), K.MX.postR * 2 * s, built.stemDepth * s);
    g.globalAlpha = 1;
    g.fillStyle = css.getPropertyValue('--pv').trim() || '#111';
    g.fillRect(X(-built.slotWidth / 2), Y(built.floorZ), built.slotWidth * s, built.stemDepth * s);

    g.fillStyle = css.getPropertyValue('--muted2').trim() || '#888';
    g.font = '10px system-ui,sans-serif'; g.textAlign = 'left';
    g.fillText(capH.toFixed(2) + ' mm tall', 6, H - 6);
    g.textAlign = 'right';
    g.fillText('stem ' + built.stemDepth.toFixed(2) + ' mm', W - 6, H - 6);
  }

  function dims() {
    if (!built) { say('kcDims', ''); return; }
    say('kcDims', built.size.x.toFixed(1) + ' × ' + built.size.y.toFixed(1) +
      ' × ' + built.size.z.toFixed(2) + ' mm · ' +
      built.triangles.toLocaleString() + ' triangles');
  }

  function legendWarn(rel) {
    if (!rel) { say('kcLegendWarn', ''); return; }
    var pr = K.PROFILES[st.profile];
    var topW = K.capWidth(st.sizeU) - 2 * pr.topInset, topD = K.DEPTH - 2 * pr.topInset;
    var f = ICO.checkLegendField(rel, topW, topD);
    var src = st.skin ? 'generated' : 'drawn';
    if (f.ok) say('kcLegendWarn', src + ': thinnest feature ' + f.thinnestMarkMm.toFixed(2) +
      ' mm (' + (f.thinnestMarkMm / K.PIXEL_MM).toFixed(1) + ' pixels) - holds.');
    else say('kcLegendWarn', '⚠ ' + src + ': ' + f.issues[0], 'bad');
  }

  // ---- step 4 ------------------------------------------------------------
  function report() {
    var el = $('kcReport'); if (!el || !built) return;
    var plan = built.printPlan;
    var raise = ICO.raisedTilt(built.relief, K.PROFILES[st.profile],
                               K.DEPTH - 2 * K.PROFILES[st.profile].topInset);
    var tilt = Math.max(plan.tilt || 0, raise.tilt || 0);
    var supports = !!plan.supports || !!raise.supports;
    var layers = Math.ceil((tilt ? plan.height || built.size.z : built.size.z) / 0.05);
    var est = window.printSim ? window.printSim.estimate(PROFILE_ANY, layers) : null;
    var per = K.perPlate(st.sizeU);

    var rows = [
      ['Cap', st.profile + ' ' + st.row + ' · ' + st.sizeU + 'u' + (st.key ? ' (' + st.key + ')' : '')],
      ['Size', built.size.x.toFixed(1) + ' × ' + built.size.y.toFixed(1) + ' × ' + built.size.z.toFixed(2) + ' mm'],
      ['Stem', built.stemDepth.toFixed(2) + ' mm deep · ' + built.slotWidth.toFixed(2) +
               ' mm slot (' + built.slotPixels.toFixed(1) + ' px)'],
      ['Orientation', tilt ? ('tilted ' + tilt + '°') : 'flat, top face down'],
      ['Supports', supports ? '<span class="warn">yes — on the leading edge</span>' : 'none'],
      ['Per plate', per.count + (per.count === 1 ? ' cap' : ' caps')],
      ['Layers', layers.toLocaleString() + ' at 0.05 mm'],
      ['Time', est ? est.text + ' for a full plate' : '—']
    ];
    var html = '<dl>' + rows.map(function (r) {
      return '<dt>' + r[0] + '</dt><dd>' + r[1] + '</dd>';
    }).join('') + '</dl>';

    var notes = (built.warnings || []).slice();
    if (supports && raise.supports) notes.push(raise.why);
    if (plan.tilt && plan.why) notes.push(plan.why);
    if (notes.length) html += '<div class="hint" style="margin-top:8px">' +
      notes.map(function (n) { return '• ' + n; }).join('<br>') + '</div>';
    el.innerHTML = html;
    say('kcPlate', st.plate.length ? (st.plate.length + ' cap' + (st.plate.length > 1 ? 's' : '') +
      ' on the plate') : '');
  }

  // ---- actions -----------------------------------------------------------
  function binarySTL(pos) {
    var n = pos.length / 9, buf = new ArrayBuffer(84 + n * 50), dv = new DataView(buf);
    dv.setUint32(80, n, true);
    var o = 84;
    for (var t = 0; t < n; t++) {
      o += 12;
      for (var k = 0; k < 9; k++) { dv.setFloat32(o, pos[t * 9 + k], true); o += 4; }
      o += 2;
    }
    return new Blob([buf], { type: 'model/stl' });
  }
  function save(blob, name) {
    var u = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = u; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(u); }, 4000);
  }
  function oriented() {
    if (!built) return null;
    return K.orientForPrint(built.positions, built.angle);
  }

  $('kcAdd').addEventListener('click', function () {
    if (!built) return;
    st.plate.push({ positions: oriented(), size: built.size, name: built.name });
    var lay = K.layout(st.plate);
    say('kcPlate', lay.placed.length + ' on the plate' +
      (lay.leftOver ? ', ' + lay.leftOver + ' will not fit and need another run' : '') +
      ' · ' + lay.triangles.toLocaleString() + ' triangles');
  });

  $('kcSlice').addEventListener('click', function () {
    var caps = st.plate.length ? st.plate
      : [{ positions: oriented(), size: built && built.size, name: built && built.name }];
    if (!caps[0] || !caps[0].positions) return;
    var lay = K.layout(caps);
    if (!window.slicerLoadMesh) { say('kcState', 'The slicer engine is not loaded - open the slicer card once, then retry.', 'bad'); return; }
    var ok = window.slicerLoadMesh(lay.positions, (caps.length > 1 ? 'keycaps' : caps[0].name) + '.stl',
                                   lay.positions.byteLength);
    say('kcState', ok ? ('sent ' + lay.placed.length + ' cap' + (lay.placed.length > 1 ? 's' : '') + ' to the slicer')
                      : 'the slicer would not take it', ok ? '' : 'bad');
  });

  $('kcStl').addEventListener('click', function () {
    var caps = st.plate.length ? st.plate : [{ positions: oriented(), size: built.size, name: built.name }];
    var lay = K.layout(caps);
    save(binarySTL(lay.positions), (caps.length > 1 ? 'keycap-plate' : caps[0].name) + '.stl');
    say('kcState', 'saved');
  });

  $('kcComb').addEventListener('click', function () {
    /* The one print that settles the only number in this engine that is still
       a guess. Five stems, 0.05 mm apart; keep the first that clicks on. */
    var comb = K.stemTestComb(1.15, 1.35, 0.05);
    save(binarySTL(comb.positions), 'stem-fit-test.stl');
    say('kcState', 'stem test: slots ' + comb.stems.map(function (s) { return s.slotMm.toFixed(2); }).join(', ') +
      ' mm, left to right. Keep the first that clicks on without force, then set slotClearance to it minus ' +
      K.MX.crossWide + '.');
  });

  // ---- controls ----------------------------------------------------------
  $('kcDigit').addEventListener('input', function () {
    st.digit = (this.value || '').trim().slice(0, 1); refresh();
  });
  $('kcDepth').addEventListener('input', function () {
    st.depth = parseFloat(this.value);
    $('kcDepthVal').textContent = st.depth.toFixed(2) + ' mm';
    refresh();
  });
  $('kcRaised').addEventListener('change', function () { st.raised = this.checked; refresh(); });
  $('kcNext').addEventListener('click', function () { if (st.step < 4) go(st.step + 1); });
  $('kcBack').addEventListener('click', function () { go(Math.max(1, st.step - 1)); });
  Array.prototype.forEach.call($('kcSteps').children, function (li) {
    li.addEventListener('click', function () {
      var n = +li.getAttribute('data-step');
      if (n === 1 || st.key) go(n);
    });
  });

  $('kcRaised').checked = st.raised;
  $('kcDepth').value = st.depth;
  $('kcDepthVal').textContent = st.depth.toFixed(2) + ' mm';
  drawBoard(); drawProfiles(); drawRows(); drawIcons(); go(1);
})();
