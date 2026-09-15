// Real cap geometry plus actual UI preference/export handlers. No printer I/O.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const base=path.resolve(__dirname,'../..');
const K=require(path.join(base,'web/parts/keycap.js'));
const H=require(path.join(base,'web/parts/mesh-health.js'));
const src=fs.readFileSync(path.join(base,'web/parts/keycap-ui.js'),'utf8');
const html=fs.readFileSync(path.join(base,'web/parts/keycap-card.html'),'utf8');
function region(a,b){const x=src.indexOf(a),y=src.indexOf(b,x);assert.ok(x>=0&&y>x,a);return src.slice(x,y);}
const KEY='tmKeycapStemFitV1';
function fixture(storage=new Map(),blocked=false){
  const nodes=new Map(),downloads=[],handoffs=[],messages=[],helps=[];let refreshes=0;
  function node(id){if(!nodes.has(id))nodes.set(id,{value:'',textContent:'',disabled:false,style:{},events:{},
    attrs:{},setAttribute(k,v){this.attrs[k]=v;},addEventListener(k,fn){this.events[k]=fn;}});return nodes.get(id);}
  const ctx={K,Float32Array,ArrayBuffer,DataView,Blob,Promise,Math,WeakMap,
    st:{profile:'DSA',row:'R3',sizeU:1,depth:.55,art:'none',key:'test',icon:'',sculpt:null,plate:[]},
    window:{designerFeedback:{help:(...args)=>helps.push(args),notice:()=>{}},meshHealth:H.meshHealth,slicerLoadMesh:(p,n,b,o)=>{handoffs.push({p,n,b,o});return true;}},
    document:{querySelector:()=>null},$:node,relief:()=>null,say:(...args)=>messages.push(args),
    setTimeout:()=>0,slicerMod:{},save:(blob,name)=>downloads.push({blob,name}),refresh:()=>refreshes++,
    localStorage:{getItem:key=>{if(blocked)throw Error('storage blocked');return storage.get(key)||null;},
      setItem:(key,val)=>{if(blocked)throw Error('storage blocked');storage.set(key,val);}},
    setArt:v=>{ctx.st.art=v;},setFinish:()=>{},dropSculpt:()=>{ctx.st.sculpt=null;},
    drawProfiles:()=>{},drawRows:()=>{},drawIcons:()=>{},caliper:()=>{},paintLegendRow:()=>{}};
  vm.createContext(ctx);
  vm.runInContext(region('  // ---- sculpture settings','  // ---- step 1:')+'\n'+
    region('  var OWN =','  var restoredStep =')+'\n'+
    region('  function capFor(mode, rel) {','  function refreshNow()')+'\n'+
    region('  function binarySTL(pos) {','  function save(blob, name)')+'\n'+
    region('  function actionMessage(', '  function binarySTL(pos) {')+'\n'+
    region('  function oriented() {',"  $('kcModes')")+'\n'+
    region("  $('kcNext').addEventListener", "  $('kcBack').addEventListener")+'\n'+
    region('  function designOf() {','  // ---- share, and open')+'\nbindStemFit();',ctx);
  ctx.built=vm.runInContext("capFor('preview',null)",ctx);
  function fire(id,type='click'){assert.ok(node(id).events[type],id+' '+type);return node(id).events[type].call(node(id));}
  return {ctx,node,fire,storage,messages,helps,downloads,handoffs,eval:code=>vm.runInContext(code,ctx),refreshes:()=>refreshes};
}
function bounds(p){const lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];
  for(let i=0;i<p.length;i++) {const k=i%3;lo[k]=Math.min(lo[k],p[i]);hi[k]=Math.max(hi[k],p[i]);}
  return {lo,hi,size:lo.map((n,k)=>hi[k]-n),center:lo.map((n,k)=>(n+hi[k])/2)};}
