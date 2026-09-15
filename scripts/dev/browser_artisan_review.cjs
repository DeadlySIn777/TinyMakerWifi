/* Local real-canvas review UI. All generation callbacks are controlled fakes;
 * this harness cannot contact Meshy or a printer. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require(process.env.TINYMAKER_PLAYWRIGHT||'playwright');
const root=path.resolve(__dirname,'../..'),out=path.join(root,'.cache/artisan-review'),shots=path.join(root,'research/screenshots');
fs.mkdirSync(out,{recursive:true});fs.mkdirSync(shots,{recursive:true});
const scripts=['keycap.js','keycap-sculpt.js','keycap-color.js','keycap-view3d.js','artisan-review.js'].map(n=>'<script>'+fs.readFileSync(path.join(root,'web/parts',n),'utf8').replace(/<\/script/gi,'<\\/script')+'</script>').join('\n');
const html=`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Artisan review QA</title><style>body{margin:0;background:#0d1015;color:#eee;font:16px system-ui}main{padding:40px}button{width:100%;margin:18px 0;padding:20px;background:#511421;color:#fff;border:1px solid #b84456;font:inherit}h1{font-size:24px}p{color:#afa2ae}</style></head><body><main><h1>TinyMaker · local review QA</h1><p>Synthetic geometry, not a generated product.</p><button id="launch">Review current artisan</button></main>${scripts}<script>
window.calls={render:[],generate:[],local:[],keep:0,close:[]};window.mode={};window.pending={};
const cap=keycap.build({profile:'DSA',row:'R3',sizeU:1,topGrid:23,mx:{slotClearance:.08}});cap.dishDepth=keycap.PROFILES.DSA.dishDepth;cap.sizeU=1;
const raw=new Float32Array([0,0,0,0,6,0,6,0,0,0,0,0,6,0,0,0,0,6,0,0,0,0,0,6,0,6,0,6,0,0,0,6,0,0,0,6]);
const seated=keycapSculpt.seat(cap,raw,{heightMm:8});window.currentModel=seated.positions;window.initialModel=Array.from(currentModel);
window.renderReview=function(canvas,which){calls.render.push(which);const paint=function(){const colors={perspective:'#d3a6b7',front:'#ff0000',side:'#00ff00',back:'#0000ff'};if(mode.pixel){const c=canvas.getContext('2d');c.fillStyle=colors[which];c.fillRect(0,0,canvas.width,canvas.height);return;}const a={perspective:[-.62,.52],front:[0,0],side:[Math.PI/2,0],back:[Math.PI,0]}[which];const v=keycapView3d.attach(canvas,{spin:false,interactive:false,az:a[0],el:a[1],dist:3,maxPx:640});v.setAppearance({mode:'color',base:'#d3a6b7',art:'#a3dccc'},{draw:false});v.setMesh(currentModel,{artStart:cap.positions.length});v.draw();v.stop();};if(mode.deferView===which)return new Promise(resolve=>{pending.preview=()=>{paint();resolve();};});paint();};
window.openReview=function(extra){mode={};calls={render:[],generate:[],local:[],keep:0,close:[]};pending={};const opts=Object.assign({title:'Mint crest · synthetic QA',physical:{state:'ready',summary:'Geometry checks passed · exact switch socket'},canGenerate:true,canApplyLocal:true,renderPreview:renderReview,onApplyLocal:function(payload){calls.local.push(payload);if(mode.failLocal)throw new Error('Attachment still needs attention.');return {physical:{state:'ready',summary:'Local fit checked'},message:'Local fit checked; current artwork kept.'};},onGenerate:function(payload){calls.generate.push(payload);if(mode.deferGenerate)return new Promise(resolve=>{pending.generate=resolve;});return false;},onKeep:()=>calls.keep++,onClose:reason=>calls.close.push(reason)},extra||{});window.review=artisanReview.open(opts);return !!review;};document.getElementById('launch').onclick=()=>openReview();
</script></body></html>`;
const server=http.createServer((req,res)=>{if(req.method!=='GET'){res.writeHead(405);return res.end();}res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(html);});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({executablePath:process.env.CHROME_BIN||undefined,headless:true});
 try{
  const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),errors=[],writes=[],external=[],checks=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',r=>{const req=r.request();if(req.method()!=='GET'){writes.push(req.url());return r.abort();}if(new URL(req.url()).origin!==origin){external.push(req.url());return r.abort();}return r.continue();});
  await page.goto(origin);await page.locator('#launch').click();
  const dialog=page.locator('.arDialog'),generate=dialog.getByRole('button',{name:'Revise with Meshy',exact:true}),local=dialog.getByRole('button',{name:'Apply local fit fixes',exact:true}),close=dialog.getByRole('button',{name:'Close',exact:true});
  await page.waitForFunction(()=>document.querySelector('.arCanvas').getAttribute('aria-label').includes('perspective view'));
  assert.equal(await page.evaluate(()=>document.activeElement.className),'arClose');assert.equal(await generate.isDisabled(),true);
  assert.deepEqual(await page.evaluate(()=>[calls.generate.length,calls.local.length]),[0,0]);
  assert.equal(await dialog.locator('.arHelp').getAttribute('open'),null);assert.match(await dialog.innerText(),/Print checks[\s\S]*Your visual review/);
  assert.equal(await dialog.locator('.arViews').evaluate(e=>{const b=e.getBoundingClientRect(),body=e.closest('.arBody').getBoundingClientRect();return b.top>=body.top&&b.bottom<=body.bottom;}),true,'all four view controls fit above the footer without scrolling on desktop');
  await page.screenshot({path:path.join(shots,'artisan-review-desktop-qa.png'),fullPage:true});
  await close.focus();await page.keyboard.press('Shift+Tab');assert.equal(await page.evaluate(()=>document.activeElement.className),'arLocal');
  await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement.className),'arClose');
  await page.keyboard.press('Escape');assert.equal(await dialog.count(),0);assert.equal(await page.evaluate(()=>document.activeElement.id),'launch');
  assert.deepEqual(await page.evaluate(()=>calls.close),['escape']);checks.push('Native dialog traps keyboard focus, Escape closes once and restores the opener; opening never starts work.');

  await page.locator('#launch').click();await dialog.getByRole('button',{name:'Compact character',exact:true}).click();await dialog.getByRole('button',{name:'Larger face / head',exact:true}).click();
  await dialog.getByLabel('Anything else?',{exact:true}).fill('Rounded cheeks, one pair of ears.');await dialog.getByRole('button',{name:'Back view',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.arCanvas').getAttribute('aria-label').includes('back view'));
  await generate.click();await page.waitForFunction(()=>calls.generate.length===1&&document.querySelector('.arDialog').getAttribute('aria-busy')==='false');
  assert.deepEqual(await page.evaluate(()=>calls.generate[0]),{corrections:['compact-character','larger-face'],feedback:'Rounded cheeks, one pair of ears.',view:'back'});
  assert.match(await dialog.locator('.arNotice').innerText(),/Current design kept/);
  await local.click();await page.waitForFunction(()=>calls.local.length===1&&document.querySelector('.arDialog').getAttribute('aria-busy')==='false');
  assert.equal(await dialog.locator('.arPhysicalText').textContent(),'Local fit checked');assert.equal(await dialog.locator('.arPhysicalText').getAttribute('data-state'),'ready');
  assert.equal(await page.evaluate(()=>JSON.stringify(initialModel)===JSON.stringify(Array.from(currentModel))),true);
  checks.push('Selected correction chips and feedback reach only the deliberate action callback; canceled revision and local fit preserve the original model.');

  await page.evaluate(()=>{mode.failLocal=true;});await local.click();await page.waitForFunction(()=>document.querySelector('.arNotice').getAttribute('data-error')==='true');assert.match(await dialog.locator('.arNotice').innerText(),/Attachment still needs attention/);assert.equal(await local.isDisabled(),false);
  await dialog.getByRole('button',{name:'Keep current',exact:true}).click();assert.equal(await dialog.count(),0);assert.deepEqual(await page.evaluate(()=>[calls.keep,calls.close]),[1,['keep']]);
  await page.evaluate(()=>openReview({canGenerate:false,generateUnavailableReason:'Add a Meshy API key in Settings.',physical:{state:'needs-attention',summary:'Artwork attachment needs attention',issues:['A disconnected piece remains.']}}));
  assert.equal(await generate.isVisible(),false);assert.equal(await dialog.locator('.arPaid').isVisible(),false);assert.match(await dialog.locator('.arUnavailable').innerText(),/API key/);
  assert.equal(await dialog.locator('.arPhysicalText').getAttribute('data-state'),'needs-attention');await dialog.getByText('Check details',{exact:true}).click();assert.match(await dialog.locator('.arIssues').innerText(),/disconnected piece/);
  await close.click();checks.push('Local errors are visible and retryable; Keep closes without replacing art; unavailable Meshy hides the charged action and keeps physical issues accessible.');

  await page.evaluate(()=>{openReview();window.confirmResult=null;review.confirm({message:'Uses two paid Meshy tasks. Keep your original?',ok:'Revise with Meshy',cancel:'Keep current'}).then(v=>window.confirmResult=v);});
  const confirmation=dialog.getByRole('alertdialog'),approve=confirmation.getByRole('button',{name:'Revise with Meshy',exact:true});
  assert.equal(await confirmation.count(),1);assert.equal(await page.evaluate(()=>document.activeElement.className),'arConfirmCancel');
  await page.keyboard.press('Shift+Tab');assert.equal(await page.evaluate(()=>document.activeElement.className),'arConfirmApprove');
  await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement.className),'arConfirmCancel');
  await page.keyboard.press('Escape');await page.waitForFunction(()=>window.confirmResult===false);assert.equal(await dialog.count(),1);assert.equal(await confirmation.count(),0);assert.equal(await page.evaluate(()=>document.activeElement.className),'arClose');
  await page.evaluate(()=>{window.confirmResult=null;review.confirm({message:'Two paid tasks.',ok:'Revise with Meshy'}).then(v=>window.confirmResult=v);});
  await approve.click();await page.waitForFunction(()=>window.confirmResult===true);assert.equal(await confirmation.count(),0);
  await page.evaluate(()=>{window.confirmResult=null;review.confirm({message:'Still pending.'}).then(v=>window.confirmResult=v);review.close('close');});
  await page.waitForFunction(()=>window.confirmResult===false);assert.equal(await dialog.count(),0);assert.deepEqual(await page.evaluate(()=>calls.close),['close']);
  checks.push('Paid confirmation stays in the native top layer, is mouse and keyboard reachable, Escape keeps the review, and closing resolves a pending confirmation as canceled.');

  await page.evaluate(()=>openReview());await dialog.getByRole('button',{name:'Make it larger',exact:true}).click();await page.evaluate(()=>{mode.deferGenerate=true;});await generate.click();await page.waitForFunction(()=>!!pending.generate);
  assert.equal(await generate.isDisabled(),true);assert.equal(await local.isDisabled(),true);await generate.evaluate(b=>b.click());assert.equal(await page.evaluate(()=>calls.generate.length),1);
  await page.evaluate(()=>{window.releaseOld=pending.generate;window.oldCalls=calls;});await close.click();assert.deepEqual(await page.evaluate(()=>oldCalls.close),['close']);
  await page.evaluate(()=>openReview({title:'Newer current design'}));await page.evaluate(()=>releaseOld({title:'STALE DESIGN',message:'STALE SUCCESS',physical:{state:'needs-attention'}}));await page.waitForTimeout(40);
  assert.equal(await dialog.locator('.arName').innerText(),'Newer current design');assert.equal(await dialog.locator('.arNotice').innerText(),'');assert.equal(await dialog.locator('.arPhysicalText').getAttribute('data-state'),'ready');assert.equal(await page.evaluate(()=>oldCalls.generate.length),1);
  await close.click();
  await page.evaluate(()=>{openReview();document.querySelector('[data-correction="too-small"]').click();document.querySelector('.arGenerate').click();review.close('close');});await page.waitForTimeout(30);assert.equal(await page.evaluate(()=>calls.generate.length),0);
  checks.push('A pending revision allows Close; repeated clicks cannot start another request, stale completion cannot alter a new review, and close-before-callback prevents starting it.');

  await page.evaluate(()=>openReview());await page.evaluate(()=>{mode.pixel=true;mode.deferView='front';});await dialog.getByRole('button',{name:'Front view',exact:true}).click();await page.waitForFunction(()=>!!pending.preview);
  await dialog.getByRole('button',{name:'Back view',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.arCanvas').getAttribute('aria-label').includes('back view'));
  assert.deepEqual(await dialog.locator('.arCanvas').evaluate(c=>Array.from(c.getContext('2d').getImageData(10,10,1,1).data)),[0,0,255,255]);
  await page.evaluate(()=>pending.preview());await page.waitForTimeout(30);assert.deepEqual(await dialog.locator('.arCanvas').evaluate(c=>Array.from(c.getContext('2d').getImageData(10,10,1,1).data)),[0,0,255,255]);
  assert.match(await dialog.locator('.arCanvas').getAttribute('aria-label'),/back view/);assert.equal(await page.evaluate(()=>calls.generate.length),0);await close.click();
  checks.push('Delayed front rendering cannot paint over the later Back selection; inspecting views never calls generation.');

  await page.setViewportSize({width:390,height:844});await page.locator('#launch').click();await page.waitForFunction(()=>document.querySelector('.arCanvas').getAttribute('aria-label').includes('perspective view'));
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
  const inside=await page.evaluate(()=>{const d=document.querySelector('.arDialog'),b=d.getBoundingClientRect(),foot=d.querySelector('.arFoot').getBoundingClientRect(),c=d.querySelector('.arClose').getBoundingClientRect();return {dialogFits:b.left>=0&&b.right<=innerWidth&&b.top>=0&&b.bottom<=innerHeight,closeFits:c.top>=b.top&&c.bottom<=b.bottom,footerFits:foot.top>=b.top&&foot.bottom<=b.bottom,noInnerOverflow:d.scrollWidth<=d.clientWidth+1};});assert.deepEqual(inside,{dialogFits:true,closeFits:true,footerFits:true,noInnerOverflow:true});
  await page.screenshot({path:path.join(shots,'artisan-review-mobile-qa.png'),fullPage:true});
  await dialog.getByRole('button',{name:'Compact character',exact:true}).scrollIntoViewIfNeeded();await dialog.getByRole('button',{name:'Compact character',exact:true}).click();await generate.scrollIntoViewIfNeeded();assert.equal(await generate.isDisabled(),false);
  await close.click();assert.equal(await dialog.count(),0);checks.push('390 px phone layout has no horizontal overflow; the scrollable review preserves reachable Close and fixed footer actions.');
  assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);assert.deepEqual(external,[]);
  const result={passed:true,checks,errors,writes,external,source:'Synthetic geometry, with real canvas renderer and controlled action callbacks',printerContacted:false,paidTasksStarted:false,screenshots:['artisan-review-desktop-qa.png','artisan-review-mobile-qa.png']};
  fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
 }finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
