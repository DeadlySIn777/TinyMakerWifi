/* Braille keycaps.
 *
 * No generator involved and none wanted: Braille is a specification, not a
 * drawing. Every dimension below comes from one, and the whole value of the
 * thing is that it matches.
 *
 * ⚠️ THE SPACING IS NOT A STYLE CHOICE. It is tempting to scale Braille up to
 * fill a keycap, and it would look better. It would also stop being readable:
 * a Braille reader's fingertip resolves a cell by the fixed distance between
 * dots, and moving them apart turns one cell into something the finger reads as
 * two. So dot spacing, cell spacing and dot diameter here are the Library of
 * Congress / ADA figures and the engine refuses to scale them.
 *
 * What CAN be raised, and is raised by default, is dot HEIGHT. The LoC minimum
 * is 0.48 mm; ADA signage runs 0.6-0.9 mm, and a printed cap wants the upper
 * end because resin dots get handled, washed and worn. Default 0.60 mm.
 *
 * THE PRINTING CATCH. Braille has to be raised, and a raised legend on a cap
 * printed top-face-down reaches the plate before the face around it does - so
 * that face starts in mid air. Braille caps therefore need the same tilt and
 * leading-edge supports as any other raised legend, which keycapPrintPlan
 * already works out. There is no engraved option here; engraved Braille is not
 * Braille.
 *
 * Dot numbering, which is the whole notation:
 *      1 4
 *      2 5
 *      3 6
 *
 * No DOM, no imports - scripts/dev/test_keycap_braille.mjs runs it in node.
 */

