/* Real Topper handlers and geometry, inert Meshy adapter. Never sends requests. */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const read=n=>fs.readFileSync(path.join(__dirname,'../../web/parts',n),'utf8');
const topper=require('../../web/parts/topper.js'),sculpt=require('../../web/parts/keycap-sculpt.js');
const {meshHealth}=require('../../web/parts/mesh-health.js');
function cube(){const v=[[-2,-2,0],[2,-2,0],[2,2,0],[-2,2,0],[-2,-2,4],[2,-2,4],[2,2,4],[-2,2,4]],p=[];
  for(const q of [[0,3,2,1],[4,5,6,7],[0,1,5,4],[1,2,6,5],[2,3,7,6],[3,0,4,7]])for(const i of [q[0],q[1],q[2],q[0],q[2],q[3]])p.push(...v[i]);return new Float32Array(p);}
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
function fixture(options={}){
  const els=new Map(),calls=[],timers=[],storage=new Map(),saved=new Map();let task=options.pending||null,serial=0;
  const state={key:true,badSeat:false,saveFail:false,hold:null,confirm:false,parseFail:false};
  for(const m of read('topper-card.html').matchAll(/<(?:input|select|button|canvas|p|output|section|label)\b[^>]*\bid=['"]([^'"]+)['"][^>]*>/g)){
    const value=/\bvalue=['"]([^'"]*)['"]/.exec(m[0]);els.set(m[1],{value:value?value[1]:'',textContent:'',hidden:false,disabled:false,className:'',style:{},listeners:{},addEventListener(t,f){this.listeners[t]=f;}});}
  const el=id=>{assert.ok(els.has(id),'Missing HTML '+id);return els.get(id);};el('tpPreset').value='pencil-round';el('tpShape').value='round';el('tpPrompt').value='A kitten hugging a strawberry';
  const ctx={Promise,Math,Number,Date,JSON,Float32Array,ArrayBuffer,DataView,Blob,console,
    document:{getElementById:el},localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},
    setTimeout:fn=>timers.push(fn),setInterval:()=>0,confirm:q=>{calls.push(['confirm',q]);return state.confirm;},fetch(){throw Error('No network allowed');},
    topper,meshHealth,keycapSculpt:{seat:sculpt.seat,check:p=>state.badSeat?{ok:false,issues:['Sculpt attachment needs adjustment.']}:sculpt.check(p)},
    keycapView3d:{attach:()=>({setMesh:p=>calls.push(['preview',p])})},designerFeedback:{notice:m=>calls.push(['notice',m])},
    keycapLibrary:{save:async r=>{calls.push(['save',r]);if(state.saveFail)throw Error('storage full');if(state.saveHold)await state.saveHold;
      const rec=structuredClone({...r,id:r.id||'manual-'+(++serial)});saved.set(rec.id,rec);return rec;}},
    meshyParseGLB:()=>{if(state.parseFail)throw Error('Damaged model');return {positions:cube()};},
    stlRead:{readModelFile:buf=>({positions:buf})},
    meshy:{hasKey:()=>state.key,pending:()=>task,
      generate:async(prompt,opts,ui)=>{calls.push(['generate',prompt,opts]);task={id:'task-'+(++serial),from:opts.from,topperRecipe:opts.topperRecipe};if(state.hold)await state.hold;return {glb:new ArrayBuffer(1),deliveryId:task.id,opts,topperRecipe:opts.topperRecipe};},
      resume:async()=>{calls.push(['resume']);return {glb:new ArrayBuffer(1),deliveryId:task.id,topperRecipe:task.topperRecipe};},
      acknowledge:id=>{calls.push(['ack',id]);if(!task||task.id!==id)return false;task=null;return true;},
      forgetPending:id=>{calls.push(['forget',id]);if(!task||task.id!==id)return false;task=null;return true;}}
  };if(options.indexedDB)ctx.indexedDB=options.indexedDB;ctx.window=ctx;vm.createContext(ctx);vm.runInContext(read('topper-ui.js'),ctx);
  return {ctx,state,calls,saved,el,task:()=>task,seed:t=>{task=t;ctx.topperRefresh();},
    click:async id=>el(id).listeners.click(),change:async(id,v)=>{el(id).value=v;await (el(id).listeners.change||el(id).listeners.input)({target:el(id)});},
    recipe:()=>({version:1,fields:Object.fromEntries(['tpPreset','tpModel','tpShape','tpWidth','tpSecondWidth','tpDepth','tpWall','tpFit','tpArtHeight','tpArtRotation','tpPrompt'].map(id=>[id,el(id).value]))}),
    boot:async()=>{for(const fn of timers)await fn();await new Promise(setImmediate);},count:k=>calls.filter(c=>c[0]===k).length};
}
const tick=()=>new Promise(setImmediate);let passed=0;async function test(name,fn){await fn();passed++;console.log('OK '+name);}
(async()=>{
  await test('opening the topper never starts a paid request',async()=>{const f=fixture();await f.boot();assert.equal(f.count('generate'),0);assert.equal(f.count('resume'),0);});
  await test('button creates decoration with correct owner and complete captured fit recipe',async()=>{const f=fixture();await f.change('tpShape','hex');await f.change('tpWidth','8');await f.change('tpFit','.3');await f.click('tpGenerate');
    const g=f.calls.find(c=>c[0]==='generate');assert.equal(g[2].polycount,100000);assert.equal(g[2].refine,false);assert.equal(g[2].ultra,false);assert.equal(g[2].from,'topper');assert.ok(g[1].length<=800);assert.match(g[1],/no socket/);
    const recipe=JSON.parse(g[2].topperRecipe);assert.equal(recipe.fields.tpShape,'hex');assert.equal(recipe.fields.tpWidth,'8');assert.equal(recipe.fields.tpFit,'.3');assert.equal(recipe.fields.tpPrompt,f.el('tpPrompt').value);});
  await test('one Library row contains exact fitted geometry and original editable artwork before acknowledgement',async()=>{const f=fixture();await f.click('tpGenerate');assert.equal(f.saved.size,1);const r=[...f.saved.values()][0];
    assert.equal(r.kind,'model');assert.equal(r.facts.sourceTool,'topper');assert.deepEqual(r.topperSource,cube());assert.equal(r.topperRecipe.fields.tpWidth,'7');
    const base=topper.build(r.facts.topper);assert.ok(r.positions.length>base.positions.length);for(let i=0;i<base.positions.length;i++)assert.ok(Math.abs(r.positions[i]-base.positions[i])<1e-5,'exact socket vertex'+i);
    assert.ok(f.calls.findIndex(c=>c[0]==='save')<f.calls.findIndex(c=>c[0]==='ack'));assert.equal(f.task(),null);});
  await test('missing key and invalid dimensions do not submit or lose the prior topper',async()=>{const f=fixture();f.state.key=false;await f.click('tpGenerate');assert.equal(f.count('generate'),0);assert.match(f.el('tpGenState').textContent,/API key/);
    f.state.key=true;await f.change('tpWidth','');await f.click('tpGenerate');assert.equal(f.count('generate'),0);});
  await test('keycap and model pending tasks cannot be claimed by topper',async()=>{for(const from of ['keycap','model',null]){const f=fixture();f.seed({id:'other',from});await f.boot();assert.equal(f.el('tpGenerate').disabled,true);await f.click('tpGenerate');assert.equal(f.count('generate'),0);assert.equal(f.count('resume'),0);assert.equal(f.task().id,'other');}});
  await test('resuming a saved task restores the originally captured shape, fit and prompt without payment',async()=>{const f=fixture(),r=f.recipe();r.fields.tpShape='hex';r.fields.tpWidth='8';r.fields.tpFit='.4';r.fields.tpPrompt='Saved chubby rabbit';
    f.seed({id:'old',from:'topper',topperRecipe:JSON.stringify(r)});await f.boot();assert.equal(f.count('generate'),0);assert.equal(f.count('resume'),1);
    const saved=[...f.saved.values()][0];assert.equal(saved.topperRecipe.fields.tpWidth,'8');assert.equal(saved.facts.topper.socketShape,'hex');assert.equal(saved.facts.topper.clearanceMm,.4);assert.equal(f.el('tpPrompt').value,'Saved chubby rabbit');});
  await test('a changed editor during generation keeps the newer editor while saving captured product',async()=>{const f=fixture(),d=deferred();f.state.hold=d.promise;const generating=f.click('tpGenerate');await tick();await f.change('tpWidth','9');d.resolve();await generating;
    assert.equal(f.el('tpWidth').value,'9');assert.equal([...f.saved.values()][0].topperRecipe.fields.tpWidth,'7');assert.match(f.el('tpGenState').textContent,/newer editor changes/);});
  await test('save failure retains recovery and retries locally without another generation',async()=>{const f=fixture();f.state.saveFail=true;await f.click('tpGenerate');assert.equal(f.saved.size,0);assert.equal(f.count('ack'),0);assert.ok(f.task());assert.match(f.el('tpGenState').textContent,/storage full/);
    f.state.saveFail=false;await f.click('tpSave');assert.equal(f.count('generate'),1);assert.equal(f.count('resume'),0);assert.equal(f.saved.size,1);assert.equal(f.task(),null);});
  await test('bad assembly preserves the prior sculpt and allows a local fit retry',async()=>{const f=fixture();await f.click('tpGenerate');const name=f.el('tpArtName').textContent;f.state.confirm=true;f.state.badSeat=true;await f.change('tpPrompt','New flower');await f.click('tpGenerate');
    assert.equal(f.el('tpArtName').textContent,name);assert.equal(f.saved.size,1);assert.ok(f.task());assert.match(f.el('tpGenState').textContent,/attachment.*Save to Library/);
    f.state.badSeat=false;await f.change('tpArtHeight','10');await f.click('tpSave');assert.equal(f.saved.size,2);assert.equal(f.count('generate'),2);assert.equal(f.task(),null);assert.equal(f.el('tpArtName').textContent,'New flower');});
  await test('Clear after a failed generated assembly saves the visible plain socket and retains recoverable artwork',async()=>{
    const f=fixture();await f.click('tpGenerate');f.state.confirm=true;f.state.badSeat=true;await f.change('tpPrompt','Failed new flower');await f.click('tpGenerate');const task=f.task().id;
    f.state.badSeat=false;await f.click('tpClearArt');await f.click('tpSave');
    const rec=[...f.saved.values()].at(-1);assert.equal(rec.topperSource,null);assert.match(f.el('tpArtName').textContent,/Plain socket/);assert.equal(f.task().id,task);assert.equal(f.count('ack'),1);
    assert.deepEqual(Array.from(rec.positions),Array.from(topper.build(rec.facts.topper).positions));
    await f.click('tpRecover');assert.equal(f.task(),null);assert.equal(f.el('tpArtName').textContent,'Failed new flower');assert.equal(f.count('generate'),2);assert.equal(f.count('resume'),0);
  });
  await test('a successful new import detaches a failed generated candidate from Save',async()=>{
    const f=fixture();f.state.saveFail=true;await f.click('tpGenerate');const task=f.task().id;f.state.saveFail=false;
    const imported=cube();for(let i=0;i<imported.length;i+=3)imported[i]*=.7;
    await f.el('tpArtFile').listeners.change({target:{files:[{name:'my-new-source.stl',size:100,arrayBuffer:async()=>imported}],value:'file'}});await f.click('tpSave');
    assert.deepEqual([...f.saved.values()][0].topperSource,imported);assert.equal(f.el('tpArtName').textContent,'my-new-source.stl');assert.equal(f.task().id,task);assert.equal(f.count('ack'),0);
  });
  await test('Library selection after failed generation keeps its chosen source and fit when saved',async()=>{
    const f=fixture();await f.change('tpWidth','8');await f.click('tpGenerate');const original=[...f.saved.values()][0];
    f.state.confirm=true;f.state.saveFail=true;await f.change('tpWidth','9');await f.change('tpPrompt','Unfinished flower');await f.click('tpGenerate');const task=f.task().id;f.state.saveFail=false;
    f.ctx.topperUseSaved(original);await f.click('tpSave');const saved=[...f.saved.values()].at(-1);
    assert.equal(saved.topperRecipe.fields.tpWidth,'8');assert.equal(saved.topperRecipe.fields.tpPrompt,original.topperRecipe.fields.tpPrompt);assert.deepEqual(saved.positions,original.positions);assert.equal(f.task().id,task);
  });
  await test('damaged downloaded geometry never overwrites the current model or acknowledges',async()=>{const f=fixture();f.state.parseFail=true;await f.click('tpGenerate');assert.equal(f.saved.size,0);assert.equal(f.count('ack'),0);assert.ok(f.task());assert.match(f.el('tpGenState').textContent,/Damaged model/);});
  await test('duplicate generate clicks cannot spend twice',async()=>{const f=fixture(),d=deferred();f.state.hold=d.promise;const p=f.click('tpGenerate');await tick();await f.click('tpGenerate');assert.equal(f.count('generate'),1);d.resolve();await p;});
  await test('regenerate cancellation never spends or drops an existing task',async()=>{const f=fixture();const r=f.recipe();f.seed({id:'old',from:'topper',topperRecipe:JSON.stringify(r)});f.state.confirm=false;await f.click('tpGenerate');assert.equal(f.count('generate'),0);assert.equal(f.count('forget'),0);assert.equal(f.task().id,'old');});
  await test('double-clicking while regeneration confirmation is open creates only one modal and request',async()=>{const f=fixture();await f.click('tpGenerate');const d=deferred();let dialogs=0;f.ctx.uiConfirm=()=>{dialogs++;return d.promise;};
    const first=f.click('tpGenerate');await tick();await f.click('tpGenerate');assert.equal(dialogs,1);assert.equal(f.el('tpGenerate').disabled,true);d.resolve(true);await first;assert.equal(f.count('generate'),2);});
  await test('explicit regeneration confirmation replaces only the intended pending task',async()=>{const f=fixture();f.seed({id:'old',from:'topper',topperRecipe:JSON.stringify(f.recipe())});f.state.confirm=true;await f.click('tpGenerate');
    assert.equal(f.count('confirm'),1);assert.equal(f.count('forget'),1);assert.equal(f.count('generate'),1);assert.equal(f.saved.size,1);});
  await test('Library reopening rebuilds the same topper without generation and restores socket edits',async()=>{const f=fixture();await f.change('tpShape','hex');await f.change('tpWidth','8');await f.click('tpGenerate');const rec=[...f.saved.values()][0];await f.change('tpWidth','9');
    assert.equal(f.ctx.topperUseSaved(rec),true);assert.equal(f.el('tpWidth').value,'8');assert.equal(f.el('tpShape').value,'hex');await f.click('tpSave');
    const last=f.calls.filter(c=>c[0]==='save').at(-1)[1];assert.deepEqual(Array.from(last.positions),Array.from(rec.positions));assert.equal(f.count('generate'),1);});
  await test('unconfirmed Library save cannot lose the paid task',async()=>{const f=fixture();f.ctx.keycapLibrary.save=async()=>null;await f.click('tpGenerate');assert.equal(f.count('ack'),0);assert.ok(f.task());assert.match(f.el('tpGenState').textContent,/did not confirm/);});
  await test('reload finishes a downloaded draft candidate locally with the captured socket and no Meshy request',async()=>{
    const r=fixture().recipe();r.fields.tpShape='hex';r.fields.tpWidth='8';r.fields.tpFit='.3';let current={version:1,fields:r.fields,art:null,artName:'',pendingGenerated:{recipe:r,positions:cube(),deliveryId:'downloaded-task'}};
    const indexedDB={open(){const rq={};queueMicrotask(()=>{rq.result={close(){},transaction(name,mode){const tx={};tx.objectStore=()=>({
      get(){const get={};queueMicrotask(()=>{get.result=structuredClone(current);tx.oncomplete();});return get;},
      put(value){const snapshot=structuredClone(value);queueMicrotask(()=>{current=snapshot;tx.oncomplete();});}});return tx;}};rq.onsuccess();});return rq;}};
    const f=fixture({indexedDB,pending:{id:'downloaded-task',from:'topper',topperRecipe:JSON.stringify(r)}});await tick();await tick();
    assert.equal(f.count('generate'),0);assert.equal(f.count('resume'),0);assert.equal(f.saved.size,1);const rec=[...f.saved.values()][0];
    assert.equal(rec.facts.topper.socketShape,'hex');assert.equal(rec.facts.topper.diameterMm,8);assert.deepEqual(rec.topperSource,cube());assert.equal(f.task(),null);assert.equal(current.pendingGenerated,null);
  });
  await test('reload preserves an explicitly detached candidate without restoring it onto the current plain socket',async()=>{
    const r=fixture().recipe();let current={version:1,fields:r.fields,art:null,artName:'',pendingGenerated:{recipe:r,positions:cube(),deliveryId:'kept-task',active:false}};
    const indexedDB={open(){const rq={};queueMicrotask(()=>{rq.result={close(){},transaction(name,mode){const tx={};tx.objectStore=()=>({
      get(){const get={};queueMicrotask(()=>{get.result=structuredClone(current);tx.oncomplete();});return get;},
      put(value){const snapshot=structuredClone(value);queueMicrotask(()=>{current=snapshot;tx.oncomplete();});}});return tx;}};rq.onsuccess();});return rq;}};
    const f=fixture({indexedDB,pending:{id:'kept-task',from:'topper',topperRecipe:JSON.stringify(r)}});await tick();await tick();
    assert.equal(f.saved.size,0);assert.equal(f.count('resume'),0);assert.equal(f.count('generate'),0);assert.equal(f.task().id,'kept-task');assert.match(f.el('tpArtName').textContent,/Plain socket/);
    await f.click('tpSave');assert.equal([...f.saved.values()][0].topperSource,null);assert.equal(f.task().id,'kept-task');
    await f.click('tpRecover');assert.equal(f.task(),null);assert.equal(f.count('resume'),0);assert.equal(f.count('generate'),0);assert.deepEqual([...f.saved.values()].at(-1).topperSource,cube());
  });
  await test('actual Meshy client keeps topper recipe locally across reload, excluding it from service requests',async()=>{
    const storage=new Map(),requests=[],r=fixture().recipe(),encoded=JSON.stringify(r),apiURL='https://api.meshy.ai/openapi/v2/text-to-3d';
    function client(){const c={console,Promise,Date,setTimeout,localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},
      fetch:async(url,o={})=>{requests.push({url,method:o.method||'GET',body:o.body&&JSON.parse(o.body)});const reply=j=>({ok:true,status:200,text:async()=>JSON.stringify(j)});
        if(o.method==='POST')return reply({result:'topper-task-1'});
        if(url.startsWith(apiURL+'/'))return reply({id:'topper-task-1',status:'SUCCEEDED',progress:100,model_urls:{glb:'https://inert.invalid/topper.glb'}});
        if(url==='https://inert.invalid/topper.glb'){const b=new ArrayBuffer(24),v=new DataView(b);v.setUint32(0,0x46546c67,true);v.setUint32(4,2,true);v.setUint32(8,24,true);v.setUint32(12,4,true);v.setUint32(16,0x4e4f534a,true);new Uint8Array(b,20).set([123,125,32,32]);return {ok:true,arrayBuffer:async()=>b};}
        throw Error('Unexpected inert URL');}};c.window=c;vm.createContext(c);vm.runInContext(read('meshy.js'),c);c.meshy.setKey('inert-topper-key');return c.meshy;}
    const first=client(),state=await first.generate('Inert topper',{from:'topper',polycount:100000,refine:false,topperRecipe:encoded});
    assert.equal(state.topperRecipe,encoded);assert.equal(first.pending().topperRecipe,encoded);assert.equal(first.pending().from,'topper');assert.equal(first.pending().opts.topperRecipe,undefined);
    const second=client(),resumed=await second.resume();assert.equal(resumed.topperRecipe,encoded);assert.equal(resumed.deliveryId,state.deliveryId);
    assert.equal(requests.filter(x=>x.method==='POST').length,1);assert.ok(!JSON.stringify(requests.find(x=>x.method==='POST').body).includes('tpWidth'));assert.equal(second.pending().id,state.deliveryId);
  });
  console.log(passed+' Topper Meshy integration groups passed; mocked service only, no paid/network/print requests.');
})().catch(e=>{console.error(e);process.exitCode=1;});
