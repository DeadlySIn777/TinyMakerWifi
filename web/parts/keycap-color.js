/* Optional GLB source-color reference. Geometry and STL output never change.
   Only embedded PNG/JPEG bytes are decoded; no fetches, credentials or URLs. */
(function (root) {
  'use strict';
  var MAX_IMAGE = 8192, MAX_PIXELS = 16777216, PREVIEW_SIZE = 2048;
  var MAX_REFERENCE_PIXELS = 4194304, MAX_FLOATS = 12000000;
  function linear(v) { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
  var LINEAR = new Float32Array(256);
  for (var li = 0; li < 256; li++) LINEAR[li] = linear(li);
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
  // Per-pixel UV lookup, in linear light. The renderer reuses `out`, avoiding
  // allocations in its inner loop. UV (0,0) is glTF's image upper-left corner.
  function samplePixel(texture, u, v, out) {
    var width = texture.width, height = texture.height, data = texture.data;
    if (texture.filter === 'nearest') {
      var nearest = (texel(Math.floor(v*height),height,texture.wrapT)*width +
        texel(Math.floor(u*width),width,texture.wrapS))*4;
      out[0] = LINEAR[data[nearest]]; out[1] = LINEAR[data[nearest+1]]; out[2] = LINEAR[data[nearest+2]];
      return out;
    }
    var x = u*width-0.5, y = v*height-0.5, ix = Math.floor(x), iy = Math.floor(y), fx = x-ix, fy = y-iy;
    var x0 = texel(ix,width,texture.wrapS), x1 = texel(ix+1,width,texture.wrapS);
    var y0 = texel(iy,height,texture.wrapT)*width, y1 = texel(iy+1,height,texture.wrapT)*width;
    for (var c = 0; c < 3; c++) {
      var upper = LINEAR[data[(y0+x0)*4+c]]*(1-fx) + LINEAR[data[(y0+x1)*4+c]]*fx;
      var lower = LINEAR[data[(y1+x0)*4+c]]*(1-fx) + LINEAR[data[(y1+x1)*4+c]]*fx;
      out[c] = upper*(1-fy) + lower*fy;
    }
    return out;
  }
  // Structured-cloneable reference data only: no URLs, canvases or credentials.
  // Limit both pixels and triangles before constructing any renderer lookup.
  function validTextureReference(ref, positions) {
    var length = typeof positions === 'number' ? positions : positions && positions.length;
    if (!ref || ref.version !== 1 || !Number.isSafeInteger(ref.positionLength) ||
        ref.positionLength < 9 || ref.positionLength > MAX_FLOATS || ref.positionLength % 9 ||
        (length != null && length !== ref.positionLength) ||
        !validColors(ref.baseColors,{length:ref.positionLength}) ||
        !Array.isArray(ref.textures) || !ref.textures.length || ref.textures.length > 16) return false;
    var end = 0, pixels = 0;
    for (var i = 0; i < ref.textures.length; i++) {
      var t = ref.textures[i];
      if (!t || !Number.isSafeInteger(t.start) || t.start < end || t.start % 9 ||
          !Number.isSafeInteger(t.count) || t.count < 3 || t.count % 3 || t.start+t.count*3 > ref.positionLength ||
          !(t.uvs instanceof Float32Array) || t.uvs.length !== t.count*2 ||
          !Number.isInteger(t.width) || !Number.isInteger(t.height) || t.width < 1 || t.height < 1 ||
          t.width > PREVIEW_SIZE || t.height > PREVIEW_SIZE ||
          !(t.data instanceof Uint8ClampedArray || t.data instanceof Uint8Array) || t.data.length !== t.width*t.height*4 ||
          [33071,33648,10497].indexOf(t.wrapS) < 0 || [33071,33648,10497].indexOf(t.wrapT) < 0 ||
          ['linear','nearest'].indexOf(t.filter) < 0) return false;
      pixels += t.width*t.height;
      if (pixels > MAX_REFERENCE_PIXELS) return false;
      for (var k = 0; k < t.uvs.length; k++) if (!Number.isFinite(t.uvs[k]) || Math.abs(t.uvs[k]) > 1000000) return false;
      end = t.start+t.count*3;
    }
    return true;
  }
  function copyTextureReference(ref, seated) {
    if (!validTextureReference(ref)) return null;
    var copies = new Map();
    return {version:1,positionLength:ref.positionLength,
      baseColors:seated ? reorderForSeat(ref.baseColors) : new Float32Array(ref.baseColors),
      textures:ref.textures.map(function (t) {
        var uvs = new Float32Array(t.uvs);
        if (seated) for (var i = 0; i < uvs.length; i += 6) for (var c = 0; c < 2; c++) {
          uvs[i+2+c] = t.uvs[i+4+c]; uvs[i+4+c] = t.uvs[i+2+c];
        }
        if (!seated && !copies.has(t.data)) copies.set(t.data,new Uint8ClampedArray(t.data));
        return {start:t.start,count:t.count,uvs:uvs,width:t.width,height:t.height,
          data:seated ? t.data : copies.get(t.data),wrapS:t.wrapS,wrapT:t.wrapT,filter:t.filter};
      })};
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
    var successes = 0, failed = info.kind === 'partial', began = Date.now(), textures = [], pixelCount = 0;
    for (var i = 0; i < jobs.length; i++) {
      if (Date.now() - began > 16000 || i >= 16) { failed = true; break; }
      try {
        var job = jobs[i], size = dimensions(job.bytes,job.mime);
        if (pixelCount+size.width*size.height > MAX_REFERENCE_PIXELS) throw new Error('Reference texture budget exceeded');
        var pixels = await decode(job);
        sampleTexture(colors,job,pixels);
        textures.push({start:job.start,count:job.count,uvs:new Float32Array(job.uvs),
          width:pixels.width,height:pixels.height,data:new Uint8ClampedArray(pixels.data),
          wrapS:job.wrapS,wrapT:job.wrapT,filter:job.filter === 'nearest' ? 'nearest' : 'linear'});
        pixelCount += pixels.width*pixels.height; successes++;
      }
      catch (_) { failed = true; }
    }
    if (jobs.length && !successes && !info.hasBaseColor) return {
      colors:null,kind:'none',note:'Source texture could not be read; choose a reference palette.'
    };
    var textureReference = successes ? {version:1,positionLength:original.length,
      baseColors:new Float32Array(original),textures:textures} : null;
    if (textureReference && !validTextureReference(textureReference,parsed.positions)) { textureReference = null; failed = true; }
    return {colors:colors,textureReference:textureReference,kind:failed ? 'partial' : successes ? 'texture' : info.kind,
      note:failed ? 'Some source appearance could not be read. Color is a reference only.' :
        successes ? 'Original model texture shown for painting reference.' : ''};
  }
  function reorderForSeat(colors) {
    if (!(colors instanceof Float32Array) || colors.length % 9) return null;
    var result = new Float32Array(colors.length), order = [0,2,1];
    for (var t = 0; t < colors.length; t += 9) for (var v = 0; v < 3; v++)
      for (var c = 0; c < 3; c++) result[t+v*3+c] = colors[t+order[v]*3+c];
    return result;
  }
  var api = {fromGLB:fromGLB,validColors:validColors,reorderForSeat:reorderForSeat,
    sampleTexture:sampleTexture,imageDimensions:dimensions,samplePixel:samplePixel,
    validTextureReference:validTextureReference,
    cloneTextureReference:function (ref) { return copyTextureReference(ref,false); },
    reorderTextureForSeat:function (ref) { return copyTextureReference(ref,true); }};
  root.keycapColor = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
