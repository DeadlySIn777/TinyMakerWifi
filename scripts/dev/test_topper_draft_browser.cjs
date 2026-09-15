/* Real IndexedDB + actual topper engines in a fresh local-only browser.
 * No existing browser profile, printer, paid generation, or network services. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require(process.env.TINYMAKER_PLAYWRIGHT || 'playwright');
const root=path.resolve(__dirname,'../..'),R=require('../../web/parts/stl-read.js');
function box(){const v=[[-3,-1,0],[3,-1,0],[3,1,0],[-3,1,0],[-3,-1,12],[3,-1,12],[3,1,12],[-3,1,12]],p=[];
 for(const q of [[0,3,2,1],[4,5,6,7],[0,1,5,4],[1,2,6,5],[2,3,7,6],[3,0,4,7]])for(const i of [q[0],q[1],q[2],q[0],q[2],q[3]])p.push(...v[i]);
 const out=Buffer.alloc(84+p.length/9*50);out.writeUInt32LE(p.length/9,80);p.forEach((v,i)=>out.writeFloatLE(v,84+Math.floor(i/9)*50+12+i%9*4));return out;
}
const parts=['designer-feedback.js','mesh-health.js','stl-read.js','keycap-sculpt.js','keycap-view3d.js','keycap-library.js','topper.js','topper-ui.js'];
const html='<!doctype html><meta charset="utf-8"><title>Topper local browser regression</title><style>body{font:16px Arial;background:#101113;color:#ddd;margin:24px}input,select,button{font:inherit}button{padding:10px}input[type=range]{width:90%}.calRow{display:flex;flex-wrap:wrap}.hint{color:#bbb}.warn{color:#f99}[hidden]{display:none!important}</style>'+fs.readFileSync(path.join(root,'web/parts/designer-feedback.html'),'utf8')+fs.readFileSync(path.join(root,'web/parts/topper-card.html'),'utf8')+parts.map(p=>'<script>'+fs.readFileSync(path.join(root,'web/parts',p),'utf8')+'</script>').join('');
(async()=>{
 const server=http.createServer((req,res)=>{res.writeHead(200,{'Content-Type':'text/html;charset=utf-8'});res.end(html);});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const origin='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({executablePath:process.env.CHROME_BIN || undefined,headless:true});
 try{
  const context=await browser.newContext({viewport:{width:1280,height:1000},acceptDownloads:true}),page=await context.newPage(),errors=[],blocked=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',r=>{if(new URL(r.request().url()).origin!==origin||r.request().method()!=='GET'){blocked.push(r.request().url());return r.abort();}return r.continue();});
  const waitForDraft=()=>page.waitForFunction(async()=>{const d=await new Promise(resolve=>{const rq=indexedDB.open('tmTopperDraft',1);rq.onerror=()=>resolve(null);rq.onsuccess=()=>{const db=rq.result;if(!db.objectStoreNames.contains('draft')){db.close();return resolve(null);}const tx=db.transaction('draft'),g=tx.objectStore('draft').get('current');tx.oncomplete=()=>{db.close();resolve(g.result);};};});return !!d;});
  await page.goto(origin);
  await waitForDraft();assert.equal(await page.locator('#tpDraftState').isVisible(),false);
  assert.equal(await page.locator('#topperCard .designerHelp').count(),5);
  await page.getByRole('button',{name:'About Meshy toppers'}).click();
  assert.equal(await page.locator('#designerHelpDialog').isVisible(),true);assert.match(await page.locator('#designerHelpBody').innerText(),/same Meshy API key/);
  await page.getByRole('button',{name:'Close help',exact:true}).click();assert.equal(await page.locator('#designerHelpDialog').isVisible(),false);
  await page.getByRole('button',{name:'About socket measurements'}).click();
  assert.equal(await page.locator('#designerHelpDialog').isVisible(),true);assert.match(await page.locator('#designerHelpBody').innerText(),/across two flat sides/);
  await page.getByRole('button',{name:'Close help',exact:true}).click();assert.equal(await page.locator('#designerHelpDialog').isVisible(),false);
  await page.locator('#tpModel').fill('Draft fit example');await page.locator('#tpModel').dispatchEvent('change');
  await page.locator('#tpArtFile').setInputFiles({name:'source-art.stl',mimeType:'model/stl',buffer:box()});
  await page.locator('#tpArtRotation').fill('90');await page.locator('#tpArtRotation').dispatchEvent('input');
  await page.locator('#tpFit').fill('0.3');await page.locator('#tpFit').dispatchEvent('input');
  assert.equal(await page.locator('#designerNotice').isVisible(),false,'field changes do not interrupt with notices');
  // Wait for the precise latest transaction, not an earlier status sentence.
  const readDraft=()=>new Promise((resolve,reject)=>{const rq=indexedDB.open('tmTopperDraft',1);rq.onerror=()=>reject(rq.error);rq.onsuccess=()=>{const db=rq.result,tx=db.transaction('draft'),get=tx.objectStore('draft').get('current');tx.oncomplete=()=>{db.close();resolve(get.result);};};});
  await page.waitForFunction(async()=>{const d=await new Promise(resolve=>{const rq=indexedDB.open('tmTopperDraft',1);rq.onsuccess=()=>{const db=rq.result,tx=db.transaction('draft'),g=tx.objectStore('draft').get('current');tx.oncomplete=()=>{db.close();resolve(g.result);};};});return d&&d.art&&d.fields.tpArtRotation==='90'&&Number(d.fields.tpFit)===.3;});
  const before=await page.evaluate(readDraft);assert.equal(before.art.length,108);
  await page.reload();await page.waitForFunction(()=>document.querySelector('#tpArtName').textContent==='source-art.stl');
  assert.equal(await page.locator('#tpModel').inputValue(),'Draft fit example');
  assert.equal(await page.locator('#tpArtRotation').inputValue(),'90');assert.equal(Number(await page.locator('#tpFit').inputValue()),.3);
  assert.equal(await page.locator('#tpSave').isEnabled(),true);assert.match(await page.locator('#tpArtSize').innerText(),/^\d+\.\d+ × \d+\.\d+ × \d+\.\d+ mm$/);
  await page.locator('#tpSave').click();await page.waitForFunction(()=>document.querySelector('#designerNoticeText').textContent==='Topper saved to Library.');
  assert.equal(await page.locator('#tpState').isVisible(),false);
  const saved=await page.evaluate(async()=>{const entries=await keycapLibrary.list();const r=await keycapLibrary.get(entries[0].id);return {count:entries.length,kind:r.kind,facts:r.facts,positions:Array.from(r.positions)};});
  assert.equal(saved.count,1);assert.equal(saved.kind,'model');assert.equal(saved.facts.topper.clearanceMm,.3);assert.equal(saved.facts.artRotationDeg,90);
  const downloadP=page.waitForEvent('download');await page.locator('#tpExport').click();const download=await downloadP,stream=await download.createReadStream(),chunks=[];for await(const chunk of stream)chunks.push(chunk);
  const bytes=Buffer.concat(chunks);assert.deepEqual(Array.from(R.readSTL(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)).positions),saved.positions);
  assert.equal(await page.locator('#designerNoticeText').innerText(),'Topper STL downloaded.');
  await page.locator('#tpClearArt').click();
  assert.equal(await page.locator('#designerNoticeText').innerText(),'Sculpt cleared. Your socket fit is unchanged.');
  await page.waitForFunction(async()=>{const d=await new Promise(resolve=>{const rq=indexedDB.open('tmTopperDraft',1);rq.onsuccess=()=>{const db=rq.result,tx=db.transaction('draft'),g=tx.objectStore('draft').get('current');tx.oncomplete=()=>{db.close();resolve(g.result);};};});return d&&d.art===null;});
  await page.reload();await waitForDraft();assert.equal(await page.locator('#tpDraftState').isVisible(),false);
  assert.match(await page.locator('#tpArtName').innerText(),/Plain socket/);assert.equal(await page.locator('#tpArtRotation').isEnabled(),false);
  assert.equal(await page.evaluate(async()=>(await keycapLibrary.list()).length),1,'Clearing the draft leaves saved Library models intact');
  assert.deepEqual(errors,[]);assert.deepEqual(blocked,[]);
  console.log('PASS real IndexedDB restores original sculpt, rotation and socket fit; exact STL matches saved Library geometry; clearing persists without deleting Library. No browser errors, printer calls, paid generations or printing.');
 }finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
