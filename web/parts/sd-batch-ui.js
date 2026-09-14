/* The batch-delete panel. Kept apart from sd-batch.js so that stays testable
   with no DOM, and so none of this touches the existing row renderer. */
(function () {
  'use strict';
  function $(id) { return document.getElementById(id); }
  var host = $('sdActions');
  if (!host || !window.sdBatch) return;

  var panel, listBox, note, runBtn, allBox;

  var btn = document.createElement('button');
  btn.id = 'sdBatchOpen';
  btn.type = 'button';
  btn.className = 'small button secondary';
  btn.style.cssText = 'margin-top:0;flex:0 0 auto;width:auto';
  btn.textContent = 'Delete several…';
  host.appendChild(btn);

  function build() {
    panel = document.createElement('div');
    panel.id = 'sdBatchPanel';
    panel.hidden = true;
    panel.style.cssText =
      'margin:0 0 10px;padding:12px;border:1px solid var(--line2);border-radius:10px;' +
      'background:var(--tile)';
    panel.innerHTML =
      "<div style='display:flex;align-items:center;gap:10px;margin-bottom:9px'>" +
        "<label style='display:flex;align-items:center;gap:7px;font-size:13px;color:var(--muted);margin:0'>" +
          "<input type='checkbox' id='sdBatchAll' style='width:auto;margin:0'><span>Select all</span></label>" +
        "<span id='sdBatchCount' class='hint' style='margin:0;flex:1'></span>" +
      "</div>" +
      "<div id='sdBatchList' style='max-height:230px;overflow:auto;display:grid;gap:3px;" +
        "border-top:1px solid var(--line);border-bottom:1px solid var(--line);padding:8px 0'></div>" +
      "<p id='sdBatchNote' class='hint'></p>" +
      "<div style='display:flex;gap:8px;margin-top:8px'>" +
        "<button id='sdBatchGo' type='button' style='flex:2 1 150px;margin-top:0'>Delete selected</button>" +
        "<button id='sdBatchClose' type='button' class='button secondary' style='flex:1 1 90px;margin-top:0'>Close</button>" +
      "</div>";
    host.parentNode.insertBefore(panel, host.nextSibling);
    listBox = $('sdBatchList'); note = $('sdBatchNote');
    runBtn = $('sdBatchGo'); allBox = $('sdBatchAll');

    allBox.addEventListener('change', function () {
      Array.prototype.forEach.call(listBox.querySelectorAll('input'), function (c) {
        c.checked = allBox.checked;
      });
      count();
    });
    $('sdBatchClose').addEventListener('click', function () {
      if (window.sdBatch.running()) { window.sdBatch.stop(); return; }
      panel.hidden = true;
    });
    runBtn.addEventListener('click', go);
  }

  function picked() {
    return Array.prototype.filter.call(listBox.querySelectorAll('input'),
      function (c) { return c.checked; }).map(function (c) { return c.value; });
  }
  function count() {
    var n = picked().length;
    $('sdBatchCount').textContent = n ? (n + ' selected') : '';
    runBtn.disabled = !n || window.sdBatch.running();
  }

  function draw(items) {
    listBox.innerHTML = '';
    if (!items.length) { note.textContent = 'The card has no models on it.'; return; }
    items.forEach(function (it) {
      var row = document.createElement('label');
      row.style.cssText = 'display:flex;align-items:center;gap:9px;padding:5px 2px;' +
        'font-size:13px;color:var(--text);margin:0;cursor:pointer';
      var cb = document.createElement('input');
      cb.type = 'checkbox'; cb.value = it.name;
      cb.style.cssText = 'width:auto;margin:0;flex:0 0 auto';
      cb.addEventListener('change', count);
      var nm = document.createElement('span');
      nm.textContent = it.name;
      nm.style.cssText = 'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
      var sz = document.createElement('span');
      sz.className = 'hint';
      sz.style.cssText = 'margin:0;flex:0 0 auto';
      var b = Number(it.folderBytes || it.sizeBytes || 0);
      sz.textContent = b ? (b > 1048576 ? (b / 1048576).toFixed(1) + ' MB'
                                        : Math.round(b / 1024) + ' KB') : '';
      row.appendChild(cb); row.appendChild(nm); row.appendChild(sz);
      listBox.appendChild(row);
    });
    note.textContent = items.length + ' on the card. Deleting is not undoable.';
    count();
  }

  function open() {
    if (!panel) build();
    panel.hidden = false;
    note.textContent = 'reading the card…';
    allBox.checked = false;
    window.sdBatch.list().then(draw).catch(function (e) {
      note.textContent = e.message; note.className = 'hint warn';
    });
  }

  function go() {
    var names = picked();
    if (!names.length) return;
    /* One confirmation for the whole batch, naming the count - not one dialog
       per model, which is the thing that makes deleting ten a chore. */
    if (!confirm('Delete ' + names.length + ' model' + (names.length > 1 ? 's' : '') +
                 ' from the SD card? This cannot be undone.')) return;
    runBtn.disabled = true;
    $('sdBatchClose').textContent = 'Stop';
    window.sdBatch.run(names, function (done, total, name) {
      note.textContent = 'deleting ' + (done + 1) + ' of ' + total + ' — ' + name;
    }).then(function (r) {
      var parts = [r.deleted.length + ' deleted'];
      if (r.failed.length) parts.push(r.failed.length + ' refused (' +
        r.failed.slice(0, 3).map(function (f) { return f.name + ': ' + f.why; }).join('; ') + ')');
      if (r.stopped) parts.push('stopped early, ' +
        (r.total - r.deleted.length - r.failed.length) + ' untouched');
      note.textContent = parts.join(' · ');
      note.className = 'hint' + (r.failed.length ? ' warn' : '');
      $('sdBatchClose').textContent = 'Close';
      /* Refresh whatever the page uses to show the list, without assuming a
         particular function exists. */
      ['refreshFiles', 'loadFiles', 'sdRefresh'].forEach(function (fn) {
        if (typeof window[fn] === 'function') { try { window[fn](); } catch (e) {} }
      });
      return window.sdBatch.list().then(draw);
    }).catch(function (e) {
      note.textContent = e.message; note.className = 'hint warn';
      $('sdBatchClose').textContent = 'Close';
      runBtn.disabled = false;
    });
  }

  btn.addEventListener('click', function () {
    if (!panel || panel.hidden) open(); else panel.hidden = true;
  });
})();
