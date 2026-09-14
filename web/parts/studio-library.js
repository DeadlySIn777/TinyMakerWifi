/* The Library room: past designs, and what is actually known about them.
 *
 * It is ONLY past designs. The built-in shapes I drew by hand used to sit
 * under a disclosure here and they are gone - Meshy designs the art, and a
 * shelf of my own polylines is not what a library of your work is for. The
 * SD card is not here either: what is on the printer's card is the
 * printer's business and lives in Monitor.
 *
 * WITH INFO, which is the part the old shelf missed. A thumbnail and a name
 * tell you which one it is and nothing about whether you want it: a design
 * is worth reopening because of what it costs in resin, how long the plate
 * takes, whether it leans and needs supports, how many triangles survived
 * and whether it can be rebuilt from its code or only from its stored mesh.
 * All of that is either recorded at save time or computable from the mesh
 * that is already in hand, so none of it costs a request.
 *
 * Reads through keycapLibrary, which owns the IndexedDB store. Nothing here
 * touches the database directly, so the two cannot drift.
 */

(function (root) {
  'use strict';
  function $(id) { return document.getElementById(id); }

  var HOST = 'stLibrary';
  var picked = null;

  function fmtDate(ms) {
    if (!ms) return '—';
    var d = new Date(ms), now = Date.now(), age = now - ms;
    if (age < 36e5) return Math.max(1, Math.round(age / 6e4)) + ' min ago';
    if (age < 864e5) return Math.round(age / 36e5) + ' h ago';
    if (age < 6048e5) return Math.round(age / 864e5) + ' d ago';
    return d.toLocaleDateString();
  }
  function fmtBytes(b) {
    if (!b) return '—';
    return b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.round(b / 1024) + ' KB';
  }

  /* These came out as a row of em-dashes on every card, because this read
     rec.positions and list() does not return them - it cannot, or drawing the
     grid would mean holding every mesh in memory at once. The measurements are
     taken at save time now and travel with the summary, so a card costs a few
     numbers rather than a megabyte. positions is still honoured for a record
     handed over whole (get()), and triangles alone is enough for the exact
     storage figure on anything saved before the facts existed. */
  function facts(rec) {
    var out = { triangles: rec.triangles || 0 };
    if (rec.facts) {
      out.resinMl = rec.facts.resinMl;
      out.sizeMm = rec.facts.sizeMm;
      out.bytes = rec.facts.bytes;
    } else if (rec.positions && root.keycapLibrary && root.keycapLibrary.measure) {
      var m = root.keycapLibrary.measure(rec.positions);
      if (m) { out.resinMl = m.resinMl; out.sizeMm = m.sizeMm; out.bytes = m.bytes; }
    }
    /* A mesh is 9 floats a triangle, so this is exact even with no facts. */
    if (!out.bytes) out.bytes = out.triangles * 9 * 4;
    return out;
  }

  function card(rec) {
    var f = facts(rec);
    var el = document.createElement('div');
    el.className = 'stLibCard' + (picked === rec.id ? ' on' : '');

    if (rec.thumb) {
      var img = document.createElement('img');
      img.className = 'stLibShot'; img.alt = ''; img.loading = 'lazy'; img.src = rec.thumb;
      el.appendChild(img);
    } else {
      var no = document.createElement('div');
      no.className = 'stLibShot none';
      no.textContent = 'no preview kept';
      el.appendChild(no);
    }

    var body = document.createElement('div');
    body.className = 'stLibBody';
    var h = document.createElement('h3');
    h.className = 'stLibName'; h.textContent = rec.name || 'design';
    h.title = rec.name || '';
    body.appendChild(h);

    if (rec.prompt) {
      var pr = document.createElement('p');
      pr.className = 'stLibPrompt';
      pr.textContent = rec.prompt;
      pr.title = rec.prompt;
      body.appendChild(pr);
    }

    var fl = document.createElement('div');
    fl.className = 'stLibFacts';
    function row(label, value, title) {
      var d = document.createElement('div');
      d.innerHTML = '<span></span><b></b>';
      d.firstChild.textContent = label;
      d.lastChild.textContent = value;
      if (title) d.title = title;
      fl.appendChild(d);
    }
    row('made', fmtDate(rec.at));
    row('triangles', f.triangles ? f.triangles.toLocaleString() : '—');
    row('resin', f.resinMl != null ? f.resinMl.toFixed(2) + ' ml' : '—',
        'solid volume of the mesh, before supports');
    row('size', f.sizeMm
        ? f.sizeMm.map(function (v) { return v.toFixed(0); }).join('×') + ' mm' : '—');
    row('kind', rec.kind || 'sculpt');
    row('stored', fmtBytes(f.bytes));
    body.appendChild(fl);
    el.appendChild(body);

    var actions = document.createElement('div');
    actions.className = 'stLibRow';

    var use = document.createElement('button');
    use.type = 'button'; use.className = 'go'; use.textContent = 'Open in Create';
    use.title = 'Puts this exact mesh back on the cap. No generation is spent.';
    use.addEventListener('click', function () { open(rec.id); });
    actions.appendChild(use);

    if (rec.design && root.keycapShare) {
      var sh = document.createElement('button');
      sh.type = 'button'; sh.textContent = 'Code';
      sh.title = 'Copy the design code so somebody else can open the same cap';
      sh.addEventListener('click', function () {
        /* navigator.clipboard does not exist on an insecure origin, and this
           page is served over plain HTTP - so the old `if (navigator.clipboard)
           { write(); ok = true; }` set ok BEFORE the promise resolved and said
           "Copied" whether or not anything was. keycapCopyText falls back to
           execCommand and reports what actually happened. */
        var done = function (ok) {
          sh.textContent = ok ? 'Copied' : 'Select it';
          if (!ok) note('Could not reach the clipboard on a plain-HTTP page. ' +
                        'The code is: ' + rec.design);
          setTimeout(function () { sh.textContent = 'Code'; }, 2000);
        };
        if (root.keycapCopyText) root.keycapCopyText(rec.design).then(done);
        else done(false);
      });
      actions.appendChild(sh);
    }

    var del = document.createElement('button');
    del.type = 'button'; del.className = 'del'; del.textContent = 'Delete';
    /* Asked for, every time. A generation costs credits and a minute, and
       this is the only copy of it. */
    del.addEventListener('click', function () {
      if (!confirm('Delete "' + (rec.name || 'this design') +
                   '"? The model is stored only here, and this cannot be undone.')) return;
      root.keycapLibrary.remove(rec.id).then(draw);
    });
    actions.appendChild(del);
    el.appendChild(actions);
    return el;
  }

  function open(id) {
    if (!root.keycapLibrary) return;
    root.keycapLibrary.get(id).then(function (rec) {
      if (!rec || !rec.positions) throw new Error('That design has no model stored.');
      picked = id;
      /* Handed to the keycap card through the door it already has, so the
         restore path is the one that is already tested. */
      if (root.keycapUseSaved) root.keycapUseSaved(id);
      if (root.studioGo) root.studioGo('create');
    }).catch(function (e) { note(e.message, true); });
  }

  function note(msg, bad) {
    var n = $('stLibNote'); if (!n) return;
    n.textContent = msg || '';
    n.className = 'hint' + (bad ? ' warn' : '');
  }

  function draw() {
    var host = $(HOST); if (!host) return;
    host.innerHTML = '';

    var head = document.createElement('div');
    head.className = 'stLibHead';
    head.innerHTML = "<h2>Your designs</h2><p id='stLibNote' class='hint'></p>";
    host.appendChild(head);

    if (!root.keycapLibrary) {
      note('This build has no design store.', true);
      return;
    }

    root.keycapLibrary.list().then(function (rows) {
      var count = $('stLibCount');
      if (count) { count.textContent = rows.length; count.hidden = !rows.length; }

      if (!rows.length) {
        var e = document.createElement('div');
        e.className = 'stLibEmpty';
        e.innerHTML = '<h3>Nothing here yet</h3><p>Every model you generate is kept ' +
          'here automatically, with its prompt and what it costs in resin. Opening one ' +
          'puts the same mesh back on the cap without spending another generation.</p>';
        host.appendChild(e);
        return;
      }

      /* One honest line about what the shelf is holding, because the store
         has a ceiling and silently dropping the oldest is the sort of thing
         you want told rather than discovered. */
      var totalMl = 0, totalBytes = 0;
      rows.forEach(function (r) {
        totalBytes += (r.triangles || 0) * 9 * 4;
      });
      var bar = document.createElement('div');
      bar.className = 'stLibBar';
      bar.innerHTML = "<span class='grow'></span>";
      bar.firstChild.innerHTML = '<b>' + rows.length + '</b> design' +
        (rows.length > 1 ? 's' : '') + ' · about <b>' + fmtBytes(totalBytes) +
        '</b> of mesh · the shelf keeps the newest <b>' +
        (root.keycapLibrary.MAX || 60) + '</b>';
      var clr = document.createElement('button');
      clr.type = 'button'; clr.style.cssText = 'width:auto;margin:0;padding:8px 14px';
      clr.className = 'button secondary';
      clr.textContent = 'Delete all…';
      clr.addEventListener('click', function () {
        if (!confirm('Delete all ' + rows.length + ' saved designs? ' +
                     'The models are stored only here, and this cannot be undone.')) return;
        root.keycapLibrary.clear().then(draw);
      });
      bar.appendChild(clr);
      host.appendChild(bar);

      var grid = document.createElement('div');
      grid.className = 'stLibGrid';
      rows.forEach(function (r) { grid.appendChild(card(r)); });
      host.appendChild(grid);

      if (root.keycapLibrary.usage) {
        root.keycapLibrary.usage().then(function (u) {
          if (u && u.known) note('browser storage ' + u.pct + '% used (' +
            fmtBytes(u.usedBytes) + ' of ' + fmtBytes(u.quotaBytes) + ')');
        });
      }
      void totalMl;
    }).catch(function (e) { note(e.message, true); });
  }

  root.studioLibrary = { draw: draw, open: open };
})(typeof window !== 'undefined' ? window : globalThis);
