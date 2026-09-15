/* Actual assembled browser + real localhost HTTP upload/status endpoints.
 * Only a 22-byte empty ZIP fixture is sent; no printer or print endpoint exists. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require(process.env.TINYMAKER_PLAYWRIGHT || 'playwright');
const root=path.resolve(__dirname,'../..'),html=fs.readFileSync(path.join(root,'.cache/preview/index.html'));
const id='0123456789abcdef0123456789abcdef',other='fedcba9876543210fedcba9876543210';
let mode='',failStatus=false,importResult=null,uploads=[];
const status=()=>({ok:true,firmwareVersion:'0.18.9',firmwareBuild:'local-receipt-test',state:'Idle',busy:false,receiving:false,resumePending:false,webControl:true,slicerOn:true,sdReady:true,freeHeap:170000,sdJob:'',sdRev:1,importResult});
const server=http.createServer((req,res)=>{
 const url=new URL(req.url,'http://localhost');const json=(value,code=200)=>{res.writeHead(code,{'Content-Type':'application/json'});res.end(JSON.stringify(value));};
 if(req.method==='POST'&&url.pathname==='/upload'){
  const chunks=[];req.on('data',b=>chunks.push(b));req.on('end',()=>{
   const b=Buffer.concat(chunks);uploads.push({bytes:b.length,header:req.headers['x-tinymaker'],hasFixture:b.includes(Buffer.from([0x50,0x4b,0x05,0x06]))});
   if(mode==='lost-post'){res.writeHead(201,{'Content-Type':'application/json','Content-Length':'128'});res.flushHeaders();res.write('{"ok":');setImmediate(()=>res.destroy());return;}
   if(mode==='malformed'){res.writeHead(201,{'Content-Type':'application/json'});res.end('{broken');return;}
   if(mode==='failure')importResult={id,ok:false,name:'receipt-test',error:'ZIP contains no printable layers'};
   if(mode==='success')importResult={id,ok:true,name:'receipt-test_2',error:''};
   if(mode==='unrelated')importResult={id:other,ok:true,name:'old-model',error:''};
   if(mode==='connection-loss')failStatus=true;
   json({ok:true,queued:true,name:'receipt-test',importId:id},201);
  });return;
 }
 if(req.method!=='GET'){res.writeHead(405);res.end();return;}
 if(url.pathname==='/api/status')return failStatus?json({error:'Temporary local network failure'},503):json(status());
 if(url.pathname==='/api/lib/slicer')return json({ok:true,complete:true,version:'3.5.0'});
 if(url.pathname==='/api/files')return json({ok:true,items:[],files:[]});
 if(url.pathname.startsWith('/api/'))return json({ok:true});
 const name=path.basename(url.pathname);
 if(/^slicer-(core|wasm)-3\.5\.0\.js$/.test(name)){res.writeHead(200,{'Content-Type':'text/javascript'});fs.createReadStream(path.join(root,'.cache/browser-actions/modules',name)).pipe(res);return;}
 if(name==='three.js'){res.writeHead(200,{'Content-Type':'text/javascript'});fs.createReadStream(path.join(root,'.cache/preview/lib/three.js')).pipe(res);return;}
 if(url.pathname==='/'){res.writeHead(200,{'Content-Type':'text/html;charset=utf-8'});res.end(html);return;}
 res.writeHead(404);res.end();
});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({executablePath:process.env.CHROME_BIN || undefined,headless:true});
 const results=[],errors=[],blocked=[];
 try{
  for(const scenario of ['failure','malformed','unrelated','reboot','lost-post','connection-loss','success']){
   mode=scenario;failStatus=false;importResult=null;uploads=[];
   const context=await browser.newContext({viewport:{width:1440,height:1050}}),page=await context.newPage();
   page.on('pageerror',e=>errors.push({scenario,message:e.message}));
   await context.route('**/*',r=>{if(new URL(r.request().url()).origin!==origin){blocked.push(r.request().url());return r.abort();}return r.continue();});
   await page.goto(origin+'/#create');await page.locator('.stStageBar .stSeg button[data-st="model"]').click();
   await page.evaluate(async()=>{await slicerLoadMod();slicerOpen(true,true);
    statusData={...statusData,busy:false,sdReady:true,webControl:true,slicerOn:true};uploadBusy=false;deleteBusy=false;startBusy=false;slicerBusyNow=false;sliceRunning=false;
    slicerRaw=new Float32Array([0,0,0,1,0,0,0,1,0]);slicerTr={rx:0,rz:0,scale:1};slicerFits=true;slicerScaleBlocked=false;
    const zip=new Uint8Array(22);zip.set([0x50,0x4b,0x05,0x06]);
    slicerOut={blob:new Blob([zip],{type:'application/zip'}),name:'receipt-test',layers:1,ml:.1,rawMl:.1,pedsakas:{x0:-1,x1:1,y0:-1,y1:1}};
    slicerOwnsPreview=true;document.querySelector('#slicerName').value='receipt-test';
    window.__receiptReady=[];const ready=window.studioPrintReady;window.studioPrintReady=function(name){window.__receiptReady.push(name);return ready&&ready.apply(this,arguments);};
    refreshSlicerCard();slicerOpen(true,true);slicerStep();
   });
   await page.locator('#slicerSend').click();
   await page.waitForFunction(()=>!slicerUploading&&(/kept|Saved as/.test(document.querySelector('#slicerProg').textContent)),null,{timeout:20000});
   const snap=()=>page.evaluate(()=>({message:document.querySelector('#slicerProg').textContent,kept:!!slicerOut,ownsPreview:slicerOwnsPreview,delivery:slicerOut&&slicerOut._delivery,button:document.querySelector('#slicerSend').textContent,ready:[...window.__receiptReady]}));
   let result=await snap();
   if(scenario==='success'){
    assert.equal(result.kept,false);assert.match(result.message,/receipt-test_2/);await page.waitForFunction(()=>window.__receiptReady.length===1);result=await snap();assert.deepEqual(result.ready,['receipt-test_2']);
   }else{
    assert.equal(result.kept,true,scenario+' must keep the slice');assert.equal(result.ownsPreview,true);assert.equal(result.ready.length,0);assert.doesNotMatch(result.message,/Saved as|is on the printer/);
    if(scenario==='failure'){assert.match(result.message,/no printable layers/);assert.equal(result.delivery,undefined);assert.equal(result.button,'Send to printer');}
    if(scenario==='unrelated'||scenario==='reboot'){
     assert.match(result.message,/could not be verified/);assert.equal(result.delivery,undefined);assert.equal(result.button,'Send to printer');
     assert.equal(uploads.length,1,'unverified status cannot trigger an automatic second upload');
     mode='success';if(await page.locator('#designerHelpDialog').isVisible())await page.locator('#designerHelpClose').click();
     await page.locator('#slicerSend').click();await page.waitForFunction(()=>slicerOut===null,null,{timeout:10000});
     await page.waitForFunction(()=>window.__receiptReady.length===1);assert.equal(uploads.length,2,'explicit retry remains available after an unavailable receipt');result.explicitRetrySucceeded=true;
    }
    if(scenario==='lost-post')assert.match(result.message,/response lost/i);
    if(scenario==='connection-loss'){
     assert.match(result.message,/Connection lost while confirming/);assert.equal(result.delivery.id,id);assert.equal(result.button,'Check transfer');
     failStatus=false;importResult={id,ok:true,name:'receipt-test',error:''};
     if(await page.locator('#designerHelpDialog').isVisible())await page.locator('#designerHelpClose').click();
     await page.locator('#slicerSend').click();await page.waitForFunction(()=>slicerOut===null,null,{timeout:10000});
     await page.waitForFunction(()=>window.__receiptReady.length===1);assert.deepEqual((await snap()).ready,['receipt-test']);
     assert.equal(uploads.length,1,'Check transfer must not upload the ZIP again');result.recoveredWithoutReupload=true;
    }
   }
   assert.equal(uploads.length,scenario==='unrelated'||scenario==='reboot'?2:1);assert.ok(uploads.every(u=>u.hasFixture&&u.header==='1'));results.push({scenario,...result,uploads:[...uploads]});
   console.log('PASS actual local HTTP/browser import receipt: '+scenario);await context.close();
  }
  assert.deepEqual(errors,[]);
  const backgroundUpdates=new Set(['https://slibbinas.github.io/TinyMakerWifi/version.txt','https://slibbinas.github.io/TinyMakerWifi/slicer-version.txt','https://slibbinas.github.io/TinyMakerWifi/resin/manifest.json']);
  assert.deepEqual(blocked.filter(url=>!backgroundUpdates.has(url)),[],'only expected background update checks may be attempted, and every one is aborted locally');
  const receipt={passed:true,results,errors,blockedBackgroundUpdateChecks:blocked,externalRequestsAllowed:0,actualLocalHttp:true,printerContacted:false,printStarted:false,fixture:'22-byte empty ZIP, not printable'};
  fs.writeFileSync(path.join(root,'.cache/browser-actions/import-receipt-result.json'),JSON.stringify(receipt,null,2)+'\n');
 }finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
