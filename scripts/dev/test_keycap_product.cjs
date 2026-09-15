'use strict';
const assert=require('node:assert/strict'),path=require('node:path');
const root=path.resolve(__dirname,'../..');
const K=require(path.join(root,'web/parts/keycap.js'));
const S=require(path.join(root,'web/parts/keycap-sculpt.js'));
const H=require(path.join(root,'web/parts/mesh-health.js'));
const SH=require(path.join(root,'web/parts/keycap-share.js'));
const P=require(path.join(root,'web/parts/keycap-product.js'));
function cube(lo,hi){
  const v=[[lo[0],lo[1],lo[2]],[hi[0],lo[1],lo[2]],[hi[0],hi[1],lo[2]],[lo[0],hi[1],lo[2]],
    [lo[0],lo[1],hi[2]],[hi[0],lo[1],hi[2]],[hi[0],hi[1],hi[2]],[lo[0],hi[1],hi[2]]];
  return new Float32Array([[0,2,1],[0,3,2],[4,5,6],[4,6,7],[0,1,5],[0,5,4],[3,7,6],[3,6,2],[0,4,7],[0,7,3],[1,2,6],[1,6,5]].flatMap(t=>t.flatMap(i=>v[i])));
}
const recipe=SH.encode({profile:'DSA',row:'R3',sizeU:1,name:'Saved sculpt',sculptHeightMm:13,meshyPolycount:100000,sculptStyle:'cuteartisan',legendOn:false});
const base={recipe,fit:{slotMm:1.25},issues:[],checkedAt:1000};
const capture=positions=>P.capture({...base,positions});
const copy=product=>structuredClone(product);
let count=0;async function test(name,fn){await fn();count++;console.log('PASS '+name);}
(async()=>{
  await test('snapshot owns exact float32 mesh, fit and measurements rather than caller arrays',()=>{
    const positions=cube([-2,-3,0],[2,3,4]),input={...base,positions,fit:{slotMm:1.25},issues:[]};
    const p=P.capture(input);assert.equal(p.state,'ready');assert.deepEqual(p.sizeMm,[4,6,4]);assert.equal(p.triangles,12);
    assert.notEqual(p.positions,positions);positions[0]=999;input.fit.slotMm=1.35;input.issues.push('Later issue');
    assert.equal(p.positions[0],-2);assert.equal(p.fit.slotMm,1.25);assert.deepEqual(p.issues,[]);assert.equal(P.validate(p),true);
  });
  await test('IndexedDB-style structured clone preserves type and signature; STL round trips exact coordinates',async()=>{
    const p=copy(capture(cube([-2,-3,0],[2,3,4])));assert.ok(p.positions instanceof Float32Array);assert.equal(P.validate(p),true);
    const blob=P.toSTL(p),view=new DataView(await blob.arrayBuffer());assert.equal(blob.type,'model/stl');assert.equal(blob.size,84+12*50);assert.equal(view.getUint32(80,true),12);
    for(let t=0;t<p.triangles;t++)for(let k=0;k<9;k++)assert.equal(view.getFloat32(84+t*50+12+k*4,true),p.positions[t*9+k]);
  });
  await test('changed mesh, recipe, fit, measurements, timestamp or state cannot inherit the old validation',()=>{
    const original=capture(cube([-2,-3,0],[2,3,4]));
    const changes=[p=>p.positions[0]+=.1,p=>p.recipe=SH.encode({profile:'XDA'}),p=>p.fit.slotMm=1.3,
      p=>p.sizeMm[0]+=1,p=>p.triangles++,p=>p.checkedAt++,p=>p.state='needs-attention',p=>p.issues.push('unresolved')];
    for(const change of changes){const p=copy(original);change(p);assert.throws(()=>P.toSTL(p),/Saved keycap:/);}
  });
  await test('blocked snapshots have no downloadable geometry and retain plain-text issues',()=>{
    const p=P.capture({...base,positions:null,issues:['Attachment needs attention.']});assert.equal(p.state,'needs-attention');assert.equal(p.positions,null);assert.equal(p.triangles,0);assert.deepEqual(p.sizeMm,[0,0,0]);assert.equal(P.validate(p),true);
    assert.throws(()=>P.toSTL(p),/needs attention/);assert.equal(P.capture({...base,positions:null}).state,'needs-attention');
    assert.throws(()=>P.capture({...base,positions:cube([-1,-1,0],[1,1,2]),issues:['Blocked']}),/blocked snapshots/);
  });
  await test('invalid fits, recipes, timestamps and malformed or oversized coordinate data are refused',()=>{
    const mesh=cube([-1,-1,0],[1,1,2]);
    for(const slotMm of [1.14,1.46,NaN,Infinity,'1.25'])assert.throws(()=>P.capture({...base,positions:mesh,fit:{slotMm}}),/socket width/);
    for(const value of ['',null,'plain text','TMK1-'+ 'a'.repeat(4096)])assert.throws(()=>P.capture({...base,positions:mesh,recipe:value}),/recipe/);
    for(const value of [-1,NaN,1.5])assert.throws(()=>P.capture({...base,positions:mesh,checkedAt:value}),/timestamp/);
    for(const value of [[],[1,2,3],{0:1,length:9},new Float32Array(300001*9)])assert.throws(()=>capture(value),/coordinates|triangles/);
    const nonfinite=mesh.slice();nonfinite[0]=NaN;assert.throws(()=>capture(nonfinite),/invalid coordinates/);
    const overflow=Array.from(mesh);overflow[0]=1e100;assert.throws(()=>capture(overflow),/invalid coordinates/);
  });
  await test('current physical bounds check exact position, bed reserve, ground and conservative support height',()=>{
    for(const mesh of [cube([-20,-1,0],[-18,1,2]),cube([-1,-14,0],[1,-12,2]),cube([-1,-1,-1],[1,1,1]),cube([-1,-1,0],[1,1,53])])assert.throws(()=>capture(mesh),/print volume/);
    const p=capture(cube([-2,-3,0],[2,3,4]));
    global.keycap={...K,usableBed:()=>({x:3,y:3})};try{assert.throws(()=>P.toSTL(p),/print volume/);}finally{global.keycap=K;}
    global.keycap=null;try{assert.throws(()=>P.toSTL(p),/limits are unavailable/);}finally{global.keycap=K;}
  });
  await test('STL rechecks production mesh health and fails closed on reversed neighboring faces',()=>{
    const broken=cube([-1,-1,0],[1,1,2]);for(let a=0;a<3;a++){const v=broken[a+3];broken[a+3]=broken[a+6];broken[a+6]=v;}
    assert.equal(H.meshHealth(broken).severity,'bad');assert.throws(()=>P.toSTL(capture(broken)),/inside-out/);
    const degenerate=new Float32Array([0,0,0,1,1,1,2,2,2]);assert.throws(()=>capture(degenerate),/usable triangle area/);
  });
  await test('metadata strips coordinates, owns copied arrays and does not mutate the product',()=>{
    const p=capture(cube([-2,-3,0],[2,3,4])),m=P.metadata(p);assert.equal('positions' in m,false);
    m.sizeMm[0]=999;m.fit.slotMm=1.4;m.issues.push('changed list');assert.deepEqual(p.sizeMm,[4,6,4]);assert.equal(p.fit.slotMm,1.25);assert.deepEqual(p.issues,[]);
    assert.throws(()=>P.toSTL(P.metadata(p)),/Float32Array/);
  });
  await test('real assembled cap and sculpt survive checked production pose/layout and exact STL export',async()=>{
    const cap=K.build({profile:'DSA',row:'R3',sizeU:1,mx:{slotClearance:.10},topGrid:K.gridForFace(12.7)});
    assert.equal(K.validate(cap.positions,{sizeU:1,mx:{slotClearance:.10}}).ok,true);
    cap.dishDepth=K.PROFILES.DSA.dishDepth;cap.sizeU=1;
    const seated=S.seat(cap,cube([-2,-2,0],[2,2,6]),{heightMm:13});assert.equal(S.check(seated).ok,true);
    const plan=S.printPose(seated,cap);assert.notEqual(plan.ok,false);
    const posed=K.orientAsPrinted(seated.positions,cap.angle,plan.tilt||0,{mouthDown:!!plan.mouthDown});
    const entry={positions:posed,size:{x:seated.footprintMm.x,y:seated.footprintMm.y,z:seated.totalHeightMm},name:'test-art',printPlan:plan};
    const layout=K.layout([entry]);assert.equal(layout.leftOver,0);assert.ok(layout.positions.length);
    const product=capture(layout.positions);assert.equal(P.validate(product),true);assert.equal(product.fit.slotMm,1.25);assert.equal(product.recipe,recipe);
    const blob=P.toSTL(copy(product));assert.equal(blob.size,84+product.triangles*50);
  });
  console.log('\n'+count+' saved-product groups passed. No network, printer operations or physical-print claims.');
})().catch(e=>{console.error(e);process.exitCode=1;});
