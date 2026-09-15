/* Sharing a design, and keeping it.
 *
 * A designer that forgets everything the moment you close the tab is a toy. If
 * this is going to stand in for buying a cap, a design has to survive, has to
 * be shown to whoever is paying for it, and has to come back exactly as it was
 * when they say yes.
 *
 * THREE THINGS, AND THEY ARE DELIBERATELY OFFLINE. The printer sits on a LAN
 * with no public address and no hosting, so "share" cannot mean "upload". It
 * means a PICTURE plus a CODE:
 *
 *   - the picture is what a person approves. It carries the render, the
 *     dimensions, what it costs and how long it takes.
 *   - the code rebuilds the design exactly, in anyone else's copy of this page.
 *   - the library keeps both on this browser so you can come back to a design.
 *
 * ⚠️ WHAT THE CODE CANNOT CARRY. A generated skin is a mesh, and a mesh does
 * not fit in something you can paste into a message. The code stores the PROMPT
 * instead, so re-opening it regenerates - and a generator does not return the
 * same sculpt twice. So a shared Meshy design comes back as the same cap with
 * DIFFERENT art, and share() says so on the picture rather than letting someone
 * discover it after approving one thing and printing another. Drawn icons and
 * Braille round-trip exactly, because they are parameters, not meshes.
 *
 * No DOM in the encode/decode half - scripts/dev/test_keycap_share.mjs runs it
 * in node. The picture and the clipboard need a browser and say so.
 */

