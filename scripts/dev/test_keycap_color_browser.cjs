/* Real embedded PNG/JPEG decode, isolated browser. No printer/network/API. */
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.TINYMAKER_PLAYWRIGHT || 'playwright');
(async()=>{
  const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_BIN || undefined});
  try{
    const page=await browser.newPage();let requests=0,errors=[];
    await page.route('**/*',route=>{requests++;return route.abort();});page.on('pageerror',e=>errors.push(e.message));
    await page.setContent('<!doctype html><title>Source-color test</title>');
    await page.addScriptTag({content:fs.readFileSync(path.join(__dirname,'../../web/parts/keycap-color.js'),'utf8')});
    const result=await page.evaluate(async()=>{
      const canvas=document.createElement('canvas');canvas.width=canvas.height=2;
      const ctx=canvas.getContext('2d');ctx.fillStyle='#ff0000';ctx.fillRect(0,0,1,1);ctx.fillStyle='#00ff00';ctx.fillRect(1,0,1,1);
      ctx.fillStyle='#0000ff';ctx.fillRect(0,1,1,1);ctx.fillStyle='#ffffff';ctx.fillRect(1,1,1,1);
      const bytes=new Uint8Array(await (await new Promise(resolve=>canvas.toBlob(resolve,'image/png'))).arrayBuffer());
      const parsed={positions:new Float32Array(9),colors:new Float32Array(9).fill(1),colorReference:{kind:'pending',hasBaseColor:false,
        textureJobs:[{start:0,count:3,mime:'image/png',bytes,uvs:new Float32Array([0,0,1,0,0,1]),wrapS:33071,wrapT:33071}]}};
      const png=await keycapColor.fromGLB(parsed);
      const original=[...parsed.colors];
      // Material-tinted texture in a second disjoint range keeps each primitive's paint.
      const multiple={positions:new Float32Array(18),colors:new Float32Array(18).fill(.5),colorReference:{kind:'pending',hasBaseColor:true,
        textureJobs:[parsed.colorReference.textureJobs[0],{...parsed.colorReference.textureJobs[0],start:9}]}};
      const mixed=await keycapColor.fromGLB(multiple);
      const jpegBytes=new Uint8Array(await (await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',1))).arrayBuffer());
      const jpeg=await keycapColor.fromGLB({...parsed,colorReference:{...parsed.colorReference,textureJobs:[{...parsed.colorReference.textureJobs[0],bytes:jpegBytes,mime:'image/jpeg'}]}});
      const bad=new Uint8Array(bytes);bad[0]=0;
      const fallback=await keycapColor.fromGLB({...parsed,colorReference:{...parsed.colorReference,textureJobs:[{...parsed.colorReference.textureJobs[0],bytes:bad}]}});
      return {png:{kind:png.kind,colors:[...png.colors]},mixed:{kind:mixed.kind,colors:[...mixed.colors]},jpeg:{kind:jpeg.kind,finite:[...jpeg.colors].every(Number.isFinite)},fallback:{kind:fallback.kind,colors:fallback.colors},original};
    });
    assert.equal(result.png.kind,'texture');assert.deepEqual(result.png.colors,[1,0,0,0,1,0,0,0,1]);
    assert.deepEqual(result.original,Array(9).fill(1));assert.equal(result.mixed.kind,'texture');
    assert.deepEqual(result.mixed.colors,[.5,0,0,0,.5,0,0,0,.5,.5,0,0,0,.5,0,0,0,.5]);
    assert.equal(result.jpeg.kind,'texture');assert.equal(result.jpeg.finite,true);
    assert.deepEqual(result.fallback,{kind:'none',colors:null});assert.equal(requests,0);assert.deepEqual(errors,[]);
    console.log(JSON.stringify({ok:true,checks:10,networkRequests:requests,browserErrors:errors,details:result},null,2));
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
