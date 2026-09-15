/* Finished-product integration: execute the real UI save/build/export paths with
 * production geometry, share codes, health checks and snapshot/STL helper.
 * Only browser rendering, storage I/O and download delivery are substituted.
 * No Meshy request, printer API, motion or print job is available to this test.
 */
'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const base=path.resolve(__dirname,'../..'),parts=path.join(base,'web/parts');
const src=fs.readFileSync(path.join(parts,'keycap-ui.js'),'utf8');
const K=require(path.join(parts,'keycap.js'));
const H=require(path.join(parts,'mesh-health.js')).meshHealth;
const SC=require(path.join(parts,'keycap-sculpt.js'));
const SH=require(path.join(parts,'keycap-share.js'));
const P=require(path.join(parts,'keycap-product.js'));
function region(start,end){const a=src.indexOf(start),b=src.indexOf(end,a);assert.ok(a>=0&&b>a,'source region: '+start);return src.slice(a,b);}
function box(x0,x1,y0,y1,z0,z1){
 const v=[[x0,y0,z0],[x1,y0,z0],[x1,y1,z0],[x0,y1,z0],[x0,y0,z1],[x1,y0,z1],[x1,y1,z1],[x0,y1,z1]];
 const q=(a,b,c,d)=>[v[a],v[b],v[c],v[a],v[c],v[d]].flat();
 return new Float32Array([q(0,3,2,1),q(4,5,6,7),q(0,1,5,4),q(1,2,6,5),q(2,3,7,6),q(3,0,4,7)].flat());
}
const attached=()=>box(-5,5,-3,3,0,10);
const floating=()=>new Float32Array([
 ...box(-9,9,-9,9,0,2),...box(4,8,-8,8,1.9,40),...box(-8,-6,-8,-6,10,12)
]);
const values=p=>Array.from(p);
const sameMesh=(a,b,message)=>assert.deepEqual(values(a),values(b),message);
const flush=()=>new Promise(setImmediate);
function fixture(){
 const nodes=new Map(),messages=[],records=[],storage=new Map(),downloads=[],io=[];
 const node=id=>{
  if(!nodes.has(id))nodes.set(id,{value:'',textContent:'',width:0,disabled:false,hidden:false,events:{},
   setAttribute(){},addEventListener(name,fn){this.events[name]=fn;}});
  return nodes.get(id);
 };
 const forbidden=name=>(...args)=>{io.push({name,args});throw Error('Unexpected external action: '+name);};
 const ctx={K,Math,Number,Promise,WeakMap,Float32Array,console,Blob,structuredClone,
  built:null,pending:0,clearTimeout(){},setTimeout(){return 0;},
  st:{key:'Esc',profile:'DSA',row:'R3',sizeU:1,depth:.55,raised:false,art:'gen',digit:'',icon:null,
   legendOn:false,sculptHeightMm:13,meshyPolycount:100000,sculptStyle:'cuteartisan',
   sculptRotationDeg:0,sculptScalePercent:100,sculpt:null,libId:null,plate:[],name:'Attached artwork',skinFrom:'A stout original creature'},
  $:node,localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},
  document:{activeElement:null,querySelector:()=>null},
  say:(...message)=>{messages.push(message);node(message[0]).textContent=message[1]||'';},
  drawShelf(){},syncClear(){},drawHero(){},drawTop(){},drawSide(){},dims(){},legendWarn(){},report(){},
  paintArt(){},paintLegendRow(){},drawProfiles(){},drawRows(){},drawIcons(){},caliper(){},setFinish(){},
  setArt:art=>{ctx.st.art=art;},dropSculpt:()=>{ctx.st.sculpt=null;ctx.st.libId=null;},
  save:(blob,name)=>downloads.push({blob,name}),fetch:forbidden('fetch'),
  window:{keycap:K,keycapSculpt:SC,keycapShare:SH,keycapProduct:P,meshHealth:H,
   meshy:{generate:forbidden('Meshy generation')},fetch:forbidden('window.fetch'),
   print:forbidden('print'),startPrint:forbidden('startPrint'),move:forbidden('move'),
   keycapLibrary:{
    async save(record){const rec=structuredClone({...record,id:'product-'+(records.length+1),triangles:record.positions.length/9});records.push(rec);return structuredClone(rec);},
    async get(id){return structuredClone(records.find(r=>r.id===id));}
   }}
 };
 vm.createContext(ctx);
 vm.runInContext([
  region('  // ---- sculpture settings','  // ---- step 1:'),
  region('  var SESSION =','  // ---- the shelf'),
  region('  function capFacts()','  function drawShelf()'),
  region('  function capSpec()','  /* A generation'),
  region('  function useSaved(id)','  function openModelFile(file)'),
  region('  function legendOn()','  /* WHY THIS IS DEBOUNCED'),
  region('  function capFor(mode, rel)','  /* The hero:'),
  region('  function designOf() {','  // ---- share, and open'),
  region("  $('kcProductName')&&",'  window.keycapRefresh =')
 ].join('\n'),ctx);
 // Debouncing and paint calls are UI concerns; refreshNow itself is real.
 ctx.refresh=()=>ctx.refreshNow();
 return {ctx,node,messages,records,storage,downloads,io,
  click:async id=>{const n=node(id);assert.equal(typeof n.events.click,'function',id+' binding');n.events.click.call(n);await flush();},
  run:s=>vm.runInContext(s,ctx)};
}
let passed=0;
async function test(name,fn){await fn();passed++;console.log('PASS '+name);}
(async()=>{
 await test('save keeps raw artwork and exact checked assembled print coordinates, recipe and fit',async()=>{
  const f=fixture(),raw=attached();f.ctx.st.sculpt=raw;
  const expected=f.ctx.checkedLayout([f.ctx.printEntry()]);
  assert.equal(expected.placed.length,1);assert.equal(expected.leftOver,0);
  const rec=await f.ctx.keepCurrent('A stout original creature');
  assert.ok(rec&&rec.id);assert.equal(f.records.length,1);assert.equal(rec.kind,'sculpt');
  sameMesh(rec.positions,raw);assert.notEqual(rec.positions,raw);
  const p=rec.product;assert.equal(p.state,'ready');assert.equal(P.validate(p),true);
  sameMesh(p.positions,expected.positions,'snapshot is the actual checked print mesh, not preview/raw art');
  assert.ok(p.positions.length>raw.length);assert.equal(p.fit.slotMm,1.23);
  assert.equal(p.recipe,rec.design);assert.equal(rec.prompt,'A stout original creature');
  const d=SH.decode(rec.design);assert.equal(d.key,'Esc');assert.equal(d.sculptHeightMm,13);
  assert.equal(d.legendOn,false);assert.equal(d.mx,undefined);assert.equal(d.slotClearance,undefined);
  assert.equal(f.node('kcDownloadProduct').disabled,false);assert.equal(f.node('kcSaveProduct').disabled,true);
  assert.match(f.node('kcProductStatus').textContent,/Ready to slice.*1\.23/);
  assert.deepEqual(f.io,[]);
 });
 await test('download contains every assembled float32 triangle, including socket, and sends no print',async()=>{
  const f=fixture();f.ctx.st.sculpt=attached();const rec=await f.ctx.keepCurrent('art');
  await f.click('kcDownloadProduct');assert.equal(f.downloads.length,1);
  const out=f.downloads[0];assert.match(out.name,/\.stl$/);const buf=await out.blob.arrayBuffer(),dv=new DataView(buf);
  assert.equal(dv.getUint32(80,true),rec.product.triangles);assert.equal(buf.byteLength,84+50*rec.product.triangles);
  for(let t=0;t<rec.product.triangles;t++)for(let a=0;a<9;a++)
   assert.equal(dv.getFloat32(84+t*50+12+a*4,true),rec.product.positions[t*9+a],'STL triangle '+t+' vertex component '+a);
  assert.deepEqual(f.io,[]);
 });
 await test('unchanged repeated saves share one pending promise and one Library record',async()=>{
  const f=fixture();f.ctx.st.sculpt=attached();const a=f.ctx.keepCurrent('art'),b=f.ctx.keepCurrent('art');
  assert.equal(a,b);await a;await f.ctx.keepCurrent('art');f.ctx.refreshNow();await f.ctx.keepCurrent('art');
  assert.equal(f.records.length,1);assert.deepEqual(f.io,[]);
 });
 await test('changing socket fit invalidates old download and saves newly assembled geometry',async()=>{
  const f=fixture();f.ctx.st.sculpt=attached();const first=await f.ctx.keepCurrent('art');
  assert.equal(f.ctx.applyStemFit(.10,'Fit check.'),true);f.ctx.paintProductState();
  assert.equal(f.node('kcDownloadProduct').disabled,true);assert.equal(f.node('kcSaveProduct').disabled,false);
  await f.click('kcDownloadProduct');assert.equal(f.downloads.length,0);assert.match(f.node('kcProductStatus').textContent,/Save the current product/);
  const second=await f.ctx.keepCurrent('art');assert.equal(f.records.length,2);assert.equal(second.product.fit.slotMm,1.25);
  assert.equal(first.design,second.design,'personal fit does not leak into a share recipe');
  assert.notDeepEqual(values(first.product.positions),values(second.product.positions));
  sameMesh(second.product.positions,f.ctx.checkedLayout([f.ctx.printEntry()]).positions);
  sameMesh(first.positions,second.positions,'adjusting a socket never rewrites raw art');
  assert.equal(first.product.fit.slotMm,1.23);assert.deepEqual(f.io,[]);
 });
 await test('artwork turn and size create a new restorable snapshot instead of stale source-identity dedup',async()=>{
  const f=fixture();f.ctx.st.sculpt=attached();const first=await f.ctx.keepCurrent('art');
  Object.assign(f.ctx.st,{sculptRotationDeg:90,sculptScalePercent:75});f.ctx.refreshNow();
  assert.equal(f.node('kcDownloadProduct').disabled,true);
  const second=await f.ctx.keepCurrent('art'),d=SH.decode(second.design);
  assert.equal(f.records.length,2);assert.equal(d.sculptRotationDeg,90);assert.equal(d.sculptScalePercent,75);
  assert.notEqual(first.design,second.design);assert.equal(second.product.state,'ready');
  sameMesh(second.positions,first.positions);assert.notDeepEqual(values(first.product.positions),values(second.product.positions));
  sameMesh(second.product.positions,f.ctx.checkedLayout([f.ctx.printEntry()]).positions);
  await f.ctx.keepCurrent('art');assert.equal(f.records.length,2);assert.deepEqual(f.io,[]);
 });
 await test('unrepairable floating artwork is retained as needs-attention and cannot yield a product STL',async()=>{
  const f=fixture(),raw=floating();f.ctx.st.sculpt=raw;f.ctx.st.sculptHeightMm=30;
  const assembled=f.ctx.capFor('print',f.ctx.relief());
  assert.equal(assembled.sculptCheck.ok,false,'fixture must fail real sculpture checking');
  assert.match(assembled.sculptCheck.issues.join(' '),/floating/);
  const rec=await f.ctx.keepCurrent('Floating bolt');assert.ok(rec&&rec.id);sameMesh(rec.positions,raw);
  assert.equal(rec.product.state,'needs-attention');assert.equal(rec.product.positions,null);assert.equal(rec.product.triangles,0);
  assert.ok(rec.product.issues.length);assert.equal(P.validate(rec.product),true);
  assert.throws(()=>P.toSTL(rec.product),/needs attention/);assert.equal(f.node('kcDownloadProduct').disabled,true);
  await f.click('kcDownloadProduct');assert.equal(f.downloads.length,0);
  assert.match(f.node('kcProductStatus').textContent,/needs attention/);assert.deepEqual(f.io,[]);
 });
 await test('quota failure preserves current raw sculpt, reports unsaved, and allows a successful retry',async()=>{
  const f=fixture(),raw=attached(),save=f.ctx.window.keycapLibrary.save;f.ctx.st.sculpt=raw;
  f.ctx.window.keycapLibrary.save=async()=>{throw Error('Quota exceeded');};
  assert.equal(await f.ctx.keepCurrent('art'),null);assert.equal(f.ctx.st.sculpt,raw);sameMesh(raw,attached());
  assert.equal(f.ctx.st.libId,null);assert.equal(f.records.length,0);assert.equal(f.node('kcDownloadProduct').disabled,true);
  assert.match(f.node('kcGenNote').textContent,/NOT saved.*Quota exceeded.*Export/);
  f.ctx.window.keycapLibrary.save=save;const rec=await f.ctx.keepCurrent('art');assert.ok(rec.id);
  assert.equal(rec.product.state,'ready');assert.equal(f.records.length,1);assert.deepEqual(f.io,[]);
 });
 await test('saved raw and assembled coordinates stay immutable across source mutation and later edits',async()=>{
  const f=fixture(),raw=attached();f.ctx.st.sculpt=raw;const rec=await f.ctx.keepCurrent('art');
  const savedRaw=values(rec.positions),savedProduct=values(rec.product.positions);
  raw[0]=123;f.ctx.st.sculpt=attached();f.ctx.st.sculptScalePercent=70;
  assert.deepEqual(values(rec.positions),savedRaw);assert.deepEqual(values(rec.product.positions),savedProduct);
  assert.deepEqual(values(f.records[0].positions),savedRaw);assert.equal(P.validate(rec.product),true);assert.deepEqual(f.io,[]);
 });
 await test('reopening saved product restores artwork and placement while keeping this browser fit preference',async()=>{
  const f=fixture();f.ctx.st.sculpt=attached();f.ctx.st.sculptRotationDeg=90;f.ctx.st.sculptScalePercent=75;
  const rec=await f.ctx.keepCurrent('A stout original creature');
  f.ctx.applyStemFit(.10,'Another fit.');Object.assign(f.ctx.st,{sculptRotationDeg:0,sculptScalePercent:100});
  assert.equal(await f.ctx.useSaved(rec.id),true);
  sameMesh(f.ctx.st.sculpt,rec.positions);assert.notEqual(f.ctx.st.sculpt,rec.positions);
  assert.equal(f.ctx.st.sculptRotationDeg,90);assert.equal(f.ctx.st.sculptScalePercent,75);
  assert.equal(f.run('stemFitClearance'),.10);assert.equal(f.records.length,1);
  assert.equal(f.node('kcDownloadProduct').disabled,true,'saved 1.23 mm product is stale for current 1.25 mm fit');
  const updated=await f.ctx.keepCurrent('A stout original creature');assert.equal(updated.product.fit.slotMm,1.25);
  assert.equal(updated.product.state,'ready');assert.equal(f.records.length,2);assert.deepEqual(f.io,[]);
 });
 console.log('\n'+passed+' finished-product workflow groups passed (no generation, print, network or motion).');
})().catch(e=>{console.error(e);process.exitCode=1;});
