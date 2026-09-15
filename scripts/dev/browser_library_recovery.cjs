// Real UI in a fresh local-only browser. No existing profile, key, printer or paid request.
'use strict';
const {chromium}=require(process.env.TINYMAKER_PLAYWRIGHT || 'playwright');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'../..'),out=path.join(root,'.cache');
fs.mkdirSync(path.join(root,'research/screenshots'),{recursive:true});fs.mkdirSync(path.join(root,'.cache'),{recursive:true});
const python=process.env.TINYMAKER_PYTHON || 'python';
const htmlFile=path.join(out,'library-recovery-preview.html');
fs.mkdirSync(out,{recursive:true});
execFileSync(python,[path.join(root,'scripts/assemble_dashboard.py'),'-o',htmlFile],{cwd:root});
const html=fs.readFileSync(htmlFile);
const server=http.createServer((req,res)=>{
  if(req.method!=='GET'){res.writeHead(405);return res.end();}
  if(req.url==='/'||req.url.startsWith('/?')){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(html);}
  else {res.writeHead(200,{'Content-Type':'application/json'});res.end('{}');}
});
(async()=>{
  await new Promise(resolve=>server.listen(8796,'127.0.0.1',resolve));
  const browser=await chromium.launch({executablePath:process.env.CHROME_BIN || undefined,headless:true});
  try{
    const context=await browser.newContext({viewport:{width:1360,height:1000},acceptDownloads:true});
    const page=await context.newPage(),errors=[],posts=[];
    page.on('pageerror',e=>errors.push(e.message));page.on('dialog',dialog=>dialog.accept());
    await page.route('**/*',route=>{
      if(route.request().method()!=='GET'){posts.push(route.request().url());return route.abort();}
      const u=new URL(route.request().url());if(u.hostname!=='127.0.0.1')return route.abort();
      if(u.pathname==='/api/status')return route.fulfill({json:{ok:true,firmwareVersion:'Library QA',firmwareBuild:'local-only',state:'Local preview',busy:false,receiving:false,webControl:false,freeHeap:170000,ip:'Preview only',layerText:'0 / 0',wifiText:'Local preview',sdReady:false,lastCrash:null}});
      return route.continue();
    });
    await page.goto('http://127.0.0.1:8796/#create');
    await page.locator('#kcBoard button').filter({hasText:/^A$/}).first().click();
    await page.locator('#kcSteps [data-step="3"]').click();
    await page.locator('#kcLegendOn').uncheck();
    await page.locator('#kcFile').setInputFiles(path.join(root,'research/artisan-capabilities/flower-synthetic-input.stl'));
    await page.waitForFunction(()=>document.querySelector('#kcProductStatus').textContent.includes('Ready to slice'),null,{timeout:30000});
    await page.locator('#kcProductName').fill('QA Blossom backup');
    await page.locator('#kcSaveProduct').click();
    await page.waitForFunction(()=>document.querySelector('#kcProductStatus').textContent.includes('Ready to slice'),null,{timeout:30000});
    await page.getByRole('tab',{name:/^Library/}).click();
    const room=page.locator('#stLibrary'),card=room.locator('.stLibCard').filter({has:page.getByRole('heading',{name:'QA Blossom backup',exact:true})});
    await card.waitFor();assert.match(await card.innerText(),/Ready to slice/);
    const designsBefore=await room.locator('.stLibCard').count();
    await card.locator('summary').click();
    async function download(button,name){const pending=page.waitForEvent('download');await button.click();const d=await pending;const target=path.join(out,name);await d.saveAs(target);return target;}
    const originalSTL=await download(card.getByRole('button',{name:'Export product STL',exact:true}),'library-original-product.stl');
    const backup=await download(card.getByRole('button',{name:'Backup design',exact:true}),'library-test.tm-design');
    await card.getByRole('button',{name:'Delete',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('#stLibNote').textContent.includes('Deleted "QA Blossom backup"'));
    assert.equal(await card.count(),0);assert.equal(await room.locator('.stLibCard').count(),designsBefore-1);
    await room.locator('input[type="file"][accept=".tm-design"]').setInputFiles(backup);
    await page.waitForFunction(()=>document.querySelector('#stLibNote').textContent.includes('Restored a new Library copy'));
    await card.waitFor();assert.match(await card.innerText(),/Ready to slice/);
    assert.equal(await room.locator('.stLibCard').count(),designsBefore);
    await card.locator('summary').click();
    const restoredSTL=await download(card.getByRole('button',{name:'Export product STL',exact:true}),'library-restored-product.stl');
    const first=fs.readFileSync(originalSTL),restored=fs.readFileSync(restoredSTL);assert.deepEqual(restored,first);
    assert.match(await card.innerText(),/socket\s+1\.23 mm/);
    await room.getByLabel('Find a design').fill('unmatched');assert.equal(await room.locator('.stLibCard').count(),0);
    assert.match(await room.innerText(),/no matches/);
    await room.getByLabel('Find a design').fill('blossom');assert.equal(await room.locator('.stLibCard').count(),1);
    await room.getByLabel('Show',{exact:true}).selectOption('needs-attention');assert.equal(await room.locator('.stLibCard').count(),0);
    await room.getByLabel('Show',{exact:true}).selectOption('ready');assert.equal(await room.locator('.stLibCard').count(),1);
    await page.screenshot({path:path.join(root,'research/screenshots/library-recovery-desktop-qa.png'),fullPage:true});
    await page.setViewportSize({width:390,height:844});
    await page.waitForTimeout(200);
    const mobile=await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth}));
    assert.ok(mobile.scrollWidth<=mobile.width,'Library has horizontal overflow: '+JSON.stringify(mobile));
    await page.screenshot({path:path.join(root,'research/screenshots/library-recovery-mobile-qa.png'),fullPage:true});
    assert.deepEqual(errors,[]);assert.deepEqual(posts,[]);
    const result={passed:true,isolatedBrowser:true,network:'loopback preview only',source:'Synthetic flower regression fixture, not a new generated design',
      checks:['imported source auto assembles and saves','design backup downloaded through UI','local fixture deleted then restored through file input','saved product STL remains byte-identical','socket fit preserved at 1.23mm','case-insensitive name search','readiness filter and no-match guidance','390px Library has no horizontal overflow'],
      designsBeforeAndAfter:designsBefore,originalSTLBytes:first.length,backupBytes:fs.statSync(backup).size,productSha256:crypto.createHash('sha256').update(first).digest('hex'),mobile,browserErrors:errors,posts,printStarted:false,newGenerationStarted:false};
    fs.writeFileSync(path.join(out,'browser-library-recovery.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
  }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);server.close();process.exitCode=1;});
