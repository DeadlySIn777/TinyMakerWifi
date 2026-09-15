/* Actual software-rendered pixels, synthetic texture only. No browser/network. */
'use strict';
const assert=require('node:assert/strict');
global.window={devicePixelRatio:1,addEventListener(){}};
global.requestAnimationFrame=()=>0;global.cancelAnimationFrame=()=>{};
const C=require('../../web/parts/keycap-color.js'),V=require('../../web/parts/keycap-view3d.js');
function canvas(){const data=new Uint8ClampedArray(240*240*4),ctx={clearRect(){data.fill(0);},save(){},restore(){},moveTo(){},lineTo(){},fill(){},getImageData(){return {data};},putImageData(){}};
 return {data,width:240,height:240,clientWidth:240,clientHeight:240,getContext:()=>ctx,addEventListener(){}};}
function reference(positions,uvs,paint){const data=new Uint8ClampedArray(64*64*4);
 for(let y=0;y<64;y++)for(let x=0;x<64;x++)data.set([...paint(x,y),255],(y*64+x)*4);
 return {version:1,positionLength:positions.length,baseColors:new Float32Array(positions.length).fill(1),textures:[{start:0,count:positions.length/3,uvs:new Float32Array(uvs),width:64,height:64,data,wrapS:33071,wrapT:33071,filter:'nearest'}]};}
