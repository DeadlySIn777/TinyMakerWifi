// Actual generation/import/save/restore handlers; no API, browser or printer.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const base=path.resolve(__dirname,'../..'),src=fs.readFileSync(path.join(base,'web/parts/keycap-ui.js'),'utf8');
const K=require(path.join(base,'web/parts/keycap.js')),SH=require(path.join(base,'web/parts/keycap-share.js'));
function region(a,b){const i=src.indexOf(a),j=src.indexOf(b,i);assert.ok(i>=0&&j>i,a);return src.slice(i,j);}
const mesh=()=>new Float32Array([0,0,0,1,0,0,0,1,1]);
const flush=()=>new Promise(setImmediate);
function fixture(){
 const nodes=new Map(),messages=[],notices=[],records=[],storage=new Map(),timers=[];let seq=0;
 const node=id=>{if(!nodes.has(id))nodes.set(id,{value:'',textContent:'',disabled:false,width:0,events:{},setAttribute(){},addEventListener(k,fn){this.events[k]=fn;}});return nodes.get(id);};
 const ctx={K,Math,Number,Promise,WeakMap,Float32Array,console,built:null,pending:0,clearTimeout(){},
  st:{key:'Esc',profile:'DSA',row:'R3',sizeU:1,depth:.55,raised:false,art:'gen',digit:'',legendOn:false,
    sculptHeightMm:19,meshyPolycount:100000,sculptStyle:'cuteartisan',sculpt:null,libId:null,plate:[],name:'Creeper Escape'},
  $:node,localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},
  document:{querySelector:()=>null},say:(...m)=>messages.push(m),setTimeout:(fn,ms)=>{timers.push({fn,ms});return timers.length;},
  refresh:()=>{},refreshNow:()=>{ctx.built=null;},drawShelf:()=>{},paintArt:()=>{},paintLegendRow:()=>{},
  drawProfiles:()=>{},drawRows:()=>{},drawIcons:()=>{},caliper:()=>{},setFinish:()=>{},
  setArt:v=>{ctx.st.art=v;},dropSculpt:()=>{ctx.st.sculpt=null;ctx.st.libId=null;},
  offerManualDownload:e=>messages.push(['error',e.message]),
  window:{designerFeedback:{notice:text=>notices.push(text)},keycapShare:SH,keycapSkin:{printableAdvice:()=>null},meshyParseGLB:()=>({positions:mesh()}),
    keycapLibrary:{save:async rec=>{const r={...rec,id:'saved-'+(++seq),triangles:rec.positions.length/9};records.push(r);return r;},get:async id=>records.find(r=>r.id===id)},
    meshy:{pending:()=>null,hasKey:()=>true,generate:async()=>({glb:new ArrayBuffer(0)})}}};
 vm.createContext(ctx);vm.runInContext([
  region('  // ---- sculpture settings','  // ---- step 1:'),
  region('  var SESSION =','  // ---- the shelf'),
  region('  function capFacts()','  function drawShelf()'),
  region('  function useSaved(id)','  function openModelFile(file)'),
  region('  function genBusy(on)','  /* seat()'),
  region('  function resumeGeneration()','  setTimeout(resumeGeneration,'),
  region("  $('kcGen').addEventListener", "  $('kcGenClear').addEventListener"),
  region('  function designOf() {','  // ---- share, and open')
 ].join('\n'),ctx);
 return {ctx,node,messages,notices,records,storage,timers,run:s=>vm.runInContext(s,ctx)};
}
let passed=0;async function test(n,fn){await fn();passed++;console.log('PASS '+n);}
(async()=>{
 await test('generation waits for a confirmed full-mesh save, retaining recipe and human prompt without personal fit',async()=>{
  const f=fixture();let finish,snapshot;
  f.ctx.window.keycapLibrary.save=rec=>{snapshot=rec;return new Promise(r=>{finish=r;});};
  const work=f.ctx.startGeneration('Actual expanded Meshy request',{subject:'Creeper',polycount:100000});await flush();
  assert.equal(f.node('kcGen').disabled,true);assert.ok(snapshot);assert.equal(snapshot.kind,'sculpt');
  assert.equal(snapshot.positions.length,9,'raw artwork only, not an empty/assembled cap');
  assert.notEqual(snapshot.positions,f.ctx.st.sculpt);assert.equal(snapshot.prompt,'Creeper');
  const d=SH.decode(snapshot.design);assert.equal(d.sculptHeightMm,19);assert.equal(d.key,'Esc');
  assert.equal(d.legendOn,false);assert.equal(d.depth,.55);assert.equal(d.meshyPolycount,100000);
  assert.equal(d.slotClearance,undefined);assert.equal(d.mx,undefined);
  assert.ok(!f.messages.some(m=>/^Saved /.test(m[1])));
  finish({id:'confirmed'});await work;assert.equal(f.node('kcGen').disabled,false);
   assert.equal(f.ctx.st.libId,'confirmed');assert.match(f.notices.at(-1),/Saved.*Library/);assert.equal(f.messages.filter(m=>m[0]==='kcGenNote').at(-1)[1],'');
  assert.equal(f.timers.some(t=>t.ms===900||t.ms===600),false);
 });
 await test('paid generation is acknowledged only after Library confirmation, including retry after storage failure',async()=>{
  const f=fixture(),acks=[];f.ctx.window.meshy.acknowledge=id=>{acks.push(id);return true;};
  f.ctx.window.meshy.generate=async()=>({glb:new ArrayBuffer(0),deliveryId:'paid-task'});
  const realSave=f.ctx.window.keycapLibrary.save;
  f.ctx.window.keycapLibrary.save=async()=>{throw Error('quota');};
  await f.ctx.startGeneration('expanded',{subject:'Puppy',polycount:100000});assert.deepEqual(acks,[]);
  f.ctx.window.keycapLibrary.save=realSave;await f.ctx.keepCurrent('Puppy');assert.deepEqual(acks,['paid-task']);
 });
 await test('generated colours and paint swatches survive Library save and restore without another generation',async()=>{
  const f=fixture(),colors=new Float32Array([1,.1,0, .1,1,0, 0,.1,1]);let generations=0;
  Object.assign(f.ctx.st,{colorMode:'color',baseColor:'#123ABC',artColor:'#FEDCBA',useSourceColors:false});
  f.ctx.window.keycapColor={fromGLB:async()=>({colors,kind:'vertex'})};
  f.ctx.window.meshy.generate=async()=>{generations++;return {glb:new ArrayBuffer(0)};};
  await f.ctx.startGeneration('Expanded painting prompt',{subject:'Painted puppy',polycount:100000});
  const rec=f.records[0],saved=Array.from(colors);assert.ok(rec&&rec.id);
  assert.deepEqual(Array.from(rec.sourceColors),saved);assert.equal(rec.sourceColorKind,'vertex');
  assert.notEqual(rec.sourceColors,colors);assert.notEqual(rec.sourceColors,f.ctx.st.sourceColors);
  const design=SH.decode(rec.design);assert.equal(design.colorMode,'color');assert.equal(design.baseColor,'#123ABC');
  assert.equal(design.artColor,'#FEDCBA');assert.equal(design.useSourceColors,false);assert.equal(design.sourceColors,undefined);
  colors.fill(.5);Object.assign(f.ctx.st,{colorMode:'solid',baseColor:'#000000',artColor:'#000000',useSourceColors:true});
  assert.equal(await f.ctx.useSaved(rec.id),true);
  assert.equal(f.ctx.st.colorMode,'color');assert.equal(f.ctx.st.baseColor,'#123ABC');assert.equal(f.ctx.st.artColor,'#FEDCBA');
  assert.equal(f.ctx.st.useSourceColors,false);assert.deepEqual(Array.from(f.ctx.st.sourceColors),saved);
  assert.notEqual(f.ctx.st.sourceColors,rec.sourceColors);assert.equal(generations,1);assert.equal(f.records.length,1);
 });
 await test('settings changed during Meshy generation cannot relabel the requested design',async()=>{
  const f=fixture();let finish;f.ctx.window.meshy.generate=()=>new Promise(r=>{finish=r;});
  const work=f.ctx.startGeneration('Expanded prompt',{subject:'Creeper',polycount:100000});
  Object.assign(f.ctx.st,{profile:'XDA',sizeU:2.25,key:'Y',sculptHeightMm:30,skinFrom:'different artwork'});
  finish({glb:new ArrayBuffer(0)});await work;const d=SH.decode(f.records[0].design);
  assert.equal(d.profile,'DSA');assert.equal(d.sizeU,1);assert.equal(d.key,'Esc');assert.equal(d.sculptHeightMm,19);
  assert.equal(d.prompt,'Creeper');assert.equal(f.ctx.st.profile,'DSA');
 });
 await test('immutable snapshot survives source edits and a different cap cannot inherit the pending saved id',async()=>{
  const f=fixture();const source=mesh();f.ctx.st.sculpt=source;let finish,snapshot;
  f.ctx.window.keycapLibrary.save=rec=>{snapshot=rec;return new Promise(r=>{finish=r;});};
  const work=f.ctx.keepCurrent('first');await flush();const original=Array.from(snapshot.positions);
  source[0]=99;f.ctx.st.sculpt=mesh();f.ctx.st.libId='other';finish({id:'first'});await work;
  assert.deepEqual(Array.from(snapshot.positions),original);assert.equal(f.ctx.st.libId,'other');
 });
 await test('repeat save and redraw use one record for the same source mesh',async()=>{
  const f=fixture();f.ctx.st.sculpt=mesh();const a=f.ctx.keepCurrent('once'),b=f.ctx.keepCurrent('once');
  assert.equal(a,b);await a;await f.ctx.keepCurrent('once');f.ctx.refresh();f.ctx.refreshNow();
  assert.equal(f.records.length,1);
 });
 for(const sync of [false,true])await test((sync?'sync':'async')+' storage failure leaves artwork available and reports unsaved',async()=>{
  const f=fixture();const p=mesh();f.ctx.st.sculpt=p;
  f.ctx.window.keycapLibrary.save=()=>{if(sync)throw Error('quota');return Promise.reject(Error('quota'));};
  assert.equal(await f.ctx.keepCurrent('cute'),null);assert.equal(f.ctx.st.sculpt,p);
  assert.equal(f.ctx.st.libId,null);assert.match(f.messages.at(-1)[1],/NOT saved.*quota.*Export/);
  f.ctx.window.keycapLibrary.save=async()=>({id:'retried'});await f.ctx.keepCurrent('cute');assert.equal(f.ctx.st.libId,'retried');
 });
 await test('missing Library is visible, never called a successful save',async()=>{
  const f=fixture();f.ctx.st.sculpt=mesh();delete f.ctx.window.keycapLibrary;
  assert.equal(await f.ctx.keepCurrent('cute'),null);assert.match(f.messages.at(-1)[1],/NOT saved.*Library.*Export/);
 });
 await test('empty cap, incomplete and non-finite artwork cannot create Library records',async()=>{
  const f=fixture();for(const p of [null,new Float32Array(0),new Float32Array(8),new Float32Array(9).fill(NaN)]){
   f.ctx.st.sculpt=p;assert.equal(await f.ctx.keepCurrent('bad'),null);
  }assert.equal(f.records.length,0);
 });
 await test('saved sculpt reopens exact mesh and recipe without regeneration, resave or changing personal fit',async()=>{
  const f=fixture();await f.ctx.startGeneration('expanded',{subject:'Creeper',polycount:100000});
  const rec=f.records[0],p=Array.from(rec.positions);f.ctx.personalFit=.10;
  Object.assign(f.ctx.st,{profile:'XDA',row:'R3',depth:3,raised:true,legendOn:true,sculptHeightMm:30,key:'Y'});
  assert.equal(await f.ctx.useSaved(rec.id),true);assert.equal(f.ctx.st.profile,'DSA');assert.equal(f.ctx.st.depth,.55);
  assert.equal(f.ctx.st.raised,false);assert.equal(f.ctx.st.legendOn,false);assert.equal(f.ctx.st.sculptHeightMm,19);
  assert.equal(f.ctx.st.name,'Creeper Escape');assert.equal(f.ctx.st.key,'Esc');assert.equal(f.ctx.st.skinFrom,'Creeper');
  assert.equal(f.ctx.personalFit,.10);assert.deepEqual(Array.from(f.ctx.st.sculpt),p);assert.notEqual(f.ctx.st.sculpt,rec.positions);
  f.ctx.st.sculpt[0]=333;assert.deepEqual(Array.from(rec.positions),p);assert.equal(f.records.length,1);
 });
 await test('imported artisan model saves immediately and awaits completion',async()=>{
  const f=fixture(),p=mesh();const rec=await f.ctx.takeMesh(p,'Imported flower');
  assert.ok(rec.id);assert.equal(f.records.length,1);assert.deepEqual(Array.from(rec.positions),Array.from(p));
  assert.equal(f.timers.length,0);
 });
 await test('interrupted generation restores original pending recipe and awaits one save',async()=>{
  const f=fixture();const d={profile:'XDA',row:'R3',sizeU:1,key:'Esc',depth:.55,raised:false,legendOn:false,
   prompt:'Recovered flower',sculptHeightMm:17,meshyPolycount:100000,sculptStyle:'faithfulsubject'};
  f.ctx.window.meshy.pending=()=>({from:'keycap',prompt:'Expanded API prompt',opts:{designCode:SH.encode(d)}});
  f.ctx.window.meshy.resume=async()=>({glb:new ArrayBuffer(0)});
  f.ctx.resumeGeneration();await flush();await flush();
  assert.equal(f.records.length,1);assert.equal(f.records[0].prompt,'Recovered flower');
  assert.equal(SH.decode(f.records[0].design).sculptHeightMm,17);assert.equal(f.ctx.st.profile,'XDA');
  assert.equal(f.node('kcGen').disabled,false);
 });
 console.log(`\n${passed} artisan Library autosave groups passed.`);
})().catch(e=>{console.error(e);process.exitCode=1;});
