/* Assembled topper editor, real geometry and downloads, inert local HTTP only. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict'),{execFileSync}=require('node:child_process');
const {chromium}=require(process.env.TINYMAKER_PLAYWRIGHT||'playwright');
const root=path.resolve(__dirname,'../..'),out=path.join(root,'.cache/topper-workspace');
const R=require('../../web/parts/stl-read.js');fs.mkdirSync(out,{recursive:true});
execFileSync(process.env.TINYMAKER_PYTHON||'python',[path.join(root,'scripts/assemble_dashboard.py'),'-o',path.join(out,'index.html')],{cwd:root});
const html=fs.readFileSync(path.join(out,'index.html')),writes=[],errors=[];
function box(){const v=[[-3,-1,0],[3,-1,0],[3,1,0],[-3,1,0],[-3,-1,12],[3,-1,12],[3,1,12],[-3,1,12]],p=[];
 for(const q of [[0,3,2,1],[4,5,6,7],[0,1,5,4],[1,2,6,5],[2,3,7,6],[3,0,4,7]])for(const i of [q[0],q[1],q[2],q[0],q[2],q[3]])p.push(...v[i]);
 const b=Buffer.alloc(84+p.length/9*50);b.writeUInt32LE(p.length/9,80);p.forEach((v,i)=>b.writeFloatLE(v,84+Math.floor(i/9)*50+12+i%9*4));return b;}
const server=http.createServer((req,res)=>{const u=new URL(req.url,'http://localhost');
 if(req.method!=='GET'){writes.push(u.pathname);res.writeHead(405);res.end();return;}
 if(u.pathname==='/api/status'){res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({ok:true,state:'Idle',stateCode:0,busy:false,receiving:false,webControl:true,sdReady:false,sdJob:'',firmwareVersion:'local-topper',currentLayer:0,totalLayers:0,layerHeight:.05,liveN:0,sdRev:1,uptimeSecs:300}));return;}
 if(u.pathname.startsWith('/api/')){res.writeHead(200,{'Content-Type':'application/json'});res.end('{"ok":true,"items":[],"profiles":[]}');return;}
 if(u.pathname==='/'){res.writeHead(200,{'Content-Type':'text/html;charset=utf-8'});res.end(html);return;}
 res.writeHead(404);res.end();});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_BIN||undefined});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1050},acceptDownloads:true});page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():r.abort());
  await page.goto(origin+'/#create');await page.getByRole('button',{name:'Toppers',exact:true}).click();
  await page.waitForFunction(()=>!document.querySelector('#tpSave').disabled);
  const reveal=async selector=>{const indices=await page.locator(selector).evaluate(e=>{const ds=[...document.querySelectorAll('#topperCard details')],a=[];for(let p=e.parentElement;p;p=p.parentElement)if(p.tagName==='DETAILS'&&!p.open)a.unshift(ds.indexOf(p));return a;});for(const i of indices)await page.locator('#topperCard details').nth(i).locator(':scope > summary').click();};
  const download=async(id,file)=>{await reveal(id);const pending=page.waitForEvent('download');await page.locator(id).click();const d=await pending;await d.saveAs(path.join(out,file));const b=fs.readFileSync(path.join(out,file));return Array.from(R.readSTL(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)).positions);};
  const fits=async label=>{await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));const sizes=await page.evaluate(()=>({width:document.documentElement.scrollWidth,viewport:innerWidth}));assert.ok(sizes.width<=sizes.viewport+1,label+': '+JSON.stringify(sizes));};
  assert.equal(await page.locator('#tpFitSettings').getAttribute('open'),null);
  assert.equal(await page.locator('#tpPlacement').getAttribute('open'),null);
  assert.equal(await page.locator('#tpWidth').isVisible(),true);
  await fits('desktop');
  await page.locator('#tpArtFile').setInputFiles({name:'QA-artwork.stl',mimeType:'model/stl',buffer:box()});
  await page.waitForFunction(()=>document.querySelector('#tpArtName').textContent==='QA-artwork.stl');
  await reveal('#tpFit');await page.locator('#tpFit').fill('0.3');await page.locator('#tpFit').dispatchEvent('input');
  const expected=await page.evaluate(()=>Array.from(topper.build({preset:'pencil-round',socketShape:'round',diameterMm:7,acrossFlatsMm:7,clearanceMm:.3,socketDepthMm:10,wallMm:1.6,roofMm:2}).positions));
  const test=await download('#tpFitTest','plain-fit-test.stl');assert.deepEqual(test,expected,'Fit sample is the actual measured socket, without artwork');
  assert.equal(await page.locator('#tpArtName').innerText(),'QA-artwork.stl','Fit export preserves artwork');
  assert.equal(Number(await page.locator('#tpFit').inputValue()),.3,'Fit export preserves allowance');
  await page.locator('#tpViewSocket').click();assert.equal(await page.locator('#tpViewSocket').getAttribute('aria-pressed'),'true');
  await page.locator('#tpView3d').click();assert.equal(await page.locator('#tpView3d').getAttribute('aria-pressed'),'true');
  await page.locator('#tpSave').click();await page.waitForFunction(()=>document.querySelector('#designerNoticeText').textContent==='Topper saved to Library.');
  const stored=await page.evaluate(async()=>{const list=await keycapLibrary.list();const rec=await keycapLibrary.get(list[0].id);return Array.from(rec.positions);});
  const full=await download('#tpExport','full-topper.stl');assert.deepEqual(full,stored);assert.notDeepEqual(full,test);
  await page.locator('#topperCard details[open]').evaluateAll(es=>es.forEach(e=>e.open=false));
  await page.evaluate(()=>window.designerFeedback.dismiss());await page.locator('#topperCard').screenshot({path:path.join(out,'topper-desktop.png')});
  await page.setViewportSize({width:390,height:844});await fits('phone collapsed');
  await page.locator('#topperCard').screenshot({path:path.join(out,'topper-mobile.png')});
  await reveal('#tpShape');await page.locator('#tpShape').selectOption('oval');
  await page.waitForFunction(()=>document.querySelector('#tpSlice').disabled);
  assert.equal(await page.locator('#tpSecondWidth').isVisible(),true);assert.equal(await page.locator('#tpState').isVisible(),true);
  await page.locator('#tpSecondWidth').fill('5');await page.locator('#tpSecondWidth').dispatchEvent('change');
  await page.waitForFunction(()=>!document.querySelector('#tpSlice').disabled);await fits('phone oval fit controls');
  await page.locator('#tpFitSettings summary').click();await page.locator('#tpWidth').fill('0');await page.locator('#tpWidth').dispatchEvent('change');
  await page.waitForFunction(()=>document.querySelector('#tpSlice').disabled);
  assert.equal(await page.locator('#tpState').isVisible(),true,'Invalid dimensions stay visible outside disclosures');
  assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);
  const receipt={passed:true,checks:['clean desktop and phone layout','advanced controls accessible','measured plain fit sample keeps sculpt and fit','socket/3D inspection','saved full STL matches Library geometry','oval input and invalid-size errors remain actionable'],errors,writes,printerContacted:false,printStarted:false,paidGeneration:false};
  fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(receipt,null,2));console.log(JSON.stringify(receipt,null,2));
 }finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
