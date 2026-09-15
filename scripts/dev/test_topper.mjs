/* Exact mechanical topper checks; no browser or printer access. */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);
const T = require('../../web/parts/topper.js');
require('../../web/parts/mesh-health.js');
let passed = 0;
function test(name, fn) { fn(); passed++; console.log('PASS '+name); }
function near(a,b,e=1e-5) { assert.ok(Math.abs(a-b)<e, `${a} != ${b} (+/- ${e})`); }
function volume(p) {
  let v=0;
  for(let i=0;i<p.length;i+=9) {
    const [ax,ay,az,bx,by,bz,cx,cy,cz]=p.slice(i,i+9);
    v+=(ax*(by*cz-bz*cy)-ay*(bx*cz-bz*cx)+az*(bx*cy-by*cx))/6;
  }
  return v;
}
function closed(b) {
  const h=globalThis.meshHealth(b.positions);
  assert.equal(h.watertight,true); assert.equal(h.boundaryEdges,0);
  assert.equal(h.nonManifoldEdges,0); assert.equal(h.flippedEdges,0); assert.equal(h.degenerate,0);
  assert.ok(volume(b.positions)>0); assert.ok([...b.positions].every(Number.isFinite));
}
// Independent ray/triangle intersections inspect the actual soup, not metadata.
function ray(p,o,d) {
  const sub=(a,b)=>a.map((v,i)=>v-b[i]);
  const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
  const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0), hits=[];
  for(let i=0;i<p.length;i+=9) {
    const a=[...p.slice(i,i+3)],b=[...p.slice(i+3,i+6)],c=[...p.slice(i+6,i+9)];
    const e1=sub(b,a),e2=sub(c,a),h=cross(d,e2),det=dot(e1,h);
    if(Math.abs(det)<1e-10)continue;
    const s=sub(o,a),u=dot(s,h)/det,q=cross(s,e1),v=dot(d,q)/det,t=dot(e2,q)/det;
    if(u>=-1e-7&&v>=-1e-7&&u+v<=1+1e-7&&t>1e-7)hits.push({t,normal:dot(cross(e1,e2),d)});
  }
  hits.sort((a,b)=>a.t-b.t);
  return hits.filter((h,i)=>!i||Math.abs(h.t-hits[i-1].t)>1e-5);
}
test('defaults form a closed Z-up 7 mm starting-point topper with a 2 mm roof',()=>{
  const b=T.build(); closed(b); assert.equal(b.ok,true); near(b.socket.nominalMm,7);
  near(b.socket.openingMm,7.2); near(b.size.z,14); near(b.bounds.lo[2],0); near(b.roofMm,2);
  assert.ok(b.notes.some(n=>/calipers/.test(n))); assert.equal(b.triangles,1536);
});
test('round, hex and oval socket variants remain manifold across bounded resolutions',()=>{
  for(const socketShape of ['round','hex','oval']) for(const segments of [24,96,384]) for(const edgeRadiusMm of [0,0.4]) {
    closed(T.build({socketShape,segments,secondAxisMm:5,edgeRadiusMm}));
  }
});
test('actual round bore is the requested diameter and outer wall is unchanged',()=>{
  const opts={diameterMm:7.3,clearanceMm:0.2,socketDepthMm:13}; const b=T.build(opts);
  for(const d of [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0]]) {
    const hits=ray(b.positions,[0,0,6],d); assert.equal(hits.length,2);
    near(hits[0].t*2,7.5); near(hits[1].t*2,b.outerDiameterMm);
  }
});
test('hex dimensions are across flats, with the proper corner span',()=>{
  const b=T.build({preset:'pencil-hex',acrossFlatsMm:7.4,diameterMm:9,clearanceMm:0.3});
  near(ray(b.positions,[0,0,4],[0,1,0])[0].t*2,7.7);
  near(ray(b.positions,[0,0,4],[1,0,0])[0].t*2,7.7*2/Math.sqrt(3));
  near(b.socket.nominalMm,7.4); closed(b);
});
test('oval socket independently follows both measured axes',()=>{
  const b=T.build({preset:'samsung-stylus',modelLabel:'Measured example',socketShape:'oval',diameterMm:6,secondAxisMm:4,clearanceMm:0.2});
  near(ray(b.positions,[0,0,4],[1,0,0])[0].t*2,6.2);
  near(ray(b.positions,[0,0,4],[0,1,0])[0].t*2,4.2); closed(b);
});
test('socket is open underneath, closed at its floor, with an intact roof',()=>{
  for(const socketShape of ['round','hex','oval']) {
    const b=T.build({socketShape,secondAxisMm:5});
    for(const x of [0,0.1,1]) {
      const hits=ray(b.positions,[x,0.17,-1],[0,0,1]); assert.equal(hits.length,2);
      near(hits[0].t-1,12); near(hits[1].t-1,14);
      assert.ok(hits[0].normal<0); assert.ok(hits[1].normal>0);
    }
  }
});
test('signed volume equals solid outer cylinder minus real socket prism',()=>{
  const n=96,poly=n/2*Math.sin(2*Math.PI/n);
  for(const socketShape of ['round','hex','oval']) {
    const b=T.build({socketShape,secondAxisMm:5,edgeRadiusMm:0});
    const outer=poly*(b.outerDiameterMm/2)**2*14;
    const inner=socketShape==='hex'?Math.sqrt(3)/2*7.2**2:poly*3.6*(socketShape==='oval'?2.6:3.6);
    near(volume(b.positions),outer-inner*12,0.002);
  }
});
test('looser fit only widens the bore and reduces material, without scaling the body',()=>{
  for(const socketShape of ['round','hex','oval']) {
    const a=T.build({socketShape,secondAxisMm:5,clearanceMm:0.1}), b=T.build({socketShape,secondAxisMm:5,clearanceMm:0.3});
    assert.deepEqual(a.size,b.size); assert.equal(a.outerDiameterMm,b.outerDiameterMm);
    assert.ok(volume(a.positions)>volume(b.positions));
    near(ray(b.positions,[0,0,5],[0,1,0])[0].t*2-ray(a.positions,[0,0,5],[0,1,0])[0].t*2,0.2);
  }
});
test('explicit outer diameter remains fixed and minimum actual wall is guarded',()=>{
  const a=T.build({diameterMm:7,outerDiameterMm:10,clearanceMm:0}),b=T.build({diameterMm:7,outerDiameterMm:10,clearanceMm:0.8});
  assert.deepEqual(a.size,b.size); near(b.socket.minimumWallMm,1.1);
  assert.throws(()=>T.build({diameterMm:7,outerDiameterMm:9,clearanceMm:0.2}),/less than 1 mm/);
  assert.throws(()=>T.build({socketShape:'hex',acrossFlatsMm:7,outerDiameterMm:10,clearanceMm:0.2}),/less than 1 mm/);
});
test('unknown marker and stylus dimensions are never invented',()=>{
  for(const preset of ['marker','custom','apple-stylus','samsung-stylus']) {
    assert.throws(()=>T.build({preset,modelLabel:'Example model'}),/Measured/);
    assert.equal(T.PRESETS[preset].nominalMm,undefined);
  }
  for(const preset of ['apple-stylus','samsung-stylus']) {
    assert.throws(()=>T.build({preset,diameterMm:7}),/model/);
    const b=T.build({preset,modelLabel:'  My measured stylus  ',diameterMm:7});
    assert.equal(b.modelLabel,'My measured stylus');
  }
  assert.throws(()=>T.build({socketShape:'oval',diameterMm:7}),/second oval axis/);
});
test('malformed and mechanically impossible input is rejected',()=>{
  for(const v of [NaN,Infinity,-Infinity,null,'7',0,-1,41]) assert.throws(()=>T.build({diameterMm:v}));
  for(const k of ['clearanceMm','socketDepthMm','wallMm','roofMm','outerDiameterMm','edgeRadiusMm']) {
    assert.throws(()=>T.build({[k]:NaN})); assert.throws(()=>T.build({[k]:Infinity})); assert.throws(()=>T.build({[k]:-1}));
  }
  for(const segments of [12,25,390,10000000,NaN]) assert.throws(()=>T.build({segments}));
  assert.throws(()=>T.build({socketShape:'square'})); assert.throws(()=>T.build({preset:'made-up'}));
  assert.throws(()=>T.build({roofMm:1.99})); assert.throws(()=>T.build({edgeRadiusMm:2}));
  assert.throws(()=>T.build(null)); assert.throws(()=>T.build([]));
});
test('bed limits report actionable issues without altering a measured socket',()=>{
  const b=T.build({preset:'custom',diameterMm:32,socketDepthMm:50,roofMm:8});
  assert.equal(b.ok,false); assert.ok(b.issues.some(s=>/build volume/.test(s)));
  near(b.socket.nominalMm,32); near(ray(b.positions,[0,0,4],[1,0,0])[0].t*2,32.2);
  near(b.size.z,58); near(b.availableArtHeightMm,0); closed(b);
  assert.equal(T.build({diameterMm:20,socketDepthMm:50,roofMm:8}).ok,true);
});
console.log(`\n${passed} topper geometry groups passed.`);
