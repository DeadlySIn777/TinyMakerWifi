/* Attachment evidence and bounded-work controls. Offline geometry only. */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const SC=require('../../web/parts/keycap-sculpt.js');
const H=require('../../web/parts/mesh-health.js');
const K=require('../../web/parts/keycap.js');
let passed=0;
function test(name,fn){fn();passed++;console.log('OK '+name);}
function cube(lo,hi){const v=[[lo[0],lo[1],lo[2]],[hi[0],lo[1],lo[2]],[hi[0],hi[1],lo[2]],[lo[0],hi[1],lo[2]],
  [lo[0],lo[1],hi[2]],[hi[0],lo[1],hi[2]],[hi[0],hi[1],hi[2]],[lo[0],hi[1],hi[2]]];
  return [[0,2,1],[0,3,2],[4,5,6],[4,6,7],[0,1,5],[0,5,4],[3,7,6],[3,6,2],[0,4,7],[0,7,3],[1,2,6],[1,6,5]].flatMap(t=>t.flatMap(i=>v[i]));}
function tetra(v){return [[0,2,1],[0,1,3],[0,3,2],[1,2,3]].flatMap(t=>t.flatMap(i=>v[i]));}
function merged(...arrays){const p=new Float32Array(arrays.reduce((n,a)=>n+a.length,0));let i=0;arrays.forEach(a=>{p.set(a,i);i+=a.length;});return p;}
function scene(cap,sculpt){return {positions:merged(cap,sculpt),capTriangles:cap.length/9,
  sculptTriangles:sculpt.length/9,triangles:(cap.length+sculpt.length)/9,footprintMm:{x:8,y:8},
  sculptMm:{x:8,y:8,z:8},pitchMm:{x:19.05,y:19.05},seatDepth:.8,totalHeightMm:12,overhangs:0};}
const cap=cube([-2,-2,0],[2,2,1]),base=cube([-1,-1,-1],[1,1,.5]);
const tip=tetra([[0,0,-1],[-.5,-.5,-2],[.5,-.5,-2],[0,.5,-2]]);
test('tetra tip touching face interior is not attached',()=>{
  const s=scene(cap,merged(base,tip));assert.equal(H.meshHealth(s.positions).severity,'ok');
  const a=SC.anchorage(s.positions,s.capTriangles);assert.equal(a.shells,2);assert.equal(a.anchored,1);
  assert.equal(a.floating.length,1);assert.equal(SC.check(s).ok,false);
});
test('tip-only connection is repaired by a real overlap, not renamed attached',()=>{
  const s=scene(cap,merged(base,tip)),r=SC.reseat(s);
  assert.equal(r.unresolved,undefined);assert.equal(r.moved.length,1);assert.ok(r.moved[0].dropMm>=.6);
  assert.equal(SC.check(r).anchorage.floating.length,0);assert.equal(SC.check(r).ok,true);
  assert.notDeepEqual(r.positions,s.positions);
});
test('shared vertex does not merge shells and bypass contact evidence',()=>{
  const t=tetra([[1,1,-1],[1.3,.7,-2],[1.7,.7,-2],[1.5,1.3,-2]]);
  const s=scene(cap,merged(base,t));assert.equal(SC.shellParts(s.positions.subarray(cap.length)).length,2);
  assert.equal(SC.anchorage(s.positions,s.capTriangles).floating.length,1);
});
test('shared edge does not merge two solids into one shell',()=>{
  const s=scene(cap,merged(base,cube([1,-1,-3],[2,1,-1])));
  assert.equal(SC.shellParts(s.positions.subarray(cap.length)).length,2);
  assert.equal(SC.anchorage(s.positions,s.capTriangles).floating.length,1);
});
test('face-only contact is refused until the shell is seated deeper',()=>{
  const s=scene(cap,merged(base,cube([-.5,-.5,-2],[.5,.5,-1])));
  assert.equal(SC.check(s).ok,false);const fixed=SC.reseat(s);
  assert.equal(fixed.moved.length,1);assert.ok(fixed.moved[0].dropMm>=.6);assert.equal(SC.check(fixed).ok,true);
});
test('overlapping tetra bounding boxes are not an attachment',()=>{
  const c=cube([-1,-1,3],[2,2,4]);
  const a=tetra([[0,0,0],[4,0,0],[0,4,0],[0,0,4]]);
  const b=tetra([[3,3,3],[1,3,3],[3,1,3],[3,3,1]]);
  const s=scene(c,merged(a,b)),h=SC.anchorage(s.positions,s.capTriangles);
  assert.equal(h.unresolved,undefined);assert.equal(h.shells,2);assert.equal(h.anchored,1);assert.equal(h.floating.length,1);
});
test('proper tetra surface crossings preserve a genuine overlap',()=>{
  const c=cube([-1,-1,3],[2,2,4]);
  const a=tetra([[0,0,0],[4,0,0],[0,4,0],[0,0,4]]);
  const b=tetra([[3,3,3],[1,3,3],[3,1,3],[3,3,1]].map(v=>v.map(x=>x-1.1)));
  const s=scene(c,merged(a,b)),h=SC.anchorage(s.positions,s.capTriangles);
  assert.equal(h.unresolved,undefined);assert.equal(h.shells,2);assert.equal(h.anchored,2);assert.equal(h.floating.length,0);
});
for(const [name,c,s] of [
  ['aligned partial overlap',cube([0,0,0],[1,1,1]),cube([.5,0,0],[1.5,1,1])],
  ['coincident solids',cube([0,0,0],[1,1,1]),cube([0,0,0],[1,1,1])],
  ['strictly contained shell',cube([-2,-2,0],[2,2,4]),cube([-.5,-.5,1],[.5,.5,2])],
])test(name+' remains attached',()=>{
  const seated=scene(c,s),a=SC.anchorage(seated.positions,seated.capTriangles);
  assert.equal(a.unresolved,undefined);assert.equal(a.anchored,1);assert.equal(a.floating.length,0);
});

