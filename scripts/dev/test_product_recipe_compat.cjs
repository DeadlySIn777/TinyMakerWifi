/* A display-default migration must not invalidate or rewrite a saved product. */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const src=fs.readFileSync(path.join(__dirname,'../../web/parts/keycap-ui.js'),'utf8');
const share=require('../../web/parts/keycap-share.js');
function section(start,end){const a=src.indexOf(start),b=src.indexOf(end,a);assert.ok(a>=0&&b>a);return src.slice(a,b);}
function fixture(){const nodes=new Map(),mesh=new Float32Array([0,0,0,1,0,0,0,1,1]);
  const el=id=>{if(!nodes.has(id))nodes.set(id,{textContent:'',disabled:false,hidden:false,value:''});return nodes.get(id);};
  const ctx={WeakMap,Math,Number,Float32Array,stemFitClearance:.10,K:{MX:{crossWide:1.15}},artisanStyleDraft:null,
    window:{keycapShare:share},document:{activeElement:null},$:el,say:(id,text)=>el(id).textContent=text,
    knownSculptHeight:v=>Number.isFinite(v),
    st:{profile:'DSA',row:'R3',sizeU:1,depth:.55,raised:false,sculptHeightMm:19,meshyPolycount:100000,meshyUltra:false,
      sculptStyle:'cuteartisan',sculptRotationDeg:0,sculptScalePercent:100,colorMode:'solid',baseColor:'#f3bdd6',artColor:'#a9dbcc',
      useSourceColors:true,skinFrom:'A chubby puppy',legendOn:false,key:'Esc',name:'Puppy',sculpt:mesh}};
  vm.createContext(ctx);vm.runInContext(section('  var sculptSaves =','  function sameSculptSnapshot(')+section('  function paintProductState()','  function captureProduct(')+section('  function designOf() {','  function applyDesign(d)'),ctx);
  const current=ctx.designOf(),old={...current};for(const k of ['colorMode','baseColor','artColor','useSourceColors'])delete old[k];
  const product={state:'ready',recipe:share.encode(old),fit:{slotMm:1.25},positions:new Float32Array(mesh),signature:'original-physical-signature',issues:[]};
  function open(p=product){ctx.rememberLoadedProduct({product:p});ctx.paintProductState();}
  return {ctx,el,product,current,old,open};}
let passed=0;function test(name,fn){fn();passed++;console.log('OK '+name);}
test('unchanged 0.18.7 product opens ready with download enabled',()=>{const f=fixture();f.open();assert.match(f.el('kcProductStatus').textContent,/Ready to slice/);assert.equal(f.el('kcDownloadProduct').disabled,false);assert.equal(f.el('kcSaveProduct').disabled,true);});
test('comparison leaves saved recipe, physical vertices, fit and signature untouched',()=>{const f=fixture(),before=structuredClone(f.product);Object.freeze(f.product.fit);Object.freeze(f.product);f.open();assert.deepEqual(f.product,before);});
for(const [field,value] of [['depth',.75],['sculptRotationDeg',90],['sculptScalePercent',70],['name','New puppy'],['baseColor','#ff0000'],['colorMode','color'],['useSourceColors',false]])
  test(field+' edits still require a new save',()=>{const f=fixture();f.open();f.ctx.st[field]=value;f.ctx.paintProductState();assert.equal(f.el('kcDownloadProduct').disabled,true);assert.equal(f.el('kcSaveProduct').disabled,false);assert.match(f.el('kcProductStatus').textContent,/Unsaved changes/);});
test('fit changes remain distinct even when the recipe is otherwise equal',()=>{const f=fixture();f.open();f.ctx.stemFitClearance=.14;f.ctx.paintProductState();assert.equal(f.el('kcDownloadProduct').disabled,true);assert.equal(f.el('kcSaveProduct').disabled,false);});
test('current recipes preserve explicit color choices rather than replacing them with defaults',()=>{const f=fixture();f.ctx.st.baseColor='#abcdef';const d=f.ctx.designOf();f.open({...f.product,recipe:share.encode(d)});assert.equal(f.el('kcDownloadProduct').disabled,false);f.ctx.st.baseColor='#f3bdd6';f.ctx.paintProductState();assert.equal(f.el('kcDownloadProduct').disabled,true);});
test('malformed and unrecognized future recipe fields do not become valid defaults',()=>{const f=fixture();for(const code of ['TMK1-broken','TMK1-'+Buffer.from(JSON.stringify({p:'DSA',cm:'rainbow'})).toString('base64url')]){
  assert.equal(f.ctx.productRecipeKey(code),code);f.open({...f.product,recipe:code});assert.equal(f.el('kcDownloadProduct').disabled,true);}
  const oldJSON=JSON.parse(Buffer.from(f.product.recipe.slice(5),'base64url').toString());oldJSON.futurePhysicalDepth=200;
  const future='TMK1-'+Buffer.from(JSON.stringify(oldJSON)).toString('base64url');assert.equal(f.ctx.productRecipeKey(future),future);f.open({...f.product,recipe:future});assert.equal(f.el('kcDownloadProduct').disabled,true);});
test('returning to the old default settings restores the original saved status',()=>{const f=fixture();f.open();f.ctx.st.colorMode='color';f.ctx.paintProductState();assert.equal(f.el('kcDownloadProduct').disabled,true);f.ctx.st.colorMode='solid';f.ctx.paintProductState();assert.equal(f.el('kcDownloadProduct').disabled,false);});
console.log(passed+' saved-product recipe compatibility checks passed; no storage, network or printer access.');
