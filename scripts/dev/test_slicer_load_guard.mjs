/* Executes the actual slicerLoadMesh and file-change handlers extracted from
 * the current UI source. Uses real STL reader + mesh health, mocked UI/engine
 * effects. No printer, browser session, API key, network or WASM download.
 * node scripts/dev/test_slicer_load_guard.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);
const {meshHealth} = require('../../web/parts/mesh-health.js');
const stlRead = require('../../web/parts/stl-read.js');
const slicerSource = fs.readFileSync(new URL('../../web/parts/slicer.js', import.meta.url), 'utf8');
const meshySource = fs.readFileSync(new URL('../../web/parts/meshy-ui.js', import.meta.url), 'utf8');
function extract(source, startText, endText) {
  const start = source.indexOf(startText);
  assert.notEqual(start, -1, 'source entry must exist: '+startText);
  const end = source.indexOf(endText, start);
  assert.notEqual(end, -1, 'source entry must terminate: '+startText);
  return source.slice(start, end+endText.length);
}
const loadSource = extract(slicerSource, 'window.slicerLoadMesh=function(', '\n};');
const fileSource = extract(slicerSource, "$('slicerFile').addEventListener('change'", '\n});');
const aiFileSource = extract(meshySource, "  $('meshyFile').addEventListener('change'", '\n  });');
const aiLoadGuardSource = extract(meshySource, '  var loadVersion=0;', '\n  }');
const triangle = () => new Float32Array([0,0,0, 1,0,0, 0,1,0]);
const arrayBuffer = b => b.buffer.slice(b.byteOffset, b.byteOffset+b.length);
function binarySTL(positions) {
  const b = Buffer.alloc(84+positions.length/9*50);
  b.writeUInt32LE(positions.length/9,80);
  for(let i=0;i<positions.length;i++) b.writeFloatLE(positions[i],84+Math.floor(i/9)*50+12+(i%9)*4);
  return arrayBuffer(b);
}

function fixture({health=true, engine=true, empty=false}={}) {
  const calls=[], elements=new Map(), listeners=new Map();
  function element(id) {
    if(!elements.has(id)) elements.set(id, {
      textContent:'previous '+id, value:'existing-model', disabled:false,
      style:{visibility:'visible',display:'flex'},
      addEventListener(type, fn){listeners.set(id+':'+type,fn);}
    });
    return elements.get(id);
  }
  const previousPreview={tag:'previous-rendered-preview'};
  const ctx={window:{}, Number, Math, Float32Array, Float64Array, ArrayBuffer, Uint8Array,
    Promise, console, calls, preview:previousPreview,
    slicerRaw:new Float32Array([0,0,2, 2,0,2, 0,2,2]),
    slicerOut:{tag:'previous-slice',layers:[new Uint8Array([7,8,9])]},
    slicerTr:{rx:12,rz:34,scale:.8}, slicerBudget:321,
    slicerFileName:'previous.stl',slicerFileBytes:444,slicerHome:false,
    slicerNoScale:true,slicerScaleBlocked:true,
    last:{tag:'previous-AI-model',positions:triangle(),textured:true},
    buttonsEnabled:true,
    $:element,
    gl3dSupports:value=>calls.push(['supports',value]),
    slicerSupportFacts:value=>calls.push(['facts',value]),
    slicerLayerUI:value=>calls.push(['layer-ui',value]),
    slicerButtons:on=>{ctx.buttonsEnabled=on;calls.push(['buttons',on]);},
    slicerRender:()=>{ctx.preview={positions:ctx.slicerRaw};calls.push(['render']);},
    slicerSay:(id,text)=>{element(id).textContent=text;calls.push(['say',id,text]);},
    slicerBusyStop:()=>false,
    ensureEngine:()=>Promise.resolve(!!ctx.slicerMod),
    showHealth:()=>{},busy:()=>{},
    say:(id,text)=>{element(id).textContent=text;},
    loadIntoSlicer:()=>{throw Error('unexpected GLB route in STL test');},
    keepInLibrary:()=>Promise.resolve(null),
    fetch:()=>{throw Error('test must never use the network');}
  };
  ctx.slicerMod=engine ? {
    detailBudget:p=>{calls.push(['budget',p]);return 1000;},
    autoOrient:p=>{calls.push(['orient',p]);return {tr:{rx:90,rz:0,scale:1}};},
    parseSTL:()=>{throw Error('legacy WASM STL reader must not run');}
  } : null;
  if(health)ctx.window.meshHealth=meshHealth;
  ctx.window.stlRead=stlRead;
  ctx.window.gl3dSupports=ctx.gl3dSupports;
  for(const id of ['slicerProg','slicerSave','slicerDiscardLink','slicerName','slicerGo'])element(id);
  if(empty){
    ctx.slicerRaw=null;ctx.slicerOut=null;ctx.preview=null;
    ctx.slicerFileName='';ctx.slicerFileBytes=0;ctx.buttonsEnabled=false;
    for(const e of elements.values())e.disabled=true;
  }
  vm.createContext(ctx);
  // The file handler now participates in the real asynchronous model-selection
  // guard. Include that closure instead of dropping it from this extraction.
  vm.runInContext(aiLoadGuardSource,ctx,{filename:'meshy-ui.js:actual-load-guard'});
  vm.runInContext(loadSource,ctx,{filename:'slicer.js:actual-slicerLoadMesh'});
  const fields=['slicerRaw','slicerOut','slicerTr','slicerBudget','slicerFileName',
    'slicerFileBytes','slicerHome','slicerNoScale','slicerScaleBlocked','preview'];
  const original=Object.fromEntries(fields.map(k=>[k,ctx[k]]));
  const originalJSON=JSON.stringify(original);
  const originalControls=ctx.buttonsEnabled;
  const domJSON=JSON.stringify([...elements]);
  return {ctx,calls,elements,listeners,element,
    preserved({dom=true,controls=true}={}) {
      for(const field of fields)assert.equal(ctx[field],original[field],field+' must keep the previous value/reference');
      assert.equal(JSON.stringify(Object.fromEntries(fields.map(k=>[k,ctx[k]]))),originalJSON,'existing contents must not mutate');
      if(dom)assert.equal(JSON.stringify([...elements]),domJSON,'existing controls must not mutate');
      if(controls)assert.equal(ctx.buttonsEnabled,originalControls,'model tools must keep their previous enabled state');
    }
  };
}
let pass=0,fail=0;
async function test(name,fn) {
  try {await fn();pass++;console.log('OK '+name);}
  catch(e){fail++;console.error('FAIL '+name+'\n  '+e.stack);}
}
async function reject(name, positions, options={}) {
  await test(name,()=>{
    const f=fixture(options);
    assert.equal(f.ctx.window.slicerLoadMesh(positions,'bad.stl',999),false);
    assert.deepEqual(f.calls,[],'rejection must happen before engine/render/clear effects');
    f.preserved();
  });
}
await reject('missing positions preserve the existing model and slice',null);
await reject('empty positions preserve the existing model and slice',new Float32Array());
await reject('incomplete triangle rejected before mutation',new Float32Array(8));
await reject('complete triangle plus trailing coordinate rejected',new Float32Array(10));
for(const value of [NaN,Infinity,-Infinity]){
  const p=triangle();p[5]=value;
  await reject('nonfinite '+String(value)+' rejected before mutation',p);
}
await reject('zero-area point triangle rejected before mutation',new Float32Array(9));
await reject('zero-area collinear triangle rejected before mutation',new Float32Array([0,0,0,1,1,1,2,2,2]));
await reject('finite coordinates with overflowing area rejected',new Float64Array([0,0,0,1e300,0,0,0,1e300,0]));
const badWinding=new Float32Array([0,0,0,1,0,0,0,1,0, 0,0,0,1,0,0,0,0,1]);
assert.equal(meshHealth(badWinding).severity,'bad');
await reject('real mixed-winding bad-health result rejected',badWinding);
await reject('unloaded engine preserves existing state',triangle(),{engine:false});
await reject('fallback with no health module rejects zero-area mesh',new Float32Array(9),{health:false});
await test('warning-only open surface is accepted and invalidates the previous slice',()=>{
  const f=fixture(),p=triangle();
  assert.equal(meshHealth(p).severity,'warn');
  assert.equal(f.ctx.window.slicerLoadMesh(p,'new.stl',134),true);
  assert.equal(f.ctx.slicerRaw,p);assert.equal(f.ctx.slicerOut,null);
  assert.equal(f.ctx.preview.positions,p);
  assert.equal(f.calls.filter(c=>c[0]==='render').length,1);
  assert.equal(f.calls.filter(c=>c[0]==='orient').length,1);
  assert.equal(f.element('slicerName').value,'new');
  assert.equal(f.ctx.slicerNoScale,true,'an unlabelled imported file keeps its physical dimensions');
});
await test('only an explicit caller opt-in allows automatic dimension changes',()=>{
  const f=fixture();
  assert.equal(f.ctx.window.slicerLoadMesh(triangle(),'unlabelled.stl',134,{noScale:false}),true);
  assert.equal(f.ctx.slicerNoScale,false);
});
await test('keepPose and noScale are preserved on accepted model',()=>{
  const f=fixture(),p=triangle();
  assert.equal(f.ctx.window.slicerLoadMesh(p,'already-posed.glb',40,{keepPose:true,noScale:true}),true);
  assert.equal(f.ctx.slicerNoScale,true);assert.equal(f.ctx.slicerScaleBlocked,false);
  assert.deepEqual(JSON.parse(JSON.stringify(f.ctx.slicerTr)),{rx:0,rz:0,scale:1});
  assert.equal(f.calls.some(c=>c[0]==='orient'),false);
});
await test('valid geometry accepted by fallback when health module is absent',()=>{
  const f=fixture({health:false});
  assert.equal(f.ctx.window.slicerLoadMesh(triangle(),'good.stl',134),true);
});

async function runFileHandler(f,source,id,buf) {
  vm.runInContext(source,f.ctx,{filename:id+':actual-file-handler'});
  const handler=f.listeners.get(id+':change');assert.equal(typeof handler,'function');
  await handler({target:{files:[{name:'import.stl',size:buf.byteLength,arrayBuffer:()=>Promise.resolve(buf)}]}});
  // Meshy's event callback does not return its promise chain; drain it without
  // timers/network or pretending the event completed synchronously.
  await new Promise(resolve=>setImmediate(resolve));
}
await test('STL slicer file entry uses the real strict reader, not WASM parseSTL',async()=>{
  const f=fixture();await runFileHandler(f,fileSource,'slicerFile',binarySTL(triangle()));
  assert.equal(f.ctx.slicerFileName,'import.stl');assert.equal(f.ctx.slicerOut,null);
  assert.equal(f.calls.filter(c=>c[0]==='render').length,1);
});
await test('STL slicer rejected file keeps the previous model tools usable',async()=>{
  const f=fixture();await runFileHandler(f,fileSource,'slicerFile',binarySTL(new Float32Array(9)));
  f.preserved({dom:false});
  assert.equal(f.calls.some(c=>c[0]==='render'||c[0]==='supports'),false);
});
await test('STL slicer rejected first file leaves an empty workspace disabled',async()=>{
  const f=fixture({empty:true});
  await runFileHandler(f,fileSource,'slicerFile',binarySTL(new Float32Array(9)));
  f.preserved({dom:false});assert.equal(f.ctx.buttonsEnabled,false);
  assert.equal(f.calls.some(c=>c[0]==='render'||c[0]==='supports'),false);
});
await test('strict STL parse failure preserves the previous model and tools',async()=>{
  const f=fixture(),p=triangle();p[4]=NaN;
  await runFileHandler(f,fileSource,'slicerFile',binarySTL(p));
  f.preserved({dom:false});
  assert.match(f.element('slicerInfo').textContent,/broken numbers/);
  assert.equal(f.calls.some(c=>c[0]==='render'||c[0]==='supports'),false);
});
await test('Meshy local STL entry uses strict reader and commits only after acceptance',async()=>{
  const f=fixture();await runFileHandler(f,aiFileSource,'meshyFile',binarySTL(triangle()));
  assert.equal(f.ctx.last.textured,false);assert.equal(f.ctx.last.positions,f.ctx.slicerRaw);
  assert.equal(f.calls.filter(c=>c[0]==='render').length,1);
});
await test('Meshy local malformed STL keeps the previous AI model and preview',async()=>{
  const f=fixture(),previous=f.ctx.last;
  await runFileHandler(f,aiFileSource,'meshyFile',binarySTL(new Float32Array(9)));
  assert.equal(f.ctx.last,previous);f.preserved({dom:false});
});
console.log(`${pass} slicer-load regression groups passed; ${fail} failed; no network/printer access.`);
process.exitCode=fail?1:0;
