/* Editable Library color backups: V1 compatibility, V2 fidelity and recovery. */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const ctx={console,Math,Number,Date,Float32Array,Uint8Array,ArrayBuffer,DataView,Blob,TextEncoder,TextDecoder,
  keycap:{usableBed:()=>({x:30,y:30}),BED:{zSupported:40,zFlat:40}}};ctx.window=ctx;vm.createContext(ctx);
for(const file of ['keycap-product.js','studio-library.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../../web/parts',file),'utf8'),ctx,{filename:file});
const api=ctx.studioLibrary.backup;
const source=()=>new Float32Array([0,0,0,1,0,0,0,1,1]);
const colors=()=>new Float32Array([1,0,.5,0,.25,1,.1,.9,.3]);
const assembly=()=>new Float32Array([0,0,0,0,3,0,2,0,0,0,0,0,2,0,0,0,0,4,
  0,0,0,0,0,4,0,3,0,2,0,0,0,3,0,0,0,4]);
function record(colored=true){return {name:'Painted puppy',kind:'sculpt',prompt:'Round puppy',positions:source(),
  sourceColors:colored?colors():null,sourceColorKind:colored?'texture':null,
  design:'TMK1-a',facts:{sizeMm:[18,18,25]},
  product:ctx.keycapProduct.capture({positions:assembly(),issues:[],fit:{slotMm:1.25},recipe:'TMK1-a',checkedAt:1234})};}
function magic(buffer){return new TextDecoder().decode(new Uint8Array(buffer,0,8));}
function parts(buffer){const v=new DataView(buffer),head=magic(buffer)==='TMDES002'?24:20,m=v.getUint32(8,true),s=v.getUint32(12,true),p=v.getUint32(16,true);
  return {head,meta:JSON.parse(new TextDecoder().decode(new Uint8Array(buffer,head,m))),
    source:new Uint8Array(buffer.slice(head+m,head+m+s)),product:new Uint8Array(buffer.slice(head+m+s,head+m+s+p)),
    colors:new Uint8Array(buffer.slice(head+m+s+p))};}
async function rewrite(buffer,change){const x=parts(buffer);change(x);const meta=new TextEncoder().encode(JSON.stringify(x.meta));
  const header=buffer.slice(0,x.head),v=new DataView(header);v.setUint32(8,meta.length,true);v.setUint32(12,x.source.length,true);v.setUint32(16,x.product.length,true);
  if(x.head===24)v.setUint32(20,x.colors.length,true);return new Blob([header,meta,x.source,x.product,x.colors]).arrayBuffer();}
