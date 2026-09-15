/* Full assembled UI -> imported textured GLB -> Library -> downloaded guide.
 * Synthetic cube and image; every request is confined to inert loopback HTTP. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict'),{execFileSync}=require('node:child_process');
const {chromium}=require(process.env.TINYMAKER_PLAYWRIGHT||'playwright');
const root=path.resolve(__dirname,'../..'),out=path.join(root,'.cache/texture-guide');fs.mkdirSync(out,{recursive:true});
execFileSync(process.env.TINYMAKER_PYTHON||'python',[path.join(root,'scripts/assemble_dashboard.py'),'-o',path.join(out,'index.html')],{cwd:root});
const html=fs.readFileSync(path.join(out,'index.html')),writes=[],blocked=[],errors=[];
const server=http.createServer((req,res)=>{
 const u=new URL(req.url,'http://localhost');if(req.method!=='GET'){writes.push(u.pathname);res.writeHead(405);res.end();return;}
 if(u.pathname==='/'){res.writeHead(200,{'Content-Type':'text/html;charset=utf-8'});res.end(html);return;}
 if(u.pathname==='/lib/three.js'){res.writeHead(200,{'Content-Type':'text/javascript'});res.end(fs.readFileSync(path.join(root,'web/lib/three-0.160.0.min.js')));return;}
 if(u.pathname.startsWith('/api/')){res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(u.pathname==='/api/status'?{ok:true,busy:false,state:'Idle',webControl:true,sdReady:false,receiving:false,firmwareVersion:'local-texture-guide',freeHeap:170000}:{ok:true,items:[],files:[]}));return;}
 res.writeHead(404);res.end();
});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_BIN||undefined});
 try{
  const context=await browser.newContext({viewport:{width:1440,height:1050},acceptDownloads:true});
  await context.route('**/*',r=>{if(new URL(r.request().url()).origin!==origin){blocked.push(r.request().url());return r.abort();}return r.continue();});
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(origin+'/#create');
  const fixture=await page.evaluate(async()=>{
   const image=document.createElement('canvas');image.width=image.height=128;const c=image.getContext('2d');c.fillStyle='#ff0000';c.fillRect(0,0,128,128);
   c.fillStyle='#00ff00';c.fillRect(24,32,20,22);c.fillRect(84,32,20,22);c.fillStyle='#0000ff';c.fillRect(42,74,44,15);
   c.fillStyle='#ffffff';for(let x=46;x<84;x+=8)c.fillRect(x,77,3,8);
   const png=new Uint8Array(await (await new Promise(r=>image.toBlob(r,'image/png'))).arrayBuffer());
   const vertices=[[-1,0,-1],[1,0,-1],[1,0,1],[-1,0,1],[-1,2,-1],[1,2,-1],[1,2,1],[-1,2,1]],faces=[[0,3,2,1],[4,5,6,7],[0,1,5,4],[1,2,6,5],[2,3,7,6],[3,0,4,7]],p=[],uv=[];
   for(const [a,b,c,d] of faces){for(const i of [a,b,c,a,c,d])p.push(...vertices[i]);uv.push(0,0,1,0,1,1,0,0,1,1,0,1);}
   const positions=new Float32Array(p),uvs=new Float32Array(uv),imageOffset=positions.byteLength+uvs.byteLength,bin=new Uint8Array(imageOffset+png.length);
   bin.set(new Uint8Array(positions.buffer));bin.set(new Uint8Array(uvs.buffer),positions.byteLength);bin.set(png,imageOffset);
   const doc={asset:{version:'2.0'},buffers:[{byteLength:bin.length}],bufferViews:[{buffer:0,byteOffset:0,byteLength:positions.byteLength},{buffer:0,byteOffset:positions.byteLength,byteLength:uvs.byteLength},{buffer:0,byteOffset:imageOffset,byteLength:png.length}],accessors:[{bufferView:0,componentType:5126,count:36,type:'VEC3'},{bufferView:1,componentType:5126,count:36,type:'VEC2'}],meshes:[{primitives:[{attributes:{POSITION:0,TEXCOORD_0:1},material:0}]}],nodes:[{mesh:0}],scenes:[{nodes:[0]}],scene:0,materials:[{pbrMetallicRoughness:{baseColorTexture:{index:0}}}],textures:[{source:0,sampler:0}],samplers:[{wrapS:33071,wrapT:33071,magFilter:9728}],images:[{bufferView:2,mimeType:'image/png'}]};
   const json=new TextEncoder().encode(JSON.stringify(doc)),jl=Math.ceil(json.length/4)*4,bl=Math.ceil(bin.length/4)*4,b=new Uint8Array(28+jl+bl),v=new DataView(b.buffer);
   v.setUint32(0,0x46546c67,true);v.setUint32(4,2,true);v.setUint32(8,b.length,true);v.setUint32(12,jl,true);v.setUint32(16,0x4e4f534a,true);b.fill(32,20,20+jl);b.set(json,20);v.setUint32(20+jl,bl,true);v.setUint32(24+jl,0x004e4942,true);b.set(bin,28+jl);
   return Array.from(b);
  });
  await page.locator('#kcBoard button').filter({hasText:/^Esc$/}).click();await page.locator('#kcSteps [data-step="3"]').click();await page.locator('#kcLegendOn').uncheck();
  await page.locator('#kcFile').setInputFiles({name:'Synthetic-textured-cube.glb',mimeType:'model/gltf-binary',buffer:Buffer.from(fixture)});
  await page.waitForFunction(async()=>{const rows=await keycapLibrary.list();return rows.length===1;},null,{timeout:30000});
  const record=await page.evaluate(async()=>{const rows=await keycapLibrary.list(),r=await keycapLibrary.get(rows[0].id);window.__savedTextureRecord=r;return {id:r.id,valid:keycapColor.validTextureReference(r.sourceTexture,r.positions),triangles:r.triangles,colors:[...r.sourceColors]};});
  assert.equal(record.valid,true);assert.equal(record.triangles,12);
  for(let i=0;i<record.colors.length;i+=3)assert.deepEqual(record.colors.slice(i,i+3),[1,0,0],'all sampled corners are red, so colored interior requires UV texture');
  await page.locator('#kcSteps [data-step="4"]').click();
  const download=page.waitForEvent('download');await page.locator('#kcPaint').click();const d=await download,guide=path.join(out,'paint-guide.png');await d.saveAs(guide);
  async function inspectGuide(){const bytes=fs.readFileSync(guide);return page.evaluate(async arr=>{
   const bitmap=await createImageBitmap(new Blob([new Uint8Array(arr)],{type:'image/png'})),c=document.createElement('canvas');c.width=bitmap.width;c.height=bitmap.height;const g=c.getContext('2d');g.drawImage(bitmap,0,0);bitmap.close();
   const panels=[];for(let n=0;n<4;n++){const p=g.getImageData(20+(n%2)*590,102+Math.floor(n/2)*585,560,550).data;let green=0,blue=0;for(let i=0;i<p.length;i+=4){if(p[i+1]>p[i]+50&&p[i+1]>p[i+2]+50)green++;if(p[i+2]>p[i]+50&&p[i+2]>p[i+1]+50)blue++;}panels.push({green,blue});}return {width:c.width,height:c.height,panels};
  },Array.from(bytes));}
  const direct=await inspectGuide();assert.equal(direct.width,1200);assert.equal(direct.height,1360);for(const p of direct.panels){assert.ok(p.green>100,'each view keeps UV eye detail');assert.ok(p.blue>50,'each view keeps UV mouth detail');}
  // Reload from actual IndexedDB, so transient decoder state cannot fake durability.
  await page.reload();await page.waitForFunction(()=>window.keycapUseSaved);await page.evaluate(id=>keycapUseSaved(id),record.id);await page.locator('#kcSteps [data-step="4"]').click();
  const reopenedDownload=page.waitForEvent('download');await page.locator('#kcPaint').click();await (await reopenedDownload).saveAs(guide);const reopened=await inspectGuide();assert.deepEqual(reopened,direct);
  assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);assert.ok(blocked.every(u=>!/meshy/i.test(u)),'no Meshy request attempted');
  const receipt={passed:true,synthetic:true,direct,reopened,errors,writes,blockedBackgroundUpdateChecks:blocked,physicalPrinterContacted:false};fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt,null,2));
  // Optional visual review only, separate from the synthetic regression result.
  if(process.env.TINYMAKER_REVIEW_GLB){
   assert.ok(fs.existsSync(process.env.TINYMAKER_REVIEW_GLB),'TINYMAKER_REVIEW_GLB does not exist');
   await page.locator('#kcFile').setInputFiles(process.env.TINYMAKER_REVIEW_GLB);
   await page.waitForFunction(async()=>{const r=await keycapLibrary.list();return r.length===2;},null,{timeout:60000});
   await page.locator('#kcSteps [data-step="4"]').click();
   if(await page.locator('#designerNoticeClose').isVisible())await page.locator('#designerNoticeClose').click();
   await page.locator('#kcCard').screenshot({path:path.join(out,'review-existing-geometry.png')});
   console.log('Optional existing-model review saved separately; no claim of original texture.');
  }
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
