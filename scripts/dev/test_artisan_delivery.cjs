/* Actual revision delivery/recovery handlers; inert Meshy and Library only. */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const harness=fs.readFileSync(path.join(__dirname,'test_keycap_library_autosave.cjs'),'utf8');
const end=harness.indexOf('let passed=0;');assert.ok(end>0);
const fixture=Function('require','__dirname',harness.slice(0,end)+'\nreturn fixture;')(require,__dirname);
const Color=require('../../web/parts/keycap-color.js');
const flush=()=>new Promise(setImmediate),same=(a,b)=>assert.deepEqual(Array.from(a),Array.from(b));
const triangle=()=>new Float32Array([0,0,0,1,0,0,0,1,1]);
function texture(){return {version:1,positionLength:9,baseColors:new Float32Array(9).fill(1),textures:[{start:0,count:3,
 uvs:new Float32Array([0,0,1,0,0,1]),width:2,height:2,data:new Uint8ClampedArray([255,0,0,255,0,255,0,255,0,0,255,255,255,255,255,255]),
 wrapS:33071,wrapT:33071,filter:'linear'}]};}
function accepted(){return {status:'accepted',candidate:{heightMm:17,scalePercent:96,rotationDeg:0},checks:
 ['geometry','attachment','socket','print-fit'].map(name=>({name,status:'pass'}))};}
