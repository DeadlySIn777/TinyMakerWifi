/* Physical autofinish regressions: actual cap/sculpt/print-pose geometry plus
 * evaluator contract, cancellation and work budgets. No network or printer. */
'use strict';
const assert = require('node:assert/strict');
const K = require('../../web/parts/keycap.js');
const S = require('../../web/parts/keycap-sculpt.js');
const {meshHealth} = require('../../web/parts/mesh-health.js');
const A = require('../../web/parts/keycap-autofinish.js');

function box(x0,x1,y0,y1,z0,z1) {
  const v=[[x0,y0,z0],[x1,y0,z0],[x1,y1,z0],[x0,y1,z0],[x0,y0,z1],[x1,y0,z1],[x1,y1,z1],[x0,y1,z1]];
  return new Float32Array([[0,2,1],[0,3,2],[4,5,6],[4,6,7],[0,1,5],[0,5,4],[3,7,6],[3,6,2],[0,4,7],[0,7,3],[1,2,6],[1,6,5]].flatMap(t=>t.flatMap(i=>v[i])));
}
function join(a,b) { const p=new Float32Array(a.length+b.length);p.set(a);p.set(b,a.length);return p; }
function checks(overrides={}) {
  return A.REQUIRED_CHECKS.map(name=>({name,status:overrides[name]||'pass',reason:overrides[name]&&overrides[name]!=='pass'?'Fixture check did not pass.':''}));
}
const initial = {heightMm:12,scalePercent:80,rotationDeg:37};
const quick = {timeBudgetMs:30000,yieldControl:()=>Promise.resolve()};
let count=0;
async function test(name,fn) { await fn();count++;console.log('PASS '+name); }

function geometryEvaluator(cap,art,options={}) {
  return candidate=>{
    const seated=S.seat(cap,art,candidate), health=meshHealth(seated.positions), tested=S.check(seated,options);
    const anchor=tested.anchorage;
    const socket=K.validate(seated.positions.subarray(0,cap.positions.length),{sizeU:1});
    const pose=S.printPose(seated,cap,options);
    return {score:seated.scale,checks:[
      {name:'geometry',status:health.fatal||health.severity==='bad'?'fail':'pass',reason:health.fatal||health.advice||''},
      {name:'attachment',status:anchor.unresolved?'unresolved':anchor.floating.length?'fail':'pass',reason:anchor.issue||''},
      {name:'socket',status:socket.ok&&seated.positions.subarray(0,cap.positions.length).every((n,i)=>n===cap.positions[i])?'pass':'fail'},
      {name:'print-fit',status:pose.ok&&tested.ok?'pass':'fail',reason:pose.why||tested.issues.join(' ')}
    ],metrics:{artHeight:seated.sculptMm.z},value:{seated,pose}};
  };
}

