/* Actual Library storage + UI + product exporter; in-memory IndexedDB and DOM.
 * No browser credentials, network, printer, paid requests or print commands. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = name => fs.readFileSync(path.join(__dirname, '../../web/parts', name), 'utf8');
const flush = () => new Promise(resolve => setImmediate(resolve));
const plain = x => JSON.parse(JSON.stringify(x));
const raw = () => new Float32Array([0,0,0, .1,0,0, 0,.2,.3]);
const assembly = () => new Float32Array([
  0,0,0, 0,3,0, 2,0,0, 0,0,0, 2,0,0, 0,0,4,
  0,0,0, 0,0,4, 0,3,0, 2,0,0, 0,3,0, 0,0,4
]);
function fixture() {
  const records = new Map(), calls = [], elements = new Map();
  let quota = false;
  const clone = v => v === undefined ? undefined : structuredClone(v);
  const db = {
    objectStoreNames: {contains: () => true}, close() {},
    transaction() {
      const t = {error:null};
      const os = {
        put(rec) {
          if (quota) { t.error = {name:'QuotaExceededError'}; return {}; }
          records.set(rec.id, clone(rec)); return {};
        },
        get(id) { calls.push(['get', id]); return {result:clone(records.get(id))}; },
        delete(id) { calls.push(['delete', id]); records.delete(id); },
        clear() { records.clear(); },
        openCursor() {
          const rq = {}, rows = [...records.values()].map(clone); let index = 0;
          function next() {
            queueMicrotask(() => {
              const result = index < rows.length ? {value:rows[index++], continue:next} : null;
              rq.onsuccess?.({target:{result}});
            });
          }
          next(); return rq;
        }
      };
      t.objectStore = () => os;
      setImmediate(() => { if (t.error) t.onabort?.(); else t.oncomplete?.(); });
      return t;
    }
  };
  class Element {
    constructor(tag='div') { this.tagName=tag; this.children=[]; this.style={}; this.listeners={}; this._text=''; this.disabled=false; }
    appendChild(e) { this.children.push(e); return e; }
    addEventListener(type, fn) { this.listeners[type]=fn; }
    get firstChild() { return this.children[0]; } get lastChild() { return this.children.at(-1); }
    get textContent() { return this._text + this.children.map(e=>e.textContent).join(' '); }
    set textContent(v) { this._text=String(v); this.children=[]; }
    set innerHTML(v) {
      this._text=''; this.children=[];
      if(v==='<span></span><b></b>') { this.appendChild(new Element()); this.appendChild(new Element()); }
      else if(v.includes("id='stLibNote'")) { this.appendChild(new Element()); this.appendChild(el('stLibNote')); }
      else if(v.includes("class='grow'")) this.appendChild(new Element());
      else this._text=v;
    }
    get innerHTML() { return this._text; }
    click() { if (this.tagName==='a') calls.push(['download', this.download]); return this.listeners.click?.({target:this}); }
    remove() {}
  }
  function el(id) { if(!elements.has(id)) elements.set(id,new Element()); return elements.get(id); }
  const ctx = {console, Promise, Math, Number, Date, Float32Array, ArrayBuffer, DataView, Blob,
    indexedDB:{open(){const rq={result:db};queueMicrotask(()=>rq.onsuccess?.());return rq;}},
    navigator:{}, setTimeout:fn=>{fn();return 0;}, confirm:()=>false,
    document:{getElementById:el, createElement:tag=>new Element(tag), body:new Element('body')},
    URL:{createObjectURL:blob=>{calls.push(['blob',blob]);return 'blob:inert-test';}, revokeObjectURL:()=>{}},
    keycap:{usableBed:()=>({x:30,y:30}), BED:{zSupported:25,zFlat:30}},
    keycapUseSaved:id=>calls.push(['edit-source',id]),
    studioStage:stage=>calls.push(['stage',stage]), studioGo:page=>calls.push(['page',page]),
    fetch(){throw Error('Network forbidden');}
  };
  ctx.window=ctx; vm.createContext(ctx);
  ['keycap-product.js','keycap-library.js','studio-library.js'].forEach(name=>vm.runInContext(source(name),ctx,{filename:name}));
  function product(blocked=false) {
    return ctx.keycapProduct.capture({positions:blocked?null:assembly(), issues:blocked?['Artwork exceeds the usable plate.']:[],
      fit:{slotMm:1.25},recipe:'TMK1-inertRecipe',checkedAt:12345});
  }
  async function save(id='cap', blocked=false) {
    return ctx.keycapLibrary.save({id,name:'Cute / cap',kind:'sculpt',positions:raw(),design:'TMK1-inertRecipe',product:product(blocked)});
  }
  function descendants(e=el('stLibrary')) { return [e,...e.children.flatMap(c=>descendants(c))]; }
  async function draw() { ctx.studioLibrary.draw(); await flush(); await flush(); }
  return {ctx,records,calls,el,product,save,draw,descendants,setQuota:value=>{quota=value;}};
}
let passed=0;
async function test(name, fn) { await fn(); console.log('OK '+name); passed++; }
(async()=>{
  await test('save snapshots the checked assembly, fit and issues before asynchronous storage opens',async()=>{
    const f=fixture(),p=f.product(),expected=Array.from(p.positions),sig=p.signature;
    const saving=f.ctx.keycapLibrary.save({id:'cap',name:'Cap',positions:raw(),product:p});
    p.positions[0]=999;p.fit.slotMm=1.45;p.sizeMm[0]=999;p.issues.push('Later editor change');
    await saving;const rec=await f.ctx.keycapLibrary.get('cap');
    assert.deepEqual(Array.from(rec.product.positions),expected);assert.equal(rec.product.signature,sig);
    assert.equal(rec.product.fit.slotMm,1.25);assert.deepEqual(plain(rec.product.issues),[]);
    assert.equal(f.ctx.keycapProduct.validate(rec.product),true);
    assert.notDeepEqual(Array.from(rec.positions),expected,'raw source is separate from print assembly');
  });
  await test('raw source and nested measurements are captured with product and colors before storage opens',async()=>{
    const f=fixture(),positions=raw(),expected=Array.from(positions),colors=new Float32Array(positions.length).fill(.25);
    const facts={sizeMm:[18,18,27],topper:{diameterMm:7,axes:[7,7]},notes:['captured']};
    const work=f.ctx.keycapLibrary.save({id:'snapshot',name:'Snapshot',positions,facts,sourceColors:colors,sourceColorKind:'vertex',product:f.product()});
    positions[0]=77;facts.sizeMm[2]=99;facts.topper.diameterMm=10;facts.topper.axes[0]=10;facts.notes.push('later');colors.fill(.8);
    const returned=await work,stored=await f.ctx.keycapLibrary.get('snapshot');
    assert.deepEqual(Array.from(stored.positions),expected);assert.deepEqual(plain(stored.facts.sizeMm),[18,18,27]);
    assert.equal(stored.facts.topper.diameterMm,7);assert.deepEqual(plain(stored.facts.topper.axes),[7,7]);assert.deepEqual(plain(stored.facts.notes),['captured']);
    assert.ok(Array.from(stored.sourceColors).every(n=>n===.25));assert.equal(f.ctx.keycapProduct.validate(stored.product),true);
    returned.positions[1]=88;returned.facts.topper.axes[1]=11;assert.deepEqual(Array.from((await f.ctx.keycapLibrary.get('snapshot')).positions),expected);
    assert.equal((await f.ctx.keycapLibrary.get('snapshot')).facts.topper.axes[1],7);
  });
  await test('list is lightweight and retains saved readiness, fit, dimensions and recipe',async()=>{
    const f=fixture();await f.save();const [summary]=await f.ctx.keycapLibrary.list();
    assert.equal('positions' in summary,false);assert.equal('positions' in summary.product,false);
    assert.equal(summary.product.state,'ready');assert.equal(summary.product.fit.slotMm,1.25);
    assert.deepEqual(plain(summary.product.sizeMm),[2,3,4]);assert.equal(summary.product.triangles,4);
    assert.equal(summary.product.recipe,'TMK1-inertRecipe');
    summary.product.fit.slotMm=1.4;assert.equal((await f.ctx.keycapLibrary.get('cap')).product.fit.slotMm,1.25);
  });
  await test('source reference colours are copied before async storage and excluded from Library summaries',async()=>{
    const f=fixture(),positions=raw(),colors=new Float32Array([1,.25,0, 0,1,.5, .5,0,1]),expected=Array.from(colors);
    const saving=f.ctx.keycapLibrary.save({id:'painted',name:'Painted cap',positions,sourceColors:colors,sourceColorKind:'vertex'});
    colors.fill(0);await saving;
    const rec=await f.ctx.keycapLibrary.get('painted');
    assert.deepEqual(Array.from(rec.sourceColors),expected);assert.equal(rec.sourceColorKind,'vertex');
    rec.sourceColors.fill(.75);assert.deepEqual(Array.from((await f.ctx.keycapLibrary.get('painted')).sourceColors),expected);
    const [summary]=await f.ctx.keycapLibrary.list();assert.equal('sourceColors' in summary,false);
    assert.equal('positions' in summary,false);
  });
  await test('malformed optional source colours cannot be stored as a valid painting reference',async()=>{
    for(const colors of [new Float32Array(3),new Float32Array([NaN,0,0,0,0,0,0,0,0]),new Float32Array([1.01,0,0,0,0,0,0,0,0]),new Float32Array([-1,0,0,0,0,0,0,0,0]),Array(9).fill(.5)]){
      const f=fixture(),rec=await f.ctx.keycapLibrary.save({name:'Geometry kept',positions:raw(),sourceColors:colors,sourceColorKind:'vertex'});
      assert.equal(rec.sourceColors,null);assert.ok(rec.positions);
    }
  });
  await test('needs-attention records preserve reasons with no assembled export mesh',async()=>{
    const f=fixture();await f.save('blocked',true);const rec=await f.ctx.keycapLibrary.get('blocked');
    assert.equal(rec.product.positions,null);assert.equal(rec.product.state,'needs-attention');
    assert.deepEqual(plain(rec.product.issues),['Artwork exceeds the usable plate.']);
    assert.ok(rec.positions instanceof Float32Array);
  });
  await test('legacy artwork and model records remain usable without a product',async()=>{
    const f=fixture();for(const kind of ['sculpt','model'])await f.ctx.keycapLibrary.save({id:kind,name:kind,kind,positions:raw()});
    const rows=await f.ctx.keycapLibrary.list();assert.equal(rows.length,2);
    rows.forEach(rec=>assert.equal(rec.product,null));
    assert.equal(await f.ctx.studioLibrary.open('sculpt'),true);
    assert.ok(f.calls.some(c=>c[0]==='edit-source'&&c[1]==='sculpt'));
  });
  await test('saving beyond the old 60-item cap does not silently delete artwork or products',async()=>{
    const f=fixture();await f.save('first');
    for(let i=0;i<62;i++)await f.ctx.keycapLibrary.save({id:'art'+i,name:'Artwork '+i,positions:raw()});
    assert.equal((await f.ctx.keycapLibrary.list()).length,63);assert.ok(f.records.has('first'));
    assert.equal(f.calls.some(c=>c[0]==='delete'),false);
  });
  await test('quota failures are visible and do not delete an existing saved product',async()=>{
    const f=fixture();await f.save();const before=structuredClone(f.records.get('cap'));f.setQuota(true);
    await assert.rejects(f.save('new'),/out of room/);assert.equal(f.records.size,1);
    assert.deepEqual(f.records.get('cap'),before);assert.equal(f.calls.some(c=>c[0]==='delete'),false);
  });
  await test('ready cards show assembled dimensions and fit without eager full mesh reads',async()=>{
    const f=fixture();await f.save();f.calls.length=0;await f.draw();
    const text=f.el('stLibrary').textContent;
    assert.match(text,/Ready to slice/);assert.match(text,/2.0 × 3.0 × 4.0 mm/);assert.match(text,/1.25 mm/);
    assert.match(text,/Export product STL/);assert.doesNotMatch(text,/newest.*60/);
    assert.equal(f.calls.some(c=>c[0]==='get'||c[0]==='blob'),false);
  });
  await test('export retrieves the full product only on click and emits its exact saved print mesh',async()=>{
    const f=fixture();await f.save();await f.draw();f.calls.length=0;
    const button=f.descendants().find(e=>e.textContent==='Export product STL');
    assert.equal(await button.click(),true);assert.equal(button.disabled,false);
    assert.deepEqual(f.calls.filter(c=>c[0]==='get'),[['get','cap']]);
    const blob=f.calls.find(c=>c[0]==='blob')[1],view=new DataView(await blob.arrayBuffer());
    assert.equal(view.getUint32(80,true),4);
    const floats=[];for(let t=0;t<4;t++)for(let k=0;k<9;k++)floats.push(view.getFloat32(84+t*50+12+k*4,true));
    assert.deepEqual(floats,Array.from(f.records.get('cap').product.positions));
    assert.ok(f.calls.some(c=>c[0]==='download'&&c[1]==='Cute _ cap-product.stl'));
    assert.equal(f.calls.some(c=>c[0]==='edit-source'),false);
  });
  await test('tampered product failure is visible and never falls back to raw artwork export',async()=>{
    const f=fixture();await f.save();await f.draw();f.records.get('cap').product.positions[0]=1;
    const button=f.descendants().find(e=>e.textContent==='Export product STL');
    assert.equal(await button.click(),false);assert.equal(button.disabled,false);
    assert.match(f.el('stLibNote').textContent,/Product export failed:/);assert.match(f.el('stLibNote').className,/warn/);
    assert.equal(f.calls.some(c=>c[0]==='blob'||c[0]==='download'),false);
  });
  await test('blocked cards show issues without a misleading export action',async()=>{
    const f=fixture();await f.save('bad',true);await f.draw();
    assert.match(f.el('stLibrary').textContent,/Needs attention/);assert.match(f.el('stLibrary').textContent,/exceeds the usable plate/);
    assert.equal(f.descendants().some(e=>e.textContent==='Export product STL'),false);
  });
  await test('opening a finished keycap still uses its raw-artwork editor restore path',async()=>{
    const f=fixture();await f.save();await f.draw();
    f.descendants().find(e=>e.textContent==='Open in Create').click();await flush();await flush();
    assert.ok(f.calls.some(c=>c[0]==='edit-source'&&c[1]==='cap'));
    assert.deepEqual(f.calls.filter(c=>c[0]==='stage'),[['stage','cap']]);
    assert.equal(f.calls.some(c=>c[0]==='blob'),false);
  });
  await test('double export clicks produce only one file while the first read is pending',async()=>{
    const f=fixture();await f.save();await f.draw();const button=f.descendants().find(e=>e.textContent==='Export product STL');
    const a=button.click(),b=button.click();assert.equal(await b,false);assert.equal(await a,true);
    assert.equal(f.calls.filter(c=>c[0]==='download').length,1);
  });
  console.log(passed+' finished-product Library regression groups passed; no network or printer access.');
})().catch(error=>{console.error(error);process.exitCode=1;});
