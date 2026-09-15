'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const base=path.resolve(__dirname,'../..'),read=f=>fs.readFileSync(path.join(base,'web/parts',f),'utf8');
const K=require(path.join(base,'web/parts/keycap.js')),SK=require(path.join(base,'web/parts/keycap-skin.js')),SH=require(path.join(base,'web/parts/keycap-share.js'));
const gallerySource=read('artisan-gallery.js'),uiSource=read('keycap-ui.js');
function record(n=1){return {id:'inert-'+n,title:n%2?'Kitten '+n:'Blossom '+n,maker:'Inert Maker',category:n%2?'Animals':'Flowers',imageUrl:'https://example.com/image-'+n+'.png',sourceUrl:'https://example.com/reference-'+n,prompt:'A plump sitting kitten with broad sculpted features and a stable underside',sculptHeightMm:n%2?19:11,sculptStyle:'cuteartisan'};}
function domFixture(){
  let images=0;const doc={activeElement:null};
  class E{
    constructor(tag){this.tagName=tag;this.children=[];this.attributes={};this.events={};this.style={};this.value='';this.disabled=false;this._text='';this.parentNode=null;}
    get firstChild(){return this.children[0];}get textContent(){return this._text+this.children.map(c=>c.textContent).join('');}set textContent(t){this._text=String(t);this.children=[];}
    appendChild(n){n.parentNode=this;this.children.push(n);return n;}removeChild(n){this.children.splice(this.children.indexOf(n),1);n.parentNode=null;return n;}
    replaceChild(n,o){const i=this.children.indexOf(o);this.children[i]=n;n.parentNode=this;o.parentNode=null;}
    setAttribute(k,v){this.attributes[k]=String(v);}getAttribute(k){return this.attributes[k];}
    addEventListener(k,f){this.events[k]=f;}fire(k,e={}){return this.events[k]?.call(this,e);}click(){if(!this.disabled)return this.fire('click');}
    focus(){doc.activeElement=this;}showModal(){this.open=true;}close(){this.open=false;}
    set src(v){this._src=v;images++;}get src(){return this._src;}
    querySelectorAll(selector){return descendants(this).filter(n=>['button','input','select','a'].includes(n.tagName)&&!(n.tagName==='a'&&!n.href));}
  }
  function descendants(n){return n.children.flatMap(c=>[c,...descendants(c)]);}
  doc.createElement=t=>new E(t);doc.body=new E('body');doc.activeElement=new E('button');const prior=doc.activeElement;
  const ctx={document:doc,URL,Number,console,artisanCatalog:Array.from({length:50},(_,i)=>record(i+1)),fetch(){throw Error('Network forbidden');}};ctx.window=ctx;
  vm.createContext(ctx);vm.runInContext(gallerySource,ctx);
  return {ctx,doc,prior,get images(){return images;},nodes:()=>descendants(doc.body),one:c=>descendants(doc.body).find(n=>n.className===c),tag:t=>descendants(doc.body).filter(n=>n.tagName===t)};
}
function region(a,b){const i=uiSource.indexOf(a),j=uiSource.indexOf(b,i);assert.ok(i>=0&&j>i,a);return uiSource.slice(i,j);}
function editorFixture(storage=new Map()){
  const nodes=new Map(),calls=[],messages=[],oldMesh=new Float32Array([0,0,0,1,0,0,0,1,0]);let pendingResolve;
  const node=id=>{if(!nodes.has(id))nodes.set(id,{value:'',textContent:'',disabled:false,hidden:false,style:{},events:{},setAttribute(){},addEventListener(k,fn){this.events[k]=fn;}});return nodes.get(id);};
  const G=require(path.join(base,'web/parts/artisan-gallery.js'));
  const ctx={K,Math,Number,Promise,Float32Array,ArrayBuffer,WeakMap,Object,built:null,stemFitClearance:K.MX.slotClearance,
    document:{activeElement:null},
    localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},
    st:{key:'Esc',profile:'DSA',row:'R3',sizeU:1,depth:.55,raised:true,sculptHeightMm:13,meshyPolycount:30000,sculptStyle:'faithfulsubject',name:'Original',legendOn:true,sculpt:oldMesh,libId:'saved-original',skinFrom:'old sculpture',plate:[]},
    $:node,say:(...m)=>messages.push(m),setTimeout:()=>0,refresh:()=>calls.push('refresh'),rememberSession:()=>calls.push('remember'),
    keepCurrent:async()=>calls.push('save'),offerManualDownload:e=>messages.push(['error',e.message]),
    designOf:()=>({profile:'DSA',row:'R3',sizeU:1,name:ctx.st.name,legendOn:ctx.st.legendOn,sculptHeightMm:ctx.st.sculptHeightMm}),
    applyDesign:d=>{calls.push(['apply',d]);Object.assign(ctx.st,d);ctx.st.sculpt=null;},
    window:{artisanGallery:G,artisanCatalog:[record(),record(2)],keycapSkin:SK,keycapShare:SH,meshyParseGLB:()=>({positions:new Float32Array([0,0,0,2,0,0,0,2,0])}),
      meshy:{hasKey:()=>true,pending:()=>null,generate:(prompt,opts)=>{calls.push(['generate',prompt,opts]);return new Promise(resolve=>{pendingResolve=resolve;});}}}
  };
  vm.createContext(ctx);vm.runInContext([
    region('  // ---- sculpture settings','  // ---- local stem fit preference'),
    region('  var sculptSaves =','  function captureProduct('),
    region('  function genBusy(on)','  /* seat()'),region('  function capSpec()','  /* A generation'),
    region("  $('kcGen').addEventListener", "  $('kcGenClear').addEventListener"),
    'bindSculptSettings();bindArtisanGallery();'
  ].join('\n'),ctx);
  node('kcPrompt').value='old draft prompt';
  return {ctx,node,calls,messages,oldMesh,storage,choose:r=>ctx.applyArtisanStyleDraft(r),fire:(id,event='click')=>node(id).events[event].call(node(id)),resolve:()=>pendingResolve({glb:new ArrayBuffer(0)})};
}
const flush=()=>new Promise(setImmediate);let count=0;async function test(name,fn){await fn();count++;console.log('PASS '+name);}
(async()=>{
  await test('closed gallery loads no photos; open renders50 lazy attributed references',()=>{
    const f=domFixture();assert.equal(f.images,0);assert.equal(f.doc.body.children.length,0);
    f.ctx.artisanGallery.open({onUse:()=>{}});assert.equal(f.one('agCount').textContent,'50 of 50 styles');
    assert.equal(f.tag('img').length,50);assert.ok(f.tag('img').every(i=>i.loading==='lazy'&&i.referrerPolicy==='no-referrer'));
    assert.ok(f.tag('a').every(a=>a.rel==='noopener noreferrer'&&a.referrerPolicy==='no-referrer'));
    assert.match(f.one('agHead').textContent,/photos are not sent to Meshy/);
  });
  await test('category/search filters show correct counts and Clear resets both',()=>{
    const f=domFixture();f.ctx.artisanGallery.open({onUse:()=>{}});const cat=f.tag('select')[0],input=f.tag('input')[0];
    cat.value='Animals';cat.fire('change');assert.equal(f.one('agCount').textContent,'25 of 50 styles');
    input.value='missing subject';input.fire('input');assert.equal(f.one('agCount').textContent,'0 of 50 styles');
    f.tag('button').find(b=>b.textContent==='Clear filters').click();assert.equal(cat.value,'');assert.equal(input.value,'');assert.equal(f.one('agCount').textContent,'50 of 50 styles');
  });
  await test('selection alone does not call back; Use style returns validated metadata once and closes',()=>{
    const f=domFixture(),used=[];f.ctx.artisanGallery.open({onUse:r=>used.push(r)});
    f.one('agPick').click();assert.equal(used.length,0);assert.equal(f.one('agUse').disabled,false);
    f.one('agUse').click();assert.equal(used.length,1);assert.equal(used[0].id,'inert-1');assert.equal(f.doc.body.children.length,0);assert.equal(f.doc.activeElement,f.prior);
  });
  await test('blocked thumbnail leaves meaningful maker link and selectable text',()=>{
    const f=domFixture();f.ctx.artisanGallery.open({onUse:()=>{}});f.tag('img')[0].fire('error');
    assert.match(f.one('agImageError').textContent,/Photo unavailable/);assert.equal(f.one('agSource').href,record().sourceUrl);
    f.one('agPick').click();assert.equal(f.one('agUse').disabled,false);
  });
  await test('unsafe URLs/records and duplicates are omitted before image requests',()=>{
    const f=domFixture(),r=record();assert.equal(f.ctx.artisanGallery.catalog([r,r]).length,1);
    for(const bad of [{imageUrl:'http://example.com/x'},{imageUrl:'https://127.0.0.1/x'},{sourceUrl:'javascript:alert(1)'},{sculptHeightMm:Infinity},{sculptStyle:'constructor'},{prompt:'x'.repeat(501)}])assert.equal(f.ctx.artisanGallery.validateRecord({...r,...bad}),null);
    f.ctx.artisanGallery.open({records:[{...r,imageUrl:'https://localhost/x'}],onUse:()=>{}});assert.equal(f.images,0);assert.match(f.one('agEmpty').textContent,/not available/);
  });
  await test('keyboard Escape cancels without choosing and restores focus',()=>{
    const f=domFixture();let uses=0;f.ctx.artisanGallery.open({onUse:()=>uses++});let prevented=false;
    f.one('agDialog').fire('keydown',{key:'Escape',preventDefault(){prevented=true;}});assert.equal(prevented,true);assert.equal(uses,0);assert.equal(f.doc.activeElement,f.prior);
  });
  await test('Use style stages recipe controls but preserves original mesh, ID, name and lettering',()=>{
    const f=editorFixture();assert.equal(f.choose(record()),true);
    assert.equal(f.ctx.st.sculpt,f.oldMesh);assert.equal(f.ctx.st.libId,'saved-original');assert.equal(f.ctx.st.name,'Original');assert.equal(f.ctx.st.legendOn,true);assert.equal(f.ctx.st.sculptHeightMm,13);
    assert.equal(f.node('kcSculptHeight').value,'19');assert.equal(f.node('kcMeshyDetail').value,'100000');assert.equal(f.node('kcPrompt').value,record().prompt);
    assert.match(f.messages.find(m=>m[0]==='kcStyleDraftNote')[1],/Text inspiration only/);assert.deepEqual(f.calls,[]);
  });
  await test('draft edits and cancel do not mutate current artwork; cancel restores controls and prompt',()=>{
    const f=editorFixture();f.choose(record());f.node('kcSculptHeight').value='22';f.fire('kcSculptHeight','input');
    f.node('kcMeshyDetail').value='30000';f.fire('kcMeshyDetail','change');assert.equal(f.ctx.st.sculptHeightMm,13);assert.equal(f.ctx.st.sculpt,f.oldMesh);
    f.fire('kcStyleDraftCancel');assert.equal(f.node('kcSculptHeight').value,'13');assert.equal(f.node('kcSculptStyle').value,'faithfulsubject');assert.equal(f.node('kcPrompt').value,'old draft prompt');assert.equal(f.node('kcStyleDraft').hidden,true);
  });
  await test('Generate alone submits the text recipe; successful result applies chosen name/height/no-legend',async()=>{
    const f=editorFixture();f.choose(record());f.fire('kcGen');const call=f.calls.find(c=>Array.isArray(c)&&c[0]==='generate');
    assert.ok(call);assert.match(call[1],/19 by 19 by 19 mm/);assert.ok(!call[1].includes('https:'));assert.equal(call[2].polycount,100000);
    const d=SH.decode(call[2].designCode);assert.equal(d.name,record().title);assert.equal(d.legendOn,false);assert.equal(d.sculptHeightMm,19);assert.equal(d.sculptStyle,'cuteartisan');
    assert.equal(f.ctx.st.sculpt,f.oldMesh);assert.equal(f.ctx.st.name,'Original');assert.equal(f.node('kcBrowseStyles').disabled,true);
    f.resolve();await flush();await flush();assert.notEqual(f.ctx.st.sculpt,f.oldMesh);assert.equal(f.ctx.st.name,record().title);assert.equal(f.ctx.st.legendOn,false);assert.ok(f.calls.includes('save'));assert.equal(f.node('kcStyleDraft').hidden,true);
  });
  await test('invalid or over-budget style does not change current work or submit a request',()=>{
    const f=editorFixture();assert.equal(f.choose({...record(),prompt:'x'.repeat(500)}),false);assert.equal(f.ctx.st.sculpt,f.oldMesh);assert.equal(f.node('kcPrompt').value,'old draft prompt');assert.deepEqual(f.calls,[]);
  });
  await test('actual catalog accepts all50 references and all8 categories without requesting images',()=>{
    const records=require(path.join(base,'web/parts/artisan-catalog.js')),f=domFixture();
    assert.equal(records.length,50);assert.equal(f.ctx.artisanGallery.catalog(records).length,50);
    assert.equal(new Set(records.map(r=>r.category)).size,8);assert.equal(f.images,0);
    f.ctx.artisanGallery.open({records,onUse:()=>{}});assert.equal(f.one('agCount').textContent,'50 of 50 styles');assert.equal(f.tag('select')[0].children.length,9);
    const editor=editorFixture();for(const r of records)assert.equal(editor.choose(r),true,r.title);
    assert.equal(editor.ctx.st.sculpt,editor.oldMesh);assert.deepEqual(editor.calls,[]);
  });
  await test('draft survives reload separately from the current sculpt recipe and cancel removes it',()=>{
    const f=editorFixture();f.choose(record());f.node('kcSculptHeight').value='21';f.fire('kcSculptHeight','input');
    f.node('kcPrompt').value='An original round kitten sleeping on a chunky flower';f.fire('kcPrompt','input');
    const saved=JSON.parse(f.storage.get('tmArtisanStyleDraftV1'));assert.equal(saved.id,record().id);assert.equal(saved.sculptHeightMm,21);assert.equal(saved.imageUrl,undefined);assert.equal(saved.libId,undefined);
    const reload=editorFixture(f.storage);reload.ctx.restoreArtisanStyleDraft();
    assert.equal(reload.node('kcSculptHeight').value,'21');assert.equal(reload.node('kcPrompt').value,saved.prompt);assert.equal(reload.ctx.st.sculpt,reload.oldMesh);assert.equal(reload.ctx.st.libId,'saved-original');assert.equal(reload.ctx.st.name,'Original');
    reload.fire('kcStyleDraftCancel');assert.equal(reload.node('kcPrompt').value,'old draft prompt');assert.equal(reload.storage.has('tmArtisanStyleDraftV1'),false);
  });
  await test('invalid persisted draft cannot change current geometry or inject a reference URL',()=>{
    for(const bad of [{id:'not-in-catalog'},{prompt:'x'.repeat(501)},{sculptHeightMm:999},{sculptStyle:'constructor'},{meshyPolycount:900000}]){
      const f=editorFixture(new Map([['tmArtisanStyleDraftV1',JSON.stringify({version:1,id:record().id,prompt:'inert kitten',sculptHeightMm:19,sculptStyle:'cuteartisan',meshyPolycount:100000,...bad})]]));
      f.ctx.restoreArtisanStyleDraft();assert.equal(f.ctx.st.sculpt,f.oldMesh);assert.equal(f.node('kcPrompt').value,'old draft prompt');assert.deepEqual(f.calls,[]);
    }
  });
  await test('failed generation leaves old artwork and the new draft available for retry',async()=>{
    const f=editorFixture();f.choose(record());f.ctx.window.meshy.generate=()=>Promise.reject(Error('inert service failure'));
    f.fire('kcGen');await flush();await flush();assert.equal(f.ctx.st.sculpt,f.oldMesh);assert.equal(f.ctx.st.libId,'saved-original');assert.equal(f.ctx.st.name,'Original');assert.equal(f.node('kcStyleDraft').hidden,false);assert.equal(f.node('kcBrowseStyles').disabled,false);assert.ok(!f.calls.includes('save'));
  });
  await test('missing Meshy access does not replace artwork or lose its prepared draft',()=>{
    const f=editorFixture();f.choose(record());f.ctx.window.meshy.hasKey=()=>false;f.fire('kcGen');
    assert.equal(f.ctx.st.sculpt,f.oldMesh);assert.equal(f.node('kcStyleDraft').hidden,false);assert.deepEqual(f.calls,[]);
  });
  await test('modal keyboard focus wraps at its boundaries',()=>{
    const f=domFixture();f.ctx.artisanGallery.open({onUse:()=>{}});f.one('agPick').click();f.one('agUse').focus();
    let moved=false;f.one('agDialog').fire('keydown',{key:'Tab',shiftKey:false,preventDefault(){moved=true;}});assert.equal(moved,true);assert.equal(f.doc.activeElement,f.one('agClose'));
    f.one('agDialog').fire('keydown',{key:'Tab',shiftKey:true,preventDefault(){}});assert.equal(f.doc.activeElement,f.one('agUse'));
  });
  console.log('\n'+count+' artisan gallery groups passed. All images are inert references; no network or Meshy task ran.');
})().catch(e=>{console.error(e);process.exitCode=1;});
