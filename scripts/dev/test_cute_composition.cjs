'use strict';
// Prompt-contract checks only: no service calls and no claim of sculpt quality.
const assert = require('node:assert/strict');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const skin = require(path.join(root, 'web/parts/keycap-skin.js'));
const catalog = require(path.join(root, 'web/parts/artisan-catalog.js'));
const cap = {wMm:18.65, dMm:18.65, hMm:19, minFeatureMm:.51};
let passed = 0;
function test(label, f) { f(); console.log('PASS ' + label); passed++; }

test('the dog subject survives verbatim and selected Cute artisan asks for a broad big-headed character', () => {
  const subject = 'Australian Shepard large Face';
  const prompt = skin.promptFor(subject, null, 'sculpt', cap, 'cuteartisan');
  assert.ok(prompt.startsWith(subject + ';'));
  assert.match(prompt, /broad compact silhouette/);
  assert.match(prompt, /full 3D sculpture/);
  assert.match(prompt, /broad stable underside/);
  assert.doesNotMatch(prompt, /full 3D figurine|stable feet/);
  assert.match(prompt, /for characters only: head over half their height/);
  assert.match(prompt, /plump body, stubby sturdy limbs/);
  assert.match(prompt, /expressive face, no extra ears or limbs/);
  assert.match(prompt, /sculpted geometry, not texture/);
  assert.match(prompt, /no detail finer than 0.51 mm/);
});

test('non-character subjects keep their descriptions and the anatomy instruction remains explicitly conditional', () => {
  for (const subject of ['A five-petal cherry blossom with a raised center', 'A rounded camper van with substantial wheels']) {
    const prompt = skin.promptFor(subject, null, 'sculpt', cap, 'cuteartisan');
    assert.ok(prompt.startsWith(subject + ';'));
    assert.match(prompt, /for characters only:/);
    assert.equal(prompt.indexOf('head'), prompt.indexOf('for characters only: ') + 'for characters only: '.length);
  }
});

test('Faithful subject and relief do not acquire cute character proportions', () => {
  const faithful = skin.promptFor('A realistic Australian Shepherd', null, 'sculpt', cap, 'faithfulsubject');
  assert.match(faithful, /preserve distinctive subject proportions, silhouette and features/);
  assert.doesNotMatch(faithful, /head over half|plump body|cute artisan/);
  const relief = skin.promptFor('A cherry blossom', null, 'relief', cap, 'cuteartisan');
  assert.match(relief, /shallow bas relief/);
  assert.doesNotMatch(relief, /head over half|plump body|cute artisan/);
});

test('all fifty existing style recipes still fit the Meshy request budget with physical instructions intact', () => {
  assert.equal(catalog.length, 50);
  for (const record of catalog) {
    const prompt = skin.promptFor(record.prompt, null, 'sculpt', {...cap, hMm:record.sculptHeightMm}, record.sculptStyle);
    assert.ok(prompt.length <= 800, record.title);
    assert.ok(prompt.startsWith(record.prompt + ';'), record.title);
    assert.match(prompt, /no thin or fragile parts, pedestal, keycap shell or switch socket/);
    assert.match(prompt, /sculpted geometry, not texture/);
  }
});

test('the staged long puppy request still fits with exactly two folded ears and no extra anatomy', () => {
  const recipe = require(path.join(root, 'research/artisan-dog/big-puppy-recipe.json'));
  const prompt = skin.promptFor(recipe.design.prompt, null, 'sculpt', recipe.requestedEnvelopeMm, recipe.design.sculptStyle);
  assert.ok(prompt.startsWith(recipe.design.prompt + ';'));
  assert.ok(prompt.length <= 800, 'puppy prompt is ' + prompt.length + ' characters');
  assert.match(prompt, /Exactly two folded triangular ears/);
  assert.match(prompt, /no extra ears or limbs/);
  assert.match(prompt, /broad stable underside/);
});

test('the complete suffix fits exactly at800 and rejects overflow without truncation', () => {
  const suffixLength = skin.promptFor('x', null, 'sculpt', cap, 'cuteartisan').length - 1;
  const subject = 'x'.repeat(800 - suffixLength);
  const prompt = skin.promptFor(subject, null, 'sculpt', cap, 'cuteartisan');
  assert.equal(prompt.length, 800);
  assert.ok(prompt.startsWith(subject));
  assert.ok(prompt.endsWith('no detail finer than 0.51 mm'));
  assert.throws(() => skin.promptFor(subject + 'x', null, 'sculpt', cap, 'cuteartisan'), /Shorten the art description/);
  assert.throws(() => skin.promptFor('dog', null, 'sculpt', cap, 'constructor'), /Choose Cute artisan or Faithful subject/);
});

console.log(passed + ' composition groups passed; no model generated.');
