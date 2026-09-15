/* Layout packs already posed geometry. Test coordinates, not plan estimates. */
'use strict';
const assert=require('node:assert/strict');
const K=require('../../web/parts/keycap.js'),S=require('../../web/parts/keycap-sculpt.js');
require('../../web/parts/mesh-health.js');
const P=require('../../web/parts/keycap-product.js'),SH=require('../../web/parts/keycap-share.js');
let passed=0;
function test(name,fn){fn();passed++;console.log('PASS '+name);}
function box(x0,x1,y0,y1,z0,z1){
  const c=[[x0,y0,z0],[x1,y0,z0],[x1,y1,z0],[x0,y1,z0],[x0,y0,z1],[x1,y0,z1],[x1,y1,z1],[x0,y1,z1]];
  const q=(a,b,cc,d)=>[[c[a],c[b],c[cc]],[c[a],c[cc],c[d]]];
  return new Float32Array([].concat(q(0,3,2,1),q(4,5,6,7),q(0,1,5,4),q(1,2,6,5),q(2,3,7,6),q(3,0,4,7)).flat(2));
}
function shift(p,x,y,z=0){const out=p.slice();for(let i=0;i<out.length;i+=3){out[i]+=x;out[i+1]+=y;out[i+2]+=z;}return out;}
function entry(p,name,supports=true){return {positions:p,size:{x:1,y:1,z:1},name,printPlan:{ok:true,foot:{x:1,y:1},height:1,tilt:40,supports}};}
function inBed(p){const b=S.bounds(p),u=K.usableBed();assert.ok(b.mn[0]>=-u.x/2-3e-6&&b.mx[0]<=u.x/2+3e-6,JSON.stringify(b));assert.ok(b.mn[1]>=-u.y/2-3e-6&&b.mx[1]<=u.y/2+3e-6,JSON.stringify(b));assert.ok(b.mn[2]>=-1e-5);}
function rigid(source,out,turned){
  assert.equal(source.length,out.length);
  const dx=out[0]-(turned?-source[1]:source[0]),dy=out[1]-(turned?source[0]:source[1]);
  for(let i=0;i<out.length;i+=3){
    assert.ok(Math.abs(out[i]-((turned?-source[i+1]:source[i])+dx))<8e-6);
    assert.ok(Math.abs(out[i+1]-((turned?source[i]:source[i+1])+dy))<8e-6);
    assert.equal(out[i+2],source[i+2]);
  }
}
test('an asymmetric tall tilted artisan stays inside absolute XY limits and retains its socket',()=>{
  const cap=K.build({profile:'DSA',row:'R3',sizeU:1,mx:{slotClearance:.15}});cap.dishDepth=K.PROFILES.DSA.dishDepth;
  const seated=S.seat(cap,box(-2,7,-3,6,0,30),{heightMm:30});
  const plan=S.printPose(seated,cap);assert.equal(plan.ok,true);
  const p=K.orientAsPrinted(seated.positions,cap.angle,plan.tilt,{mouthDown:plan.mouthDown});
  assert.ok(Math.abs(S.bounds(p).mid[0])>1,'fixture must reproduce a shifted tilt centre');
  const c={positions:p,size:{x:seated.footprintMm.x,y:seated.footprintMm.y,z:seated.totalHeightMm},printPlan:plan,name:'Tall artisan'};
  const before=p.slice(),laid=K.layout([c]);assert.equal(laid.ok,true);assert.equal(laid.placed.length,1);inBed(laid.positions);rigid(p,laid.positions,laid.placed[0].turned);assert.deepEqual(p,before);
  const product=P.capture({positions:laid.positions,fit:{slotMm:1.25},recipe:SH.encode({profile:'DSA',row:'R3',sizeU:1}),issues:[]});assert.equal(P.validate(product),true);
});
test('translated footprints are centred without changing scale, Z or source coordinates',()=>{
  const p=box(100,112,-205,-198,1,8),before=p.slice(),laid=K.layout([entry(p,'Translated')]);
  assert.equal(laid.ok,true);inBed(laid.positions);rigid(p,laid.positions,false);assert.deepEqual(p,before);
  const a=S.bounds(laid.positions).size,b=S.bounds(p).size;assert.ok(a.every((v,i)=>Math.abs(v-b[i])<2e-6));
});
test('actual dimensions override undersized metadata and rotate a long footprint when needed',()=>{
  const p=box(20,28,40,69,0,5),laid=K.layout([entry(p,'Turn')]);
  assert.equal(laid.ok,true);assert.equal(laid.placed[0].turned,true);assert.equal(laid.placed[0].w,29);assert.equal(laid.placed[0].d,8);inBed(laid.positions);rigid(p,laid.positions,true);
});
test('multiple translated asymmetric parts remain separated and individually inside the bed',()=>{
  const sources=[entry(box(90,102,-60,-53,0,6),'A'),entry(box(-130,-120,300,309,0,7),'B'),entry(box(25,34,42,47,0,8),'C')];
  const laid=K.layout(sources);assert.equal(laid.ok,true);assert.equal(laid.placed.length,3);let off=0;const bounds=[];
  for(const item of laid.placed){const src=sources.find(s=>s.name===item.name).positions,out=laid.positions.slice(off,off+src.length);off+=src.length;inBed(out);rigid(src,out,item.turned);bounds.push(S.bounds(out));}
  for(let i=0;i<bounds.length;i++)for(let j=i+1;j<bounds.length;j++){
    const a=bounds[i],b=bounds[j],gap=laid.gapMm-1e-5;
    assert.ok(a.mx[0]+gap<=b.mn[0]||b.mx[0]+gap<=a.mn[0]||a.mx[1]+gap<=b.mn[1]||b.mx[1]+gap<=a.mn[1]);
  }
});
test('oversized actual footprints are refused even if plan metadata claims they fit',()=>{
  const laid=K.layout([entry(box(-25,25,-20,20,0,4),'Oversized')]);assert.equal(laid.ok,false);assert.equal(laid.placed.length,0);assert.equal(laid.positions.length,0);
});
test('negative Z and overheight coordinates fail closed without normalizing away the error',()=>{
  for(const p of [box(-2,2,-2,2,-.1,3),box(-2,2,-2,2,0,53)]){
    const laid=K.layout([entry(p,'Bad height')]);assert.equal(laid.ok,false);assert.equal(laid.positions.length,0);
  }
  const lifted=box(-2,2,-2,2,50,54),flat=K.layout([entry(lifted,'Raised',false)]);assert.equal(flat.ok,true);assert.equal(flat.plateHeightMm,54);assert.equal(flat.layers,1080);rigid(lifted,flat.positions,false);
});
test('invalid numbers and incomplete triangle soups never produce packed coordinates',()=>{
  const nan=box(-2,2,-2,2,0,3);nan[4]=NaN;
  for(const p of [nan,new Float32Array(8),new Float32Array(0)]){const laid=K.layout([entry(p,'Invalid')]);assert.equal(laid.ok,false);assert.equal(laid.positions.length,0);}
});
console.log(passed+' exact print-coordinate layout checks passed');
