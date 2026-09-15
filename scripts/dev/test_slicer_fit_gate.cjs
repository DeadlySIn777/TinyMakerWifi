'use strict';
// Actual firmware slice handler and final-boundary helpers. Engine responses
// are inert fixtures; no browser session, network, upload or print operation.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../../web/parts/slicer.js'),'utf8');
function region(a,b){const i=source.indexOf(a),j=source.indexOf(b,i);assert.ok(i>=0&&j>i,a);return source.slice(i,j);}
const helpers=region('let slicerNoScale=false,','/* Tikra sluoksnio kauke.');
const handler=region("$('slicerGo').addEventListener('click',async()=>{","$('slicerAA').addEventListener");
function result(foot={x0:-10,x1:10,y0:-10,y1:10},extra={}){return {files:[],layers:630,rawMl:1,supports:{count:83},pedsakas:foot,...extra};}
function fixture(responses,{noScale=true,type='regular',scale=1}={}){
  const nodes=new Map(),calls=[],messages=[],notices=[];let selected=type;
  function node(id){if(!nodes.has(id))nodes.set(id,{textContent:'',value:'test',disabled:false,checked:false,style:{},events:{},
    classList:{contains:()=>true,remove(){},add(){}},focus(){},addEventListener(k,fn){this.events[k]=fn;}});return nodes.get(id);}
  const original=new Float32Array([0,0,0, 12,0,0, 0,12,20]);
  const ctx={console,Number,Math,Promise,Float32Array,ArrayBuffer,WeakMap,performance:{now:()=>100},
    $:node,document:{querySelector:q=>q.includes('value="tree"')?node('tree-choice'):{value:selected}},
    sliceRunning:false,sliceRun:0,slicerRaw:original,slicerTr:{rx:0,rz:0,scale},slicerFileName:'model2-art.stl',
    slicerMod:{PLATE:{x:40.8,y:30.6,z:68},place:p=>new Float32Array(p),bounds:()=>({size:[12,12,20]}),fitCheck:()=>({fits:true}),
      slice:async(p,o)=>{calls.push({positions:Array.from(p),options:{...o}});const next=responses.shift();if(next instanceof Error)throw next;assert.ok(next,'unexpected third slice');return next;}},
    slicerBusyStop:()=>false,slicerPerDidelis:()=>'',connectConfig:{},slicerBusyNow:false,slicerParamai:()=>({pakelta:false,autoPakelti:true,parametrai:{}}),
    btnBusy(){},slicerButtons(){},slicerWorkUI(){},slicerPaint(){},slicerSupportFacts(){},slicerPlaceNote(){},slicerScaleUI(){},
    slicerDimsLine(){},slicerLayerUI(){},slicerBuildView(){},slicerStep(){},slicerShowLayer(){},slicerOverlayOff(){},
    show(){},setInterval:()=>0,clearInterval(){},msg:(...args)=>messages.push(args),slicerSay:(id,text)=>{node(id).textContent=text;},
    window:{designerFeedback:{help:(...args)=>notices.push(args)}},
    fetch(){throw Error('Network forbidden');},XMLHttpRequest:class{constructor(){throw Error('Upload forbidden');}}
  };
  vm.createContext(ctx);vm.runInContext(helpers+'\n'+handler,ctx);
  vm.runInContext('slicerNoScale='+noScale,ctx);
  return {ctx,calls,messages,notices,node,original,run:s=>vm.runInContext(s,ctx),click:()=>node('slicerGo').events.click()};
}
let passed=0;async function test(name,fn){await fn();passed++;console.log('PASS '+name);}
(async()=>{
 await test('reported residual overflow blocks a previously auto-scaled ordinary model',()=>{
   const f=fixture([],{noScale:false});f.ctx.answer=result(undefined,{sumazinta:{mastelis:.995,telpa:false}});
   assert.match(f.run('slicerOutputBlock(answer,false)'),/Supports or raft extend/);
 });
 await test('measured off-centre support bounds block even when their width and model dimensions fit',()=>{
   const f=fixture([]);f.ctx.answer=result({x0:8,x1:20,y0:0,y1:8});
   assert.match(f.run('slicerOutputBlock(answer,true)'),/Supports or raft extend/);
 });
 await test('missing invalid or inverted footprint data cannot claim the slice fits',()=>{
   const f=fixture([]);
   for(const p of [null,{x0:0,x1:NaN,y0:0,y1:1},{x0:5,x1:1,y0:0,y1:1}]){
     f.ctx.answer=result(p);assert.match(f.run('slicerOutputBlock(answer,true)'),/valid support bounds/);
   }
 });
 await test('a noScale slice never accepts a shrunken socket even when support bounds fit',()=>{
   const f=fixture([]);f.ctx.answer=result(undefined,{sumazinta:{mastelis:.995,telpa:true}});
   assert.match(f.run('slicerOutputBlock(answer,true)'),/exact dimensions are locked/);
 });
 await test('regular overflow automatically tries tree once using byte-identical coordinates and unchanged scale',async()=>{
   const regular=result({x0:-19.6,x1:19.6,y0:-10,y1:10}),tree=result();
   const f=fixture([regular,tree],{scale:.82}),before=Array.from(f.original);await f.click();
   assert.equal(f.calls.length,2);assert.equal(f.calls[0].options.supportType,'regular');assert.equal(f.calls[1].options.supportType,'tree');
   assert.equal(f.calls[0].options._fitAntras,true);assert.equal(f.calls[1].options._fitAntras,true);
   assert.deepEqual(f.calls[0].positions,before);assert.deepEqual(f.calls[1].positions,before);assert.deepEqual(Array.from(f.original),before);
   assert.equal(f.ctx.slicerTr.scale,.82);assert.equal(f.run('slicerOut'),tree);assert.equal(f.run('slicerScaleBlocked'),false);
   assert.equal(f.node('slicerSave').disabled,false);assert.equal(f.node('tree-choice').checked,true);
   assert.match(f.node('slicerProg').textContent,/Tree supports selected automatically.*model size unchanged/);
   assert.match(f.node('slicerInfo').textContent,/Model, supports and raft fit/);
 });
 await test('when regular and tree both overflow the latest preview remains blocked without an unbounded retry',async()=>{
   const regular=result({x0:-20,x1:20,y0:-10,y1:10}),tree=result({x0:-20,x1:20,y0:-11,y1:11});
   const f=fixture([regular,tree]);await f.click();assert.equal(f.calls.length,2);assert.equal(f.run('slicerOut'),tree);
   assert.equal(f.run('slicerScaleBlocked'),true);assert.equal(f.node('slicerSave').disabled,true);assert.equal(f.ctx.slicerTr.scale,1);
   assert.match(f.node('slicerInfo').textContent,/cannot be sent/);assert.doesNotMatch(f.node('slicerInfo').textContent,/Fits the build volume/);
 });
 await test('manually selected tree supports are checked once and are not retried',async()=>{
   const f=fixture([result({x0:-20,x1:20,y0:-10,y1:10})],{type:'tree'});await f.click();
   assert.equal(f.calls.length,1);assert.equal(f.run('slicerScaleBlocked'),true);assert.equal(f.node('slicerSave').disabled,true);
 });
 await test('a fitting regular-support slice does not pay for an unnecessary tree pass',async()=>{
   const f=fixture([result()]);await f.click();assert.equal(f.calls.length,1);assert.equal(f.node('slicerSave').disabled,false);
 });
 await test('a later valid slice clears an earlier blocked fit instead of stranding Send',async()=>{
   const f=fixture([result()],{type:'tree'});f.run('slicerScaleBlocked=true');await f.click();
   assert.equal(f.run('slicerScaleBlocked'),false);assert.equal(f.node('slicerSave').disabled,false);
 });
 await test('only an explicitly scalable ordinary model adopts verified engine shrink',async()=>{
   const f=fixture([result(undefined,{sumazinta:{mastelis:.9,telpa:true,tekstas:'Scaled down10%'}})],{noScale:false});
   await f.click();assert.equal(f.calls.length,1);assert.equal(f.calls[0].options._fitAntras,false);
   assert.equal(f.ctx.slicerTr.scale,.9);assert.equal(f.run('slicerScaleBlocked'),false);
 });
 console.log(passed+' sliced-footprint/exact-size/support-fallback regression groups passed; no printer or network access.');
})().catch(e=>{console.error(e);process.exitCode=1;});
