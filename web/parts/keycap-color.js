/* Optional GLB source-color reference. Geometry and STL output never change.
   Only embedded PNG/JPEG bytes are decoded; no fetches, credentials or URLs. */
(function (root) {
  'use strict';
  var MAX_IMAGE = 8192, MAX_PIXELS = 16777216, PREVIEW_SIZE = 1024;
  function linear(v) { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
  function validColors(colors, positions) {
    if (!(colors instanceof Float32Array) || !positions || colors.length !== positions.length || colors.length % 9) return false;
    for (var i = 0; i < colors.length; i++) if (!Number.isFinite(colors[i]) || colors[i] < 0 || colors[i] > 1) return false;
    return true;
  }
  function dimensions(bytes, mime) {
    if (!(bytes instanceof Uint8Array)) throw new Error('No embedded image');
    var v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), w = 0, h = 0;
    if (mime === 'image/png' && bytes.length >= 24 && v.getUint32(0) === 0x89504e47 &&
        v.getUint32(4) === 0x0d0a1a0a && v.getUint32(12) === 0x49484452) {
      w = v.getUint32(16); h = v.getUint32(20);
    } else if (mime === 'image/jpeg' && bytes.length >= 4 && v.getUint16(0) === 0xffd8) {
      var at = 2;
      while (at + 4 <= bytes.length) {
        if (bytes[at++] !== 255) break;
        while (bytes[at] === 255) at++;
        var marker = bytes[at++];
        if (marker === 0xd9 || marker === 0xda) break;
        if (marker === 1 || (marker >= 0xd0 && marker <= 0xd7)) continue;
        if (at + 2 > bytes.length) break;
        var length = v.getUint16(at);
        if (length < 2 || at + length > bytes.length) break;
        if ([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].indexOf(marker) >= 0 && length >= 8) {
          h = v.getUint16(at + 3); w = v.getUint16(at + 5); break;
        }
        at += length;
      }
    }
    if (!w || !h || w > MAX_IMAGE || h > MAX_IMAGE || w * h > MAX_PIXELS) throw new Error('Unsupported reference-image size');
    var scale = Math.min(1, PREVIEW_SIZE / Math.max(w,h));
    return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) };
  }
  function deadline(promise, ms) {
    return new Promise(function (resolve, reject) {
      var expired = false, timer = setTimeout(function () { expired = true; reject(new Error('Reference-image decode timed out')); }, ms);
      Promise.resolve(promise).then(function (result) {
        clearTimeout(timer);
        if (expired) { if (result && result.close) result.close(); return; }
        resolve(result);
      }, function (err) { clearTimeout(timer); if (!expired) reject(err); });
    });
  }
  async function decode(job) {
    var size = dimensions(job.bytes, job.mime);
    if (typeof root.createImageBitmap !== 'function') throw new Error('Reference-image decoding unavailable');
    var bitmap = await deadline(root.createImageBitmap(new Blob([job.bytes], {type:job.mime}), {
      resizeWidth:size.width, resizeHeight:size.height, resizeQuality:'high',
      imageOrientation:'none', premultiplyAlpha:'none', colorSpaceConversion:'none'
    }), 8000);
    try {
      var canvas = typeof root.OffscreenCanvas === 'function' ? new root.OffscreenCanvas(size.width,size.height) :
        root.document && root.document.createElement('canvas');
      if (!canvas) throw new Error('Reference-image canvas unavailable');
      canvas.width = size.width; canvas.height = size.height;
      var context = canvas.getContext('2d', {willReadFrequently:true});
      if (!context) throw new Error('Reference-image canvas unavailable');
      context.drawImage(bitmap,0,0,size.width,size.height);
      return context.getImageData(0,0,size.width,size.height);
    } finally { if (bitmap.close) bitmap.close(); }
  }
  function texel(index, size, wrap) {
    if (wrap === 33071) return Math.max(0, Math.min(size - 1,index));
    if (wrap === 33648) {
      var mirrored = ((index % (2*size)) + 2*size) % (2*size);
      return mirrored < size ? mirrored : 2*size - mirrored - 1;
    }
    return ((index % size) + size) % size;
  }
  function sampleTexture(colors, job, pixels) {
    if (!pixels || !Number.isInteger(pixels.width) || !Number.isInteger(pixels.height) ||
        pixels.width < 1 || pixels.height < 1 || pixels.width > PREVIEW_SIZE || pixels.height > PREVIEW_SIZE ||
        !pixels.data || pixels.data.length !== pixels.width * pixels.height * 4 ||
        !Number.isInteger(job.start) || job.start < 0 || !Number.isInteger(job.count) || job.count < 1 ||
        job.start + job.count*3 > colors.length || !job.uvs || job.uvs.length !== job.count*2)
      throw new Error('Invalid reference pixels');
    for (var i = 0; i < job.uvs.length; i++) if (!Number.isFinite(job.uvs[i])) throw new Error('Invalid reference UV');
    for (var corner = 0; corner < job.count; corner++) {
      // glTF UV (0,0) addresses the image's upper-left pixel, as ImageData does.
      var x = job.uvs[corner*2] * pixels.width - 0.5, y = job.uvs[corner*2+1] * pixels.height - 0.5;
      var ix = Math.floor(x), iy = Math.floor(y), fx = x-ix, fy = y-iy;
      var x0 = texel(ix,pixels.width,job.wrapS), x1 = texel(ix+1,pixels.width,job.wrapS);
      var y0 = texel(iy,pixels.height,job.wrapT), y1 = texel(iy+1,pixels.height,job.wrapT);
      for (var c = 0; c < 3; c++) {
        var upper = linear(pixels.data[(y0*pixels.width+x0)*4+c])*(1-fx) + linear(pixels.data[(y0*pixels.width+x1)*4+c])*fx;
        var lower = linear(pixels.data[(y1*pixels.width+x0)*4+c])*(1-fx) + linear(pixels.data[(y1*pixels.width+x1)*4+c])*fx;
        colors[job.start+corner*3+c] *= upper*(1-fy) + lower*fy;
      }
    }
    return colors;
  }
  async function fromGLB(parsed) {
    var info = parsed && parsed.colorReference || {}, original = parsed && parsed.colors;
    if (!validColors(original, parsed && parsed.positions)) return {colors:null,kind:'none',note:info.note || ''};
    var jobs = Array.isArray(info.textureJobs) ? info.textureJobs : [];
    var colors = jobs.length ? new Float32Array(original) : original;
    var successes = 0, failed = info.kind === 'partial', began = Date.now();
    for (var i = 0; i < jobs.length; i++) {
      if (Date.now() - began > 16000 || i >= 16) { failed = true; break; }
      try { sampleTexture(colors,jobs[i],await decode(jobs[i])); successes++; }
      catch (_) { failed = true; }
    }
    if (jobs.length && !successes && !info.hasBaseColor) return {
      colors:null,kind:'none',note:'Source texture could not be read; choose a reference palette.'
    };
    return {colors:colors,kind:failed ? 'partial' : successes ? 'texture' : info.kind,
      note:failed ? 'Some source appearance could not be read. Color is a reference only.' :
        successes ? 'Source colors sampled for reference; painted details may be simplified.' : ''};
  }
  function reorderForSeat(colors) {
    if (!(colors instanceof Float32Array) || colors.length % 9) return null;
    var result = new Float32Array(colors.length), order = [0,2,1];
    for (var t = 0; t < colors.length; t += 9) for (var v = 0; v < 3; v++)
      for (var c = 0; c < 3; c++) result[t+v*3+c] = colors[t+order[v]*3+c];
    return result;
  }
  var api = {fromGLB:fromGLB,validColors:validColors,reorderForSeat:reorderForSeat,
    sampleTexture:sampleTexture,imageDimensions:dimensions};
  root.keycapColor = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
