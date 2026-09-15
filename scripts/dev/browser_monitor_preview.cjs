// Full assembled dashboard with loopback-only API fixtures. Never reaches a printer.
'use strict';
const {chromium}=require(process.env.TINYMAKER_PLAYWRIGHT||'playwright');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'../..'),cache=path.join(root,'.cache');
const python=process.env.TINYMAKER_PYTHON||'python';
const assembled=path.join(cache,'monitor-preview-qa.html');
fs.mkdirSync(cache,{recursive:true});fs.mkdirSync(path.join(root,'research/screenshots'),{recursive:true});
execFileSync(python,[path.join(root,'scripts/assemble_dashboard.py'),'-o',assembled],{cwd:root});
// Optional local artwork gives review screenshots a real model; the test itself
// needs only a valid image and runs without private research artifacts.
const html=fs.readFileSync(assembled),preview=process.env.TINYMAKER_PREVIEW_FIXTURE?
 fs.readFileSync(process.env.TINYMAKER_PREVIEW_FIXTURE):
 Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aFukAAAAASUVORK5CYII=','base64');
const names=['QA Lakeside Dreamer','QA Blossom','QA Interrupted preview'];
const idle={ok:true,firmwareVersion:'Monitor QA',firmwareBuild:'local simulation',state:'Idle',stateCode:0,busy:false,receiving:false,webControl:true,sdReady:true,
  sdText:'Ready · local QA fixtures',sdJob:'',freeHeap:170000,minFreeHeap:120000,maxAllocHeap:90000,ip:'Local preview only',wifiText:'QA network',wifiRssi:-42,
  layerText:'0 / 0',layerHeight:.05,currentLayer:0,totalLayers:0,vatRemainingMl:30,vatPercent:75,vatText:'30 ml',liveN:0,sdRev:1,uptimeSecs:300,lastCrash:null};
