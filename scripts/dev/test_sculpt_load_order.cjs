// Production source-selection handlers with delayed local reads. No service or printer calls.
'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const src=fs.readFileSync(path.join(__dirname,'../../web/parts/keycap-ui.js'),'utf8');
function region(a,b){const i=src.indexOf(a),j=src.indexOf(b,i);assert.ok(i>=0&&j>i,a);return src.slice(i,j);}
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
const mesh=x=>new Float32Array([x,0,0,x+1,0,0,x,1,1]),tick=()=>new Promise(setImmediate);
function fixture(){
  const reads=new Map(),saves=[],messages=[],parsed=[],references=new Map(),els={kcPrompt:{value:''}};
  const ctx={Promise,Float32Array,WeakMap,Number,Math,console,
    st:{sculpt:null,art:'gen',profile:'DSA',sizeU:1,skinFrom:'',libId:null},$:id=>els[id]||null,
    K:{capWidth:()=>18,PROFILES:{DSA:{topInset:1}}},
    say:(...a)=>messages.push(a),refresh(){},drawShelf(){},rememberSession(){},rememberLoadedProduct(){},paintReference(){},
    paintArt:mode=>{ctx.st.art=mode;},setArt:mode=>{ctx.st.art=mode;},
    applyDesign:()=>ctx.dropSculpt(),setSourceReference:(colors,kind)=>{ctx.st.sourceColors=colors||null;ctx.st.sourceColorKind=kind||null;},
    parsedReference:r=>references.has(r.positions[0])?references.get(r.positions[0]).promise:Promise.resolve({colors:r.colors,kind:r.kind}),
    keepCurrent:async label=>{const rec={label,positions:new Float32Array(ctx.st.sculpt)};saves.push(rec);return rec;},
    window:{keycapLibrary:{get:id=>{const d=deferred();reads.set(id,d);return d.promise;}},keycapShare:{decode:d=>d},
      stlRead:{readModelFile:(buf,name)=>{parsed.push(name);return {positions:mesh(buf),colors:new Float32Array(9).fill(buf/10),kind:'material'};}}}};
  vm.createContext(ctx);vm.runInContext(region('  var sculptSaves =','  function productRecipeKey(')+
    region('  function useSaved(id) {',"  $('kcOpenWrap')")+
    region('  function dropSculpt() {','  function setArt(mode)'),ctx);
  return {ctx,reads,saves,messages,parsed,references,
    file:(label,d)=>ctx.openModelFile({name:label+'.glb',size:100,arrayBuffer:()=>d.promise}),
    record:(id,n)=>reads.get(id).resolve({id,name:id,positions:mesh(n),prompt:id,design:{},triangles:1})};
}
let passed=0;async function test(n,f){await f();console.log('PASS '+n);passed++;}
(async()=>{
  await test('last file chosen wins even when the first read completes last',async()=>{
    const f=fixture(),a=deferred(),b=deferred(),first=f.file('older',a),second=f.file('newer',b);
    b.resolve(2);await second;a.resolve(1);await first;
    assert.equal(f.ctx.st.sculpt[0],2);assert.equal(f.ctx.st.skinFrom,'newer');assert.deepEqual(f.parsed,['newer.glb']);assert.equal(f.saves.length,1);
  });
  await test('late embedded appearance decoding cannot overwrite a newer model or its colors',async()=>{
    const f=fixture(),appearance=deferred(),a=deferred(),b=deferred();f.references.set(1,appearance);
    const first=f.file('older',a);a.resolve(1);await tick();const second=f.file('newer',b);b.resolve(2);await second;
    appearance.resolve({colors:new Float32Array(9).fill(.9),kind:'texture'});await first;
    assert.equal(f.ctx.st.sculpt[0],2);assert.ok(Math.abs(f.ctx.st.sourceColors[0]-.2)<1e-6);assert.equal(f.ctx.st.sourceColorKind,'material');assert.equal(f.saves.length,1);
  });
  await test('Clear cancels pending import and source appearance work without saving either',async()=>{
    for(const colorPending of [false,true]){const f=fixture(),a=deferred(),c=deferred();if(colorPending)f.references.set(1,c);
      const first=f.file('cleared',a);if(colorPending){a.resolve(1);await tick();}f.ctx.dropSculpt();a.resolve(1);c.resolve({colors:new Float32Array(9).fill(.5)});await first;
      assert.equal(f.ctx.st.sculpt,null);assert.equal(f.ctx.st.libId,null);assert.equal(f.saves.length,0);}
  });
  await test('late errors from an older import do not replace the current successful status',async()=>{
    const f=fixture(),a=deferred(),b=deferred(),first=f.file('older',a),second=f.file('newer',b);b.resolve(2);await second;
    const before=f.messages.length;a.reject(Error('old read failed'));await first;assert.equal(f.messages.length,before);assert.equal(f.ctx.st.sculpt[0],2);
  });
  await test('a current unreadable file reports its failure and preserves existing artwork',async()=>{
    const f=fixture();f.ctx.st.sculpt=mesh(7);const d=deferred(),p=f.file('broken',d);d.reject(Error('file read failed'));await p;
    assert.equal(f.ctx.st.sculpt[0],7);assert.equal(f.saves.length,0);assert.match(f.messages.at(-1)[1],/file read failed/);
  });
  await test('last Library selection wins over an older asynchronous Library read',async()=>{
    const f=fixture(),first=f.ctx.useSaved('older'),second=f.ctx.useSaved('newer');f.record('newer',2);assert.equal(await second,true);f.record('older',1);assert.equal(await first,false);
    assert.equal(f.ctx.st.sculpt[0],2);assert.equal(f.ctx.st.libId,'newer');assert.equal(f.saves.length,0);
  });
  await test('new Library selection cancels pending file and file selection cancels pending Library read',async()=>{
    const f=fixture(),d=deferred(),file=f.file('older-file',d),library=f.ctx.useSaved('newer-library');f.record('newer-library',3);await library;d.resolve(1);await file;assert.equal(f.ctx.st.libId,'newer-library');assert.equal(f.saves.length,0);
    const g=fixture(),read=g.ctx.useSaved('older-library'),d2=deferred(),file2=g.file('newer-file',d2);d2.resolve(4);await file2;g.record('older-library',2);await read;assert.equal(g.ctx.st.sculpt[0],4);assert.equal(g.ctx.st.libId,null);assert.equal(g.saves.length,1);
  });
  await test('Clear cancels a Library read and suppresses its late failure',async()=>{
    const f=fixture(),p=f.ctx.useSaved('cleared');f.ctx.dropSculpt();f.reads.get('cleared').reject(Error('old Library failure'));assert.equal(await p,false);assert.equal(f.ctx.st.sculpt,null);assert.equal(f.messages.length,0);
  });
  await test('direct generated/source adoption invalidates an older file read',async()=>{
    const f=fixture(),d=deferred(),pending=f.file('old file',d);await f.ctx.takeMesh(mesh(9),'generated','delivery');d.resolve(1);await pending;
    assert.equal(f.ctx.st.sculpt[0],9);assert.equal(f.ctx.st.skinFrom,'generated');assert.equal(f.saves.length,1);
  });
  console.log(passed+' sculpt load ordering groups passed.');
})().catch(e=>{console.error(e);process.exitCode=1;});
