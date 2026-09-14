/* TinyMaker Studio - the shell's wiring.
 *
 * THE RULE THIS FILE OBEYS: it moves things, it does not rebuild them.
 *
 * Every card in the four rooms is the card that was already on the page.
 * appendChild relocates a live element - its id, its listeners, its
 * disabled state, its confirm() dialogs and every printer-state guard come
 * with it, because they are all attached to the element rather than to its
 * position. A redesign that re-emitted the markup would have thrown all of
 * that away and had to re-earn it one bug at a time.
 *
 * The nav does not replace the old view buttons either. #homeViewButton,
 * #configViewButton and #statsViewButton stay in the DOM, hidden, and the
 * tabs click them. openView() is not exported from the page's own scope, so
 * calling it was never an option - but more importantly, the code that
 * disables Settings during a print, that stops the layer fetch when you
 * leave, and that redraws the preview when you come back, is all hung off
 * those buttons. Delegating keeps every bit of it.
 *
 * The live mark reads the page rather than the printer. #wifiBars and
 * #layerValue are already updated on every status poll; watching them with
 * a MutationObserver costs no extra request, cannot desynchronise from what
 * the status card says, and needs nothing from a scope this file is outside
 * of. If those elements ever stop updating the mark simply stops moving -
 * it never invents a state.
 */

