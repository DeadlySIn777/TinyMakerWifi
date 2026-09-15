// Exercise the production save/cache handlers with controllable storage timing.
// Geometry validity is covered by test_keycap_product; no API or printer calls.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const base=path.resolve(__dirname,'../..'),src=fs.readFileSync(path.join(base,'web/parts/keycap-ui.js'),'utf8');
const K=require(path.join(base,'web/parts/keycap.js')),SH=require(path.join(base,'web/parts/keycap-share.js'));
function region(a,b){const i=src.indexOf(a),j=src.indexOf(b,i);assert.ok(i>=0&&j>i,a);return src.slice(i,j);}
const mesh=()=>new Float32Array([0,0,0,1,0,0,0,1,1]);
const flush=()=>new Promise(setImmediate);
function fixture(){
 const pending=[],sessions=[],messages=[];
 const ctx={K,Math,Number,Promise,WeakMap,Float32Array,pending:0,clearTimeout(){},
  stemFitClearance:.10,artisanStyleDraft:null,document:{activeElement:null},$:()=>null,
  st:{key:'Esc',profile:'DSA',row:'R3',sizeU:1,depth:.55,raised:false,art:'gen',digit:'',legendOn:false,
   sculptHeightMm:19,meshyPolycount:100000,sculptStyle:'cuteartisan',sculpt:mesh(),libId:'prior',name:'Assembly A'},
  knownSculptHeight:n=>typeof n==='number'&&Number.isFinite(n),refreshNow(){},capFacts:()=>null,drawShelf(){},
  rememberSession:()=>sessions.push({id:ctx.st.libId,name:ctx.st.name}),say:(...m)=>messages.push(m),
  printEntry:()=>({positions:new Float32Array(ctx.st.sculpt)}),
  checkedLayout:entries=>({leftOver:0,placed:entries,positions:entries[0].positions}),
  window:{keycapShare:SH,keycapProduct:{capture:p=>({...p,state:p.positions?'ready':'needs-attention'})},
   keycapLibrary:{save:rec=>new Promise((resolve,reject)=>pending.push({rec,resolve,reject}))}}};
 vm.createContext(ctx);
 vm.runInContext(region('  var sculptSaves =','  function drawShelf()')+
  region('  function designOf() {','  function applyDesign(d)'),ctx);
 return {ctx,pending,sessions,messages,run:s=>vm.runInContext(s,ctx),
  state:()=>vm.runInContext('({id:st.libId,key:lastSavedProduct&&lastSavedProduct.key,product:lastSavedProduct&&lastSavedProduct.product,current:!!lastSavedProduct&&lastSavedProduct.source===st.sculpt&&lastSavedProduct.key===currentProductKey(window.keycapShare.encode(designOf()))})',ctx)};
}
let passed=0;async function test(name,fn){await fn();passed++;console.log('PASS '+name);}
(async()=>{
 await test('B completing before A remains current, and repeating B keeps its cached record',async()=>{
  const f=fixture(),a=f.ctx.keepCurrent('Art');await flush();
  f.ctx.st.name='Assembly B';const b=f.ctx.keepCurrent('Art');await flush();
  f.pending[1].resolve({id:'B'});await b;f.pending[0].resolve({id:'A'});await a;
  assert.equal(f.state().id,'B');assert.equal(f.state().current,true);
  assert.equal(SH.decode(f.state().product.recipe).name,'Assembly B');
  assert.deepEqual(f.sessions,[{id:'B',name:'Assembly B'}],'stale A must not persist a wrong session');
  assert.equal(f.ctx.keepCurrent('Art'),b);assert.equal(f.state().id,'B');assert.equal(f.pending.length,2);
 });
 await test('a completed cache entry is adopted when its matching edited recipe becomes current again',async()=>{
  const f=fixture(),work=f.ctx.keepCurrent('Art');await flush();
  f.ctx.st.name='Unsaved edit';f.pending[0].resolve({id:'A'});await work;
  assert.equal(f.state().id,'prior');assert.equal(f.state().current,false);assert.equal(f.sessions.length,0);
  f.ctx.st.name='Assembly A';assert.equal(f.ctx.keepCurrent('Art'),work);
  assert.equal(f.state().id,'A');assert.equal(f.state().current,true);assert.equal(f.pending.length,1);
 });
 await test('a fit edit prevents stale adoption and creates a separate exact-fit snapshot',async()=>{
  const f=fixture(),a=f.ctx.keepCurrent('Art');await flush();
  f.ctx.stemFitClearance=.14;f.pending[0].resolve({id:'old-fit'});await a;
  assert.equal(f.state().id,'prior');assert.equal(f.state().current,false);
  const b=f.ctx.keepCurrent('Art');await flush();
  assert.notEqual(a,b);assert.equal(f.pending[0].rec.product.fit.slotMm,1.25);
  assert.equal(f.pending[1].rec.product.fit.slotMm,1.29);
  f.pending[1].resolve({id:'new-fit'});await b;assert.equal(f.state().id,'new-fit');assert.equal(f.state().current,true);
 });
 await test('rotation and size edits are part of save adoption and the saved recipe',async()=>{
  const f=fixture(),a=f.ctx.keepCurrent('Art');await flush();
  f.ctx.st.sculptRotationDeg=90;f.ctx.st.sculptScalePercent=80;
  const b=f.ctx.keepCurrent('Art');await flush();
  f.pending[1].resolve({id:'placed'});await b;f.pending[0].resolve({id:'original'});await a;
  assert.equal(f.state().id,'placed');assert.equal(f.state().current,true);
  const d=SH.decode(f.state().product.recipe);assert.equal(d.sculptRotationDeg,90);assert.equal(d.sculptScalePercent,80);
 });
 await test('in-place source edits cannot adopt or reuse an obsolete mesh snapshot',async()=>{
  const f=fixture(),source=f.ctx.st.sculpt,a=f.ctx.keepCurrent('Art');await flush();
  const original=Array.from(f.pending[0].rec.positions);source[0]=.5;
  f.pending[0].resolve({id:'old-mesh'});await a;assert.equal(f.state().id,'prior');
  assert.deepEqual(Array.from(f.pending[0].rec.positions),original,'stored source is immutable');
  assert.deepEqual(Array.from(f.pending[0].rec.product.positions),original,'stored assembly is immutable');
  const b=f.ctx.keepCurrent('Art');await flush();assert.notEqual(a,b);assert.equal(f.pending.length,2);
  assert.equal(f.pending[1].rec.positions[0],.5);f.pending[1].resolve({id:'edited-mesh'});await b;
  assert.equal(f.state().id,'edited-mesh');assert.equal(f.state().current,true);
 });
 await test('a different current source cannot inherit the earlier source save',async()=>{
  const f=fixture(),a=f.ctx.keepCurrent('Art');await flush();
  f.ctx.st.sculpt=mesh();f.ctx.st.libId='other-source';f.pending[0].resolve({id:'old-source'});await a;
  assert.equal(f.state().id,'other-source');assert.equal(f.state().current,false);assert.equal(f.sessions.length,0);
 });
 await test('duplicate pending saves share the original promise and write once',async()=>{
  const f=fixture(),a=f.ctx.keepCurrent('Art'),b=f.ctx.keepCurrent('Art');assert.equal(a,b);await flush();
  assert.equal(f.pending.length,1);f.pending[0].resolve({id:'once'});await a;
  assert.equal(f.state().id,'once');assert.equal(f.state().current,true);assert.equal(f.ctx.keepCurrent('Art'),a);
  assert.equal(f.pending.length,1);
 });
 await test('an older failed save cannot evict a newer successful cache entry',async()=>{
  const f=fixture(),a=f.ctx.keepCurrent('Art');await flush();
  f.ctx.st.name='Assembly B';const b=f.ctx.keepCurrent('Art');await flush();
  f.pending[1].resolve({id:'B'});await b;f.pending[0].reject(new Error('older write failed'));assert.equal(await a,null);
  assert.equal(f.ctx.keepCurrent('Art'),b);await flush();assert.equal(f.pending.length,2);
  assert.equal(f.state().id,'B');assert.equal(f.state().current,true);
 });
 await test('failed current writes can be retried instead of retaining a failed promise',async()=>{
  const f=fixture(),a=f.ctx.keepCurrent('Art');await flush();f.pending[0].reject(new Error('quota'));assert.equal(await a,null);
  const b=f.ctx.keepCurrent('Art');await flush();assert.notEqual(a,b);assert.equal(f.pending.length,2);
  f.pending[1].resolve({id:'retried'});await b;assert.equal(f.state().id,'retried');assert.equal(f.state().current,true);
 });
 console.log(`\n${passed} finished-product save race groups passed.`);
})().catch(e=>{console.error(e);process.exitCode=1;});
