/* Real assembled Library with synthetic local records; no printer or paid API. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process'),{chromium}=require(process.env.TINYMAKER_PLAYWRIGHT||'playwright');
const root=path.resolve(__dirname,'../..'),out=path.join(root,'.cache/library-polish'),shots=path.join(root,'research/screenshots');
fs.mkdirSync(out,{recursive:true});fs.mkdirSync(shots,{recursive:true});
const htmlPath=path.join(out,'index.html');execFileSync(process.env.TINYMAKER_PYTHON||'python',[path.join(root,'scripts/assemble_dashboard.py'),'-o',htmlPath],{cwd:root});
const html=fs.readFileSync(htmlPath),origin='http://127.0.0.1:8797';
const server=http.createServer((req,res)=>{if(req.method!=='GET'){res.writeHead(405);return res.end();}res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(html);});
(async()=>{
 await new Promise(r=>server.listen(8797,'127.0.0.1',r));const browser=await chromium.launch({executablePath:process.env.CHROME_BIN||undefined,headless:true});
 try{
  const context=await browser.newContext({viewport:{width:1440,height:1050},acceptDownloads:true}),page=await context.newPage(),errors=[],writes=[],checks=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',route=>{const req=route.request(),url=new URL(req.url());if(req.method()!=='GET'){writes.push(url.href);return route.abort();}if(url.origin!==origin)return route.abort();
   if(url.pathname==='/api/status')return route.fulfill({json:{ok:true,firmwareVersion:'Library QA',firmwareBuild:'local synthetic fixtures',state:'Idle',busy:false,receiving:false,webControl:true,freeHeap:170000,sdReady:false,lastCrash:null}});
   if(url.pathname.startsWith('/api/'))return route.fulfill({json:{ok:true,items:[],profiles:[]}});return route.continue();});
  await page.goto(origin+'/#library');await page.waitForFunction(()=>window.studioLibrary&&window.keycapLibrary);
  await page.evaluate(async()=>{
   const raw=new Float32Array([0,0,0,0,6,0,6,0,0,0,0,0,6,0,0,0,0,6,0,0,0,0,0,6,0,6,0,6,0,0,0,6,0,0,0,6]);
   const colors=['#a9dbcc','#f3bdd6','#e6bd80','#b7a8ed','#97c8ee','#dca490'];
   const names=['Mint crest · Escape','Rose crest · Escape','Flower study','Overhang study','Pencil topper','Desk miniature'];
   const topperFields={};['tpPreset','tpModel','tpShape','tpWidth','tpSecondWidth','tpDepth','tpWall','tpFit','tpArtHeight','tpArtRotation','tpPrompt'].forEach(id=>topperFields[id]=document.getElementById(id)?.value||'');
   for(let i=0;i<names.length;i++){
    const code=keycapShare.encode({profile:'DSA',row:'R3',sizeU:1,key:'Esc',depth:.55,raised:true,legendOn:false,sculptHeightMm:8,prompt:'Synthetic geometry QA',name:names[i]});
    const cap=keycap.build({profile:'DSA',row:'R3',sizeU:1,topGrid:31,mx:{slotClearance:.08}});cap.dishDepth=keycap.PROFILES.DSA.dishDepth;cap.sizeU=1;
    const seated=keycapSculpt.seat(cap,raw,{heightMm:8}),plan=keycapSculpt.printPose(seated,cap);
    const posed=keycap.orientAsPrinted(seated.positions,cap.angle,plan.tilt||0,{mouthDown:!!plan.mouthDown});
    const product=i<2?keycapProduct.capture({positions:posed,recipe:code,fit:{slotMm:1.23},issues:[]}):i===3?keycapProduct.capture({positions:null,recipe:code,fit:{slotMm:1.23},issues:['Artwork needs attachment before slicing.']}):null;
    const canvas=document.createElement('canvas');canvas.width=440;canvas.height=330;
    const view=keycapView3d.attach(canvas,{spin:false,interactive:false,maxPx:440,dist:3});view.setAppearance({mode:'color',base:colors[i],art:colors[i]},{draw:false});
    view.setMesh(seated.positions,{artStart:cap.positions.length});view.draw();const thumb=canvas.toDataURL('image/png');view.stop();
    const rec={id:'qa-'+i,at:Date.now()-i*60000,name:names[i],prompt:i===2?'Cherry flower with wide petals':'Synthetic geometry QA',kind:i>=4?'model':'sculpt',positions:new Float32Array(raw),thumb,design:i<4?code:null,product,
     facts:{sizeMm:[18,18,16],resinMl:1.1,profile:'DSA',row:'R3',sizeU:1}};
    if(i===4){rec.topperRecipe={version:1,fields:topperFields};rec.topperSource=new Float32Array(raw);}
    if(i===0){rec.sourceColors=new Float32Array(raw.length).fill(.6);rec.sourceColorKind='texture';rec.sourceTexture={version:1,positionLength:raw.length,baseColors:new Float32Array(raw.length).fill(1),textures:[{start:0,count:raw.length/3,uvs:new Float32Array(raw.length/3*2).fill(.5),width:1,height:1,data:new Uint8ClampedArray([80,200,160,255]),wrapS:33071,wrapT:33071,filter:'linear'}]};}
    await keycapLibrary.save(rec);
   }
   window.__libraryReads=0;const get=keycapLibrary.get;keycapLibrary.get=function(id){window.__libraryReads++;return get(id);};
   await studioLibrary.draw();
  });
  if(await page.locator('#gsHide').isVisible())await page.locator('#gsHide').click();
  const room=page.locator('#stLibrary'),cards=room.locator('.stLibCard'),search=room.getByLabel('Find a design'),filter=room.getByLabel('Show',{exact:true});
  assert.equal(await cards.count(),6);assert.equal(await room.locator('.stLibDetails[open]').count(),0);
  assert.equal(await room.getByRole('button',{name:'Open in Create',exact:true}).count(),6);
  assert.equal(await room.getByRole('button',{name:'Backup design',exact:true}).count(),0);
  assert.equal(await room.getByRole('button',{name:'Delete all…',exact:true}).count(),0);
  checks.push('Six synthetic records display one primary Open action each; secondary and destructive actions start collapsed.');
  await page.screenshot({path:path.join(shots,'library-polish-desktop-qa.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});await page.waitForTimeout(150);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
  await page.screenshot({path:path.join(shots,'library-polish-mobile-qa.png'),fullPage:true});
  await page.setViewportSize({width:1440,height:1050});
  await filter.selectOption('topper');assert.equal(await cards.count(),1);assert.match(await cards.first().innerText(),/Pencil topper/);
  await filter.selectOption('model');assert.equal(await cards.count(),1);assert.match(await cards.first().innerText(),/Desk miniature/);
  await filter.selectOption('keycap');assert.equal(await cards.count(),4);
  await filter.selectOption('ready');assert.equal(await cards.count(),2);
  await search.fill('CHERRY');await filter.selectOption('artwork');assert.equal(await cards.count(),1);assert.match(await cards.first().innerText(),/Flower study/);
  assert.equal(await page.evaluate(()=>window.__libraryReads),0,'filtering must not load full meshes');
  await search.focus();await search.evaluate(e=>e.setSelectionRange(1,4));await page.evaluate(()=>studioLibrary.draw());
  assert.equal(await page.evaluate(()=>document.activeElement.id),'stLibSearch');assert.equal(await search.inputValue(),'CHERRY');assert.equal(await filter.inputValue(),'artwork');
  assert.deepEqual(await search.evaluate(e=>[e.selectionStart,e.selectionEnd]),[1,4]);
  checks.push('Type/readiness and case-insensitive prompt search use lightweight summaries; redraw preserves search, filter, keyboard focus and selection.');
  await search.fill('missing');assert.equal(await cards.count(),0);assert.match(await room.innerText(),/no matches/);
  await filter.selectOption('all');await search.fill('Mint');
  const mint=cards.filter({has:page.getByRole('heading',{name:'Mint crest · Escape',exact:true})});
  await mint.locator('summary').focus();await page.keyboard.press('Enter');assert.equal(await mint.locator('details').getAttribute('open'),'');
  const download=async(label,name)=>{const event=page.waitForEvent('download');await mint.getByRole('button',{name:label,exact:true}).click();const file=await event,p=path.join(out,name);await file.saveAs(p);return p;};
  const original=await download('Export product STL','before.stl'),backup=await download('Backup design','mint.tm-design');
  assert.equal(fs.readFileSync(backup).subarray(0,8).toString(),'TMDES004');
  await page.evaluate(()=>{window.keycapCopyText=async code=>{window.__copiedLibraryCode=code;return true;};});
  await mint.getByRole('button',{name:'Code',exact:true}).click();await page.waitForFunction(()=>!!window.__copiedLibraryCode);
  assert.match(await page.evaluate(()=>window.__copiedLibraryCode),/^TMK1-/);
  page.once('dialog',d=>d.dismiss());await mint.getByRole('button',{name:'Delete',exact:true}).click();assert.equal(await mint.count(),1);
  page.once('dialog',d=>d.accept());await mint.getByRole('button',{name:'Delete',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#stLibNote').textContent.startsWith('Deleted'));
  assert.equal(await search.inputValue(),'Mint');assert.equal(await cards.count(),0);assert.match(await room.innerText(),/no matches/);
  await room.locator('input[type=file]').setInputFiles(backup);await mint.waitFor();await mint.locator('summary').click();
  const restored=await download('Export product STL','after.stl');assert.deepEqual(fs.readFileSync(restored),fs.readFileSync(original));
  const exact=await page.evaluate(async()=>{const list=await keycapLibrary.list(),r=await keycapLibrary.get(list.find(x=>x.name==='Mint crest · Escape').id);return {texture:!!r.sourceTexture,slot:r.product.fit.slotMm,source:r.positions.length};});
  assert.deepEqual(exact,{texture:true,slot:1.23,source:36});
  checks.push('Keyboard disclosure reveals real STL/backup/code/delete handlers; canceled deletion preserves the record; confirmed delete + V4 import keeps exact STL, socket and texture.');
  await mint.getByRole('button',{name:'Open in Create',exact:true}).click();await page.waitForFunction(()=>window.studioCurrentRoom==='create');
  await page.waitForFunction(()=>document.querySelector('#kcProductName').value==='Mint crest · Escape');
  await page.getByRole('tab',{name:/^Library/}).click();assert.equal(await search.inputValue(),'Mint');assert.equal(await cards.count(),1);
  await search.fill('');await filter.selectOption('all');assert.equal(await cards.count(),6);
  checks.push('Primary Open restores the selected keycap in Create; returning to Library retains the active search.');
  assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);
  const result={passed:true,checks,source:'Synthetic geometric caps and local QA records, not generated designs',screenshots:['library-polish-desktop-qa.png','library-polish-mobile-qa.png'],errors,writes,printerContacted:false,paidGeneration:false};
  fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
 }finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
