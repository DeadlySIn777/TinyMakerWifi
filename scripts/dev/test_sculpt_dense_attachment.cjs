/* Dense Meshy-scale attachment regression. No network, printer or paid API.
   Optional GLB paths exercise an owner's existing downloads without editing them. */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs');
const K=require('../../web/parts/keycap.js'),S=require('../../web/parts/keycap-sculpt.js');
const R=require('../../web/parts/meshy-glb.js'),H=require('../../web/parts/mesh-health.js').meshHealth;
let passed=0;
function check(name,condition){assert.ok(condition,name);passed++;console.log('PASS '+name);}
function box(x0,x1,y0,y1,z0,z1){
  const c=[[x0,y0,z0],[x1,y0,z0],[x1,y1,z0],[x0,y1,z0],[x0,y0,z1],[x1,y0,z1],[x1,y1,z1],[x0,y1,z1]];
  const q=(a,b,cc,d)=>[[c[a],c[b],c[cc]],[c[a],c[cc],c[d]]];
  return new Float32Array([].concat(q(0,3,2,1),q(4,5,6,7),q(0,1,5,4),q(1,2,6,5),q(2,3,7,6),q(3,0,4,7)).flat(2));
}
function join(...parts){const out=new Float32Array(parts.reduce((n,p)=>n+p.length,0));let off=0;for(const p of parts){out.set(p,off);off+=p.length;}return out;}
function ellipsoid(n,m){
  const rings=[],faces=[];
  for(let j=1;j<m;j++){
    const th=Math.PI*j/m;
    rings.push(Array.from({length:n},(_,i)=>{
      const ph=2*Math.PI*i/n;
      return [4*Math.sin(th)*Math.cos(ph),3*Math.sin(th)*Math.sin(ph),6+6*Math.cos(th)];
    }));
  }
  for(let i=0;i<n;i++){
    const next=(i+1)%n;
    faces.push([[0,0,12],rings[0][i],rings[0][next]],[[0,0,0],rings[m-2][next],rings[m-2][i]]);
    for(let j=0;j<m-2;j++)faces.push([rings[j][i],rings[j+1][i],rings[j+1][next]],[rings[j][i],rings[j+1][next],rings[j][next]]);
  }
  return new Float32Array(faces.flat(2));
}
function cap(grid){const c=K.build({profile:'DSA',row:'R3',sizeU:1,topGrid:grid});c.dishDepth=K.PROFILES.DSA.dishDepth;return c;}
const fine=cap(K.gridForFace(13.7));
check('more than 300k triangles still fails closed',S.anchorage(new Float32Array(300001*9),1).unresolved);
for(const spec of [[128,120],[256,200]]){
  const p=ellipsoid(...spec),before=p.slice(),seated=S.seat(fine,p,{heightMm:19}),result=S.check(seated);
  check(p.length/9+' triangles resolve against the full-resolution cap',result.ok&&!result.anchorage.unresolved);
  check(p.length/9+' triangles preserve raw artwork coordinates',p.every((v,i)=>v===before[i]));
  check(p.length/9+' triangles preserve the exact cap and socket',fine.positions.every((v,i)=>v===seated.positions[i]));
  // A separate floating solid has an overlapping XY footprint but a real air gap.
  const detached=Object.assign({},seated,{positions:join(seated.positions,box(-.5,.5,-.5,.5,-24,-23))});
  const denied=S.check(detached);
  check(p.length/9+' triangles still refuse a disconnected island',!denied.ok&&!denied.anchorage.unresolved&&denied.anchorage.floating.length===1);
}
// At 5-micron rounding the narrow tetrahedron's two close vertices collapse;
// this creates false four-face edges instead of one connected tiny solid.
const tiny=new Float32Array([
  0,0,0, 0,.01,0, .002,0,0,
  0,0,0, .002,0,0, 0,0,.01,
  0,0,0, 0,0,.01, 0,.01,0,
  .002,0,0, 0,.01,0, 0,0,.01
]);
check('distinct two-micron vertices are not collapsed into false fragments',S.shells(tiny).length===1);
// A touching plane is not volume overlap even after BVH construction changes.
const solid=box(-2,2,-2,2,0,2),touch=box(-1,1,-1,1,-2,0);
const touching=S.anchorage(join(solid,touch),solid.length/9);
check('coplanar face contact still fails closed',!touching.unresolved&&touching.anchored===0&&touching.floating.length===1);
const nonfinite=join(fine.positions,box(-1,1,-1,1,-4,1));nonfinite[nonfinite.length-1]=NaN;
check('invalid coordinates remain unresolved',S.anchorage(nonfinite,fine.positions.length/9).unresolved);
for(const file of process.argv.slice(2)){
  const b=fs.readFileSync(file),p=R.parseGLB(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)).positions;
  for(const grid of [31,K.gridForFace(13.7)]){
    const c=cap(grid),seated=S.seat(c,p,{heightMm:12}),result=S.check(seated);
    check(file+' grid '+grid+' attachment resolves without bypassing the budget',!result.anchorage.unresolved);
    console.log(JSON.stringify({file,grid,triangles:p.length/9,attachment:result.anchorage,meshHealth:H(p).severity}));
  }
}
console.log(passed+' dense attachment checks passed');
