// Real keycap builders, UI handlers and Meshy POST serializer; all I/O is inert.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const base=path.resolve(__dirname,'../..'),read=f=>fs.readFileSync(path.join(base,f),'utf8');
const src=read('web/parts/keycap-ui.js'),K=require(path.join(base,'web/parts/keycap.js'));
const S=require(path.join(base,'web/parts/keycap-sculpt.js')),SK=require(path.join(base,'web/parts/keycap-skin.js'));
const SH=require(path.join(base,'web/parts/keycap-share.js'));
function region(a,b){let i=src.indexOf(a),j=src.indexOf(b,i);assert.ok(i>=0&&j>i,a);return src.slice(i,j);}
function box(){const v=[[-2,-2,0],[2,-2,0],[2,2,0],[-2,2,0],[-2,-2,10],[2,-2,10],[2,2,10],[-2,2,10]];
 return new Float32Array([[0,2,1],[0,3,2],[4,5,6],[4,6,7],[0,1,5],[0,5,4],[3,7,6],[3,6,2],[0,4,7],[0,7,3],[1,2,6],[1,6,5]].flatMap(t=>t.flatMap(i=>v[i])));}
function transport(){const posts=[],ctx={Promise,Number,console,localStorage:{getItem:()=> 'test-key-not-a-real-secret'},
 fetch:async(url,opts)=>{posts.push({url,body:JSON.parse(opts.body)});return {ok:true,text:async()=>JSON.stringify({result:'inert-task'})};}};
 vm.createContext(ctx);vm.runInContext(read('web/parts/meshy.js'),ctx);return {api:ctx.meshy,posts};}
