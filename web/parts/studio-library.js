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
  var drawVersion = 0, noteVersion = 0, opening = false, changing = false;
  var search = '', filter = 'all';

  function productOf(rec) {
    var p = rec.product;
    return p && p.version === 1 && p.kind === 'keycap' &&
      (p.state === 'ready' || p.state === 'needs-attention') ? p : null;
  }

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
    /* sizeMm and resinMl describe the saved model or the finished cap, not an
       unscaled sculpt. For caps they used to
       be the bounding box and divergence volume of the mesh exactly as the
       generator emitted it - glTF units, typically a 1 x 1 x 1 box - printed
       on the card as "1×1×1 mm" and "0.00 ml" for a design that really makes
       an 18 x 18 x 17.5 mm cap out of 1.54 ml. They are now measured on the
       seated cap at save time and travel with the record. A record saved
       before that simply has no millimetres, and says so with a dash rather
       than with a number that is wrong. */
    if (rec.facts) {
      out.resinMl = rec.facts.resinMl;
      out.sizeMm = rec.facts.sizeMm;
      out.bytes = rec.facts.bytes;
      out.profile = rec.facts.profile;
      out.row = rec.facts.row;
      out.sizeU = rec.facts.sizeU;
      out.fits = rec.facts.fits;
    }
    /* A mesh is 9 floats a triangle, so this is exact even with no facts. */
    if (!out.bytes) out.bytes = out.triangles * 9 * 4;
    var product = productOf(rec);
    if (product) {
      out.bytes += (product.triangles || 0) * 36;
      out.triangles = product.triangles || 0;
      out.sizeMm = product.state === 'ready' ? product.sizeMm : null;
    }
    return out;
  }

  function card(rec) {
    var f = facts(rec);
    var model = rec.kind === 'model';
    var product = productOf(rec);
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

    if (product || !model) {
      var status = document.createElement('p');
      status.className = 'stLibProductStatus';
      status.style.cssText = 'margin:0;font-weight:650;line-height:1.4;overflow-wrap:anywhere';
      status.textContent = product ? (product.state === 'ready' ? 'Ready to slice' : 'Needs attention') : 'Artwork only';
      status.title = product && product.state === 'ready'
        ? 'Saved assembled keycap in print pose. Geometry checks do not judge appearance. Inspect every side and review supports and print settings.'
        : 'Open in Create to assemble or update this design.';
      if (product && product.state === 'needs-attention') status.style.color = 'var(--warncol)';
      body.appendChild(status);
      if (product && product.issues && product.issues.length) {
        var issues = document.createElement('p');
        issues.className = 'stLibProductIssues';
        issues.style.cssText = 'margin:0;font-size:12px;line-height:1.45;color:var(--muted);overflow-wrap:anywhere';
        issues.textContent = product.issues.join(' ');
        body.appendChild(issues);
      }
    }

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
        f.resinMl != null ? (model ? 'model volume estimate, supports excluded' : 'the finished cap, supports included')
                          : 'no volume measurement was saved');
    row('size', f.sizeMm
        ? f.sizeMm.map(function (v) { return v.toFixed(1); }).join(' × ') + ' mm' : '—',
        f.sizeMm ? (model ? 'saved model dimensions in millimetres' : 'the finished cap') : 'no dimensions in millimetres were saved');
    /* Which cap it was. Two designs from the same figure on different profiles
       print differently, and the Library is where you go to print one again. */
    if (f.profile) row('cap', f.profile + ' ' + (f.row || '') + ' · ' + (f.sizeU || 1) + 'u');
    if (product && product.fit && Number.isFinite(product.fit.slotMm))
      row('socket', product.fit.slotMm.toFixed(2) + ' mm', 'The fit saved with this product; current editor preferences do not change its STL.');
    if (f.fits === false) row('fit', 'does not fit the plate at any lean');
    row('kind', product ? 'assembled keycap' : (rec.kind || 'sculpt'));
    row('stored', fmtBytes(f.bytes));
    body.appendChild(fl);
    el.appendChild(body);

    var actions = document.createElement('div');
    actions.className = 'stLibRow';
    actions.style.cssText = 'flex-wrap:wrap;margin-top:auto;min-width:0';

    if (product && product.state === 'ready') {
      var download = document.createElement('button');
      download.type = 'button'; download.className = 'go stLibExportProduct';
      download.textContent = 'Export product STL';
      download.style.cssText = 'width:100%;flex:1 0 100%;min-width:0;margin:0';
      download.title = 'Download this exact saved assembly and socket fit in print pose.';
      download.addEventListener('click', function () { return exportProduct(rec.id, download); });
      actions.appendChild(download);
    }

    var use = document.createElement('button');
    use.type = 'button'; use.className = product ? '' : 'go'; use.textContent = 'Open in Create';
    use.style.cssText = 'width:auto;min-width:0;flex:1 1 120px;margin:0';
    use.title = model ? 'Opens the saved model in Models at its saved size and pose. No generation is spent.'
                      : 'Puts this exact mesh back on the cap. No generation is spent.';
    use.addEventListener('click', function () { return open(rec.id, use); });
    actions.appendChild(use);

    var backup = document.createElement('button');
    backup.type = 'button'; backup.textContent = 'Backup design';
    backup.style.cssText = 'flex:1 1 110px;min-width:100px';
    backup.title = 'Save the editable source, settings and assembled product in one TinyMaker backup. This is not a print file.';
    backup.addEventListener('click', function () { return exportBackup(rec.id, backup); });
    actions.appendChild(backup);

    if (rec.design && root.keycapShare) {
      var sh = document.createElement('button');
      sh.type = 'button'; sh.textContent = 'Code';
      sh.title = 'Copy the cap settings and prompt. Generated artwork is not included; use Backup design to keep the actual model.';
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
        if (root.keycapCopyText) Promise.resolve().then(function () {
          return root.keycapCopyText(rec.design);
        }).then(done).catch(function () { done(false); });
        else done(false);
      });
      actions.appendChild(sh);
    }

    var del = document.createElement('button');
    del.type = 'button'; del.className = 'del'; del.textContent = 'Delete';
    /* Asked for, every time. A generation costs credits and a minute, and
       this is the only copy of it. */
    del.addEventListener('click', function () {
      if (changing || del.disabled) return Promise.resolve(false);
      if (!confirm('Delete "' + (rec.name || 'this design') +
                   '"? The model is stored only here, and this cannot be undone.')) return;
      return change(del, function () { return root.keycapLibrary.remove(rec.id); },
        'Deleted "' + (rec.name || 'design') + '".', 'Could not delete this design');
    });
    actions.appendChild(del);
    el.appendChild(actions);
    return el;
  }

  function change(button, action, success, failure) {
    if (changing) return Promise.resolve(false);
    changing = true;
    if (button) button.disabled = true;
    return Promise.resolve().then(action).then(function () {
      return Promise.resolve(draw()).then(function () { note(success); return true; });
    }).catch(function (e) {
      note(failure + ': ' + (e.message || 'storage is unavailable') + '. Your saved list has not been removed from view.', true);
      return false;
    }).then(function (ok) { changing = false; if (button) button.disabled = false; return ok; });
  }

  /* A compact, lossless local backup. Geometry stays binary float32 instead
     of becoming millions of JSON numbers. It never contains a Meshy key or
     printer settings. A restored record gets a new id and cannot overwrite
     the Library entry it came from. V1: magic + three little-endian sizes.
     V2 adds a fourth size and an optional binary source-color section after
     the product. Older files stay readable; uncolored backups stay V1. */
  var BACKUP_MAGIC = 'TMDES001', COLOR_BACKUP_MAGIC = 'TMDES002', MAX_SOURCE_BYTES = 60 * 1024 * 1024;
  var TOPPER_BACKUP_MAGIC='TMDES003';
  var MAX_PRODUCT_BYTES = 300000 * 36, MAX_META_BYTES = 4 * 1024 * 1024;
  var MAX_COLOR_BYTES = MAX_SOURCE_BYTES;
  var MAX_BACKUP_BYTES = 28 + MAX_META_BYTES + MAX_SOURCE_BYTES + MAX_PRODUCT_BYTES + MAX_COLOR_BYTES + 10800000;
  function backupFail(message) { throw new Error('Design backup: ' + message); }
  function sourceMesh(positions) {
    if (Object.prototype.toString.call(positions) !== '[object Float32Array]' ||
        !positions.length || positions.length % 9 || positions.byteLength > MAX_SOURCE_BYTES)
      backupFail('the source must contain complete triangles within the 60 MB limit.');
    for (var i = 0; i < positions.length; i++) if (!Number.isFinite(positions[i]))
      backupFail('the source contains invalid coordinates.');
    return positions;
  }
  function bytesHash(bytes) {
    var hash = 2166136261;
    for (var i = 0; i < bytes.length; i++) hash = Math.imul(hash ^ bytes[i], 16777619) >>> 0;
    return ('00000000' + hash.toString(16)).slice(-8);
  }
  function backupText(value, max, label, optional) {
    if (optional && value == null) return null;
    if (typeof value !== 'string' || value.length > max || (!optional && !value.trim()))
      backupFail(label + ' is missing or too long.');
    return value;
  }
  function backupFacts(f) {
    if (!f) return null;
    if (typeof f !== 'object' || Array.isArray(f)) backupFail('saved measurements are invalid.');
    var out = {};
    if (f.sizeMm != null) {
      if (!Array.isArray(f.sizeMm) || f.sizeMm.length !== 3 || f.sizeMm.some(function (n) {
        return typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > 1000000;
      })) backupFail('saved dimensions are invalid.');
      out.sizeMm = f.sizeMm.slice();
    }
    if (f.resinMl != null) {
      if (typeof f.resinMl !== 'number' || !Number.isFinite(f.resinMl) || f.resinMl < 0 || f.resinMl > 1e9)
        backupFail('saved resin volume is invalid.');
      out.resinMl = f.resinMl;
    }
    ['profile', 'row'].forEach(function (key) {
      if (f[key] != null) out[key] = backupText(f[key], 32, 'cap ' + key, true);
    });
    if (f.sizeU != null) {
      if (typeof f.sizeU !== 'number' || !Number.isFinite(f.sizeU) || f.sizeU <= 0 || f.sizeU > 20)
        backupFail('saved key width is invalid.');
      out.sizeU = f.sizeU;
    }
    if (typeof f.fits === 'boolean') out.fits = f.fits;
    return out;
  }
  function backupMetadata(rec) {
    if (!rec || typeof rec !== 'object' || Array.isArray(rec)) backupFail('the design metadata is missing.');
    var kind = rec.kind || 'sculpt';
    if (['model', 'sculpt', 'skin', 'icon', 'keycap'].indexOf(kind) < 0) backupFail('this design type is unsupported.');
    var design = backupText(rec.design, 4096, 'design code', true);
    if (design && !/^TMK1-[A-Za-z0-9_-]+$/.test(design)) backupFail('the design code is invalid.');
    var thumb = null;
    if (typeof rec.thumb === 'string' && rec.thumb.length <= 2 * 1024 * 1024 &&
        /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(rec.thumb)) thumb = rec.thumb;
    var out={name: backupText(rec.name, 500, 'design name'),
      prompt: backupText(rec.prompt || '', 10000, 'prompt', true) || '',
      kind: kind, design: design, thumb: thumb, facts: backupFacts(rec.facts)};
    if(rec.topperRecipe!=null)out.topperRecipe=backupTopperRecipe(rec.topperRecipe);
    return out;
  }
  function backupTopperRecipe(recipe){
    if(!recipe||recipe.version!==1||!recipe.fields||typeof recipe.fields!=='object'||Array.isArray(recipe.fields))backupFail('topper settings are unsupported.');
    var fields={},keys=['tpPreset','tpModel','tpShape','tpWidth','tpSecondWidth','tpDepth','tpWall','tpFit','tpArtHeight','tpArtRotation','tpPrompt'];
    keys.forEach(function(k){if(recipe.fields[k]!=null)fields[k]=backupText(recipe.fields[k],k==='tpPrompt'?180:k==='tpModel'?60:200,'topper '+k,true);});
    return {version:1,fields:fields};
  }
  function productMetadata(p) {
    if (!p) return null;
    return {version:p.version, kind:p.kind, state:p.state, issues:p.issues,
      checkedAt:p.checkedAt, fit:p.fit, sizeMm:p.sizeMm, triangles:p.triangles,
      recipe:p.recipe, signature:p.signature};
  }
  function backupColors(colors, source) {
    if (Object.prototype.toString.call(colors) !== '[object Float32Array]' ||
        colors.length !== source.length || colors.byteLength > MAX_COLOR_BYTES)
      backupFail('the source colors do not match the source geometry.');
    for (var i = 0; i < colors.length; i++)
      if (!Number.isFinite(colors[i]) || colors[i] < 0 || colors[i] > 1)
        backupFail('the source colors contain invalid RGB values.');
    return colors;
  }
  function encodeBackup(rec) {
    var source = sourceMesh(rec && rec.positions), meta = backupMetadata(rec);
    var raw = new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
    var colors = rec.sourceColors == null ? null : backupColors(rec.sourceColors, source);
    var topper=rec.topperSource==null?null:sourceMesh(rec.topperSource);
    if(topper&&(!meta.topperRecipe||topper.length>2700000))backupFail('the original topper artwork or its settings are invalid.');
    var topperRaw=topper?new Uint8Array(topper.buffer,topper.byteOffset,topper.byteLength):null;
    var colorRaw = colors ? new Uint8Array(colors.buffer, colors.byteOffset, colors.byteLength) : null;
    var product = rec.product && rec.product.positions;
    if (product != null && (Object.prototype.toString.call(product) !== '[object Float32Array]' ||
        product.byteLength % 36 || product.byteLength > MAX_PRODUCT_BYTES))
      backupFail('the assembled product exceeds the supported geometry limit.');
    meta.product = productMetadata(rec.product);
    meta.sourceHash = bytesHash(raw);
    if(topper){meta.topperSourceHash=bytesHash(topperRaw);meta.topperSourceCount=topper.length;}
    if (colors) {
      if (!/^(material|vertex|texture|partial)$/.test(rec.sourceColorKind || ''))
        backupFail('the source color type is missing or unsupported.');
      meta.sourceColorKind = rec.sourceColorKind;
      meta.sourceColorCount = colors.length;
      meta.sourceColorHash = bytesHash(colorRaw);
    }
    var json = new TextEncoder().encode(JSON.stringify(meta));
    if (json.byteLength > MAX_META_BYTES) backupFail('the saved metadata is too large.');
    var header = new ArrayBuffer(topper?28:colors ? 24 : 20), view = new DataView(header);
    var magic = topper?TOPPER_BACKUP_MAGIC:colors ? COLOR_BACKUP_MAGIC : BACKUP_MAGIC;
    for (var i = 0; i < 8; i++) view.setUint8(i, magic.charCodeAt(i));
    view.setUint32(8, json.byteLength, true); view.setUint32(12, raw.byteLength, true);
    view.setUint32(16, product ? product.byteLength : 0, true);
    if (colors||topper) view.setUint32(20, colors?colorRaw.byteLength:0, true);
    if(topper)view.setUint32(24,topperRaw.byteLength,true);
    return new Blob([header, json, raw, product || new Uint8Array(0), colorRaw || new Uint8Array(0),topperRaw||new Uint8Array(0)], {type:'application/octet-stream'});
  }
  function decodeBackup(buffer) {
    if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < 20 || buffer.byteLength > MAX_BACKUP_BYTES)
      backupFail('the file is empty or larger than the supported backup limit.');
    var view = new DataView(buffer), magic = '';
    for (var i = 0; i < 8; i++) magic += String.fromCharCode(view.getUint8(i));
    if (magic !== BACKUP_MAGIC && magic !== COLOR_BACKUP_MAGIC&&magic!==TOPPER_BACKUP_MAGIC) backupFail('choose a .tm-design file downloaded from TinyMaker.');
    var headerLength = magic===TOPPER_BACKUP_MAGIC?28:magic === COLOR_BACKUP_MAGIC ? 24 : 20;
    if (buffer.byteLength < headerLength) backupFail('the file header is incomplete.');
    var metaLength = view.getUint32(8, true), sourceLength = view.getUint32(12, true), productLength = view.getUint32(16, true);
    var colorLength = headerLength >= 24 ? view.getUint32(20, true) : 0;
    var topperLength=headerLength===28?view.getUint32(24,true):0;
    if (!metaLength || metaLength > MAX_META_BYTES || !sourceLength || sourceLength > MAX_SOURCE_BYTES ||
        sourceLength % 36 || productLength > MAX_PRODUCT_BYTES || productLength % 36 ||
        colorLength > MAX_COLOR_BYTES ||topperLength>10800000||topperLength%36||
        headerLength + metaLength + sourceLength + productLength + colorLength+topperLength !== buffer.byteLength)
      backupFail('the file is incomplete or its stored lengths are invalid.');
    var meta;
    try { meta = JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(new Uint8Array(buffer, headerLength, metaLength))); }
    catch (e) { backupFail('the design metadata could not be read.'); }
    var rec = backupMetadata(meta), offset = headerLength + metaLength;
    var raw = new Uint8Array(buffer, offset, sourceLength);
    if (typeof meta.sourceHash !== 'string' || bytesHash(raw) !== meta.sourceHash)
      backupFail('the source geometry is damaged. Download the backup again.');
    rec.positions = sourceMesh(new Float32Array(buffer.slice(offset, offset + sourceLength)));
    rec.product = null;
    var warning = '';
    if (meta.product) {
      var p = productMetadata(meta.product);
      p.positions = productLength ? new Float32Array(buffer.slice(offset + sourceLength, offset + sourceLength + productLength)) : null;
      try {
        if (!root.keycapProduct || !root.keycapProduct.validate) throw new Error('product validation unavailable');
        root.keycapProduct.validate(p);
        rec.product = p;
      } catch (e) {
        warning = 'The saved assembly could not be verified. Source artwork was restored; open it in Create to rebuild the product.';
        // Facts of an unverified assembly must not masquerade as current checks.
        rec.facts = null;
      }
    } else if (productLength) backupFail('assembled geometry has no matching product metadata.');
    if (headerLength >= 24&&(headerLength===24||colorLength)) {
      try {
        if (colorLength !== sourceLength || !Number.isSafeInteger(meta.sourceColorCount) ||
            meta.sourceColorCount !== rec.positions.length ||
            !/^(material|vertex|texture|partial)$/.test(meta.sourceColorKind || ''))
          throw new Error('invalid color metadata');
        var colorOffset = offset + sourceLength + productLength;
        var colorRaw = new Uint8Array(buffer, colorOffset, colorLength);
        if (typeof meta.sourceColorHash !== 'string' || bytesHash(colorRaw) !== meta.sourceColorHash)
          throw new Error('damaged color section');
        rec.sourceColors = backupColors(new Float32Array(buffer.slice(colorOffset,colorOffset+colorLength)), rec.positions);
        rec.sourceColorKind = meta.sourceColorKind;
      } catch (e) {
        rec.sourceColors = null; rec.sourceColorKind = null;
        warning += (warning ? ' ' : '') + 'Source colors could not be verified and were omitted. Geometry was kept; choose a reference palette in Create.';
      }
    }
    if(headerLength===28){
      try{
        if(!rec.topperRecipe||!topperLength||meta.topperSourceCount!==topperLength/4)throw new Error('invalid topper source metadata');
        var at=offset+sourceLength+productLength+colorLength,rawTopper=new Uint8Array(buffer,at,topperLength);
        if(bytesHash(rawTopper)!==meta.topperSourceHash)throw new Error('damaged topper source');
        rec.topperSource=sourceMesh(new Float32Array(buffer.slice(at,at+topperLength)));
      }catch(e){rec.topperRecipe=null;rec.topperSource=null;warning+=(warning?' ':'')+'The original topper artwork could not be verified. The finished model was kept, but the editable cap settings were omitted.';}
    }
    return {record:rec, warning:warning};
  }
  function downloadFile(blob, name) {
    var url = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = url; link.download = name;
    try { document.body.appendChild(link); link.click(); }
    finally { link.remove(); setTimeout(function () { URL.revokeObjectURL(url); }, 1000); }
  }
  function exportBackup(id, button) {
    if (button && button.disabled) return Promise.resolve(false);
    if (button) button.disabled = true;
    return Promise.resolve().then(function () {
      if (!root.keycapLibrary) throw new Error('The design store is unavailable.');
      note('Preparing the editable design backup…');
      return root.keycapLibrary.get(id);
    }).then(function (rec) {
      if (!rec) throw new Error('This design is no longer in the Library.');
      downloadFile(encodeBackup(rec), (rec.name || 'design').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 100) + '.tm-design');
      note('Design backup downloaded. It includes the source artwork, saved settings and assembled product when available.');
      return true;
    }).catch(function (e) { note('Backup failed: ' + (e.message || 'unknown error'), true); return false; })
      .then(function (ok) { if (button) button.disabled = false; return ok; });
  }
  function importBackup(file, button) {
    if (changing || (button && button.disabled)) return Promise.resolve(false);
    var warning = '';
    return change(button, function () {
      if (!file || !file.size || file.size > MAX_BACKUP_BYTES || typeof file.arrayBuffer !== 'function')
        backupFail('choose a nonempty TinyMaker backup within the supported size limit.');
      note('Restoring the design backup…');
      return file.arrayBuffer().then(decodeBackup).then(function (decoded) {
        return root.keycapLibrary.save(decoded.record).then(function () {
          warning = decoded.warning;
        });
      });
    }, 'Restored a new Library copy. Existing designs were kept.', 'Could not import this backup').then(function (ok) {
      if (ok && warning) note(warning, true);
      return ok;
    });
  }

  function exportProduct(id, button) {
    if (button && button.disabled) return Promise.resolve(false);
    if (button) button.disabled = true;
    return Promise.resolve().then(function () {
      if (!root.keycapLibrary) throw new Error('The design store is unavailable.');
      return root.keycapLibrary.get(id);
    }).then(function (rec) {
      var product = rec && productOf(rec);
      if (!product || product.state !== 'ready')
        throw new Error('This design has no ready product saved. Open it in Create and save the assembled keycap.');
      if (!root.keycapProduct || !root.keycapProduct.toSTL)
        throw new Error('The product exporter is unavailable. Reload the page and try again.');
      return Promise.resolve(root.keycapProduct.toSTL(product)).then(function (blob) {
        if (!(blob instanceof Blob) || !blob.size) throw new Error('The product exporter returned no STL file.');
        var url = URL.createObjectURL(blob), link = document.createElement('a');
        link.href = url;
        link.download = (rec.name || 'keycap').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 100) + '-product.stl';
        try { document.body.appendChild(link); link.click(); }
        finally { link.remove(); setTimeout(function () { URL.revokeObjectURL(url); }, 1000); }
        note('Exported the saved product with its saved socket fit. Review slicing and support settings before printing.');
        return true;
      });
    }).catch(function (e) {
      note('Product export failed: ' + (e.message || 'unknown error'), true);
      return false;
    }).then(function (ok) { if (button) button.disabled = false; return ok; });
  }

  function open(id, button) {
    if (opening || (button && button.disabled)) return Promise.resolve(false);
    if (!root.keycapLibrary) { note('This build has no design store.', true); return Promise.resolve(false); }
    opening = true;
    var modelLoad=root.meshyBeginModelOpen?root.meshyBeginModelOpen():null;
    if (button) { button.disabled = true; button.textContent = 'Opening…'; }
    return Promise.resolve().then(function () { return root.keycapLibrary.get(id); }).then(function (rec) {
      if (!rec || !rec.positions) throw new Error('That design has no model stored.');
      if (rec.topperRecipe) {
        if (!root.topperUseSaved) throw new Error('The topper editor is unavailable. Reload the page and try again.');
        return Promise.resolve(root.topperUseSaved(rec)).then(function(ok){
          if(ok===false)throw new Error('The saved topper could not be opened. Its Library copy is unchanged.');
          picked=id;if(root.studioStage)root.studioStage('topper');if(root.studioGo)root.studioGo('create');
          note('Opened the fitted topper with its original artwork. No generation spent.');return true;
        });
      }
      if (rec.kind === 'model') {
        /* Model coordinates were stored in millimetres. Do not pass these
           through the sculpt-to-cap or GLB auto-sizing paths on reopen. */
        var engine = (typeof slicerMod !== 'undefined' && slicerMod) ? Promise.resolve()
          : (typeof slicerLoadMod === 'function' ? Promise.resolve().then(function () { return slicerLoadMod(); })
                                               : Promise.reject(new Error('The slicer engine is unavailable.')));
        return engine.then(function () {
          if(modelLoad!=null&&root.meshyModelLoadCurrent&&!root.meshyModelLoadCurrent(modelLoad))
            throw new Error('Another model was selected while this Library design loaded. Its saved copy is unchanged.');
          if (typeof slicerMod === 'undefined' || !slicerMod || !root.slicerLoadMesh)
            throw new Error('Could not load the slicer engine.');
          /* Loading and later edits get a copy; the saved record and its facts
             stay untouched even if the slicer mutates its input. */
          var positions = new Float32Array(rec.positions);
          if (!root.slicerLoadMesh(positions, rec.name || 'model', positions.byteLength,
                                  { keepPose: true, noScale: true }))
            throw new Error('The saved model has no usable geometry.');
          picked = id;
          if (root.meshyModelOpened) root.meshyModelOpened(rec.name || 'model', positions,rec,modelLoad);
          if (root.studioStage) root.studioStage('model');
          if (root.studioGo) root.studioGo('create');
          note('Opened the saved model. Size and pose kept; no generation spent.');
          return true;
        });
      }
      /* Handed to the keycap card through the door it already has, so the
         restore path is the one that is already tested. */
      if (!root.keycapUseSaved) throw new Error('The keycap editor is unavailable. Reload the page and try again.');
      return Promise.resolve(root.keycapUseSaved(id)).then(function (restored) {
        if (restored === false) throw new Error('Could not open this keycap. Its saved copy is still in the Library; try again or download a backup.');
        picked = id;
      /* The TOOL as well as the room. The Create room shows one tool at a time
         and remembers which in localStorage, so opening a keycap design while
         'model' was the remembered tool changed rooms and left the owner
         looking at the model card with the keycap card display:none behind it.
         A button that appears to do nothing is worse than one that is not
         there. */
      if (root.studioStage) root.studioStage('cap');
      if (root.studioGo) root.studioGo('create');
      return true;
      });
    }).catch(function (e) { note(e.message, true); return false; }).then(function (ok) {
      opening = false;
      if (button) { button.disabled = false; button.textContent = 'Open in Create'; }
      return ok;
    });
  }

  function note(msg, bad) {
    noteVersion++;
    var n = $('stLibNote'); if (!n) return;
    n.textContent = msg || '';
    n.className = 'hint' + (bad ? ' warn' : '');
  }

  function draw() {
    var host = $(HOST); if (!host) return;
    var version = ++drawVersion;
    host.innerHTML = '';

    var head = document.createElement('div');
    head.className = 'stLibHead';
    head.innerHTML = "<h2>Your designs</h2><p id='stLibNote' class='hint'></p>";
    host.appendChild(head);
    var initialNote = noteVersion;

    if (!root.keycapLibrary) {
      note('This build has no design store.', true);
      return;
    }

    return Promise.resolve().then(function () { return root.keycapLibrary.list(); }).then(function (rows) {
      if (version !== drawVersion) return;
      var count = $('stLibCount');
      if (count) { count.textContent = rows.length; count.hidden = !rows.length; }

      var restoreRow = document.createElement('div');
      restoreRow.className = 'stLibBar';
      var restore = document.createElement('button');
      restore.type = 'button'; restore.textContent = 'Import design backup';
      restore.style.cssText = 'width:auto;margin:0;padding:8px 14px';
      var file = document.createElement('input');
      file.type = 'file'; file.accept = '.tm-design'; file.hidden = true;
      file.addEventListener('change', function () {
        var chosen = file.files && file.files[0]; file.value = '';
        if (chosen) return importBackup(chosen, restore);
      });
      restore.addEventListener('click', function () { if (!restore.disabled) file.click(); });
      restoreRow.appendChild(restore); restoreRow.appendChild(file); host.appendChild(restoreRow);

      if (!rows.length) {
        var e = document.createElement('div');
        e.className = 'stLibEmpty';
        e.innerHTML = '<h3>Nothing here yet</h3><p>Generated designs and models imported in Models are kept ' +
          'here automatically. Open a saved model in Models or a sculpt in Keycaps, ' +
          'without spending another generation. Designs are saved in this browser at this printer address; ' +
          'use a design backup to move them from another browser.</p>';
        host.appendChild(e);
        return;
      }

      var totalBytes = 0;
      rows.forEach(function (r) {
        totalBytes += facts(r).bytes || 0;
      });
      var bar = document.createElement('div');
      bar.className = 'stLibBar';
      bar.innerHTML = "<span class='grow'></span>";
      bar.firstChild.innerHTML = '<b>' + rows.length + '</b> design' +
        (rows.length > 1 ? 's' : '') + ' · about <b>' + fmtBytes(totalBytes) +
        '</b> of mesh · stored in this browser. Export backups before clearing browser data.';
      var clr = document.createElement('button');
      clr.type = 'button'; clr.style.cssText = 'width:auto;margin:0;padding:8px 14px';
      clr.className = 'button secondary';
      clr.textContent = 'Delete all…';
      clr.addEventListener('click', function () {
        if (changing || clr.disabled) return Promise.resolve(false);
        if (!confirm('Delete all ' + rows.length + ' saved designs? ' +
                     'The models are stored only here, and this cannot be undone.')) return;
        return change(clr, function () { return root.keycapLibrary.clear(); },
          'All saved designs were deleted from this browser.', 'Could not delete the saved designs');
      });
      bar.appendChild(clr);
      host.appendChild(bar);

      var grid = document.createElement('div');
      grid.className = 'stLibGrid';
      var controls = document.createElement('div');
      controls.className = 'stLibBar'; controls.style.flexWrap = 'wrap';
      var searchLabel = document.createElement('label');
      searchLabel.textContent = 'Find a design'; searchLabel.style.cssText = 'flex:2 1 220px;min-width:0';
      var query = document.createElement('input');
      query.type = 'search'; query.placeholder = 'Search names or prompts'; query.value = search;
      query.ariaLabel = 'Find a design';
      query.style.cssText = 'display:block;width:100%;box-sizing:border-box;margin-top:4px;min-height:40px;' +
        'padding:9px 12px;border-radius:10px;border:1px solid var(--line2);background:var(--st-sunken);color:var(--text);font:inherit';
      searchLabel.appendChild(query); controls.appendChild(searchLabel);
      var filterLabel = document.createElement('label');
      filterLabel.textContent = 'Show'; filterLabel.style.cssText = 'flex:1 1 170px;min-width:0';
      var select = document.createElement('select');
      select.ariaLabel = 'Show';
      select.style.cssText = 'display:block;width:100%;margin-top:4px;min-height:40px';
      [['all','All designs'],['ready','Ready to slice'],['needs-attention','Needs attention'],
       ['artwork','Artwork only'],['model','Models']].forEach(function (option) {
        var o = document.createElement('option'); o.value = option[0]; o.textContent = option[1]; select.appendChild(o);
      });
      select.value = filter; filterLabel.appendChild(select); controls.appendChild(filterLabel);
      var results = document.createElement('p'); results.className = 'hint';
      host.appendChild(controls); host.appendChild(results);
      function filtered() {
        search = query.value; filter = select.value;
        var term = search.trim().toLocaleLowerCase();
        var matches = rows.filter(function (r) {
          var product = productOf(r), state = product ? product.state : r.kind === 'model' ? 'model' : 'artwork';
          return (filter === 'all' || state === filter) &&
            (!term || ((r.name || '') + ' ' + (r.prompt || '')).toLocaleLowerCase().indexOf(term) >= 0);
        });
        grid.innerHTML = '';
        matches.forEach(function (r) { grid.appendChild(card(r)); });
        results.textContent = matches.length + ' of ' + rows.length + ' designs' +
          (!matches.length ? ' — no matches. Try another search or choose All designs.' : '');
      }
      query.addEventListener('input', filtered); select.addEventListener('change', filtered);
      filtered();
      host.appendChild(grid);

      if (root.keycapLibrary.usage) {
        Promise.resolve().then(function () { return root.keycapLibrary.usage(); }).then(function (u) {
          if (version === drawVersion && initialNote === noteVersion && u && u.known) note('Browser storage ' + u.pct + '% used (' +
            fmtBytes(u.usedBytes) + ' of ' + fmtBytes(u.quotaBytes) + ')');
        }).catch(function () { /* Optional storage estimates never hide the Library. */ });
      }
    }).catch(function (e) { if (version === drawVersion) note('Could not load your designs: ' + e.message, true); });
  }

  root.studioLibrary = { draw: draw, open: open, importBackup: importBackup,
    backup: {encode:encodeBackup, decode:decodeBackup} };
})(typeof window !== 'undefined' ? window : globalThis);