(function (root) {
  'use strict';

  /* Millimetres, from the spec. Do not "improve" these. */
  var SPEC = {
    dotDia:      1.44,   // base diameter of a dot
    dotSpacing:  2.34,   // centre to centre within a cell, both axes
    cellSpacing: 6.20,   // centre of dot 1 to centre of the next cell's dot 1
    lineSpacing: 10.00,  // between rows of cells
    dotHeightMin: 0.48,  // Library of Congress minimum
    dotHeight:   0.60    // default here: ADA range, sturdier on a printed cap
  };

  /* Grade 1 (uncontracted) Unified English Braille. Values are dot numbers. */
  var LETTERS = {
    a:'1',    b:'12',   c:'14',   d:'145',  e:'15',   f:'124',  g:'1245',
    h:'125',  i:'24',   j:'245',  k:'13',   l:'123',  m:'134',  n:'1345',
    o:'135',  p:'1234', q:'12345',r:'1235', s:'234',  t:'2345', u:'136',
    v:'1236', w:'2456', x:'1346', y:'13456',z:'1356'
  };
  /* Digits are the letters a-j behind the number sign, which is why a single
     digit needs TWO cells - worth knowing before you try to fit one on a 1u. */
  var NUMBER_SIGN = '3456';
  var CAPITAL_SIGN = '6';
  var DIGITS = { '1':'a','2':'b','3':'c','4':'d','5':'e','6':'f','7':'g','8':'h','9':'i','0':'j' };
  var PUNCT = {
    ' ': '',      ',': '2',     ';': '23',    ':': '25',    '.': '256',
    '?': '236',   '!': '235',   "'": '3',     '-': '36',    '/': '34',
    '(': '2356',  ')': '2356',  '"': '2356',  '#': NUMBER_SIGN,
    '+': '346',   '=': '123456','*': '16',    '&': '12346', '%': '146'
  };

  /* Text -> a list of cells, each a set of dot numbers. Returns what it could
     not encode rather than dropping it silently. */
  function cellsFor(text, opts) {
    var o = opts || {};
    var cells = [], unknown = [], numberMode = false;
    var s = String(text == null ? '' : text);
    for (var i = 0; i < s.length; i++) {
      var ch = s[i], lower = ch.toLowerCase();
      if (DIGITS[ch]) {
        if (!numberMode) { cells.push(NUMBER_SIGN); numberMode = true; }
        cells.push(LETTERS[DIGITS[ch]]);
        continue;
      }
      numberMode = false;
      if (LETTERS[lower]) {
        // a capital gets its own prefix cell, which costs space on a keycap
        if (o.capitals !== false && ch !== lower) cells.push(CAPITAL_SIGN);
        cells.push(LETTERS[lower]);
      } else if (PUNCT[ch] != null) {
        if (PUNCT[ch]) cells.push(PUNCT[ch]); else cells.push('');   // space
      } else {
        unknown.push(ch);
      }
    }
    return { cells: cells, unknown: unknown };
  }

  function cellWidthMm()  { return SPEC.dotSpacing + SPEC.dotDia; }
  function cellHeightMm() { return 2 * SPEC.dotSpacing + SPEC.dotDia; }
  function textWidthMm(n) { return n <= 0 ? 0 : (n - 1) * SPEC.cellSpacing + cellWidthMm(); }

  /* How many cells fit across a face, at spec spacing. This is the number that
     decides what you can put on a key, and it is small: a 13.7 mm XDA top takes
     two cells, so one letter, or one digit (which costs a number sign), or two
     letters with no room to spare. */
  function cellsThatFit(topWmm) {
    var n = 0;
    while (textWidthMm(n + 1) <= topWmm) n++;
    return n;
  }

  /* ---- the relief -------------------------------------------------------
     Dots are spherical caps, not cylinders - a flat-topped dot reads wrong
     under a finger and a cone reads sharp. Returns the same shape of function
     keycap.build() takes, so a Braille cap goes through the identical path as
     any other: same preview, same printability check, same slicer hand-off. */
  function brailleRelief(text, opts) {
    var o = opts || {};
    var height = o.dotHeight == null ? SPEC.dotHeight : o.dotHeight;
    var enc = cellsFor(text, o);
    var cells = enc.cells;
    if (!cells.length) return null;

    var r = SPEC.dotDia / 2;
    var totalW = textWidthMm(cells.length);
    var totalH = cellHeightMm();

    /* Dot centres in mm, relative to the middle of the whole text block. */
    var dots = [];
    for (var c = 0; c < cells.length; c++) {
      var pattern = cells[c];
      var originX = c * SPEC.cellSpacing - totalW / 2 + r;
      for (var d = 1; d <= 6; d++) {
        if (pattern.indexOf(String(d)) < 0) continue;
        var col = d <= 3 ? 0 : 1;
        var row = (d <= 3 ? d : d - 3) - 1;      // 0,1,2 top to bottom
        dots.push([originX + col * SPEC.dotSpacing,
                   totalH / 2 - r - row * SPEC.dotSpacing]);
      }
    }

    var f = function (u, v, topW, topD) {
      topW = topW || 13.7; topD = topD || topW;
      var x = u * topW / 2, y = v * topD / 2;    // cap-space millimetres
      var best = 0;
      for (var i = 0; i < dots.length; i++) {
        var dx = x - dots[i][0], dy = y - dots[i][1];
        var dd = dx * dx + dy * dy;
        if (dd >= r * r) continue;
        // spherical cap: full height at the centre, tangent to the face at the rim
        var h = height * Math.sqrt(1 - dd / (r * r));
        if (h > best) best = h;
      }
      return -best;                               // negative = raised
    };
    f.depth = height;
    f.raised = true;
    f.parts = [];
    f.braille = { cells: cells, dots: dots.length, unknown: enc.unknown,
                  widthMm: +totalW.toFixed(2), heightMm: +totalH.toFixed(2) };
    return f;
  }

  /* ---- will it work, as Braille and as a print? ------------------------- */
  function check(text, topWmm, topDmm, opts) {
    var o = opts || {};
    var px = o.pixelMm || (40.8 / 320);
    var height = o.dotHeight == null ? SPEC.dotHeight : o.dotHeight;
    var enc = cellsFor(text, o);
    var n = enc.cells.length;
    var issues = [], notes = [];
    var w = textWidthMm(n), h = cellHeightMm();
    var fits = cellsThatFit(topWmm);

    if (!n) issues.push('nothing to write');
    if (enc.unknown.length)
      issues.push('no Braille for ' + enc.unknown.map(function (c) { return '"' + c + '"'; }).join(', '));
    if (w > topWmm)
      issues.push(n + ' cells need ' + w.toFixed(1) + ' mm and this face is ' +
        topWmm.toFixed(1) + ' mm - it holds ' + fits + '. The spacing cannot be ' +
        'shrunk to fit: a Braille cell is only legible at its standard pitch.');
    if (h > topDmm)
      issues.push('a cell is ' + h.toFixed(1) + ' mm tall and this face is only ' + topDmm.toFixed(1));
    if (height < SPEC.dotHeightMin)
      issues.push('a ' + height.toFixed(2) + ' mm dot is below the ' + SPEC.dotHeightMin +
        ' mm minimum and will not be felt');

    notes.push('dot ' + SPEC.dotDia + ' mm across = ' + (SPEC.dotDia / px).toFixed(1) + ' printer pixels');
    notes.push('dot ' + height.toFixed(2) + ' mm tall = ' + Math.round(height / 0.05) + ' layers at 0.05 mm');
    notes.push('raised, so the cap has to be tilted and supported on its leading edge');
    if (/[0-9]/.test(String(text)))
      notes.push('digits carry a number sign, so one digit costs two cells');

    return { ok: !issues.length, cells: n, widthMm: +w.toFixed(2), heightMm: +h.toFixed(2),
             cellsThatFit: fits, dotPixels: +(SPEC.dotDia / px).toFixed(1),
             issues: issues, notes: notes, unknown: enc.unknown };
  }

  /* A whole keyboard's worth, for labelling a board: one cap per key. */
  function forKeys(keys, opts) {
    return (keys || []).map(function (k) {
      return { key: k, relief: brailleRelief(k, opts), check: check(k, (opts && opts.topW) || 13.7,
                                                                   (opts && opts.topD) || 13.7, opts) };
    });
  }

  root.keycapBraille = {
    SPEC: SPEC, LETTERS: LETTERS, DIGITS: DIGITS, PUNCT: PUNCT,
    NUMBER_SIGN: NUMBER_SIGN, CAPITAL_SIGN: CAPITAL_SIGN,
    cellsFor: cellsFor, brailleRelief: brailleRelief, check: check, forKeys: forKeys,
    cellWidthMm: cellWidthMm, cellHeightMm: cellHeightMm,
    textWidthMm: textWidthMm, cellsThatFit: cellsThatFit
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.keycapBraille;
})(typeof window !== 'undefined' ? window : globalThis);
