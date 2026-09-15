'use strict';
// Actual receipt helper with a fake clock and status responses. No network.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync(path.join(__dirname,'../../web/parts/slicer.js'),'utf8');
const helper=source.slice(source.indexOf('async function slicerConfirmImport('),source.indexOf('// Final support/raft bounds,'));
assert.ok(helper.startsWith('async function slicerConfirmImport('));
const id='0123456789abcdef0123456789abcdef';
function fixture(responses,repeat){let elapsed=0;const calls=[],ctx={Promise,Math,Error,Date:{now:()=>elapsed},setTimeout(fn,ms){elapsed+=ms;queueMicrotask(fn);},
 api:async(path,opts,timeout)=>{calls.push({path,timeout});const r=responses.length?responses.shift():repeat;if(r instanceof Error)throw r;return r;}};
 vm.createContext(ctx);vm.runInContext(helper,ctx);return {run:()=>ctx.slicerConfirmImport(id),calls,time:()=>elapsed};}
const result=(ok=true,name='cap')=>({importResult:{id,ok,name,error:ok?'':'SD write failed'}});
let passed=0;async function test(name,fn){await fn();passed++;console.log('PASS '+name);}
(async()=>{
 await test('matching successful receipt returns the final renamed name',async()=>{const f=fixture([result(true,'cap_2')]);assert.equal((await f.run()).name,'cap_2');assert.equal(f.calls.length,1);});
 await test('previous successful receipt cannot finish a new pending import',async()=>{const f=fixture([{sdJob:'import',importResult:{id:'old',ok:true,name:'wrong'}},result()]);assert.equal((await f.run()).name,'cap');assert.equal(f.calls.length,2);});
 await test('explicit import failure retains its diagnostic and retry classification',async()=>{await assert.rejects(fixture([result(false)]).run(),e=>e.importFailed===true&&/SD write failed/.test(e.message));});
 await test('empty invalid and missing final names never fall back to the requested name',async()=>{for(const name of ['',undefined,'../old','<cap>']){const r=result();r.importResult.name=name;await assert.rejects(fixture([r]).run(),/incomplete import receipt/);}});
 await test('temporary read failure can recover to the exact receipt',async()=>{const f=fixture([new Error('offline'),result()]);assert.equal((await f.run()).id,id);assert.equal(f.calls.length,2);});
 await test('three consecutive failed reads stop without claiming completion',async()=>{const f=fixture([],new Error('offline'));await assert.rejects(f.run(),/Connection lost while confirming/);assert.equal(f.calls.length,3);});
 await test('three idle reads after reboot or unrelated imports allow only an explicit retry',async()=>{for(const r of [{busy:false,importResult:null},{busy:false,importResult:{id:'other',ok:true,name:'old'}}]){const f=fixture([],r);await assert.rejects(f.run(),e=>e.receiptUnavailable===true&&/could not be verified/.test(e.message));assert.equal(f.calls.length,3);}});
 await test('busy and receiving states cannot count as evidence of a stale receipt',async()=>{const f=fixture([{busy:false},{busy:false},{busy:true},{receiving:true},{sdJob:'delete'},result()]);assert.equal((await f.run()).name,'cap');assert.equal(f.calls.length,6);});
 await test('pending imports use a wall-clock deadline and keep their receipt recoverable',async()=>{const f=fixture([],{busy:true,sdJob:'import',importResult:null});await assert.rejects(f.run(),/not finished confirming/);assert.equal(f.time(),180000);assert.ok(f.calls.every(c=>c.path==='/api/status'&&c.timeout>0&&c.timeout<=8000));});
 console.log(passed+' import confirmation groups passed; no printer or network access.');
})().catch(e=>{console.error(e);process.exitCode=1;});
