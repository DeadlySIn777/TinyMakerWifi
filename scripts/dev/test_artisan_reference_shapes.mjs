/* Synthetic geometry probes for sculpt capabilities, NOT generated artwork.
   No printer, Meshy API, network, slicer worker or paid service is invoked. */
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const require=createRequire(import.meta.url);
const K=require('../../web/parts/keycap.js'),SC=require('../../web/parts/keycap-sculpt.js');
const R=require('../../web/parts/stl-read.js');
const H=require('../../web/parts/mesh-health.js').meshHealth;
const merge=(...p)=>new Float32Array(p.flatMap(a=>Array.from(a)));
function outward(tris) {
  let p=new Float32Array(tris.flat(2)),v=0;
  for(let i=0;i<p.length;i+=9)v+=(p[i]*(p[i+4]*p[i+8]-p[i+5]*p[i+7])-p[i+1]*(p[i+3]*p[i+8]-p[i+5]*p[i+6])+p[i+2]*(p[i+3]*p[i+7]-p[i+4]*p[i+6]))/6;
  if(v<0)for(let i=0;i<p.length;i+=9)for(let k=0;k<3;k++){let a=p[i+3+k];p[i+3+k]=p[i+6+k];p[i+6+k]=a;}
  return p;
}
function ellipsoid(c,r,angle=0) {
  const n=24,m=12,pts=[],tris=[];
  const vertex=(theta,phi)=>{let x=r[0]*Math.sin(theta)*Math.cos(phi),y=r[1]*Math.sin(theta)*Math.sin(phi);return[c[0]+x*Math.cos(angle)-y*Math.sin(angle),c[1]+x*Math.sin(angle)+y*Math.cos(angle),c[2]+r[2]*Math.cos(theta)];};
  for(let j=1;j<m;j++)pts.push(Array.from({length:n},(_,i)=>vertex(Math.PI*j/m,2*Math.PI*i/n)));
  for(let i=0;i<n;i++){tris.push([vertex(0,0),pts[0][i],pts[0][(i+1)%n]]);tris.push([vertex(Math.PI,0),pts[m-2][(i+1)%n],pts[m-2][i]]);}
  for(let j=0;j<pts.length-1;j++)for(let i=0;i<n;i++){let next=(i+1)%n;tris.push([pts[j][i],pts[j+1][i],pts[j+1][next]],[pts[j][i],pts[j+1][next],pts[j][next]]);}
  return outward(tris);
}
function tube(a,b,r0,r1) {
  const n=24,lo=[],hi=[],tris=[];
  for(let i=0;i<n;i++){const t=2*Math.PI*i/n;lo.push([a[0]+r0*Math.cos(t),a[1]+r0*Math.sin(t),a[2]]);hi.push([b[0]+r1*Math.cos(t),b[1]+r1*Math.sin(t),b[2]]);}
  for(let i=0;i<n;i++){const j=(i+1)%n;tris.push([a,lo[j],lo[i]],[b,hi[i],hi[j]],[lo[i],lo[j],hi[j]],[lo[i],hi[j],hi[i]]);}
  return outward(tris);
}
function stl(p) {
  const b=Buffer.alloc(84+p.length/9*50);b.write('SYNTHETIC TEST FIXTURE - NOT AI ARTWORK',0);b.writeUInt32LE(p.length/9,80);
  for(let i=0;i<p.length/9;i++)for(let j=0;j<9;j++)b.writeFloatLE(p[i*9+j],84+i*50+12+j*4);
  return b;
}
function parse(p) {const b=stl(p);return R.readModelFile(b.buffer.slice(b.byteOffset,b.byteOffset+b.length),'probe.stl').positions;}
const fixtures=[
 {name:'rounded-mascot',shape:merge(tube([0,0,0],[0,0,1],3.2,3.2),ellipsoid([0,0,3.9],[3.5,2.8,3.6]),ellipsoid([0,0,8.1],[4.7,3.7,4.2])),feature:'Bulbous head and body with real undercuts; three overlapping shells'},
 {name:'flower',shape:merge(tube([0,0,0],[0,0,4.1],.9,.9),ellipsoid([0,0,4.7],[2,2,1.5]),...Array.from({length:6},(_,i)=>{const a=i*Math.PI/3;return ellipsoid([3*Math.cos(a),3*Math.sin(a),4.6],[2,1.45,.85],a);})),feature:'Six curved petals projecting around a central hub and narrow stem'},
 {name:'long-horns',shape:merge(ellipsoid([0,0,3.6],[4,3,3.6]),tube([-2.4,0,5.5],[-5,0,12.5],1.1,.25),tube([2.4,0,5.5],[5,0,12.5],1.1,.25)),feature:'Two tall tapered horns connected to a rounded head; 0.50 mm source tip diameter'}
];
const folder=path.resolve('research/artisan-capabilities');
if(process.argv.includes('--report'))fs.mkdirSync(folder,{recursive:true});
const reports=[],blocked=[];let checks=0;
const check=(name,v)=>{assert.ok(v,name);checks++;};
for(const f of fixtures) {
  const begin=performance.now(),imported=parse(f.shape),health=H(imported);
  check(f.name+' source STL survives import unchanged',Buffer.from(imported.buffer).equals(Buffer.from(f.shape.buffer)));
  check(f.name+' source shells closed and outward',health.watertight&&!health.flippedEdges&&!health.degenerate);
  const cap=K.build({profile:'XDA',row:'R3',topGrid:K.gridForFace(13.7),mx:{slotClearance:.14}});
  cap.dishDepth=K.PROFILES.XDA.dishDepth;
  const seated=SC.seat(cap,imported,{heightMm:13}),inspection=SC.check(seated);
  if(!inspection.ok) console.log(JSON.stringify({fixture:f.name,inspection,seated:{size:seated.sculptMm,seatDepth:seated.seatDepth}},null,2));
  if(process.argv.includes('--report'))fs.writeFileSync(path.join(folder,f.name+'-synthetic-input.stl'),stl(f.shape));
  check(f.name+' cap and stem are byte-for-byte preserved',Buffer.from(seated.positions.buffer,0,cap.positions.byteLength).equals(Buffer.from(cap.positions.buffer)));
  check(f.name+' remains a full sculpt, not a sampled heightfield',seated.sculptTriangles===imported.length/9);
  if(!inspection.ok) {blocked.push(f.name);reports.push({name:f.name,purpose:f.feature,inputTriangles:imported.length/9,attachment:inspection,blocked:true});continue;}
  check(f.name+' attachment resolves',inspection.ok&&!inspection.anchorage.unresolved);
  check(f.name+' all shells attached',inspection.anchorage.anchored===inspection.anchorage.shells);
  const pose=SC.printPose(seated,cap);
  check(f.name+' gets a printable sculpt pose',pose.ok&&pose.mouthDown&&pose.supports);
  const oriented=K.orientAsPrinted(seated.positions,cap.angle,pose.tilt,{mouthDown:pose.mouthDown});
  const entry={positions:oriented,size:{x:seated.footprintMm.x,y:seated.footprintMm.y,z:seated.totalHeightMm},printPlan:pose,name:f.name};
  const lay=K.layout([entry]);
  check(f.name+' exact posed mesh packs on the plate',lay.ok&&lay.placed.length===1);
  const packedBounds=SC.bounds(lay.positions),bed=K.usableBed();
  check(f.name+' exact XYZ clears usable bed and supported height',packedBounds.size[0]<=bed.x+1e-4&&packedBounds.size[1]<=bed.y+1e-4&&packedBounds.size[2]<=K.BED.zSupported);
  check(f.name+' exported STL retains every posed coordinate',Buffer.from(parse(lay.positions).buffer).equals(Buffer.from(lay.positions.buffer)));
  reports.push({name:f.name,purpose:f.feature,inputTriangles:imported.length/9,outputTriangles:lay.triangles,scale:seated.scale,
    sculptMm:seated.sculptMm,overallBeforePoseMm:{x:seated.footprintMm.x,y:seated.footprintMm.y,z:seated.totalHeightMm},
    actualPackedMm:packedBounds.size,stemSlotMm:cap.slotWidth,attachment:inspection,pose,elapsedMs:+(performance.now()-begin).toFixed(1),
    hornTipMm:f.name==='long-horns'?+(0.5*seated.scale).toFixed(4):null});
  if(process.argv.includes('--report'))fs.writeFileSync(path.join(folder,f.name+'-synthetic-input.stl'),stl(f.shape));
  console.log('PASS '+f.name+': '+inspection.anchorage.shells+' attached shells; '+lay.triangles+' triangles; tilt '+pose.tilt+' degrees');
}
const result={checksPassed:checks,blocked,fixtures:reports,scope:'Offline synthetic geometry through strict STL reader, cap build, full mesh seating, attachment analysis, orientation, layout and STL roundtrip. Not actual AI art or WASM slicing.'};
if(process.argv.includes('--report'))fs.writeFileSync(path.join(folder,'results.json'),JSON.stringify(result,null,2)+'\n','utf8');
console.log(checks+' synthetic reference-style geometry checks passed');
assert.equal(blocked.length,0,'Supported reference-style probes must resolve: '+blocked.join(', '));
