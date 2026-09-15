/* Real keycap handlers with fixture-only Meshy: no API, browser or printer. */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const harness=fs.readFileSync(path.join(__dirname,'test_keycap_library_autosave.cjs'),'utf8');
const end=harness.indexOf('let passed=0;');assert.ok(end>0);
const fixture=Function('require','__dirname',harness.slice(0,end)+'\nreturn fixture;')(require,__dirname);
const Color=require('../../web/parts/keycap-color.js');
const flush=()=>new Promise(setImmediate),same=(a,b)=>assert.deepEqual(Array.from(a),Array.from(b));
const triangle=()=>new Float32Array([0,0,0,1,0,0,0,1,1]);
function texture(){return {version:1,positionLength:9,baseColors:new Float32Array(9).fill(1),textures:[{start:0,count:3,
 uvs:new Float32Array([0,0,1,0,0,1]),width:2,height:2,data:new Uint8ClampedArray([255,0,0,255,0,255,0,255,0,0,255,255,255,255,255,255]),
 wrapS:33071,wrapT:33071,filter:'linear'}]};}
function setup(){const f=fixture(),t=texture();f.ctx.window.keycapColor={...Color,fromGLB:async()=>({colors:new Float32Array(9).fill(.5),kind:'texture',textureReference:t})};
 f.ctx.confirm=()=>true;f.ctx.window.meshy.acknowledge=id=>{f.acks.push(id);return true;};f.acks=[];
 f.ctx.st.sculpt=triangle();f.ctx.st.meshySource={previewId:'accepted',refineId:null};return {f,t};}
