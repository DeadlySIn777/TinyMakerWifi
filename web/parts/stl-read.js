/* STL in, triangles out. Forty lines, no engine, no network.
 *
 * WHY THIS EXISTS AT ALL. The keycap card had exactly one way to get a model
 * onto a cap: ask Meshy. When that call fails - and it does, because a browser
 * extension blocks api.meshy.ai, or the phone is on the printer's own access
 * point which has no internet - the entire reason this product exists stops
 * working, with no way round it. There was no "open a file". A single remote
 * call was a single point of failure for the whole artisan workflow.
 *
 * The generic model card CAN read an STL, but only through the slicer's WASM
 * engine (slicerMod.parseSTL), which is a megabyte of WebAssembly fetched off
 * the SD card and spun up in a worker. The keycap card should not have to wake
 * a slicer to look at a file, and on a cold cache that path is slower than the
 * generation it replaces. So: the parser, here, in plain JS.
 *
 * DETECTING THE FORMAT IS THE ONLY SUBTLE PART, and the obvious test is wrong.
 * "Does it start with the word solid" fails on every binary STL written by an
 * exporter that puts a name in the 80-byte header - and several do, including
 * some versions of SolidWorks. The sound test is arithmetic: a binary STL is
 * exactly 84 + 50 * n bytes for the n in its header. Nothing else lands on that
 * number by accident, so if the length matches, it is binary, whatever the
 * first five bytes say.
 *
 * No DOM, no fetch. scripts/dev/test_stl_read.mjs runs it in node.
 */

(function (root) {
  'use strict';

  var MAX_TRIS = 3000000;   // ~150 MB of STL; past this something is wrong

  function readBinary(buf) {
    var dv = new DataView(buf);
    var n = dv.getUint32(80, true);
    var out = new Float32Array(n * 9), o = 0, off = 84, i, v;
    for (i = 0; i < n; i++) {
      off += 12;                                  // the normal, which we recompute anyway
      for (v = 0; v < 9; v++) { out[o++] = dv.getFloat32(off, true); off += 4; }
      off += 2;                                   // attribute byte count
    }
    return out;
  }

  function readAscii(text) {
    /* One pass, no split() on the whole file: an ASCII STL of any size is
       mostly whitespace and splitting it allocates several times the file. */
    /* ⚠️ THE OLD CLASS HELD '+' AND NOT '-', so it matched 1.0e+000 and could
       not match 1.0e-003 - which exporters emit constantly for small
       coordinates. A miss on the first or second coordinate failed the whole
       match, the engine skipped past the line, and the VERTEX WAS DROPPED:
       every later vertex shifted one place and triangles were then built from
       corners belonging to different facets. A mesh that is wrong everywhere,
       with nothing to say so. The length%9 trim at the end hides it further by
       quietly discarding the remainder.

       A real float pattern, not a character class - adding '-' to the class
       would also have accepted "1-2-3". */
    var NUM = '[-+]?(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][-+]?\\d+)?';
    var re = new RegExp('vertex\\s+(' + NUM + ')\\s+(' + NUM + ')\\s+(' + NUM + ')', 'g');
    var vals = [], m;
    while ((m = re.exec(text))) {
      vals.push(+m[1], +m[2], +m[3]);
      if (vals.length > MAX_TRIS * 9) throw new Error('That STL is too large to open here.');
    }
    /* A remainder means vertices went missing mid-file, not that the last facet
       was cut short - and silently trimming it turns a corrupt read into a
       plausible-looking mesh. Say so. */
    if (vals.length % 9) {
      if (vals.length % 3)
        throw new Error('That ASCII STL has an incomplete vertex in it - the file ' +
                        'looks truncated or damaged.');
      vals.length -= vals.length % 9;
    }
    return new Float32Array(vals);
  }

  /* buf: ArrayBuffer. Returns { positions, triangles, format }. */
  function readSTL(buf) {
    if (!buf || !buf.byteLength) throw new Error('That file is empty.');
    if (buf.byteLength < 84) throw new Error('That file is too short to be an STL.');

    var dv = new DataView(buf);
    var n = dv.getUint32(80, true);
    var looksBinary = n > 0 && n <= MAX_TRIS && buf.byteLength === 84 + n * 50;

    var positions;
    if (looksBinary) {
      positions = readBinary(buf);
    } else {
      /* Decode as text only once we have ruled out binary - a 40 MB binary STL
         run through TextDecoder is a long stall and a lot of garbage. */
      var text = new TextDecoder('utf-8', { fatal: false }).decode(new Uint8Array(buf));
      if (!/^\s*solid/i.test(text.slice(0, 200)) || !/vertex/i.test(text.slice(0, 100000)))
        throw new Error('That does not look like an STL - the header is neither a ' +
                        'binary triangle count nor an ASCII "solid".');
      positions = readAscii(text);
    }

    if (!positions.length || positions.length % 9)
      throw new Error('That STL has no complete triangles in it.');

    /* Every value has to be a real number: a truncated download or a file that
       is actually something else produces NaN, and NaN travels silently all the
       way to a mesh that renders as nothing and slices as nothing. */
    for (var i = 0; i < positions.length; i++) {
      if (!isFinite(positions[i]))
        throw new Error('That STL has broken numbers in it - it may have been ' +
                        'truncated on the way here.');
    }

    return { positions: positions, triangles: positions.length / 9,
             format: looksBinary ? 'binary' : 'ascii' };
  }

  /* Read whichever of the two formats the keycap card accepts. GLB goes to the
     reader that already exists; STL comes here. One door, so the card does not
     have to know which it was handed. */
  function readModelFile(buf, name) {
    var isGlb = /\.glb$/i.test(name || '');
    if (!isGlb && buf && buf.byteLength >= 4) {
      var m = new DataView(buf).getUint32(0, false);
      if (m === 0x676c5446) isGlb = true;            // 'glTF', whatever it is called
    }
    if (isGlb) {
      if (!root.meshyParseGLB) throw new Error('The GLB reader is missing from this build.');
      var g = root.meshyParseGLB(buf);
      return { positions: g.positions, triangles: g.positions.length / 9, format: 'glb' };
    }
    return readSTL(buf);
  }

  root.stlRead = { readSTL: readSTL, readModelFile: readModelFile, MAX_TRIS: MAX_TRIS };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.stlRead;
})(typeof window !== 'undefined' ? window : globalThis);
