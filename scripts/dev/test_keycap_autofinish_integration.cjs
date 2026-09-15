/* Actual generation/autofinish/save handlers with inert Meshy/IndexedDB
 * dependencies. Geometry search itself is tested in test_keycap_autofinish.
 * No API, browser, paid task or printer. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const harness=fs.readFileSync(path.join(__dirname,'test_keycap_library_autosave.cjs'),'utf8');
const end=harness.indexOf('let passed=0;');assert.ok(end>0);
const fixture=Function('require','__dirname',harness.slice(0,end)+'\nreturn fixture;')(require,__dirname);
const source=fs.readFileSync(path.join(__dirname,'../../web/parts/keycap-ui.js'),'utf8');
function region(a,b){const i=source.indexOf(a),j=source.indexOf(b,i);assert.ok(i>=0&&j>i,a);return source.slice(i,j);}
const flush=()=>new Promise(setImmediate);
const mesh=()=>new Float32Array([0,0,0,1,0,0,0,1,1]);
const passedChecks=()=>['geometry','attachment','socket','print-fit'].map(name=>({name,status:'pass',reason:''}));
const ready=()=>({state:'ready',issues:[],fit:{slotMm:1.3}});
function setup(){
  const f=fixture();f.options=[];
  // The ordinary fixture uses a trivial drop helper. This regression needs
  // the real helper: applyDesign invalidates the earlier request token here.
  f.run(region('  function dropSculpt() {','  function setArt(mode) {'));
  f.ctx.captureProduct=()=>ready();
  f.ctx.window.keycapAutoFinish={run:async options=>{
    f.options.push(options);
    return {status:'accepted',candidate:{...options.initial,scalePercent:88},checks:passedChecks(),reason:'Checks passed.'};
  }};
  return f;
}
function beginGeneration(f){return f.ctx.startGeneration('Expanded sculpture prompt',{subject:'Cute sculpture',polycount:100000});}
function haveArtwork(f){Object.assign(f.ctx.st,{sculpt:mesh(),skinFrom:'Existing sculpture',sculptScalePercent:100,sculptRotationDeg:0});}
let passed=0;async function test(name,fn){await fn();passed++;console.log('PASS '+name);}

(async()=>{
  await test('successful generation automatically finishes despite applyDesign invalidating its original request token',async()=>{
    const f=setup();let requestToken;
    f.ctx.window.meshy.generate=async()=>{requestToken=f.run('sculptLoadSerial');return {glb:new ArrayBuffer(0)};};
    await beginGeneration(f);
    assert.ok(f.run('sculptLoadSerial')>requestToken,'actual applyDesign/dropSculpt must really invalidate the request token');
    assert.equal(f.options.length,1,'the delivered source must still receive automatic physical finishing');
    assert.equal(f.options[0].mode,'preserve-height');assert.equal(f.options[0].initial.heightMm,19);
    assert.equal(f.options[0].heightStepMm,.5);assert.equal(f.options[0].scaleStepPercent,1);
    assert.equal(f.ctx.st.sculptScalePercent,88);assert.equal(f.records.length,2,'original saved before the refined recipe');
    const SH=f.ctx.window.keycapShare;
    assert.equal(SH.decode(f.records[0].design).sculptScalePercent,100);
    assert.equal(SH.decode(f.records[1].design).sculptScalePercent,88);
    assert.deepEqual(Array.from(f.records[0].positions),Array.from(f.records[1].positions),'raw artwork stays exact');
    assert.equal(f.records[1].product.state,'ready');assert.equal(f.node('kcGen').disabled,false);
  });
  await test('disabled automatic-fit preference saves the generated original without silently running sizing',async()=>{
    const f=setup();f.storage.set('tmKeycapAutoFinish','off');await beginGeneration(f);
    assert.equal(f.options.length,0);assert.equal(f.records.length,1);assert.equal(f.ctx.st.sculptScalePercent,100);
    assert.equal(f.node('kcGen').disabled,false);
  });
  for(const change of ['new-selection','new-load-token','source-identity','same-source-edit']) {
    await test(change+' before original save completion suppresses stale generation finishing',async()=>{
      const f=setup();let complete,snapshot;
      f.ctx.window.keycapLibrary.save=record=>{snapshot=record;return new Promise(resolve=>complete=resolve);};
      const work=beginGeneration(f);await flush();assert.ok(snapshot);assert.equal(f.options.length,0);
      const oldSource=f.ctx.st.sculpt;
      if(change==='new-selection'){f.ctx.dropSculpt();f.ctx.st.sculpt=mesh();f.ctx.st.name='New selection';}
      else if(change==='new-load-token')f.run('nextSculptLoad()');
      else if(change==='same-source-edit')f.ctx.st.sculptRotationDeg=73;
      else f.ctx.st.sculpt=mesh();
      const selected=f.ctx.st.sculpt;
      complete({...snapshot,id:'saved-original',product:ready()});await work;
      assert.equal(f.options.length,0);assert.equal(f.ctx.st.sculpt,selected);
      if(change!=='new-load-token'&&change!=='same-source-edit')assert.notEqual(selected,oldSource);
      if(change==='same-source-edit')assert.equal(f.ctx.st.sculptRotationDeg,73);
      assert.equal(f.node('kcGen').disabled,false);
    });
  }
  await test('final saved product needing attention cannot inherit the earlier passing assessment',async()=>{
    const f=setup();haveArtwork(f);
    f.ctx.captureProduct=()=>({state:'needs-attention',issues:['The final oriented mesh failed its check.']});
    const result=await f.ctx.finishCurrentArtwork('fill',false);
    assert.equal(result.physical.state,'needs-attention');assert.match(result.physical.issues[0],/final oriented mesh/);
    assert.equal(f.records.length,1);assert.ok(!f.notices.some(n=>/^Fit checked and saved/.test(n)));
    assert.equal(f.options[0].mode,'fill');assert.equal(f.options[0].maxHeightMm,30);
    assert.equal(f.options[0].heightStepMm,.5);assert.equal(f.options[0].scaleStepPercent,1);
    assert.equal(f.run('autoFinishBusy'),false);
  });
  await test('missing final product proof also returns needs-attention rather than Ready',async()=>{
    const f=setup();haveArtwork(f);f.ctx.captureProduct=()=>null;
    const result=await f.ctx.finishCurrentArtwork('fill',true);
    assert.equal(result.physical.state,'needs-attention');assert.match(result.physical.issues[0],/not verified/);
  });
  for(const change of ['edit','new-source','closed-review']) {
    await test(change+' during the final save suppresses a stale Ready assessment',async()=>{
      const f=setup();haveArtwork(f);let complete,snapshot,closed=false;
      f.ctx.window.keycapLibrary.save=record=>{snapshot=record;return new Promise(resolve=>complete=resolve);};
      const work=f.ctx.finishCurrentArtwork('fill',false,()=>closed);await flush();
      assert.ok(snapshot);assert.equal(f.ctx.st.sculptScalePercent,88,'candidate must have been applied before the asynchronous save');
      if(change==='edit')f.ctx.st.sculptRotationDeg=43;
      else if(change==='new-source'){f.ctx.dropSculpt();f.ctx.st.sculpt=mesh();f.ctx.st.name='Another artwork';}
      else closed=true;
      const selected=f.ctx.st.sculpt;
      complete({...snapshot,id:'finished-snapshot',product:ready()});
      assert.equal(await work,null);assert.equal(f.ctx.st.sculpt,selected);
      if(change==='edit')assert.equal(f.ctx.st.sculptRotationDeg,43);
      assert.ok(!f.notices.some(n=>/^Fit checked and saved/.test(n)));assert.equal(f.run('autoFinishBusy'),false);
    });
  }
  await test('final save failure reports failure and always releases the busy guard',async()=>{
    const f=setup();haveArtwork(f);f.ctx.window.keycapLibrary.save=async()=>{throw Error('Storage quota exceeded');};
    await assert.rejects(f.ctx.finishCurrentArtwork('fill',false),/not saved/);
    assert.equal(f.run('autoFinishBusy'),false);assert.equal(f.records.length,0);
    assert.ok(!f.notices.some(n=>/^Fit checked and saved/.test(n)));
  });
  await test('a newer edit while the search is awaiting its result cannot be overwritten',async()=>{
    const f=setup();haveArtwork(f);let complete,options;
    f.ctx.window.keycapAutoFinish.run=o=>{options=o;return new Promise(resolve=>complete=resolve);};
    const work=f.ctx.finishCurrentArtwork('fill',false);await flush();
    f.ctx.st.sculptRotationDeg=67;assert.equal(options.isCancelled(),true);
    complete({status:'accepted',candidate:{heightMm:30,scalePercent:99,rotationDeg:0},checks:passedChecks()});
    assert.equal(await work,null);assert.equal(f.ctx.st.sculptRotationDeg,67);assert.equal(f.ctx.st.sculptScalePercent,100);
    assert.equal(f.records.length,0);assert.equal(f.run('autoFinishBusy'),false);
  });
  console.log(passed+' autofinish handler integration groups passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
