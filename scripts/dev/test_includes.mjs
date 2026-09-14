/* node scripts/dev/test_includes.mjs
 *
 * WHY THIS EXISTS. web/parts/keycap-skin.js sat in the tree, fully written and
 * fully tested, and was never once loaded by the page - the patch script that
 * was supposed to add its #include died on an earlier edit and the fix was
 * applied by hand without re-running it. The card even had a Generate button
 * wired to it. Nothing failed: the module simply was not there, the guard in
 * the UI reported a wrong-but-plausible reason, and a browser walkthrough of
 * the card looked fine because the path that used it needed an API key nobody
 * had.
 *
 * A part that exists but is not included is invisible in every other way, so it
 * gets its own check: every file in web/parts/ must be referenced by
 * dashboard.html, and every #include must resolve to a file.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const parts = path.join(root, 'web', 'parts');
const page = fs.readFileSync(path.join(root, 'web', 'dashboard.html'), 'utf8');

let pass = 0, fail = 0;
const ok = (n, good, detail) => {
  console.log(`  ${good ? 'OK  ' : 'FAIL'} ${n}${detail ? ' - ' + detail : ''}`);
  good ? pass++ : fail++;
};

// what the page asks for
const asked = new Set();
const re = /(?:<!--|\/\*)#include\s+(parts\/[A-Za-z0-9._-]+)(?:-->|\*\/)/g;
let m;
while ((m = re.exec(page))) asked.add(m[1].replace(/^parts\//, ''));

console.log('\nevery #include resolves to a real file');
let unresolved = [];
for (const a of asked) if (!fs.existsSync(path.join(parts, a))) unresolved.push(a);
ok(`${asked.size} includes`, unresolved.length === 0, unresolved.join(', ') || 'all present');

console.log('\nevery part in web/parts/ is actually loaded');
/* Files that are deliberately not #included. slicer.css and the slicer's own
   markup are pulled in by the slicer card's own machinery, and SLICERIUI.md is
   documentation. Anything else missing here is a module nobody loads. */
const EXEMPT = new Set(['SLICERIUI.md', 'slicer.css', 'slicer-card.html',
                        'slicer-view.html', 'slicer.js', 'slicer-3d-bridge.js']);
const onDisk = fs.readdirSync(parts).filter(f => /\.(js|html)$/.test(f));
const orphans = onDisk.filter(f => !asked.has(f) && !EXEMPT.has(f));
ok(`${onDisk.length} part files, ${orphans.length} orphaned`,
   orphans.length === 0, orphans.length ? 'NOT LOADED: ' + orphans.join(', ') : 'none orphaned');

console.log('\nload order: a module comes before whatever binds to it');
/* keycap-ui.js reaches for window.keycap, window.keycapIcons, window.keycapSkin
   and window.keycapView3d at parse time only inside handlers, but the early
   return `if (!$('kcCard') || !window.keycap) return;` runs immediately - so
   keycap.js must be included first or the whole card silently does nothing. */
const order = [];
const re2 = /(?:<!--|\/\*)#include\s+parts\/([A-Za-z0-9._-]+)(?:-->|\*\/)/g;
while ((m = re2.exec(page))) order.push(m[1]);
const at = f => order.indexOf(f);
const deps = [
  ['keycap-ui.js', 'keycap.js'],
  ['keycap-ui.js', 'keycap-icons.js'],
  ['keycap-ui.js', 'keycap-skin.js'],
  ['keycap-ui.js', 'keycap-view3d.js'],
  ['keycap-ui.js', 'keycap-braille.js'],
  ['keycap-ui.js', 'keycap-share.js'],
  ['keycap-ui.js', 'keycap-library.js'],
  ['keycap.js', 'mesh-health.js'],
  ['meshy-ui.js', 'meshy.js'],
  ['meshy.js', 'meshy-glb.js'],
];
for (const [after, before] of deps) {
  const a = at(after), b = at(before);
  ok(`${before} loads before ${after}`, a >= 0 && b >= 0 && b < a,
     a < 0 ? `${after} not included` : b < 0 ? `${before} not included` : `${b} < ${a}`);
}

console.log('\nthe card markup carries every id its JS binds to');
const card = fs.readFileSync(path.join(parts, 'keycap-card.html'), 'utf8');
const ui = fs.readFileSync(path.join(parts, 'keycap-ui.js'), 'utf8');
const wanted = new Set();
const re3 = /\$\('([A-Za-z0-9_-]+)'\)/g;
while ((m = re3.exec(ui))) wanted.add(m[1]);
const missing = [...wanted].filter(id => !new RegExp(`id=['"]${id}['"]`).test(card));
ok(`${wanted.size} ids referenced by keycap-ui.js`, missing.length === 0,
   missing.length ? 'MISSING FROM MARKUP: ' + missing.join(', ') : 'all present');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