function hash(bytes){let h=2166136261;for(const byte of bytes)h=Math.imul(h^byte,16777619)>>>0;return h.toString(16).padStart(8,'0');}
function same(a,b){assert.deepEqual(Array.from(a),Array.from(b));}
let passed=0;async function test(name,fn){await fn();console.log('OK '+name);passed++;}
(async()=>{
  await test('uncolored files keep the original V1 header and round trip',async()=>{const rec=record(false),b=await api.encode(rec).arrayBuffer();assert.equal(magic(b),'TMDES001');
    const got=api.decode(b);same(got.record.positions,rec.positions);same(got.record.product.positions,rec.product.positions);assert.equal(got.warning,'');assert.equal(got.record.sourceColors,undefined);});
  await test('V2 keeps exact source, product, color channels, kind, recipe and fit',async()=>{const rec=record(),b=await api.encode(rec).arrayBuffer();assert.equal(magic(b),'TMDES002');
    const got=api.decode(b);same(got.record.positions,rec.positions);same(got.record.product.positions,rec.product.positions);same(got.record.sourceColors,rec.sourceColors);
    assert.equal(got.record.sourceColorKind,'texture');assert.equal(got.record.design,rec.design);assert.equal(got.record.product.fit.slotMm,1.25);assert.equal(got.warning,'');
    assert.equal(ctx.keycapProduct.validate(got.record.product),true);assert.equal(got.record.id,undefined);
    const p=parts(b);assert.equal(p.meta.sourceColorCount,9);assert.equal(p.meta.sourceColorHash,hash(p.colors));});
  await test('all supported source-color kinds survive',async()=>{for(const kind of ['material','vertex','texture','partial']){const rec=record();rec.sourceColorKind=kind;assert.equal(api.decode(await api.encode(rec).arrayBuffer()).record.sourceColorKind,kind);}});
  await test('typed-array subviews export only their exact source and color range',async()=>{const rec=record();const backing=new Float32Array(27).fill(99);backing.set(colors(),9);rec.sourceColors=backing.subarray(9,18);
    same(api.decode(await api.encode(rec).arrayBuffer()).record.sourceColors,colors());});
  await test('model, artwork-only and blocked-product backups keep color',async()=>{for(const mode of ['model','artwork','blocked']){const rec=record();
    if(mode==='model')rec.kind='model';rec.product=mode==='blocked'?ctx.keycapProduct.capture({positions:null,issues:['Needs attachment'],fit:{slotMm:1.25},recipe:'TMK1-a'}):null;
    const got=api.decode(await api.encode(rec).arrayBuffer());same(got.record.sourceColors,rec.sourceColors);assert.equal(got.warning,'');}});
  await test('incorrect export type, count, RGB or provenance fails explicitly',async()=>{
    for(const bad of [[1,0,0],new Float32Array(3),new Float32Array(9).fill(NaN),new Float32Array(9).fill(-.1),new Float32Array(9).fill(1.1)])assert.throws(()=>api.encode({...record(),sourceColors:bad}),/source colors/);
    assert.throws(()=>api.encode({...record(),sourceColorKind:'guessed'}),/source color type/);});
  await test('a damaged color byte restores verified geometry and product with a warning',async()=>{const rec=record(),b=await api.encode(rec).arrayBuffer();new Uint8Array(b)[b.byteLength-1]^=1;
    const got=api.decode(b);same(got.record.positions,rec.positions);same(got.record.product.positions,rec.product.positions);assert.equal(got.record.sourceColors,null);assert.equal(got.record.sourceColorKind,null);
    assert.match(got.warning,/Source colors could not be verified/);assert.ok(got.record.facts);});
  await test('invalid colors cannot pass just by recomputing their checksum',async()=>{const rec=record();for(const value of [NaN,Infinity,-1,2]){
    const b=await rewrite(await api.encode(rec).arrayBuffer(),x=>{new DataView(x.colors.buffer).setFloat32(0,value,true);x.meta.sourceColorHash=hash(x.colors);});
    const got=api.decode(b);assert.equal(got.record.sourceColors,null);same(got.record.positions,rec.positions);assert.match(got.warning,/Source colors/);}});
  await test('changed color count, hash and provenance cannot claim original colors',async()=>{const b=await api.encode(record()).arrayBuffer();for(const mutate of [m=>m.sourceColorCount=8,m=>m.sourceColorCount='9',m=>delete m.sourceColorHash,m=>m.sourceColorKind='ai-guessed']){
    const got=api.decode(await rewrite(b,x=>mutate(x.meta)));assert.equal(got.record.sourceColors,null);assert.match(got.warning,/Source colors/);assert.ok(got.record.product);}});
  await test('a self-consistent but short color section remains optional',async()=>{const rec=record(),b=await rewrite(await api.encode(rec).arrayBuffer(),x=>{x.colors=x.colors.slice(0,-4);x.meta.sourceColorHash=hash(x.colors);});
    const got=api.decode(b);same(got.record.positions,rec.positions);same(got.record.product.positions,rec.product.positions);assert.equal(got.record.sourceColors,null);assert.match(got.warning,/Source colors/);});
  await test('corrupted source geometry still rejects V2 instead of recovering wrong geometry',async()=>{const b=await rewrite(await api.encode(record()).arrayBuffer(),x=>x.source[0]^=1);assert.throws(()=>api.decode(b),/source geometry is damaged/);});
  await test('a damaged product drops only the product, keeping the source color',async()=>{const rec=record(),b=await rewrite(await api.encode(rec).arrayBuffer(),x=>new DataView(x.product.buffer).setFloat32(0,9,true));
    const got=api.decode(b);assert.equal(got.record.product,null);assert.equal(got.record.facts,null);same(got.record.sourceColors,rec.sourceColors);assert.match(got.warning,/assembly could not be verified/);});
  await test('both recoverable failures are reported together',async()=>{const rec=record(),b=await rewrite(await api.encode(rec).arrayBuffer(),x=>{new DataView(x.product.buffer).setFloat32(0,9,true);x.colors[0]^=1;});
    const got=api.decode(b);assert.equal(got.record.product,null);assert.equal(got.record.sourceColors,null);same(got.record.positions,rec.positions);assert.match(got.warning,/assembly could not be verified.*Source colors could not be verified/);});
  await test('truncated files and excessive or impossible lengths remain rejected',async()=>{const b=await api.encode(record()).arrayBuffer();assert.throws(()=>api.decode(b.slice(0,-1)),/lengths/);
    for(const size of [1,60*1024*1024+1,0xffffffff]){const broken=b.slice(0);new DataView(broken).setUint32(20,size,true);assert.throws(()=>api.decode(broken),/lengths/);}
    const short=new ArrayBuffer(20);new Uint8Array(short).set(new TextEncoder().encode('TMDES002'));assert.throws(()=>api.decode(short),/header/);});
  await test('backup metadata still excludes credentials and arbitrary record fields',async()=>{const rec={...record(),apiKey:'DO-NOT-SAVE',wifiPassword:'DO-NOT-SAVE',debug:'DO-NOT-SAVE'};
    const p=parts(await api.encode(rec).arrayBuffer());assert.ok(!JSON.stringify(p.meta).includes('DO-NOT-SAVE'));});
  console.log(passed+' color-backup regression groups passed; no network, browser or printer access.');
})().catch(e=>{console.error(e);process.exitCode=1;});
