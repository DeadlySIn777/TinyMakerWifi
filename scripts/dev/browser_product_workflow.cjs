// Fresh headless browser against the local preview only. No live printer/API.
const {chromium}=require(process.env.TINYMAKER_PLAYWRIGHT || 'playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../..');
fs.mkdirSync(path.join(root,'research/screenshots'),{recursive:true});fs.mkdirSync(path.join(root,'.cache'),{recursive:true});
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROME_BIN || undefined,headless:true});
 try{
  const context=await browser.newContext({viewport:{width:1360,height:1000},acceptDownloads:true});
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
  await page.goto('http://127.0.0.1:8794/#create');
  await page.locator('#kcBoard button').filter({hasText:/^A$/}).first().click();
  await page.locator('#kcSteps [data-step="3"]').click();
  await page.locator('#kcLegendOn').uncheck();
  await page.locator('#kcFile').setInputFiles(path.join(root,'research/artisan-capabilities/flower-synthetic-input.stl'));
  await page.waitForFunction(()=>document.querySelector('#kcProductStatus').textContent.includes('Ready to slice'),{},{timeout:30000});
  await page.locator('#kcProductName').fill('QA flower — assembly test');
  await page.locator('#kcSculptRotation').fill('90');await page.locator('#kcSculptRotation').dispatchEvent('input');
  await page.locator('#kcSculptSize').fill('75');await page.locator('#kcSculptSize').dispatchEvent('input');
  await page.locator('#kcSaveProduct').click();
  await page.waitForFunction(()=>document.querySelector('#kcProductStatus').textContent.includes('Ready to slice'),{},{timeout:30000});
  await page.screenshot({path:path.join(root,'research/screenshots/product-editor-qa.png'),fullPage:true});
  await page.reload();
  await page.waitForFunction(()=>document.querySelector('#kcProductStatus').textContent.includes('Ready to slice'),{},{timeout:30000});
  assert.equal(await page.locator('#kcProductName').inputValue(),'QA flower — assembly test');
  assert.equal(await page.locator('#kcSculptRotation').inputValue(),'90');
  assert.equal(await page.locator('#kcSculptSize').inputValue(),'75');
  await page.getByRole('tab',{name:/^Library/}).click();
  const card=page.locator('.stLibCard').filter({has:page.getByRole('heading',{name:'QA flower — assembly test',exact:true})});
  await card.waitFor();assert.match(await card.innerText(),/Ready to slice/);
  await card.locator('summary').click();
  const downloadEvent=page.waitForEvent('download');await card.getByRole('button',{name:'Export product STL',exact:true}).click();
  const download=await downloadEvent,out=path.join(root,'.cache/qa-finished-product.stl');await download.saveAs(out);
  const bytes=fs.readFileSync(out);assert.equal(bytes.length,84+bytes.readUInt32LE(80)*50);
  await page.screenshot({path:path.join(root,'research/screenshots/product-library-qa.png'),fullPage:true});
  assert.deepEqual(errors,[]);
  const result={passed:true,isolatedBrowser:true,syntheticGeometryTest:true,network:'local preview only',checks:['import auto assembles and saves','90 degree / 75 percent placement saved','name/placement/product persist after reload','Library ready card exports binary STL'],exportBytes:bytes.length,exportTriangles:bytes.readUInt32LE(80),browserErrors:errors,printStarted:false};
  fs.writeFileSync(path.join(root,'.cache/browser-product-workflow.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
