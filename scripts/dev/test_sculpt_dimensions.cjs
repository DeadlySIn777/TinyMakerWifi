/* Exact emitted dimensions after landing floating artwork. No printer/network. */
'use strict';
const assert = require('node:assert/strict');
const K = require('../../web/parts/keycap.js');
const S = require('../../web/parts/keycap-sculpt.js');
function box(x0,x1,y0,y1,z0,z1) {
  const v=[[x0,y0,z0],[x1,y0,z0],[x1,y1,z0],[x0,y1,z0],[x0,y0,z1],[x1,y0,z1],[x1,y1,z1],[x0,y1,z1]];
  return new Float32Array([[0,2,1],[0,3,2],[4,5,6],[4,6,7],[0,1,5],[0,5,4],[3,7,6],[3,6,2],[0,4,7],[0,7,3],[1,2,6],[1,6,5]].flatMap(t=>t.flatMap(i=>v[i])));
}
function join(a,b) { const p=new Float32Array(a.length+b.length); p.set(a);p.set(b,a.length);return p; }
function measured(p) {
  const limits=[[Infinity,-Infinity],[Infinity,-Infinity],[Infinity,-Infinity]];
  for(let i=0;i<p.length;i++) {const axis=limits[i%3]; axis[0]=Math.min(axis[0],p[i]); axis[1]=Math.max(axis[1],p[i]);}
  return limits.map(([low,high])=>Math.round((high-low)*100)/100);
}
let count=0;
function test(name,fn) {fn();count++;console.log('PASS '+name);}
const artwork=join(box(-5,5,-5,5,0,2),box(-2,2,-2,2,5,8));
for(const [profile,row] of [['DSA','R3'],['SA','R4'],['CHERRY','R4'],['OEM','R4']]) {
  test(profile+' landed sculpture dimensions come from the emitted triangles',()=>{
    const cap=K.build({profile,row,sizeU:1,topGrid:31});
    const source=artwork.slice(),capSource=cap.positions.slice();
    const seated=S.seat(cap,artwork,{heightMm:15}),before=seated.positions.slice();
    const landed=S.reseat(seated),size=measured(landed.positions);
    assert.ok(landed.moved.length>0,'fixture must really exercise floating-piece landing');
    assert.equal(landed.totalHeightMm,size[2]);
    assert.equal(landed.footprintMm.x,size[0]);assert.equal(landed.footprintMm.y,size[1]);
    assert.deepEqual(landed.positions.slice(0,capSource.length),capSource,'every socket coordinate remains exact');
    assert.deepEqual(seated.positions,before,'landing does not mutate its caller');assert.deepEqual(artwork,source);
    if(profile==='SA') {
      assert.equal(landed.totalHeightMm,20.34,'regression: old summary falsely reported 19.36 mm');
      assert.equal(landed.stillFloating,0);
      const checked=S.check(landed,{bed:{x:40.8,y:30.6,zSupported:20}});
      assert.equal(checked.ok,false);assert.ok(checked.issues.some(x=>x.includes('stands 20.3')));
    }
  });
}
test('no-op landing does not change angled-row height or socket',()=>{
  const cap=K.build({profile:'SA',row:'R4',sizeU:1,topGrid:31});
  const seated=S.seat(cap,box(-4,4,-4,4,0,8),{heightMm:12}),landed=S.reseat(seated);
  assert.equal(landed.moved.length,0);assert.deepEqual(landed.positions,seated.positions);
  assert.equal(landed.totalHeightMm,seated.totalHeightMm);
});
for(const [axis,sign] of [['x',1],['x',-1],['y',1],['y',-1]]) {
  test(axis+' offset '+sign+' cannot pass neighbor clearance on width alone',()=>{
    const cap=K.build({profile:'DSA',row:'R3',sizeU:1,topGrid:31});
    const seated=S.seat(cap,box(-8,8,-8,8,0,10),{heightMm:15,[axis]:sign*0.6});
    const size=measured(seated.positions),checked=S.check(seated);
    assert.equal(seated.footprintMm.x,size[0]);assert.equal(seated.footprintMm.y,size[1]);
    assert.ok(Math.max(size[0],size[1])<19.05,'total width still fits, but its position is wrong');
    assert.equal(checked.anchorage.floating.length,0,'it is attached, so rejection tests actual clearance');
    assert.equal(checked.ok,false);assert.ok(checked.issues.some(x=>x.includes('offset beyond')));
  });
}
test('centered fitted artwork is accepted with its exact cap and socket',()=>{
  const cap=K.build({profile:'DSA',row:'R3',sizeU:1,topGrid:31});
  const seated=S.seat(cap,box(-8,8,-8,8,0,10),{heightMm:15});
  assert.equal(S.check(seated).ok,true);
  assert.deepEqual(seated.positions.slice(0,cap.positions.length),cap.positions);
});
console.log(count+' emitted-dimension/clearance groups passed');
