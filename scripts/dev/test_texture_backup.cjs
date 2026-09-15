/* UV texture durability through real IndexedDB helpers and editable V4 backups. */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const harness=fs.readFileSync(path.join(__dirname,'test_finished_product_library.cjs'),'utf8'),end=harness.indexOf('let passed=0;');assert.ok(end>0);
const fixture=Function('require','__dirname',harness.slice(0,end)+'\nreturn fixture;')(require,__dirname);
const Color=require('../../web/parts/keycap-color.js');
const same=(a,b)=>assert.deepEqual(Array.from(a),Array.from(b));
function texture(){return {version:1,positionLength:9,baseColors:new Float32Array(9).fill(.75),textures:[{start:0,count:3,
 uvs:new Float32Array([0,0,1,0,0,1]),width:2,height:2,data:new Uint8ClampedArray([255,0,0,255,0,255,0,255,0,0,255,255,255,255,255,255]),
 wrapS:33071,wrapT:33648,filter:'nearest'}]};}
function setup(){const f=fixture();Object.assign(f.ctx,{keycapColor:Color,Uint8Array,Uint8ClampedArray,TextEncoder,TextDecoder});
 const rec={name:'UV Puppy',kind:'sculpt',positions:new Float32Array([0,0,0,1,0,0,0,1,1]),sourceTexture:texture(),
   sourceColors:new Float32Array(9).fill(.5),sourceColorKind:'texture',meshySource:{previewId:'original-task',refineId:'texture-task'},product:f.product()};
 return {f,rec,api:f.ctx.studioLibrary.backup};}
function parts(buffer){const v=new DataView(buffer),lengths=[8,12,16,20,24,28].map(n=>v.getUint32(n,true)),meta=JSON.parse(new TextDecoder().decode(new Uint8Array(buffer,32,lengths[0])));
 let offset=32+lengths[0];const chunks=lengths.slice(1).map(n=>{const c=new Uint8Array(buffer.slice(offset,offset+n));offset+=n;return c;});return {meta,chunks};}
async function rewrite(buffer,edit){const p=parts(buffer);edit(p);const meta=new TextEncoder().encode(JSON.stringify(p.meta)),head=buffer.slice(0,32),v=new DataView(head);v.setUint32(8,meta.length,true);
 p.chunks.forEach((c,i)=>v.setUint32(12+i*4,c.length,true));return new Blob([head,meta,...p.chunks]).arrayBuffer();}