function socketWidth(p,z){
  // Cast through the actual vertical socket walls at x=centre+1 mm. At that
  // position the horizontal arm's inner walls are the nearest y hits.
  const b=bounds(p),x=b.center[0]+1,ys=[];
  for(let i=0;i<p.length;i+=9){const ax=p[i],az=p[i+2],bx=p[i+3],bz=p[i+5],cx=p[i+6],cz=p[i+8];
    const d=(bz-cz)*(ax-cx)+(cx-bx)*(az-cz);if(Math.abs(d)<1e-12)continue;
    const u=((bz-cz)*(x-cx)+(cx-bx)*(z-cz))/d,v=((cz-az)*(x-cx)+(ax-cx)*(z-cz))/d,w=1-u-v;
    if(u<-.000001||v<-.000001||w<-.000001)continue;
    ys.push(u*p[i+1]+v*p[i+4]+w*p[i+7]-b.center[1]);
  }
  const positive=ys.filter(y=>y>1e-5),negative=ys.filter(y=>y< -1e-5);
  assert.ok(positive.length&&negative.length,'ray must hit actual inner walls');
  return Math.min(...positive)-Math.max(...negative);
}
async function readBinary(blob){const v=new DataView(await blob.arrayBuffer()),n=v.getUint32(80,true),p=new Float32Array(n*9);
  for(let i=0;i<n;i++)for(let j=0;j<9;j++)p[i*9+j]=v.getFloat32(84+i*50+12+j*4,true);return p;}
