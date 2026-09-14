/* Tests for web/parts/keycap-share.js - node scripts/dev/test_keycap_share.mjs
 *
 * A design code is the thing somebody approves and then somebody else prints,
 * so the failure that matters is not "it threw" - it is "it came back subtly
 * different and nobody noticed". These test the round trip exactly, and test
 * that the one case which CANNOT round trip says so.
 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const S = require('../../web/parts/keycap-share.js');

let pass = 0, fail = 0;
const ok = (n, got, want) => {
  const good = String(got) === String(want);
  console.log(`  ${good ? 'OK  ' : 'FAIL'} ${n}: got ${got}, want ${want}`);
  good ? pass++ : fail++;
};
const truthy = (n, v, d) => {
  console.log(`  ${v ? 'OK  ' : 'FAIL'} ${n}${d ? ' (' + d + ')' : ''}`);
  v ? pass++ : fail++;
};

console.log('\na design survives the round trip exactly');
const d = { profile: 'XDA', row: 'R3', sizeU: 1.25, icon: 'ifak', digit: '4',
            depth: 0.55, raised: true, key: 'F' };
const code = S.encode(d);
truthy('the code is taggeda', code.startsWith(S.TAG + '-'), code.slice(0, 28) + '...');
truthy('and short enough to paste into a message', code.length < 200, code.length + ' chars');
const back = S.decode(code);
for (const k of Object.keys(d)) ok('  ' + k, JSON.stringify(back[k]), JSON.stringify(d[k]));

console.log('\nfalse and zero are not lost');
/* The classic bug: `opts.x || DEFAULT` turns an explicit engraved back into
   raised. raised:false must come back false, not missing. */
const eng = S.decode(S.encode({ profile: 'DSA', row: 'R3', sizeU: 1, raised: false, depth: 0.3 }));
ok('engraved stays engraved', eng.raised, false);
ok('and the depth is kept', eng.depth, 0.3);

console.log('\nBraille round trips, because it is parameters');
const br = S.decode(S.encode({ profile: 'XDA', row: 'R3', sizeU: 1, braille: 'q', raised: true }));
ok('the character', br.braille, 'q');
truthy('and it is reproducible', S.isReproducible(br));

console.log('\na generated design is NOT reproducible, and says so');
/* A mesh cannot fit in something you paste into a message, so the code stores
   the prompt - and a generator does not return the same sculpt twice. */
const gen = { profile: 'XDA', row: 'R3', sizeU: 1, prompt: 'a brass owl', raised: true, depth: 2 };
ok('flagged as not reproducible', S.isReproducible(gen), false);
const genBack = S.decode(S.encode(gen));
ok('the prompt travels', genBack.prompt, 'a brass owl');
truthy('the mesh does not', genBack.skin === undefined);
truthy('a drawn icon IS reproducible', S.isReproducible({ icon: 'pills' }));

console.log('\nbad codes fail loudly, never quietly into defaults');
/* A code that decodes to a default design is how somebody approves one cap and
   prints another. Every one of these must throw. */
const bad = [
  ['empty', ''],
  ['no tag', 'eyJwIjoiWERBIn0'],
  ['wrong tag', 'TMK9-eyJwIjoiWERBIn0'],
  ['damaged payload', S.TAG + '-not!valid!base64!!'],
  ['valid base64, no design', S.TAG + '-' + Buffer.from('{"zz":1}').toString('base64url')],
];
for (const [name, c] of bad) {
  let threw = '';
  try { S.decode(c); } catch (e) { threw = e.message; }
  truthy(name + ' throws', !!threw, threw.slice(0, 62));
}
let msg = '';
try { S.decode('TMK9-abc'); } catch (e) { msg = e.message; }
truthy('and a wrong tag names the tag it found', /TMK9/.test(msg));

console.log('\nunknown fields from a newer version are ignored, not fatal');
const future = S.TAG + '-' + Buffer.from(JSON.stringify({ p: 'XDA', r: 'R3', zz: 'x' })).toString('base64url');
ok('it still opens', S.decode(future).profile, 'XDA');

console.log('\nit describes itself in words a person can check');
const t = S.describe(d);
truthy('names the profile', /XDA/.test(t), t);
truthy('names the size', /1.25u/.test(t));
truthy('names the finish', /raised/.test(t));
truthy('an engraved one says engraved', /engraved/.test(S.describe({ profile: 'DSA', raised: false, depth: 0.4 })));

console.log('\nTHE LEGEND SWITCH TRAVELS, because a blank cap has to arrive blank');
/* Turning Legend off does not clear the digit - the render path suppresses it
   through legendOn() - so a code for a deliberately blank cap still carries
   digit:'5'. Without a field for the switch, the far end had nothing to read
   and rebuilt the cap WITH the 5 on it: the owner approves a blank cap and
   prints a numbered one. */
{
  const blank = { profile: 'DSA', row: 'R3', sizeU: 1, digit: '5',
                  depth: 0.55, raised: false, key: '5', legendOn: false };
  const c = S.encode(blank);
  const b = S.decode(c);
  ok('the switch survives the round trip', b.legendOn, false);
  ok('and the digit still travels beside it', b.digit, '5');

  const on = S.decode(S.encode(Object.assign({}, blank, { legendOn: true })));
  ok('and so does the other position', on.legendOn, true);

  /* A code written before the field existed has no 'l'. It must decode as ON,
     which is what those codes were made under - decoding them as blank would
     silently strip the legend off every design anyone has already shared. */
  const old = S.TAG + '-' + Buffer.from(JSON.stringify({
    p: 'DSA', r: 'R3', u: 1, d: '5', h: 0.55, a: false, k: '5'
  })).toString('base64url');
  const o = S.decode(old);
  truthy('an older code with no switch decodes as ON, not as blank',
    o.legendOn === undefined || o.legendOn === true, JSON.stringify(o.legendOn));
  ok('and the rest of it still opens', o.digit, '5');

  /* The two codes have to DIFFER, or the field is not actually being carried
     and both of these assertions would pass on an encoder that drops it. */
  truthy('a blank cap and a legended one are not the same code',
    S.encode(blank) !== S.encode(Object.assign({}, blank, { legendOn: true })),
    S.encode(blank).length + ' vs ' + S.encode(Object.assign({}, blank, { legendOn: true })).length);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
