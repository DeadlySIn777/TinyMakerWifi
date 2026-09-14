/* Tests for web/parts/print-sim.js - node scripts/dev/test_print_sim.mjs
 * Validated against the printer's OWN reported numbers from real runs tonight,
 * not against the model's own assumptions.
 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const S = require('../../web/parts/print-sim.js');

let pass = 0, fail = 0;
const near = (n, got, want, tol) => {
  const good = Math.abs(got - want) <= tol;
  console.log(`  ${good ? 'OK  ' : 'FAIL'} ${n}: got ${got}, want ${want} +/-${tol}`);
  good ? pass++ : fail++;
};
const ok = (n, got, want) => {
  const good = String(got) === String(want);
  console.log(`  ${good ? 'OK  ' : 'FAIL'} ${n}: got ${got}, want ${want}`);
  good ? pass++ : fail++;
};

// The profile actually loaded on the printer tonight.
const ANY = {
  baseExposure: 35, baseLayers: 6, regularExposure: 14, transitionLayers: 5,
  slowLiftDistance: 1, fastLiftDistance: 2,
  slowLiftFeedrate: 40, fastLiftFeedrate: 50, dropBackFeedrate: 50
};

console.log('\n32 mm diorama - 640 layers (the run that succeeded)');
let e = S.estimate(ANY, 640);
console.log(`    model says ${e.text} (${e.seconds}s), ${e.perRegularLayerS}s per regular layer`);
// printer reported 4h 01m remaining at layer 9 -> ~4h 03m total
near('total vs printer\'s own 4h 03m', e.seconds, 4 * 3600 + 3 * 60, 420);

console.log('\n52 mm version - 1180 layers (the one we stopped)');
let e2 = S.estimate(ANY, 1180);
console.log(`    model says ${e2.text}`);
// printer reported 7h 32m for this model
near('total vs printer\'s own 7h 32m', e2.seconds, 7 * 3600 + 32 * 60, 900);

console.log('\nbase layers cost more than regular ones');
ok('base layer longer', S.layerSeconds(ANY, 1) > S.layerSeconds(ANY, 600), true);
near('a base layer', S.layerSeconds(ANY, 1), 35 + 3.6 + 6.0, 1.5);

console.log('\nresin check - the thing that actually ends prints');
let r = S.resinCheck(9.6, 15.0, 4.0);
ok('15ml vat, 9.6 needed -> finishes', r.willFinish, true);
near('left over', r.leftMl, 5.4, 0.01);

r = S.resinCheck(9.6, 12.0, 4.0);
ok('12ml vat -> does NOT finish', r.willFinish, false);
console.log(`    "${r.advice}"`);

r = S.resinCheck(2.43, 10.1, 4.0);
ok('32mm print on 10.1ml -> fine', r.willFinish, true);

console.log('\nformatting');
ok('3600s', S.human(3600), '1h 00m');
ok('300s', S.human(300), '5m');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