let passed=0;async function test(name,fn){await fn();passed++;console.log('PASS '+name);}
(async()=>{
 await test('generated source texture and Meshy provenance survive save and exact Library reopen',async()=>{
  const {f,t}=setup();f.ctx.window.meshy.generate=async()=>({glb:new ArrayBuffer(0),previewId:'source-task',deliveryId:'source-task'});
  await f.ctx.startGeneration('cute prompt',{subject:'Cute',polycount:100000});const rec=f.records[0];
  assert.equal(rec.meshySource.previewId,'source-task');assert.ok(Color.validTextureReference(rec.sourceTexture,rec.positions));
  assert.notEqual(rec.sourceTexture.textures[0].data,t.textures[0].data);const pixels=Array.from(rec.sourceTexture.textures[0].data);
  t.textures[0].data.fill(0);await f.ctx.useSaved(rec.id);same(f.ctx.st.sourceTexture.textures[0].data,pixels);
  same(f.ctx.st.seatedTexture.textures[0].uvs,[0,0,0,1,1,0]);same(f.ctx.st.sculpt,rec.positions);
  assert.equal(f.ctx.st.meshySource.previewId,'source-task');assert.equal(f.records.length,1);
 });
 await test('Add Meshy texture waits for explicit approval and keeps previous artwork while waiting',async()=>{
  const {f}=setup();let calls=0,finish;f.ctx.window.meshy.generateTexture=()=>{calls++;return new Promise(r=>finish=r);};
  const original=f.ctx.st.sculpt;f.ctx.confirm=()=>false;assert.equal(await f.ctx.addMeshyTexture(),false);assert.equal(calls,0);
  f.ctx.confirm=()=>true;const work=f.ctx.addMeshyTexture();await flush();assert.equal(calls,1);assert.equal(f.ctx.st.sculpt,original);assert.equal(f.node('kcAddTexture').disabled,true);
  finish({glb:new ArrayBuffer(0),previewId:'accepted',refineId:'paint-task',deliveryId:'paint-task'});await work;
  assert.equal(f.records.length,1);assert.equal(f.records[0].meshySource.refineId,'paint-task');assert.deepEqual(f.acks,['paint-task']);
  assert.ok(f.records[0].sourceTexture);assert.equal(f.ctx.st.profile,'DSA');assert.equal(f.ctx.st.sizeU,1);
 });
 await test('texture is acknowledged only after confirmed Library save and retry keeps the same paid task',async()=>{
  const {f}=setup();let calls=0;f.ctx.window.meshy.generateTexture=async()=>{calls++;return {glb:new ArrayBuffer(0),previewId:'accepted',refineId:'paint-task',deliveryId:'paint-task'};};
  const save=f.ctx.window.keycapLibrary.save;f.ctx.window.keycapLibrary.save=async()=>{throw Error('quota');};
  await f.ctx.addMeshyTexture();assert.deepEqual(f.acks,[]);assert.ok(f.ctx.st.sourceTexture);assert.equal(f.records.length,0);
  f.ctx.window.keycapLibrary.save=save;await f.ctx.keepCurrent('Cute');assert.deepEqual(f.acks,['paint-task']);assert.equal(calls,1);
 });
 await test('missing decoded UV texture never acknowledges a paid texture as preserved',async()=>{
  const {f}=setup();f.ctx.window.keycapColor.fromGLB=async()=>({colors:null,kind:'none'});
  f.ctx.window.meshy.generateTexture=async()=>({glb:new ArrayBuffer(0),previewId:'accepted',refineId:'paint-task',deliveryId:'paint-task'});
  await f.ctx.addMeshyTexture();assert.equal(f.records.length,1);assert.equal(f.records[0].sourceTexture,null);assert.deepEqual(f.acks,[]);
  assert.ok(f.notices.some(n=>/task is kept for recovery/.test(n)));
 });
 await test('an interrupted texture recovers its exact recipe without submitting another paid task',async()=>{
  const {f}=setup();const code=f.ctx.window.keycapShare.encode({...f.ctx.designOf(),name:'Recovered paint',sculptHeightMm:17});
  f.ctx.window.meshy.pending=()=>({id:'paint-task',previewId:'accepted',from:'keycap',stage:'refine',designCode:code});
  let recovered=0;f.ctx.window.meshy.resume=async()=>{recovered++;return {glb:new ArrayBuffer(0),previewId:'accepted',refineId:'paint-task',deliveryId:'paint-task'};};
  f.ctx.window.meshy.generateTexture=()=>{throw Error('No paid call during recovery');};
  await f.ctx.addMeshyTexture();assert.equal(recovered,1);assert.equal(f.ctx.st.name,'Recovered paint');assert.equal(f.ctx.st.sculptHeightMm,17);
  assert.ok(f.records[0].sourceTexture);assert.deepEqual(f.acks,['paint-task']);
 });
 await test('another tool pending task, missing provenance and missing API key cannot spend credits',async()=>{
  for(const kind of ['other','provenance','key']){const {f}=setup();f.ctx.window.meshy.generateTexture=()=>{throw Error('Paid call forbidden');};
   if(kind==='other')f.ctx.window.meshy.pending=()=>({id:'other',from:'model'});
   if(kind==='provenance')f.ctx.st.meshySource=null;if(kind==='key')f.ctx.window.meshy.hasKey=()=>false;
   assert.equal(await f.ctx.addMeshyTexture(),false);assert.equal(f.records.length,0);
  }
 });
 await test('a newer model selection wins over an old texture download without acknowledging it',async()=>{
  const {f}=setup();let finish;f.ctx.window.meshy.generateTexture=()=>new Promise(r=>finish=r);
  const work=f.ctx.addMeshyTexture();await flush();const newer=triangle();newer[0]=4;f.ctx.st.sculpt=newer;f.ctx.nextSculptLoad();
  finish({glb:new ArrayBuffer(0),previewId:'accepted',refineId:'paint-task',deliveryId:'paint-task'});await work;
  assert.equal(f.ctx.st.sculpt,newer);assert.deepEqual(f.acks,[]);assert.equal(f.records.length,0);
 });
 await test('plain imported geometry clears texture and Meshy provenance',async()=>{
  const {f}=setup();f.ctx.setSourceReference(new Float32Array(9).fill(1),'texture',texture(),{previewId:'before'});
  await f.ctx.takeMesh(triangle(),'Plain STL');assert.equal(f.ctx.st.sourceTexture,null);assert.equal(f.ctx.st.meshySource,null);
  assert.equal(f.records[0].sourceTexture,null);assert.equal(f.node('kcAddTexture').hidden,true);assert.ok(f.messages.some(m=>m[0]==='kcTextureStatus'&&/No source texture/.test(m[1])));
 });
 await test('recovering texture preserves the current artwork during decode and honors a newer Library selection',async()=>{
  const {f}=setup();let release;const original=f.ctx.st.sculpt;
  f.ctx.window.meshy.pending=()=>({id:'paint-task',from:'keycap',stage:'refine',designCode:f.ctx.window.keycapShare.encode({...f.ctx.designOf(),name:'Recovered older'})});
  f.ctx.window.meshy.resume=async()=>({glb:new ArrayBuffer(0),previewId:'accepted',refineId:'paint-task',deliveryId:'paint-task'});
  f.ctx.window.keycapColor.fromGLB=()=>new Promise(r=>release=r);
  const work=f.ctx.resumeGeneration();await flush();assert.equal(f.ctx.st.sculpt,original);assert.equal(f.ctx.st.name,'Creeper Escape');
  const chosen=triangle();chosen[0]=8;f.ctx.st.sculpt=chosen;f.ctx.nextSculptLoad();
  release({colors:new Float32Array(9).fill(1),kind:'texture',textureReference:texture()});await work;
  assert.equal(f.ctx.st.sculpt,chosen);assert.equal(f.ctx.st.name,'Creeper Escape');assert.equal(f.records.length,0);assert.deepEqual(f.acks,[]);
 });
 for(const stage of ['download','decode'])await test('new artwork selection wins over fresh generation during '+stage,async()=>{
  const {f}=setup();let release;
  if(stage==='download')f.ctx.window.meshy.generate=()=>new Promise(r=>release=r);
  else{f.ctx.window.meshy.generate=async()=>({glb:new ArrayBuffer(0),previewId:'fresh',deliveryId:'fresh'});f.ctx.window.keycapColor.fromGLB=()=>new Promise(r=>release=r);}
  const work=f.ctx.startGeneration('New paid request',{subject:'Old requested figure',polycount:100000});await flush();
  const chosen=triangle();chosen[0]=7;f.ctx.st.sculpt=chosen;f.ctx.st.name='Newer selection';f.ctx.nextSculptLoad();
  release(stage==='download'?{glb:new ArrayBuffer(0),previewId:'fresh',deliveryId:'fresh'}:{colors:new Float32Array(9).fill(1),kind:'texture',textureReference:texture()});
  await work;assert.equal(f.ctx.st.sculpt,chosen);assert.equal(f.ctx.st.name,'Newer selection');assert.equal(f.records.length,0);assert.deepEqual(f.acks,[]);
 });
 console.log(passed+' texture lifecycle groups passed; no network or printer access.');
})().catch(e=>{console.error(e);process.exitCode=1;});