(async()=>{
  await test('real oversized sculpture shrinks to checked print pose without changing one socket coordinate',async()=>{
    const cap=K.build({profile:'DSA',row:'R3',sizeU:1,topGrid:21});
    const art=box(-1,1,-1,1,0,100), oldCap=cap.positions.slice(),oldArt=art.slice();
    const evaluate=geometryEvaluator(cap,art), start={heightMm:70,scalePercent:100,rotationDeg:23};
    assert.equal(evaluate(start).checks.find(c=>c.name==='print-fit').status,'fail','fixture must actually exceed the print volume');
    const result=await A.run({...quick,initial:start,evaluate,maxEvaluations:16});
    assert.equal(result.status,'accepted',JSON.stringify(result.attempts));
    assert.ok(result.candidate.heightMm<=70);assert.ok(result.score<.7);
    assert.equal(result.candidate.rotationDeg,23);assert.equal(result.value.pose.ok,true);
    assert.equal(S.check(result.value.seated).ok,true);
    assert.deepEqual(result.value.seated.positions.subarray(0,cap.positions.length),oldCap);
    assert.deepEqual(cap.positions,oldCap);assert.deepEqual(art,oldArt);
    assert.ok(result.attempts.length<=16);
    assert.equal(result.score,Math.max(...result.attempts.filter(a=>a.ok).map(a=>a.score)));
  });
  await test('floating disjoint artwork remains failed at every tested size; no mesh pieces are silently moved',async()=>{
    const cap=K.build({profile:'DSA',row:'R3',sizeU:1,topGrid:21});
    const art=join(box(-5,5,-5,5,0,2),box(-2,2,-2,2,7,10)),before=art.slice();
    const evaluate=geometryEvaluator(cap,art);
    const result=await A.run({...quick,initial:{heightMm:20,scalePercent:100,rotationDeg:0},evaluate});
    assert.equal(result.status,'failed');assert.equal(result.candidate,null);assert.equal(result.value,null);
    assert.ok(result.attempts.every(a=>a.checks.find(c=>c.name==='attachment').status==='fail'));
    assert.deepEqual(art,before);assert.deepEqual(result.actions,[]);
  });
  await test('genuine attachment analysis limit stays unresolved and stops a terminal source evaluation',async()=>{
    const cap=K.build({profile:'DSA',row:'R3',sizeU:1,topGrid:7}), unit=box(-1,1,-1,1,0,8);
    const dense=new Float32Array(unit.length*25001);for(let i=0;i<25001;i++)dense.set(unit,i*unit.length);
    let calls=0;
    const result=await A.run({...quick,initial,evaluate:c=>{
      calls++;const seated=S.seat(cap,dense,c),checked=S.check(seated);
      assert.equal(checked.anchorage.unresolved,true);
      return {score:seated.scale,checks:checks({attachment:'unresolved'}),terminal:true};
    }});
    assert.equal(calls,1);assert.equal(result.status,'unresolved');assert.equal(result.candidate,null);
    assert.equal(result.stopReason,'terminal');
  });
  await test('invalid source coordinates never acquire an accepted candidate through resizing',async()=>{
    const cap=K.build({profile:'DSA',row:'R3',sizeU:1,topGrid:7}),art=box(-1,1,-1,1,0,8);art[0]=NaN;
    const result=await A.run({...quick,initial,maxEvaluations:3,evaluate:geometryEvaluator(cap,art)});
    assert.notEqual(result.status,'accepted');assert.equal(result.candidate,null);assert.ok(Number.isNaN(art[0]));
  });
  await test('a passing original result remains available when larger candidates fail',async()=>{
    const originalValue={id:'original'},result=await A.run({...quick,initial,evaluate:c=>({
      score:c.heightMm*c.scalePercent/100,checks:checks({'print-fit':c.scalePercent<=80?'pass':'fail'}),
      value:c.scalePercent===80?originalValue:{id:'other'}
    })});
    assert.equal(result.status,'accepted');assert.deepEqual(result.candidate,initial);
    assert.equal(result.value,originalValue);assert.deepEqual(result.actions,[]);
  });
  await test('default sizing fills width without exceeding the requested height or changing rotation',async()=>{
    const start={heightMm:12.123456789,scalePercent:50,rotationDeg:360}, before={...start};
    const result=await A.run({...quick,initial:start,maxHeightMm:30,evaluate:c=>({score:c.heightMm*c.scalePercent,checks:checks()})});
    assert.equal(result.candidate.heightMm,start.heightMm);assert.equal(result.candidate.scalePercent,100);
    assert.equal(result.candidate.rotationDeg,360);assert.deepEqual(start,before);
    assert.ok(result.attempts.every(a=>a.candidate.heightMm<=start.heightMm));assert.equal(result.attempts.length,2);
  });
  await test('a higher height ceiling requires explicit fill mode',async()=>{
    const result=await A.run({...quick,initial,mode:'fill',maxHeightMm:30,evaluate:c=>({score:c.heightMm*c.scalePercent,checks:checks()})});
    assert.equal(result.candidate.heightMm,30);assert.equal(result.candidate.scalePercent,100);
    assert.equal(result.candidate.rotationDeg,37);assert.equal(result.actions.length,2);
  });
  await test('optional slider steps round generated candidates down, keep the exact original and skip duplicates',async()=>{
    const start={heightMm:12.3,scalePercent:80.25,rotationDeg:37},seen=new Set();
    const result=await A.run({...quick,initial:start,heightStepMm:.5,scaleStepPercent:1,maxEvaluations:32,evaluate:c=>{
      const key=JSON.stringify(c);assert.equal(seen.has(key),false,'quantization must not repeat expensive checks');seen.add(key);
      return {score:c.heightMm*c.scalePercent,checks:checks({'print-fit':c.scalePercent<=87.7?'pass':'fail'})};
    }});
    assert.deepEqual(result.original,start);assert.deepEqual(result.attempts[0].candidate,start);
    for(const a of result.attempts.slice(1)) {
      assert.equal(a.candidate.heightMm%.5,0);assert.equal(a.candidate.scalePercent%1,0);
      assert.ok(a.candidate.heightMm<=start.heightMm);
    }
    assert.equal(result.candidate.scalePercent,87,'87.7 must not become an unsafe 88%');
    assert.equal(result.candidate.heightMm,12);assert.ok(result.attempts.length<32);
  });
  await test('equal physical size keeps original settings when the seat already saturates its width',async()=>{
    const result=await A.run({...quick,initial,mode:'fill',maxHeightMm:30,evaluate:()=>({score:1.5,checks:checks()})});
    assert.deepEqual(result.candidate,initial);assert.deepEqual(result.actions,[]);
  });
  await test('missing, duplicated, invalid or unresolved checks cannot be accepted',async()=>{
    const bad=[[],checks().slice(1),checks().concat(checks()[0]),checks({attachment:'unresolved'}),checks({socket:'probably'})];
    for(const list of bad) {
      const result=await A.run({...quick,initial,maxEvaluations:1,evaluate:()=>({score:1,checks:list,ok:true})});
      assert.equal(result.status,'unresolved');assert.equal(result.candidate,null);
    }
    for(const score of [NaN,Infinity,0,-1,undefined]) {
      const result=await A.run({...quick,initial,maxEvaluations:1,evaluate:()=>({score,checks:checks()})});
      assert.equal(result.status,'unresolved');assert.equal(result.candidate,null);
    }
  });
  await test('evaluation limit and elapsed-time budget are enforced without losing a verified fallback',async()=>{
    let calls=0;
    const countLimited=await A.run({...quick,initial,maxEvaluations:3,evaluate:c=>{
      calls++;return {score:1,checks:checks({'print-fit':'fail'})};
    }});
    assert.equal(calls,3);assert.equal(countLimited.exhausted,true);assert.equal(countLimited.stopReason,'evaluations');
    let time=0;
    const timed=await A.run({...quick,initial,now:()=>time,timeBudgetMs:10,evaluate:()=>{
      time=12;return {score:1,checks:checks(),value:'checked original'};
    }});
    assert.equal(timed.attempts.length,1);assert.equal(timed.status,'accepted');assert.equal(timed.value,'checked original');
    assert.equal(timed.exhausted,true);assert.equal(timed.stopReason,'time');
  });
  await test('cancellation before or after asynchronous evaluation exposes no candidate or retained mesh',async()=>{
    const before=new AbortController();before.abort();let calls=0;
    const a=await A.run({...quick,initial,signal:before.signal,evaluate:()=>{calls++;}});
    assert.equal(calls,0);assert.equal(a.status,'cancelled');assert.equal(a.candidate,null);
    const during=new AbortController();
    const b=await A.run({...quick,initial,signal:during.signal,evaluate:async()=>{
      await Promise.resolve();during.abort();return {checks:checks(),score:1,value:{mesh:'stale'}};
    }});
    assert.equal(b.status,'cancelled');assert.equal(b.candidate,null);assert.equal(b.value,null);assert.deepEqual(b.actions,[]);
  });
  await test('a real event-loop yield allows a queued cancel click to stop before expensive geometry',async()=>{
    const signal=new AbortController();let calls=0;setTimeout(()=>signal.abort(),0);
    const result=await A.run({initial,signal:signal.signal,evaluate:()=>{calls++;return {score:1,checks:checks()};}});
    assert.equal(calls,0);assert.equal(result.status,'cancelled');
  });
  await test('evaluator errors become unresolved; progress receives independent summaries and attempts retain no meshes',async()=>{
    const result=await A.run({...quick,initial,maxEvaluations:2,evaluate:c=>{
      if(c.scalePercent===100)throw new Error('Analysis work limit reached.');
      return {score:1,checks:checks(),value:{largeMesh:true}};
    },onProgress:p=>{p.candidate.heightMm=999;if(p.checks[0])p.checks[0].status='fail';}});
    assert.equal(result.status,'accepted');assert.deepEqual(result.candidate,initial);
    assert.ok(result.attempts.every(a=>!('value'in a)&&a.candidate.heightMm!==999));
    assert.equal(result.checks[0].status,'pass');assert.equal(result.attempts[1].ok,false);
  });
  await test('invalid settings fail before geometry or state can be touched',async()=>{
    for(const extra of [{maxEvaluations:100},{timeBudgetMs:Infinity},{mode:'beauty'},{minHeightMm:31},{requiredChecks:[]},{requiredChecks:'attachment'}]) {
      await assert.rejects(A.run({...quick,initial,evaluate:()=>{throw Error('must not evaluate');},...extra}),TypeError);
    }
  });
  console.log(count+' physical autofinish groups passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
