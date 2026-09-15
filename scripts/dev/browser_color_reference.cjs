// End-to-end reference colors in an isolated designer. Synthetic GLB fixture;
// no Meshy requests, printer writes, printing, or existing browser profile.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.TINYMAKER_PLAYWRIGHT || 'playwright');
const root=path.resolve(__dirname,'../..'),R=require('../../web/parts/stl-read.js');
fs.mkdirSync(path.join(root,'research/screenshots'),{recursive:true});fs.mkdirSync(path.join(root,'.cache'),{recursive:true});
function flower(){
 const b=fs.readFileSync(path.join(root,'research/artisan-capabilities/flower-synthetic-input.stl'));
 const pos=R.readSTL(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)).positions;
 const gl=new Float32Array(pos.length),color=new Float32Array(pos.length);
 for(let i=0;i<pos.length;i+=3){gl[i]=pos[i];gl[i+1]=pos[i+2];gl[i+2]=-pos[i+1];
  const r=Math.hypot(pos[i],pos[i+1]),c=pos[i+2]<2?[.08,.55,.24]:r<2.4?[1,.6,.08]:[.98,.18,.38];color.set(c,i);}
 const bin=Buffer.concat([Buffer.from(gl.buffer),Buffer.from(color.buffer)]);
 const doc={asset:{version:'2.0'},buffers:[{byteLength:bin.length}],bufferViews:[{buffer:0,byteOffset:0,byteLength:gl.byteLength},{buffer:0,byteOffset:gl.byteLength,byteLength:color.byteLength}],
  accessors:[{bufferView:0,componentType:5126,count:pos.length/3,type:'VEC3'},{bufferView:1,componentType:5126,count:pos.length/3,type:'VEC3'}],
  meshes:[{primitives:[{attributes:{POSITION:0,COLOR_0:1}}]}],nodes:[{mesh:0}],scenes:[{nodes:[0]}],scene:0};
 const json=Buffer.from(JSON.stringify(doc)),jp=Buffer.concat([json,Buffer.alloc((4-json.length%4)%4,32)]),out=Buffer.alloc(28+jp.length+bin.length);
 out.writeUInt32LE(0x46546c67);out.writeUInt32LE(2,4);out.writeUInt32LE(out.length,8);out.writeUInt32LE(jp.length,12);out.writeUInt32LE(0x4e4f534a,16);jp.copy(out,20);out.writeUInt32LE(bin.length,20+jp.length);out.writeUInt32LE(0x004e4942,24+jp.length);bin.copy(out,28+jp.length);
 return {buffer:out,colors:color};
}
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROME_BIN || undefined,headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1060},acceptDownloads:true}),errors=[],writes=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',r=>{let u=new URL(r.request().url());if(r.request().method()!=='GET'){writes.push(u.pathname);return r.abort();}if(u.hostname!=='127.0.0.1')return r.abort();if(u.pathname==='/api/status')return r.fulfill({json:{state:'Idle',busy:false,receiving:false,webControl:true,sdReady:false,firmwareVersion:'local-color-test'}});return r.continue();});
  await page.goto('http://127.0.0.1:8794/#create');await page.locator('#kcBoard button').filter({hasText:/^Esc$/}).click();await page.locator('#kcSteps [data-step="3"]').click();await page.locator('#kcLegendOn').uncheck();
  const fixture=flower();await page.locator('#kcFile').setInputFiles({name:'Color reference QA flower.glb',mimeType:'model/gltf-binary',buffer:fixture.buffer});
  await page.waitForFunction(()=>document.querySelector('#kcProductStatus').textContent.includes('Ready to slice'),null,{timeout:40000});
  const initial=await page.evaluate(async()=>{let a=await keycapLibrary.list();let r=await keycapLibrary.get(a[0].id);return {colors:[...r.sourceColors],kind:r.sourceColorKind,positions:[...r.product.positions]};});
  assert.deepEqual(initial.colors,[...fixture.colors]);assert.equal(initial.kind,'vertex');
  await page.getByRole('button',{name:'Color reference',exact:true}).click();await page.locator('#kcColorOptions summary').click();
  assert.equal(await page.locator('#kcSourceColors').isChecked(),true);assert.equal(await page.locator('#kcArtColor').isDisabled(),true);
  await page.locator('#kcBaseColor').fill('#402235');await page.locator('#kcBaseColor').dispatchEvent('input');
  await page.locator('#kcProductName').fill('Color reference QA flower');await page.locator('#kcSaveProduct').click();
  await page.waitForFunction(()=>document.querySelector('#kcProductStatus').textContent.includes('Ready to slice'));
  const saved=await page.evaluate(async()=>{let a=await keycapLibrary.list();let r=await keycapLibrary.get(a[0].id);return {colors:[...r.sourceColors],positions:[...r.product.positions],design:keycapShare.decode(r.design)};});
  assert.deepEqual(saved.positions,initial.positions,'reference color never changes exported mesh');assert.deepEqual(saved.colors,initial.colors);assert.equal(saved.design.colorMode,'color');assert.equal(saved.design.baseColor,'#402235');
  await page.locator('#kcCard').screenshot({path:path.join(root,'research/screenshots/color-reference-desktop.png')});
  await page.reload();await page.waitForFunction(()=>!document.querySelector('#kcProductPanel').hidden&&document.querySelector('#kcProductStatus').textContent.includes('Ready to slice'));
  assert.equal(await page.locator('#kcColorOptions').isVisible(),true);assert.equal(await page.locator('#kcBaseColor').inputValue(),'#402235');
  await page.locator('#kcColorOptions summary').click();await page.locator('#kcSourceColors').uncheck();assert.equal(await page.locator('#kcArtColor').isEnabled(),true);
  await page.locator('#kcArtColor').fill('#22ddee');await page.locator('#kcArtColor').dispatchEvent('input');
  assert.match(await page.locator('#kcColorSource').innerText(),/Custom swatches/);
  await page.getByRole('button',{name:'About color reference',exact:true}).click();assert.match(await page.locator('#designerHelpBody').innerText(),/no color instructions/);await page.getByRole('button',{name:'Close help',exact:true}).click();
  await page.setViewportSize({width:390,height:844});await page.locator('#kcColorOptions').scrollIntoViewIfNeeded();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);await page.screenshot({path:path.join(root,'research/screenshots/color-reference-mobile.png')});
  assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);
  const receipt={passed:true,fixture:'synthetic flower with vertex colors; not a Meshy generation',checks:['GLB import preserves exact source colors','source-color toggle and custom swatches work','reference edit and save leave print mesh byte-identical','Library recipe and colors survive page reload','contextual help explains painting reference','390px layout fits'],browserErrors:errors,networkWrites:writes,printStarted:false,newGenerationStarted:false};
  fs.writeFileSync(path.join(root,'.cache/browser-color-reference.json'),JSON.stringify(receipt,null,2));console.log(JSON.stringify(receipt,null,2));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
