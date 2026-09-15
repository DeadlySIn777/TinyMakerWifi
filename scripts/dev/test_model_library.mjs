/* Actual Models file handlers + Library handlers, offline with a memory store.
 * No browser session, printer, API key, network, generation or print command.
 * node scripts/dev/test_model_library.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);
const stlRead = require('../../web/parts/stl-read.js');
const {meshHealth} = require('../../web/parts/mesh-health.js');
const source = name => fs.readFileSync(new URL('../../web/parts/'+name, import.meta.url),'utf8');
const slicer = source('slicer.js');
const start = slicer.indexOf('window.slicerLoadMesh=function(');
assert.ok(start>=0);
const loader = slicer.slice(start,slicer.indexOf('\n};',start)+4);
const triangle = () => new Float32Array([0,0,0, 12,0,0, 0,20,0]);
function stl(p=triangle()) {
  const b=new ArrayBuffer(84+p.length/9*50),d=new DataView(b);
  d.setUint32(80,p.length/9,true);
  for(let i=0;i<p.length;i++)d.setFloat32(84+Math.floor(i/9)*50+12+(i%9)*4,p[i],true);
  return b;
}
function fixture({engine=true,store=true}={}) {
  const elements=new Map(),calls=[],records=new Map(),timers=[];let seq=0;
  class Element {
    constructor(id=''){this.id=id;this.children=[];this.style={};this.listeners={};this.value='';this.disabled=false;this._text='';this.width=0;}
    addEventListener(type,fn){this.listeners[type]=fn;}
    appendChild(c){this.children.push(c);return c;}
    get firstChild(){return this.children[0];} get lastChild(){return this.children.at(-1);}
    get textContent(){return this._text+this.children.map(x=>x.textContent).join('');}
    set textContent(v){this._text=String(v);this.children=[];}
    get innerHTML(){return this._text;}
    set innerHTML(v){this._text='';this.children=[];
      if(v==='<span></span><b></b>'){this.appendChild(new Element());this.appendChild(new Element());}
      else if(v.includes("id='stLibNote'")){this.appendChild(new Element());this.appendChild(el('stLibNote'));}
      else if(v.includes("class='grow'"))this.appendChild(new Element());
      else this._text=v;
    }
    click(){return this.listeners.click?.({target:this});}
    remove(){}
  }
  function el(id){if(!elements.has(id))elements.set(id,new Element(id));return elements.get(id);}
  const ctx={console,Promise,Math,Number,Date,Float32Array,Float64Array,ArrayBuffer,Uint8Array,DataView,Blob,
    setTimeout:(fn,ms)=>{timers.push({fn,ms});return 0;},confirm:()=>false,
    document:{getElementById:el,createElement:()=>new Element(),body:new Element()},
    URL:{createObjectURL:blob=>{calls.push(['blob',blob]);return '';},revokeObjectURL:()=>{}},
    fetch:()=>{throw Error('Network forbidden in this regression');},
    $:el,slicerRaw:null,slicerTr:{rx:0,rz:0,scale:1},slicerOut:null,
    slicerBudget:0,slicerFileName:'',slicerFileBytes:0,slicerHome:false,
    slicerNoScale:false,slicerScaleBlocked:false,
    gl3dSupports:()=>{},slicerSupportFacts:()=>{},slicerLayerUI:()=>{},
    slicerButtons:()=>{},slicerRender:()=>calls.push(['render']),
    meshHealth,stlRead,
    studioStage:x=>calls.push(['stage',x]),studioGo:x=>calls.push(['go',x]),
    keycapUseSaved:id=>calls.push(['cap',id])
  };
  const engineImpl={detailBudget:()=>1000,
    autoOrient:()=>{calls.push(['autoOrient']);return {tr:{rx:90,rz:0,scale:1}};},
    place:(p,tr)=>{calls.push(['place']);const out=new Float32Array(p);
      if(tr.rx===90)for(let i=0;i<p.length;i+=3){out[i]=p[i+2];out[i+2]=p[i];}
      if(tr.scale)for(let i=0;i<out.length;i++)out[i]*=tr.scale;
      return out;
    }
  };
  ctx.slicerMod=engine?engineImpl:null;
  ctx.slicerLoadMod=()=>{calls.push(['engine']);ctx.slicerMod=engineImpl;return Promise.resolve();};
  if(store)ctx.keycapLibrary={MAX:60,
    save:rec=>{calls.push(['save',rec]);const saved={...rec,id:'model-'+(++seq),triangles:rec.positions.length/9};records.set(saved.id,saved);return Promise.resolve(saved);},
    get:id=>{calls.push(['get',id]);return Promise.resolve(records.get(id));},
    list:()=>Promise.resolve([...records.values()])
  };
  ctx.meshy={hasKey:()=>false,intoSlicer:(buf,name)=>{
    calls.push(['glb',name]);const p=triangle();
    if(!ctx.slicerLoadMesh(p,name+'.glb',buf.byteLength))throw Error('GLB load refused');
    return {positions:p,health:meshHealth(p),parsed:{positions:p}};
  }};
  ctx.window=ctx;
  vm.createContext(ctx);
  vm.runInContext(loader,ctx,{filename:'slicer.js:actual-loader'});
  vm.runInContext(source('meshy-ui.js'),ctx,{filename:'meshy-ui.js'});
  vm.runInContext(source('studio-library.js'),ctx,{filename:'studio-library.js'});
  async function importFile(name,buffer=stl()) {
    const f={name,size:buffer.byteLength,arrayBuffer:()=>Promise.resolve(buffer)};
    await el('meshyFile').listeners.change({target:{files:[f]}});
  }
  return {ctx,calls,records,el,importFile,timers};
}
const plain=x=>JSON.parse(JSON.stringify(x));
let passed=0;
async function test(name,fn){await fn();console.log('OK '+name);passed++;}
await test('STL import saves exactly once, preserves the full name, and records posed millimetres',async()=>{
  const f=fixture(),name='Miniature with a name longer than forty-eight characters 01.stl';
  await f.importFile(name);
  assert.equal(f.calls.filter(c=>c[0]==='save').length,1);
  const r=[...f.records.values()][0];
  assert.equal(r.name,name.slice(0,-4));assert.equal(r.kind,'model');assert.equal(r.prompt,'');
  assert.deepEqual(plain(r.facts.sizeMm),[0,20,12]);
  assert.notEqual(r.positions,f.ctx.slicerRaw);
  const kept=Array.from(r.positions);f.ctx.slicerRaw[0]=999;
  assert.deepEqual(Array.from(r.positions),kept,'save snapshot does not share editable geometry');
  assert.match(f.el('meshyInfo').textContent,/kept in the Library/);
});
await test('GLB import saves exactly once after the model loader succeeds',async()=>{
  const f=fixture();await f.importFile('Dragon.glb',new ArrayBuffer(12));
  assert.equal(f.calls.filter(c=>c[0]==='glb').length,1);
  assert.equal(f.calls.filter(c=>c[0]==='save').length,1);
  assert.equal([...f.records.values()][0].name,'Dragon');
});
await test('a rejected STL adds no Library record and leaves the current model usable',async()=>{
  const f=fixture();await f.importFile('Good.stl');const old=f.ctx.slicerRaw;
  await f.importFile('Broken.stl',stl(new Float32Array(9)));
  assert.equal(f.records.size,1);assert.equal(f.ctx.slicerRaw,old);
  assert.equal(f.el('meshyExport').disabled,false);
  assert.match(f.el('meshyInfo').textContent,/usable|area|degenerate/i);
});
await test('a failed GLB does not save or discard the previous export',async()=>{
  const f=fixture();await f.importFile('Good.stl');const old=f.ctx.slicerRaw;
  f.ctx.meshy.intoSlicer=()=>{throw Error('Malformed GLB');};
  await f.importFile('Broken.glb',new ArrayBuffer(12));
  assert.equal(f.records.size,1);assert.equal(f.ctx.slicerRaw,old);
  assert.equal(f.el('meshyExport').disabled,false);
  assert.equal(f.el('meshyInfo').textContent,'Malformed GLB');
});
await test('engine failure never saves an imported model',async()=>{
  const f=fixture({engine:false});f.ctx.slicerLoadMod=()=>Promise.reject(Error('unavailable'));
  await f.importFile('Mini.stl');assert.equal(f.records.size,0);
  assert.match(f.el('meshyInfo').textContent,/engine/i);
});
await test('save completion is awaited before enabling import again',async()=>{
  const f=fixture();let finish;
  f.ctx.keycapLibrary.save=()=>new Promise(resolve=>{finish=resolve;});
  const importing=f.importFile('Mini.stl');
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(f.el('meshyFile').disabled,true);assert.equal(typeof finish,'function');
  assert.doesNotMatch(f.el('meshyInfo').textContent,/kept in the Library/);
  finish({id:'saved'});await importing;assert.equal(f.el('meshyFile').disabled,false);
});
for(const sync of [false,true])await test((sync?'synchronous':'asynchronous')+' save failure is visible without losing the loaded model',async()=>{
  const f=fixture();f.ctx.keycapLibrary.save=()=>{if(sync)throw Error('quota');return Promise.reject(Error('quota'));};
  await f.importFile('Mini.stl');assert.ok(f.ctx.slicerRaw);assert.equal(f.records.size,0);
  assert.equal(f.el('meshyExport').disabled,false);
  assert.match(f.el('meshyInfo').textContent,/could not be confirmed.*quota.*Export/);
  assert.equal(f.el('meshyInfo').style.color,'var(--warncol)');
});
await test('missing Library is reported instead of silently claiming a saved import',async()=>{
  const f=fixture({store:false});await f.importFile('Mini.stl');
  assert.match(f.el('meshyInfo').textContent,/Library is unavailable.*Export/);
  assert.ok(f.ctx.slicerRaw);
});
await test('GLB reference colours are saved as an independent copy with the posed geometry',async()=>{
  const f=fixture(),colors=new Float32Array([1,0,0, 0,1,0, 0,0,1]);
  f.ctx.keycapColor={fromGLB:async parsed=>{assert.equal(parsed.positions.length,9);return {colors,kind:'vertex'};}};
  await f.importFile('Painted.glb',new ArrayBuffer(12));
  const saved=[...f.records.values()][0];
  assert.equal(saved.sourceColorKind,'vertex');
  assert.deepEqual(Array.from(saved.sourceColors),Array.from(colors));
  colors.fill(0);assert.notEqual(saved.sourceColors[0],0);
});
await test('a failed optional colour decoder does not lose the usable model or block Library save',async()=>{
  const f=fixture();f.ctx.keycapColor={fromGLB:async()=>{throw Error('inert colour failure');}};
  await f.importFile('Geometry.glb',new ArrayBuffer(12));
  assert.equal(f.records.size,1);assert.equal([...f.records.values()][0].sourceColors,null);
  assert.match(f.el('meshyInfo').textContent,/kept in the Library/);
});
for(const result of [null,undefined,{}])await test('an import cannot claim a saved Library record when save resolves '+JSON.stringify(result),async()=>{
  const f=fixture();f.ctx.keycapLibrary.save=()=>Promise.resolve(result);
  await f.importFile('Mini.stl');
  assert.match(f.el('meshyInfo').textContent,/could not be confirmed.*no saved record.*Export/);
  assert.equal(f.el('meshyInfo').style.color,'var(--warncol)');
  assert.ok(f.ctx.slicerRaw);assert.equal(f.el('meshyExport').disabled,false);
});
await test('model STL export includes the current preview orientation and scale without mutating its source',async()=>{
  const f=fixture();await f.importFile('Mini.stl');
  const original=Array.from(f.ctx.slicerRaw);f.ctx.slicerTr.scale=2;
  f.el('meshyExport').click();
  const blob=f.calls.filter(c=>c[0]==='blob').at(-1)[1];
  const exported=stlRead.readSTL(await blob.arrayBuffer()).positions;
  assert.deepEqual(Array.from(exported),[0,0,0, 0,0,24, 0,40,0]);
  assert.deepEqual(Array.from(f.ctx.slicerRaw),original);
});
await test('model export does not adopt another tool\'s unrelated slicer transform',async()=>{
  const f=fixture();await f.importFile('Mini.stl');
  f.ctx.slicerRaw=new Float32Array(triangle());f.ctx.slicerTr.scale=10;
  f.el('meshyExport').click();
  const blob=f.calls.filter(c=>c[0]==='blob').at(-1)[1];
  const exported=stlRead.readSTL(await blob.arrayBuffer()).positions;
  assert.deepEqual(Array.from(exported),Array.from(triangle()));
});
await test('repeated model Open uses the exact saved mesh in Models, without scale, generation, cap conversion or another save',async()=>{
  const f=fixture();await f.importFile('Mini.stl');const r=[...f.records.values()][0],before=JSON.stringify(r);
  f.calls.length=0;f.ctx.slicerMod=null;
  for(let i=0;i<3;i++){
    assert.equal(await f.ctx.studioLibrary.open(r.id),true);
    assert.notEqual(f.ctx.slicerRaw,r.positions);
    assert.deepEqual(Array.from(f.ctx.slicerRaw),Array.from(r.positions));
    assert.deepEqual(plain(f.ctx.slicerTr),{rx:0,rz:0,scale:1});
    assert.equal(f.ctx.slicerNoScale,true);
    f.ctx.slicerRaw[0]=888; // editing an opened copy must not alter the record
  }
  assert.equal(JSON.stringify(r),before);
  assert.equal(f.calls.filter(c=>c[0]==='engine').length,1);
  assert.equal(f.calls.filter(c=>c[0]==='stage'&&c[1]==='model').length,3);
  assert.equal(f.calls.filter(c=>c[0]==='go'&&c[1]==='create').length,3);
  assert.equal(f.calls.some(c=>['cap','autoOrient','glb','save'].includes(c[0])),false);
  assert.equal(f.el('meshyRefine').disabled,true);assert.equal(f.el('meshyExport').disabled,false);
});
for(const kind of ['sculpt','keycap',undefined])await test('existing '+(kind||'legacy')+' designs still use the keycap restore path',async()=>{
  const f=fixture();f.records.set('cap',{id:'cap',kind,positions:triangle()});
  assert.equal(await f.ctx.studioLibrary.open('cap'),true);
  assert.deepEqual(f.calls.filter(c=>c[0]==='cap'),[['cap','cap']]);
  assert.deepEqual(f.calls.filter(c=>c[0]==='stage'),[['stage','cap']]);
  assert.equal(f.ctx.slicerRaw,null);
});
await test('failed saved-model load keeps the current workspace and reports the error',async()=>{
  const f=fixture();f.records.set('bad',{id:'bad',kind:'model',positions:new Float32Array(9)});
  assert.equal(await f.ctx.studioLibrary.open('bad'),false);
  assert.equal(f.calls.some(c=>['cap','stage','go','save'].includes(c[0])),false);
  assert.match(f.el('stLibNote').textContent,/no usable geometry/);
});
await test('failed saved-model engine load does not switch tools',async()=>{
  const f=fixture({engine:false});f.records.set('m',{id:'m',kind:'model',positions:triangle()});
  f.ctx.slicerLoadMod=()=>Promise.reject(Error('engine offline'));
  assert.equal(await f.ctx.studioLibrary.open('m'),false);
  assert.equal(f.calls.some(c=>['cap','stage','go','save'].includes(c[0])),false);
  assert.equal(f.el('stLibNote').textContent,'engine offline');
});
for(const extension of ['stl','glb'])await test('a late '+extension.toUpperCase()+' file read cannot overwrite a newer Library model',async()=>{
  const f=fixture();await f.importFile('Library model.stl');const saved=[...f.records.values()][0];let release;
  const file={name:'Older pending file.'+extension,size:100,arrayBuffer:()=>new Promise(resolve=>{release=resolve;})};
  const loading=f.el('meshyFile').listeners.change({target:{files:[file]}});await Promise.resolve();
  assert.equal(await f.ctx.studioLibrary.open(saved.id),true);const chosen=f.ctx.slicerRaw;f.calls.length=0;
  release(extension==='stl'?stl():new ArrayBuffer(12));await loading;
  assert.equal(f.ctx.slicerRaw,chosen);assert.equal(f.calls.some(c=>c[0]==='save'||c[0]==='glb'),false);assert.equal(f.records.size,1);
  assert.equal(f.el('meshyExport').disabled,false);
});
await test('a slow Library read cannot replace a newer file or save it under the older name',async()=>{
  const f=fixture();await f.importFile('Old library.stl');const saved=[...f.records.values()][0];let release;
  f.ctx.keycapLibrary.get=()=>new Promise(resolve=>{release=()=>resolve(saved);});
  const opening=f.ctx.studioLibrary.open(saved.id);await Promise.resolve();
  await f.importFile('New file.stl',stl(new Float32Array([0,0,0, 4,0,0, 0,5,0])));const chosen=f.ctx.slicerRaw;
  release();assert.equal(await opening,false);assert.equal(f.ctx.slicerRaw,chosen);assert.equal([...f.records.values()].at(-1).name,'New file');
  assert.equal(f.records.size,2);assert.match(f.el('stLibNote').textContent,/Another model was selected.*saved copy is unchanged/);
});
await test('a save finishing after another Library choice keeps the captured record without claiming the current model was saved',async()=>{
  const f=fixture();await f.importFile('Library choice.stl');const original=[...f.records.values()][0],save=f.ctx.keycapLibrary.save;let finish;
  f.ctx.keycapLibrary.save=rec=>new Promise(resolve=>{finish=()=>save(rec).then(resolve);});
  const importing=f.importFile('Still saving.stl');await new Promise(resolve=>setImmediate(resolve));
  await f.ctx.studioLibrary.open(original.id);const currentInfo=f.el('meshyInfo').textContent;const chosen=f.ctx.slicerRaw;
  finish();await importing;assert.equal(f.ctx.slicerRaw,chosen);assert.equal(f.el('meshyInfo').textContent,currentInfo);assert.equal([...f.records.values()].at(-1).name,'Still saving');
});
await test('Library model cards show stored millimetres and model-specific restore details without mutating facts',async()=>{
  const f=fixture(),facts={sizeMm:[12,20,33],resinMl:1.25};
  f.records.set('m',{id:'m',kind:'model',name:'Mini',triangles:1,facts});
  Object.freeze(facts.sizeMm);Object.freeze(facts);
  f.ctx.studioLibrary.draw();await new Promise(resolve=>setImmediate(resolve));
  const all=[];function walk(e){all.push(e);e.children.forEach(walk);}walk(f.el('stLibrary'));
  assert.ok(all.some(e=>e.textContent==='12.0 × 20.0 × 33.0 mm'));
  assert.ok(all.some(e=>/saved model dimensions in millimetres/.test(e.title||'')));
  assert.ok(all.some(e=>/Opens the saved model in Models/.test(e.title||'')));
  assert.equal(all.some(e=>/finished cap/.test(e.title||'')),false);
});

function generationSetup(f, {textured=false}={}) {
  const acks=[],downloads=[],submitted=[];let savedTask=null;
  const state={glb:new ArrayBuffer(24),prompt:'Cute saved puppy',previewId:'preview-inert',deliveryId:textured?'texture-inert':'preview-inert',
    refineId:textured?'texture-inert':null,opts:{from:'model',heightMm:27,flatBase:true},task:{model_urls:{}}};
  f.ctx.meshy.hasKey=()=>true;
  f.ctx.meshy.pending=()=>savedTask;
  f.ctx.meshy.acknowledge=id=>{acks.push(id);if(savedTask?.id===id){savedTask=null;return true;}return false;};
  f.ctx.meshy.generate=async(prompt,opts)=>{submitted.push({prompt,opts});savedTask={id:state.deliveryId,from:'model'};return state;};
  f.ctx.meshy.resume=async()=>state;
  f.ctx.meshy.generateTexture=async()=>{savedTask={id:'texture-inert',from:'model'};return {...state,refineId:'texture-inert',deliveryId:'texture-inert'};};
  f.ctx.meshy.textureUrl=()=>null;
  const create=f.ctx.document.createElement;
  f.ctx.document.createElement=tag=>{const element=create(tag);if(tag==='a')element.click=()=>{if(f.failDownload)throw Error('download refused');downloads.push(element.download);};return element;};
  f.el('meshyPrompt').value='Cute saved puppy';f.el('meshyHeight').value='27';f.el('meshyFlat').checked=true;f.el('meshyPoly').value='100000';
  return {acks,downloads,submitted,state,pending:()=>savedTask,seed:(from='model')=>{savedTask={id:state.deliveryId,from};}};
}
await test('a generated model is saved under Models and acknowledged only after Library commit',async()=>{
  const f=fixture(),g=generationSetup(f);let finish;f.ctx.keycapLibrary.save=rec=>new Promise(resolve=>{finish=()=>resolve({...rec,id:'saved-model'});});
  const work=f.el('meshyGo').click();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(g.acks.length,0);assert.ok(g.pending());assert.equal(f.el('meshyGo').disabled,true);
  assert.equal(g.submitted[0].opts.from,'model');assert.equal(g.submitted[0].opts.heightMm,27);assert.equal(g.submitted[0].opts.flatBase,true);
  finish();await work;assert.deepEqual(g.acks,['preview-inert']);assert.equal(g.pending(),null);assert.equal(f.el('meshyGo').disabled,false);
});
await test('generation save failure keeps the task available instead of acknowledging a null record',async()=>{
  const f=fixture(),g=generationSetup(f);f.ctx.keycapLibrary.save=()=>Promise.reject(Error('storage full'));
  await f.el('meshyGo').click();assert.equal(g.acks.length,0);assert.ok(g.pending());assert.match(f.el('meshyInfo').textContent,/storage full/);
});
await test('generation cannot show save success or acknowledge a Library result without an id',async()=>{
  const f=fixture(),g=generationSetup(f);f.ctx.keycapLibrary.save=()=>Promise.resolve({});
  await f.el('meshyGo').click();assert.equal(g.acks.length,0);assert.ok(g.pending());
  assert.match(f.el('meshyInfo').textContent,/could not be confirmed.*no saved record/);
  assert.doesNotMatch(f.el('meshyInfo').textContent,/kept in the Library/);
});
await test('opening a different model during colour decoding cannot save it under the generated name or acknowledge the paid task',async()=>{
  const f=fixture(),g=generationSetup(f);let finish;
  f.ctx.keycapColor={fromGLB:()=>new Promise(resolve=>{finish=resolve;})};
  const work=f.el('meshyGo').click();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(typeof finish,'function');
  const opened=new Float32Array([0,0,0, 4,0,0, 0,4,0]);
  f.ctx.slicerRaw=opened;f.ctx.meshyModelOpened('Opened model',opened,{});
  finish({colors:new Float32Array(9),kind:'vertex'});await work;
  assert.equal(f.ctx.slicerRaw,opened);assert.equal(f.records.size,0);
  assert.equal(g.acks.length,0);assert.ok(g.pending());
  assert.match(f.el('meshyInfo').textContent,/Another model was opened.*task is kept for recovery/);
});
await test('a generated model completing after a Library choice preserves that choice and paid recovery',async()=>{
  const f=fixture(),g=generationSetup(f);let release;
  f.ctx.meshy.generate=()=>new Promise(resolve=>{g.seed();release=()=>resolve(g.state);});
  const generating=f.el('meshyGo').click();await Promise.resolve();
  const chosen=new Float32Array([0,0,0, 2,0,0, 0,3,0]);f.ctx.slicerRaw=chosen;f.ctx.meshyModelOpened('Chosen library model',chosen,{});
  release();await generating;assert.equal(f.ctx.slicerRaw,chosen);assert.equal(f.records.size,0);assert.equal(g.acks.length,0);assert.ok(g.pending());
});
await test('a saved geometry record does not discard recovery for its paid texture asset',async()=>{
  const f=fixture(),g=generationSetup(f,{textured:true});await f.el('meshyGo').click();
  assert.equal(g.acks.length,0);assert.ok(g.pending());assert.match(f.el('meshyInfo').textContent,/Export the GLB.*texture/);
  f.el('meshyExport').click();assert.deepEqual(g.downloads,['Cutesavedpuppy.glb','Cutesavedpuppy.stl']);assert.deepEqual(g.acks,['texture-inert']);assert.equal(g.pending(),null);
  assert.match(f.el('meshyInfo').textContent,/downloads started/);
});
await test('a refused GLB download never acknowledges or discards the textured task',async()=>{
  const f=fixture(),g=generationSetup(f,{textured:true});await f.el('meshyGo').click();f.failDownload=true;
  f.el('meshyExport').click();assert.equal(g.acks.length,0);assert.ok(g.pending());assert.match(f.el('meshyInfo').textContent,/download refused/);
});
await test('Models recovers only its own pending model without paying for another or switching to keycaps',async()=>{
  const f=fixture(),g=generationSetup(f);g.seed();f.ctx.confirm=()=>true;
  await f.el('meshyGo').click();assert.equal(g.submitted.length,0);assert.deepEqual(g.acks,['preview-inert']);assert.equal(g.pending(),null);
  assert.equal(f.calls.some(c=>c[0]==='cap'),false);
});
await test('startup recovery does not replace a model already chosen in Library',async()=>{
  const f=fixture(),g=generationSetup(f);g.seed();let resumed=0;f.ctx.meshy.resume=async()=>{resumed++;return g.state;};
  const selected=triangle();f.ctx.slicerRaw=selected;f.ctx.meshyModelOpened('My selected model',selected,{});
  const startup=f.timers.find(t=>t.ms===1500);assert.ok(startup);startup.fn();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(resumed,0);assert.equal(f.ctx.slicerRaw,selected);assert.ok(g.pending());assert.equal(g.acks.length,0);
});
await test('untouched startup still recovers the pending model without a paid request',async()=>{
  const f=fixture(),g=generationSetup(f);g.seed();let resumed=0;f.ctx.meshy.resume=async()=>{resumed++;return g.state;};
  f.timers.find(t=>t.ms===1500).fn();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(resumed,1);assert.equal(g.submitted.length,0);assert.equal(g.pending(),null);assert.equal(f.records.size,1);
});
await test('Models will not claim a pending keycap or invoke a paid request over it',async()=>{
  const f=fixture(),g=generationSetup(f);g.seed('keycap');f.ctx.confirm=()=>true;
  await f.el('meshyGo').click();assert.equal(g.submitted.length,0);assert.equal(g.acks.length,0);assert.ok(g.pending());
  assert.match(f.el('meshyInfo').textContent,/keycap editor/);
});
await test('exporting geometry-only Library contents cannot acknowledge an unrelated task',async()=>{
  const f=fixture(),g=generationSetup(f);g.seed();await f.importFile('geometry.stl');f.el('meshyExport').click();
  assert.equal(g.acks.length,0);assert.ok(g.pending());assert.equal(g.downloads.length,1);assert.match(g.downloads[0],/\.stl$/);
  assert.match(f.el('meshyInfo').textContent,/geometry only/);
});

console.log(passed+' model Library regression groups passed; no printer or network access.');
