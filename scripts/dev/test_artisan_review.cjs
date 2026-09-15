/* The review component sends bounded user choices, never model edits or jobs. */
'use strict';
const assert=require('node:assert/strict');
const review=require('../../web/parts/artisan-review.js');
const selected=['compact-character','too-small','compact-character','not-a-rule',null,'extra-parts'];
assert.deepEqual(review.request(selected,'  Round cheeks, one pair of ears.  ','back'),{
 corrections:['compact-character','too-small','extra-parts'],feedback:'Round cheeks, one pair of ears.',view:'back'});
assert.equal(selected.length,6,'normalization must not mutate the caller selection');
assert.deepEqual(review.request({},null,'invalid'),{corrections:[],feedback:'',view:'perspective'});
assert.equal(review.request([], 'x'.repeat(300),'front').feedback.length,180);
assert.equal(review.corrections.length,6);assert.equal(new Set(review.corrections.map(x=>x.id)).size,6);
assert.equal(review.open({renderPreview(){throw new Error('no document');}}),false);
console.log('Artisan review: 6 normalization and non-browser guard checks passed.');
