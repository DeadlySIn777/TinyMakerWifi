/* Actual Topper handlers with deferred local file/storage operations. No
 * printer, network, Meshy credits, or replacement geometry implementation. */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{createRequire}=require('node:module');
const fixtureFile=path.join(__dirname,'test_topper_meshy.cjs'),harness=fs.readFileSync(fixtureFile,'utf8');
const fixture=Function('require','__dirname',harness.slice(0,harness.indexOf('const tick='))+'\nreturn fixture;')(createRequire(fixtureFile),__dirname);
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {resolve,reject,promise};};
const cube=()=>{const v=[[-2,-2,0],[2,-2,0],[2,2,0],[-2,2,0],[-2,-2,4],[2,-2,4],[2,2,4],[-2,2,4]],p=[];
 for(const q of [[0,3,2,1],[4,5,6,7],[0,1,5,4],[1,2,6,5],[2,3,7,6],[3,0,4,7]])for(const i of [q[0],q[1],q[2],q[0],q[2],q[3]])p.push(...v[i]);return new Float32Array(p);};
function importFile(f,label,d){const target=f.el('tpArtFile');target.value=label;target.files=[{name:label,size:684,arrayBuffer:()=>d.promise}];return target.listeners.change({target});}
const gated=['tpSave','tpSlice','tpExport','tpFitTest'];
let groups=0;async function check(name,fn){await fn();groups++;console.log('PASS '+name);}
(async()=>{
 await check('unconfirmed manual Library replies never claim a successful save',async()=>{
  for(const value of [null,undefined,{}, {id:''}, {id:' '}, {id:17}]){const f=fixture();f.ctx.keycapLibrary.save=async()=>value;
   await f.click('tpSave');assert.equal(f.count('notice'),0);assert.match(f.el('tpState').textContent,/Not saved: Library did not confirm/);assert.equal(f.el('tpSave').disabled,false);
  }
  const f=fixture();await f.click('tpSave');assert.equal(f.saved.size,1);assert.equal(f.count('notice'),1);
 });
 await check('a pending selected file cannot export, save, generate, or send the previous geometry',async()=>{
  const f=fixture(),d=deferred(),reading=importFile(f,'new-art.stl',d);let sends=0;
  f.ctx.slicerLoadMod=async()=>true;f.ctx.slicerLoadMesh=()=>{sends++;return true;};
  for(const id of gated){assert.equal(f.el(id).disabled,true,id+' is gated');if(f.el(id).listeners.click)await f.click(id);}
  await f.click('tpGenerate');assert.equal(f.count('save'),0);assert.equal(f.count('generate'),0);assert.equal(sends,0);
  assert.equal(f.el('tpClearArt').disabled,false,'Clear can cancel a first import');
  d.resolve(cube());await reading;for(const id of gated)assert.equal(f.el(id).disabled,false,id+' recovers');
  await f.click('tpSave');assert.equal(f.saved.size,1);assert.deepEqual([...f.saved.values()][0].topperSource,cube());assert.equal(f.el('tpArtName').textContent,'new-art.stl');
 });
 await check('failed file read preserves old artwork and releases gates with a visible error',async()=>{
  const f=fixture(),first=deferred(),loaded=importFile(f,'working.stl',first);first.resolve(cube());await loaded;
  const d=deferred(),reading=importFile(f,'broken.stl',d);d.reject(Error('file disappeared'));await reading;
  assert.equal(f.el('tpArtName').textContent,'working.stl');assert.match(f.el('tpState').textContent,/file disappeared/);for(const id of gated)assert.equal(f.el(id).disabled,false,id);
  await f.click('tpSave');assert.deepEqual([...f.saved.values()][0].topperSource,cube());
 });
 await check('an older file completion cannot unlock or clear a newer in-flight file',async()=>{
  const f=fixture(),a=deferred(),b=deferred(),first=importFile(f,'first.stl',a),second=importFile(f,'second.stl',b);
  a.resolve(cube());await first;assert.equal(f.el('tpSlice').disabled,true);assert.equal(f.el('tpArtFile').value,'second.stl');
  b.resolve(cube());await second;assert.equal(f.el('tpSlice').disabled,false);assert.equal(f.el('tpArtName').textContent,'second.stl');
 });
 await check('Clear cancels a slow import immediately and its late result cannot return',async()=>{
  const f=fixture(),d=deferred(),reading=importFile(f,'old.stl',d);await f.click('tpClearArt');
  assert.equal(f.el('tpArtFile').value,'','same file can be selected again after Clear');
  for(const id of gated)assert.equal(f.el(id).disabled,false,id+' is released on Clear');
  d.resolve(cube());await reading;assert.equal(f.el('tpArtName').textContent,'Plain socket');await f.click('tpSave');assert.equal([...f.saved.values()][0].topperSource,null);
 });
 await check('an explicit Library selection wins over a pending file and releases its action gates',async()=>{
  const f=fixture(),d=deferred(),reading=importFile(f,'obsolete.stl',d),recipe=f.recipe();recipe.fields.tpWidth='8';
  f.ctx.topperUseSaved({topperRecipe:recipe,topperSource:null,name:'Selected socket'});assert.equal(f.el('tpSlice').disabled,false);assert.equal(f.el('tpWidth').value,'8');
  d.resolve(cube());await reading;assert.equal(f.el('tpArtName').textContent,'Plain socket');await f.click('tpSave');assert.equal([...f.saved.values()][0].topperSource,null);
 });
 await check('a deferred slicer handoff cannot send old geometry after generation starts',async()=>{
  const f=fixture(),engine=deferred(),generation=deferred(),sent=[],stages=[];
  f.ctx.slicerLoadMod=()=>engine.promise;
  f.ctx.slicerLoadMesh=p=>{sent.push(new Float32Array(p));return true;};
  f.ctx.studioStage=x=>stages.push(x);
  const sending=f.click('tpSlice');f.state.hold=generation.promise;
  const generating=f.click('tpGenerate');await new Promise(setImmediate);
  assert.equal(f.count('generate'),1);assert.equal(f.el('tpSlice').disabled,true);
  engine.resolve(true);await sending;
  assert.equal(sent.length,0);assert.deepEqual(stages,[]);
  assert.match(f.el('tpState').textContent,/Wait for artwork generation to finish/);
  generation.resolve();await generating;assert.equal(f.el('tpSlice').disabled,false);
  await f.click('tpSlice');assert.equal(sent.length,1);assert.deepEqual(stages,['model']);
  assert.deepEqual(Array.from(sent[0]),Array.from([...f.saved.values()][0].positions),'explicit retry sends the completed topper');
 });
 console.log(groups+' pending Topper action groups passed; no network or printer access.');
})().catch(e=>{console.error(e);process.exitCode=1;});