test('triangle limit refuses before scanning or allocating per-triangle objects',()=>{
  const s=scene(cap,new Float32Array((300001-cap.length/9)*9));
  const r=SC.check(s);assert.equal(r.ok,false);assert.equal(r.anchorage.unresolved,true);
  assert.equal(r.anchorage.anchored,0);assert.match(r.issues.join(' '),/300,000 triangles/);
  const fixed=SC.reseat(s);assert.equal(fixed.unresolved,true);assert.deepEqual(fixed.moved,[]);
  assert.equal(fixed.positions,s.positions);assert.equal(fixed.stillFloating,null);
});
test('disconnected-shell limit prevents quadratic shell-pair scans',()=>{
  const pieces=[];
  for(let i=0;i<129;i++)pieces.push(cube([i*2,0,-3],[i*2+1,1,-2]));
  const r=SC.check(scene(cap,merged(...pieces)));
  assert.equal(r.ok,false);assert.equal(r.anchorage.unresolved,true);assert.equal(r.anchorage.anchored,0);
  assert.match(r.issues.join(' '),/128 disconnected pieces/);
});
test('overall work limit also bounds repeated cap rays below triangle/shell limits',()=>{
  const c=K.build({profile:'DSA',topGrid:181}).positions,pieces=[];
  for(let i=0;i<100;i++){const x=-6+(i%10)*1.2,y=-6+Math.floor(i/10)*1.2;
    pieces.push(cube([x,y,-4],[x+.2,y+.2,-3.8]));}
  const s=scene(c,merged(...pieces));assert.ok(s.triangles<300000);
  const r=SC.check(s);assert.equal(r.ok,false);assert.equal(r.anchorage.unresolved,true);
  assert.match(r.issues.join(' '),/analysis work limit/);assert.equal(r.anchorage.anchored,0);
  const fixed=SC.reseat(s);assert.equal(fixed.unresolved,true);assert.equal(fixed.positions,s.positions);
  assert.equal(fixed.moved.length,0);assert.equal(fixed.stillFloating,null);
});
test('invalid numeric geometry has an actionable failure rather than fake attachment',()=>{
  const s=scene(cap,base);s.positions[s.positions.length-1]=NaN;
  const r=SC.check(s);assert.equal(r.ok,false);assert.equal(r.anchorage.unresolved,true);
  assert.match(r.issues.join(' '),/invalid coordinates/);
});
console.log(`${passed} sculpt contact/budget regression groups passed.`);
