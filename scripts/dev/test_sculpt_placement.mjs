// Artwork-only placement on real keycaps; no browser, printer or network.
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
const K=require('../../web/parts/keycap.js'),SC=require('../../web/parts/keycap-sculpt.js');
const SH=require('../../web/parts/keycap-share.js');
function box(x,y,z){const p=[[-x/2,-y/2,0],[x/2,-y/2,0],[x/2,y/2,0],[-x/2,y/2,0],[-x/2,-y/2,z],[x/2,-y/2,z],[x/2,y/2,z],[-x/2,y/2,z]];
 return new Float32Array([[0,2,1],[0,3,2],[4,5,6],[4,6,7],[0,1,5],[0,5,4],[3,7,6],[3,6,2],[0,4,7],[0,7,3],[1,2,6],[1,6,5]].flatMap(t=>t.flatMap(i=>p[i])));}
function bounds(p){const lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];for(let i=0;i<p.length;i+=3)for(let k=0;k<3;k++){lo[k]=Math.min(lo[k],p[i+k]);hi[k]=Math.max(hi[k],p[i+k]);}return{lo,hi,size:lo.map((n,k)=>hi[k]-n)};}
function cap(sizeU=1,profile='DSA',row='R3'){const c=K.build({profile,row,sizeU,topGrid:21});c.dishDepth=K.PROFILES[profile].dishDepth;return c;}
const art=box(16,6,10),c=cap(),near=(a,b)=>assert.ok(Math.abs(a-b)<1e-5,`${a} != ${b}`);
let passed=0;function test(n,fn){fn();passed++;console.log('PASS '+n);}
test('omitted settings and explicit defaults are byte-identical, including the original source mesh',()=>{
 const raw=Array.from(art),before=Array.from(c.positions);
 const a=SC.seat(c,art,{heightMm:10}),b=SC.seat(c,art,{heightMm:10,rotationDeg:0,scalePercent:100});
 assert.deepEqual(a.positions,b.positions);assert.deepEqual(Array.from(art),raw);assert.deepEqual(Array.from(c.positions),before);
 assert.equal(b.rotationDeg,0);assert.equal(b.scalePercent,100);
});
test('quarter-turn yaw swaps unequal axes and rotates actual vertices before centering',()=>{
 const a=SC.seat(c,art,{heightMm:10,rotationDeg:90}),p=a.positions.slice(c.positions.length),b=bounds(p);
 near(b.size[0],6);near(b.size[1],16);near(p[0],3);near(p[1],-8);
 near(b.lo[0]+b.hi[0],0);near(b.lo[1]+b.hi[1],0);
 const other=SC.seat(c,art,{heightMm:10,rotationDeg:270}).positions.slice(c.positions.length);
 near(other[0],-3);near(other[1],8);
});
test('rotation is fitted against the newly rotated depth, including a wide modifier key',()=>{
 const wide=cap(2.25),a=SC.seat(wide,art,{heightMm:20,rotationDeg:0}),b=SC.seat(wide,art,{heightMm:20,rotationDeg:90});
 assert.ok(a.sculptMm.x>25);assert.ok(b.sculptMm.y<=18.65);assert.ok(b.sculptMm.z<20);
 assert.ok(b.scale<a.scale,'a wide model rotated depthwise must be refitted, not merely turned after fitting');
});
test('50 percent uniformly shrinks the fitted artwork and preserves the seating plane',()=>{
 const a=SC.seat(c,art,{heightMm:10}),b=SC.seat(c,art,{heightMm:10,scalePercent:50});
 const ab=bounds(a.positions.slice(c.positions.length)),bb=bounds(b.positions.slice(c.positions.length));
 for(let k=0;k<3;k++)near(bb.size[k],ab.size[k]/2);
 near(bb.hi[2],ab.hi[2]);near(bb.lo[0]+bb.hi[0],0);near(bb.lo[1]+bb.hi[1],0);
 assert.ok(bb.size[2]<=10);assert.equal(b.seatDepth,a.seatDepth);
});
test('all offered placements preserve every cap and socket coordinate',()=>{
 for(const rotationDeg of [0,90,180,270])for(const scalePercent of [50,73,100]){
  const s=SC.seat(c,art,{heightMm:10,rotationDeg,scalePercent});
  assert.deepEqual(s.positions.slice(0,c.positions.length),c.positions);
  assert.ok(s.sculptMm.x<=18.65&&s.sculptMm.y<=18.65&&s.sculptMm.z<=10);
  assert.equal(s.capTriangles,c.triangles);assert.equal(c.slotWidth,1.23);
 }
});
test('360 normalizes to zero and arbitrary in-range angles stay fitted',()=>{
 const a=SC.seat(c,art,{heightMm:10,rotationDeg:0}),b=SC.seat(c,art,{heightMm:10,rotationDeg:360});
 assert.equal(b.rotationDeg,0);assert.deepEqual(a.positions,b.positions);
 const d=SC.seat(c,art,{heightMm:10,rotationDeg:37.5,scalePercent:80});
 assert.ok(d.sculptMm.x<=18.65&&d.sculptMm.y<=18.65);assert.equal(d.rotationDeg,37.5);
});
test('non-finite, text and out-of-range placement settings are rejected',()=>{
 for(const rotationDeg of [-1,361,NaN,Infinity,-Infinity,'90',true])assert.throws(()=>SC.seat(c,art,{rotationDeg}),/rotation/);
 for(const scalePercent of [0,49.9,100.1,NaN,Infinity,'75',false])assert.throws(()=>SC.seat(c,art,{scalePercent}),/size/);
});
test('share code preserves placement without encoding stem preferences or mutating the caller',()=>{
 const design={profile:'DSA',row:'R3',sizeU:1,prompt:'small owl',sculptRotationDeg:270,sculptScalePercent:75,slotClearance:.10};
 const before=JSON.stringify(design),decoded=SH.decode(SH.encode(design));
 assert.equal(decoded.sculptRotationDeg,270);assert.equal(decoded.sculptScalePercent,75);assert.equal(decoded.slotClearance,undefined);
 assert.equal(JSON.stringify(design),before);assert.equal(SH.isReproducible(decoded),false);
 const canonical=SH.decode(SH.encode({...design,sculptRotationDeg:360}));assert.equal(canonical.sculptRotationDeg,0);
 const manual='TMK1-'+Buffer.from(JSON.stringify({p:'DSA',sr:360,sp:100})).toString('base64url');assert.equal(SH.decode(manual).sculptRotationDeg,0);
 const old=SH.decode(SH.encode({profile:'XDA'}));assert.equal(old.sculptRotationDeg,undefined);assert.equal(old.sculptScalePercent,undefined);
});
test('bad shared placement fails validation at encode and decode',()=>{
 for(const [long,short,values] of [['sculptRotationDeg','sr',[-1,361,'90',true]],['sculptScalePercent','sp',[49,101,'75',false]]]){
  for(const value of values){assert.throws(()=>SH.encode({profile:'DSA',[long]:value}));
   const code='TMK1-'+Buffer.from(JSON.stringify({p:'DSA',[short]:value})).toString('base64url');assert.throws(()=>SH.decode(code));}
 }
 for(const value of [NaN,Infinity]){
  assert.throws(()=>SH.encode({profile:'DSA',sculptRotationDeg:value}));
  assert.throws(()=>SH.encode({profile:'DSA',sculptScalePercent:value}));
 }
});
console.log(`\n${passed} sculpture placement groups passed.`);
