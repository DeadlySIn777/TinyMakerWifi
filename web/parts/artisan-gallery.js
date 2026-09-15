/* A reference-photo picker. Selection prepares text inspiration only;
   it never sends a photo or starts a Meshy request. No photos load until open. */
(function(root){
  'use strict';
  function word(value,max){return typeof value==='string'&&value.trim()&&value.length<=max?value.trim():null;}
  function publicHttps(value){
    if(typeof value!=='string'||value.length>2048)return null;
    try{var u=new URL(value),h=u.hostname.toLowerCase();
      return u.protocol==='https:'&&!u.username&&!u.password&&h.indexOf('.')>0&&
        !/^(localhost|\d+\.\d+\.\d+\.\d+)$/.test(h)&&!/\.(local|localhost)$/.test(h)&&h.indexOf(':')<0?u.href:null;
    }catch(e){return null;}
  }
  function validateRecord(r){
    if(!r||typeof r!=='object')return null;
    var out={id:word(r.id,80),title:word(r.title,100),maker:word(r.maker,100),category:word(r.category,50),
      imageUrl:publicHttps(r.imageUrl),sourceUrl:publicHttps(r.sourceUrl),prompt:word(r.prompt,500),
      sculptHeightMm:r.sculptHeightMm,sculptStyle:r.sculptStyle};
    if(!out.id||!out.title||!out.maker||!out.category||!out.imageUrl||!out.sourceUrl||!out.prompt||
      typeof out.sculptHeightMm!=='number'||!Number.isFinite(out.sculptHeightMm)||out.sculptHeightMm<6||out.sculptHeightMm>30||
      (out.sculptStyle!=='cuteartisan'&&out.sculptStyle!=='faithfulsubject'))return null;
    return out;
  }
  function catalog(records){
    var seen=Object.create(null);
    return (Array.isArray(records)?records:[]).map(validateRecord).filter(function(r){
      if(!r||seen[r.id])return false;seen[r.id]=true;return true;
    });
  }
  var active=null;
  function open(options){
    var o=options||{},doc=root.document;
    if(!doc||typeof o.onUse!=='function')return false;
    if(active)active.close();
    var rows=catalog(o.records||root.artisanCatalog),selected=null,buttons=[],prior=doc.activeElement;
    function el(tag,cls,text){var e=doc.createElement(tag);if(cls)e.className=cls;if(text!=null)e.textContent=text;return e;}
    var dialog=el('dialog','agDialog');dialog.setAttribute('aria-labelledby','agTitle');dialog.setAttribute('aria-describedby','agHelp');
    var style=el('style');style.textContent=[
      // Scope layout resets too: the dashboard's global buttons are width:100%.
      '.agDialog{position:fixed;inset:0;margin:auto;background:#101113;color:#eee;border:1px solid #613034;border-radius:18px;padding:0;width:960px;max-width:calc(100vw - 24px);height:min(820px,calc(100vh - 32px));height:min(820px,calc(100dvh - 32px));max-height:calc(100vh - 32px);max-height:calc(100dvh - 32px);overflow:hidden;box-shadow:0 22px 90px #000b;color-scheme:dark;font-size:14px;line-height:1.4}',
      '.agDialog[open]{display:flex;flex-direction:column}.agDialog::backdrop{background:#000b}.agDialog *{box-sizing:border-box}',
      '.agDialog button,.agDialog select,.agDialog input{display:inline-block;width:auto;min-width:0;max-width:100%;height:auto;min-height:38px;margin:0;font:inherit;color:inherit;letter-spacing:normal;text-transform:none;border:1px solid #554248;border-radius:9px;background:#201b1e;padding:9px 12px}',
      '.agDialog button{cursor:pointer;flex:0 0 auto;white-space:nowrap}.agDialog button:disabled{opacity:.4;cursor:default}',
      '.agDialog button:focus-visible,.agDialog a:focus-visible,.agDialog input:focus-visible,.agDialog select:focus-visible{outline:2px solid #ff555d;outline-offset:3px}',
      '.agDialog .agHead,.agDialog .agFilters,.agDialog .agFoot{flex:0 0 auto;min-width:0;width:100%;padding:16px 20px}',
      '.agDialog .agHead{display:flex;gap:16px;align-items:flex-start;border-bottom:1px solid #2d292a}.agDialog .agHead>div{flex:1 1 0;min-width:0}',
      '.agDialog .agHead h2{margin:0 0 7px;font-size:22px;line-height:1.2;min-width:0;color:#eee}.agDialog .agHead p{margin:0;color:#bdb7b8;line-height:1.5;font-size:13px;overflow-wrap:anywhere}',
      '.agDialog .agClose{display:inline-flex;align-items:center;justify-content:center;flex:0 0 auto;width:auto;min-width:64px;margin:0}',
      '.agDialog .agFilters{display:grid;grid-template-columns:minmax(120px,170px) minmax(0,1fr) auto;gap:12px;align-items:end}',
      '.agDialog .agFilters label{display:grid;gap:5px;min-width:0;margin:0;font-size:12px;color:#c9bfc2}.agDialog .agFilters select,.agDialog .agFilters input{width:100%;min-width:0;font-size:13px}.agDialog .agSearch{min-width:0}',
      '.agDialog .agCount{flex:0 0 auto;padding:0 20px 12px;margin:0;color:#aaa;font-size:12px}',
      '.agDialog .agGrid{display:grid;flex:1 1 0;min-height:0;min-width:0;width:100%;grid-template-columns:repeat(auto-fill,minmax(155px,1fr));grid-auto-rows:max-content;gap:12px;align-content:start;align-items:start;padding:0 20px 20px;overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain;scrollbar-gutter:stable}',
      '.agDialog .agCard{display:block;background:#181719;border:1px solid #343033;border-radius:12px;overflow:hidden;min-width:0;width:100%;height:max-content;align-self:start}',
      '.agDialog .agCard .agPick{display:block;border:0;border-radius:0;padding:0;margin:0;min-width:0;min-height:0;width:100%;height:auto;text-align:left;white-space:normal;background:transparent}',
      '.agDialog .agPick[aria-pressed=true]{box-shadow:inset 0 0 0 2px #ff424c}.agDialog .agPick img{display:block;width:100%;height:auto;max-width:100%;aspect-ratio:1;object-fit:cover;background:#211d20}',
      '.agDialog .agPick strong{display:block;padding:10px 10px 6px;font-size:13px;line-height:1.3;overflow-wrap:anywhere;min-width:0}.agDialog .agSource{display:block;padding:0 10px 11px;color:#dc9ca1;font-size:11px;overflow-wrap:anywhere}',
      '.agDialog .agImageError{display:grid;place-items:center;aspect-ratio:1;padding:15px;text-align:center;color:#bbaeb3;font-size:12px}',
      '.agDialog .agFoot{border-top:1px solid #383034;display:flex;gap:16px;align-items:center;background:#171315}.agDialog .agFoot>p{flex:1 1 0;min-width:0;font-size:13px;margin:0;line-height:1.5;overflow-wrap:anywhere}',
      '.agDialog .agFoot .agUse{flex:0 0 auto;width:auto;background:#a61926;border-color:#ff4652;font-weight:700}.agDialog .agEmpty{color:#b9b1b4;padding:20px;grid-column:1/-1}',
      '@media(max-width:600px){.agDialog{border-radius:14px;max-width:calc(100vw - 16px);height:calc(100vh - 16px);height:calc(100dvh - 16px);max-height:calc(100vh - 16px);max-height:calc(100dvh - 16px)}.agDialog .agHead,.agDialog .agFilters,.agDialog .agFoot{padding:12px}.agDialog .agHead{gap:10px}.agDialog .agHead h2{font-size:20px}.agDialog .agHead p{font-size:12px}.agDialog .agFilters{grid-template-columns:minmax(0,1fr) auto;gap:8px}.agDialog .agSearch{grid-column:1/-1;grid-row:2}.agDialog .agCount{padding:0 12px 10px}.agDialog .agGrid{grid-template-columns:repeat(2,minmax(0,1fr));gap:9px;padding:0 12px 12px}.agDialog .agFoot{gap:10px}.agDialog .agFoot>p{font-size:12px}}'
    ].join('');
    dialog.appendChild(style);
    var head=el('div','agHead'),intro=el('div'),title=el('h2',null,'Artisan styles');title.id='agTitle';
    var help=el('p',null,'Reference photo · generation creates new artwork. Use style prepares a text prompt; these photos are not sent to Meshy.');help.id='agHelp';
    intro.appendChild(title);intro.appendChild(help);head.appendChild(intro);
    var closeButton=el('button','agClose','Close');closeButton.type='button';head.appendChild(closeButton);dialog.appendChild(head);
    var filters=el('div','agFilters'),categoryLabel=el('label',null,'Category'),category=el('select');category.setAttribute('aria-label','Style category');
    var all=el('option',null,'All styles');all.value='';category.appendChild(all);
    var categories=[];rows.forEach(function(r){if(categories.indexOf(r.category)<0)categories.push(r.category);});
    categories.sort().forEach(function(c){var opt=el('option',null,c);opt.value=c;category.appendChild(opt);});
    categoryLabel.appendChild(category);filters.appendChild(categoryLabel);
    var searchLabel=el('label','agSearch','Find a style'),search=el('input');search.type='search';search.placeholder='Cat, flower, maker…';search.setAttribute('aria-label','Find an artisan style');searchLabel.appendChild(search);filters.appendChild(searchLabel);
    var clear=el('button',null,'Clear filters');clear.type='button';filters.appendChild(clear);dialog.appendChild(filters);
    var count=el('p','agCount');count.setAttribute('role','status');dialog.appendChild(count);
    var grid=el('div','agGrid');dialog.appendChild(grid);
    var foot=el('div','agFoot'),selection=el('p',null,'Select a reference to prepare your next design.'),use=el('button','agUse','Use style');use.type='button';use.disabled=true;foot.appendChild(selection);foot.appendChild(use);dialog.appendChild(foot);
    selection.setAttribute('role','status');
    function close(){
      if(typeof dialog.close==='function')dialog.close();
      if(dialog.parentNode)dialog.parentNode.removeChild(dialog);
      if(active&&active.dialog===dialog)active=null;
      if(prior&&typeof prior.focus==='function')prior.focus();
    }
    function pick(r){selected=r;use.disabled=false;selection.textContent=r.title+' · '+r.maker+'. Text inspiration only; choose Generate when ready.';
      buttons.forEach(function(b){b.node.setAttribute('aria-pressed',String(b.id===r.id));});
    }
    function draw(){
      while(grid.firstChild)grid.removeChild(grid.firstChild);buttons=[];
      var q=search.value.trim().toLowerCase(),visible=rows.filter(function(r){return (!category.value||category.value===r.category)&&(!q||(r.title+' '+r.maker+' '+r.category).toLowerCase().indexOf(q)>=0);});
      count.textContent=visible.length+' of '+rows.length+' styles';
      if(!visible.length)grid.appendChild(el('p','agEmpty',rows.length?'No matching styles. Clear the filters to see all references.':'Reference photos are not available in this build yet.'));
      visible.forEach(function(r){
        var card=el('article','agCard'),pickButton=el('button','agPick');pickButton.type='button';pickButton.setAttribute('aria-label','Select '+r.title);pickButton.setAttribute('aria-pressed',String(!!selected&&selected.id===r.id));
        var image=el('img');image.alt=r.title+' reference by '+r.maker;image.loading='lazy';image.decoding='async';image.referrerPolicy='no-referrer';
        image.addEventListener('error',function(){if(image.parentNode){var note=el('span','agImageError','Photo unavailable. Open the maker reference below.');image.parentNode.replaceChild(note,image);}});
        image.src=r.imageUrl;pickButton.appendChild(image);pickButton.appendChild(el('strong',null,r.title));
        pickButton.addEventListener('click',function(){pick(r);});buttons.push({id:r.id,node:pickButton});card.appendChild(pickButton);
        var source=el('a','agSource','Reference · '+r.maker);source.href=r.sourceUrl;source.target='_blank';source.rel='noopener noreferrer';source.referrerPolicy='no-referrer';card.appendChild(source);grid.appendChild(card);
      });
    }
    closeButton.addEventListener('click',close);
    dialog.addEventListener('cancel',function(e){e.preventDefault();close();});
    dialog.addEventListener('keydown',function(e){
      if(e.key==='Escape'){e.preventDefault();close();return;}
      if(e.key!=='Tab')return;
      var focusable=Array.prototype.filter.call(dialog.querySelectorAll('button,input,select,a[href]'),function(n){return !n.disabled;});
      var first=focusable[0],last=focusable[focusable.length-1];
      if(e.shiftKey&&doc.activeElement===first){e.preventDefault();last.focus();}
      else if(!e.shiftKey&&doc.activeElement===last){e.preventDefault();first.focus();}
    });
    category.addEventListener('change',draw);search.addEventListener('input',draw);
    clear.addEventListener('click',function(){category.value='';search.value='';draw();search.focus();});
    use.addEventListener('click',function(){if(!selected)return;var record=validateRecord(selected);if(!record)return;close();o.onUse(record);});
    doc.body.appendChild(dialog);active={dialog:dialog,close:close};
    draw();if(typeof dialog.showModal==='function')dialog.showModal();else{dialog.setAttribute('open','');dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');}
    search.focus();return true;
  }
  root.artisanGallery={open:open,validateRecord:validateRecord,catalog:catalog};
  if(typeof module!=='undefined'&&module.exports)module.exports=root.artisanGallery;
})(typeof window!=='undefined'?window:globalThis);
