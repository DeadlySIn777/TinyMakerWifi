/* Real assembled confirmation + ready-product controls. Every device endpoint
 * is an inert localhost server; no physical printer, motion, UV or paid API. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict'),{execFileSync}=require('node:child_process');
const {chromium}=require(process.env.TINYMAKER_PLAYWRIGHT || 'playwright');
const root=path.resolve(__dirname,'../..'),file=path.join(root,'.cache/start-flow-preview.html');
fs.mkdirSync(path.join(root,'.cache/browser-actions'),{recursive:true});
execFileSync(process.env.TINYMAKER_PYTHON || 'python',[path.join(root,'scripts/assemble_dashboard.py'),'-o',file],{cwd:root});
const html=fs.readFileSync(file);let scenario='',postCount=0,requests=[],status;
const preflight=()=>({ok:true,ready:scenario!=='blocked',checks:[{check:'idle',pass:true,level:'ok',detail:'idle'},{check:'sd',pass:true,level:'ok',detail:'card ready'},{check:'resin_profile',pass:true,level:'ok',detail:'Standard'},{check:'layer_count',pass:scenario!=='blocked',level:scenario==='blocked'?'fail':'ok',detail:scenario==='blocked'?'5000 of 4000 max':'10 of 4000 max'},...(scenario==='warning'?[{check:'uv',pass:false,level:'warn',detail:'DRY RUN is on - nothing will cure'}]:[])]});
const server=http.createServer((req,res)=>{
 const u=new URL(req.url,'http://localhost'),json=(value,code=200)=>{res.writeHead(code,{'Content-Type':'application/json'});res.end(JSON.stringify(value));};
 if(req.method==='POST'){
  requests.push({method:'POST',path:u.pathname,name:u.searchParams.get('name'),force:u.searchParams.get('force'),header:req.headers['x-tinymaker']});
  if(u.pathname!=='/api/print/start'){json({ok:false,error:'No other write endpoint is allowed in this test'},405);return;}
  postCount++;if(scenario==='failure')return json({ok:false,error:'model not found'},404);
  if(scenario==='low-resin'&&postCount===1)return json({ok:true,warning:'low_resin',vatRemainingMl:2});
  status={...status,busy:true,state:'Homing',stateCode:0,model:u.searchParams.get('name')};return json({ok:true,queued:true});
 }
 if(req.method!=='GET'){res.writeHead(405);res.end();return;}
 if(u.pathname==='/api/status')return json(status);
 if(u.pathname==='/api/preflight'){requests.push({method:'GET',path:u.pathname,name:u.searchParams.get('name')});return json(preflight());}
 if(u.pathname==='/api/files')return json({ok:true,files:[],items:[]});
 if(u.pathname.startsWith('/api/'))return json({ok:true});
 if(u.pathname==='/lib/three.js'){res.writeHead(200,{'Content-Type':'text/javascript'});fs.createReadStream(path.join(root,'.cache/preview/lib/three.js')).pipe(res);return;}
 if(u.pathname==='/'){res.writeHead(200,{'Content-Type':'text/html;charset=utf-8'});res.end(html);return;}
 res.writeHead(404);res.end();
});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({executablePath:process.env.CHROME_BIN || undefined,headless:true}),results=[],errors=[],blocked=[];
 try{
  for(const mode of ['cancel','blocked','warning','failure','low-resin','success']){
   scenario=mode;postCount=0;requests=[];status={ok:true,firmwareVersion:'0.18.10',firmwareBuild:'inert-start-test',state:'Idle',stateCode:0,busy:false,sdJob:'',model:'',webControl:true,sdReady:true,resinSet:true,askRefill:false,receiving:false,resumePending:null};
   const context=await browser.newContext({viewport:{width:1440,height:1050}}),page=await context.newPage();
   page.on('pageerror',e=>errors.push({mode,message:e.message}));
   await context.route('**/*',r=>{if(new URL(r.request().url()).origin!==origin){blocked.push(r.request().url());return r.abort();}return r.continue();});
   await page.goto(origin+'/#create');
   await page.evaluate(()=>{selectedModel='cap-A';statusData={...statusData,busy:false,sdReady:true,resinSet:true,webControl:true,askRefill:false,resumePending:null};
    slicesCache={name:'cap-A',mode:'current',slices:[new Uint8Array(4800)],gw:80,gh:60,modelH:.05,layers:1};window.studioPrintReady('cap-A');});
   await page.locator('#stPrintGo').click();await page.waitForFunction(()=>document.querySelector('#confirmText').textContent.includes('cap-A'));
   assert.equal(await page.evaluate(()=>startBusy),true);
   await page.evaluate(()=>window.startPrint('cap-B'));assert.match(await page.locator('#confirmText').innerText(),/cap-A/);
   if(mode==='cancel')await page.locator('#confirmButtons button').filter({hasText:'Cancel'}).click();
   else await page.locator('#confirmButtons button').filter({hasText:'Start print'}).click();
   if(mode==='warning'){await page.waitForFunction(()=>document.querySelector('#confirmText').textContent.includes('DRY RUN'));await page.locator('#confirmButtons button').filter({hasText:'Cancel'}).click();}
   if(mode==='low-resin'){
    await page.waitForFunction(()=>document.querySelector('#confirmText').textContent.includes('Low resin'));
    await page.evaluate(()=>{selectedModel='cap-B';});await page.locator('#confirmButtons button').filter({hasText:'Start anyway'}).click();
   }
   await page.waitForFunction(()=>!startBusy&&(document.querySelector('#stPrintReady').classList.contains('stOff')||!document.querySelector('#stPrintGo').disabled),null,{timeout:15000});
   if(mode==='success'||mode==='low-resin'){
    assert.equal(await page.locator('#stPrintReady').evaluate(e=>e.classList.contains('stOff')),true);
    assert.equal(postCount,mode==='low-resin'?2:1);assert.ok(requests.filter(r=>r.method==='POST').every(r=>r.name==='cap-A'&&r.header==='1'));
    if(mode==='low-resin')assert.equal(requests.filter(r=>r.method==='POST')[1].force,'1');
   }else{
    assert.equal(await page.locator('#stPrintReady').isVisible(),true);assert.equal(await page.locator('#stPrintGo').isEnabled(),true);
    assert.equal(postCount,mode==='failure'?1:0);
    if(mode==='failure'){
     scenario='success';await page.locator('#stPrintGo').click();await page.locator('#confirmButtons button').filter({hasText:'Start print'}).click();
     await page.waitForFunction(()=>!startBusy&&document.querySelector('#stPrintReady').classList.contains('stOff'));assert.equal(postCount,2);
    }
   }
   assert.ok(requests.filter(r=>r.path==='/api/preflight').every(r=>r.name==='cap-A'));
   results.push({mode,requests:[...requests],pass:true});console.log('PASS assembled inert browser Start: '+mode);await context.close();
  }
  assert.deepEqual(errors,[]);
  const updateUrls=new Set(['https://slibbinas.github.io/TinyMakerWifi/version.txt','https://slibbinas.github.io/TinyMakerWifi/slicer-version.txt','https://slibbinas.github.io/TinyMakerWifi/resin/manifest.json']);assert.deepEqual(blocked.filter(u=>!updateUrls.has(u)),[]);
  fs.writeFileSync(path.join(root,'.cache/browser-actions/start-flow-result.json'),JSON.stringify({passed:true,results,errors,blockedBackgroundUpdateChecks:blocked,printerContacted:false,physicalPrintStarted:false,allPostRequestsServedByInertLocalServer:true},null,2)+'\n');
 }finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
