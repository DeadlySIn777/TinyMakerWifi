/* THE BROWSER-SIDE TEST, because eleven node suites cannot see a display:none.
 *
 * scripts/dev/test_*.mjs prove the geometry: manifold meshes, stem clearances,
 * plate counts, prompt composition. Not one of them can catch the bugs that
 * actually reached the owner this week - a room squeezed into half the page by
 * a leftover grid, a keycap card that threw before it drew, "Send to slicer"
 * loading a mesh into a card with display:none, a legend inset upscaled 3.2x,
 * a clipboard write that never happened. Those live in the DOM, and the only
 * thing that finds them is driving the DOM.
 *
 * HOW TO RUN IT
 *   python scripts/assemble_dashboard.py -o /some/dir/index.html
 *   cp scripts/dev/selftest.js /some/dir/
 *   python -m http.server 8971 --directory /some/dir
 * then in that page's console:
 *   fetch('/selftest.js').then(r=>r.text())
 *     .then(s=>new Function('return ('+s+')')()).then(console.log)
 *
 * The wrapping parens are not decoration: `new Function('return ' + src)` with
 * a comment on the first line hits automatic semicolon insertion and silently
 * returns undefined.
 *
 * The API calls 404 against a static server and that is expected - this tests
 * the interface, not the printer. It reports FAILURES and a count, never a wall
 * of passes: a green run is one line, and a test that cannot fail is worse than
 * no test, which is why it prints how many checks it actually ran.
 */
