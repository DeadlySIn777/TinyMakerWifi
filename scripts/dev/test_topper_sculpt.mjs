/* Real topper UI + real geometry engines, with only DOM/storage/slicer-boundary
 * fixtures. No production function is copied, no browser/printer/network used.
 * Run: node scripts/dev/test_topper_sculpt.mjs */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {meshHealth}=require('../../web/parts/mesh-health.js');
const K=require('../../web/parts/keycap.js');
const SC=require('../../web/parts/keycap-sculpt.js');
const T=require('../../web/parts/topper.js');
const R=require('../../web/parts/stl-read.js');
const source=fs.readFileSync(new URL('../../web/parts/topper-ui.js',import.meta.url),'utf8');
const html=fs.readFileSync(new URL('../../web/parts/topper-card.html',import.meta.url),'utf8');
let checks=0;
function check(name,value){assert.ok(value,name);checks++;console.log('PASS '+name);}
function box(x=4,y=4,z=12,dx=0,dy=0,dz=0){
  const p=[[-x/2,-y/2,0],[x/2,-y/2,0],[x/2,y/2,0],[-x/2,y/2,0],[-x/2,-y/2,z],[x/2,-y/2,z],[x/2,y/2,z],[-x/2,y/2,z]].map(v=>[v[0]+dx,v[1]+dy,v[2]+dz]),out=[];
  for(const q of [[0,3,2,1],[4,5,6,7],[0,1,5,4],[1,2,6,5],[2,3,7,6],[3,0,4,7]])
    for(const i of [q[0],q[1],q[2],q[0],q[2],q[3]])out.push(...p[i]);
  return new Float32Array(out);
}
const join=(...a)=>new Float32Array(a.flatMap(p=>Array.from(p)));
function binary(p){
  const b=new ArrayBuffer(84+p.length/9*50),v=new DataView(b);v.setUint32(80,p.length/9,true);
  for(let i=0;i<p.length;i++)v.setFloat32(84+Math.floor(i/9)*50+12+(i%9)*4,p[i],true);
  return b;
}
function fixture(overrides={}){
  const elements=new Map(),calls=[];
  for(const m of html.matchAll(/<(?:input|select|button|canvas|p|output|section|label)\b[^>]*\bid=['"]([^'"]+)['"][^>]*>/g)){
    const value=/\bvalue=['"]([^'"]*)['"]/.exec(m[0]);
    elements.set(m[1],{id:m[1],value:value?value[1]:'',disabled:false,textContent:'',className:'',style:{},listeners:{},addEventListener(k,f){this.listeners[k]=f;}});
  }
  const el=id=>{assert.ok(elements.has(id),'Actual topper HTML contains '+id);return elements.get(id);};
  el('tpPreset').value='pencil-round';el('tpShape').value='round';
  Object.entries(overrides).forEach(([k,v])=>el(k).value=String(v));
  const ctx={Math,Number,Promise,Float32Array,ArrayBuffer,DataView,Blob,JSON,
    localStorage:{getItem:()=>null,setItem(){}},
    document:{getElementById:el,createElement:()=>({click(){},remove(){}}),body:{appendChild(){}}},
    URL:{createObjectURL:b=>{calls.push({type:'blob',blob:b});return 'blob:offline-topper-test';},revokeObjectURL(){}},setTimeout:()=>0,
    fetch(){throw Error('Network forbidden by offline geometry regression');},
    topper:T,keycap:K,keycapSculpt:SC,meshHealth,stlRead:R,
    keycapView3d:{attach:()=>({setMesh:p=>calls.push({type:'preview',positions:p})})},
    keycapLibrary:{save:async r=>{calls.push({type:'save',...r});return {id:'offline'};}},
    slicerLoadMod:async()=>true,
    slicerLoadMesh:(p,name,bytes,opts)=>{calls.push({type:'slice',positions:p,name,bytes,opts});return true;}
  };
  ctx.window=ctx;vm.createContext(ctx);vm.runInContext(source,ctx,{filename:'topper-ui.js:real-make-geometry'});
  return {ctx,el,calls,
    click:async id=>el(id).listeners.click(),
    change:async(id,value)=>{el(id).value=String(value);return (el(id).listeners.change||el(id).listeners.input)({target:el(id)});},
    file:async(name,p)=>{const b=binary(p),target=el('tpArtFile');target.files=[{name,size:b.byteLength,arrayBuffer:async()=>b}];target.value=name;await target.listeners.change({target});},
    last:type=>calls.filter(c=>c.type===type).at(-1)
  };
}
function same(a,b){return Buffer.from(a.buffer,a.byteOffset,a.byteLength).equals(Buffer.from(b.buffer,b.byteOffset,b.byteLength));}
function bounds(p){return SC.bounds(p);}
// Intersect actual triangles with a cross-section plane, then measure the two
// inner crossings along an axis. This measures the emitted bore, not metadata.
function opening(p,z,axis){
  const hits=[];
  for(let i=0;i<p.length;i+=9){
    const t=[0,3,6].map(k=>[p[i+k],p[i+k+1],p[i+k+2]]),line=[];
    for(let j=0;j<3;j++){const a=t[j],b=t[(j+1)%3];if((a[2]<z&&b[2]>z)||(a[2]>z&&b[2]<z)){const q=(z-a[2])/(b[2]-a[2]);line.push([a[0]+q*(b[0]-a[0]),a[1]+q*(b[1]-a[1])]);}}
    if(line.length!==2)continue;
    const [a,b]=line,other=1-axis;
    if((a[other]<=0&&b[other]>=0)||(a[other]>=0&&b[other]<=0)){
      if(Math.abs(a[other]-b[other])<1e-10){hits.push(a[axis],b[axis]);continue;}
      const q=-a[other]/(b[other]-a[other]);hits.push(a[axis]+q*(b[axis]-a[axis]));
    }
  }
  const positive=hits.filter(x=>x>1e-5),negative=hits.filter(x=>x< -1e-5);
  assert.ok(positive.length&&negative.length,'Bore section intersects both sides');
  return Math.min(...positive)-Math.max(...negative);
}
// Independent solid-angle classification: holes and solids both use their true
// oriented triangles. The bore must remain empty throughout its usable depth.
function winding(p,q){let sum=0;
  for(let i=0;i<p.length;i+=9){const a=[p[i]-q[0],p[i+1]-q[1],p[i+2]-q[2]],b=[p[i+3]-q[0],p[i+4]-q[1],p[i+5]-q[2]],c=[p[i+6]-q[0],p[i+7]-q[1],p[i+8]-q[2]],A=Math.hypot(...a),B=Math.hypot(...b),C=Math.hypot(...c);
    const dot=(u,v)=>u[0]*v[0]+u[1]*v[1]+u[2]*v[2];
    const det=a[0]*(b[1]*c[2]-b[2]*c[1])-a[1]*(b[0]*c[2]-b[2]*c[0])+a[2]*(b[0]*c[1]-b[1]*c[0]);
    sum+=2*Math.atan2(det,A*B*C+dot(a,b)*C+dot(b,c)*A+dot(c,a)*B);
  }
  return sum/(4*Math.PI);
}
const sculpt=join(box(4,4,8),box(6,6,4,0,0,7)); // body/head overlap by1mm
check('Connected source art has closed outward-wound shells',meshHealth(sculpt).watertight&&meshHealth(sculpt).severity==='ok');
const shapes=[
  {name:'round',fields:{},want:[7.2,7.2]},
  {name:'hex',fields:{tpPreset:'pencil-hex',tpShape:'hex'},want:[7.2*2/Math.sqrt(3),7.2]},
  {name:'oval',fields:{tpPreset:'custom',tpShape:'oval',tpWidth:9,tpSecondWidth:5},want:[9.2,5.2]}
];
for(const spec of shapes){
  const f=fixture(spec.fields);await f.click('tpSave');const plain=f.last('save');
  check(spec.name+' real plain engine output is initially valid',!!plain&&f.el('tpSave').disabled===false);
  await f.file(spec.name+'-art.stl',sculpt);await f.click('tpSave');const made=f.last('save');
  check(spec.name+' UI accepts genuinely connected body/head art',f.el('tpArtName').textContent===spec.name+'-art.stl'&&made.positions.length===plain.positions.length+sculpt.length);
  check(spec.name+' double flip preserves every base/socket coordinate',same(made.positions.subarray(0,plain.positions.length),plain.positions));
  const depth=made.facts.topper.socketDepthMm,art=made.positions.subarray(plain.positions.length),artBottom=bounds(art).mn[2],outer=bounds(plain.positions);
  check(spec.name+' measured art bite leaves at least 1 mm above bore floor',artBottom-depth>=1-1e-5&&Math.abs(outer.mx[2]-artBottom-.8)<1e-4);
  check(spec.name+' actual bore is unchanged on both axes after seating',spec.want.every((w,axis)=>Math.abs(opening(made.positions,depth*.53,axis)-w)<1e-4));
  const samples=[];
  for(const z of [.15,depth*.5,depth-.15])for(const [x,y] of [[0,0],[spec.want[0]*.20,0],[-spec.want[0]*.20,0],[0,spec.want[1]*.20],[0,-spec.want[1]*.20]])samples.push([x,y,z]);
  check(spec.name+' independent winding confirms bore remains air at 15 locations',samples.every(q=>Math.abs(winding(made.positions,q))<1e-4));
  check(spec.name+' independent roof sample is solid above the bore',Math.abs(winding(made.positions,[0,0,depth+.5])-1)<1e-4);
  const health=meshHealth(made.positions),b=bounds(made.positions);
  check(spec.name+' final union input is closed with no degenerate or flipped faces',health.watertight&&health.degenerate===0&&health.flippedEdges===0);
  check(spec.name+' final Z-up geometry clears UI support reserve without scaling',Math.abs(b.mn[2])<1e-5&&b.size[0]<=35.8&&b.size[1]<=25.6&&b.size[2]<=50);
  await f.click('tpSlice');const sent=f.last('slice');
  check(spec.name+' actual slicer boundary receives exact geometry with noScale and keepPose',!!sent&&same(sent.positions,made.positions)&&sent.opts.keepPose===true&&sent.opts.noScale===true&&sent.bytes===made.positions.byteLength);
  await f.click('tpExport');const parsed=R.readModelFile(await f.last('blob').blob.arrayBuffer(),'topper.stl');
  check(spec.name+' strict exported STL roundtrip preserves exact socket and artwork',same(parsed.positions,made.positions));
}
{
  const f=fixture();await f.file('connected.stl',sculpt);await f.click('tpSave');const working=f.last('save');
  // Bottom body reaches the roof, but the second block is genuinely detached.
  const floating=join(box(4,4,4),box(4,4,3,0,0,9));
  await f.file('floating.stl',floating);
  check('Floating upper sculpture is refused by actual geometry attachment analysis',/floating|clear of|unresolved/i.test(f.el('tpState').textContent)&&f.el('tpArtName').textContent==='connected.stl');
  await f.click('tpSave');check('A refused floating import preserves the previous printable socket and artwork',same(f.last('save').positions,working.positions));
}
{
  const f=fixture({tpDepth:22,tpArtHeight:28});
  // Narrow tall art takes the requested height rather than being XY-limited.
  await f.file('too-tall.stl',box(3,3,28));
  check('Assembly beyond 50 mm support-reserved height is rejected',/smaller|room for supports/.test(f.el('tpState').textContent)&&f.el('tpArtName').textContent==='');
  await f.click('tpSave');check('Rejected too-tall art leaves the prior plain tube usable',bounds(f.last('save').positions).size[2]===24);
}
{
  const f=fixture({tpPreset:'custom',tpWidth:24,tpWall:1.6});
  check('Outer footprint exceeding UI support reserve disables all actions',f.el('tpSave').disabled&&f.el('tpSlice').disabled&&f.el('tpExport').disabled);
  await f.click('tpSlice');await f.click('tpSave');await f.click('tpExport');
  check('Direct action handlers cannot export or send an oversized tube',!f.calls.some(c=>['save','slice','blob'].includes(c.type)));
}
console.log(checks+' real topper/sculpt integration checks passed. No slicing, printer or network access.');
