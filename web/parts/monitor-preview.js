/* The SD preview belongs beside the SD list. Keep the original live viewer
 * and its controls; only move its DOM node. An unsent slicer job keeps that
 * viewer in Create, with a separate saved-image preview in Monitor. */
(function () {
  'use strict';
  const byId = id => document.getElementById(id);
  const monitor = byId('stMonitor'), left = byId('homeLeft');
  const viewer = byId('printPreviewCard'), models = byId('stModelTool');
  if (!monitor || !left || !viewer || !models) return;
  const createHost = models.querySelector('.stCol');
  const saved = document.createElement('section');
  saved.id = 'monitorSavedPreview'; saved.className = 'card hidden';
  saved.innerHTML = '<div class="cardHead"><h2 id="monitorSavedName">Saved model preview</h2></div>' +
    '<div class="monitorSavedStage"><img id="monitorSavedImage" alt="" hidden>' +
    '<p id="monitorSavedEmpty">Select a model in the SD manager.</p></div>' +
    '<div id="monitorSavedFacts" class="monitorPreviewFacts"></div>' +
    '<div class="monitorPreviewFoot"><span>Saved preview · your unsent design stays in Create</span>' +
    '<button id="monitorSavedRetry" class="secondary" type="button" hidden>Reload preview</button></div>';
  left.insertBefore(saved, left.firstChild);
  const note = document.createElement('div'); note.className = 'monitorPreviewFoot monitorOnly';
  note.textContent = 'Model preview';
  viewer.appendChild(note);
  let chosen = '', sequence = 0, previousHost = null, previousVisible = false;
  let loadPending = false, loadNeeded = false;
  const isPrinting = () => !!(window.tmStatus && tmStatus.busy && !tmStatus.sdJob);
  const usesSaved = () => !!window.slicerOwnsPreview && !isPrinting();
  const retry = byId('monitorSavedRetry'), img = byId('monitorSavedImage'), empty = byId('monitorSavedEmpty');

  async function loadSaved(name) {
    const token = ++sequence;
    chosen = name;
    loadPending = false; loadNeeded = !!name;
    byId('monitorSavedName').textContent = name || 'Saved model preview';
    byId('monitorSavedFacts').textContent = '';
    img.hidden = true; img.removeAttribute('src');
    empty.hidden = false; empty.textContent = name ? 'Loading saved preview…' : 'Select a model in the SD manager.';
    retry.hidden = !name;
    if (!name || (window.tmStatus && tmStatus.busy)) return;
    loadPending = true;
    let remaining = 2;
    const finished = () => {
      if (token === sequence && --remaining === 0) { loadPending = false; loadNeeded = false; }
    };
    const image = new Image();
    image.onload = () => {
      if (token !== sequence || !usesSaved()) return;
      img.src = image.src; img.alt = name + ' — saved model preview';
      img.hidden = false; empty.hidden = true;
      finished();
    };
    image.onerror = () => {
      if (token !== sequence) return;
      empty.textContent = 'No saved image for this model. Its file is still on the printer.';
      finished();
    };
    image.src = '/api/files/model/preview?name=' + encodeURIComponent(name) + '&r=' + Date.now();
    try {
      const detail = await api('/api/files/model?name=' + encodeURIComponent(name));
      if (token !== sequence || !usesSaved() || detail.name !== name) return;
      const facts = [];
      if (detail.printLayers || detail.layers) facts.push((detail.printLayers || detail.layers) + ' layers');
      if (Number(detail.heightMm) > 0) facts.push(Number(detail.heightMm).toFixed(1) + ' mm high');
      if (detail.estimatedTime) facts.push(detail.estimatedTime);
      byId('monitorSavedFacts').textContent = facts.join(' · ');
    } catch (_) {
      // A missing image or metadata never becomes a made-up model preview.
    } finally { finished(); }
  }

  window.studioSavedPreviewName = () => usesSaved() ? chosen : '';
  window.studioPickSavedPreview = encoded => {
    if (!usesSaved()) return false;
    if (window.tmStatus && tmStatus.busy) return true;
    loadSaved(decodeURIComponent(encoded));
    window.studioPreviewSync();
    if (typeof renderFiles === 'function') renderFiles();
    saved.scrollIntoView({behavior:'smooth', block:'nearest'});
    return true;
  };
  retry.addEventListener('click', () => {
    if (!(window.tmStatus && tmStatus.busy)) loadSaved(chosen);
  });
  window.studioPreviewSync = () => {
    const active = window.studioCurrentRoom === 'monitor';
    const draft = usesSaved();
    const host = active && !draft ? left : createHost;
    const showSaved = active && draft;
    saved.classList.toggle('hidden', !showSaved);
    monitor.classList.toggle('monitorHasDraft', showSaved);
    retry.disabled = !!(window.tmStatus && tmStatus.busy);
    if (previousHost !== host) {
      host.insertBefore(viewer, host.firstChild);
      previousHost = host;
      // Changing columns changes the canvas width; reuse the viewer's own sizing.
      requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
    }
    // Keep Pause/Stop within reach above the large preview during a print.
    // Move the existing card so its handlers and enabled state are preserved.
    const controls = byId('printControls');
    if (active && isPrinting() && controls && controls.nextElementSibling !== viewer)
      left.insertBefore(controls, viewer);
    if (showSaved && !previousVisible && !chosen && typeof dashPreviewName === 'string' && dashPreviewName)
      loadSaved(dashPreviewName);
    // A print invalidates in-flight image/detail callbacks. Once it releases
    // the viewer, restart that interrupted load rather than leave "Loading".
    // The same path resumes a selection deferred while an SD job was busy.
    if (showSaved && loadNeeded && !loadPending && !(window.tmStatus && tmStatus.busy))
      loadSaved(chosen);
    previousVisible = showSaved;
    if (!draft) { ++sequence; loadPending = false; } // reject callbacks after print start
  };
  window.studioPreviewSync();
})();
