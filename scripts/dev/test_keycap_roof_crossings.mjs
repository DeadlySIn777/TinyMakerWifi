/* Independent strict segment/triangle checks for the exact audit failures.
   This does not reuse the generator's clipping or clearance implementation. */
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
require('../../web/parts/mesh-health.js');
const K=require('../../web/parts/keycap.js'),I=require('../../web/parts/keycap-icons.js');
const sub=(a,b)=>a.map((v,i)=>v-b[i]);
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0);
function segmentTriangle(p,q,t) {
  const d=sub(q,p),e1=sub(t[1],t[0]),e2=sub(t[2],t[0]),h=cross(d,e2),a=dot(e1,h);
  if(Math.abs(a)<1e-12) return false;
  const s=sub(p,t[0]),u=dot(s,h)/a,r=cross(s,e1),v=dot(d,r)/a,z=dot(e2,r)/a;
  return z>1e-7&&z<1-1e-7&&u>1e-7&&v>1e-7&&u+v<1-1e-7;
}
function intersects(a,b) {
  for(let k=0;k<3;k++) if(segmentTriangle(a[k],a[(k+1)%3],b)||segmentTriangle(b[k],b[(k+1)%3],a)) return true;
  return false;
}
function crossings(cap) {
  const p=cap.positions,n=cap.topGrid,topCount=2*(n-1)*(n-1),ringCount=4*n-4;
  const roofStart=topCount+6*ringCount,roofEnd=roofStart+ringCount+12;
  function triangle(i) { return [Array.from(p.slice(i*9,i*9+3)),Array.from(p.slice(i*9+3,i*9+6)),Array.from(p.slice(i*9+6,i*9+9))]; }
  function bounds(t) { return [0,1,2].map(k=>[Math.min(...t.map(v=>v[k])),Math.max(...t.map(v=>v[k]))]); }
  const tops=Array.from({length:topCount},(_,i)=>{const t=triangle(i);return {t,b:bounds(t)};});
  let count=0;
  for(let r=roofStart;r<roofEnd;r++) {
    const t=triangle(r),b= bounds(t);
    for(const top of tops) {
      if(top.b.some((a,k)=>a[1]<b[k][0]||a[0]>b[k][1])) continue;
      if(intersects(top.t,t)) count++;
    }
  }
  return count;
}
let checks=0;
for(const [profile,icon,depth] of [['XDA','ifak',2],['SA','ifak',6],['SA','creeper',4],['DSA','ifak',.55]]) {
  const opts={profile,row:'R3',relief:I.makeRelief({icon},{depth,raised:false}),topGrid:K.gridForFace(K.capWidth(1)-2*K.PROFILES[profile].topInset)};
  let c;
  try { c=K.build(opts); }
  catch(e) {
    assert.match(e.message,/legend|artwork/);checks++;
    console.log('OK '+profile+' '+icon+' '+depth+' mm refused with an actionable engraving limit: '+e.message);
    continue;
  }
  const count=crossings(c);
  assert.equal(count,0,profile+' '+icon+' must have zero top/roof crossings');checks++;
  const h=global.meshHealth(c.positions);
  assert.ok(h.watertight&&!h.degenerate&&!h.flippedEdges);checks++;
  console.log('OK '+profile+' '+icon+' '+depth+' mm: zero strict crossings; '+c.triangles+' closed triangles');
}
const defeated=K.build({profile:'XDA',row:'R3',topGrid:K.gridForFace(13.7),minRoof:-99,
  relief:I.makeRelief({icon:'ifak'},{depth:2,raised:false})});
const bad=crossings(defeated);
assert.ok(bad>0,'strict detector must catch the original unprotected roof');checks++;
console.log('OK positive control: '+bad+' crossings when the guard is defeated');
console.log(checks+' independent roof-crossing checks passed');
