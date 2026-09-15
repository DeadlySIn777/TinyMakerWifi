// V3 keeps the original topper sculpt separate from its assembled cap.
const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('node:assert/strict');
const ctx={Float32Array,Uint8Array,ArrayBuffer,DataView,Blob,TextEncoder,TextDecoder,Math,Number,Date};ctx.window=ctx;vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname,'../../web/parts/studio-library.js'),'utf8'),ctx);
const B=ctx.studioLibrary.backup;
const f={tpPreset:'round',tpModel:'Painted flower pencil',tpShape:'round',tpWidth:'7',tpSecondWidth:'7',tpDepth:'10',tpWall:'1.6',tpFit:'.2',tpArtHeight:'18',tpArtRotation:'30',tpPrompt:'Chunky flower'};
const rec={kind:'model',name:'Flower topper',positions:new Float32Array([0,0,0,3,0,0,0,3,2]),topperRecipe:{version:1,fields:f},topperSource:new Float32Array([0,0,0,1,0,0,0,1,1])};
const equal=(a,b)=>assert.deepEqual([...a],[...b]);
(async()=>{
 const buffer=await B.encode(rec).arrayBuffer(),got=B.decode(buffer);assert.equal(new TextDecoder().decode(buffer.slice(0,8)),'TMDES003');equal(got.record.positions,rec.positions);equal(got.record.topperSource,rec.topperSource);assert.equal(JSON.stringify(got.record.topperRecipe),JSON.stringify(rec.topperRecipe));assert.equal(got.warning,'');
 const colored={...rec,sourceColors:new Float32Array(9).fill(.4),sourceColorKind:'material'};let c=B.decode(await B.encode(colored).arrayBuffer());equal(c.record.sourceColors,colored.sourceColors);equal(c.record.topperSource,rec.topperSource);
 const plain={...rec,topperSource:null};let p=await B.encode(plain).arrayBuffer();assert.equal(new TextDecoder().decode(p.slice(0,8)),'TMDES001');assert.equal(JSON.stringify(B.decode(p).record.topperRecipe),JSON.stringify(rec.topperRecipe));
 const bad=buffer.slice(0);new Uint8Array(bad)[bad.byteLength-1]^=1;const rescued=B.decode(bad);equal(rescued.record.positions,rec.positions);assert.equal(rescued.record.topperSource,null);assert.equal(rescued.record.topperRecipe,null);assert.match(rescued.warning,/original topper artwork/);
 assert.throws(()=>B.encode({...rec,topperRecipe:null}),/settings are invalid/);assert.throws(()=>B.encode({...rec,topperRecipe:{version:2,fields:f}}),/unsupported/);assert.throws(()=>B.encode({...rec,topperSource:new Float32Array([NaN,1,2])}),/complete triangles/);
 assert.throws(()=>B.decode(buffer.slice(0,-1)),/incomplete|lengths/);
 const extras={...rec,topperRecipe:{version:1,fields:{...f,meshyKey:'SECRET-DO-NOT-EXPORT'}}};const safe=await B.encode(extras).arrayBuffer();assert.equal(new TextDecoder().decode(safe).includes('SECRET'),false);
 console.log('7 topper backup groups pass: source/assembly separation, color coexistence, V1 plain cap, corrupt source recovery, validation, truncation, secret exclusion');
})().catch(e=>{console.error(e);process.exitCode=1;});