function delivered(extra){return Object.assign({sourceFamily:'image-to-3d',imageId:'image-paid',modelId:'model-paid',deliveryId:'model-paid',glb:new ArrayBuffer(0),opts:{texture:true}},extra);}
function setup(){
 const f=fixture();f.acks=[];f.phases=[];f.adoptions=0;f.paidCalls=0;f.resumes=0;f.original=f.ctx.st.sculpt=triangle();
 f.ctx.st.skinFrom='Original puppy';f.ctx.st.libId='original';f.originalState=f.ctx.st;
 f.records.push({id:'original',name:'Original puppy',positions:new Float32Array(f.original)});
 f.ctx.window.keycap=f.ctx.K;
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../../web/parts/keycap-product.js'),'utf8'),f.ctx);
 f.ctx.window.keycapColor={...Color,fromGLB:async()=>({colors:new Float32Array(9).fill(.5),kind:'texture',textureReference:texture()})};
 f.ctx.window.meshy.acknowledge=id=>{f.acks.push(id);return true;};
 for(const name of ['generate','reviseFromImage','generateTexture'])f.ctx.window.meshy[name]=()=>{f.paidCalls++;throw Error('Paid call forbidden');};
 f.ctx.document.createElement=()=>({toDataURL:()=> 'data:image/jpeg;base64,AA=='});
 f.ctx.optimizeArtwork=async(candidate)=>{assert.equal(f.ctx.st,f.originalState);f.phases.push({phase:'check',candidate});return accepted();};
 f.ctx.captureProduct=recipe=>{
  f.phases.push({phase:'capture',candidate:f.ctx.st});
  return f.ctx.window.keycapProduct.capture({positions:triangle(),recipe,fit:{slotMm:f.run('+(K.MX.crossWide+stemFitClearance).toFixed(2)')},issues:[]});
 };
 f.ctx.reviewRender=()=>{assert.notEqual(f.ctx.st,f.originalState);};
 const apply=f.ctx.applyDesign;
 f.ctx.applyDesign=d=>{f.adoptions++;assert.ok(f.records.length>1,'candidate saved before any current-state mutation');return apply(d);};
 f.ctx.useSaved=()=>{throw Error('No asynchronous re-open during adoption');};
 f.base=()=>f.ctx.artworkState();
 f.deliver=(state=delivered(),stale=()=>false)=>f.ctx.deliverArtworkRevision(state,f.base(),stale);
 f.pending=design=>({family:'visual-revision',from:'keycap',stage:'model',modelId:'model-paid',designCode:design});
 f.recover=(design,state=delivered())=>{
  f.ctx.window.meshy.pending=()=>f.pending(design);
  f.ctx.window.meshy.resume=async()=>{f.resumes++;return state;};
  return f.ctx.resumeGeneration();
 };
 return f;
}
let passed=0;async function test(name,fn){await fn();passed++;console.log('PASS '+name);}
(async()=>{
 await test('delivery keeps current source and settings until decoded, physically checked and durably saved',async()=>{
  const f=setup(),realSave=f.ctx.window.keycapLibrary.save;let decode,save,record;
  f.ctx.window.keycapColor.fromGLB=()=>new Promise(r=>decode=r);
  f.ctx.window.keycapLibrary.save=rec=>{record=rec;return new Promise(r=>save=r);};
  const work=f.deliver();await flush();assert.equal(f.ctx.st,f.originalState);assert.equal(f.ctx.st.sculpt,f.original);assert.equal(f.adoptions,0);
  decode({colors:new Float32Array(9).fill(.5),kind:'texture',textureReference:texture()});await flush();
  assert.ok(record);assert.equal(f.ctx.st.sculpt,f.original);assert.equal(f.ctx.st.sculptHeightMm,19);assert.equal(f.adoptions,0);assert.deepEqual(f.acks,[]);
  assert.ok(record.sourceTexture);assert.equal(record.meshySource,null);assert.equal(record.product.state,'ready');
  const d=f.ctx.window.keycapShare.decode(record.design);assert.equal(d.sculptHeightMm,17);assert.equal(d.sculptScalePercent,96);assert.equal(d.slotClearance,undefined);
  save(await realSave(record));const result=await work;assert.equal(result.close,true);assert.equal(f.adoptions,1);
  assert.notEqual(f.ctx.st.sculpt,f.original);same(f.ctx.st.sculpt,record.positions);assert.equal(f.ctx.st.sculptHeightMm,17);
  assert.equal(f.records[0].id,'original');same(f.records[0].positions,f.original);assert.deepEqual(f.acks,['model-paid']);assert.equal(f.paidCalls,0);
 });
 for(const kind of ['failed-attachment','unresolved-check','blocked-product','invalid-product'])await test(kind+' cannot replace current artwork',async()=>{
  const f=setup(),capture=f.ctx.captureProduct;
  if(kind==='failed-attachment')f.ctx.optimizeArtwork=async()=>({...accepted(),status:'rejected'});
  if(kind==='unresolved-check')f.ctx.optimizeArtwork=async()=>{const a=accepted();a.checks[1].status='unresolved';return a;};
  if(kind==='blocked-product')f.ctx.captureProduct=recipe=>f.ctx.window.keycapProduct.capture({positions:null,recipe,fit:{slotMm:1.25},issues:['Print pose exceeds the bed']});
  if(kind==='invalid-product')f.ctx.captureProduct=recipe=>{const p=capture(recipe);p.positions[0]=99;return p;};
  if(kind==='invalid-product')await assert.rejects(f.deliver(),/coordinates|snapshot/);else assert.match((await f.deliver()).message,/repair/);
  assert.equal(f.ctx.st,f.originalState);assert.equal(f.ctx.st.sculpt,f.original);assert.equal(f.ctx.st.libId,'original');assert.equal(f.adoptions,0);
  assert.equal(f.records.length,2,'paid candidate source is retained even if it needs repair');same(f.records[0].positions,f.original);
 });
 await test('missing requested UV texture keeps the task pending after shape adoption and repeat Save',async()=>{
  const f=setup();f.ctx.window.keycapColor.fromGLB=async()=>({colors:null,kind:'none'});
  const result=await f.deliver();assert.equal(result.close,true);assert.match(result.message,/Texture could not be decoded/);
  assert.equal(f.records[1].sourceTexture,null);assert.deepEqual(f.acks,[]);
  await f.ctx.keepCurrent('Original puppy');assert.deepEqual(f.acks,[]);assert.equal(f.paidCalls,0);
 });
 await test('explicitly untextured delivery may acknowledge its preserved geometry',async()=>{
  const f=setup();f.ctx.window.keycapColor.fromGLB=async()=>({colors:null,kind:'none'});
  await f.deliver(delivered({opts:{texture:false}}));assert.deepEqual(f.acks,['model-paid']);
 });
 for(const mode of ['reject','empty-id','mismatched-source'])await test('Library '+mode+' never acknowledges or adopts the paid revision',async()=>{
  const f=setup();f.ctx.window.keycapLibrary.save=async rec=>{
   if(mode==='reject')throw Error('storage quota');if(mode==='empty-id')return {...rec,id:''};
   return {...rec,id:'wrong',positions:new Float32Array(9).fill(8)};
  };
  await assert.rejects(f.deliver());assert.equal(f.ctx.st.sculpt,f.original);assert.equal(f.adoptions,0);assert.deepEqual(f.acks,[]);
 });
 await test('a failed thumbnail still preserves and adopts a verified paid model',async()=>{
  const f=setup();f.ctx.reviewRender=()=>{throw Error('GPU unavailable');};await f.deliver();assert.equal(f.records[1].thumb,null);assert.equal(f.adoptions,1);
 });
 for(const phase of ['decode','check','save'])await test('a new selection during '+phase+' wins over late revision delivery',async()=>{
  const f=setup();let release,stale=false,work,rec;
  if(phase==='decode')f.ctx.window.keycapColor.fromGLB=()=>new Promise(r=>release=()=>r({colors:null,kind:'none'}));
  if(phase==='check')f.ctx.optimizeArtwork=()=>new Promise(r=>release=()=>r(accepted()));
  if(phase==='save'){const real=f.ctx.window.keycapLibrary.save;f.ctx.window.keycapLibrary.save=r=>{rec=r;return new Promise(resolve=>release=async()=>resolve(await real(rec)));};}
  work=f.deliver(delivered(),()=>stale);await flush();assert.equal(f.ctx.st.sculpt,f.original);stale=true;
  const selected=triangle();selected[0]=4;f.ctx.st.sculpt=selected;release();
  if(phase==='save')assert.match((await work).message,/selection is unchanged/);else await assert.rejects(work,/kept for recovery/);
  assert.equal(f.ctx.st.sculpt,selected);assert.equal(f.adoptions,0);assert.equal(f.records.length,phase==='save'?2:1);
  assert.equal(f.acks.length,phase==='save'?1:0);
 });
 await test('recovered recipe is evaluated privately and successful recovery preserves the local socket fit',async()=>{
  const f=setup(),design={...f.ctx.designOf(),profile:'XDA',key:'Y',name:'Saved creature',prompt:'Saved prompt',sculptHeightMm:21,baseColor:'#123ABC'};
  const code=f.ctx.window.keycapShare.encode(design),beforeFit=f.run('stemFitClearance');let decoded;
  f.ctx.window.keycapColor.fromGLB=()=>new Promise(r=>decoded=r);
  const work=f.recover(code);await flush();assert.equal(f.ctx.st.profile,'DSA');assert.equal(f.ctx.st.key,'Esc');assert.equal(f.ctx.st.sculptHeightMm,19);assert.equal(f.ctx.st.sculpt,f.original);
  decoded({colors:new Float32Array(9).fill(.5),kind:'texture',textureReference:texture()});await work;
  const checked=f.phases.find(p=>p.phase==='check').candidate;assert.equal(checked.profile,'XDA');assert.equal(checked.skinFrom,'Saved prompt');
  assert.equal(f.ctx.st.profile,'XDA');assert.equal(f.ctx.st.key,'Y');assert.equal(f.ctx.st.name,'Saved creature · revision');
  assert.equal(f.run('stemFitClearance'),beforeFit);assert.equal(f.resumes,1);assert.equal(f.paidCalls,0);assert.equal(f.adoptions,1);
 });
 await test('recovered failed candidate preserves the current recipe and existing Library product',async()=>{
  const f=setup(),code=f.ctx.window.keycapShare.encode({...f.ctx.designOf(),profile:'XDA',key:'Y',name:'Recovered older'});
  f.ctx.optimizeArtwork=async()=>({...accepted(),status:'rejected'});await f.recover(code);
  assert.equal(f.ctx.st.profile,'DSA');assert.equal(f.ctx.st.key,'Esc');assert.equal(f.ctx.st.sculpt,f.original);assert.equal(f.adoptions,0);
  assert.equal(f.resumes,1);assert.equal(f.paidCalls,0);assert.equal(f.records.length,2);assert.equal(f.records[1].name,'Recovered older · revision');
 });
 await test('recovery with missing texture does not acknowledge the paid task',async()=>{
  const f=setup();f.ctx.window.keycapColor.fromGLB=async()=>({colors:null,kind:'none'});
  await f.recover(f.ctx.window.keycapShare.encode(f.ctx.designOf()));assert.equal(f.resumes,1);assert.deepEqual(f.acks,[]);
  assert.equal(f.adoptions,1);await f.ctx.keepCurrent('still missing texture');assert.deepEqual(f.acks,[]);assert.equal(f.paidCalls,0);
 });
 await test('recovery respects fit/settings changed while a texture is decoding',async()=>{
  const f=setup();let release;f.ctx.window.keycapColor.fromGLB=()=>new Promise(r=>release=r);
  const work=f.recover(f.ctx.window.keycapShare.encode(f.ctx.designOf()));await flush();f.ctx.st.profile='XDA';f.run('stemFitClearance=.10');
  release({colors:null,kind:'none'});await work;assert.equal(f.ctx.st.profile,'XDA');assert.equal(f.run('stemFitClearance'),.10);assert.equal(f.ctx.st.sculpt,f.original);
  assert.equal(f.adoptions,0);assert.equal(f.records.length,1);assert.deepEqual(f.acks,[]);assert.ok(f.messages.some(m=>/kept for recovery/.test(m[1])));
 });
 await test('missing recovery recipe and another card pending task cannot overwrite the editor or create jobs',async()=>{
  const f=setup();await f.recover(null);assert.equal(f.adoptions,0);assert.equal(f.records.length,1);assert.equal(f.ctx.st.sculpt,f.original);
  assert.ok(f.messages.some(m=>/recipe is missing/.test(m[1])));f.ctx.window.meshy.pending=()=>({...f.pending(''),from:'topper'});
  await f.ctx.resumeGeneration();assert.equal(f.resumes,1);assert.equal(f.paidCalls,0);assert.deepEqual(f.acks,[]);
 });
 console.log(`\n${passed} artisan delivery/recovery groups passed.`);
})().catch(e=>{console.error(e);process.exitCode=1;});
