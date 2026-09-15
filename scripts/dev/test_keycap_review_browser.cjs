/* Real assembled review UI, IndexedDB, exports and slicer handoff. All HTTP is
 * confined to an inert loopback server. No slicing, printing or paid service. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict'),{execFileSync}=require('node:child_process');
const {chromium}=require(process.env.TINYMAKER_PLAYWRIGHT||'playwright');
const root=path.resolve(__dirname,'../..'),out=path.join(root,'.cache/keycap-review'),cache=path.join(root,'.cache/browser-actions/modules');
const readSTL=require('../../web/parts/stl-read.js').readSTL;
fs.mkdirSync(out,{recursive:true});
execFileSync(process.env.TINYMAKER_PYTHON||'python',[path.join(root,'scripts/assemble_dashboard.py'),'-o',path.join(out,'index.html')],{cwd:root});
const html=fs.readFileSync(path.join(out,'index.html')),writes=[],blocked=[],errors=[],checks=[];
const modules=['slicer-wasm-3.5.0.js','slicer-core-3.5.0.js'];
for(const name of modules)assert.ok(fs.existsSync(path.join(cache,name)),'Cache the official pinned slicer module: '+name);
const server=http.createServer((req,res)=>{
 const url=new URL(req.url,'http://localhost'),json=v=>{res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(v));};
 if(req.method!=='GET'){writes.push({method:req.method,path:url.pathname});res.writeHead(405);res.end('Writes are forbidden in review QA');return;}
 if(url.pathname==='/api/status')return json({ok:true,firmwareVersion:'local-review',state:'Idle',busy:false,receiving:false,resumePending:false,webControl:true,slicerOn:true,sdReady:false,freeHeap:170000,layerHeight:.05});
 if(url.pathname==='/api/lib/slicer')return json({ok:true,complete:true,version:'3.5.0'});
 if(url.pathname.startsWith('/api/'))return json({ok:true,files:[],items:[]});
 const name=path.basename(url.pathname);
 if(url.pathname.startsWith('/lib/')&&modules.includes(name)){res.writeHead(200,{'Content-Type':'text/javascript'});fs.createReadStream(path.join(cache,name)).pipe(res);return;}
 if(url.pathname==='/lib/three.js'){res.writeHead(200,{'Content-Type':'text/javascript'});fs.createReadStream(path.join(root,'.cache/preview/lib/three.js')).pipe(res);return;}
 if(url.pathname==='/'){res.writeHead(200,{'Content-Type':'text/html;charset=utf-8'});res.end(html);return;}
 res.writeHead(404);res.end();
});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({executablePath:process.env.CHROME_BIN||undefined,headless:true});
 try{
  const context=await browser.newContext({viewport:{width:1440,height:1050},acceptDownloads:true});
  await context.addInitScript(()=>Object.defineProperty(navigator,'canShare',{value:undefined,configurable:true}));
  await context.route('**/*',route=>{const u=new URL(route.request().url());if(u.origin!==origin){blocked.push(u.href);return route.abort();}return route.continue();});
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  const ready=()=>page.waitForFunction(()=>document.querySelector('#kcProductStatus').textContent.includes('Ready to slice'),null,{timeout:30000});
  const reveal=async selector=>{
   // Open through the real disclosure controls, outermost first. Never force
   // hidden buttons to click or erase CSS to make a broken layout pass.
   const ancestors=await page.locator(selector).evaluate(el=>{const all=[...document.querySelectorAll('#kcCard details')],list=[];for(let p=el.parentElement;p;p=p.parentElement)if(p.tagName==='DETAILS'&&!p.open)list.unshift(all.indexOf(p));return list;});
   for(const index of ancestors){assert.ok(index>=0,'Action disclosure is part of the keycap card');await page.locator('#kcCard details').nth(index).locator(':scope > summary').click();}
   assert.equal(await page.locator(selector).isVisible(),true,selector+' must be reachable through its disclosure');
  };
  const closeDetails=()=>page.locator('#kcCard details[open]').evaluateAll(list=>list.forEach(el=>el.open=false));
  const visibleSend=async()=>{
   const names=await page.locator('#kcCard button').evaluateAll(bs=>bs.filter(b=>b.getClientRects().length&&getComputedStyle(b).visibility!=='hidden'&&b.textContent.trim()==='Send to slicer').map(b=>b.id));
   assert.deepEqual(names,['kcNext'],'Review has one visible primary Send action');
  };
  const noOverflow=async label=>{
   await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
   const result=await page.evaluate(()=>({viewport:innerWidth,width:document.documentElement.scrollWidth,card:document.querySelector('#kcCard').getBoundingClientRect().toJSON(),offenders:[...document.querySelectorAll('body *')].filter(e=>e.getClientRects().length&&!e.closest('details:not([open])')&&e.getBoundingClientRect().right>innerWidth+1).slice(-12).map(e=>({tag:e.tagName,id:e.id,text:e.textContent.slice(0,120),right:e.getBoundingClientRect().right}))}));
   if(result.width>result.viewport+1)await page.screenshot({path:path.join(out,'layout-overflow.png'),fullPage:true});
   assert.ok(result.width<=result.viewport+1,label+' page overflow: '+JSON.stringify(result));
   assert.ok(result.card.left>=-1&&result.card.right<=result.viewport+1,label+' card bounds');
  };
  const download=async(selector,name)=>{
   await reveal(selector);assert.equal(await page.locator(selector).isEnabled(),true,selector+' enabled');
   const pending=page.waitForEvent('download',{timeout:15000});await page.locator(selector).click();
   const d=await pending;await d.saveAs(path.join(out,name));return fs.readFileSync(path.join(out,name));
  };
  await page.goto(origin+'/#create');
  await page.locator('#kcBoard button').filter({hasText:/^Esc$/}).click();
  await page.locator('#kcSteps [data-step="3"]').click();await page.locator('#kcLegendOn').uncheck();
  await page.locator('#kcFile').setInputFiles(path.join(root,'research/artisan-capabilities/flower-synthetic-input.stl'));await ready();
  await page.locator('#kcSteps [data-step="4"]').click();
  await visibleSend();await noOverflow('desktop');
  for(const id of ['kcFitPanel','kcMoreActions','kcPrintDetails','kcViewControls']){
   assert.equal(await page.locator('#'+id).count(),1,id+' retains a stable disclosure');
   assert.equal(await page.locator('#'+id).evaluate(e=>e.open),false,id+' starts collapsed');
  }
  for(const selector of ['#kcStemFit','#kcReport dl','#kcShare','#kcStl','#kcDownloadProduct','#kcInspect'])assert.equal(await page.locator(selector).isVisible(),false,selector+' is tucked away');
  assert.equal(await page.locator('#kcSaveProduct').isVisible(),true);
  assert.equal(await page.locator('#kcProductStatus').isVisible(),true);
  checks.push('Desktop review has one Send, compact product status, and collapsed fit/statistics/secondary/view controls.');
  await reveal('#kcStemFit');const before=Number(await page.locator('#kcStemFit').inputValue());
  await page.locator('#kcFitTight').click();
  assert.ok(Math.abs(Number(await page.locator('#kcStemFit').inputValue())-before-.02)<.001);
  await page.waitForFunction(()=>document.querySelector('#kcProductStatus').textContent.includes('Unsaved changes'));
  await page.locator('#kcProductName').fill('Review QA flower');await page.locator('#kcSaveProduct').click();await ready();
  const saved=await page.evaluate(async()=>{const list=await keycapLibrary.list(),item=list.find(r=>r.name==='Review QA flower');if(!item)throw Error('Saved product missing');const r=await keycapLibrary.get(item.id);return {name:r.name,fit:r.product.fit.slotMm,positions:Array.from(r.product.positions)};});
  assert.equal(saved.fit,Math.round((before+.02)*100)/100);
  assert.equal(await page.locator('#kcSaveProduct').isDisabled(),true);
  await closeDetails();await page.locator('#kcCard').scrollIntoViewIfNeeded();await page.screenshot({path:path.join(out,'review-desktop.png'),fullPage:true});
  checks.push('Fit feedback changes the real socket and a saved Library product retains the chosen fit.');
  const stl=await download('#kcDownloadProduct','saved-product.stl');
  const parsed=readSTL(stl.buffer.slice(stl.byteOffset,stl.byteOffset+stl.length));assert.deepEqual(Array.from(parsed.positions),saved.positions);
  const share=await download('#kcShare','share.png'),paint=await download('#kcPaint','paint-guide.png');
  for(const [name,bytes]of[['share',share],['guide',paint]]){assert.equal(bytes.subarray(1,4).toString(),'PNG');assert.ok(bytes.readUInt32BE(16)>=1000,name+' has full-resolution export');}
  await reveal('#kcStl');assert.equal(await page.locator('#kcStl').isEnabled(),true);
  await reveal('#kcReport dl');assert.match(await page.locator('#kcReport dl').innerText(),/Layers/);
  await reveal('#kcInspect');await page.locator('#kcInspect [data-view="bottom"]').click();assert.equal(await page.locator('#kcInspect [data-view="bottom"]').getAttribute('aria-pressed'),'true');
  await page.locator('#kcInspect [data-view="perspective"]').click();
  checks.push('Saved STL is byte-coordinate exact; Share, Paint guide, print statistics and inspection stay reachable and functional.');
  await closeDetails();await page.setViewportSize({width:390,height:844});await visibleSend();await noOverflow('mobile');
  await page.locator('#kcNext').scrollIntoViewIfNeeded();
  assert.equal(await page.locator('#kcNext').isEnabled(),true);
  if(await page.locator('#designerNoticeClose').isVisible())await page.locator('#designerNoticeClose').click();
  await page.screenshot({path:path.join(out,'review-mobile.png'),fullPage:true});
  for(const selector of ['#kcStemFit','#kcShare','#kcReport dl','#kcInspect'])await reveal(selector);
  await noOverflow('mobile disclosures expanded');await closeDetails();
  checks.push('390px mobile review and expanded controls have no horizontal overflow; the single Send remains enabled.');
  await page.evaluate(()=>{const original=window.slicerLoadMesh;window.__reviewTransfers=[];window.slicerLoadMesh=function(p,n,b,o){const result=original.apply(this,arguments);window.__reviewTransfers.push({p:Array.from(p),options:o,result});return result;};});
  await page.locator('#kcNext').click();await page.waitForFunction(()=>window.__reviewTransfers.length===1&&window.slicerIsOpen&&window.slicerIsOpen(),null,{timeout:30000});
  const transfer=await page.evaluate(()=>window.__reviewTransfers[0]);assert.deepEqual(transfer.p,saved.positions);assert.deepEqual(transfer.options,{keepPose:true,noScale:true});assert.equal(transfer.result,true);
  checks.push('The single Send invokes the real slicer with the exact saved geometry, socket and pose.');
  await page.locator('.stStageBar .stSeg button[data-st="cap"]').click();await page.locator('#kcSteps [data-step="4"]').click();
  // A valid imported recipe can still be physically impossible. Its error may
  // not disappear into the collapsed statistics after decluttering.
  const code=await page.evaluate(()=>keycapShare.encode({key:'Space',profile:'DSA',row:'R3',sizeU:6.25,art:'none',digit:'',legendOn:false,raised:false}));
  await reveal('#kcLoad');await page.locator('#kcCode').fill(code);await page.locator('#kcLoad').click();
  await page.locator('#kcSteps [data-step="4"]').click();await closeDetails();await visibleSend();
  await page.waitForFunction(()=>document.querySelector('#kcNext').disabled);
  const text=await page.locator('#kcReport').innerText();assert.match(text,/does not fit|no angle|no lean|will not fit/i);
  const visibleError=await page.locator('#kcReport').evaluate(el=>[...el.querySelectorAll('*')].some(e=>e.getClientRects().length&&!e.closest('details:not([open])')&&/no angle|no lean|does not fit|will not fit/i.test(e.textContent)));
  assert.equal(visibleError,true,'Physical-fit failure is visible outside collapsed details');
  await noOverflow('mobile impossible recipe');await page.screenshot({path:path.join(out,'review-error-mobile.png'),fullPage:true});
  checks.push('An impossible shared design visibly explains the fit failure and disables Send with disclosures closed.');
  assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);
  const receipt={passed:true,checks,errors,writes,blockedRemote:[...new Set(blocked)],printerContacted:false,printStarted:false,slicingExecuted:false,paidGeneration:false};
  fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt,null,2));
 }finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
