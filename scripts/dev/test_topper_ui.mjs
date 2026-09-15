/* Actual topper UI handlers with controlled engine/storage dependencies.
 * Exercises action gates, exact geometry handoff and stale asynchronous work.
 * No printer, network, API keys or live browser state.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {meshHealth}=require('../../web/parts/mesh-health.js');
const stlRead=require('../../web/parts/stl-read.js');
const topper=require('../../web/parts/topper.js');
const sculpt=require('../../web/parts/keycap-sculpt.js');
const source=fs.readFileSync(new URL('../../web/parts/topper-ui.js',import.meta.url),'utf8');
const html=fs.readFileSync(new URL('../../web/parts/topper-card.html',import.meta.url),'utf8');
function box(x=10,y=10,z=12){
  const v=[[-x/2,-y/2,0],[x/2,-y/2,0],[x/2,y/2,0],[-x/2,y/2,0],[-x/2,-y/2,z],[x/2,-y/2,z],[x/2,y/2,z],[-x/2,y/2,z]],out=[];
  for(const q of [[0,3,2,1],[4,5,6,7],[0,1,5,4],[1,2,6,5],[2,3,7,6],[3,0,4,7]])
    for(const i of [q[0],q[1],q[2],q[0],q[2],q[3]])out.push(...v[i]);
  return new Float32Array(out);
}
assert.equal(meshHealth(box()).severity,'ok');
function buffer(p=box(3,3,3)){
  const b=new ArrayBuffer(84+p.length/9*50),d=new DataView(b);d.setUint32(80,p.length/9,true);
  for(let i=0;i<p.length;i++)d.setFloat32(84+Math.floor(i/9)*50+12+(i%9)*4,p[i],true);
  return b;
}
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
function fixture(overrides={}){
  const elements=new Map(),calls=[],state={buildBad:false,seatBad:false};
  for(const m of html.matchAll(/<(?:input|select|button|canvas|p|output|section|label)\b[^>]*\bid=['"]([^'"]+)['"][^>]*>/g)){
    const id=m[1],value=/\bvalue=['"]([^'"]*)['"]/.exec(m[0]);
    elements.set(id,{id,value:value?value[1]:'',disabled:false,textContent:'',className:'',style:{},listeners:{},
      addEventListener(type,fn){this.listeners[type]=fn;}});
  }
  const el=id=>{assert.ok(elements.has(id),'real HTML contains '+id);return elements.get(id);};
  el('tpPreset').value='pencil-round';el('tpShape').value='round';
  const ctx={Promise,Math,Number,Float32Array,ArrayBuffer,DataView,Blob,JSON,
    localStorage:{getItem:()=>null,setItem:()=>{}},
    document:{getElementById:el,createElement:()=>({click(){calls.push(['download',this.download]);},remove(){}}),body:{appendChild(){}}},
    URL:{createObjectURL:b=>{calls.push(['blob',b]);return 'blob:offline';},revokeObjectURL:()=>{}},setTimeout:()=>0,
    fetch:()=>{throw Error('Network access forbidden');},
    meshHealth,stlRead,
    designerFeedback:{notice:(message,opts)=>calls.push(['notice',message,opts])},
    topper:{build:p=>{calls.push(['build',p]);return {ok:!state.buildBad,issues:state.buildBad?['Measured width is not valid.']:[],positions:box()};}},
    keycapView3d:{attach:()=>({setMesh:p=>calls.push(['preview',p])})},
    keycapSculpt:{seat:(cap,p)=>{calls.push(['seat',p]);return {positions:cap.positions};},check:()=>({ok:!state.seatBad,issues:state.seatBad?['Sculpt does not attach.']:[]})},
    keycapLibrary:{save:r=>{calls.push(['save',r]);return Promise.resolve({id:'saved',...r});}},
    slicerLoadMod:()=>Promise.resolve({}),
    slicerLoadMesh:(p,name,size,opts)=>{calls.push(['slice',p,name,size,opts]);return true;},
    studioStage:x=>calls.push(['stage',x]),studioGo:x=>calls.push(['go',x])
  };
  Object.assign(ctx,overrides);ctx.window=ctx;vm.createContext(ctx);vm.runInContext(source,ctx,{filename:'topper-ui.js:actual-handlers'});
  async function click(id){await el(id).listeners.click();}
  async function change(id,value){el(id).value=value;await (el(id).listeners.change||el(id).listeners.input)({target:el(id)});}
  function file(name,p=Promise.resolve(buffer())){const target=el('tpArtFile');target.files=[{name,size:684,arrayBuffer:()=>p}];target.value=name;return target.listeners.change({target});}
  return {ctx,el,calls,state,click,change,file};
}
const plain=x=>JSON.parse(JSON.stringify(x));
let passed=0,failed=0;
async function test(name,fn){try{await fn();console.log('OK '+name);passed++;}catch(e){console.error('FAIL '+name+'\n'+e.stack);failed++;}}
await test('valid initial topper enables actions and shows dimensions from generated geometry',async()=>{
  const f=fixture();for(const id of ['tpSave','tpExport','tpSlice'])assert.equal(f.el(id).disabled,false);
  assert.equal(f.el('tpDims').textContent,'10.00 × 10.00 × 12.00 mm');
});
await test('engine refusal with otherwise valid positions disables actions and cannot bypass through a handler',async()=>{
  const f=fixture();f.state.buildBad=true;f.ctx.topperRefresh();f.calls.length=0;
  for(const id of ['tpSave','tpExport','tpSlice']){assert.equal(f.el(id).disabled,true);await f.click(id);}
  assert.equal(f.calls.some(c=>['save','slice','blob'].includes(c[0])),false);
  assert.match(f.el('tpState').textContent,/Measured width is not valid/);
});
await test('invalid generated geometry cannot save, export or reach slicer',async()=>{
  const f=fixture();f.ctx.topper.build=()=>({ok:true,positions:new Float32Array(9)});f.ctx.topperRefresh();f.calls.length=0;
  for(const id of ['tpSave','tpExport','tpSlice']){assert.equal(f.el(id).disabled,true);await f.click(id);}
  assert.equal(f.calls.some(c=>['save','slice','blob'].includes(c[0])),false);
});
await test('Save keeps model geometry, mm dimensions and fit parameters without slicing or starting anything',async()=>{
  const f=fixture();await f.change('tpModel','My stylus');await f.click('tpSave');
  const saves=f.calls.filter(c=>c[0]==='save');assert.equal(saves.length,1);const r=saves[0][1];
  assert.equal(r.kind,'model');assert.equal(r.name,'Topper-My stylus');assert.deepEqual(Array.from(r.positions),Array.from(box()));
  assert.deepEqual(plain(r.facts.sizeMm),[10,10,12]);assert.equal(r.facts.topper.diameterMm,7);assert.equal(r.facts.topper.clearanceMm,.2);
  assert.equal(f.calls.some(c=>['slice','stage','go','download'].includes(c[0])),false);
});
await test('Exported STL contains the same checked positions as Library save',async()=>{
  const f=fixture();await f.click('tpSave');await f.click('tpExport');
  const saved=f.calls.find(c=>c[0]==='save')[1],blob=f.calls.find(c=>c[0]==='blob')[1];
  assert.deepEqual(Array.from(stlRead.readSTL(await blob.arrayBuffer()).positions),Array.from(saved.positions));
});
await test('Save failure remains visible and does not transition to slicer',async()=>{
  const f=fixture();f.ctx.keycapLibrary.save=()=>Promise.reject(Error('storage full'));await f.click('tpSave');
  assert.match(f.el('tpState').textContent,/Not saved: storage full/);assert.match(f.el('tpState').className,/warn/);
  assert.equal(f.calls.some(c=>['slice','stage','go'].includes(c[0])),false);
});
await test('Send to slicer keeps exact socket geometry and requests no auto-scaling or reorientation',async()=>{
  const f=fixture();await f.click('tpSlice');const s=f.calls.find(c=>c[0]==='slice');assert.ok(s);
  assert.deepEqual(Array.from(s[1]),Array.from(box()));assert.equal(s[3],box().byteLength);
  assert.deepEqual(plain(s[4]),{keepPose:true,noScale:true});
  assert.deepEqual(f.calls.filter(c=>c[0]==='stage'),[['stage','model']]);
  assert.deepEqual(f.calls.filter(c=>c[0]==='go'),[['go','create']]);
});
await test('changing the topper while the slicer engine loads prevents stale mesh handoff',async()=>{
  const f=fixture(),d=deferred();f.ctx.slicerLoadMod=()=>d.promise;const sending=f.click('tpSlice');
  await f.change('tpWall','2');d.resolve({});await sending;
  assert.equal(f.calls.some(c=>['slice','stage','go'].includes(c[0])),false);
  assert.match(f.el('tpState').textContent,/Topper changed/);
});
await test('slicer rejection does not switch workspace or report a successful send',async()=>{
  const f=fixture();f.ctx.slicerLoadMesh=()=>false;await f.click('tpSlice');
  assert.equal(f.calls.some(c=>['stage','go'].includes(c[0])),false);
  assert.match(f.el('tpState').textContent,/could not load/);
});
await test('clear sculpt invalidates an older successful file read',async()=>{
  const f=fixture(),d=deferred(),reading=f.file('old.stl',d.promise);await f.click('tpClearArt');f.calls.length=0;d.resolve(buffer());await reading;
  assert.equal(f.calls.some(c=>c[0]==='seat'),false);assert.match(f.el('tpArtName').textContent,/Plain socket/);
});
await test('a stale file read rejection cannot overwrite the newer successful sculpt status',async()=>{
  const f=fixture(),d=deferred(),reading=f.file('old.stl',d.promise);await f.file('new.stl');
  const status=f.el('tpState').textContent;d.reject(Error('old file read failed'));await reading;
  assert.equal(f.el('tpArtName').textContent,'new.stl');assert.equal(f.el('tpState').textContent,status);
});
await test('a sculpt that cannot seat preserves the previous working sculpt and action state',async()=>{
  const f=fixture();await f.file('working.stl');f.state.seatBad=true;await f.file('unattached.stl');
  assert.equal(f.el('tpArtName').textContent,'working.stl');
  for(const id of ['tpSave','tpExport','tpSlice'])assert.equal(f.el(id).disabled,false);
  assert.match(f.el('tpState').textContent,/does not attach/);
});
await test('tight/loose controls adjust clearance in the direction indicated and clamp it',async()=>{
  const f=fixture();await f.click('tpTight');assert.equal(f.el('tpFit').value,'0.22');await f.click('tpLoose');assert.equal(f.el('tpFit').value,'0.20');
  await f.change('tpFit','.6');await f.click('tpTight');assert.equal(f.el('tpFit').value,'0.60');
  await f.change('tpFit','0');await f.click('tpLoose');assert.equal(f.el('tpFit').value,'0.00');
});
await test('real topper and seating engines produce an attached model and preserve the socket vertices',async()=>{
  const f=fixture();f.ctx.topper=topper;f.ctx.keycapSculpt=sculpt;f.ctx.topperRefresh();
  assert.equal(f.el('tpSave').disabled,false,f.el('tpState').textContent);
  await f.file('cube-art.stl');assert.equal(f.el('tpArtName').textContent,'cube-art.stl',f.el('tpState').textContent);
  await f.click('tpSave');const rec=f.calls.find(c=>c[0]==='save')[1],base=topper.build(rec.facts.topper);
  assert.ok(rec.positions.length>base.positions.length,'sculpt triangles must be included');
  for(let i=0;i<base.positions.length;i++)assert.ok(Math.abs(rec.positions[i]-base.positions[i])<0.00001,'socket vertex '+i+' unchanged');
  assert.ok(rec.facts.sizeMm[2]>base.size.z);assert.ok(!meshHealth(rec.positions).fatal);
});
await test('real oval socket requires both measured axes and saves them without assuming a stylus size',async()=>{
  const f=fixture();f.ctx.topper=topper;await f.change('tpPreset','samsung-stylus');
  assert.equal(f.el('tpSave').disabled,true);
  await f.change('tpModel','Measured stylus');await f.change('tpWidth','7');await f.change('tpShape','oval');
  assert.equal(f.el('tpSave').disabled,true,'missing second axis must not be invented');
  await f.change('tpSecondWidth','5');assert.equal(f.el('tpSave').disabled,false,f.el('tpState').textContent);
  await f.click('tpSave');const rec=f.calls.find(c=>c[0]==='save')[1];
  assert.equal(rec.facts.topper.socketShape,'oval');assert.equal(rec.facts.topper.secondAxisMm,5);assert.equal(rec.facts.topper.diameterMm,7);
});
await test('a pending save is single-flight and cannot label newer edits as saved',async()=>{
  const f=fixture(),d=deferred();f.ctx.keycapLibrary.save=r=>{f.calls.push(['save',r]);return d.promise;};
  const saving=f.click('tpSave');assert.equal(f.el('tpSave').disabled,true);await f.click('tpSave');
  await f.change('tpFit','.3');assert.equal(f.el('tpSave').disabled,true,'edits do not reopen an in-flight save');
  d.resolve({id:'old-version'});await saving;
  assert.equal(f.calls.filter(c=>c[0]==='save').length,1);
  assert.equal(f.calls.find(c=>c[0]==='save')[1].facts.topper.clearanceMm,.2);
  assert.match(f.el('tpState').textContent,/previous version.*current changes still need saving/);
  assert.equal(f.el('tpSave').disabled,false);
});
await test('oval measurement is shown only when needed and art controls require a sculpt',async()=>{
  const f=fixture();assert.equal(f.el('tpSecondWidth').hidden,true);assert.equal(f.el('tpSecondLabel').hidden,true);
  assert.equal(f.el('tpArtRotation').disabled,true);assert.equal(f.el('tpClearArt').disabled,true);
  await f.change('tpShape','oval');assert.equal(f.el('tpSecondWidth').hidden,false);assert.equal(f.el('tpSecondWidth').disabled,false);
  await f.file('working.stl');assert.equal(f.el('tpArtRotation').disabled,false);assert.equal(f.el('tpClearArt').disabled,false);
  await f.click('tpClearArt');assert.equal(f.el('tpArtRotation').disabled,true);
});
await test('rotation changes only actual artwork and the exported fit remains exact',async()=>{
  const f=fixture();f.ctx.topper=topper;f.ctx.keycapSculpt=sculpt;f.ctx.topperRefresh();
  await f.file('wide-art.stl',Promise.resolve(buffer(box(7,3,12))));await f.click('tpSave');
  const first=f.calls.filter(c=>c[0]==='save').at(-1)[1];
  await f.change('tpArtRotation','90');await f.click('tpSave');
  const turned=f.calls.filter(c=>c[0]==='save').at(-1)[1],base=topper.build(turned.facts.topper);
  assert.deepEqual(Array.from(first.positions.subarray(0,base.positions.length)),Array.from(turned.positions.subarray(0,base.positions.length)));
  assert.notDeepEqual(Array.from(first.positions.subarray(base.positions.length)),Array.from(turned.positions.subarray(base.positions.length)));
  assert.equal(turned.facts.artRotationDeg,90);assert.equal(f.el('tpArtSize').textContent,'3.00 × 7.00 × 12.00 mm');
});
await test('a browser without mesh draft storage gives an explicit reload warning',async()=>{
  const f=fixture();await f.file('working.stl');assert.match(f.el('tpDraftState').textContent,/Artwork will not survive a reload/);
  assert.match(f.el('tpDraftState').className,/warn/);await f.click('tpClearArt');assert.doesNotMatch(f.el('tpDraftState').className,/warn/);
});
await test('blocked browser storage never claims the current draft or fit settings were kept',async()=>{
  const f=fixture({localStorage:{getItem(){throw Error('disabled');},setItem(){throw Error('disabled');}}});
  assert.match(f.el('tpDraftState').textContent,/settings will not survive a reload/);assert.match(f.el('tpDraftState').className,/warn/);
  const g=fixture({indexedDB:{open(){throw Error('blocked by browser');}}});await Promise.resolve();await Promise.resolve();
  assert.match(g.el('tpDraftState').textContent,/could not be restored.*blocked by browser/);
  await g.change('tpWidth','8');await Promise.resolve();
  assert.match(g.el('tpDraftState').textContent,/Draft was not kept/);
});
await test('explicit completed actions use notices while edits stay quiet and failures stay inline',async()=>{
  const f=fixture();assert.equal(f.el('tpState').hidden,true);assert.equal(f.el('tpDraftState').hidden,true);
  await f.change('tpFit','.3');assert.equal(f.calls.filter(c=>c[0]==='notice').length,0);
  await f.click('tpSave');await f.click('tpExport');await f.click('tpClearArt');
  const notices=f.calls.filter(c=>c[0]==='notice');assert.equal(notices.length,3);assert.ok(notices.every(c=>c[2].kind==='success'));
  assert.equal(f.el('tpState').hidden,true);assert.equal(f.el('tpArtSize').hidden,true);
  f.ctx.keycapLibrary.save=()=>Promise.reject(Error('storage full'));await f.click('tpSave');
  assert.equal(f.el('tpState').hidden,false);assert.match(f.el('tpState').textContent,/storage full/);
  assert.equal(f.calls.filter(c=>c[0]==='notice').length,3,'errors never become temporary success notices');
});
function delayedDraft(){
  let releaseRead=null,current={version:1,fields:{tpWidth:'6'},art:box(6,4,12),artName:'saved-source.stl'};
  const indexedDB={open(){const rq={};queueMicrotask(()=>{
    rq.result={close(){},transaction(store,mode){const tx={};tx.objectStore=()=>({
      get(){const get={};releaseRead=()=>{get.result=structuredClone(current);tx.oncomplete();};return get;},
      put(value){const snapshot=structuredClone(value);queueMicrotask(()=>{current=snapshot;tx.oncomplete();});}
    });return tx;}};rq.onsuccess();});return rq;}};
  return {indexedDB,release(){assert.equal(typeof releaseRead,'function');releaseRead();},current:()=>current};
}
const settle=()=>new Promise(resolve=>setImmediate(resolve));
await test('Save, export and slicer wait for the stored sculpt instead of using the startup plain socket',async()=>{
  const db=delayedDraft(),f=fixture({indexedDB:db.indexedDB});await Promise.resolve();
  for(const id of ['tpSave','tpExport','tpSlice']){assert.equal(f.el(id).disabled,true,id);await f.click(id);assert.match(f.el('tpState').textContent,/saved topper draft.*loading/);}
  assert.equal(f.calls.filter(c=>['save','download','slice'].includes(c[0])).length,0);
  db.release();await settle();for(const id of ['tpSave','tpExport','tpSlice'])assert.equal(f.el(id).disabled,false,id);
  await f.click('tpSave');assert.equal(f.calls.filter(c=>c[0]==='save').length,1);assert.ok(f.calls.find(c=>c[0]==='save')[1].topperSource,'restored sculpt is present in saved product');
});
await test('late draft restoration keeps both edited dimensions and the saved original sculpt',async()=>{
  const db=delayedDraft(),f=fixture({indexedDB:db.indexedDB});await Promise.resolve();
  await f.change('tpWidth','8');db.release();await settle();
  assert.equal(f.el('tpWidth').value,'8');assert.equal(db.current().fields.tpWidth,'8');
  assert.equal(f.el('tpArtName').textContent,'saved-source.stl');assert.deepEqual(Array.from(db.current().art),Array.from(box(6,4,12)));
});
await test('draft restoration keeps a typed value even before its change event fires',async()=>{
  const db=delayedDraft(),f=fixture({indexedDB:db.indexedDB});await Promise.resolve();
  f.el('tpWidth').value='9';db.release();await settle();assert.equal(f.el('tpWidth').value,'9');assert.equal(db.current().fields.tpWidth,'9');
  assert.equal(f.el('tpArtName').textContent,'saved-source.stl');
});
await test('an explicit Clear during draft loading prevents the old source from returning',async()=>{
  const db=delayedDraft(),f=fixture({indexedDB:db.indexedDB});await Promise.resolve();
  await f.click('tpClearArt');db.release();await settle();assert.match(f.el('tpArtName').textContent,/Plain socket/);assert.equal(db.current().art,null);
});
await test('a successful new import wins over a late stored source',async()=>{
  const db=delayedDraft(),f=fixture({indexedDB:db.indexedDB});await Promise.resolve();
  await f.file('new-source.stl');db.release();await settle();assert.equal(f.el('tpArtName').textContent,'new-source.stl');assert.equal(db.current().artName,'new-source.stl');
});
await test('restoring the source does not cancel a new file still loading',async()=>{
  const db=delayedDraft(),f=fixture({indexedDB:db.indexedDB}),d=deferred();await Promise.resolve();
  const importing=f.file('new-source.stl',d.promise);db.release();await settle();assert.equal(f.el('tpArtName').textContent,'saved-source.stl');
  d.resolve(buffer());await importing;await settle();assert.equal(f.el('tpArtName').textContent,'new-source.stl');assert.equal(db.current().artName,'new-source.stl');
});
console.log(passed+' topper UI groups passed; '+failed+' failed. No printer/network access.');
if(failed)process.exitCode=1;
