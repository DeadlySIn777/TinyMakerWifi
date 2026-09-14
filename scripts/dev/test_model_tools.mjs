/* Tests for web/parts/model-tools.js — node scripts/dev/test_model_tools.mjs
 *
 * Checked against numbers that were worked out by hand during a real session,
 * so a pass means it reproduces decisions we already know were right (and, in
 * one case, catches the one we got wrong).
 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const T = require('../../web/parts/model-tools.js');

let pass = 0, fail = 0;
const ok = (n, got, want) => {
  const good = String(got) === String(want);
  console.log(`  ${good ? 'OK  ' : 'FAIL'} ${n}: got ${got}, want ${want}`);
  good ? pass++ : fail++;
};
const near = (n, got, want, tol = 0.05) => {
  const good = Math.abs(got - want) <= tol;
  console.log(`  ${good ? 'OK  ' : 'FAIL'} ${n}: got ${(+got).toFixed(3)}, want ~${want}`);
  good ? pass++ : fail++;
};

// The real Meshy export, in its own (1000x too large) units.
const MESHY = { x: 18035.77, y: 19002.62, z: 40000.0 };

console.log('\nauto scale - the AI export that arrived 1000x too big');
let r = T.autoScale(MESHY, { mode: 'fill', flatBase: false });
ok('fits already?', r.fitsAlready, false);
ok('limited by', r.limitedBy, 'Z');
near('height lands under the 52mm supported ceiling', r.result.z, 46.8, 0.5);

console.log('\n  ...and "fit" alone would NOT have enlarged it');
// (this is the trap: a microscopic model already "fits")
const tiny = { x: 1, y: 1, z: 2 };
ok('fit never enlarges', T.autoScale(tiny, { mode: 'fit' }).scale, 1);
ok('fill does enlarge', T.autoScale(tiny, { mode: 'fill' }).scale > 1, true);

console.log('\nflat base unlocks the taller ceiling');
const a = T.autoScale(MESHY, { mode: 'fill', flatBase: false }).result.z;
const b = T.autoScale(MESHY, { mode: 'fill', flatBase: true }).result.z;
ok('flat base is taller', b > a, true);
ok('supported ceiling', T.VOLUME.zSupported, 52);
ok('flat ceiling', T.VOLUME.zFlat, 58);

console.log('\nmanual scale - the three ways people say it');
near('0.0013 reproduces the 52mm print', T.manualScale(MESHY, { heightMm: 52 }).scale, 0.0013, 0.00005);
near('0.0008 reproduces the 32mm diorama', T.manualScale(MESHY, { heightMm: 32 }).scale, 0.0008, 0.00005);
ok('55mm does NOT fit on supports', T.manualScale(MESHY, { heightMm: 55 }).fits, false);
ok('55mm DOES fit base-flat', T.manualScale(MESHY, { heightMm: 55, flatBase: true }).fits, true);
console.log('    (that is exactly the failure we hit: "exceeds maximum print height")');
ok('percent works', T.manualScale({x:10,y:10,z:10}, { percent: 250 }).result.z, 25);
ok('longest edge works', T.manualScale({x:10,y:20,z:5}, { longestMm: 30 }).result.y, 30);

console.log('\nsmart rename - the names the send tool actually produced');
let p = T.parseDescribedName('LakesideDr_SL1_005_8_2026_09_13_03_54_37');
ok('model', p.model, 'LakesideDr');
ok('printer', p.printer, 'SL1');
ok('layer mm decoded from 005', p.layerMm, '0.05');
ok('exposure s', p.exposureS, 8);
ok('date', p.date, '2026-09-13');

const nice = T.smartName('LakesideDr_SL1_005_8_2026_09_13_03_54_37', { heightMm: 52 });
console.log(`    "LakesideDr_SL1_005_8_2026_09_13_03_54_37"  ->  "${nice}"`);
ok('shorter', nice.length < 40, true);
ok('keeps the model', /Lakeside/.test(nice), true);
ok('keeps a date for uniqueness', /0913/.test(nice), true);
ok('survives the firmware name rule', /^[A-Za-z0-9_-]+$/.test(nice), true);

ok('a plain name passes through', /Benchy/.test(T.smartName('Benchy')), true);
ok('unparseable name still returns something', T.smartName('') !== '', true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
