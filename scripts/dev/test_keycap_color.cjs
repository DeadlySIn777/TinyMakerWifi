/* Source color is optional, preserved per corner, and never changes geometry. */
const assert=require('node:assert/strict');
const {parseGLB}=require('../../web/parts/meshy-glb.js');
const color=require('../../web/parts/keycap-color.js');
function glb(doc,bin){
  const j=Buffer.from(JSON.stringify(doc)), jp=Buffer.concat([j,Buffer.alloc((4-j.length%4)%4,32)]);
  const bp=Buffer.concat([bin,Buffer.alloc((4-bin.length%4)%4)]),out=Buffer.alloc(28+jp.length+bp.length);
  out.writeUInt32LE(0x46546c67,0);out.writeUInt32LE(2,4);out.writeUInt32LE(out.length,8);
  out.writeUInt32LE(jp.length,12);out.writeUInt32LE(0x4e4f534a,16);jp.copy(out,20);
  out.writeUInt32LE(bp.length,20+jp.length);out.writeUInt32LE(0x004e4942,24+jp.length);bp.copy(out,28+jp.length);
  return out.buffer.slice(out.byteOffset,out.byteOffset+out.length);
}
function fixture({vertex=false,material=false,texture=false,mirror=false,mutate=()=>{}}={}){
  const pieces=[Buffer.from(new Float32Array([0,0,0,1,0,0,0,1,0]).buffer),
    Buffer.from(new Float32Array([0,0,1,0,0,1]).buffer),Buffer.from([255,0,0,255,0,255,0,255,0,0,255,255])];
  const g={asset:{version:'2.0'},nodes:[{mesh:0,scale:mirror?[-1,1,1]:[1,1,1]}],
    meshes:[{primitives:[{attributes:{POSITION:0,TEXCOORD_0:1}}]}],
    accessors:[{bufferView:0,componentType:5126,count:3,type:'VEC3'},
      {bufferView:1,componentType:5126,count:3,type:'VEC2'},
      {bufferView:2,componentType:5121,count:3,type:'VEC4',normalized:true}],
    bufferViews:[{buffer:0,byteOffset:0,byteLength:36},{buffer:0,byteOffset:36,byteLength:24},{buffer:0,byteOffset:60,byteLength:12}],
    buffers:[{byteLength:72}]};
  if(vertex)g.meshes[0].primitives[0].attributes.COLOR_0=2;
  if(material||texture){g.meshes[0].primitives[0].material=0;g.materials=[{pbrMetallicRoughness:{}}];}
  if(material)g.materials[0].pbrMetallicRoughness.baseColorFactor=[0.5,0.25,1,1];
  if(texture){
    const png=Buffer.alloc(24);png.writeUInt32BE(0x89504e47,0);png.writeUInt32BE(0x0d0a1a0a,4);png.writeUInt32BE(0x49484452,12);png.writeUInt32BE(2,16);png.writeUInt32BE(2,20);
    pieces.push(png);g.bufferViews.push({buffer:0,byteOffset:72,byteLength:24});g.buffers[0].byteLength+=24;
    g.images=[{bufferView:3,mimeType:'image/png'}];g.textures=[{source:0,sampler:0}];g.samplers=[{wrapS:33071,wrapT:33071}];
    g.materials[0].pbrMetallicRoughness.baseColorTexture={index:0};
  }
  mutate(g,pieces);return parseGLB(glb(g,Buffer.concat(pieces)));
}
function near(a,b){assert.equal(a.length,b.length);a.forEach((v,i)=>assert.ok(Math.abs(v-b[i])<1e-6,`${i}: ${v} != ${b[i]}`));}
(async()=>{
  let checks=0;
  const plain=fixture();assert.equal(plain.colors,null);assert.equal(plain.colorReference.kind,'none');checks++;
  const mat=fixture({material:true});near([...mat.colors],[.5,.25,1,.5,.25,1,.5,.25,1]);assert.equal(mat.colorReference.kind,'material');checks++;
  const rgb=fixture({vertex:true});near([...rgb.colors],[1,0,0,0,1,0,0,0,1]);assert.equal(rgb.colorReference.kind,'vertex');checks++;
  const combined=fixture({vertex:true,material:true});near([...combined.colors],[.5,0,0,0,.25,0,0,0,1]);assert.deepEqual(combined.positions,plain.positions);checks++;
  const mirrored=fixture({vertex:true,mirror:true});near([...mirrored.colors],[0,0,1,0,1,0,1,0,0]);assert.deepEqual([...mirrored.uvs],[0,1,1,0,0,0]);checks++;
  const indexedColors=fixture({vertex:true,mutate:(g,pieces)=>{
    pieces.push(Buffer.from([2,0,1,0]));g.buffers[0].byteLength+=4;
    g.bufferViews.push({buffer:0,byteOffset:72,byteLength:3});g.accessors.push({bufferView:3,componentType:5121,count:3,type:'SCALAR'});
    g.meshes[0].primitives[0].indices=3;
  }});near([...indexedColors.colors],[0,0,1,1,0,0,0,1,0]);checks++;
  const invalid=fixture({vertex:true,material:true,mutate:g=>g.accessors[2].normalized=false});assert.equal(invalid.colorReference.kind,'partial');near([...invalid.colors],[.5,.25,1,.5,.25,1,.5,.25,1]);assert.deepEqual(invalid.positions,plain.positions);checks++;
  const count=fixture({vertex:true,mutate:g=>g.accessors[2].count=2});assert.equal(count.colors,null);assert.deepEqual(count.positions,plain.positions);checks++;
  const tx=fixture({texture:true,vertex:true,mirror:true});assert.equal(tx.colorReference.kind,'pending');assert.equal(tx.colorReference.textureJobs.length,1);
  assert.deepEqual([...tx.colorReference.textureJobs[0].uvs],[0,1,1,0,0,0]);assert.equal(tx.colorReference.textureJobs[0].count,3);checks++;
  const remote=fixture({texture:true,mutate:g=>{g.images[0]={uri:'https://example.invalid/color.png'};}});assert.equal(remote.colorReference.kind,'partial');assert.equal(remote.colors,null);assert.deepEqual(remote.positions,plain.positions);checks++;
  const wrongUV=fixture({texture:true,mutate:g=>g.materials[0].pbrMetallicRoughness.baseColorTexture.texCoord=1});assert.equal(wrongUV.colors,null);checks++;
  const transformed=fixture({texture:true,mutate:g=>g.materials[0].pbrMetallicRoughness.baseColorTexture.extensions={KHR_texture_transform:{offset:[.5,.25],scale:[.5,.5]}}});near([...transformed.colorReference.textureJobs[0].uvs],[.5,.25,1,.25,.5,.75]);checks++;
  const pixels={width:2,height:2,data:Uint8ClampedArray.from([255,0,0,255,0,255,0,255,0,0,255,255,128,128,128,255])};
  const job={start:0,count:3,uvs:new Float32Array([0,0,1,0,0,1]),wrapS:33071,wrapT:33071},sample=new Float32Array(9).fill(1);
  color.sampleTexture(sample,job,pixels);near([...sample],[1,0,0,0,1,0,0,0,1]);checks++;
  const gray=new Float32Array(3).fill(.5);color.sampleTexture(gray,{...job,count:1,uvs:[1,1]},pixels);near([...gray],[.10793025,.10793025,.10793025]);checks++;
  const unchanged=new Float32Array(9).fill(1);assert.throws(()=>color.sampleTexture(unchanged,{...job,uvs:[0,0,1,0,NaN,0]},pixels));assert.deepEqual([...unchanged],Array(9).fill(1));checks++;
  assert.deepEqual(color.imageDimensions(tx.colorReference.textureJobs[0].bytes,'image/png'),{width:2,height:2});
  const huge=tx.colorReference.textureJobs[0].bytes.slice();new DataView(huge.buffer).setUint32(16,999999);assert.throws(()=>color.imageDimensions(huge,'image/png'));checks++;
  near([...color.reorderForSeat(rgb.colors)],[1,0,0,0,0,1,0,1,0]);assert.equal(color.validColors(rgb.colors,rgb.positions),true);assert.equal(color.validColors(new Float32Array([NaN]),rgb.positions),false);checks++;
  const noDecode=await color.fromGLB(fixture({texture:true}));assert.equal(noDecode.colors,null);assert.equal(noDecode.kind,'none');checks++;
  const baseFallback=await color.fromGLB(fixture({texture:true,material:true}));assert.equal(baseFallback.kind,'partial');near([...baseFallback.colors],[.5,.25,1,.5,.25,1,.5,.25,1]);checks++;
  const materialResult=await color.fromGLB(mat);assert.equal(materialResult.kind,'material');assert.deepEqual(materialResult.colors,mat.colors);checks++;
  const multiple=fixture({material:true,mutate:g=>{g.meshes[0].primitives.push({...g.meshes[0].primitives[0],material:1});g.materials.push({pbrMetallicRoughness:{baseColorFactor:[1,0,0,1]}});}});
  assert.equal(multiple.triangles,2);near([...multiple.colors.slice(9)],[1,0,0,1,0,0,1,0,0]);checks++;
  assert.throws(()=>fixture({vertex:true,mutate:g=>{g.accessors.push({bufferView:2,componentType:5121,count:3,type:'SCALAR',byteOffset:0});
    // Color bytes begin 255,0,0; invalid index must still reject geometry.
    g.meshes[0].primitives[0].indices=3;}}),/index points past/);checks++;
  console.log(checks+' source-color checks passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
