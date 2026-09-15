/* Reopen a textured model through the actual Library and export both files.
 * Synthetic local geometry/UV pixels only. No paid API, printer or slicing. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict'),{execFileSync}=require('node:child_process');
const {chromium}=require(process.env.TINYMAKER_PLAYWRIGHT||'playwright');
const root=path.resolve(__dirname,'../..'),out=path.join(root,'.cache/models-export'),cache=path.join(root,'.cache/browser-actions/modules');
fs.mkdirSync(out,{recursive:true});
execFileSync(process.env.TINYMAKER_PYTHON||'python',['scripts/assemble_dashboard.py','-o',path.join(out,'index.html')],{cwd:root});
const html=fs.readFileSync(path.join(out,'index.html')),writes=[],blocked=[],errors=[];
const modules=['slicer-wasm-3.5.0.js','slicer-core-3.5.0.js'];
for(const n of modules)assert.ok(fs.existsSync(path.join(cache,n)),'Cache official pinned slicer module '+n);
const server=http.createServer((req,res)=>{
 const u=new URL(req.url,'http://localhost'),json=v=>{res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(v));};
 if(req.method!=='GET'){writes.push(req.method+' '+u.pathname);res.writeHead(405);res.end();return;}
 if(u.pathname==='/api/status')return json({ok:true,firmwareVersion:'local-model-export',state:'Idle',busy:false,receiving:false,resumePending:false,webControl:true,slicerOn:true,sdReady:false,layerHeight:.05,freeHeap:170000});
 if(u.pathname==='/api/lib/slicer')return json({ok:true,complete:true,version:'3.5.0'});
 if(u.pathname.startsWith('/api/'))return json({ok:true,files:[],items:[]});
 const n=path.basename(u.pathname);
 if(u.pathname.startsWith('/lib/')&&modules.includes(n)){res.writeHead(200,{'Content-Type':'text/javascript'});fs.createReadStream(path.join(cache,n)).pipe(res);return;}
 if(u.pathname==='/lib/three.js'){res.writeHead(200,{'Content-Type':'text/javascript'});fs.createReadStream(path.join(root,'.cache/preview/lib/three.js')).pipe(res);return;}
 if(u.pathname==='/'){res.writeHead(200,{'Content-Type':'text/html;charset=utf-8'});res.end(html);return;}
 res.writeHead(404);res.end();
});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({executablePath:process.env.CHROME_BIN||undefined,headless:true});
 try{
  const context=await browser.newContext({viewport:{width:1440,height:1050},acceptDownloads:true});
  await context.route('**/*',r=>{if(new URL(r.request().url()).origin!==origin){blocked.push(r.request().url());return r.abort();}return r.continue();});
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(origin+'/#library');
  const fixture=await page.evaluate(async()=>{
   const vertices=[[-6,-5,0],[6,-5,0],[6,5,0],[-6,5,0],[-6,-5,8],[6,-5,8],[6,5,8],[-6,5,8]];
   const faces=[[0,2,1],[0,3,2],[4,5,6],[4,6,7],[0,1,5],[0,5,4],[3,7,6],[3,6,2],[0,4,7],[0,7,3],[1,2,6],[1,6,5]];
   const positions=new Float32Array(faces.flatMap(t=>t.flatMap(i=>vertices[i]))),uvs=new Float32Array(faces.flatMap(()=>[0,0,1,0,0,1]));
   const rec=await keycapLibrary.save({name:'Painted cube',prompt:'Synthetic painted fixture',kind:'model',positions,
    sourceColors:new Float32Array(positions.length).fill(.5),sourceColorKind:'texture',
    sourceTexture:{version:1,positionLength:positions.length,baseColors:new Float32Array(positions.length).fill(1),textures:[{
     start:0,count:positions.length/3,uvs,width:2,height:1,data:new Uint8ClampedArray([255,0,0,255,0,255,180,255]),wrapS:33071,wrapT:33071,filter:'linear'}]}});
   return {id:rec.id,positions:Array.from(positions),uvs:Array.from(uvs)};
  });
  assert.equal(await page.evaluate(id=>studioLibrary.open(id),fixture.id),true);
  await page.waitForFunction(()=>document.querySelector('#meshyInfo').textContent.includes('Loaded Painted cube from the Library'));
  assert.equal(await page.locator('#meshyExport').isVisible(),true);assert.equal(await page.locator('#meshyExport').isEnabled(),true);
  const downloads=[];
  const delivered=new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Both model export downloads must arrive')),15000);page.on('download',d=>{downloads.push(d);if(downloads.length===2){clearTimeout(timer);resolve();}});});
  await page.locator('#meshyExport').click();await delivered;
  for(const d of downloads)await d.saveAs(path.join(out,d.suggestedFilename()));
  const names=downloads.map(d=>d.suggestedFilename());assert.ok(names.some(n=>n.endsWith('.tm-design')));assert.ok(names.some(n=>n.endsWith('.stl')));
  const backup=fs.readFileSync(path.join(out,names.find(n=>n.endsWith('.tm-design'))));
  const restored=await page.evaluate(base64=>{
   const bytes=Uint8Array.from(atob(base64),c=>c.charCodeAt(0)),rec=studioLibrary.backup.decode(bytes.buffer).record;
   return {name:rec.name,prompt:rec.prompt,positions:Array.from(rec.positions),uvs:Array.from(rec.sourceTexture.textures[0].uvs),pixels:Array.from(rec.sourceTexture.textures[0].data),valid:keycapColor.validTextureReference(rec.sourceTexture,rec.positions)};
  },backup.toString('base64'));
  const stl=fs.readFileSync(path.join(out,names.find(n=>n.endsWith('.stl'))));
  const printed=require('../../web/parts/stl-read.js').readSTL(stl.buffer.slice(stl.byteOffset,stl.byteOffset+stl.length)).positions;
  assert.deepEqual(Array.from(printed),fixture.positions);assert.deepEqual(restored.positions,fixture.positions);
  assert.deepEqual(restored.uvs,fixture.uvs);assert.deepEqual(restored.pixels,[255,0,0,255,0,255,180,255]);assert.equal(restored.valid,true);
  assert.equal(restored.prompt,'Synthetic painted fixture');assert.equal(restored.name,'Painted cube');
  const message=await page.locator('#meshyInfo').innerText();assert.match(message,/Design backup and STL.*keeps colors and texture/);assert.doesNotMatch(message,/entry contains geometry only/);
  assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);
  const receipt={passed:true,downloads:names,exactGeometry:true,exactUVs:true,exactPixels:true,message,errors,writes,blockedRemote:[...new Set(blocked)],printerContacted:false,paidGeneration:false,slicingExecuted:false};
  fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt,null,2));
 }finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