(function (root) {
  'use strict';

  var TAG = 'TMK1';
  var STORE = 'tmKeycapLibrary';

  /* Short keys, because the whole point is that this fits in a message. The
     map is explicit rather than positional so an older code still opens after
     a field is added. */
  /* `l` IS THE LEGEND SWITCH, and leaving it out was not a missing field, it
     was a wrong cap. Turning Legend off does not clear st.digit - the render
     path suppresses it through legendOn() - so a code for a deliberately BLANK
     cap still carried digit:'5', and the far end, having no switch to read,
     rebuilt it with a 5 on it. The owner approves a blank cap and prints a
     numbered one. An older code has no 'l' and decodes as true, which is the
     old default. */
  var K2S = { profile:'p', row:'r', sizeU:'u', icon:'i', digit:'d', braille:'b',
              depth:'h', raised:'a', prompt:'m', key:'k', name:'n', wall:'w', roof:'f',
              legendOn:'l', sculptHeightMm:'sh', meshyPolycount:'mp', meshyUltra:'mu', sculptStyle:'ss',
              sculptRotationDeg:'sr', sculptScalePercent:'sp',
              colorMode:'cm', baseColor:'bc', artColor:'ac', useSourceColors:'sc' };
  var S2K = {};
  Object.keys(K2S).forEach(function (k) { S2K[K2S[k]] = k; });

  function b64urlEncode(str) {
    var b = typeof btoa === 'function'
      ? btoa(unescape(encodeURIComponent(str)))
      : Buffer.from(str, 'utf8').toString('base64');
    return b.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function b64urlDecode(s) {
    var t = String(s).replace(/-/g, '+').replace(/_/g, '/');
    while (t.length % 4) t += '=';
    return typeof atob === 'function'
      ? decodeURIComponent(escape(atob(t)))
      : Buffer.from(t, 'base64').toString('utf8');
  }

  function encode(design) {
    var d = design || {}, out = {};
    validateArtSettings(d);
    Object.keys(K2S).forEach(function (k) {
      var v = d[k];
      if (v === undefined || v === null || v === '' ) return;
      if (k === 'raised') { out[K2S[k]] = v ? 1 : 0; return; }
      if (k === 'sculptRotationDeg' && v === 360) v = 0;
      out[K2S[k]] = v;
    });
    return TAG + '-' + b64urlEncode(JSON.stringify(out));
  }

  /* Throws rather than returning a half-built design. A code that silently
     decodes to defaults is exactly the kind of quiet failure that makes
     somebody approve one cap and print another. */
  function decode(code) {
    var s = String(code || '').trim();
    var at = s.indexOf('-');
    if (at < 0) throw new Error('That is not a design code - it should start with ' + TAG + '-');
    var tag = s.slice(0, at);
    if (tag !== TAG)
      throw new Error('That code says "' + tag + '"; this page reads ' + TAG +
        '. It is from a different version of the designer.');
    var json;
    try { json = JSON.parse(b64urlDecode(s.slice(at + 1))); }
    catch (e) { throw new Error('That code is damaged - it may have been broken across lines when it was pasted.'); }
    if (!json || typeof json !== 'object') throw new Error('That code does not contain a design.');
    var out = {};
    Object.keys(json).forEach(function (k) {
      var full = S2K[k];
      if (!full) return;                       // a field from a newer version
      out[full] = full === 'raised' ? !!json[k] : json[k];
    });
    if (!out.profile) throw new Error('That code has no profile in it.');
    validateArtSettings(out);
    if (out.sculptRotationDeg === 360) out.sculptRotationDeg = 0;
    return out;
  }

  function validateArtSettings(d) {
    if(d.colorMode!=null&&d.colorMode!=='solid'&&d.colorMode!=='color')throw new Error('Choose Solid or Color reference.');
    ['baseColor','artColor'].forEach(function(k){if(d[k]!=null&&(typeof d[k]!=='string'||!/^#[0-9a-f]{6}$/i.test(d[k])))throw new Error('Reference colors must be six-digit hex colors.');});
    if(d.useSourceColors!=null&&typeof d.useSourceColors!=='boolean')throw new Error('Original model colors must be on or off.');
    if (d.meshyUltra != null && typeof d.meshyUltra !== 'boolean') throw new Error('Enhanced sculpt detail must be on or off.');
    if (d.sculptHeightMm != null && (typeof d.sculptHeightMm !== 'number' || !Number.isFinite(d.sculptHeightMm) || d.sculptHeightMm < 6 || d.sculptHeightMm > 30)) throw new Error('Sculpture height must be 6–30 mm.');
    if (d.meshyPolycount != null && d.meshyPolycount !== 30000 && d.meshyPolycount !== 100000) throw new Error('Meshy detail must be 30k or 100k.');
    if (d.sculptStyle != null && d.sculptStyle !== 'cuteartisan' && d.sculptStyle !== 'faithfulsubject') throw new Error('Choose Cute artisan or Faithful subject.');
    if (d.sculptRotationDeg != null && (typeof d.sculptRotationDeg !== 'number' || !Number.isFinite(d.sculptRotationDeg) || d.sculptRotationDeg < 0 || d.sculptRotationDeg > 360)) throw new Error('Artwork rotation must be 0–360 degrees.');
    if (d.sculptScalePercent != null && (typeof d.sculptScalePercent !== 'number' || !Number.isFinite(d.sculptScalePercent) || d.sculptScalePercent < 50 || d.sculptScalePercent > 100)) throw new Error('Artwork size must be 50–100 percent.');
  }

  function describe(design) {
    var d = design || {};
    var bits = [d.profile, d.row, (d.sizeU || 1) + 'u'];
    if (d.braille) bits.push('braille "' + d.braille + '"');
    else if (d.prompt) bits.push('generated');
    else if (d.icon) bits.push(d.icon);
    if (d.digit) bits.push('corner ' + d.digit);
    bits.push((d.raised ? 'raised ' : 'engraved ') + (d.depth || 0.55).toFixed(2) + ' mm');
    return bits.join(' · ');
  }

  /* True when re-opening this code will NOT reproduce the same artwork. */
  function isReproducible(design) {
    return !(design && design.prompt && !design.icon && !design.braille);
  }

  // ---- the library -------------------------------------------------------
  /* localStorage, so it lives on whichever device designed it. That is a real
     limitation and the card says so; the code is what crosses devices. */
  function load() {
    try { return JSON.parse(localStorage.getItem(STORE) || '[]') || []; }
    catch (e) { return []; }
  }
  function save(design, opts) {
    var o = opts || {};
    var list = load();
    var entry = { code: encode(design), name: o.name || design.name || describe(design),
                  at: o.now || Date.now(), thumb: o.thumb || null };
    // replace an entry with the same code rather than stacking duplicates
    list = list.filter(function (e) { return e.code !== entry.code; });
    list.unshift(entry);
    if (list.length > (o.max || 60)) list = list.slice(0, o.max || 60);
    try { localStorage.setItem(STORE, JSON.stringify(list)); }
    catch (e) {
      /* Quota, or a private window. Say so - a save that silently did not
         happen is worse than no save button. */
      throw new Error('Could not keep that design in this browser (' +
        (e && e.name ? e.name : 'storage refused') + '). The code still works - copy it out.');
    }
    return entry;
  }
  function remove(code) {
    var list = load().filter(function (e) { return e.code !== code; });
    try { localStorage.setItem(STORE, JSON.stringify(list)); } catch (e) {}
    return list;
  }

  /* ---- the picture ------------------------------------------------------
     Composed on a canvas so it can be sent anywhere a picture can go. Takes
     the live 3D canvas as the render rather than re-rendering, so what gets
     approved is literally what was on screen. */
  function shareCard(opts) {
    var o = opts || {};
    var src = o.canvas;
    if (!src) throw new Error('shareCard needs the preview canvas');
    var W = o.width || 1080, PAD = 56;
    var IMG = W - PAD * 2;
    var H = IMG + 300;
    var c = document.createElement('canvas');
    c.width = W; c.height = H;
    var g = c.getContext('2d');
    var t = o.tokens || {};
    var ink = t.text || '#eef1f6', dim = t.muted || '#9aa3b2',
        sub = t.subh || '#8a8f99', bg = t.card || '#15181e',
        line = t.line || '#22262e', accent = t.accent || '#e5484d';

    g.fillStyle = bg; g.fillRect(0, 0, W, H);

    // the render, on its own sweep so the card matches the card it came from
    var gr = g.createRadialGradient(W / 2, PAD + IMG * 0.99, 0, W / 2, PAD + IMG * 0.99, IMG * 0.95);
    gr.addColorStop(0, t.sweep || '#191d25'); gr.addColorStop(1, t.floor || '#0a0c10');
    g.fillStyle = gr;
    g.fillRect(PAD, PAD, IMG, IMG);
    try { g.drawImage(src, PAD, PAD, IMG, IMG); } catch (e) {}
    g.strokeStyle = line; g.lineWidth = 2; g.strokeRect(PAD + 1, PAD + 1, IMG - 2, IMG - 2);

    var y = PAD + IMG + 52;
    var mono = 'ui-monospace,Menlo,Consolas,monospace';
    g.textBaseline = 'alphabetic';

    g.fillStyle = ink; g.font = '600 34px ui-sans-serif,system-ui,sans-serif';
    g.fillText(o.title || 'Keycap', PAD, y);

    g.fillStyle = dim; g.font = '22px ui-sans-serif,system-ui,sans-serif';
    g.fillText(o.subtitle || '', PAD, y + 36);

    // the three numbers that decide whether this is worth making
    var stats = o.stats || [];
    var sx = PAD;
    g.textBaseline = 'top';
    stats.slice(0, 3).forEach(function (s) {
      g.fillStyle = sub; g.font = '600 15px ui-sans-serif,system-ui,sans-serif';
      g.fillText(String(s[0]).toUpperCase(), sx, y + 74);
      g.fillStyle = ink; g.font = '28px ' + mono;
      g.fillText(String(s[1]), sx, y + 98);
      sx += o.statGap || 300;
    });

    if (o.warn) {
      g.fillStyle = t.warncol || '#f0a43a';
      g.font = '17px ui-sans-serif,system-ui,sans-serif';
      g.fillText(o.warn, PAD, y + 142);
    }

    // the code, small, monospaced, wrapped so it survives being retyped
    if (o.code) {
      g.fillStyle = sub; g.font = '600 14px ui-sans-serif,system-ui,sans-serif';
      g.fillText('DESIGN CODE', PAD, H - 78);
      g.fillStyle = accent; g.font = '16px ' + mono;
      var code = o.code, max = Math.floor((W - PAD * 2) / 9.6);
      g.fillText(code.length > max ? code.slice(0, max - 1) + '…' : code, PAD, H - 56);
    }
    return c;
  }

  root.keycapShare = {
    TAG: TAG, encode: encode, decode: decode, describe: describe,
    isReproducible: isReproducible,
    load: load, save: save, remove: remove, shareCard: shareCard
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.keycapShare;
})(typeof window !== 'undefined' ? window : globalThis);
