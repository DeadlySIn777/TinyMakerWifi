/* Real GLB -> embedded PNG decode -> software UV rasterizer. Synthetic source;
 * no remote service, paid generation, printer, or existing browser profile. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.TINYMAKER_PLAYWRIGHT||'playwright');
const root=path.resolve(__dirname,'../..');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_BIN||undefined});
 try{
  const page=await browser.newPage({viewport:{width:850,height:410}}),errors=[],requests=[];
  page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',r=>{requests.push(r.request().url());return r.abort();});
  await page.setContent('<!doctype html><style>body{background:#12161b;color:#eee;font:16px Arial;display:flex;margin:0}section{width:420px;text-align:center}canvas{width:400px;height:340px}</style><section><h3>Old corner samples</h3><canvas id="old"></canvas></section><section><h3>Actual UV texture</h3><canvas id="uv"></canvas></section>');
  for(const name of ['meshy-glb.js','keycap-color.js','keycap-view3d.js'])await page.addScriptTag({content:fs.readFileSync(path.join(root,'web/parts',name),'utf8')});
  const result=await page.evaluate(async()=>{
   const input=document.createElement('canvas');input.width=input.height=128;const context=input.getContext('2d');
   context.fillStyle='#ff0000';context.fillRect(0,0,128,128);
   context.fillStyle='#00ff00';context.fillRect(24,32,20,22);context.fillRect(84,32,20,22);
   context.fillStyle='#0000ff';context.fillRect(42,74,44,15);
   // Detailed interior stripes cannot be reconstructed from six red corners.
   context.fillStyle='#ffffff';for(let x=46;x<84;x+=8)context.fillRect(x,77,3,8);
   const png=new Uint8Array(await (await new Promise(r=>input.toBlob(r,'image/png'))).arrayBuffer());
   const positions=new Float32Array([-1,0,1,1,0,1,1,0,-1,-1,0,1,1,0,-1,-1,0,-1]);
   const uvs=new Float32Array([0,0,1,0,1,1,0,0,1,1,0,1]);
   const imageOffset=positions.byteLength+uvs.byteLength,bin=new Uint8Array(imageOffset+png.length);
   bin.set(new Uint8Array(positions.buffer));bin.set(new Uint8Array(uvs.buffer),positions.byteLength);bin.set(png,imageOffset);
   const doc={asset:{version:'2.0'},buffers:[{byteLength:bin.length}],bufferViews:[{buffer:0,byteOffset:0,byteLength:positions.byteLength},{buffer:0,byteOffset:positions.byteLength,byteLength:uvs.byteLength},{buffer:0,byteOffset:imageOffset,byteLength:png.length}],
    accessors:[{bufferView:0,componentType:5126,count:6,type:'VEC3'},{bufferView:1,componentType:5126,count:6,type:'VEC2'}],
    meshes:[{primitives:[{attributes:{POSITION:0,TEXCOORD_0:1},material:0}]}],nodes:[{mesh:0}],scenes:[{nodes:[0]}],scene:0,
    materials:[{pbrMetallicRoughness:{baseColorFactor:[1,1,1,1],baseColorTexture:{index:0}}}],textures:[{source:0,sampler:0}],samplers:[{wrapS:33071,wrapT:33071,magFilter:9728}],images:[{bufferView:2,mimeType:'image/png'}]};
   const json=new TextEncoder().encode(JSON.stringify(doc)),jl=Math.ceil(json.length/4)*4,bl=Math.ceil(bin.length/4)*4;
   const glb=new Uint8Array(28+jl+bl),view=new DataView(glb.buffer);view.setUint32(0,0x46546c67,true);view.setUint32(4,2,true);view.setUint32(8,glb.length,true);
   view.setUint32(12,jl,true);view.setUint32(16,0x4e4f534a,true);glb.fill(32,20,20+jl);glb.set(json,20);view.setUint32(20+jl,bl,true);view.setUint32(24+jl,0x004e4942,true);glb.set(bin,28+jl);
   const parsed=meshyParseGLB(glb.buffer),geometryBefore=Array.from(parsed.positions),appearance=await keycapColor.fromGLB(parsed);
   const copy=structuredClone(keycapColor.cloneTextureReference(appearance.textureReference));
   function render(id,texture){const canvas=document.getElementById(id),r=keycapView3d.attach(canvas,{interactive:false,spin:false,az:0,el:1.3});r.setAppearance({mode:'color'});r.setMesh(parsed.positions,{artStart:0,artColors:appearance.colors,artTexture:texture});
    const p=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;let red=0,green=0,blue=0,white=0;
    for(let i=0;i<p.length;i+=4)if(p[i+3]){if(p[i]>p[i+1]+50&&p[i]>p[i+2]+50)red++;if(p[i+1]>p[i]+50&&p[i+1]>p[i+2]+50)green++;if(p[i+2]>p[i]+50&&p[i+2]>p[i+1]+50)blue++;if(p[i]>170&&p[i+1]>170&&p[i+2]>170)white++;}
    return {red,green,blue,white};}
   return {kind:appearance.kind,valid:keycapColor.validTextureReference(copy,parsed.positions),filter:copy.textures[0].filter,
    size:[copy.textures[0].width,copy.textures[0].height],cornerColors:[...appearance.colors],old:render('old',null),uv:render('uv',copy),
    geometryUnchanged:JSON.stringify(geometryBefore)===JSON.stringify(Array.from(parsed.positions))};
  });
  assert.equal(result.kind,'texture');assert.equal(result.valid,true);assert.equal(result.filter,'nearest');assert.deepEqual(result.size,[128,128]);
  assert.equal(result.old.green,0);assert.equal(result.old.blue,0);assert.equal(result.old.white,0);
  assert.ok(result.uv.green>400,'eyes survive interior UV sampling');assert.ok(result.uv.blue>100,'mouth survives interior UV sampling');assert.ok(result.uv.white>50,'fine interior stripes survive');
  assert.equal(result.geometryUnchanged,true);assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
  fs.mkdirSync(path.join(root,'research/screenshots'),{recursive:true});await page.screenshot({path:path.join(root,'research/screenshots/uv-texture-synthetic-qa.png')});
  fs.mkdirSync(path.join(root,'.cache'),{recursive:true});fs.writeFileSync(path.join(root,'.cache/browser-uv-texture.json'),JSON.stringify({passed:true,synthetic:true,requests,errors,...result},null,2)+'\n');
  console.log(JSON.stringify({passed:true,synthetic:true,requests,errors,...result},null,2));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
