'use strict';
// Execute the real API helper, with an inert fetch recording its attempts.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync(path.join(__dirname,'../../web/dashboard.html'),'utf8');
const code=source.slice(source.indexOf('const api=async('),source.indexOf('// Snackbar. Info messages'));
async function run(opt,mode){let calls=[],settled=0;const ctx={Object,JSON,Error,TypeError,Promise,AbortController,clearTimeout,setTimeout:(f)=>{queueMicrotask(f);return 0;},
 writesInFlight:0,statusData:{},writeStarted(){},writeSettled(){settled++;},
 fetch:async(url,options)=>{calls.push({url,options});if(calls.length===1)throw new TypeError('Failed to fetch');return {ok:true,json:async()=>({ok:true,queued:true})};}};
 vm.createContext(ctx);vm.runInContext(code+'\nthis.run=api;',ctx);let result,error;try{result=await ctx.run('/api/print/start?name=cap',opt);}catch(e){error=e.message;}
 return {result,error,calls,settled,writes:ctx.writesInFlight};}
(async()=>{
 const start=await run({method:'POST',retryNetwork:false});assert.equal(start.calls.length,1);assert.match(start.error,/unreachable/);assert.equal(start.writes,0);assert.equal(start.settled,1);assert.equal('retryNetwork'in start.calls[0].options,false);assert.equal(start.calls[0].options.headers['X-TinyMaker'],'1');
 const legacy=await run({method:'POST'});assert.equal(legacy.calls.length,2);assert.equal(legacy.result.queued,true);assert.equal(legacy.writes,0);assert.equal(legacy.settled,1);
 const read=await run({});assert.equal(read.calls.length,2);assert.equal(read.result.queued,true);assert.equal(read.settled,0);
 console.log('3 API retry groups pass: Start is never automatically resent; existing read/write behavior and bookkeeping remain intact. No network or printer.');
})().catch(e=>{console.error(e);process.exitCode=1;});
