/* Actual assembled Keycaps lifecycle with synthetic GLBs. Meshy is replaced
 * at its public API boundary; HTTP is inert loopback GET only. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict'),{execFileSync}=require('node:child_process');
const {chromium}=require(process.env.TINYMAKER_PLAYWRIGHT||'playwright');
const root=path.resolve(__dirname,'../..'),out=path.join(root,'.cache/artisan-workflow');fs.mkdirSync(out,{recursive:true});
const output=path.join(out,'index.html');execFileSync(process.env.TINYMAKER_PYTHON||'python',[path.join(root,'scripts/assemble_dashboard.py'),'-o',output],{cwd:root});
const html=fs.readFileSync(output),writes=[],blocked=[],errors=[],checks=[];
const server=http.createServer((req,res)=>{
 const u=new URL(req.url,'http://localhost');if(req.method!=='GET'){writes.push(u.pathname);res.writeHead(405);res.end();return;}
 if(u.pathname==='/'){res.writeHead(200,{'Content-Type':'text/html;charset=utf-8'});res.end(html);return;}
 if(u.pathname==='/lib/three.js'){res.writeHead(200,{'Content-Type':'text/javascript'});res.end(fs.readFileSync(path.join(root,'web/lib/three-0.160.0.min.js')));return;}
 if(u.pathname.startsWith('/api/')){res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(u.pathname==='/api/status'?{ok:true,busy:false,state:'Idle',webControl:true,sdReady:false,receiving:false,firmwareVersion:'local-artisan-qa',freeHeap:170000}:{ok:true,items:[],files:[],profiles:[]}));return;}
 res.writeHead(404);res.end();
});
function installMock(){
 document.addEventListener('DOMContentLoaded',()=>{
  const key='qa-artisan-revision',q=JSON.parse(localStorage.getItem(key)||'null')||{calls:[],acks:[],resumes:0,pending:null,mode:'textured',defer:false};
  window.__qa=q;window.__qaAckRecords=[];const persist=()=>localStorage.setItem(key,JSON.stringify(q));
  const state=()=>{const fixtures=JSON.parse(localStorage.getItem('qa-artisan-fixtures')),d=q.pending;return {glb:new Uint8Array(fixtures[d.fixture]).buffer,sourceFamily:'image-to-3d',imageId:'qa-image-'+q.calls.length,modelId:d.id,deliveryId:d.id,opts:{texture:true},designCode:d.designCode};};
  window.meshy.hasKey=()=>true;window.meshy.pending=()=>q.pending;
  window.meshy.reviseFromImage=(prompt,opts)=>{q.calls.push({prompt,from:opts.from,designCode:opts.designCode,polycount:opts.polycount,texture:opts.texture,imagePrefix:opts.imageDataUrl.slice(0,22),imageLength:opts.imageDataUrl.length});q.pending={id:'qa-model-'+q.calls.length,from:'keycap',family:'visual-revision',stage:'model',prompt,designCode:opts.designCode,opts:{texture:true},fixture:q.mode};persist();if(q.defer)return new Promise(resolve=>{window.__qaResolve=()=>resolve(state());});return Promise.resolve(state());};
  window.meshy.resume=()=>{q.resumes++;persist();return Promise.resolve(q.pending?state():null);};
  window.meshy.acknowledge=id=>{q.acks.push(id);window.__qaAckRecords.push(keycapLibrary.list().then(r=>r.map(x=>x.id)));if(q.pending&&q.pending.id===id)q.pending=null;persist();return true;};
  window.__qaPersist=persist;
 });
}
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_BIN||undefined});
 try{
  const context=await browser.newContext({viewport:{width:1440,height:1050},acceptDownloads:true});await context.addInitScript(installMock);
  await context.route('**/*',r=>{const req=r.request();if(req.method()!=='GET'){writes.push(req.url());return r.abort();}if(new URL(req.url()).origin!==origin){blocked.push(req.url());return r.abort();}return r.continue();});
  const page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));await page.goto(origin+'/#create');
  const originalBytes=await page.evaluate(async()=>{
   async function glb(textured,wide,height){
    const vertices=[[-wide,0,-1],[wide,0,-1],[wide,0,1],[-wide,0,1],[-wide,height,-1],[wide,height,-1],[wide,height,1],[-wide,height,1]],faces=[[0,3,2,1],[4,5,6,7],[0,1,5,4],[1,2,6,5],[2,3,7,6],[3,0,4,7]],p=[],uv=[];
    for(const [a,b,c,d] of faces){for(const i of [a,b,c,a,c,d])p.push(...vertices[i]);uv.push(0,0,1,0,1,1,0,0,1,1,0,1);}
    const positions=new Float32Array(p),uvs=new Float32Array(uv),canvas=document.createElement('canvas');canvas.width=canvas.height=2;const c=canvas.getContext('2d');c.fillStyle='#61cfaa';c.fillRect(0,0,2,2);c.fillStyle='#c84665';c.fillRect(0,0,1,1);
    const png=new Uint8Array(await (await new Promise(r=>canvas.toBlob(r,'image/png'))).arrayBuffer()),offset=positions.byteLength+uvs.byteLength,bin=new Uint8Array(offset+png.length);bin.set(new Uint8Array(positions.buffer));bin.set(new Uint8Array(uvs.buffer),positions.byteLength);bin.set(png,offset);
    const doc={asset:{version:'2.0'},buffers:[{byteLength:bin.length}],bufferViews:[{buffer:0,byteOffset:0,byteLength:positions.byteLength},{buffer:0,byteOffset:positions.byteLength,byteLength:uvs.byteLength},{buffer:0,byteOffset:offset,byteLength:png.length}],accessors:[{bufferView:0,componentType:5126,count:36,type:'VEC3'},{bufferView:1,componentType:5126,count:36,type:'VEC2'}],meshes:[{primitives:[{attributes:{POSITION:0,TEXCOORD_0:1}}]}],nodes:[{mesh:0}],scenes:[{nodes:[0]}],scene:0};
    if(textured){doc.meshes[0].primitives[0].material=0;doc.materials=[{pbrMetallicRoughness:{baseColorTexture:{index:0}}}];doc.textures=[{source:0,sampler:0}];doc.samplers=[{wrapS:33071,wrapT:33071,magFilter:9728}];doc.images=[{bufferView:2,mimeType:'image/png'}];}
    const json=new TextEncoder().encode(JSON.stringify(doc)),jl=Math.ceil(json.length/4)*4,bl=Math.ceil(bin.length/4)*4,b=new Uint8Array(28+jl+bl),v=new DataView(b.buffer);
    v.setUint32(0,0x46546c67,true);v.setUint32(4,2,true);v.setUint32(8,b.length,true);v.setUint32(12,jl,true);v.setUint32(16,0x4e4f534a,true);b.fill(32,20,20+jl);b.set(json,20);v.setUint32(20+jl,bl,true);v.setUint32(24+jl,0x004e4942,true);b.set(bin,28+jl);return Array.from(b);
   }
   const fixtures={original:await glb(false,1,2),textured:await glb(true,.8,2.4),plain:await glb(false,.65,2.2)};localStorage.setItem('qa-artisan-fixtures',JSON.stringify(fixtures));return fixtures.original;
  });
  if(await page.locator('#gsHide').isVisible())await page.locator('#gsHide').click();
  await page.locator('#kcBoard button').filter({hasText:/^Esc$/}).click();await page.locator('#kcSteps [data-step="3"]').click();await page.locator('#kcLegendOn').uncheck();
  await page.locator('#kcFile').setInputFiles({name:'Original-synthetic-artisan.glb',mimeType:'model/gltf-binary',buffer:Buffer.from(originalBytes)});
  await page.waitForFunction(async()=>{const rows=await keycapLibrary.list();return rows.length===1&&rows[0].productState==='ready'&&!document.getElementById('kcReviewArt').disabled;},null,{timeout:45000});
  const snapshot=()=>page.evaluate(async()=>{const rows=await keycapLibrary.list();return Promise.all(rows.map(async x=>{const r=await keycapLibrary.get(x.id);return {id:r.id,name:r.name,positions:Array.from(r.positions),recipe:r.design,fit:r.product&&r.product.fit,productState:r.product&&r.product.state,productSignature:r.product&&r.product.signature,texture:!!r.sourceTexture};}));});
  const initial=(await snapshot())[0];assert.equal(initial.productState,'ready');assert.equal(initial.texture,false);assert.match(initial.productSignature,/^kp1-[a-f0-9]{16}$/);
  await page.locator('#kcReviewArt').click();const dialog=page.locator('.arDialog'),generate=dialog.getByRole('button',{name:'Revise with Meshy',exact:true}),local=dialog.getByRole('button',{name:'Apply local fit fixes',exact:true}),close=dialog.getByRole('button',{name:'Close',exact:true});
  await page.waitForFunction(()=>document.querySelector('.arCanvas').getAttribute('aria-label').includes('perspective view'));
  for(const v of ['Front','Side','Back']){await dialog.getByRole('button',{name:v+' view',exact:true}).click();await page.waitForFunction(view=>document.querySelector('.arCanvas').getAttribute('aria-label').includes(view+' view'),v.toLowerCase());}
  await local.click();await page.waitForFunction(()=>document.querySelector('.arDialog').getAttribute('aria-busy')==='false'&&document.querySelector('.arNotice').textContent.includes('Socket unchanged'),null,{timeout:45000});
  const afterLocal=await snapshot();assert.ok(afterLocal.length>=1);for(const r of afterLocal){assert.deepEqual(r.positions,initial.positions);assert.deepEqual(r.fit,initial.fit);}
  assert.equal(await dialog.locator('.arPhysicalText').getAttribute('data-state'),'ready');assert.equal(await page.evaluate(()=>__qa.calls.length),0);
  checks.push('Imported sculpt is autosaved ready; actual four-view review and local optimizer preserve the raw artwork and exact socket.');
  await dialog.getByRole('button',{name:'Compact character',exact:true}).click();await generate.click();
  const confirmation=dialog.getByRole('alertdialog');await confirmation.waitFor();assert.match(await confirmation.innerText(),/two paid Meshy tasks/);
  await confirmation.getByRole('button',{name:'Keep current',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.arDialog').getAttribute('aria-busy')==='false');assert.equal(await page.evaluate(()=>__qa.calls.length),0);
  checks.push('Actual paid confirmation is reachable; canceling it starts zero Meshy operations.');
  await generate.click();await confirmation.getByRole('button',{name:'Use two Meshy tasks',exact:true}).click();
  await page.waitForFunction(()=>!document.querySelector('.arDialog')&&__qa.acks.length===1,null,{timeout:60000});
  const revised=await snapshot(),candidate=revised.find(r=>r.name.endsWith(' · revision'));
  assert.ok(candidate,'successful revision has its own named Library record');assert.equal(candidate.productState,'ready');assert.equal(candidate.texture,true);assert.deepEqual(candidate.fit,initial.fit);assert.notDeepEqual(candidate.positions,initial.positions);
  assert.deepEqual(revised.find(r=>r.id===initial.id),initial,'the original Library record remains exact');
  assert.equal(await page.locator('#kcProductName').inputValue(),candidate.name);assert.match(await page.locator('#kcProductStatus').textContent(),/Ready to slice/);
  const submit=await page.evaluate(()=>__qa.calls[0]);assert.equal(submit.from,'keycap');assert.equal(submit.texture,true);assert.equal(submit.imagePrefix,'data:image/png;base64,');assert.ok(submit.imageLength>500);assert.match(submit.prompt,/head-and-shoulders/);assert.match(submit.prompt,/no keycap shell/i);
  const ackRecords=await page.evaluate(()=>Promise.all(__qaAckRecords));assert.ok(ackRecords[0].includes(candidate.id),'acknowledgment occurs after confirmed Library save');
  checks.push('One mocked textured revision saves a distinct ready product, preserves the original and socket, and acknowledges only after the candidate is stored.');

  await page.evaluate(id=>keycapUseSaved(id),initial.id);await page.waitForFunction(name=>document.getElementById('kcProductName').value===name,initial.name);assert.match(await page.locator('#kcProductStatus').textContent(),/Ready to slice/);
  await page.locator('#kcSteps [data-step="3"]').click();await page.locator('#kcReviewArt').click();await dialog.getByRole('button',{name:'Larger face / head',exact:true}).click();
  await page.evaluate(()=>{__qa.defer=true;__qaPersist();});await generate.click();await confirmation.getByRole('button',{name:'Use two Meshy tasks',exact:true}).click();await page.waitForFunction(()=>!!window.__qaResolve);
  const beforeDeferred=await snapshot(),selectionBeforeClose=await page.evaluate(()=>JSON.parse(localStorage.getItem('tmKeycapSession')).libId);await close.click();await page.evaluate(()=>__qaResolve());await page.waitForFunction(()=>!document.getElementById('kcGen').disabled);
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('tmKeycapSession')).libId),selectionBeforeClose);assert.deepEqual(await snapshot(),beforeDeferred);assert.equal(await page.evaluate(()=>__qa.acks.length),1);assert.ok(await page.evaluate(()=>!!__qa.pending));
  await page.reload();await page.waitForFunction(()=>__qa.resumes===1&&__qa.acks.length===2&&!document.getElementById('kcGen').disabled,null,{timeout:60000});
  const recovered=await snapshot();assert.deepEqual(recovered.find(r=>r.id===initial.id),initial);assert.equal(await page.evaluate(()=>__qa.calls.length),2);assert.equal(await page.evaluate(()=>__qa.pending),null);
  checks.push('Closing during delivery retains the selected original and pending task; reload resumes the existing result without another revision call.');

  await page.evaluate(id=>keycapUseSaved(id),initial.id);await page.locator('#kcSteps [data-step="3"]').click();await page.locator('#kcReviewArt').click();await dialog.getByRole('button',{name:'Simpler silhouette',exact:true}).click();
  await page.evaluate(()=>{__qa.defer=false;__qa.mode='plain';__qaPersist();});await generate.click();await confirmation.getByRole('button',{name:'Use two Meshy tasks',exact:true}).click();
  await page.waitForFunction(()=>__qa.calls.length===3&&!document.getElementById('kcGen').disabled,null,{timeout:60000});
  assert.equal(await page.evaluate(()=>__qa.acks.length),2);assert.ok(await page.evaluate(()=>!!__qa.pending));
  assert.deepEqual((await snapshot()).find(r=>r.id===initial.id),initial);
  if(await dialog.count())await close.click();
  await page.reload();await page.waitForFunction(()=>__qa.resumes===2&&!document.getElementById('kcGen').disabled,null,{timeout:60000});
  assert.equal(await page.evaluate(()=>__qa.acks.length),2,'missing UV texture must not acknowledge on recovery');assert.ok(await page.evaluate(()=>!!__qa.pending));assert.equal(await page.evaluate(()=>__qa.calls.length),3);
  checks.push('A geometry-only result from the promised textured revision remains recoverable and is never acknowledged, including after reload.');
  assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);assert.ok(blocked.every(u=>!/meshy/i.test(u)),'No Meshy network call is attempted');
  const result={passed:true,checks,originalId:initial.id,revisedId:candidate.id,errors,writes,blockedBackgroundChecks:blocked,paidTasksStarted:false,printerContacted:false};fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
 }catch(e){fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({passed:false,error:e.stack||e.message,checks,errors,writes,paidTasksStarted:false,printerContacted:false},null,2));throw e;}finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
