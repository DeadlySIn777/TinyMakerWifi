'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync(path.resolve(__dirname,'../../web/parts/keycap-ui.js'),'utf8');
function region(a,b){const i=source.indexOf(a),j=source.indexOf(b,i);assert.ok(i>=0&&j>i,a);return source.slice(i,j);}
function fixture(storage=new Map()){
  const nodes=new Map(),mesh=new Float32Array([0,0,0,1,0,0,0,1,0]);
  const node=id=>{if(!nodes.has(id))nodes.set(id,{value:'',textContent:''});return nodes.get(id);};
  const ctx={JSON,Promise,Number,Math,Float32Array,SESSION:'tmKeycapSession',restoredStep:1,
    st:{name:'',key:'Esc',profile:'DSA',row:'R3',sizeU:1,art:'gen',depth:.55,raised:false,step:3,libId:'saved-art',skinFrom:'Original moss creature',sculptHeightMm:19,meshyPolycount:100000,sculptStyle:'cuteartisan',legendOn:false},
    localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},
    $:node,say:(id,text)=>{node(id).textContent=text;},knownProfile:v=>v==='DSA'?v:null,knownRow:()=> 'R3',safeKeyLabel:v=>typeof v==='string'?v:null,
    restoreSculptSettings:()=>{},paintSculptSettings:()=>{},paintLegendRow:()=>{},refresh:()=>{},setTimeout:()=>0,
    window:{keycapLibrary:{get:async id=>({id,positions:mesh})}}
  };
  vm.createContext(ctx);
  vm.runInContext(region('  function restoreReference(', '  var artisanStyleDraft=')+'\n'+
    region('  function rememberSession()','  /* ---- names that came from outside')+'\n'+
    region('  var sculptSaves =','  function currentProductKey(')+'\n'+
    region('  function restoreSession()','  // ---- the shelf'),ctx);
  return {ctx,storage,mesh};
}
const flush=()=>new Promise(setImmediate);
(async()=>{
  const draft=JSON.stringify({version:1,id:'next-reference',prompt:'Next sculpture draft'});
  const before=fixture(new Map([['tmArtisanStyleDraftV1',draft]]));
  before.ctx.st.name='Moss Knight · Escape';before.ctx.rememberSession();
  const after=fixture(before.storage);after.ctx.restoreSession();await flush();
  assert.equal(after.ctx.st.name,'Moss Knight · Escape');
  assert.equal(after.ctx.st.sculpt,after.mesh);assert.equal(after.ctx.st.libId,'saved-art');
  assert.equal(after.storage.get('tmArtisanStyleDraftV1'),draft);
  console.log('PASS completed sculpture title survives session/mesh restore without changing the separate style draft');

  const long=fixture();long.ctx.st.name='x'.repeat(500);long.ctx.rememberSession();
  assert.equal(JSON.parse(long.storage.get('tmKeycapSession')).name.length,120);
  long.storage.set('tmKeycapSession',JSON.stringify({profile:'DSA',name:'y'.repeat(500)}));long.ctx.restoreSession();
  assert.equal(long.ctx.st.name,'y'.repeat(120));
  console.log('PASS stored and restored titles use the existing 120-character design-title bound');

  for(const value of [undefined,null,42,{text:'not a title'}]){
    const f=fixture(new Map([['tmKeycapSession',JSON.stringify({profile:'DSA',name:value})]]));
    f.ctx.st.name='previous title';f.ctx.restoreSession();assert.equal(f.ctx.st.name,'');
  }
  console.log('PASS legacy and non-string names restore to an empty text title');

  const text=fixture();text.ctx.st.name='<b>Literal title</b>';text.ctx.rememberSession();
  const restored=fixture(text.storage);restored.ctx.restoreSession();assert.equal(restored.ctx.st.name,'<b>Literal title</b>');
  console.log('PASS title content remains text through the JSON session round trip');
  const promptDraft=fixture();promptDraft.ctx.$('kcPrompt').value='A new chibi puppy with two folded ears';promptDraft.ctx.rememberSession();
  const draftRestored=fixture(promptDraft.storage);draftRestored.ctx.restoreSession();await flush();
  assert.equal(draftRestored.ctx.$('kcPrompt').value,'A new chibi puppy with two folded ears');
  assert.equal(draftRestored.ctx.st.skinFrom,'Original moss creature');
  console.log('PASS unfinished prompt survives reload separately from the saved artwork description');
  for(const action of ['clear','replace','braille','read-error']){
    const f=fixture();f.ctx.rememberSession();let finish,fail;
    f.ctx.window.keycapLibrary.get=()=>new Promise((resolve,reject)=>{finish=resolve;fail=reject;});
    f.ctx.restoreSession();
    if(action==='clear'){f.ctx.st.libId=null;f.ctx.st.sculpt=null;}
    else if(action==='braille'){f.ctx.st.art='braille';f.ctx.st.sculpt=null;}
    else {f.ctx.st.libId='new-art';f.ctx.st.sculpt=new Float32Array([1,2,3]);}
    const source=f.ctx.st.sculpt,id=f.ctx.st.libId;
    if(action==='read-error')fail(Error('old read failed'));else finish({id:'saved-art',positions:f.mesh});
    await flush();assert.equal(f.ctx.st.sculpt,source);assert.equal(f.ctx.st.libId,id);
  }
  console.log('PASS late session reads cannot overwrite Clear, new artwork or a changed mode');
  console.log('\n6 session-title groups passed. No network or printer operations.');
})().catch(e=>{console.error(e);process.exitCode=1;});
