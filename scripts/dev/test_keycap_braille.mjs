/* Tests for web/parts/keycap-braille.js - node scripts/dev/test_keycap_braille.mjs
 *
 * Braille is a specification, so these test it against the specification rather
 * than against how it looks. The dimensions are the load-bearing part: dot
 * spacing is what a fingertip actually resolves a cell by, so a "nicer looking"
 * scaled-up cell is not Braille at all. These pin the figures.
 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
require('../../web/parts/mesh-health.js');
const K = require('../../web/parts/keycap.js');
const B = require('../../web/parts/keycap-braille.js');

let pass = 0, fail = 0;
const ok = (n, got, want) => {
  const good = String(got) === String(want);
  console.log(`  ${good ? 'OK  ' : 'FAIL'} ${n}: got ${got}, want ${want}`);
  good ? pass++ : fail++;
};
const near = (n, got, want, tol) => {
  const good = Math.abs(got - want) <= tol;
  console.log(`  ${good ? 'OK  ' : 'FAIL'} ${n}: got ${got}, want ${want} +/-${tol}`);
  good ? pass++ : fail++;
};
const truthy = (n, v, d) => {
  console.log(`  ${v ? 'OK  ' : 'FAIL'} ${n}${d ? ' (' + d + ')' : ''}`);
  v ? pass++ : fail++;
};

console.log('\nthe dimensions are the spec, not a style');
near('dot diameter', B.SPEC.dotDia, 1.44, 0.001);
near('dot spacing within a cell', B.SPEC.dotSpacing, 2.34, 0.001);
near('cell spacing', B.SPEC.cellSpacing, 6.20, 0.001);
truthy('default dot height is at or above the LoC minimum',
  B.SPEC.dotHeight >= B.SPEC.dotHeightMin,
  B.SPEC.dotHeight + ' >= ' + B.SPEC.dotHeightMin);

console.log('\nGrade 1 encoding');
ok('a is dot 1', B.cellsFor('a').cells.join('|'), '1');
ok('b is dots 1-2', B.cellsFor('b').cells.join('|'), '12');
ok('z is 1356', B.cellsFor('z').cells.join('|'), '1356');
ok('w is 2456 - the one out of sequence', B.cellsFor('w').cells.join('|'), '2456');
ok('"cat" is three cells', B.cellsFor('cat').cells.join('|'), '14|1|2345');
/* Digits are a-j behind the number sign, which is the thing that catches people
   out on a keycap: one digit costs TWO cells. */
ok('5 takes a number sign then e', B.cellsFor('5').cells.join('|'), B.NUMBER_SIGN + '|15');
ok('so one digit is two cells', B.cellsFor('7').cells.length, 2);
ok('and 12 is three, not four', B.cellsFor('12').cells.length, 3);
ok('a capital takes its own prefix cell', B.cellsFor('A').cells.join('|'), B.CAPITAL_SIGN + '|1');
ok('lower case does not', B.cellsFor('a').cells.length, 1);
ok('a full stop', B.cellsFor('.').cells.join('|'), '256');
ok('an unknown glyph is reported, not dropped', B.cellsFor('a©b').unknown.join(''), '©');

console.log('\nwhat fits a keycap - the number that decides everything');
near('one cell is 3.78 mm wide', B.textWidthMm(1), 3.78, 0.01);
near('two cells are 9.98 mm', B.textWidthMm(2), 9.98, 0.01);
near('three are 16.18 mm', B.textWidthMm(3), 16.18, 0.01);
near('a cell is 6.12 mm tall', B.cellHeightMm(), 6.12, 0.01);
ok('a 13.7 mm XDA top holds two cells', B.cellsThatFit(13.7), 2);
ok('a 12.4 mm Cherry top also holds two', B.cellsThatFit(12.4), 2);
ok('a 3 mm face holds none', B.cellsThatFit(3), 0);

const three = B.check('abc', 13.7, 13.7);
ok('so "abc" does not fit a 1u cap', three.ok, false);
truthy('and it says the spacing cannot be shrunk',
  /standard pitch/.test(three.issues.join(' ')));
const one = B.check('q', 13.7, 13.7);
ok('but a single letter does', one.ok, true);
ok('and so does a digit, at two cells', B.check('7', 13.7, 13.7).ok, true);
truthy('which it warns about', B.check('7', 13.7, 13.7).notes.some(n => /number sign/.test(n)));
ok('an unencodable character fails the check', B.check('©', 13.7, 13.7).ok, false);

console.log('\nthe dots land where Braille says they do');
const relA = B.brailleRelief('a');            // dot 1 only: top-left of the cell
ok('one dot', relA.braille.dots, 1);
const W = 13.7, half = W / 2;
// dot 1 sits at (-1.17, +2.34) mm from the middle of a single-cell block
near('dot 1 is at full height', -relA(-1.17 / half, 2.34 / half, W, W), B.SPEC.dotHeight, 0.01);
near('and the face beside it is flat', relA(0.9, -0.9, W, W), 0, 1e-9);
const relC = B.brailleRelief('c');            // dots 1 and 4: top-left and top-right
ok('two dots', relC.braille.dots, 2);
near('dot 4 is one dot-spacing to the right',
  -relC((-1.17 + B.SPEC.dotSpacing) / half, 2.34 / half, W, W), B.SPEC.dotHeight, 0.01);
near('nothing in the middle between them',
  relC((-1.17 + B.SPEC.dotSpacing / 2) / half, 2.34 / half, W, W), 0, 1e-9);

console.log('\ndots are domes, not posts');
/* A flat-topped cylinder reads wrong under a finger and a cone reads sharp.
   Halfway out from a dot centre a spherical cap is still most of its height. */
const rq = B.SPEC.dotDia / 2;
const mid = -relA((-1.17 + rq * 0.5) / half, 2.34 / half, W, W);
truthy('halfway out it is still high', mid > B.SPEC.dotHeight * 0.8, mid.toFixed(3) + ' mm');
const edge = -relA((-1.17 + rq * 0.99) / half, 2.34 / half, W, W);
truthy('and it comes down to the face at the rim', edge < B.SPEC.dotHeight * 0.2, edge.toFixed(3) + ' mm');

console.log('\nit is raised, and honest about what that costs');
ok('raised', relA.raised, true);
truthy('the displacement is negative, which is what raised means', relA(-1.17 / half, 2.34 / half, W, W) < 0);
truthy('the check says it needs supports',
  B.check('a', 13.7, 13.7).notes.some(n => /tilted and supported/.test(n)));

console.log('\na Braille cap is still a printable cap');
const cap = K.build({ profile: 'XDA', row: 'R3', sizeU: 1, topGrid: 31,
                      relief: B.brailleRelief('j') });
const h = globalThis.meshHealth(cap.positions);
ok('watertight', h.watertight, true);
ok('no flipped winding', h.flippedEdges, 0);
truthy('and the stem is untouched',
  Math.abs(cap.slotWidth - (K.MX.crossWide + K.MX.slotClearance)) < 1e-6);
truthy('the dots survive the printer',
  B.SPEC.dotDia / K.PIXEL_MM > 8,
  (B.SPEC.dotDia / K.PIXEL_MM).toFixed(1) + ' pixels across');

console.log('\na whole board can be labelled at once');
const set = B.forKeys(['a', 'b', 'c', '1', 'Q']);
ok('five caps', set.length, 5);
truthy('every one encodes', set.every(s => s.relief));
truthy('and each carries its own check', set.every(s => s.check && typeof s.check.ok === 'boolean'));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