const quad=new Float32Array([-1,-1,0,1,-1,0,1,1,0,-1,-1,0,1,1,0,-1,1,0]);
const uv=[0,0,1,0,1,1,0,0,1,1,0,1];
const ref=reference(quad,uv,(x,y)=>x>16&&x<47&&y>16&&y<47?([x<29?0:0,x<29?255:0,x<29?0:255]):[255,0,0]);
const c=canvas(),view=V.attach(c,{spin:false,interactive:false,el:1.2,az:0});
const pixels=()=>new Uint8ClampedArray(c.data);
const count=channel=>{let n=0;for(let i=0;i<c.data.length;i+=4)if(c.data[i+3]&&c.data[i+channel]>c.data[i+(channel+1)%3]+40&&c.data[i+channel]>c.data[i+(channel+2)%3]+40)n++;return n;};
let groups=0;function check(name,fn){fn();groups++;console.log('PASS '+name);}
view.setAppearance({mode:'color',art:'#ff0000',useSourceColors:true});
check('texture interior retains green and blue details that every red corner misses',()=>{
 const fallback=new Float32Array(quad.length);for(let i=0;i<fallback.length;i+=3)fallback[i]=1;
 view.setMesh(quad,{artStart:0,artColors:fallback});assert.equal(count(1),0);assert.equal(count(2),0);
 view.setMesh(quad,{artStart:0,artColors:fallback,artTexture:ref});
 assert.ok(count(0)>1000);assert.ok(count(1)>150,'interior green detail');assert.ok(count(2)>150,'interior blue detail');
});
check('texture binding changes no geometry, normal, camera, or export source',()=>{
 const source=new Float32Array(quad),normal=new Float32Array(view.nrm),az=view.az,el=view.el;
 const before=pixels();view.setAppearance({mode:'solid'});const solid=pixels();
 view.setMesh(quad,{artStart:0});assert.deepEqual(pixels(),solid);
 view.setAppearance({mode:'color'});view.setMesh(quad,{artStart:0,artTexture:ref});
 assert.deepEqual(pixels(),before);assert.deepEqual(quad,source);assert.deepEqual(view.nrm,normal);assert.equal(view.az,az);assert.equal(view.el,el);
});
check('original-colors switch and subsequent plain mesh clear texture influence',()=>{
 view.setAppearance({useSourceColors:false});assert.equal(count(1),0);assert.equal(count(2),0);
 view.setAppearance({useSourceColors:true});assert.ok(count(1)>150);
 view.setMesh(quad);assert.equal(view.artTexture,null);assert.equal(view._textureFaces,null);
});
check('pixel sampler honors clamp, repeat, mirror and linear-light filtering',()=>{
 const t={width:2,height:1,data:Uint8ClampedArray.from([255,0,0,255,0,0,255,255]),wrapS:33071,wrapT:33071,filter:'nearest'},out=[];
 C.samplePixel(t,-.25,.5,out);assert.deepEqual(out,[1,0,0]);C.samplePixel(t,1.25,.5,out);assert.deepEqual(out,[0,0,1]);
 t.wrapS=10497;C.samplePixel(t,1.25,.5,out);assert.deepEqual(out,[1,0,0]);
 t.wrapS=33648;C.samplePixel(t,1.25,.5,out);assert.deepEqual(out,[0,0,1]);
 t.wrapS=33071;t.filter='linear';C.samplePixel(t,.5,.5,out);assert.deepEqual(out,[.5,0,.5]);
});
check('perspective-correct UV sampling matches interior texels, not affine interpolation',()=>{
 const p=quad.slice(0,9),gradient=reference(p,[0,0,1,0,1,1],(x)=>[Math.round(x/63*255),0,Math.round((1-x/63)*255)]);
 view.az=.4;view.el=.9;view.o.dist=1.6;view.o.fov=.8;view.setMesh(p,{artStart:0,artTexture:gradient});view.nrm.fill(0);view.draw();
 const cam=view._camera(240,240),a=cam.project(...view.pos.slice(0,3)),b=cam.project(...view.pos.slice(3,6)),d=cam.project(...view.pos.slice(6,9));
 const area=(b[0]-a[0])*(d[1]-a[1])-(b[1]-a[1])*(d[0]-a[0]);let checked=0,maxError=0,affineDifference=0;
 const linearByte=b=>b/255<=.04045?b/255/12.92:Math.pow((b/255+.055)/1.055,2.4),sample=[],affine=[];
 for(let y=0;y<240;y+=3)for(let x=0;x<240;x+=3){const i=(y*240+x)*4;if(!c.data[i+3])continue;
  const wc=((b[0]-a[0])*(y+.5-a[1])-(b[1]-a[1])*(x+.5-a[0]))/area;
  const wb=((a[0]-d[0])*(y+.5-d[1])-(a[1]-d[1])*(x+.5-d[0]))/area,wa=1-wb-wc;
  if(Math.min(wa,wb,wc)<.08)continue;
  const denominator=wa/a[2]+wb/b[2]+wc/d[2],u=(wb/b[2]+wc/d[2])/denominator,v=wc/d[2]/denominator;
  C.samplePixel(gradient.textures[0],u,v,sample);C.samplePixel(gradient.textures[0],wb+wc,wc,affine);
  maxError=Math.max(maxError,Math.abs(linearByte(c.data[i])/.497-sample[0]));
  affineDifference=Math.max(affineDifference,Math.abs(affine[0]-sample[0]));checked++;
 }
 assert.ok(checked>100);assert.ok(maxError<.012,'rendered texture discrepancy '+maxError);assert.ok(affineDifference>.05,'fixture must distinguish perspective from affine UV');
});
check('seat winding swap carries UV and tint with the identical geometric corner',()=>{
 const seated=C.reorderTextureForSeat(ref);assert.deepEqual([...seated.textures[0].uvs.slice(0,6)],[0,0,1,1,1,0]);
 assert.deepEqual(C.reorderTextureForSeat(seated),ref);assert.equal(seated.textures[0].data,ref.textures[0].data);
 view.setMesh(quad,{artStart:0,artTexture:ref});view.nrm.fill(0);view.draw();const before=pixels();
 const swapped=C.reorderForSeat(quad);view.setMesh(swapped,{artStart:0,artTexture:seated});view.nrm.fill(0);view.draw();
 assert.ok(pixels().every((n,i)=>Math.abs(n-before[i])<=1),'same physical texel after winding swap');
});
check('Library copy and structured clone preserve texture detail without shared mutable buffers',()=>{
 const saved=structuredClone(C.cloneTextureReference(ref));assert.ok(C.validTextureReference(saved,quad));assert.deepEqual(saved,ref);
 assert.notEqual(saved.baseColors.buffer,ref.baseColors.buffer);assert.notEqual(saved.textures[0].uvs.buffer,ref.textures[0].uvs.buffer);assert.notEqual(saved.textures[0].data.buffer,ref.textures[0].data.buffer);
 saved.textures[0].data[0]=0;assert.equal(ref.textures[0].data[0],255);
});
check('malformed, overlapping and oversized reference data fall back without a render crash',()=>{
 const bad=[null,{}, {...ref,version:2}, {...ref,positionLength:12000009}, {...ref,positionLength:9}];
 for(const change of [{start:3},{count:4},{width:4096},{wrapS:0},{filter:'unsafe'},{uvs:new Float32Array(12).fill(NaN)},{data:new Uint8ClampedArray(1)}])bad.push({...ref,textures:[{...ref.textures[0],...change}]});
 bad.push({...ref,textures:[ref.textures[0],ref.textures[0]]});
 for(const item of bad){assert.equal(C.validTextureReference(item,quad),false);assert.equal(C.cloneTextureReference(item),null);view.setMesh(quad,{artStart:0,artTexture:item});assert.equal(view.artTexture,null);}
 const over=reference(quad,uv,()=>[255,0,0]);over.textures=Array.from({length:17},()=>over.textures[0]);assert.equal(C.validTextureReference(over),false);
});
console.log(groups+' UV texture renderer groups passed; no network, generated artwork or physical print.');