function fixture(storage=new Map()){
 const nodes=new Map(),messages=[],calls=[],net=transport(),p=box();
 function node(id){if(!nodes.has(id))nodes.set(id,{value:'',textContent:'',disabled:false,events:{},setAttribute(){},addEventListener(k,fn){this.events[k]=fn;}});return nodes.get(id);}
 const ctx={K,Math,Number,Promise,WeakMap,Float32Array,ArrayBuffer,DataView,Blob,built:null,
 st:{step:3,key:'A',profile:'DSA',row:'R3',sizeU:1,depth:2.4,art:'gen',plate:[],sculpt:null,raised:true,sculptHeightMm:13,meshyPolycount:30000,sculptStyle:'cuteartisan'},
 localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},$:node,
 document:{querySelector:()=>null},relief:()=>null,say:(...m)=>messages.push(m),refresh:()=>{},setTimeout:()=>0,
 paintLegendRow:()=>{},drawProfiles:()=>{},drawRows:()=>{},drawIcons:()=>{},caliper:()=>{},setFinish:()=>{},
 setArt:v=>{ctx.st.art=v;},dropSculpt:()=>{ctx.st.sculpt=null;},offerManualDownload:e=>messages.push(['error',e.message]),
 window:{keycapSculpt:S,keycapSkin:SK,keycapShare:SH,meshyParseGLB:()=>({positions:p}),meshy:{hasKey:()=>true,pending:()=>null,
 generate:async(prompt,opts)=>{calls.push({prompt,opts});await net.api.createPreview(prompt,opts);return {glb:new ArrayBuffer(0)};}}}};
 vm.createContext(ctx);vm.runInContext([
 region('  // ---- sculpture settings','  // ---- step 1:'),
 region('  var SESSION =','  // ---- the shelf'),
 region('  function capFacts()','  function drawShelf()'),
 region('  function genBusy(on)','  /* seat()'),
 region('  function capSpec()','  /* A generation'),
 region("  $('kcGen').addEventListener", "  $('kcGenClear').addEventListener"),
 region('  function capFor(mode, rel) {','  function refreshNow()'),
 region('  function designOf() {','  // ---- share, and open'),
 'bindSculptSettings();'
 ].join('\n'),ctx);
 return {ctx,node,storage,calls,posts:net.posts,messages,p,eval:s=>vm.runInContext(s,ctx),fire:(id,event='click')=>node(id).events[event].call(node(id))};
}
let passed=0;async function test(n,fn){await fn();passed++;console.log('PASS '+n);}
const flush=()=>new Promise(setImmediate);
(async()=>{
 await test('cancelling a recovery choice cannot spend credits or discard the earlier task',async()=>{
  const f=fixture();let forgotten=0,questions=0;
  f.node('kcPrompt').value='a cute puppy';f.ctx.window.meshy.pending=()=>({id:'old-task',from:'keycap',prompt:'old puppy'});
  f.ctx.window.meshy.forgetPending=()=>{forgotten++;return true;};f.ctx.confirm=()=>{questions++;return false;};
  f.fire('kcGen');await flush();await flush();assert.equal(questions,2);assert.equal(forgotten,0);assert.equal(f.calls.length,0);
 });
 await test('visible height, 19 mm choice, detail and art-direction controls',()=>{
  const html=read('web/parts/keycap-card.html');assert.match(html,/id='kcSculptHeight'.*min='6' max='30' step='0.5' value='19'/);
  assert.match(html,/value='100000'>Fine/);assert.match(html,/value='faithfulsubject'/);assert.match(html,/relief depth only changes/);
  const f=fixture();assert.equal(f.node('kcSculptHeight').value,'13');f.node('kcSculptHeight').value='19';f.fire('kcSculptHeight','input');assert.equal(f.eval('sculptureHeight()'),19);
 });
 await test('Fill available key space enlarges the actual sculpture and preserves its raw model, socket and rotation',()=>{
  const f=fixture();f.ctx.st.sculpt=f.p;f.ctx.st.sculptHeightMm=12;f.ctx.st.sculptScalePercent=70;f.ctx.st.sculptRotationDeg=90;
  f.eval('stemFitClearance = 1.25 - K.MX.crossWide');
  const raw=f.p.slice(),before=f.eval("capFor('print',null)"),baseBefore=before.positions.slice(0,before.seated.capTriangles*9);
  f.fire('kcSculptFill');const after=f.eval("capFor('print',null)");
  assert.equal(f.ctx.st.sculpt,f.p);assert.deepEqual(f.p,raw);assert.equal(f.eval('sculptureHeight()'),30);assert.equal(f.ctx.st.sculptScalePercent,100);assert.equal(f.ctx.st.sculptRotationDeg,90);
  assert.ok(after.seated.sculptMm.z>before.seated.sculptMm.z);assert.deepEqual(after.positions.slice(0,after.seated.capTriangles*9),baseBefore);
  assert.equal(f.eval('K.MX.crossWide + stemFitClearance'),1.25);assert.equal(after.sculptCheck.ok,true);
  const saved=JSON.parse(f.storage.get('tmKeycapSession'));assert.equal(saved.sculptHeightMm,30);assert.equal(saved.sculptScalePercent,100);
 });
 await test('Fill does not modify missing artwork or a staged next-generation style',()=>{
  const f=fixture();f.fire('kcSculptFill');assert.equal(f.ctx.st.sculptHeightMm,13);
  f.ctx.st.sculpt=f.p;f.eval('artisanStyleDraft = {sculptHeightMm:22,meshyPolycount:100000,sculptStyle:"cuteartisan"}');
  f.fire('kcSculptFill');assert.equal(f.ctx.st.sculptHeightMm,13);assert.equal(f.ctx.st.sculpt,f.p);assert.equal(f.eval('artisanStyleDraft.sculptHeightMm'),22);
 });
 await test('Enhanced sculpt detail is an explicit boolean and survives UI, session, share and Meshy POST',async()=>{
  const f=fixture();assert.equal(f.node('kcMeshyUltra').checked,false);
  f.node('kcMeshyUltra').checked=true;f.fire('kcMeshyUltra','change');assert.equal(f.ctx.st.meshyUltra,true);
  assert.equal(JSON.parse(f.storage.get('tmKeycapSession')).meshyUltra,true);
  const fresh=fixture(f.storage);fresh.eval('restoreSession()');assert.equal(fresh.ctx.st.meshyUltra,true);
  const design=SH.decode(SH.encode(f.eval('designOf()')));assert.equal(design.meshyUltra,true);f.ctx.design=design;f.eval('applyDesign(design)');assert.equal(f.ctx.st.meshyUltra,true);
  f.node('kcPrompt').value='a chunky puppy';f.fire('kcGen');await flush();await flush();assert.equal(f.calls[0].opts.ultra,true);assert.equal(f.posts[0].body.ultra_mode,true);assert.equal(f.posts[0].body.ai_model,'meshy-7');
  assert.equal(SH.decode(f.calls[0].opts.designCode).meshyUltra,true);
  for(const bad of ['true',1,{}])assert.throws(()=>SH.encode({profile:'DSA',meshyUltra:bad}),/on or off/);
  const t=transport();await assert.rejects(t.api.createPreview('puppy',{ultra:'true'}),/on or off/);assert.equal(t.posts.length,0);
 });
 await test('explicit height reaches prompt and full/preview real sculpture geometry independently of relief',()=>{
  const f=fixture();f.ctx.st.sculpt=f.p;
  for(const h of [13,19]){f.node('kcSculptHeight').value=String(h);f.fire('kcSculptHeight','input');
   assert.equal(f.eval('capSpec().hMm'),h);
   for(const mode of ['preview','print']){const cap=f.eval(`capFor('${mode}',null)`);assert.equal(cap.sculptCheck.ok,true);assert.equal(cap.seated.sculptMm.z,h);}
   f.ctx.st.depth=5;assert.equal(f.eval('sculptureHeight()'),h);
  }
  assert.deepEqual(f.ctx.st.sculpt,f.p);
 });
 await test('actual session serialization remembers chosen height/detail/style',()=>{
  const f=fixture();for(const [id,value,event] of [['kcSculptHeight','19','input'],['kcMeshyDetail','100000','change'],['kcSculptStyle','faithfulsubject','change']]){f.node(id).value=value;f.fire(id,event);}
  const saved=JSON.parse(f.storage.get('tmKeycapSession'));assert.equal(saved.sculptHeightMm,19);assert.equal(saved.meshyPolycount,100000);assert.equal(saved.sculptStyle,'faithfulsubject');
  const fresh=fixture(f.storage);fresh.eval('restoreSession()');assert.equal(fresh.eval('sculptureHeight()'),19);assert.equal(fresh.ctx.st.meshyPolycount,100000);assert.equal(fresh.ctx.st.sculptStyle,'faithfulsubject');
 });
 await test('legacy sessions/designs preserve depth-derived height until explicitly changed',()=>{
  const f=fixture(new Map([['tmKeycapSession',JSON.stringify({profile:'DSA',row:'R3',sizeU:1,depth:3.8,art:'gen'})]]));
  f.eval('restoreSession()');assert.equal(f.eval('sculptureHeight()'),19);assert.equal(f.ctx.st.sculptHeightMm,null);
  f.ctx.st.depth=2.4;assert.equal(f.eval('sculptureHeight()'),12);
  f.eval("applyDesign({profile:'DSA',row:'R3',sizeU:1,depth:3.6,prompt:'creeper'})");assert.equal(f.eval('sculptureHeight()'),18);
  f.node('kcSculptHeight').value='19';f.fire('kcSculptHeight','input');f.ctx.st.depth=1;assert.equal(f.eval('sculptureHeight()'),19);
 });
 await test('share codes round-trip settings and still disclose generated art is not reproducible',()=>{
  const f=fixture();f.ctx.st.skinFrom='creeper';f.ctx.st.sculptHeightMm=19;f.ctx.st.meshyPolycount=100000;f.ctx.st.sculptStyle='faithfulsubject';
  const d=SH.decode(SH.encode(f.eval('designOf()')));assert.equal(d.sculptHeightMm,19);assert.equal(d.meshyPolycount,100000);assert.equal(d.sculptStyle,'faithfulsubject');assert.equal(SH.isReproducible(d),false);
  f.ctx.design=d;f.eval('applyDesign(design)');assert.equal(f.eval('sculptureHeight()'),19);
  for(const bad of [{sculptHeightMm:Infinity},{sculptHeightMm:31},{sculptHeightMm:'19'},{meshyPolycount:99999},{sculptStyle:'constructor'}]) {
   assert.throws(()=>SH.encode({profile:'DSA',...bad}));
   const keys={sculptHeightMm:'sh',meshyPolycount:'mp',sculptStyle:'ss'},j={p:'DSA'};for(const k in bad)j[keys[k]]=Number.isFinite(bad[k])?bad[k]:String(bad[k]);
   assert.throws(()=>SH.decode('TMK1-'+Buffer.from(JSON.stringify(j)).toString('base64url')));
  }
 });
 await test('actual Generate handler passes 100k to Meshy POST and preserves true 3D mesh',async()=>{
  const f=fixture();f.node('kcPrompt').value='creeper';f.node('kcSculptHeight').value='19';f.fire('kcSculptHeight','input');
  f.node('kcMeshyDetail').value='100000';f.fire('kcMeshyDetail','change');f.node('kcSculptStyle').value='faithfulsubject';f.fire('kcSculptStyle','change');
  f.fire('kcGen');await flush();await flush();assert.equal(f.calls.length,1);assert.equal(f.calls[0].opts.polycount,100000);
  const b=f.posts[0].body;assert.equal(b.target_polycount,100000);assert.equal(b.should_remesh,true);assert.equal(b.mode,'preview');assert.equal(b.art_style,undefined);
  assert.match(b.prompt,/Full-body Minecraft Creeper/);assert.match(b.prompt,/four distinct feet/);assert.match(b.prompt,/sculpted geometry, not texture/);
  assert.match(b.prompt,/19 by 19 by 19 mm/);assert.match(b.prompt,/preserve distinctive/);assert.doesNotMatch(b.prompt,/cute artisan style/);
  assert.equal(f.ctx.st.sculpt,f.p);assert.equal(f.ctx.st.skinFrom,'creeper');assert.ok(f.posts[0].url.endsWith('/openapi/v2/text-to-3d'));
 });
 await test('standard detail stays 30k and style remains prompt-only',async()=>{
  const f=fixture();f.node('kcPrompt').value='a cat';f.fire('kcGen');await flush();await flush();assert.equal(f.posts[0].body.target_polycount,30000);
  assert.match(f.posts[0].body.prompt,/cute artisan style/);assert.equal(f.calls[0].opts.artStyle,undefined);assert.equal(f.calls[0].opts.refine,false);
 });
 await test('long descriptions are visibly rejected before any paid submission; requirements are never truncated',async()=>{
  const f=fixture();f.node('kcPrompt').value='x'.repeat(500);assert.doesNotThrow(()=>f.fire('kcGen'));await flush();assert.equal(f.calls.length,0);
  assert.ok(f.messages.some(m=>/Shorten the art description/.test(m[1])));
  const cap={wMm:18.65,dMm:18.65,hMm:19,minFeatureMm:.51},suffix=SK.promptFor('x',null,'sculpt',cap).length-1;
  const max=800-suffix,p=SK.promptFor('x'.repeat(max),null,'sculpt',cap);assert.equal(p.length,800);assert.ok(p.endsWith('no detail finer than 0.51 mm'));
  assert.throws(()=>SK.promptFor('x'.repeat(max+1),null,'sculpt',cap),/Shorten/);
  const t=transport();await t.api.createPreview(p,{polycount:100000});assert.equal(t.posts[0].body.prompt,p);
  await assert.rejects(t.api.createPreview(p+'x'));await assert.rejects(t.api.createPreview('   '));await assert.rejects(t.api.createPreview('cat',{polycount:Infinity}));assert.equal(t.posts.length,1);
 });
 await test('generation errors leave existing art in place and never substitute procedural geometry',async()=>{
  const f=fixture();f.ctx.st.sculpt=f.p;f.ctx.window.meshy.generate=()=>Promise.reject(Error('inert service failure'));
  f.node('kcPrompt').value='creeper';f.fire('kcGen');await flush();await flush();assert.equal(f.ctx.st.sculpt,f.p);assert.ok(f.messages.some(m=>/inert service failure/.test(m[1])));
  assert.equal(f.node('kcGen').disabled,false);
 });
 console.log(`\n${passed} keycap art settings groups passed.`);
})().catch(e=>{console.error(e);process.exitCode=1;});
