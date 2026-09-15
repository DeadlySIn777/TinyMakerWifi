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

  // The header must describe the selected tool, including after an inactive
  // keycap render finishes while the user is looking at an imported model.
  {
    const keyDims=$('kcDims'),modelDims=$('slicerDims'),meta=$('stStageMeta');
    const oldKey=keyDims.textContent,oldModel=modelDims.textContent;
    keyDims.textContent='Keycap fixture: 18 x 18 x 9 mm';
    modelDims.textContent='Miniature fixture: 12 x 13 x 27 mm';
    seg('model').click(); await wait(100);
    check('Models header uses the imported model dimensions',meta.textContent===modelDims.textContent);
    keyDims.textContent='Late keycap render: 18 x 18 x 12 mm'; await wait(100);
    check('inactive keycap updates cannot overwrite the Models header',meta.textContent===modelDims.textContent);
    modelDims.textContent='Rescaled miniature: 12 x 13 x 28 mm'; await wait(100);
    check('Models header follows model rescaling',meta.textContent===modelDims.textContent);
    modelDims.textContent=''; await wait(100);
    check('Models header clears when the model dimensions clear',meta.textContent==='');
    seg('cap').click();
    check('returning to Keycaps immediately restores its own dimensions',meta.textContent===keyDims.textContent);
    keyDims.textContent=oldKey;modelDims.textContent=oldModel;await wait(160);
  }

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
  /* ⚠️ START WHERE YOU MEAN TO START. "Click Next three times" only reaches
     step 4 from step 1, and the card now restores the step the owner left off
     on - so a session sitting on step 4 turned the first Next into a real Send
     to slicer, which hands off to the Models tool and hid the card for the rest
     of the run. Nine checks failed on a card that was working. A test may not
     depend on what a previous session left in localStorage. */
  document.querySelector('#kcSteps li[data-step="1"]').click(); await wait(300);
  check('the wizard starts where it was told to',
        document.querySelector('#kcSteps li.on').dataset.step === '1');
  for (let i = 0; i < 3; i++) { $('kcNext').click(); await wait(330); }
  hush();
  check('step 4 is reached', document.querySelector('#kcSteps li.on').dataset.step === '4');
  check('the report has a time', /\d+h|\d+m/.test($('kcReport').textContent));
  check('the report names the stem slot', /slot/.test($('kcReport').textContent));
  check('the hero canvas has pixels', $('kcTop').width > 100);
  /* The inset re-renders at display size once nothing has moved for 520 ms
     (see refresh()'s `sharpen`), so this has to outwait it. It used to pass
     without waiting for a reason that was itself a bug: the card was
     already at step 4, so the three Next clicks did nothing at all and the
     timer had fired long before. A green check standing on a dead button. */
  await wait(750);
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

  /* EVERY STEP MUST HAVE CONTROLS. Moving the key picker in beside the stage
     left its <div> unclosed, so groups 2, 3 and 4 became CHILDREN of group 1 -
     and hiding group 1 hid all of them. Steps 2 and 3 rendered a stage and an
     empty column, and the node suites saw nothing wrong because the ids all
     still existed. This walks every step and demands something on screen. */
  for (const n of ['1', '2', '3', '4']) {
    document.querySelector('#kcSteps li[data-step="' + n + '"]').click();
    await wait(360); hush();
    const g = document.querySelector('#kcCard .kcGroup[data-for="' + n + '"]');
    check('step ' + n + ' has a group', !!g);
    check('step ' + n + ' shows it', !!(g && g.offsetParent));
    check('step ' + n + ' has controls in it',
      !!(g && g.querySelector('button, input, textarea, .kcTile, .kcKey')),
      g ? g.querySelectorAll('button, input, textarea, .kcTile, .kcKey').length + ' controls' : '-');
    check('step ' + n + ' does not nest the others',
      !!(g && !g.querySelector('.kcGroup')));
  }
  /* And the stage never leaves - that was the point of the move. */
  for (const n of ['1', '2', '3', '4']) {
    document.querySelector('#kcSteps li[data-step="' + n + '"]').click();
    await wait(320);
    const stage = document.querySelector('#kcCard .kcStage');
    check('the preview is on screen at step ' + n, !!(stage && stage.offsetParent));
  }

  // ---- the legend switch --------------------------------------------------
  const tog = $('kcLegendOn');
  check('the legend switch exists', !!tog);
  document.querySelector('#kcSteps li[data-step="3"]').click(); await wait(280);
  check('the legend switch is visible on the Art step', !!tog && tog.checkVisibility());
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

  // Clear the actual queue, then prove a fresh addition starts at one again.
  check('Clear plate is present', !!$('kcClearPlate'));
  if ($('kcClearPlate')) {
    $('kcClearPlate').click(); $('kcAdd').click(); await wait(300);
    check('Add to plate queues one cap', /^1 on the plate/.test($('kcPlate').textContent));
    $('kcClearPlate').click();
    check('Clear plate confirms the empty queue', /Plate cleared/.test($('kcPlate').textContent));
    $('kcAdd').click(); await wait(300);
    check('adding after Clear starts at one, not two', /^1 on the plate/.test($('kcPlate').textContent));
    $('kcClearPlate').click();
  }

  /* THE LAST STEP'S BUTTON DOES SOMETHING. It used to be renamed to "Done" and
     then fall through the `st.step < 4` guard - the biggest, reddest control on
     the card, wired to nothing. Pressing it is the forward action of the step
     it is on, which is Send to slicer, and that hands off to the Models tool
     where the slicer actually lives. */
  {
    check('the last step has a forward action, not a label',
          /slicer/i.test($('kcNext').textContent), JSON.stringify($('kcNext').textContent));
    const before = $('kcCard').className;
    $('kcNext').click(); await wait(900); hush();
    const cap = document.querySelector(".stStageBar .stSeg button[data-st='cap']");
    const moved = getComputedStyle($('stModelTool')).display !== 'none';
    const said = ($('kcState').textContent || '').length > 0;
    check('pressing it does something visible', moved || said,
          'model tool ' + (moved ? 'shown' : 'hidden') + ', said ' + JSON.stringify(($('kcState').textContent || '').slice(0, 50)));
    cap.click(); await wait(400); hush();
    check('and the keycap card comes back', getComputedStyle($('kcCard')).display !== 'none', before);
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

  /* A SCALED KEYCAP MAY NOT REACH THE PRINTER. The slicer's auto-fit shrinks
     whatever runs off the plate, which is right for a miniature and fatal for a
     cap: 19% off a 1.23 mm cross slot is a cap that will not go on a switch.
     The keycap card hands its mesh over with noScale, and slicerButtons keeps
     Send to printer off for anything that had to be shrunk. */
  {
    const send = $('slicerSend');
    check('the slicer has a send button to guard', !!send);
    if (send && typeof slicerLoadMesh === 'function') {
      /* Drive the flag directly rather than slicing a deliberately oversized
         plate - the point is that the BUTTON obeys it, and slicing a 46 mm
         plate in a test would cost fifteen seconds to prove the same thing. */
      const had = (typeof slicerScaleBlocked !== 'undefined') ? slicerScaleBlocked : null;
      check('the guard exists at all', had !== null,
            'slicerScaleBlocked is ' + (had === null ? 'undefined' : String(had)));
      if (had !== null) {
        /* The TITLE is the discriminator, not `disabled`. With no mesh
           loaded the button is disabled anyway, so asserting on disabled
           alone would pass whether the guard existed or not - and a check
           that cannot fail is worse than no check. Only the scale guard
           writes that sentence. */
        slicerScaleBlocked = true;
        slicerButtons(true);
        check('a scaled part cannot be sent', send.disabled === true);
        check('and the button says why, in the owner’s words',
              /scaled/i.test(send.title || '') && /switch/i.test(send.title || ''),
              JSON.stringify((send.title || '').slice(0, 70)));
        slicerScaleBlocked = false;
        slicerButtons(true);
        check('and the refusal lifts when nothing was scaled',
              !/scaled/i.test(send.title || ''),
              JSON.stringify((send.title || '').slice(0, 70)));
      }
    } else {
      notes.push('the slicer module is not loaded, so the scale guard was not exercised');
    }
  }

  /* THE LIBRARY MEASURES THE CAP, NOT THE RAW FIGURE. A generated mesh arrives
     in the generator's own units - typically a 1 x 1 x 1 box - and the card
     used to print that as "1x1x1 mm / 0.00 ml" for a design that really makes
     an 18 x 18 x 17.5 mm cap out of 1.54 ml. The seated cap's own numbers are
     taken at save time and travel with the record. */
  if (window.keycapLibrary) {
    const tiny = new Float32Array([0,0,0, 1,0,0, 0,1,0]);   // one triangle, 1 unit across
    let rec = null;
    try {
      rec = await window.keycapLibrary.save({
        name: 'selftest-facts', prompt: 'selftest', kind: 'sculpt',
        positions: tiny,
        facts: { sizeMm: [18, 18, 17.5], resinMl: 1.54, profile: 'DSA', row: 'R3', sizeU: 1 }
      });
    } catch (e) { fails.push('the library would not save a record - ' + e.message); }
    if (rec) {
      const got = await window.keycapLibrary.get(rec.id).catch(() => null);
      check('the caller\u2019s millimetres are kept', !!(got && got.facts && got.facts.sizeMm),
            JSON.stringify(got && got.facts));
      check('and they are the CAP, not the 1-unit mesh',
            !!(got && got.facts && got.facts.sizeMm[0] === 18));
      check('the resin figure is the cap\u2019s too',
            !!(got && got.facts && got.facts.resinMl === 1.54));
      check('and the raw extent is kept separately, unlabelled as mm',
            !!(got && got.facts && got.facts.sizeRaw && got.facts.sizeRaw[0] === 1),
            JSON.stringify(got && got.facts && got.facts.sizeRaw));
      /* A record saved with no facts must not invent millimetres. */
      let bare = null;
      try {
        bare = await window.keycapLibrary.save({
          name: 'selftest-nofacts', prompt: 'selftest', kind: 'sculpt', positions: tiny });
      } catch (e) {}
      if (bare) {
        const b2 = await window.keycapLibrary.get(bare.id).catch(() => null);
        check('a record with no facts has no millimetres at all',
              !!(b2 && b2.facts && b2.facts.sizeMm === undefined),
              JSON.stringify(b2 && b2.facts));
        await window.keycapLibrary.remove(bare.id).catch(() => {});
      }
      await window.keycapLibrary.remove(rec.id).catch(() => {});
    }
  }

  // ---- library ------------------------------------------------------------
  /* THE LIBRARY OPENS THE RIGHT TOOL. "Open in Create" changed rooms and left
     whichever tool was last used on screen - so with Models remembered, the
     design loaded into a card with display:none and the button looked dead. */
  {
    const modelSeg = document.querySelector(".stStageBar .stSeg button[data-st='model']");
    if (modelSeg) { modelSeg.click(); await wait(250); }     // the wrong tool, on purpose
    if (window.studioStage) {
      window.studioStage('cap'); await wait(250);
      check('the shell can be told which tool to show',
            getComputedStyle($('kcCard')).display !== 'none');
    } else {
      fails.push('the shell exposes no way to pick a tool (studioStage)');
    }
  }
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
