'use strict';
// Real browser Start handler in a VM. All device requests are inert fixtures.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../../web/dashboard.html'),'utf8');
const begin=source.indexOf('// ---- Confirmed print start');
const handler=source.slice(begin>=0?begin:source.indexOf('const startPrint=async('),source.indexOf('// Deleting a big model removes'));
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
const tick=()=>new Promise(r=>setImmediate(r));
function goodPreflight(extra=[]){return {ok:true,ready:true,checks:[{check:'idle',pass:true,level:'ok',detail:'idle'},{check:'sd',pass:true,level:'ok',detail:'card ready'},{check:'resin_profile',pass:true,level:'ok',detail:'using Standard'},{check:'layer_count',pass:true,level:'ok',detail:'100 of 4000 max'},...extra]};}
function fixture(o={}){
 const calls=[],messages=[],questions=[],locks=[],nodes=new Map();let starts=0;
 const ctx={console,Promise,Error,Math,Number,JSON,Date,decodeURIComponent,encodeURIComponent,
  statusData:{ok:true,busy:false,resinSet:true,sdReady:true,webControl:true,askRefill:false,...o.status},selectedModel:'cap-A',startBusy:false,bgJob:'',
  slicesCache:{name:'cap-A',slices:[1]},slicesPrefetching:false,VIEW_DETAIL:false,localPrintStartedAt:0,lpsSynced:false,
  $:id=>{if(!nodes.has(id))nodes.set(id,{textContent:''});return nodes.get(id);},enc:encodeURIComponent,
  uiBusy:()=>ctx.startBusy||ctx.statusData.busy,
  uiConfirm:async(q,opt)=>{questions.push({q,opt});return o.confirm?o.confirm(q,opt,questions.length):true;},
  clearNew:n=>calls.push({clearNew:n}),setPreviewLoading(){},syncActionLocks:()=>locks.push(ctx.startBusy),renderStateValue(){},
  cacheIsDetail:()=>false,setDashPreviewName:n=>calls.push({previewName:n}),setModelInfoRows(){},show(){},scrollPreviewIntoView(){},paintPreviewProgress(){},
  fetchSlices:async(...a)=>{calls.push({prefetch:a[0]});if(o.prefetch)await o.prefetch(...a);},
  localBusyStatus:(state,stateCode)=>({busy:true,state,stateCode}),applyStatus:s=>{calls.push({status:s});ctx.statusData={...ctx.statusData,...s};},
  openView:v=>calls.push({view:v}),refreshStatus:()=>Promise.resolve(),
  msg:(m,bad)=>messages.push({m,bad}),setTimeout:fn=>queueMicrotask(fn),
  api:async(url,opt,timeout)=>{calls.push({url,opt,timeout});
   if(url.startsWith('/api/print/start')){starts++;return o.start?o.start(url,starts):{ok:true,queued:true};}
   if(url.startsWith('/api/preflight'))return o.preflight?o.preflight(url):goodPreflight();
   if(url==='/api/status')return o.poll?o.poll():{ok:true,busy:false,sdJob:'',model:''};
   if(url.startsWith('/api/files/model?'))return {ok:true,name:'cap-A',layers:10};
   if(url==='/api/vat/refilled'&&o.refill)throw Error(o.refill);
   return {ok:true};
  },
  fetch(){throw Error('Real network forbidden');}
 };vm.createContext(ctx);vm.runInContext(handler+'\nthis.runStart=startPrint;',ctx);
 return {ctx,calls,messages,questions,locks,start:(...args)=>ctx.runStart(...args),posts:()=>calls.filter(x=>x.url&&x.url.startsWith('/api/print/start'))};
}
let passed=0;async function test(name,fn){await fn();passed++;console.log('PASS '+name);}
(async()=>{
 await test('low-resin confirmation retries once within the same locked attempt',async()=>{
  const f=fixture({start:(u,n)=>n===1?{ok:true,warning:'low_resin',vatRemainingMl:2}:{ok:true,queued:true}});
  await f.start('cap-A');assert.equal(f.posts().length,2);assert.match(f.posts()[1].url,/name=cap-A&force=1$/);assert.equal(f.ctx.startBusy,false);assert.equal(f.locks.filter(x=>!x).length,1);
 });
 await test('two clicks share one confirmation owner and never issue two starts',async()=>{
  const q=deferred(),f=fixture({confirm:()=>q.promise});const first=f.start('cap-A');await tick();const second=f.start('cap-B');await tick();
  assert.equal(f.questions.length,1);assert.equal(f.ctx.startBusy,true);q.resolve(true);await Promise.all([first,second]);assert.equal(f.posts().length,1);assert.match(f.posts()[0].url,/name=cap-A$/);
 });
 await test('canceling confirmation releases the lock without device writes',async()=>{const f=fixture({confirm:()=>false});assert.equal(await f.start('cap-A'),false);assert.equal(f.posts().length,0);assert.equal(f.ctx.startBusy,false);});
 await test('the selected model cannot replace the named model during preview or low-resin retry',async()=>{
  const f=fixture({prefetch:async()=>{f.ctx.selectedModel='cap-B';},start:(u,n)=>n===1?{ok:true,warning:'low_resin',vatRemainingMl:2}:{ok:true,queued:true}});f.ctx.slicesCache={name:'other',slices:[]};
  await f.start();assert.equal(f.posts().length,2);assert.ok(f.posts().every(x=>/name=cap-A(?:&|$)/.test(x.url)));assert.ok(f.calls.filter(x=>x.url&&x.url.startsWith('/api/preflight')).every(x=>x.url.endsWith('name=cap-A')));
 });
 await test('hard preflight failures stop Start and explain the exact failure',async()=>{
  const f=fixture({preflight:()=>({ok:true,ready:false,checks:[{check:'layer_count',pass:false,level:'fail',detail:'5000 of 4000 max'}]})});assert.equal(await f.start('cap-A'),false);assert.equal(f.posts().length,0);assert.match(f.messages.at(-1).m,/5000 of 4000 max/);assert.equal(f.ctx.startBusy,false);
 });
 await test('a printer becoming busy during preview is not queried for SD preflight',async()=>{const f=fixture({prefetch:async()=>{f.ctx.statusData.busy=true;}});f.ctx.slicesCache={name:'other',slices:[]};await f.start('cap-A');assert.equal(f.calls.filter(x=>x.url&&x.url.startsWith('/api/preflight')).length,0);assert.equal(f.posts().length,0);assert.match(f.messages.at(-1).m,/became busy/);});
 await test('unreviewed preflight warnings cannot start a print',async()=>{
  const f=fixture({preflight:()=>goodPreflight([{check:'uv',pass:false,level:'warn',detail:'DRY RUN is on - nothing will cure'}]),confirm:q=>!q.includes('DRY RUN')});await f.start('cap-A');assert.equal(f.posts().length,0);assert.ok(f.questions.some(q=>q.q.includes('DRY RUN')));
 });
 await test('missing or malformed preflight responses do not permit Start',async()=>{
  for(const response of [null,{ok:true}, {ok:true,ready:true,checks:[]}]){const f=fixture({preflight:()=>response});await f.start('cap-A');assert.equal(f.posts().length,0);assert.equal(f.ctx.startBusy,false);}
 });
 await test('a failed refill update is visible and cannot proceed using an old estimate',async()=>{const f=fixture({status:{askRefill:true},refill:'SD write failed'});await f.start('cap-A');assert.equal(f.posts().length,0);assert.match(f.messages.at(-1).m,/SD write failed/);});
 await test('ambiguous Start replies are confirmed only for this model and never resent',async()=>{
  for(const state of [{ok:true,busy:true,sdJob:'import',model:'cap-A'},{ok:true,busy:true,sdJob:'',model:'other-cap'}]){
   const f=fixture({start:()=>{throw Error('timeout');},poll:()=>state});assert.equal(await f.start('cap-A'),false);assert.equal(f.posts().length,1);assert.equal(f.calls.filter(x=>x.view).length,0);assert.match(f.messages.at(-1).m,/not confirmed/i);
  }
 });
 await test('a timeout can recover only to this actual print',async()=>{const f=fixture({start:()=>{throw Error('timeout');},poll:()=>({ok:true,busy:true,sdJob:'',model:'cap-A',state:'Homing',stateCode:0})});assert.equal(await f.start('cap-A'),true);assert.equal(f.posts().length,1);assert.equal(f.ctx.startBusy,false);});
 await test('an empty start acknowledgement cannot fabricate Homing',async()=>{const f=fixture({start:()=>({ok:true})});assert.equal(await f.start('cap-A'),false);assert.equal(f.calls.filter(x=>x.status&&x.status.state==='Homing').length,0);});
 await test('failed requests unlock and a later explicit attempt can succeed',async()=>{let bad=true;const f=fixture({start:()=>{if(bad)throw Error('model not found');return {ok:true,queued:true};}});assert.equal(await f.start('cap-A'),false);assert.equal(f.ctx.startBusy,false);bad=false;assert.equal(await f.start('cap-A'),true);assert.equal(f.posts().length,2);});
 await test('unavailable controls and malformed names are rejected before any dialog',async()=>{for(const status of [{webControl:false},{sdReady:false},{resumePending:{model:'old'}}]){const f=fixture({status});await f.start('cap-A');assert.equal(f.questions.length,0);assert.equal(f.posts().length,0);}const f=fixture();assert.equal(await f.start('%broken'),false);assert.equal(f.questions.length,0);});
 console.log(passed+' Start print regression groups passed; all requests are inert, no printer or motion.');
})().catch(e=>{console.error(e);process.exitCode=1;});
