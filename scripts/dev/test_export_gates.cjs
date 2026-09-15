// Production builders and UI action bodies, with inert download/slicer sinks.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../..');
const H=require(path.join(root,'web/parts/mesh-health.js'));
const K=require(path.join(root,'web/parts/keycap.js'));
const S=require(path.join(root,'web/parts/keycap-sculpt.js'));
const src=fs.readFileSync(path.join(root,'web/parts/keycap-ui.js'),'utf8');
function cube(lo,hi){const v=[[lo[0],lo[1],lo[2]],[hi[0],lo[1],lo[2]],[hi[0],hi[1],lo[2]],[lo[0],hi[1],lo[2]],
 [lo[0],lo[1],hi[2]],[hi[0],lo[1],hi[2]],[hi[0],hi[1],hi[2]],[lo[0],hi[1],hi[2]]];
 return [[0,2,1],[0,3,2],[4,5,6],[4,6,7],[0,1,5],[0,5,4],[3,7,6],[3,6,2],[0,4,7],[0,7,3],[1,2,6],[1,6,5]].flatMap(t=>t.flatMap(i=>v[i]));}
function region(begin,end){const a=src.indexOf(begin),b=src.indexOf(end,a);assert.ok(a>=0&&b>a);return src.slice(a,b);}
function fixture(sculpt){
 const handlers={},messages=[],downloads=[],handoffs=[];
 const ctx={K,Float32Array,ArrayBuffer,DataView,Blob,Promise,Math,WeakMap,relief:()=>null,
 st:{profile:'DSA',row:'R3',sizeU:1,depth:1,art:sculpt?'sculpt':'none',key:'test',icon:'',sculpt,plate:[]},
 window:{keycapSculpt:S,meshHealth:H.meshHealth,slicerLoadMesh:(p,n,b,o)=>{handoffs.push({p,n,b,o});return true;}},
 document:{querySelector:()=>null},$:id=>({addEventListener:(type,fn)=>{handlers[id]=fn;}}),
 say:(...a)=>messages.push(a),setTimeout:()=>0,slicerMod:{},save:(b,n)=>downloads.push({b,n})};
 vm.createContext(ctx);vm.runInContext(region('  // ---- sculpture settings','  // ---- step 1:')+'\n'+
 region('  function capFor(mode, rel) {','  function refreshNow()')+'\n'+
 region('  function binarySTL(pos) {','  function save(blob, name)')+'\n'+
 region('  function oriented() {',"  $('kcComb').addEventListener"),ctx);
 ctx.built=vm.runInContext("capFor('preview',null)",ctx);
 return {ctx,handlers,messages,downloads,handoffs};
}
async function flush(){await Promise.resolve();await Promise.resolve();await Promise.resolve();}
(async()=>{
 const bad=fixture(new Float32Array([...cube([-5,-5,0],[5,5,1]),...cube([-.5,-.5,10],[.5,.5,11])]));
 assert.equal(vm.runInContext("capFor('print',null).sculptCheck.ok",bad.ctx),false);
 assert.throws(()=>vm.runInContext('printMesh()',bad.ctx),/floating/);
 bad.handlers.kcAdd();bad.handlers.kcStl();bad.handlers.kcSlice();await flush();
 assert.equal(bad.ctx.st.plate.length,0);assert.equal(bad.downloads.length,0);assert.equal(bad.handoffs.length,0);
 assert.ok(bad.messages.some(m=>String(m[1]).includes('floating')));
 const good=fixture(null);good.handlers.kcAdd();assert.equal(good.ctx.st.plate.length,1);
 good.handlers.kcStl();good.handlers.kcSlice();await flush();
 assert.equal(good.downloads.length,1);assert.ok(good.downloads[0].b.size>84);assert.equal(good.handoffs.length,1);
 assert.equal(good.handoffs[0].o.noScale,true);
 good.ctx.st.plate[0].positions[0]+=1;good.handlers.kcStl();good.handlers.kcSlice();await flush();
 assert.equal(good.downloads.length,1);assert.equal(good.handoffs.length,1);
 good.handlers.kcClearPlate();assert.equal(good.ctx.st.plate.length,0);
 good.ctx.st.plate.push({positions:new Float32Array(cube([0,0,0],[1,1,1])),size:{x:1,y:1,z:1},name:'bypass',printPlan:{ok:true}});
 good.handlers.kcStl();good.handlers.kcSlice();await flush();assert.equal(good.downloads.length,1);assert.equal(good.handoffs.length,1);
 const oversize=fixture(null);oversize.ctx.K={...K,layout(caps){const lay=K.layout(caps);lay.positions=lay.positions.slice();for(let i=2;i<lay.positions.length;i+=3)lay.positions[i]*=100;return lay;}};
 oversize.handlers.kcStl();assert.equal(oversize.downloads.length,0);assert.ok(oversize.messages.some(m=>String(m[1]).includes('print volume')));
 const failRelief=fixture(null);failRelief.ctx.relief=()=>{throw Error('invalid letter');};
 failRelief.handlers.kcStl();assert.equal(failRelief.downloads.length,0);
 assert.ok(failRelief.messages.some(m=>String(m[1]).includes('invalid letter')));
 console.log('Export gates: invalid attachment, changed/bypassed staged entries, relief failure, valid STL/slicer and clear plate PASS');
})().catch(e=>{console.error(e);process.exitCode=1;});