function close(a,b){assert.ok(Math.abs(a-b)<.00002,`${a} != ${b}`);}
let passed=0;
async function test(name,fn){await fn();passed++;console.log('OK '+name);}
(async()=>{
  await test('fit is visible in Step 4 and states feedback/persistence accurately',()=>{
    assert.match(html,/data-for='4'[\s\S]*id='kcStemFit'/);
    assert.match(html,/min='1.15' max='1.45' step='0.01'/);
    assert.match(html,/Tighter · smaller socket/);assert.match(html,/Looser · larger socket/);
    assert.match(html,/does not measure the fit automatically/);
  });
  await test('default remains 0.08 clearance / 1.23 mm socket, with no automatic writes',()=>{
    const f=fixture();assert.equal(f.eval('stemFitClearance'),.08);assert.equal(f.node('kcStemFit').value,'1.23');
    assert.equal(f.storage.size,0);
    for(const mode of ['preview','print']){const c=f.eval(`capFor('${mode}',null)`);close(c.slotWidth,1.23);close(socketWidth(c.positions,(c.floorZ+c.postTopZ)/2),1.23);}
  });
  await test('both fit endpoints keep generated profiles watertight and full size',()=>{
    for(const [profile,row] of [['DSA','R3'],['XDA','R3'],['SA','R1'],['CHERRY','R4'],['OEM','R3']]){
      const nominal=K.build({profile,row});
      for(const clearance of [0,.30]){
        const c=K.build({profile,row,mx:{slotClearance:clearance}}),h=H.meshHealth(c.positions);
        assert.equal(h.watertight,true);assert.equal(h.flippedEdges,0);
        close(c.slotWidth,1.15+clearance);close(c.size.x,nominal.size.x);close(c.size.y,nominal.size.y);
        assert.equal(K.validate(c.positions,{mx:{slotClearance:clearance}}).ok,true);
      }
    }
  });
  await test('Too tight widens actual socket by .02 without scaling cap exterior',()=>{
    const f=fixture(),before=f.eval("capFor('print',null)");f.fire('kcFitTight');
    const after=f.eval("capFor('print',null)");close(after.slotWidth-before.slotWidth,.02);
    close(socketWidth(after.positions,(after.floorZ+after.postTopZ)/2),1.25);
    assert.deepEqual(bounds(before.positions).size,bounds(after.positions).size);
    assert.equal(f.eval('stemFitClearance'),.10);assert.equal(f.refreshes(),1);
  });
  await test('Too loose narrows actual socket and limits stay bounded',()=>{
    const f=fixture();f.fire('kcFitLoose');close(f.eval("capFor('print',null).slotWidth"),1.21);
    f.node('kcStemFit').value='99';f.fire('kcStemFit','input');assert.equal(f.eval('stemFitClearance'),.30);
    assert.equal(f.node('kcFitTight').disabled,true);assert.equal(f.node('kcStemFit').value,'1.45');
    f.node('kcStemFit').value='0';f.fire('kcStemFit','input');assert.equal(f.eval('stemFitClearance'),0);
    assert.equal(f.node('kcFitLoose').disabled,true);assert.equal(f.node('kcStemFit').value,'1.15');
    f.node('kcStemFit').value='garbage';f.fire('kcStemFit','input');assert.equal(f.eval('stemFitClearance'),0);
  });
  await test('preference persists across a fresh UI session',()=>{
    const store=new Map(),a=fixture(store);a.fire('kcFitTight');
    assert.deepEqual(JSON.parse(store.get(KEY)),{version:1,slotClearance:.10});
    const b=fixture(store);assert.equal(b.eval('stemFitClearance'),.10);assert.equal(b.node('kcStemFit').value,'1.25');
  });
  await test('restored out-of-range values clamp; malformed preferences keep default',()=>{
    for(const [saved,want] of [[{version:1,slotClearance:20},.30],[{version:1,slotClearance:-20},0],
      [{version:1,slotClearance:'0.2'},.08],[{version:5,slotClearance:.2},.08],[null,.08]]){
      const f=fixture(new Map([[KEY,JSON.stringify(saved)]]));assert.equal(f.eval('stemFitClearance'),want);
    }
    assert.equal(fixture(new Map([[KEY,'{broken']])).eval('stemFitClearance'),.08);
  });
  await test('blocked storage remains usable and never claims it saved',()=>{
    const f=fixture(new Map(),true);f.fire('kcFitTight');assert.equal(f.eval('stemFitClearance'),.10);
    assert.ok(f.messages.some(m=>String(m[1]).includes('will not survive a reload')));
  });
  await test('importing a design cannot replace local fit, and sharing does not export it',()=>{
    const f=fixture();f.fire('kcFitTight');
    f.eval("applyDesign({profile:'XDA',row:'R3',sizeU:1,key:'A',slotClearance:.3,mx:{slotClearance:.3}})");
    assert.equal(f.eval('stemFitClearance'),.10);assert.equal(f.ctx.st.profile,'XDA');
    const design=f.eval('designOf()');assert.equal(design.slotClearance,undefined);assert.equal(design.mx,undefined);
    close(f.eval("capFor('print',null).slotWidth"),1.25);
  });
  await test('changing fit clears plate and invalidates every old checked entry',()=>{
    const f=fixture();f.fire('kcAdd');assert.equal(f.ctx.st.plate.length,1);f.ctx.oldCaps=f.ctx.st.plate.slice();
    f.fire('kcFitTight');assert.equal(f.ctx.st.plate.length,0);
    assert.throws(()=>f.eval('checkedLayout(oldCaps)'),/no longer verified/);
    assert.ok(f.messages.some(m=>m[0]==='kcPlate'&&String(m[1]).includes('Plate cleared')));
    f.fire('kcAdd');assert.equal(f.ctx.st.plate.length,1);assert.doesNotThrow(()=>f.eval('checkedLayout(st.plate)'));
  });
  await test('an in-flight slicer load cannot deliver a mesh checked under the old fit',async()=>{
    const f=fixture();f.ctx.slicerMod=null;let resolve;
    const loading=new Promise(r=>{resolve=r;});f.ctx.slicerLoadMod=()=>loading;
    f.fire('kcSlice');f.fire('kcFitTight');f.ctx.slicerMod={};resolve();
    await Promise.resolve();await Promise.resolve();await Promise.resolve();await Promise.resolve();
    assert.equal(f.handoffs.length,0);assert.ok(f.messages.some(m=>String(m[1]).includes('no longer verified')));
  });
  await test('the footer Send action reports invalid staged geometry even when the secondary button is disabled',async()=>{
    const f=fixture();f.ctx.st.step=4;f.fire('kcAdd');f.ctx.st.plate[0].positions[0]=NaN;
    f.node('kcSlice').disabled=true;f.fire('kcNext');await Promise.resolve();
    assert.equal(f.handoffs.length,0);assert.equal(f.downloads.length,0);
    assert.ok(f.messages.some(m=>m[0]==='kcActionNote'&&/changed after validation/.test(m[1])));
    assert.ok(f.helps.some(m=>m[0]==='Action needs attention'&&/changed after validation/.test(m[1])));
  });
  await test('missing slicer engine produces visible action help without sending geometry',async()=>{
    const f=fixture();f.ctx.st.step=4;f.ctx.slicerMod=null;f.ctx.slicerLoadMod=()=>Promise.reject(Error('inert offline'));
    f.fire('kcNext');await new Promise(setImmediate);
    assert.equal(f.handoffs.length,0);assert.ok(f.helps.some(m=>/Could not load the slicer engine/.test(m[1])));
    assert.ok(f.messages.some(m=>m[0]==='kcActionNote'&&/SD card/.test(m[1])));
  });
  await test('duplicate sends during engine loading deliver one checked exact-size mesh',async()=>{
    const f=fixture();f.ctx.st.step=4;f.ctx.slicerMod=null;let finish;
    f.ctx.slicerLoadMod=()=>new Promise(resolve=>{finish=resolve;});
    f.fire('kcNext');f.fire('kcNext');f.fire('kcSlice');
    assert.equal(typeof finish,'function');f.ctx.slicerMod={};finish();await new Promise(setImmediate);
    assert.equal(f.handoffs.length,1);assert.equal(f.handoffs[0].o.noScale,true);
    assert.equal(f.handoffs[0].o.keepPose,true);
  });
  await test('best coupon requires a valid choice and applies remembered fit',()=>{
    const f=fixture();f.fire('kcApplyCoupon');assert.equal(f.eval('stemFitClearance'),.08);
    f.node('kcFitCoupon').value='1.30';f.fire('kcFitCoupon','change');assert.equal(f.node('kcApplyCoupon').disabled,false);
    f.fire('kcApplyCoupon');assert.equal(f.eval('stemFitClearance'),.15);assert.equal(f.node('kcStemFit').value,'1.30');
    assert.equal(fixture(f.storage).eval('stemFitClearance'),.15);
    f.node('kcFitCoupon').value='99';f.fire('kcApplyCoupon');assert.equal(f.eval('stemFitClearance'),.15);
  });
  await test('coupon chooser matches actual generated test widths and instructions need no code',()=>{
    const f=fixture(),comb=K.stemTestComb(1.15,1.35,.05);
    assert.deepEqual(comb.stems.map(s=>s.slotMm),[1.15,1.20,1.25,1.30,1.35]);
    f.fire('kcComb');assert.equal(f.downloads.length,1);
    assert.ok(f.messages.some(m=>String(m[1]).includes('press Apply coupon')));
    assert.ok(!f.messages.some(m=>String(m[1]).includes('slotClearance')));
    const dashboard=fs.readFileSync(path.join(base,'web/dashboard.html'),'utf8');
    const guide=dashboard.match(/\{k:'kccomb',[\s\S]*?\}\];/)[0];
    assert.match(guide,/exports five coupons/);assert.match(guide,/Apply coupon/);
    assert.doesNotMatch(guide,/six coupons|2\.8 ml|36 &times; 24|slot is your number/);
  });
  await test('exported STL and slicer mesh contain the selected 1.30 mm socket',async()=>{
    const f=fixture();f.node('kcFitCoupon').value='1.30';f.fire('kcApplyCoupon');
    const c=f.eval("capFor('print',null)"),z=(c.floorZ+c.postTopZ)/2;
    f.fire('kcStl');assert.equal(f.downloads.length,1);
    const p=await readBinary(f.downloads[0].blob);close(socketWidth(p,z),1.30);
    f.fire('kcSlice');await Promise.resolve();await Promise.resolve();
    assert.equal(f.handoffs.length,1);close(socketWidth(f.handoffs[0].p,z),1.30);assert.equal(f.handoffs[0].o.noScale,true);
  });
  console.log(`${passed} stem-fit preference/geometry/export regression groups passed.`);
})().catch(e=>{console.error(e);process.exitCode=1;});
