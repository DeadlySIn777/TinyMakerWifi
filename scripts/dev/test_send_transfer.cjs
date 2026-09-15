/* Actual assembled browser upload controls with an inert LOCAL upload sink.
   A valid empty ZIP stands in for a completed slice; this tests transfer gates
   and responses, not slicing. No device URL is allowed and no print is started. */
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.TINYMAKER_PLAYWRIGHT || 'playwright');
const root=path.resolve(__dirname,'../..'),origin='http://127.0.0.1:8794';
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROME_BIN || undefined,headless:true});
 try{
  const context=await browser.newContext({viewport:{width:1440,height:1050}}),page=await context.newPage(),errors=[],uploads=[],blocked=[];
  let responseStatus=503,responseBody={error:'sd card unavailable'};
  const status={ok:true,firmwareVersion:'0.18.8',firmwareBuild:'local-upload-test',state:'Idle',busy:false,receiving:false,resumePending:false,webControl:true,slicerOn:true,sdReady:true,freeHeap:170000};
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',route=>{
   const r=route.request(),u=new URL(r.url());
   if(u.origin!==origin){blocked.push(u.href);return route.abort();}
   if(r.method()==='POST'&&u.pathname==='/upload'){
    const body=r.postDataBuffer();uploads.push({url:u.href,header:r.headers()['x-tinymaker'],bytes:body?.length||0,source:body?.includes(Buffer.from('slicer')),resin:body?.includes(Buffer.from('resin_ml'))});
    return route.fulfill({status:responseStatus,json:responseBody});
   }
   if(r.method()!=='GET'){blocked.push(r.method()+' '+u.href);return route.abort();}
   if(u.pathname==='/api/status')return route.fulfill({json:status});
   if(u.pathname==='/api/lib/slicer')return route.fulfill({json:{ok:true,complete:true,version:'3.5.0'}});
   if(/^\/lib\/slicer-(core|wasm)-3\.5\.0\.js$/.test(u.pathname))return route.fulfill({path:path.join(root,'.cache/browser-actions/modules',path.basename(u.pathname)),contentType:'text/javascript'});
   return route.continue();
  });
  await page.goto(origin+'/#create');
  await page.locator('.stStageBar .stSeg button[data-st="model"]').click();
  assert.equal(await page.evaluate(async()=>{await slicerLoadMod();return !!slicerMod;}),true);
  await page.evaluate(()=>slicerOpen(true,true));
  const seed=async()=>page.evaluate(()=>{
   statusData={...statusData,busy:false,sdReady:true,webControl:true,slicerOn:true};
   uploadBusy=false;deleteBusy=false;startBusy=false;slicerBusyNow=false;sliceRunning=false;
   if(typeof slicerUploading!=='undefined')slicerUploading=false;
   slicerRaw=new Float32Array([0,0,0,1,0,0,0,1,0]);slicerTr={rx:0,rz:0,scale:1};slicerFits=true;slicerScaleBlocked=false;
   const zip=new Uint8Array(22);zip.set([0x50,0x4b,0x05,0x06]);
   slicerOut={blob:new Blob([zip],{type:'application/zip'}),name:'transfer-test',layers:1,ml:0.1,rawMl:0.1,pedsakas:{x0:-1,x1:1,y0:-1,y1:1},sumazinta:{telpa:true,mastelis:1}};
   slicerOwnsPreview=true;document.querySelector('#slicerName').value='transfer-test';document.querySelector('#slicerSave').disabled=false;
   refreshSlicerCard();slicerOpen(true,true);slicerStep();
  });
  await seed();
  const states=await page.evaluate(()=>{
   const snap=()=>({send:document.querySelector('#slicerSend').disabled,save:document.querySelector('#slicerSave').disabled,title:document.querySelector('#slicerSend').title});
   const initial=snap();statusData.busy=true;slicerStep();const busy=snap();statusData.busy=false;slicerStep();const idleAgain=snap();
   document.querySelector('#slicerSave').disabled=false;statusData.sdReady=false;slicerStep();const missingSD=snap();
   statusData.sdReady=true;document.querySelector('#slicerSave').disabled=false;statusData.webControl=false;slicerStep();const webOff=snap();
   return {initial,busy,idleAgain,missingSD,webOff};
  });
  console.log('Real control gate states:',JSON.stringify(states));
  await seed();
  await page.locator('#slicerSend').click();
  await page.waitForFunction(()=>/failed|sd card unavailable/i.test(document.querySelector('#slicerProg').textContent),null,{timeout:12000});
  await page.waitForFunction(()=>!uploadBusy);
  const failed=await page.evaluate(()=>({message:document.querySelector('#slicerProg').textContent,hasResult:!!slicerOut,ownsPreview:slicerOwnsPreview,sendDisabled:document.querySelector('#slicerSend').disabled,saveDisabled:document.querySelector('#slicerSave').disabled}));
  console.log('Rejected local upload:',JSON.stringify(failed));
  if(await page.locator('#designerHelpDialog').isVisible())await page.locator('#designerHelpClose').click();
  responseStatus=201;responseBody={ok:true,queued:true,name:'transfer-test',importId:'0123456789abcdef0123456789abcdef'};
  status.importResult={id:responseBody.importId,ok:true,name:'transfer-test',error:''};
  await seed();
  await page.locator('#slicerSend').click();
  await page.waitForFunction(()=>slicerOut===null,null,{timeout:15000});
  const result={passed:false,states,failed,uploads,errors,blocked,slicedFixture:'Valid empty ZIP, no printable job',actualSlicing:false,actualPrinterContact:false,printStarted:false};
  fs.mkdirSync(path.join(root,'.cache/browser-actions'),{recursive:true});
  fs.writeFileSync(path.join(root,'.cache/browser-actions/upload-result.json'),JSON.stringify(result,null,2));
  assert.deepEqual(errors,[]);assert.equal(uploads.length,2);assert.ok(uploads.every(u=>u.header==='1'&&u.source&&u.resin));
  assert.equal(states.initial.send,false);assert.equal(states.busy.send,true);
  assert.equal(states.idleAgain.send,false,'a transient busy state must not strand Send');
  assert.equal(states.missingSD.send,true,'known missing SD must not offer Send');
  assert.equal(states.webOff.send,true,'web control off must not offer Send');
  assert.match(failed.message,/sd card unavailable/i,'show the server reason');
  assert.equal(failed.hasResult,true);assert.equal(failed.ownsPreview,true,'failed upload must retain the sliced preview');
  assert.equal(failed.sendDisabled,false,'failed upload must remain retryable');
  result.passed=true;fs.writeFileSync(path.join(root,'.cache/browser-actions/upload-result.json'),JSON.stringify(result,null,2));
  console.log('PASS actual Send button, busy recovery, SD/web control gates, server reason and retry after rejection; local successful upload completes without printing.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
