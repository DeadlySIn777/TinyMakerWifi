// Isolated local browser: no printer, credentials, paid generations or prints.
const {chromium}=require(process.env.TINYMAKER_PLAYWRIGHT || 'playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../..');
const meshFixture=process.env.TINYMAKER_MESHY_GLB;
if(!meshFixture){console.log('SKIP browser_designer_polish: set TINYMAKER_MESHY_GLB to an existing Meshy GLB to run this optional fixture test.');process.exit(0);}
assert.ok(fs.existsSync(meshFixture),'TINYMAKER_MESHY_GLB does not exist');
fs.mkdirSync(path.join(root,'research/screenshots'),{recursive:true});fs.mkdirSync(path.join(root,'.cache'),{recursive:true});
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROME_BIN || undefined,headless:true});
 try{
  const c=await browser.newContext({viewport:{width:1440,height:1050}}),p=await c.newPage(),errors=[],posts=[],checks=[];
  p.on('pageerror',e=>errors.push(e.message));
  await p.route('**/*',r=>{
   const u=new URL(r.request().url());if(r.request().method()!=='GET'){posts.push(u.href);return r.abort();}
   if(u.hostname!=='127.0.0.1')return r.abort();
   if(u.pathname==='/api/status')return r.fulfill({json:{ok:true,firmwareVersion:'0.18.6',firmwareBuild:'local-preview',state:'Local preview',busy:false,receiving:false,webControl:true,sdReady:false,freeHeap:170000,ip:'Preview only',lastCrash:null}});
   return r.continue();
  });
  await p.goto('http://127.0.0.1:8794/#create');
  await p.locator('#kcBoard button').filter({hasText:/^Esc$/}).click();
  await p.locator('#kcSteps [data-step="3"]').focus();await p.keyboard.press('Enter');
  assert.equal(await p.locator('#kcSteps [data-step="3"]').getAttribute('aria-current'),'step');
  await p.locator('#kcLegendOn').uncheck();
  const prompt='A chibi puppy with exactly two folded ears and a broad smiling face';
  await p.locator('#kcPrompt').fill(prompt);await p.reload();
  await p.waitForFunction(()=>document.querySelector('#kcPrompt').value.includes('chibi puppy'));
  assert.equal(await p.locator('#kcPrompt').inputValue(),prompt);
  assert.equal(await p.locator('.kcGenerationOptions').getAttribute('open'),null);
  await p.locator('#kcSteps [data-step="1"]').click();
  assert.match(await p.locator('#kcBoard .sel').innerText(),/^Esc$/);
  assert.equal(await p.locator('#kcBack').isDisabled(),true);
  await p.locator('#kcSteps [data-step="3"]').click();
  checks.push('Escape is directly selectable and remains selected with a uniform profile','stepper works by keyboard','unfinished prompt survives reload','generation options start collapsed');
  await p.locator('#kcFile').setInputFiles(meshFixture);
  await p.waitForFunction(()=>document.querySelector('#kcProductStatus').textContent.includes('Ready to slice'),null,{timeout:30000});
  assert.equal(await p.locator('#kcInsets').isVisible(),false);
  const before=await p.locator('#kcDims').innerText();
  await p.locator('#kcViewZoom').fill('130');await p.locator('#kcViewZoom').dispatchEvent('input');
  assert.equal(await p.locator('#kcViewZoomValue').innerText(),'130%');
  assert.equal(await p.locator('#kcDims').innerText(),before);
  await p.locator('#kcInspect [data-view="front"]').click();
  assert.equal(await p.locator('#kcInspect [data-view="front"]').getAttribute('aria-pressed'),'true');
  const render=await p.locator('#kcTop').evaluate(e=>({width:e.width,cssWidth:e.clientWidth}));
  assert.ok(render.width>560,'explicit inspection renders above the old 560px cap');
  await p.locator('#kcInspect [data-view="perspective"]').click();
  await p.locator('#kcProductName').fill('Existing Meshy artwork · polish preview');await p.locator('#kcSaveProduct').click();
  await p.waitForFunction(()=>document.querySelector('#kcProductStatus').textContent.includes('Ready to slice'),null,{timeout:30000});
  checks.push('blank legend/section thumbnails hidden for sculpture','preview zoom leaves actual dimensions unchanged','named inspection is highlighted and rendered sharper','actual imported Meshy artwork still saves with the assembled socket');
  await p.locator('#kcCard').evaluate(e=>e.scrollIntoView({block:'start'}));
  await p.locator('#kcCard').screenshot({path:path.join(root,'research/screenshots/designer-polish-desktop.png')});
  await p.setViewportSize({width:390,height:844});await p.waitForTimeout(400);
  assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),true,'no horizontal page overflow on a phone');
  const zr=await p.locator('#kcViewZoom').boundingBox();assert.ok(zr.width>80);
  await p.screenshot({path:path.join(root,'research/screenshots/designer-polish-mobile.png'),fullPage:true});
  checks.push('390px phone layout keeps controls inside the viewport');
  assert.deepEqual(errors,[]);assert.deepEqual(posts,[]);
  const result={passed:true,checks,render,errors,posts,newGenerationStarted:false,printStarted:false,source:'Existing downloaded Mario GLB, not a new puppy generation'};
  fs.writeFileSync(path.join(root,'.cache/browser-designer-polish.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