function hash(bytes){let h=2166136261;for(const b of bytes)h=Math.imul(h^b,16777619)>>>0;return h.toString(16).padStart(8,'0');}
let passed=0;async function test(n,fn){await fn();passed++;console.log('PASS '+n);}
(async()=>{
 await test('Library snapshots UVs, pixels, tint and provenance before asynchronous storage opens',async()=>{
  const {f,rec}=setup(),pixels=Array.from(rec.sourceTexture.textures[0].data),uv=Array.from(rec.sourceTexture.textures[0].uvs),raw=Array.from(rec.positions);
  const saving=f.ctx.keycapLibrary.save(rec);rec.sourceTexture.textures[0].data.fill(0);rec.sourceTexture.textures[0].uvs.fill(4);rec.sourceTexture.baseColors.fill(0);rec.meshySource.previewId='changed';rec.positions.fill(9);
  const result=await saving,stored=await f.ctx.keycapLibrary.get(result.id);same(stored.sourceTexture.textures[0].data,pixels);same(stored.sourceTexture.textures[0].uvs,uv);same(stored.positions,raw);
  assert.equal(stored.sourceTexture.baseColors[0],.75);assert.equal(stored.meshySource.previewId,'original-task');
  const row=(await f.ctx.keycapLibrary.list())[0];assert.equal(row.sourceTexture,undefined);assert.equal(row.sourceColors,undefined);
 });
 await test('invalid texture rejects a save explicitly without deleting existing geometry',async()=>{
  const {f,rec}=setup();const first=await f.ctx.keycapLibrary.save({...rec,id:'kept'});rec.sourceTexture.textures[0].uvs[0]=NaN;
  await assert.rejects(f.ctx.keycapLibrary.save({...rec,id:'kept'}),/texture could not be verified/);
  assert.ok((await f.ctx.keycapLibrary.get(first.id)).sourceTexture);assert.equal(f.records.size,1);
 });
 await test('V4 transfers exact UV texture, material colors, geometry, product signature and Meshy provenance',async()=>{
  const {api,rec}=setup(),buffer=await api.encode(rec).arrayBuffer();assert.equal(new TextDecoder().decode(new Uint8Array(buffer,0,8)),'TMDES004');
  const got=api.decode(buffer);assert.equal(got.warning,'');same(got.record.positions,rec.positions);same(got.record.product.positions,rec.product.positions);
  assert.equal(got.record.product.signature,rec.product.signature);assert.equal(got.record.product.fit.slotMm,1.25);
  same(got.record.sourceTexture.textures[0].uvs,rec.sourceTexture.textures[0].uvs);same(got.record.sourceTexture.textures[0].data,rec.sourceTexture.textures[0].data);
  assert.equal(got.record.sourceTexture.textures[0].filter,'nearest');assert.equal(got.record.sourceTexture.textures[0].wrapT,33648);
  assert.equal(got.record.meshySource.previewId,'original-task');assert.equal(got.record.meshySource.refineId,'texture-task');assert.equal(got.record.id,undefined);
 });
 await test('V4 supports texture-only appearance with no sampled corner color array',async()=>{
  const {api,rec}=setup();delete rec.sourceColors;delete rec.sourceColorKind;const got=api.decode(await api.encode(rec).arrayBuffer());
  assert.ok(got.record.sourceTexture);assert.equal(got.record.sourceColors,undefined);assert.equal(got.warning,'');
 });
 await test('damaged texture tail drops only texture with a visible warning',async()=>{
  const {api,rec}=setup(),buffer=await api.encode(rec).arrayBuffer();new Uint8Array(buffer)[buffer.byteLength-1]^=1;const got=api.decode(buffer);
  assert.equal(got.record.sourceTexture,null);assert.match(got.warning,/UV texture could not be verified/);same(got.record.positions,rec.positions);same(got.record.sourceColors,rec.sourceColors);same(got.record.product.positions,rec.product.positions);
 });
 await test('forged lengths, UVs, range and unsupported filters cannot pass by recomputing a hash',async()=>{
  const {api,rec}=setup(),buffer=await api.encode(rec).arrayBuffer();
  for(const mutate of [p=>p.meta.sourceTexture.entries[0].count=6,p=>p.meta.sourceTexture.entries[0].filter='magic',p=>p.meta.sourceTexture.positionLength=18,p=>new DataView(p.chunks[4].buffer).setFloat32(36,NaN,true)]){
   const corrupt=await rewrite(buffer,p=>{mutate(p);p.meta.sourceTextureHash=hash(p.chunks[4]);});const got=api.decode(corrupt);assert.equal(got.record.sourceTexture,null);assert.ok(got.record.product);
  }
 });
 await test('truncated or oversized texture framing rejects the file rather than reading outside it',async()=>{
  const {api,rec}=setup(),buffer=await api.encode(rec).arrayBuffer();assert.throws(()=>api.decode(buffer.slice(0,-1)),/lengths/);
  new DataView(buffer).setUint32(28,0xffffffff,true);assert.throws(()=>api.decode(buffer),/lengths/);
 });
 await test('V4 texture coexists with editable topper source without changing either mesh',async()=>{
  const {api,rec}=setup();rec.topperSource=new Float32Array(rec.positions);rec.topperRecipe={version:1,fields:{tpPreset:'pencil',tpPrompt:'Puppy'}};
  const got=api.decode(await api.encode(rec).arrayBuffer());same(got.record.topperSource,rec.topperSource);same(got.record.positions,rec.positions);assert.ok(got.record.sourceTexture);assert.equal(got.warning,'');
 });
 await test('plain V1 keeps preview provenance while excluding arbitrary record secrets',async()=>{
  const {api,rec}=setup();delete rec.sourceTexture;delete rec.sourceColors;delete rec.sourceColorKind;rec.apiKey='DO-NOT-EXPORT';rec.meshySource.apiKey='DO-NOT-EXPORT';
  const buffer=await api.encode(rec).arrayBuffer();assert.equal(new TextDecoder().decode(new Uint8Array(buffer,0,8)),'TMDES001');
  assert.ok(!new TextDecoder().decode(buffer).includes('DO-NOT-EXPORT'));assert.equal(api.decode(buffer).record.meshySource.previewId,'original-task');
 });
 console.log(passed+' texture persistence/backup groups passed; no network or printer access.');
})().catch(e=>{console.error(e);process.exitCode=1;});