(async function () {
  const $ = id => document.getElementById(id);
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const fails = [], notes = [];
  const errs = [];
  window.addEventListener('error', e => errs.push(String(e.message)));
  window.addEventListener('unhandledrejection', e => errs.push('rejection: ' + (e.reason && e.reason.message)));

  let ran = 0;
  const check = (name, cond, detail) => { ran++; if (!cond) fails.push(name + (detail ? ' — ' + detail : '')); };
  const hush = () => { const s = $('statusMsg'); if (s) s.classList.add('hidden'); };

  // ---- the four rooms -----------------------------------------------------
  for (const room of ['monitor', 'create', 'library', 'settings']) {
    window.studioGo(room);
    await wait(280); hush();
    const tab = document.querySelector(`#stNav .stTab[data-room="${room}"]`);
    check(`tab ${room} marks itself active`, tab && tab.classList.contains('on'));
    check(`tab ${room} says so to a screen reader`, tab && tab.getAttribute('aria-selected') === 'true');
    if (room !== 'settings') {
      const panel = $({ monitor: 'stMonitor', create: 'stCreate', library: 'stLibrary' }[room]);
      check(`${room} room is on screen`, panel && getComputedStyle(panel).display !== 'none');
      const others = ['stMonitor', 'stCreate', 'stLibrary']
        .filter(x => x !== panel.id).map($).filter(Boolean);
      check(`${room} hides the other rooms`, others.every(o => getComputedStyle(o).display === 'none'));
    } else {
      check('settings shows its sub-nav', getComputedStyle($('stSettingsNav')).display !== 'none');
    }
  }
  window.studioGo('create'); await wait(300); hush();

  // ---- both tools ---------------------------------------------------------
  const seg = t => document.querySelector(`.stStageBar .stSeg button[data-st="${t}"]`);
  seg('model').click(); await wait(250);
  check('Models tool shows the model preview', getComputedStyle($('stModelTool')).display !== 'none');
  check('Models tool hides the keycap card', getComputedStyle($('kcCard')).display === 'none');
  seg('cap').click(); await wait(300);
  check('Keycaps tool shows the keycap card', getComputedStyle($('kcCard')).display !== 'none');
  check('Keycaps tool hides the model tool', getComputedStyle($('stModelTool')).display === 'none');

  // ---- the keyboard picker ------------------------------------------------
  const keys = [...document.querySelectorAll('#kcBoard .kcKey')];
  check('the board rendered', keys.length > 50, keys.length + ' keys');
  check('the spacebar is refused with a reason', keys.some(k => k.disabled && /mm/.test(k.textContent)));

  // a letter, a digit, and a big key
  for (const [label, wantLegend] of [['Q', 'Q'], ['7', '7'], ['Shift', '']]) {
    const k = keys.find(x => x.textContent.trim() === label && !x.disabled);
    if (!k) { notes.push('no key labelled ' + label); continue; }
    k.click(); await wait(260);
    check(`picking ${label} fills the legend`, $('kcDigit').value === wantLegend,
          'got "' + $('kcDigit').value + '" want "' + wantLegend + '"');
  }

  // ---- every step, every art mode ----------------------------------------
  keys.find(x => x.textContent.trim() === '4').click(); await wait(250);
  for (let i = 0; i < 3; i++) { $('kcNext').click(); await wait(330); }
  hush();
  check('step 4 is reached', document.querySelector('#kcSteps li.on').dataset.step === '4');
  check('the report has a time', /\d+h|\d+m/.test($('kcReport').textContent));
  check('the report names the stem slot', /slot/.test($('kcReport').textContent));
  check('the hero canvas has pixels', $('kcTop').width > 100);
  check('the legend inset is not upscaled', $('kcFlat').width >= 200,
        $('kcFlat').width + ' backing for ' + Math.round($('kcFlat').getBoundingClientRect().width) + ' css');

  // back to art and cycle the modes
  document.querySelector('#kcSteps li[data-step="3"]').click(); await wait(300);
  for (const mode of ['gen', 'lib', 'braille', 'none', 'gen']) {
    const b = document.querySelector(`#kcModes button[data-mode="${mode}"]`);
    if (!b) { notes.push('no mode button ' + mode); continue; }
    b.click(); await wait(320); hush();
    check(`art mode ${mode} paints its own pane`,
      [...document.querySelectorAll('#kcCard [data-art]')]
        .every(p => (p.getAttribute('data-art') === mode) !== p.hidden));
    check(`art mode ${mode} marks its button`, b.classList.contains('on'));
  }

  // braille actually produces dots
  document.querySelector('#kcModes button[data-mode="braille"]').click(); await wait(280);
  $('kcBraille').value = 'k';
  $('kcBraille').dispatchEvent(new Event('input', { bubbles: true }));
  await wait(600); hush();
  check('braille reports its fit', ($('kcLegendWarn').textContent || '').length > 3,
        JSON.stringify(($('kcLegendWarn').textContent || '').slice(0, 60)));
  document.querySelector('#kcModes button[data-mode="gen"]').click(); await wait(300);

  // ---- the legend switch --------------------------------------------------
  const tog = $('kcLegendOn');
  check('the legend switch exists', !!tog);
  if (tog) {
    tog.checked = false; tog.dispatchEvent(new Event('change', { bubbles: true }));
    await wait(450);
    check('turning the legend off disables the corner box', $('kcDigit').disabled);
    tog.checked = true; tog.dispatchEvent(new Event('change', { bubbles: true }));
    await wait(450);
    check('turning it back on re-enables it', !$('kcDigit').disabled);
  }

  // ---- profiles and rows --------------------------------------------------
  document.querySelector('#kcSteps li[data-step="2"]').click(); await wait(280);
  const profs = [...document.querySelectorAll('#kcProfiles .kcTile')];
  check('five profiles offered, and not the coupon', profs.length === 5,
        profs.map(p => p.textContent.trim().slice(0, 6)).join(','));
  for (const p of profs) {
    p.click(); await wait(300); hush();
    check('picking ' + p.textContent.trim().slice(0, 8) + ' keeps a valid row',
      document.querySelectorAll('#kcRows .kcTile').length >= 1);
    check('picking ' + p.textContent.trim().slice(0, 8) + ' still renders dims',
      /mm/.test($('kcDims').textContent));
  }

  // ---- the export paths ---------------------------------------------------
  document.querySelector('#kcSteps li[data-step="4"]').click(); await wait(500); hush();
  for (const id of ['kcStl', 'kcAdd', 'kcShare', 'kcComb', 'kcPaint', 'kcSlice']) {
    check('action ' + id + ' is present', !!$(id));
    check('action ' + id + ' is enabled', $(id) && !$(id).disabled);
  }

  // ---- the model reader ---------------------------------------------------
  check('the STL reader is loaded', typeof window.stlRead === 'object');
  check('the file door exists', !!$('kcFile'));
  if (window.stlRead) {
    // a real 2-triangle binary STL through the same door a drop uses
    const tris = [[0,0,0, 8,0,0, 0,8,0], [0,0,0, 0,8,0, 0,0,8]];
    const b = new ArrayBuffer(84 + 50 * tris.length), dv = new DataView(b);
    dv.setUint32(80, tris.length, true);
    let o = 84;
    for (const t of tris) { o += 12; for (const v of t) { dv.setFloat32(o, v, true); o += 4; } o += 2; }
    try {
      const r = window.stlRead.readModelFile(b, 'probe.stl');
      check('a binary STL parses', r.triangles === 2, JSON.stringify(r.format));
    } catch (e) { fails.push('a binary STL parses — threw ' + e.message); }
    try { window.stlRead.readSTL(new ArrayBuffer(10)); fails.push('a truncated file is refused'); }
    catch (e) { /* correct */ }
  }

  // ---- library ------------------------------------------------------------
  window.studioGo('library'); await wait(600); hush();
  check('the library room renders', ($('stLibrary').textContent || '').length > 20);
  check('the library has a heading', /Your designs/.test($('stLibrary').textContent));

  // ---- theme --------------------------------------------------------------
  const was = document.documentElement.getAttribute('data-theme');
  for (const t of ['light', 'dark']) {
    if (t === 'light') document.documentElement.setAttribute('data-theme', 'light');
    else document.documentElement.removeAttribute('data-theme');
    await wait(160);
    const cs = getComputedStyle(document.documentElement);
    const bg = cs.getPropertyValue('--bg').trim(), text = cs.getPropertyValue('--text').trim();
    const lum = h => { const m = h.match(/^#(..)(..)(..)$/); if (!m) return null;
      return (parseInt(m[1],16)*.299 + parseInt(m[2],16)*.587 + parseInt(m[3],16)*.114); };
    const lb = lum(bg), lt = lum(text);
    check(`${t} theme has readable contrast`, lb !== null && lt !== null && Math.abs(lb - lt) > 90,
          `bg ${bg} text ${text}`);
    for (const tok of ['--dis', '--overlay', '--banner', '--warnbg']) {
      const v = cs.getPropertyValue(tok).trim();
      if (t === 'light') {
        const l = lum(v);
        if (l !== null) check(`${tok} is light in light mode`, l > 120, tok + '=' + v);
      }
    }
  }
  if (was) document.documentElement.setAttribute('data-theme', was);
  else document.documentElement.removeAttribute('data-theme');

  window.studioGo('create'); await wait(300); hush();

  return JSON.stringify({
    checksRun: ran,
    failures: fails,
    notes: notes,
    uncaught: [...new Set(errs)].slice(0, 8),
    verdict: fails.length ? fails.length + ' BROKEN' : 'everything exercised passed'
  }, null, 1);
})()