let status={...idle},held=null,holdName='',detailHold=null,holdDetailName='';
const requests=[],posts=[],errors=[],checks=[];
const details=name=>({ok:true,name,printLayers:540,layers:0,sourceLayers:0,heightMm:name===names[1]?18:27,estimatedTime:'54 min',resinEstimated:true,resinMl:1.8,preview1:true});
const server=http.createServer((req,res)=>{if(req.method!=='GET'){res.writeHead(405);return res.end();}res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(html);});
(async()=>{
 await new Promise(resolve=>server.listen(8794,'127.0.0.1',resolve));
 const browser=await chromium.launch({executablePath:process.env.CHROME_BIN||undefined,headless:true});
 try{
  const context=await browser.newContext({viewport:{width:1440,height:1050}}),page=await context.newPage();
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',async route=>{
   const request=route.request(),u=new URL(request.url());
   if(request.method()!=='GET'){posts.push({method:request.method(),url:u.href});return route.abort();}
   if(u.hostname!=='127.0.0.1')return route.abort();
   requests.push(u.pathname+u.search);
   if(u.pathname==='/api/status')return route.fulfill({json:status});
   if(u.pathname==='/api/files')return route.fulfill({json:{ok:true,totalBytes:8e9,usedBytes:1e8,items:names.map((name,i)=>({type:'model',name,importSeq:3-i,folderBytes:1450000,estimatedSecs:3240,printLayers:540})),hiddenCount:0}});
   if(u.pathname==='/api/files/model/preview'){
    if(u.searchParams.get('name')===holdName&&!u.searchParams.has('type')){held=()=>route.fulfill({contentType:'image/png',body:preview});return;}
    return route.fulfill({contentType:'image/png',body:preview});
   }
   if(u.pathname==='/api/files/model'){
    if(u.searchParams.get('name')===holdDetailName){detailHold=()=>route.fulfill({json:details(u.searchParams.get('name'))});return;}
    return route.fulfill({json:details(u.searchParams.get('name'))});
   }
   if(u.pathname==='/api/files/model/slices')return route.fulfill({status:404,json:{ok:false,error:'No slices in image-only QA fixture'}});
   if(u.pathname.startsWith('/api/'))return route.fulfill({json:{ok:true,items:[],profiles:[]}});
   if(u.pathname!=='/')return route.fulfill({status:404,body:''});
   return route.continue();
  });
  await page.goto('http://127.0.0.1:8794/#monitor');
  await page.waitForFunction(()=>window.studioPreviewSync&&window.tmStatus&&tmStatus.ok);
  if(await page.locator('#gsHide').isVisible())await page.locator('#gsHide').click();
  await page.locator('#filesList .file').first().waitFor();
  assert.equal(await page.locator('#printPreviewCard').isVisible(),true,'normal Monitor must show the shared preview');
  assert.equal(await page.locator('#printPreviewCard').evaluate(e=>e.parentElement.id),'homeLeft');
  assert.equal(await page.locator('#monitorSavedPreview').isVisible(),false);
  checks.push('shared viewer is visibly inside Monitor, not its old hidden container');
  await page.locator('#filesList .file').filter({hasText:names[0]}).click();
  await page.waitForFunction(n=>document.querySelector('#printPreviewTitle').textContent===n,names[0]);
  await page.waitForTimeout(350);
  assert.equal(await page.locator('#filesList .file.sel').getAttribute('data-n'),names[0]);
  await page.evaluate(()=>{window.__qaViewer=document.querySelector('#printPreviewCard');});
  await page.getByRole('tab',{name:/^Create/}).click();
  await page.locator('[data-st="model"]').click();
  assert.equal(await page.locator('#printPreviewCard').isVisible(),true);
  assert.equal(await page.locator('#printPreviewCard').evaluate(e=>e===window.__qaViewer),true);
  await page.getByRole('tab',{name:/^Monitor/}).click();
  assert.equal(await page.locator('#printPreviewTitle').innerText(),names[0]);
  checks.push('SD selection opens the actual cached image and remains selected across room changes');
  await page.screenshot({path:path.join(root,'research/screenshots/monitor-preview-desktop-qa.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});await page.waitForTimeout(200);
  await page.mouse.move(1,1);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,'no phone horizontal overflow');
  await page.screenshot({path:path.join(root,'research/screenshots/monitor-preview-mobile-qa.png'),fullPage:true});
  await page.setViewportSize({width:1440,height:1050});
  status={...idle,busy:true,sdJob:'import'};await page.evaluate(s=>applyStatus(s),status);await page.waitForTimeout(50);
  const busyReads=requests.filter(u=>u.startsWith('/api/files/model?')||u.startsWith('/api/files/model/preview?')).length;
  await page.evaluate(()=>{
   window.__qaDraft=new Float32Array([0,0,0,1,0,0,0,1,1]);slicerRaw=window.__qaDraft;slicerOwns(true);
   window.__qaCanvas=document.querySelector('#printPreviewCanvas').toDataURL();
  });
  assert.equal(await page.locator('#monitorSavedPreview').isVisible(),true);
  assert.equal(await page.locator('#printPreviewCard').isVisible(),false,'unsent draft remains in Create');
  await page.waitForTimeout(50);
  assert.equal(requests.filter(u=>u.startsWith('/api/files/model?')||u.startsWith('/api/files/model/preview?')).length,busyReads,'no saved-image or metadata request during an SD job');
  status={...idle};await page.evaluate(s=>applyStatus(s),status);
  await page.waitForFunction(()=>!document.querySelector('#monitorSavedImage').hidden);
  checks.push('saved preview waits for an SD job to finish before reading its image or metadata');
  holdName=names[0];holdDetailName=names[0];
  await page.evaluate(n=>pickModel(encodeURIComponent(n)),names[0]);
  await page.waitForTimeout(100);assert.ok(held&&detailHold,'older image and details are pending');
  await page.locator('#filesList .file').filter({hasText:names[1]}).click();
  await page.waitForFunction(n=>document.querySelector('#monitorSavedImage').alt.startsWith(n),names[1]);
  const oldImage=held,oldDetail=detailHold;held=null;detailHold=null;holdName='';holdDetailName='';await oldImage();await oldDetail();await page.waitForTimeout(150);
  assert.equal(await page.locator('#monitorSavedName').innerText(),names[1]);
  assert.match(await page.locator('#monitorSavedFacts').innerText(),/18.0 mm/);
  assert.equal(await page.locator('#filesList .file.sel').getAttribute('data-n'),names[1]);
  assert.equal(await page.evaluate(()=>slicerRaw===window.__qaDraft),true);
  assert.equal(await page.locator('#printPreviewCanvas').evaluate(e=>e.toDataURL()===window.__qaCanvas),true,'saved preview must not repaint the unsent draft');
  checks.push('unsent draft keeps the original viewer and mesh; Monitor has independent image and selection','old image and metadata completion cannot replace a newer selection');
  await page.evaluate(n=>pickModel(encodeURIComponent(n)),names[0]);
  await page.waitForFunction(n=>!document.querySelector('#monitorSavedImage').hidden&&document.querySelector('#monitorSavedImage').alt.startsWith(n),names[0]);
  await page.waitForFunction(()=>document.querySelector('#monitorSavedFacts').textContent.includes('27.0 mm'));
  await page.screenshot({path:path.join(root,'research/screenshots/monitor-saved-preview-desktop-qa.png'),fullPage:true});
  // An in-flight saved image must be retried after live printing relinquishes the viewer.
  holdName=names[2];await page.evaluate(n=>pickModel(encodeURIComponent(n)),names[2]);await page.waitForTimeout(100);assert.ok(held);
  status={...idle,state:'Printing',stateCode:4,busy:true,model:names[0],currentLayer:200,totalLayers:540,layerText:'200 / 540',runSecs:600,remainingSecs:1800,previewCached:true};
  await page.evaluate(s=>applyStatus(s),status);await page.waitForTimeout(100);
  assert.equal(await page.locator('#printPreviewCard').isVisible(),true);assert.equal(await page.locator('#monitorSavedPreview').isVisible(),false);
  assert.match(await page.locator('#printPreviewTitle').innerText(),/Printing/);
  for(const viewport of [{width:1440,height:1050},{width:390,height:844}]){
   await page.setViewportSize(viewport);await page.evaluate(()=>scrollTo(0,0));await page.waitForTimeout(100);
   const previewBox=await page.locator('#printPreviewCard').boundingBox();
   for(const id of ['pauseButton','stopButton']){
    const box=await page.locator('#'+id).boundingBox();
    assert.ok(box&&box.y>=0&&box.y+box.height<=viewport.height,id+' stays visible without scrolling');
    assert.ok(box.y+box.height<=previewBox.y,id+' is above the large model preview');
   }
   await page.screenshot({path:path.join(root,'research/screenshots/monitor-print-controls-'+(viewport.width>500?'desktop':'mobile')+'-qa.png'),fullPage:true});
  }
  await page.setViewportSize({width:1440,height:1050});
  checks.push('Pause and Stop remain above the preview and inside the desktop and phone viewport');
  const interrupted=held;held=null;holdName='';await interrupted();await page.waitForTimeout(50);
  assert.equal(await page.locator('#monitorSavedImage').getAttribute('hidden')!==null,true,'pre-print completion stays invalidated');
  checks.push('active print takes the original live preview back into Monitor');
  status={...idle};await page.evaluate(s=>applyStatus(s),status);
  await page.waitForFunction(n=>!document.querySelector('#monitorSavedImage').hidden&&document.querySelector('#monitorSavedImage').alt.startsWith(n),names[2],{timeout:5000});
  checks.push('interrupted saved preview resumes automatically after printing ends');
  assert.deepEqual(posts,[],'no POST, upload, motion or printer command is allowed');assert.deepEqual(errors,[]);
  const result={passed:true,checks,source:(process.env.TINYMAKER_PREVIEW_FIXTURE?'Supplied local image':'Embedded synthetic PNG')+' used as a simulated SD cached preview; no printer contacted',screenshots:['monitor-preview-desktop-qa.png','monitor-preview-mobile-qa.png','monitor-saved-preview-desktop-qa.png','monitor-print-controls-desktop-qa.png','monitor-print-controls-mobile-qa.png'],errors,posts,requests:requests.length};
  fs.writeFileSync(path.join(cache,'browser-monitor-preview.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
