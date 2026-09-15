/* Offline geometric regressions. Uses a deterministic A coverage image so CI
   checks the actual emitted surface without depending on installed fonts. */
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
require('../../web/parts/mesh-health.js');
const K = require('../../web/parts/keycap.js');
let captured = null;
global.document = { createElement() {
  const canvas = { width: 0, height: 0 };
  canvas.getContext = () => ({
    clearRect() {}, measureText() { return { width: 210, actualBoundingBoxLeft: 8,
      actualBoundingBoxRight: 182, actualBoundingBoxAscent: 220, actualBoundingBoxDescent: 0 }; },
    fillText(text,x,y) { captured = { text,x,y }; },
    getImageData() {
      const n=canvas.width, data=new Uint8ClampedArray(n*n*4);
      for (let y=0;y<n;y++) for (let x=0;x<n;x++) {
        const u=2*x/(n-1)-1,v=1-2*y/(n-1);
        const leg=Math.abs(Math.abs(u)-(.65-v)*.38)<.075 && v>-.72 && v<.70;
        const bar=Math.abs(v+.08)<.08 && Math.abs(u)<.30;
        data[(y*n+x)*4+3]=leg||bar?255:0;
      }
      return {data};
    }
  });
  return canvas;
} };
const I = require('../../web/parts/keycap-icons.js');
let checks=0;
function check(name, test) { assert.ok(test,name); checks++; console.log('OK '+name); }
function gapAt(cap, x, y) {
  const p=cap.positions,n=cap.topGrid;
  const vertex=(i,j) => {
    if (i===n-1 && j===n-1) return Array.from(p.slice(((i-1)*(n-1)+j-1)*18+6,((i-1)*(n-1)+j-1)*18+9));
    if (i===n-1) return Array.from(p.slice(((i-1)*(n-1)+j)*18+15,((i-1)*(n-1)+j)*18+18));
    if (j===n-1) return Array.from(p.slice((i*(n-1)+j-1)*18+3,(i*(n-1)+j-1)*18+6));
    return Array.from(p.slice((i*(n-1)+j)*18,(i*(n-1)+j)*18+3));
  };
  let i=0,j=0;
  while(i<n-2 && vertex(i+1,0)[0]<x) i++;
  while(j<n-2 && vertex(0,j+1)[1]<y) j++;
  const a=vertex(i,j),b=vertex(i,j+1),c=vertex(i+1,j+1),d=vertex(i+1,j);
  const dx=(x-a[0])/(d[0]-a[0]),dy=(y-a[1])/(b[1]-a[1]);
  return dy>=dx ? a[2]*(1-dy)+b[2]*(dy-dx)+c[2]*dx : a[2]*(1-dx)+c[2]*dy+d[2]*(dx-dy);
}
const g=I.placedGlyphRelief('A',{depth:.55,samples:512});
check('canvas uses the actual ink bounds, including zero descender',captured.x===169 && captured.y===366);
const b=g.detailRegions(13.7,13.7)[0];
const old=(u,v,w,h)=>g(u,v,w,h);
Object.assign(old,{depth:g.depth,raised:false});
const coarse=K.build({profile:'XDA',dishDepth:0,topGrid:31,relief:old});
const preview=K.build({profile:'XDA',dishDepth:0,topGrid:31,relief:g,legendPixelMm:K.PIXEL_MM});
const print=K.build({profile:'XDA',dishDepth:0,topGrid:K.gridForFace(13.7),relief:g});
function error(cap) {
  let total=0;
  for(let i=0;i<80;i++) for(let j=0;j<80;j++) {
    const x=b.x[0]+(i+.371)/80*(b.x[1]-b.x[0]), y=b.y[0]+(j+.291)/80*(b.y[1]-b.y[0]);
    total+=Math.abs(g(x/6.85,y/6.85,13.7,13.7)-gapAt(cap,x,y));
  }
  return total/6400;
}
const errors={coarse:error(coarse),preview:error(preview),print:error(print)};
console.log('Actual triangle surface mean absolute depth error (mm):',JSON.stringify(errors));
check('preview loses less than half as much letter detail as the old mesh',errors.preview<errors.coarse*.5);
check('export loses less than a quarter as much letter detail as the old preview',errors.print<errors.coarse*.25);
check('preview stays below 10,000 triangles',preview.triangles<10000);
for(const [name,c] of [['preview',preview],['export',print]]) {
  const h=global.meshHealth(c.positions);
  check(name+' is closed, consistently wound, without collapsed triangles',h.watertight&&!h.flippedEdges&&!h.degenerate);
  check(name+' keeps the 1.23 mm stem slot',c.slotWidth===1.23);
}
for(const sizeU of [1.5,2.25,2.75]) {
  const w=K.capWidth(sizeU)-4.3,region=g.detailRegions(w,13.7)[0];
  check(sizeU+'u lettering retains its physical width',Math.abs(region.x[1]-region.x[0]-4.11)<1e-9);
  check(sizeU+'u lettering stays anchored to the upper-left edge',Math.abs(region.x[0]+w/2-.548)<1e-9);
  const c=K.build({profile:'XDA',sizeU,topGrid:31,relief:g,legendPixelMm:K.PIXEL_MM});
  check(sizeU+'u refined mesh stays closed',global.meshHealth(c.positions).watertight);
}
for (const bad of [new Float32Array(9),new Float32Array(9).fill(NaN),new Float32Array(9).fill(Infinity)])
  check('invalid mesh is refused by keycap validation',!K.validate(bad).ok);
const nanCap=new Float32Array(coarse.positions.length+9);nanCap.set(coarse.positions);nanCap.fill(NaN,coarse.positions.length);
check('a valid cap cannot hide one non-finite triangle',!K.validate(nanCap).ok);
let measuredDimensions=false;
const dimensioned=(u,v,w,h)=>{measuredDimensions=w===26&&h===13;return Math.abs(u)<.2&&Math.abs(v)<.2?.55:0;};
Object.assign(dimensioned,{depth:.55,parts:[]});
I.checkLegendField(dimensioned,26,13);
check('printability sampling uses the actual wide-key dimensions',measuredDimensions);
const empty=()=>0;Object.assign(empty,{depth:.55,parts:[]});
check('an empty or vanished glyph is reported instead of called printable',!I.checkLegendField(empty,13,13).ok);
console.log(checks+' engraving checks passed');
