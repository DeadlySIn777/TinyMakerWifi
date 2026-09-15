/* Library actions, search and complete local backups; actual production code.
 * No browser credentials, network, generation, printer or print commands. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const read = name => fs.readFileSync(path.join(__dirname, '../../web/parts', name), 'utf8');
const flush = () => new Promise(resolve => setImmediate(resolve));
const raw = () => new Float32Array([0,0,0, 1,0,0, 0,1,1]);
const assembly = () => new Float32Array([
  0,0,0, 0,3,0, 2,0,0, 0,0,0, 2,0,0, 0,0,4,
  0,0,0, 0,0,4, 0,3,0, 2,0,0, 0,3,0, 0,0,4
]);
function fixture() {
  const elements = new Map(), records = new Map(), calls = [];
  let serial = 0;
  class Element {
    constructor(tag='div') { this.tagName=tag; this.children=[]; this.listeners={}; this.style={}; this._text=''; this.value=''; this.disabled=false; }
    appendChild(e) { this.children.push(e); return e; }
    addEventListener(type, fn) { this.listeners[type]=fn; }
    get firstChild() { return this.children[0]; } get lastChild() { return this.children.at(-1); }
    get textContent() { return this._text + this.children.map(e=>e.textContent).join(' '); }
    set textContent(v) { this._text=String(v); this.children=[]; }
    set innerHTML(v) {
      this._text=''; this.children=[];
      if (v==='<span></span><b></b>') { this.appendChild(new Element()); this.appendChild(new Element()); }
      else if (v.includes("id='stLibNote'")) { this.appendChild(new Element()); this.appendChild(el('stLibNote')); }
      else if (v.includes("class='grow'")) this.appendChild(new Element());
      else this._text=v;
    }
    get innerHTML() { return this._text; }
    click() { if (this.tagName==='a') calls.push(['download',this.download]); return this.listeners.click?.({target:this}); }
    remove() {}
  }
  function el(id) { if (!elements.has(id)) elements.set(id,new Element()); return elements.get(id); }
  const ctx={console, Promise, Math, Number, Date, Float32Array, Uint8Array, ArrayBuffer, DataView, Blob, TextEncoder, TextDecoder,
    setTimeout:fn=>{fn();return 0;}, confirm:()=>true,
    document:{getElementById:el,createElement:tag=>new Element(tag),body:new Element('body')},
    URL:{createObjectURL:blob=>{calls.push(['blob',blob]);return 'blob:offline';},revokeObjectURL:()=>{}},
    keycap:{usableBed:()=>({x:30,y:30}),BED:{zSupported:40,zFlat:40}},
    keycapUseSaved:id=>{calls.push(['open',id]);return Promise.resolve(true);},
    studioStage:x=>calls.push(['stage',x]),studioGo:x=>calls.push(['room',x]),
    fetch(){throw Error('Network forbidden');},
    keycapLibrary:{
      list:()=>Promise.resolve([...records.values()].map(r=>({...r,positions:undefined}))),
      get:id=>{calls.push(['get',id]);return Promise.resolve(records.get(id));},
      save:r=>{const saved={...structuredClone(r),id:'restored-'+(++serial),at:Date.now()};records.set(saved.id,saved);calls.push(['save',saved]);return Promise.resolve(saved);},
      remove:id=>{calls.push(['remove',id]);records.delete(id);return Promise.resolve(true);},
      clear:()=>{calls.push(['clear']);records.clear();return Promise.resolve(true);}
    }
  };
  ctx.window=ctx;vm.createContext(ctx);
  ['keycap-product.js','studio-library.js'].forEach(name=>vm.runInContext(read(name),ctx,{filename:name}));
  function product(blocked=false) {return ctx.keycapProduct.capture({positions:blocked?null:assembly(),issues:blocked?['Artwork needs attachment.']:[],fit:{slotMm:1.25},recipe:'TMK1-a',checkedAt:1234});}
  function add(id='dog',kind='sculpt',state='ready') {
    const r={id,at:1000,name:id==='dog'?'Big puppy':'Cherry blossom',prompt:id==='dog'?'Round Australian shepherd':'Pink petals',kind,
      positions:raw(),triangles:1,design:'TMK1-a',facts:{sizeMm:[18,18,27],resinMl:2.5,profile:'DSA',row:'R3',sizeU:1},
      product:state==='artwork'||kind==='model'?null:product(state==='needs-attention')};
    records.set(id,r);return r;
  }
  function all(e=el('stLibrary')) {return [e,...e.children.flatMap(c=>all(c))];}
  function button(text) {const b=all().find(e=>e.tagName==='button'&&e.textContent===text);assert.ok(b,'missing button '+text);return b;}
  async function draw(){await ctx.studioLibrary.draw();await flush();}
  return {ctx,records,calls,el,all,button,draw,add,product};
}
let passed=0;
async function test(name,fn){await fn();console.log('OK '+name);passed++;}
(async()=>{
  await test('failed redraw keeps the visible saved gallery and reports a storage error',async()=>{
    const f=fixture();f.add();await f.draw();f.ctx.keycapLibrary.list=()=>Promise.reject(Error('Storage unavailable'));
    await f.draw();assert.match(f.el('stLibrary').textContent,/Big puppy/);assert.match(f.el('stLibNote').textContent,/Could not load.*Storage unavailable/);assert.equal(f.records.size,1);
  });
  await test('topper summaries filter separately from ordinary Models without loading meshes',async()=>{
    const f=fixture();f.add('model','model');const topper=f.add('topper','model');topper.name='Pencil fox';topper.sourceTool='topper';await f.draw();
    const filter=f.all().find(e=>e.tagName==='select');filter.value='topper';filter.listeners.change();
    assert.match(f.el('stLibrary').textContent,/Pencil fox/);assert.doesNotMatch(f.el('stLibrary').textContent,/Cherry blossom/);assert.equal(f.calls.some(c=>c[0]==='get'),false);
  });
  await test('keycap opening waits for actual restore and suppresses duplicate opens',async()=>{
    const f=fixture();f.add();await f.draw();let finish;
    f.ctx.keycapUseSaved=id=>{f.calls.push(['open',id]);return new Promise(resolve=>{finish=resolve;});};
    const b=f.button('Open in Create'),opening=b.click();await flush();
    assert.equal(b.disabled,true);assert.equal(b.textContent,'Opening…');
    assert.equal(await f.ctx.studioLibrary.open('dog'),false);
    assert.equal(f.calls.some(c=>c[0]==='room'),false);
    finish(true);assert.equal(await opening,true);
    assert.equal(b.disabled,false);assert.deepEqual(f.calls.filter(c=>c[0]==='room'),[['room','create']]);
  });
  for(const mode of ['false','reject','missing'])await test('failed keycap restore ('+mode+') leaves the Library visible',async()=>{
    const f=fixture();f.add();await f.draw();
    if(mode==='missing')delete f.ctx.keycapUseSaved;
    else f.ctx.keycapUseSaved=()=>mode==='false'?Promise.resolve(false):Promise.reject(Error('Storage failed'));
    const b=f.button('Open in Create');assert.equal(await b.click(),false);
    assert.equal(b.disabled,false);assert.equal(f.calls.some(c=>c[0]==='room'),false);
    assert.match(f.el('stLibNote').className,/warn/);assert.equal(f.records.size,1);
  });
  for(const clear of [false,true])await test((clear?'clear':'delete')+' storage rejection is visible and retry remains possible',async()=>{
    const f=fixture();f.add();await f.draw();
    f.ctx.keycapLibrary[clear?'clear':'remove']=()=>Promise.reject(Error('Disk refused'));
    const b=f.button(clear?'Delete all…':'Delete');assert.equal(await b.click(),false);
    assert.match(f.el('stLibNote').textContent,/Disk refused/);assert.equal(b.disabled,false);assert.equal(f.records.size,1);
    f.ctx.keycapLibrary[clear?'clear':'remove']=()=>{f.records.clear();return Promise.resolve(true);};
    assert.equal(await b.click(),true);assert.equal(f.records.size,0);assert.match(f.el('stLibNote').textContent,/deleted/i);
  });
  await test('pending delete and clear cannot issue competing writes',async()=>{
    const f=fixture();f.add();await f.draw();let finish,attempts=0;
    f.ctx.keycapLibrary.remove=()=>{attempts++;return new Promise(resolve=>{finish=resolve;});};
    const pending=f.button('Delete').click();await flush();
    assert.equal(await f.button('Delete all…').click(),false);assert.equal(await f.button('Delete').click(),false);
    assert.equal(attempts,1);finish(true);assert.equal(await pending,true);
  });
  await test('older asynchronous list responses cannot replace a newer Library draw',async()=>{
    const f=fixture(),old=f.add();let first,second,reads=0;
    f.ctx.keycapLibrary.list=()=>new Promise(resolve=>{if(++reads===1)first=resolve;else second=resolve;});
    const a=f.ctx.studioLibrary.draw();await flush();const b=f.ctx.studioLibrary.draw();await flush();
    second([{...old,id:'new',name:'Newest design'}]);await b;
    first([old]);await a;
    assert.match(f.el('stLibrary').textContent,/Newest design/);assert.doesNotMatch(f.el('stLibrary').textContent,/Big puppy/);
  });
  await test('late storage estimates never overwrite an action failure',async()=>{
    const f=fixture();f.add();let estimate;f.ctx.keycapLibrary.usage=()=>new Promise(resolve=>{estimate=resolve;});await f.draw();
    f.ctx.keycapLibrary.remove=()=>Promise.reject(Error('Important error'));await f.button('Delete').click();
    estimate({known:true,pct:2,usedBytes:100,quotaBytes:5000});await flush();
    assert.match(f.el('stLibNote').textContent,/Important error/);
  });
  await test('search and readiness filters use summaries without loading meshes',async()=>{
    const f=fixture();f.add();f.add('flower','sculpt','needs-attention');f.add('mini','model');await f.draw();
    assert.equal(f.calls.some(c=>c[0]==='get'),false);
    const search=f.all().find(e=>e.type==='search'),filter=f.all().find(e=>e.tagName==='select');
    search.value='AUSTRALIAN';search.listeners.input();assert.match(f.el('stLibrary').textContent,/1 of 3 designs/);
    assert.equal(f.all().filter(e=>e.className?.startsWith('stLibCard')).length,1);
    search.value='';search.listeners.input();filter.value='needs-attention';filter.listeners.change();
    assert.equal(f.all().filter(e=>e.className?.startsWith('stLibCard')).length,1);
    search.value='unmatched';search.listeners.input();assert.match(f.el('stLibrary').textContent,/no matches/);
    assert.equal(f.calls.some(c=>c[0]==='get'),false);
  });
  await test('binary design backup round-trips exact source, ready product, recipe and fit',async()=>{
    const f=fixture(),rec=f.add(),blob=f.ctx.studioLibrary.backup.encode(rec);
    assert.ok(blob.size<3000,'binary geometry should remain compact');
    const decoded=f.ctx.studioLibrary.backup.decode(await blob.arrayBuffer());
    assert.deepEqual(Array.from(decoded.record.positions),Array.from(rec.positions));
    assert.deepEqual(Array.from(decoded.record.product.positions),Array.from(rec.product.positions));
    assert.equal(decoded.record.product.fit.slotMm,1.25);assert.equal(decoded.record.design,'TMK1-a');
    assert.equal(decoded.record.name,'Big puppy');assert.equal(decoded.warning,'');assert.equal('id' in decoded.record,false);
    assert.equal(f.ctx.keycapProduct.validate(decoded.record.product),true);
  });
  await test('artwork-only, blocked and model backups remain recoverable',async()=>{
    const f=fixture();
    for(const [kind,state] of [['sculpt','artwork'],['sculpt','needs-attention'],['model','artwork']]){
      const rec=f.add('copy',kind,state),d=f.ctx.studioLibrary.backup.decode(await f.ctx.studioLibrary.backup.encode(rec).arrayBuffer());
      assert.equal(d.record.kind,kind);assert.equal(d.record.product?.state||'artwork',state);assert.equal(d.warning,'');
    }
  });
  await test('backup button downloads an editable design without opening or regenerating it',async()=>{
    const f=fixture();f.add();await f.draw();assert.equal(await f.button('Backup design').click(),true);
    assert.deepEqual(f.calls.filter(c=>c[0]==='download'),[['download','Big puppy.tm-design']]);
    assert.equal(f.calls.some(c=>c[0]==='open'||c[0]==='room'),false);
  });
  await test('import makes a new Library copy and preserves existing designs',async()=>{
    const f=fixture(),rec=f.add(),original=structuredClone(rec),blob=f.ctx.studioLibrary.backup.encode(rec);await f.draw();
    assert.equal(await f.ctx.studioLibrary.importBackup(blob),true);assert.equal(f.records.size,2);
    assert.deepEqual(structuredClone(f.records.get('dog')),original);assert.ok(f.records.has('restored-1'));
    assert.equal(f.records.get('restored-1').product.state,'ready');assert.match(f.el('stLibNote').textContent,/Existing designs were kept/);
  });
  await test('tampered assembled product is restored only as editable artwork with a warning',async()=>{
    const f=fixture(),rec=f.add();rec.product.positions[0]=9;
    const blob=f.ctx.studioLibrary.backup.encode(rec);assert.equal(await f.ctx.studioLibrary.importBackup(blob),true);
    assert.equal(f.records.get('restored-1').product,null);assert.equal(f.records.get('restored-1').facts,null);
    assert.match(f.el('stLibNote').textContent,/could not be verified.*rebuild/);assert.match(f.el('stLibNote').className,/warn/);
  });
  await test('changed printer volume cannot promote an old assembly to ready',async()=>{
    const f=fixture(),rec=f.add(),blob=f.ctx.studioLibrary.backup.encode(rec);
    f.ctx.keycap.usableBed=()=>({x:1,y:1});
    const decoded=f.ctx.studioLibrary.backup.decode(await blob.arrayBuffer());assert.equal(decoded.record.product,null);
    assert.match(decoded.warning,/could not be verified/);assert.equal(decoded.record.positions.length,rec.positions.length);
  });
  await test('corrupted, truncated, wrong-type and oversized backups never write records',async()=>{
    const f=fixture(),rec=f.add(),buffer=await f.ctx.studioLibrary.backup.encode(rec).arrayBuffer();
    const corrupt=buffer.slice(0),header=new DataView(corrupt);new Uint8Array(corrupt)[20+header.getUint32(8,true)]^=1;
    for(const invalid of [new ArrayBuffer(20),buffer.slice(0,-1),corrupt]){
      assert.equal(await f.ctx.studioLibrary.importBackup(new Blob([invalid])),false);assert.equal(f.records.size,1);
    }
    let read=false;assert.equal(await f.ctx.studioLibrary.importBackup({size:1e9,arrayBuffer(){read=true;return Promise.resolve(buffer);}}),false);
    assert.equal(read,false);assert.equal(f.calls.some(c=>c[0]==='save'),false);
  });
  await test('metadata rejects unknown kinds, invalid dimensions and executable thumbnail URLs',async()=>{
    const f=fixture(),rec=f.add();
    assert.throws(()=>f.ctx.studioLibrary.backup.encode({...rec,kind:'executable'}),/unsupported/);
    assert.throws(()=>f.ctx.studioLibrary.backup.encode({...rec,facts:{sizeMm:[1,'2',3]}}),/dimensions/);
    const decoded=f.ctx.studioLibrary.backup.decode(await f.ctx.studioLibrary.backup.encode({...rec,thumb:'https://example.invalid/tracker'}).arrayBuffer());
    assert.equal(decoded.record.thumb,null);
  });
  await test('import storage failure leaves original records and backup data untouched',async()=>{
    const f=fixture(),rec=f.add(),blob=f.ctx.studioLibrary.backup.encode(rec),before=await blob.arrayBuffer();
    f.ctx.keycapLibrary.save=()=>Promise.reject(Error('Quota full'));await f.draw();
    assert.equal(await f.ctx.studioLibrary.importBackup(blob),false);assert.equal(f.records.size,1);
    assert.match(f.el('stLibNote').textContent,/Quota full/);assert.deepEqual(await blob.arrayBuffer(),before);
  });
  console.log(passed+' Library recovery and action regression groups passed; no network or printer access.');
})().catch(error=>{console.error(error);process.exitCode=1;});