(function () {
  'use strict';
  function $(id) { return document.getElementById(id); }

  var nav = $('stNav');
  if (!nav || !$('homeView')) return;          // not the dashboard - do nothing

  var ROOMS = ['monitor', 'create', 'library', 'settings'];
  var room = 'monitor';

  // ---- the rooms ----------------------------------------------------------
  function mkRoom(id, cls) {
    var d = document.createElement('div');
    d.id = id; d.className = (cls || '') + ' stOff';
    return d;
  }
  var mMon = mkRoom('stMonitor'), mCre = mkRoom('stCreate'), mLib = mkRoom('stLibrary');
  var monA = document.createElement('div'), monB = document.createElement('div');
  monA.className = 'stCol'; monB.className = 'stCol';
  mMon.appendChild(monA); mMon.appendChild(monB);

  var stage = mkRoom('stStage'), panel = mkRoom('stPanel');
  stage.classList.remove('stOff'); panel.classList.remove('stOff');
  mCre.appendChild(stage); mCre.appendChild(panel);

  var home = $('homeView');
  home.appendChild(mMon); home.appendChild(mCre); home.appendChild(mLib);

  /* Move, never recreate. A missing id is not an error: parts of this page
     are built conditionally (print controls only exist when the printer has
     reported, the shop card only when it is enabled), and a studio that
     threw when one was absent would be a studio that failed on a cold
     boot. */
  function moveTo(host, id) {
    var el = typeof id === 'string' ? $(id) : id;
    if (el && host && el.parentNode !== host) host.appendChild(el);
    return el;
  }

  /* MONITOR: the machine, its card, and getting started. The status card is
     the first child of #homeLeft and has no id of its own. */
  var statusCard = $('homeLeft') && $('homeLeft').querySelector(':scope > section.card');
  moveTo(monA, statusCard);
  moveTo(monA, 'printControls');
  moveTo(monB, 'gsCard');
  moveTo(monB, 'sdSection');

  /* CREATE.

     THE FIRST CUT OF THIS LIFTED .kcStageWrap OUT OF #kcCard to make the
     big stage, and it looked exactly as bad as that deserves. A hundred and
     nine of the keycap card's rules are scoped `#kcCard .something`, so the
     moment the stage stopped being inside #kcCard it lost its layout, its
     type and its overlay positioning all at once - the two little view
     toggles over the preview became full-width red buttons, because the
     page's global `button{width:100%}` was suddenly the most specific thing
     left. Moving an element out of an id-scoped subtree silently unstyles
     it; no error, no warning, just the raw HTML with somebody else's CSS.

     So the card is not opened up. #kcCard already declares itself a
     container and already splits into a 1.25fr stage and a 1fr options
     column the moment it is 700 px wide - which is to say the large
     persistent preview with a compact panel beside it was built into the
     card and was only ever being starved of width by the page around it.
     Giving it the room is the whole fix.

     The other three cards are one tool as well - load a model, generate a
     model, slice a model - so Create shows one tool at a time and gives it
     everything. */
  moveTo(panel, 'kcCard');
  var modelBox = document.createElement('div');
  modelBox.id = 'stModelTool';
  modelBox.className = 'stOff';
  var mLeft = document.createElement('div'), mRight = document.createElement('div');
  mLeft.className = 'stCol'; mRight.className = 'stCol';
  modelBox.appendChild(mLeft); modelBox.appendChild(mRight);
  panel.appendChild(modelBox);
  moveTo(mLeft, 'printPreviewCard');
  moveTo(mRight, 'meshyCard');
  moveTo(mRight, 'slicerCard');

  /* Whatever is left in the old containers is something added since this was
     written. It goes to Create rather than vanishing - being in the wrong
     room is a nuisance, being in no room is a missing feature. */
  ['homeLeft', 'homeRight'].forEach(function (id) {
    var box = $(id); if (!box) return;
    while (box.firstElementChild) panel.appendChild(box.firstElementChild);
    box.classList.add('stOff');
  });

  // ---- which tool ---------------------------------------------------------
  var bar = document.createElement('div');
  bar.className = 'stStageBar';
  bar.innerHTML =
    "<div class='stSeg' role='group' aria-label='Tool'>" +
      "<button type='button' data-st='cap'>Keycaps</button>" +
      "<button type='button' data-st='model'>Models</button>" +
    "</div><span class='stSpacer'></span><span id='stStageMeta' class='stMeta'></span>";
  stage.appendChild(bar);

  var segs = bar.querySelectorAll('.stSeg button');
  /* stOff rather than the hidden attribute. .stSub and #stModelTool both set
     display, and a display rule beats the hidden attribute - which is how
     the settings pills ended up sitting under Monitor. One class, one rule,
     one !important, and the question never comes up again. */
  function setStage(which) {
    var capBox = $('kcCard'), modelBox = $('stModelTool');
    if (capBox) capBox.classList.toggle('stOff', which !== 'cap');
    if (modelBox) modelBox.classList.toggle('stOff', which !== 'model');
    Array.prototype.forEach.call(segs, function (b) {
      b.classList.toggle('on', b.dataset.st === which);
    });
    try { localStorage.setItem('tmStudioStage', which); } catch (e) {}
    /* Canvases size themselves to their box, and a box that was not
       displayed measured zero. Nudge whoever owns the one now on screen. */
    if (which === 'cap' && window.keycapRefresh) { try { window.keycapRefresh(); } catch (e) {} }
    if (which === 'model' && window.gl3dResetView) { try { window.gl3dResetView(); } catch (e) {} }
    window.dispatchEvent(new Event('resize'));
  }
  Array.prototype.forEach.call(segs, function (b) {
    b.addEventListener('click', function () { setStage(b.dataset.st); });
  });

  function stageMeta(text) { var e = $('stStageMeta'); if (e) e.textContent = text || ''; }
  /* The size line the keycap card already computes is the right caption for
     the stage, so it is mirrored rather than recomputed. */
  var dimsEl = $('kcDims');
  if (dimsEl && window.MutationObserver) {
    new MutationObserver(function () {
      var kc = $('kcCard');
      if (!kc || kc.classList.contains('stOff')) return;
      stageMeta(dimsEl.textContent);
    }).observe(dimsEl, { childList: true, characterData: true, subtree: true });
  }

  // ---- the tabs -----------------------------------------------------------
  function clickOld(id) { var b = $(id); if (b) b.click(); }
  var sub = $('stSettingsNav');

  function go(next, fromHash) {
    if (ROOMS.indexOf(next) < 0) next = 'monitor';
    room = next;
    Array.prototype.forEach.call(nav.querySelectorAll('.stTab'), function (t) {
      var on = t.dataset.room === next;
      t.classList.toggle('on', on);
      t.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    if (sub) sub.classList.toggle('stOff', next !== 'settings');

    if (next === 'settings') {
      /* Straight to the page's own settings view. Which one of the three it
         lands on is remembered, because Statistics and Printer are visited
         for completely different reasons. */
      var last = 'config';
      try { last = localStorage.getItem('tmStudioCfg') || 'config'; } catch (e) {}
      clickOld(last === 'stats' ? 'statsViewButton'
             : last === 'connect' ? 'connectViewButton' : 'configViewButton');
      if (sub) Array.prototype.forEach.call(sub.querySelectorAll('.stSubBtn'), function (o) {
        o.classList.toggle('on', o.dataset.view === last);
      });
    } else {
      /* ONLY WHEN THE PAGE IS NOT ALREADY HOME. Monitor, Create and Library all
         live inside #homeView, so switching between them needs nothing from the
         page's own view machinery - but this clicked #homeViewButton every
         time, including on the tab that was already active. openView('home')
         bumps fetchSlicesSeq, which aborts a layer fetch in progress, clears
         the boot-animation previews and repaints the dashboard preview. Going
         to Library - which needs nothing from the printer at all - was killing
         a slice load running in another card. */
      if (!$('homeViewButton').classList.contains('active')) clickOld('homeViewButton');
      mMon.classList.toggle('stOff', next !== 'monitor');
      mCre.classList.toggle('stOff', next !== 'create');
      mLib.classList.toggle('stOff', next !== 'library');
      if (next === 'library' && window.studioLibrary) window.studioLibrary.draw();
      /* Coming back to Create finds canvases that were not displayed while
         you were away, so they measured zero and drew nothing. */
      if (next === 'create' && window.keycapRefresh) {
        setTimeout(function () { try { window.keycapRefresh(); } catch (e) {} }, 30);
      }
      if (next === 'create') { window.dispatchEvent(new Event('resize')); }
    }
    try { localStorage.setItem('tmStudioRoom', next); } catch (e) {}
    if (!fromHash && location.hash.slice(1) !== next) {
      try { history.replaceState(null, '', '#' + next); } catch (e) {}
    }
  }
  window.studioGo = go;

  Array.prototype.forEach.call(nav.querySelectorAll('.stTab'), function (t) {
    t.addEventListener('click', function () { go(t.dataset.room); });
    /* role=tablist without aria-controls tells a screen reader these are tabs
       and then refuses to say what they open. */
    var panel = { monitor: 'stMonitor', create: 'stCreate',
                  library: 'stLibrary', settings: 'stSettingsNav' }[t.dataset.room];
    if (panel) t.setAttribute('aria-controls', panel);
    t.setAttribute('tabindex', '0');
  });
  [mMon, mCre, mLib].forEach(function (r) { r.setAttribute('role', 'tabpanel'); });

  if (sub) {
    Array.prototype.forEach.call(sub.querySelectorAll('.stSubBtn'), function (b) {
      b.addEventListener('click', function () {
        try { localStorage.setItem('tmStudioCfg', b.dataset.view); } catch (e) {}
        Array.prototype.forEach.call(sub.querySelectorAll('.stSubBtn'), function (o) {
          o.classList.toggle('on', o === b);
        });
        clickOld(b.dataset.view === 'stats' ? 'statsViewButton'
               : b.dataset.view === 'connect' ? 'connectViewButton' : 'configViewButton');
      });
    });
    /* The Shop tab only exists when the page decided it does. */
    /* THIS RACED THE CONFIG LOAD. #connectViewButton starts hidden and
       loadConfig() unhides it later, when it learns whether the shop is even
       enabled - and this read the class once, at startup, and never again. So
       the pill's visibility was decided by which of the two happened to run
       first. Watch the button instead of sampling it. */
    var cvb = $('connectViewButton'), shop = sub.querySelector("[data-view='connect']");
    if (shop && cvb) {
      var syncShop = function () {
        shop.classList.toggle('stOff', cvb.classList.contains('hidden'));
      };
      syncShop();
      if (window.MutationObserver)
        new MutationObserver(syncShop).observe(cvb, { attributes: true, attributeFilter: ['class'] });
    }
  }

  /* The old toolbar stays in the DOM and stops being visible. It is the
     thing the tabs press. */
  var oldBar = document.querySelector('.toolbar');
  if (oldBar) { oldBar.setAttribute('aria-hidden', 'true'); oldBar.style.display = 'none'; }

  /* The page can change view without the tabs - the brand mark goes home,
     the firmware badge opens Settings, a deep link arrives. Watch the old
     buttons' own active class and follow it, so the tabs never disagree
     with the page. */
  if (window.MutationObserver) {
    var watch = [['configViewButton', 'settings'], ['statsViewButton', 'settings'],
                 ['connectViewButton', 'settings'], ['homeViewButton', null]];
    watch.forEach(function (pair) {
      var b = $(pair[0]); if (!b) return;
      new MutationObserver(function () {
        if (!b.classList.contains('active')) return;
        if (pair[1] === 'settings' && room !== 'settings') {
          room = 'settings';
          /* aria-selected as well as the class: go() sets both, and this path -
             the page navigating itself, from the firmware badge or a deep link
             - set only the paint, so a screen reader was told the old tab was
             still current. */
          Array.prototype.forEach.call(nav.querySelectorAll('.stTab'), function (t) {
            var on = t.dataset.room === 'settings';
            t.classList.toggle('on', on);
            t.setAttribute('aria-selected', on ? 'true' : 'false');
          });
          if (sub) sub.classList.remove('stOff');
        } else if (pair[1] === null && room === 'settings') {
          /* THE PAGE HAS ALREADY NAVIGATED - that is why this observer fired.
             Calling go() from here made it click #homeViewButton again, running
             a second complete openView('home') for one movement: two preview
             repaints, two fetchSlicesSeq bumps. Only the tab state is out of
             date, so only the tab state is updated.

             And the storage read was bare. In a private window or with site
             data blocked, localStorage.getItem THROWS - inside a
             MutationObserver callback, where nothing catches it - and the nav
             was left showing Settings over the Monitor room. Every other
             access in this file is wrapped; this one was missed. */
          var back = 'monitor';
          try { back = localStorage.getItem('tmStudioRoom') || 'monitor'; } catch (e2) {}
          if (back === 'settings') back = 'monitor';
          room = back;
          Array.prototype.forEach.call(nav.querySelectorAll('.stTab'), function (t) {
            var on = t.dataset.room === back;
            t.classList.toggle('on', on);
            t.setAttribute('aria-selected', on ? 'true' : 'false');
          });
          if (sub) sub.classList.add('stOff');
          mMon.classList.toggle('stOff', back !== 'monitor');
          mCre.classList.toggle('stOff', back !== 'create');
          mLib.classList.toggle('stOff', back !== 'library');
        }
      }).observe(b, { attributes: true, attributeFilter: ['class'] });
    });
  }

  // ---- the wordmark -------------------------------------------------------
  /* "TinyMaker" is a bare text node sitting after the SVG, and CSS cannot
     colour half of a text node - so the two halves become two spans and the
     stylesheet takes it from there. The text node is REPLACED rather than the
     span's innerHTML rewritten, because #brandHome also carries the mark, the
     click handler that goes home and the title the live status keeps
     updating; blowing its contents away would take all three with it. */
  (function () {
    var b = $('brandHome');
    if (!b) return;
    for (var i = 0; i < b.childNodes.length; i++) {
      var n = b.childNodes[i];
      if (n.nodeType !== 3 || !/\S/.test(n.nodeValue)) continue;
      var a = document.createElement('span'); a.className = 'bmA'; a.textContent = 'TinyMaker';
      var c = document.createElement('span'); c.className = 'bmB'; c.textContent = 'Smart Studio';
      b.replaceChild(c, n);
      b.insertBefore(a, c);
      break;
    }
  })();

  /* ---- links that used to be a scroll and are now a journey -------------

     Two things in this page assume everything is in one column, because until
     the rooms existed it was. The preview card's title is a deep link into the
     SD model list, and the SD list measures itself against #homeLeft to decide
     how many rows to show. Both were silently right and are now silently wrong:
     the link opens an accordion in a room nobody is looking at, and the
     measurement reads a container this file emptied, so the list pins itself to
     the five-row fallback on every desktop.

     Neither is worth reaching into the dashboard's own code for. Take the
     traveller to the room first, and give the measurement something real to
     measure. */
  (function () {
    /* #printPreviewTitle, NOT the whole .cardHead. The card's header does two
       jobs - the title is the deep link into the SD list, and the header itself
       toggles the preview's stage size - so a listener on the header would
       hijack every resize click to change rooms. Capture phase on the title
       alone, so the room is switched before the page's own pvGo runs and its
       scroll then finds a card that is on screen. */
    var title = $('printPreviewTitle');
    if (title) title.addEventListener('click', function () {
      if (room !== 'monitor') go('monitor');
    }, true);

    /* sdFitRows measures #homeLeft to decide how many rows the SD list gets,
       and #homeLeft is an empty hidden box now - so the measurement came back
       zero and the list fell to its five-row floor on every desktop.

       The id is the contract, not the element. #homeLeft means "the left column
       of the home view", and that is exactly what the Monitor room's first
       column is - so the id moves to it. One line, and every existing reader of
       #homeLeft (this one, and anything added later) gets the right box back
       without knowing the rooms exist. Patching getBoundingClientRect onto the
       old node would have worked too, and would have been a trap for whoever
       read the DOM next and found an element whose measurements were a lie. */
    var left = $('homeLeft');
    if (left && monA) {
      left.removeAttribute('id');
      monA.id = 'homeLeft';
    }
  })();

  // ---- the mark, live -----------------------------------------------------
  /* Tag the shapes that already exist in the header logo. They were drawn
     with fixed fills and opacities; this only names them so they can be
     driven, and leaves the drawing alone. */
  var brand = $('brandHome');
  var svg = brand && brand.querySelector('svg');
  if (svg) {
    var bars = svg.querySelectorAll('rect');
    Array.prototype.forEach.call(bars, function (r, i) {
      r.classList.add('bMark');
      r.dataset.rest = r.getAttribute('opacity') || '1';
      /* The rects are authored top of the file to bottom of the picture: the
         first one is y=40, the widest and the LOWEST, because SVG y grows
         downward. Reversing the index here filled the stack from the top,
         which reads as a print running backwards. Index 0 is the bottom bar
         and the bottom bar is the first rect. */
      r.dataset.i = String(i);                    // 0 = bottom bar
    });
    var arc = svg.querySelector('path');
    if (arc) arc.classList.add('wMark');

    /* The mark carried #e8720c - the accent this product retired - so three
       orange bars sat next to a red wordmark and the page had two identities.
       One accent, at rest and lit; only the opacity ladder separates them. */
    var restBars = function () {
      Array.prototype.forEach.call(bars, function (r) {
        r.classList.remove('lit');
        r.setAttribute('opacity', r.dataset.rest);
        r.setAttribute('fill', 'var(--accent)');
      });
      brand.classList.remove('printing');
    };

    var paintBars = function (frac, printing) {
      if (!printing) { restBars(); return; }
      brand.classList.add('printing');
      Array.prototype.forEach.call(bars, function (r) {
        var idx = Number(r.dataset.i);             // 0 bottom, 2 top
        var done = frac >= (idx + 1) / bars.length;
        var part = frac > idx / bars.length && !done;
        r.classList.toggle('lit', done || part);
        r.setAttribute('fill', 'var(--accent)');
        r.setAttribute('opacity', done ? '1' : (part ? '0.8' : '0.22'));
      });
    };

    var paintWifi = function (n, offline) {
      if (!arc) return;
      arc.setAttribute('stroke',
        offline ? 'var(--dis)' : n >= 3 ? '#4da3ff' : n === 2 ? '#7fb6ff' : 'var(--warncol)');
      arc.setAttribute('opacity', offline ? '0.45' : n >= 3 ? '1' : n === 2 ? '0.8' : '0.66');
    };

    var readStatus = function () {
      var wb = $('wifiBars');
      if (wb) {
        var n = wb.querySelectorAll('i.on').length;
        var off = /offline/i.test(wb.title || '');
        paintWifi(n, off || n === 0);
      }
      /* "12 / 480 (2%)" - the percentage is only there while a job runs, so
         its absence IS the idle signal. No second source to disagree with. */
      var lv = $('layerValue'), t = lv ? (lv.textContent || '') : '';
      var pct = t.match(/\((\d+)%\)/);
      if (pct) paintBars(Math.min(1, Number(pct[1]) / 100), true);
      else {
        var pair = t.match(/(\d+)\s*\/\s*(\d+)/);
        var running = pair && Number(pair[2]) > 0 && Number(pair[1]) > 0 &&
                      Number(pair[1]) < Number(pair[2]);
        paintBars(running ? Number(pair[1]) / Number(pair[2]) : 0, !!running);
      }
      var t2 = brand.getAttribute('data-basetitle');
      if (t2 == null) { t2 = brand.title || 'Dashboard'; brand.setAttribute('data-basetitle', t2); }
      brand.title = t2 + ($('wifiBars') ? ' · ' + ($('wifiBars').title || '') : '') +
        (t ? ' · layer ' + t.trim() : '');
    };

    if (window.MutationObserver) {
      var mo = new MutationObserver(readStatus);
      ['wifiBars', 'layerValue'].forEach(function (id) {
        var e = $(id);
        if (e) mo.observe(e, { childList: true, characterData: true, subtree: true,
                              attributes: true, attributeFilter: ['class', 'title'] });
      });
    }
    readStatus();
    /* A backstop for the case where the status card is rebuilt rather than
       edited in place, which would swap the node out from under the
       observer. Cheap, and it reads the DOM rather than the network. */
    setInterval(readStatus, 4000);
  }

  // ---- open the room you were in -----------------------------------------
  var start = (location.hash || '').slice(1);
  if (ROOMS.indexOf(start) < 0) {
    try { start = localStorage.getItem('tmStudioRoom') || 'monitor'; } catch (e) { start = 'monitor'; }
  }
  var wantStage = 'cap';
  try { wantStage = localStorage.getItem('tmStudioStage') || 'cap'; } catch (e) {}
  setStage(wantStage);
  go(start, true);

  window.addEventListener('hashchange', function () {
    var h = (location.hash || '').slice(1);
    if (ROOMS.indexOf(h) >= 0 && h !== room) go(h, true);
  });
})();
