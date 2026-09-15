/* Keycap card wiring: a keyboard you point at, then three steps.
 *
 * The board is step one because the key you pick already answers three
 * questions - its width, its row, and whether this printer can make it - and
 * answering them by pointing beats answering them in three dropdowns. The
 * shading on the board IS the build volume: solid keys lie flat, dashed keys
 * only fit leaning over with supports, and the spacebar is greyed out because
 * at 118 mm it clears the bed at no angle at all.
 *
 * Kept apart from keycap.js and keycap-icons.js so both stay node-testable.
 * This file is the only part that touches the DOM.
 */
(function () {
  'use strict';
  function $(id) { return document.getElementById(id); }
  if (!$('kcCard') || !window.keycap) return;

  var K = window.keycap, ICO = window.keycapIcons;

  /* ANSI typing keys plus the function row. w is width in units; row is the profile row the key sits in on a
     sculpted set (R1 at the number row down to R4 at the bottom). */
  var LAYOUT = [
    [['Esc',1,'R1'],['F1',1,'R1'],['F2',1,'R1'],['F3',1,'R1'],['F4',1,'R1'],['F5',1,'R1'],['F6',1,'R1'],
     ['F7',1,'R1'],['F8',1,'R1'],['F9',1,'R1'],['F10',1,'R1'],['F11',1,'R1'],['F12',1,'R1']],
    [['`',1,'R1'],['1',1,'R1'],['2',1,'R1'],['3',1,'R1'],['4',1,'R1'],['5',1,'R1'],['6',1,'R1'],
     ['7',1,'R1'],['8',1,'R1'],['9',1,'R1'],['0',1,'R1'],['-',1,'R1'],['=',1,'R1'],['Bksp',2,'R1']],
    [['Tab',1.5,'R2'],['Q',1,'R2'],['W',1,'R2'],['E',1,'R2'],['R',1,'R2'],['T',1,'R2'],['Y',1,'R2'],
     ['U',1,'R2'],['I',1,'R2'],['O',1,'R2'],['P',1,'R2'],['[',1,'R2'],[']',1,'R2'],['\\',1.5,'R2']],
    [['Caps',1.75,'R3'],['A',1,'R3'],['S',1,'R3'],['D',1,'R3'],['F',1,'R3'],['G',1,'R3'],['H',1,'R3'],
     ['J',1,'R3'],['K',1,'R3'],['L',1,'R3'],[';',1,'R3'],["'",1,'R3'],['Enter',2.25,'R3']],
    [['Shift',2.25,'R4'],['Z',1,'R4'],['X',1,'R4'],['C',1,'R4'],['V',1,'R4'],['B',1,'R4'],['N',1,'R4'],
     ['M',1,'R4'],[',',1,'R4'],['.',1,'R4'],['/',1,'R4'],['Shift',2.75,'R4']],
    [['Ctrl',1.25,'R4'],['Win',1.25,'R4'],['Alt',1.25,'R4'],['Space',6.25,'R4'],['Alt',1.25,'R4'],
     ['Win',1.25,'R4'],['Menu',1.25,'R4'],['Ctrl',1.25,'R4']]
  ];

  /* The profile the printer was running tonight. printSim was fitted against
     two real runs on it, so the minutes it reports are measured, not invented -
     but they are for THIS profile. A different resin moves them. */
  var PROFILE_ANY = {
    baseExposure: 35, baseLayers: 6, regularExposure: 14, transitionLayers: 5,
    slowLiftDistance: 1, fastLiftDistance: 2,
    slowLiftFeedrate: 40, fastLiftFeedrate: 50, dropBackFeedrate: 50
  };

  var hero = null;          // the 3D view, attached lazily on first use

  var st = { step: 1, key: null, profile: 'XDA', row: 'R3', sizeU: 1,
             icon: null, digit: '', depth: 0.55, raised: true, plate: [],
             skin: null, skinFrom: '', braille: '', name: '', pose: 'made',
             sculptHeightMm: 19, meshyPolycount: 100000, meshyUltra:false, sculptStyle: 'cuteartisan',
             colorMode:'solid',baseColor:'#f3bdd6',artColor:'#a9dbcc',useSourceColors:true,sourceColors:null,
             art: 'gen' };
  var built = null;

  function say(id, msg, cls) {
    var e = $(id); if (!e) return;
    e.textContent = msg || '';
    e.className = 'hint' + (cls ? ' ' + cls : '');
  }

  // ---- sculpture settings -----------------------------------------------
  // Reference colors never enter the geometry, socket or slicer paths.
  function restoreReference(d){
    st.colorMode=d.colorMode==='color'?'color':'solid';
    st.baseColor=typeof d.baseColor==='string'&&/^#[0-9a-f]{6}$/i.test(d.baseColor)?d.baseColor:'#f3bdd6';
    st.artColor=typeof d.artColor==='string'&&/^#[0-9a-f]{6}$/i.test(d.artColor)?d.artColor:'#a9dbcc';
    st.useSourceColors=d.useSourceColors!==false;
    paintReference();
  }
  function setSourceReference(colors,kind){
    var valid=!!colors&&!!st.sculpt&&colors.length===st.sculpt.length;
    if(valid)for(var i=0;i<colors.length;i++)if(!Number.isFinite(colors[i])||colors[i]<0||colors[i]>1){valid=false;break;}
    st.sourceColors=valid?new Float32Array(colors):null;
    st.sourceColorKind=valid?String(kind||'material'):null;
    st.seatedColors=null;
    if(valid){
      st.seatedColors=new Float32Array(colors.length);
      // seat() reverses each art triangle after its Z reflection.
      var order=[0,2,1];
      for(var t=0;t<colors.length;t+=9)for(var k=0;k<3;k++)for(var a=0;a<3;a++)
        st.seatedColors[t+k*3+a]=colors[t+order[k]*3+a];
    }
    paintReference();
  }
  function paintReference(){
    if($('kcColorMode')&&$('kcColorMode').querySelectorAll)Array.prototype.forEach.call($('kcColorMode').querySelectorAll('button'),function(b){var on=b.getAttribute('data-color-mode')===(st.colorMode||'solid');b.classList.toggle('on',on);b.setAttribute('aria-pressed',String(on));});
    if($('kcColorOptions'))$('kcColorOptions').hidden=st.colorMode!=='color';
    if($('kcBaseColor'))$('kcBaseColor').value=st.baseColor||'#f3bdd6';
    if($('kcArtColor')){$('kcArtColor').value=st.artColor||'#a9dbcc';$('kcArtColor').disabled=!!st.sourceColors&&st.useSourceColors!==false;}
    if($('kcSourceColorWrap'))$('kcSourceColorWrap').hidden=!st.sourceColors;
    if($('kcSourceColors'))$('kcSourceColors').checked=st.useSourceColors!==false;
    say('kcColorSource',st.sourceColors&&st.useSourceColors!==false?(st.sourceColorKind==='partial'?'Some source colors unavailable · partial reference':'Original model colors · painting reference'):'Custom swatches · painting reference');
  }
  function referenceChanged(){paintReference();rememberSession();drawHero();paintProductState();}
  function bindReference(){
    $('kcColorMode')&&Array.prototype.forEach.call($('kcColorMode').querySelectorAll('button'),function(b){b.addEventListener('click',function(){st.colorMode=b.getAttribute('data-color-mode');referenceChanged();});});
    ['kcBaseColor','kcArtColor'].forEach(function(id){$(id)&&$(id).addEventListener('input',function(){st[id==='kcBaseColor'?'baseColor':'artColor']=this.value;referenceChanged();});});
    $('kcSourceColors')&&$('kcSourceColors').addEventListener('change',function(){st.useSourceColors=this.checked;referenceChanged();});
  }
  function parsedReference(parsed){
    return window.keycapColor?window.keycapColor.fromGLB(parsed):Promise.resolve({colors:null,kind:'none'});
  }

  var artisanStyleDraft=null,artisanPromptBefore='',artisanDraftStorageNote='';
  var ARTISAN_DRAFT_STORE='tmArtisanStyleDraftV1';
  function knownSculptHeight(v) {return typeof v==='number'&&Number.isFinite(v)&&v>=6&&v<=30;}
  function sculptureHeight() {
    if(knownSculptHeight(st.sculptHeightMm))return st.sculptHeightMm;
    // Old saved designs did not have a sculpture height. Reopen them at the
    // same depth-derived height until the owner explicitly moves this slider.
    return Math.max(6,Math.min(30,st.depth>1?st.depth*5:13));
  }
  function restoreSculptSettings(d,strict) {
    var h=d.sculptHeightMm,p=d.meshyPolycount,s=d.sculptStyle;
    if(strict&&d.meshyUltra!=null&&typeof d.meshyUltra!=='boolean')throw new Error('Enhanced sculpt detail must be on or off.');
    st.meshyUltra=d.meshyUltra===true;
    if(strict&&h!=null&&!knownSculptHeight(h))throw new Error('Sculpture height must be 6–30 mm.');
    if(strict&&p!=null&&p!==30000&&p!==100000)throw new Error('Meshy detail must be 30k or 100k.');
    if(strict&&s!=null&&s!=='cuteartisan'&&s!=='faithfulsubject')throw new Error('Choose Cute artisan or Faithful subject.');
    st.sculptHeightMm=knownSculptHeight(h)?h:null;
    st.meshyPolycount=p===100000?100000:30000;
    st.sculptStyle=s==='faithfulsubject'?'faithfulsubject':'cuteartisan';
    var rotation=d.sculptRotationDeg,size=d.sculptScalePercent;
    if(strict&&rotation!=null&&!(typeof rotation==='number'&&Number.isFinite(rotation)&&rotation>=0&&rotation<=360))throw new Error('Artwork rotation must be between 0 and 360 degrees.');
    if(strict&&size!=null&&!(typeof size==='number'&&Number.isFinite(size)&&size>=50&&size<=100))throw new Error('Artwork size must be between 50 and 100 percent.');
    st.sculptRotationDeg=typeof rotation==='number'&&Number.isFinite(rotation)&&rotation>=0&&rotation<=360?rotation%360:0;
    st.sculptScalePercent=typeof size==='number'&&Number.isFinite(size)&&size>=50&&size<=100?size:100;
  }
  function paintSculptSettings() {
    var h=artisanStyleDraft?artisanStyleDraft.sculptHeightMm:sculptureHeight();
    if($('kcSculptHeight'))$('kcSculptHeight').value=String(h);
    if($('kcSculptHeightVal'))$('kcSculptHeightVal').textContent=h.toFixed(1).replace(/\.0$/,'')+' mm';
    if($('kcMeshyDetail'))$('kcMeshyDetail').value=String(artisanStyleDraft?artisanStyleDraft.meshyPolycount:(st.meshyPolycount||30000));
    if($('kcMeshyUltra'))$('kcMeshyUltra').checked=st.meshyUltra===true;
    if($('kcSculptStyle'))$('kcSculptStyle').value=artisanStyleDraft?artisanStyleDraft.sculptStyle:(st.sculptStyle||'cuteartisan');
    if($('kcSculptRotation'))$('kcSculptRotation').value=String(st.sculptRotationDeg||0);
    if($('kcSculptRotationValue'))$('kcSculptRotationValue').textContent=(st.sculptRotationDeg||0)+'°';
    if($('kcSculptSize'))$('kcSculptSize').value=String(st.sculptScalePercent||100);
    if($('kcSculptSizeValue'))$('kcSculptSizeValue').textContent=(st.sculptScalePercent||100)+'%';
  }
  function bindSculptSettings() {
    if($('kcMeshyUltra'))$('kcMeshyUltra').addEventListener('change',function(){st.meshyUltra=this.checked===true;rememberSession();paintProductState();});
    if($('kcSculptFill'))$('kcSculptFill').addEventListener('click',function(){
      if(!st.sculpt||artisanStyleDraft)return;
      st.sculptHeightMm=30;st.sculptScalePercent=100;st.plate=[];
      paintSculptSettings();rememberSession();refresh();
    });
    if($('kcSculptRotation'))$('kcSculptRotation').addEventListener('input',function(){
      var n=Number(this.value);if(!Number.isFinite(n)||n<0||n>360)return;
      st.sculptRotationDeg=n%360;st.plate=[];paintSculptSettings();refresh();
    });
    if($('kcSculptSize'))$('kcSculptSize').addEventListener('input',function(){
      var n=Number(this.value);if(!Number.isFinite(n)||n<50||n>100)return;
      st.sculptScalePercent=n;st.plate=[];paintSculptSettings();refresh();
    });
    if($('kcSculptHeight'))$('kcSculptHeight').addEventListener('input',function(){
      var h=Number(this.value);if(!knownSculptHeight(h)){paintSculptSettings();return;}
      if(artisanStyleDraft){artisanStyleDraft.sculptHeightMm=h;paintSculptSettings();rememberArtisanStyleDraft();paintArtisanStyleDraft();return;}
      st.sculptHeightMm=h;paintSculptSettings();rememberSession();refresh();
    });
    if($('kcMeshyDetail'))$('kcMeshyDetail').addEventListener('change',function(){
      var p=Number(this.value);if(p!==30000&&p!==100000){paintSculptSettings();return;}
      if(artisanStyleDraft){artisanStyleDraft.meshyPolycount=p;rememberArtisanStyleDraft();paintArtisanStyleDraft();return;}
      st.meshyPolycount=p;rememberSession();paintProductState();
    });
    if($('kcSculptStyle'))$('kcSculptStyle').addEventListener('change',function(){
      if(this.value!=='cuteartisan'&&this.value!=='faithfulsubject'){paintSculptSettings();return;}
      if(artisanStyleDraft){artisanStyleDraft.sculptStyle=this.value;rememberArtisanStyleDraft();paintArtisanStyleDraft();return;}
      st.sculptStyle=this.value;rememberSession();paintProductState();
    });
    paintSculptSettings();
  }

  function paintSculptMeasurements() {
    var e=$('kcSculptMeasured');if(!e)return;
    var s=built&&built.seated;
    if(!st.sculpt||!s){e.textContent='';return;}
    var m=s.sculptMm,env=capSpec();
    e.textContent='Actual artwork: '+m.x.toFixed(1)+' × '+m.y.toFixed(1)+' × '+m.z.toFixed(1)+' mm';
  }

  // A style is a next-generation draft, never a replacement for a loaded mesh.
  function paintArtisanStyleDraft(){
    if($('kcStyleDraft'))$('kcStyleDraft').hidden=!artisanStyleDraft;
    if($('kcPlacement'))$('kcPlacement').hidden=!st.sculpt||!!artisanStyleDraft;
    if(!artisanStyleDraft)return;
    say('kcStyleDraftNote','Draft: '+artisanStyleDraft.title+' · '+artisanStyleDraft.sculptHeightMm+' mm artwork · '+
      (artisanStyleDraft.meshyPolycount===100000?'Fine 100k':'Standard 30k')+' · no lettering. Reference by '+artisanStyleDraft.maker+
      '. Text inspiration only; the photo is not sent to Meshy. Current artwork stays until a new generation succeeds.'+artisanDraftStorageNote);
  }
  function rememberArtisanStyleDraft(){
    if(!artisanStyleDraft)return;
    try {
      localStorage.setItem(ARTISAN_DRAFT_STORE,JSON.stringify({version:1,id:artisanStyleDraft.id,
        prompt:String($('kcPrompt').value||'').slice(0,500),sculptHeightMm:artisanStyleDraft.sculptHeightMm,
        meshyPolycount:artisanStyleDraft.meshyPolycount,sculptStyle:artisanStyleDraft.sculptStyle,
        previousPrompt:artisanPromptBefore.slice(0,500)}));
      artisanDraftStorageNote='';
    }catch(e){artisanDraftStorageNote=' Browser storage is unavailable; this draft will not survive a reload.';}
  }
  function restoreArtisanStyleDraft(){
    var d;
    try{d=JSON.parse(localStorage.getItem(ARTISAN_DRAFT_STORE)||'null');}catch(e){return;}
    if(!d)return;
    var refs=Array.isArray(window.artisanCatalog)?window.artisanCatalog:[],record=null;
    for(var i=0;i<refs.length;i++)if(refs[i].id===d.id){record=refs[i];break;}
    if(!record||d.version!==1||typeof d.prompt!=='string'||d.prompt.length>500||!d.prompt.trim()||
      !knownSculptHeight(d.sculptHeightMm)||(d.meshyPolycount!==30000&&d.meshyPolycount!==100000)||
      (d.sculptStyle!=='cuteartisan'&&d.sculptStyle!=='faithfulsubject'))return;
    var restored=Object.assign({},record,{prompt:d.prompt,sculptHeightMm:d.sculptHeightMm,sculptStyle:d.sculptStyle});
    if(!applyArtisanStyleDraft(restored))return;
    artisanStyleDraft.meshyPolycount=d.meshyPolycount;
    if(typeof d.previousPrompt==='string'&&d.previousPrompt.length<=500)artisanPromptBefore=d.previousPrompt;
    rememberArtisanStyleDraft();paintSculptSettings();paintArtisanStyleDraft();
  }
  function cancelArtisanStyleDraft(restorePrompt){
    if(!artisanStyleDraft)return;
    if(restorePrompt&&$('kcPrompt'))$('kcPrompt').value=artisanPromptBefore;
    artisanStyleDraft=null;artisanPromptBefore='';artisanDraftStorageNote='';
    try{localStorage.removeItem(ARTISAN_DRAFT_STORE);}catch(e){say('kcGenNote','Draft closed for this page, but browser storage could not be cleared. It may return after a reload.','warn');}
    paintArtisanStyleDraft();paintSculptSettings();
  }
  function applyArtisanStyleDraft(record){
    if($('kcGen')&&$('kcGen').disabled)return false;
    var r=window.artisanGallery&&window.artisanGallery.validateRecord(record);
    if(!r){say('kcGenNote','That style reference is unavailable.','bad');return false;}
    try {
      var envelope=capSpec();if(!envelope)throw new Error('Choose a key and profile first.');
      envelope.hMm=r.sculptHeightMm;
      window.keycapSkin.promptFor(r.prompt,null,'sculpt',envelope,r.sculptStyle);
    }catch(e){say('kcGenNote',e.message,'bad');return false;}
    if(!artisanStyleDraft)artisanPromptBefore=$('kcPrompt').value||'';
    r.meshyPolycount=100000;artisanStyleDraft=r;
    $('kcPrompt').value=r.prompt;rememberArtisanStyleDraft();paintSculptSettings();paintArtisanStyleDraft();
    return true;
  }
  function bindArtisanGallery(){
    if($('kcBrowseStyles'))$('kcBrowseStyles').addEventListener('click',function(){
      if(!window.artisanGallery){say('kcGenNote','Style references are unavailable in this build.','bad');return;}
      window.artisanGallery.open({onUse:applyArtisanStyleDraft});
    });
    if($('kcStyleDraftCancel'))$('kcStyleDraftCancel').addEventListener('click',function(){cancelArtisanStyleDraft(true);});
    if($('kcPrompt'))$('kcPrompt').addEventListener('input',function(){rememberSession();if(artisanStyleDraft){rememberArtisanStyleDraft();paintArtisanStyleDraft();}});
  }

  // ---- local stem fit preference -----------------------------------------
  // Fit belongs to this printer/resin/browser, not to an imported design.
  var STEM_FIT_KEY = 'tmKeycapStemFitV1';
  var stemFitPlateNotice = '';
  function boundedStemFit(value) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return K.MX.slotClearance;
    return Math.round(Math.max(0,Math.min(.30,value))*100)/100;
  }
  function readStemFit() {
    try {
      var saved=JSON.parse(localStorage.getItem(STEM_FIT_KEY));
      return saved&&saved.version===1 ? boundedStemFit(saved.slotClearance) : K.MX.slotClearance;
    } catch(e) {return K.MX.slotClearance;}
  }
  var stemFitClearance = readStemFit();
  function stemFitMx() {return {slotClearance:stemFitClearance};}
  function paintStemFit() {
    var mm=K.MX.crossWide+stemFitClearance,slider=$('kcStemFit');
    if(slider){slider.value=mm.toFixed(2);slider.setAttribute('aria-valuetext',mm.toFixed(2)+' millimetre socket');}
    if($('kcStemFitValue'))$('kcStemFitValue').textContent=mm.toFixed(2)+' mm';
    if($('kcFitTight'))$('kcFitTight').disabled=stemFitClearance>=.30;
    if($('kcFitLoose'))$('kcFitLoose').disabled=stemFitClearance<=0;
  }
  function applyStemFit(clearance, reason) {
    if(typeof clearance!=='number'||!Number.isFinite(clearance)) {
      say('kcFitNote','Choose a socket width from 1.15 to 1.45 mm.','bad');paintStemFit();return false;
    }
    var next=boundedStemFit(clearance),changed=next!==stemFitClearance,saved=true;
    stemFitClearance=next;
    try {localStorage.setItem(STEM_FIT_KEY,JSON.stringify({version:1,slotClearance:next}));}
    catch(e){saved=false;}
    if(changed) {
      if(st.plate.length)stemFitPlateNotice='Plate cleared after the fit change. Add caps again to use the new socket size.';
      st.plate=[];checkedEntries=new WeakMap(); // invalidate pending async handoffs too
      say('kcPlate',stemFitPlateNotice,'warn');
      refresh();
    }
    paintStemFit();
    say('kcFitNote',(reason?reason+' ':'')+'Socket '+(K.MX.crossWide+next).toFixed(2)+' mm. '+
      (saved?'Remembered in this browser.':'Set for this page; browser storage is unavailable, so it will not survive a reload.')+
      (changed&&stemFitPlateNotice?' Plate cleared; add caps again.':''),saved?'':'warn');
    return true;
  }
  function bindStemFit() {
    if($('kcStemFit'))$('kcStemFit').addEventListener('input',function(){
      applyStemFit(Number(this.value)-K.MX.crossWide,'Fit adjusted.');
    });
    if($('kcFitTight'))$('kcFitTight').addEventListener('click',function(){
      applyStemFit(stemFitClearance+.02,'Too tight: the next socket will be wider.');
    });
    if($('kcFitLoose'))$('kcFitLoose').addEventListener('click',function(){
      applyStemFit(stemFitClearance-.02,'Too loose: the next socket will be narrower.');
    });
    if($('kcFitCoupon'))$('kcFitCoupon').addEventListener('change',function(){
      if($('kcApplyCoupon'))$('kcApplyCoupon').disabled=!this.value;
    });
    if($('kcApplyCoupon'))$('kcApplyCoupon').addEventListener('click',function(){
      var choice=$('kcFitCoupon')&&$('kcFitCoupon').value;
      if(!/^(1\.15|1\.20|1\.25|1\.30|1\.35)$/.test(choice||'')) {
        say('kcFitNote','Choose the coupon that fits your switch before applying it.','bad');return;
      }
      applyStemFit(Number(choice)-K.MX.crossWide,'Best-fitting coupon applied.');
    });
    paintStemFit();
  }

  // ---- step 1: the board --------------------------------------------------
  /* Widths are flex units, not pixels: a row of widths summing to 15u fills
     whatever width the card has, at any size, with no arithmetic and no media
     queries. The label lives in a span because the cap's top face is a
     pseudo-element underneath it. */
  function drawBoard() {
    var el = $('kcBoard'); if (!el) return;
    el.innerHTML = '';
    LAYOUT.forEach(function (row, rowIndex) {
      var r = document.createElement('div');
      r.className = 'kcRow' + (rowIndex === 0 ? ' kcFunctionRow' : '');
      row.forEach(function (k) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'kcKey';
        b.style.setProperty('--u', k[1]);
        var lab = document.createElement('span');
        var fit = K.fits(K.capWidth(k[1]), K.DEPTH, 9);
        if (!fit.ok) {
          b.classList.add('no'); b.disabled = true; b.title = fit.why;
          /* No cap at all - an empty socket. The label states the reason in
             the gap where the cap should be. */
          lab.textContent = Math.round(K.capWidth(k[1])) + ' mm';
        } else {
          lab.textContent = k[0];
          if (fit.tilt) { b.classList.add('tilt'); b.title = k[1] + 'u - ' + fit.why; }
          else b.title = k[1] + 'u, ' + K.capWidth(k[1]).toFixed(1) + ' mm - prints flat, no supports';
        }
        b.appendChild(lab);
        /* ⚠️ THE RESTORED KEY WAS NEVER SHOWN AS PICKED. `sel` is added only by
           pickKey, which only a click calls, so after a reload the session had
           st.key = ';' and the board showed nothing selected at all - the owner
           could not see which key the cap on screen was for, and clicking the
           one that was already chosen looked like it did something. The key is
           its label and its width together: 'Shift' appears twice on a board at
           two different widths. */
        if (fit.ok && st.key === k[0] && st.sizeU === k[1] && (K.PROFILES[st.profile].uniform || st.row === k[2]))
          b.classList.add('sel');
        b.addEventListener('click', function () { pickKey(k, b); });
        r.appendChild(b);
      });
      el.appendChild(r);
    });
    caliper(st.sizeU);
  }

  /* The jaws open to the share of the bed this cap eats, so the tool answers
     the question the bed actually asks. */
  function caliper(sizeU) {
    var cal = $('kcCal'); if (!cal) return;
    var w = K.capWidth(sizeU);
    var fit = K.fits(w, K.DEPTH, 9);
    var used = fit.ok && fit.foot ? fit.foot.x : w;
    cal.style.setProperty('--jaw', Math.max(0.06, Math.min(1, used / K.BED.x)).toFixed(3));
    var v = $('kcJawVal');
    if (v) v.textContent = fit.ok && fit.tilt
      ? used.toFixed(1) + ' mm leaning'
      : w.toFixed(2) + ' mm';
  }

  function pickKey(k, btn) {
    Array.prototype.forEach.call($('kcBoard').querySelectorAll('.kcKey'),
      function (e) { e.classList.remove('sel'); });
    btn.classList.add('sel');
    st.key = k[0]; st.sizeU = k[1]; st.row = k[2];
    caliper(st.sizeU);
    /* THE BOARD ALREADY KNOWS WHAT IS ON THE KEY. This only claimed the
       digits, so picking Q or ; or / left the legend blank and the owner had to
       type the character they had just pointed at. Every single-character key
       carries its own label now; the named ones (Shift, Enter, Tab) stay blank
       because the legend field is one character and a word does not fit - those
       want the skirt treatment, which is a separate job. */
    st.digit = (k[0] && k[0].length === 1 && k[0] !== ' ') ? k[0] : '';
    if ($('kcDigit')) $('kcDigit').value = st.digit;
    paintLegendRow();
    if (K.PROFILES[st.profile].uniform) st.row = Object.keys(K.PROFILES[st.profile].rows)[0];
    go(2);
  }

  // ---- steps -------------------------------------------------------------
  function go(n) {
    st.step = n;
    Array.prototype.forEach.call($('kcSteps').children, function (li) {
      var s = +li.getAttribute('data-step');
      li.classList.toggle('on', s === n);
      li.classList.toggle('done', s < n);
      li.setAttribute('aria-current',s === n ? 'step' : 'false');
    });
    Array.prototype.forEach.call($('kcCard').querySelectorAll('.kcPane'), function (p) {
      p.hidden = p.getAttribute('data-pane').split(' ').indexOf(String(n)) < 0;
    });
    Array.prototype.forEach.call($('kcCard').querySelectorAll('.kcGroup'), function (g) {
      g.hidden = g.getAttribute('data-for') !== String(n);
    });
    $('kcCard').classList.toggle('kcStep1', n === 1);
    /* ⚠️ "Done" USED TO DO NOTHING. go() renamed the button at step 4 and the
       handler guarded on st.step < 4, so the biggest, reddest control on the
       card fell through every branch: nothing saved, nothing confirmed, no
       message. A first-time owner finishing the wizard pressed it and the card
       sat there. The last step's forward action is the one the step is FOR. */
    $('kcNext').textContent = n >= 4 ? 'Send to slicer' : 'Next';
    $('kcBack').disabled = n === 1;
    /* Every step now, not just from 2. The stage is on screen at step 1 and an
       empty stage beside a keyboard is worse than no stage - the whole reason
       for moving the board here was so the cap is visible while you choose. */
    refresh();
  }

  // ---- tiles -------------------------------------------------------------
  function tiles(host, items, isOn, onPick) {
    var el = $(host); if (!el) return;
    el.innerHTML = '';
    items.forEach(function (it) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'kcTile' + (isOn(it) ? ' on' : '');
      b.innerHTML = it.sub ? (it.label + '<small>' + it.sub + '</small>') : it.label;
      if (it.title) b.title = it.title;
      b.addEventListener('click', function () { onPick(it); });
      el.appendChild(b);
    });
  }

  function drawProfiles() {
    tiles('kcProfiles', Object.keys(K.PROFILES).filter(function (p) {
      return !K.PROFILES[p].hidden;      // the stem coupon is not a keycap
    }).map(function (p) {
      var pr = K.PROFILES[p], rows = Object.keys(pr.rows);
      var h = pr.rows[rows[0]].h;
      return { id: p, label: p, sub: pr.uniform ? 'uniform' : rows.length + ' rows',
               title: pr.note };
    }), function (it) { return it.id === st.profile; }, function (it) {
      st.profile = it.id;
      var pr = K.PROFILES[it.id];
      if (!pr.rows[st.row]) st.row = Object.keys(pr.rows)[0];
      drawProfiles(); drawRows(); refresh();
    });
    say('kcProfileNote', K.PROFILES[st.profile].note);
  }

  function drawRows() {
    var pr = K.PROFILES[st.profile], rows = Object.keys(pr.rows);
    tiles('kcRows', rows.map(function (r) {
      return { id: r, label: r, sub: pr.rows[r].h + ' mm',
               title: pr.rows[r].angle + '° tilt, ' + pr.rows[r].h + ' mm at the front edge' };
    }), function (it) { return it.id === st.row; }, function (it) {
      st.row = it.id; drawRows(); refresh();
    });
  }

  /* ---- what you had open, kept across a reload -------------------------
     "the prints it generates, I refresh and they disappear". The Library keeps
     every generation, but the design actually ON the cap lived in a variable
     and went with the page. Only the small stuff goes in localStorage - the
     mesh itself is already in IndexedDB under libId, so this is a pointer plus
     a handful of settings, not a megabyte. */
  var SESSION = 'tmKeycapSession';
  function rememberSession() {
    try {
      localStorage.setItem(SESSION, JSON.stringify({
        key: st.key, sizeU: st.sizeU, profile: st.profile, row: st.row,
        art: st.art, icon: st.icon, digit: st.digit, braille: st.braille,
        depth: st.depth, raised: st.raised, touchedFinish: !!st.touchedFinish,
        sculptHeightMm: st.sculptHeightMm, meshyPolycount: st.meshyPolycount, meshyUltra:st.meshyUltra===true, sculptStyle: st.sculptStyle,
        sculptRotationDeg: st.sculptRotationDeg||0, sculptScalePercent: st.sculptScalePercent||100,
        colorMode:st.colorMode,baseColor:st.baseColor,artColor:st.artColor,useSourceColors:st.useSourceColors!==false,
        libId: st.libId || null, prompt: st.skinFrom || '', step: st.step,
        promptDraft: $('kcPrompt') ? String($('kcPrompt').value||'').slice(0,500) : '',
        name: typeof st.name === 'string' ? st.name.slice(0, 120) : '',
        legendOn: st.legendOn !== false
      }));
    } catch (e) { /* private window, or storage off - not worth a message */ }
  }
  /* ---- names that came from outside -------------------------------------
     A profile name reaches this module from three places that are all outside
     our control: the saved session, a share code somebody sent, and the URL.
     PROFILES is an object literal, so `PROFILES[name]` is TRUTHY for
     "constructor", "toString", "valueOf", "hasOwnProperty" and "__proto__" -
     and the next line then reads .rows off the Object constructor and throws.
     Truthiness is not a membership test on a plain object; hasOwnProperty is.

     Hidden profiles are rejected here as well. PROFILES.TEST is the stem fit
     coupon - an 11 mm block, not a keycap - and it is not a choice a design is
     allowed to name. */
  var OWN = Object.prototype.hasOwnProperty;
  function knownProfile(name) {
    return typeof name === 'string' && OWN.call(K.PROFILES, name) &&
           K.PROFILES[name] && K.PROFILES[name].rows && !K.PROFILES[name].hidden
           ? name : null;
  }
  function knownRow(profile, name) {
    var pr = K.PROFILES[profile];
    if (!pr || !pr.rows) return null;
    return typeof name === 'string' && OWN.call(pr.rows, name) ? name
         : Object.keys(pr.rows)[0];
  }

  /* What a key label is allowed to be. Not an escape - a whitelist: the value
     is a legend off a keyboard ("5", "Shift", ";"), and anything that is not
     that is not a key label whatever else it might be. Escaping asks every
     future sink to remember; this makes the value safe once. */
  /* The width of a key in units. 1 to 7 covers 1u through the 6.25u spacebar
     with room to spare, and anything else is not a key width. */
  function knownSizeU(v, fallback) {
    var u = Number(v);
    return (isFinite(u) && u >= 1 && u <= 7) ? u : (fallback == null ? 1 : fallback);
  }

  function safeKeyLabel(v) {
    if (typeof v !== 'string') return null;
    var t = v.trim().slice(0, 12);
    return /^[A-Za-z0-9 _\-+=\[\]\\;',./`~!@#$%^&*()<>?:"{}|]*$/.test(t) && t ? t : null;
  }

  var restoredStep = 1;

  function restoreSession() {
    var raw;
    try { raw = localStorage.getItem(SESSION); } catch (e) { return; }
    if (!raw) return;
    var d;
    try { d = JSON.parse(raw); } catch (e) { return; }
    var p = d && knownProfile(d.profile);
    if (!p) return;
    st.profile = p;
    st.row = knownRow(p, d.row);
    st.sizeU = d.sizeU || 1;
    /* A SHARE CODE IS SOMEBODY ELSE'S TEXT, and this one lands in innerHTML by
       way of report(). d.profile and d.row have always gone through
       knownProfile()/knownRow(); d.key went through nothing, and
       rememberSession then persisted it so it survived reloads and re-fired.
       This origin holds the Meshy key and can start prints. A key label is a
       keyboard legend - a handful of printable characters - so say so. */
    st.key = safeKeyLabel(d.key);
    /* setArt() has already run once by now with the default 'gen', and it is
       the only thing that paints the mode row and the [data-art] panels. Taking
       st.art from storage without repainting leaves the state and the buttons
       permanently disagreeing - and because refreshNow() writes the session
       back, the mismatched pair is saved again and never heals. paintArt, not
       setArt: the full one would re-apply the mode defaults over the depth and
       finish this session is restoring. */
    st.art = d.art || 'gen';
    st.legendOn = d.legendOn !== false;
    setTimeout(function () { try { paintLegendRow(); } catch (e) {} }, 0);
    st.icon = d.icon || null;
    st.digit = d.digit || '';
    st.braille = d.braille || '';
    st.depth = d.depth || st.depth;
    restoreSculptSettings(d,false);paintSculptSettings();
    restoreReference(d);
    st.raised = d.raised !== false;
    st.touchedFinish = !!d.touchedFinish;
    st.skinFrom = d.prompt || '';
    st.name = typeof d.name === 'string' ? d.name.slice(0, 120) : '';
    st.libId = d.libId || null;
    if ($('kcDigit')) $('kcDigit').value = st.digit;
    if ($('kcBraille')) $('kcBraille').value = st.braille;
    if ($('kcPrompt')) $('kcPrompt').value = typeof d.promptDraft === 'string' ? d.promptDraft.slice(0,500) : (st.skinFrom||'');
    if ($('kcDepth')) $('kcDepth').value = st.depth;
    if ($('kcDepthVal')) $('kcDepthVal').textContent = st.depth.toFixed(2);
    /* The model comes back from IndexedDB, so a generated design survives a
       reload without spending another generation. */
    /* ⚠️ AND ONLY WHEN THE ART IS STILL THE GENERATED KIND. st.libId is a
       pointer to a mesh; every path that removes the mesh now clears it (see
       dropSculpt), but a session written by an OLDER build can still hold a
       libId next to art:'braille', and re-hydrating from it would put the
       figure back on top of the dots - which is the bug, arriving by a
       different door. The stored art wins. */
    if (st.libId && st.art !== 'gen') st.libId = null;
    if (st.libId && window.keycapLibrary) {
      var restoringId=st.libId,restoringSource=st.sculpt;
      function stillRestoring(){return st.libId===restoringId&&st.sculpt===restoringSource&&st.art==='gen';}
      window.keycapLibrary.get(restoringId).then(function (rec) {
        if(!stillRestoring())return; // A Clear, import or Library selection wins over a late read.
        if (rec && rec.positions) { st.sculpt = rec.positions;setSourceReference(rec.sourceColors,rec.sourceColorKind);rememberLoadedProduct(rec);refresh(); }
        else st.libId = null;
      }).catch(function () { if(stillRestoring())st.libId = null; });
    }
    /* ⚠️ DO NOT go() HERE. The board and the tiles do not exist yet -
       restoreSession runs before drawBoard - and initialisation ends with an
       unconditional go(1) a few lines from the bottom of this file, which
       overwrote whatever this chose AND then destroyed it: go(1) sets
       st.step = 1 and schedules rememberSession, so the stored value could
       never be used on any later load either. Hand the step back and let the
       initialiser apply it once everything is drawn. */
    restoredStep = (d.step > 1 && st.key) ? d.step : 1;
    refresh();
  }

  // ---- the shelf ---------------------------------------------------------
  /* What the seated cap measures, or null if there is no cap yet. */
  function capFacts() {
    if (!built) return null;
    try {
      var plan = built.printPlan || {};
      return { sizeMm: [+built.size.x.toFixed(2), +built.size.y.toFixed(2),
                        +built.size.z.toFixed(2)],
               resinMl: +K.costOf(built).resinMl.toFixed(2),
               profile: st.profile, row: st.row, sizeU: st.sizeU,
               tilt: plan.tilt || 0, fits: plan.ok !== false };
    } catch (e) { return null; }
  }

  var sculptSaves = new WeakMap(),lastSavedProduct=null;
  var sculptDeliveries = new WeakMap();
  var sculptLoadSerial=0;
  function nextSculptLoad(){sculptLoadSerial=(sculptLoadSerial||0)+1;return sculptLoadSerial;}
  function productRecipeKey(recipe){
    // Color reference was added after existing products were saved. Compare
    // their missing display defaults without rewriting the physical snapshot
    // or its signed recipe. Malformed/noncanonical/future codes stay distinct.
    try{
      var share=window.keycapShare;if(!share||typeof share.decode!=='function')return recipe;
      var d=share.decode(recipe);if(share.encode(d)!==recipe)return recipe;
      if(d.colorMode===undefined)d.colorMode='solid';
      if(d.baseColor===undefined)d.baseColor='#f3bdd6';
      if(d.artColor===undefined)d.artColor='#a9dbcc';
      if(d.useSourceColors===undefined)d.useSourceColors=true;
      return share.encode(d);
    }catch(e){return recipe;}
  }
  function rememberLoadedProduct(rec){
    var p=rec&&rec.product;
    lastSavedProduct=p&&typeof p.recipe==='string'&&p.fit&&typeof p.fit.slotMm==='number'&&Number.isFinite(p.fit.slotMm)?
      {source:st.sculpt,key:productRecipeKey(p.recipe)+'|'+p.fit.slotMm.toFixed(2),product:p}:null;
  }
  function currentProductKey(recipe){
    return productRecipeKey(recipe)+'|'+(K.MX.crossWide+stemFitClearance).toFixed(2);
  }
  function sameSculptSnapshot(source,positions){
    if(!source||!positions||source.length!==positions.length)return false;
    for(var i=0;i<positions.length;i++)if(source[i]!==positions[i])return false;
    return true;
  }
  function adoptSavedProduct(source,key,positions,rec,product){
    if(st.sculpt!==source||!rec||!rec.id||!sameSculptSnapshot(source,positions))return false;
    try{if(currentProductKey(window.keycapShare.encode(designOf()))!==key)return false;}
    catch(e){return false;}
    st.libId=rec.id;lastSavedProduct={source:source,key:key,product:product};
    rememberSession();paintProductState();
    return true;
  }
  function paintProductState(){
    var panel=$('kcProductPanel');if(!panel)return;
    panel.hidden=!st.sculpt;
    if($('kcPlacement'))$('kcPlacement').hidden=!st.sculpt||!!artisanStyleDraft;
    if(!st.sculpt)return;
    var current=false;
    try{current=!!lastSavedProduct&&lastSavedProduct.source===st.sculpt&&lastSavedProduct.key===currentProductKey(window.keycapShare.encode(designOf()));}catch(e){}
    var p=current&&lastSavedProduct.product;
    var title=$('kcProductName');if(title&&document.activeElement!==title)title.value=st.name||'';
    if($('kcSaveProduct'))$('kcSaveProduct').disabled=!!($('kcGen')&&$('kcGen').disabled)||!!artisanStyleDraft||current;
    if($('kcDownloadProduct'))$('kcDownloadProduct').disabled=!p||p.state!=='ready';
    say('kcProductStatus',p?(p.state==='ready'?'Ready to slice · '+p.fit.slotMm.toFixed(2)+' mm socket':
      'Saved · needs attention: '+p.issues.join(' ')):(artisanStyleDraft?'New style draft · current product kept':
      'Unsaved changes'),p&&p.state!=='ready'?'warn':'');
  }
  function captureProduct(recipe){
    if(!window.keycapProduct)return null;
    var fit={slotMm:+(K.MX.crossWide+stemFitClearance).toFixed(2)};
    try{
      var laid=checkedLayout([printEntry()]);
      if(laid.leftOver||laid.placed.length!==1)throw new Error('The complete keycap does not fit this print volume.');
      return window.keycapProduct.capture({positions:laid.positions,recipe:recipe,fit:fit,issues:[]});
    }catch(e){
      return window.keycapProduct.capture({positions:null,recipe:recipe,fit:fit,issues:[e.message||'The assembled product needs a geometry check.']});
    }
  }
  function keepCurrent(prompt) {
    var source = st.sculpt;
    if (!source || !source.length || source.length % 9) {
      say('kcGenNote', 'No complete 3D artwork to save. The empty cap was not added to the Library.', 'bad');
      return Promise.resolve(null);
    }
    if (!window.keycapLibrary || !window.keycapShare) {
      say('kcGenNote', 'Artwork is on the cap, but NOT saved: the Library is unavailable. Export a copy to keep it.', 'bad');
      return Promise.resolve(null);
    }
    // Capture the full raw sculpt and its assembly recipe before any async
    // work. The current browser's stem fit intentionally stays a preference.
    var positions = new Float32Array(source), design, facts = null, thumb = null;
    for (var i = 0; i < positions.length; i++) if (!Number.isFinite(positions[i])) {
      say('kcGenNote', 'Artwork has invalid coordinates and was not saved.', 'bad');
      return Promise.resolve(null);
    }
    try { design = window.keycapShare.encode(designOf()); }
    catch (e) { say('kcGenNote', 'Artwork is on the cap but NOT saved: ' + e.message + '. Export a copy to keep it.', 'bad'); return Promise.resolve(null); }
    var productKey=currentProductKey(design),cached=sculptSaves.get(source);
    if(cached&&cached.key===productKey&&sameSculptSnapshot(positions,cached.positions)){
      // A saved recipe can become current again after another edit/save. A
      // pending duplicate shares its original promise and adopts on completion.
      if(cached.rec)adoptSavedProduct(source,productKey,cached.positions,cached.rec,cached.product);
      return cached.promise;
    }
    // Build this artwork now: a delayed thumbnail could otherwise show the
    // previous cap. Failure to seat/render must not discard paid source art.
    try { clearTimeout(pending); refreshNow(); facts = capFacts(); } catch (e) {}
    try {
      var c = $('kcTop');
      if (c && c.width) {
        var t = document.createElement('canvas');
        t.width = 320; t.height = 320;
        t.getContext('2d').drawImage(c, 0, 0, 320, 320);
        thumb = t.toDataURL('image/jpeg', 0.86);
      }
    } catch (e) { /* a thumbnail is a nicety; the mesh is the point */ }
    var product=captureProduct(design);
    var record = {
      name: (st.name || prompt || '').slice(0,120) || 'design',
      prompt: prompt || st.skinFrom || '',
      kind: 'sculpt', positions: positions, thumb: thumb,
      sourceColors:st.sourceColors?new Float32Array(st.sourceColors):null,sourceColorKind:st.sourceColorKind||null,
      /* THE CAP'S MEASUREMENTS, taken here because this is the only place that
         has them. st.sculpt is in the generator's own units - the Library
         cannot recover millimetres from it - and what the owner wants to know
         about a saved design is what it PRINTS as. */
      facts: facts,
      design: design,product:product
    };
    say('kcGenNote', 'Saving the full 3D artwork to the Library\u2026');
    var cacheEntry={key:productKey,positions:positions,product:product,rec:null,promise:null};
    var saving = Promise.resolve().then(function () { return window.keycapLibrary.save(record); })
      .then(function (rec) {
        if (!rec || !rec.id) throw new Error('the Library did not confirm the saved model');
        cacheEntry.rec=rec;
        var deliveryId=sculptDeliveries.get(source);
        if(deliveryId&&window.meshy&&window.meshy.acknowledge){window.meshy.acknowledge(deliveryId);sculptDeliveries.delete(source);}
        adoptSavedProduct(source,productKey,positions,rec,product);
        drawShelf();
        if(product&&product.state!=='ready'){
          say('kcGenNote','Artwork saved · assembly needs attention: '+product.issues.join(' '),'warn');
        }else{
          say('kcGenNote','');
          if(window.designerFeedback)window.designerFeedback.notice('Saved “'+record.name+'” to Library.',{kind:'success'});
        }
        return rec;
      }).catch(function (e) {
        if(sculptSaves.get(source)===cacheEntry)sculptSaves.delete(source);
        say('kcGenNote', 'Artwork is on the cap but NOT saved: ' + e.message + '. Export a copy to keep it.', 'bad');
        return null;
      });
    cacheEntry.promise=saving;
    sculptSaves.set(source,cacheEntry);
    return saving;
  }

  function drawShelf() {
    var host = $('kcShelf'); if (!host || !window.keycapLibrary) return;
    window.keycapLibrary.list().then(function (rows) {
      host.innerHTML = '';
      if (!rows.length) {
        say('kcShelfNote', 'Nothing here yet \u2014 whatever you generate is kept, and comes back without spending another generation.');
        return;
      }
      say('kcShelfNote', rows.length + ' saved \u00b7 picking one puts the same model back, no regeneration');
      rows.forEach(function (r) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'kcShelfItem' + (st.libId === r.id ? ' on' : '');
        b.innerHTML =
          (r.thumb ? '<img alt="" src="' + r.thumb + '">' : '') +
          '<b></b><small></small><span class="kcShelfDel" title="Remove">\u00d7</span>';
        b.querySelector('b').textContent = r.name;
        b.querySelector('small').textContent =
          (r.triangles ? r.triangles.toLocaleString() + ' tri' : '') +
          (r.at ? ' \u00b7 ' + new Date(r.at).toLocaleDateString() : '');
        b.addEventListener('click', function (ev) {
          if (ev.target.classList.contains('kcShelfDel')) {
            ev.stopPropagation();
            /* ⚠️ THE ONLY COPY. A generation costs Meshy credits and a minute of
               waiting, the record here is the only place the mesh exists, and
               this used to delete it on one mis-aimed tap with no dialog and no
               undo - while the Library room's own Delete for the SAME record
               asks first. Ask here too, and if the design being deleted is the
               one currently on the cap, take it off the cap as well rather than
               leaving a pointer to a record that is gone. */
            var gone = function () {
              if (st.libId === r.id) { dropSculpt(); st.skinFrom = ''; refresh(); }
              drawShelf();
            };
            /* uiConfirm is a top-level const in the assembled page - the same
               way slicerLoadMod is reached from here - and it is the dialog
               the rest of the dashboard uses. confirm() is the fallback for
               the standalone harness. */
            var msg = 'Delete "' + r.name + '"? This is the only copy of that model.';
            var ask = (typeof uiConfirm === 'function')
              ? uiConfirm(msg, { ok: 'Delete', danger: true })
              : Promise.resolve(confirm(msg));
            Promise.resolve(ask).then(function (yes) {
              if (!yes) return;
              window.keycapLibrary.remove(r.id).then(gone);
            });
            return;
          }
          useSaved(r.id);
        });
        host.appendChild(b);
      });
    }).catch(function (e) { say('kcShelfNote', e.message, 'bad'); });
  }

  function useSaved(id) {
    var load=nextSculptLoad();
    return window.keycapLibrary.get(id).then(function (rec) {
      if(load!==sculptLoadSerial)return false;
      if (!rec || !rec.positions) throw new Error('That design has no model stored.');
      /* setArt FIRST. Opening a saved sculpt while the card was in Braille
         mode left st.art on 'braille', so relief() went on returning dots and
         the restored mesh was never built - the design silently did not arrive,
         and the mode row still said Braille. setArt clears the fields of other
         modes, so it has to run before the mesh is assigned, not after. */
      if (rec.design && window.keycapShare) {
        applyDesign(window.keycapShare.decode(rec.design));
        st.art = 'gen'; paintArt('gen');
      } else setArt('gen');
      st.sculpt = new Float32Array(rec.positions);
      setSourceReference(rec.sourceColors,rec.sourceColorKind);
      st.skinFrom = rec.prompt || '';
      st.libId = id;
      rememberLoadedProduct(rec);
      st.icon = null;
      rememberSession();
      if ($('kcPrompt') && rec.prompt) $('kcPrompt').value = rec.prompt;
      drawShelf();
      refresh();
      say('kcGenNote', 'loaded "' + rec.name + '" \u2014 ' +
        (rec.triangles || 0).toLocaleString() + ' triangles, no generation spent');
      return true;
    }).catch(function (e) { if(load===sculptLoadSerial)say('kcShelfNote', e.message, 'bad'); return false; });
  }

  // ---- a model you already have ------------------------------------------
  /* Same destination as a generation, none of the network. Whatever comes in
     goes through the identical seat/reseat/check path, so a dropped file is not
     a lesser citizen - it gets the floating-piece check, the print pose and the
     library entry exactly like a generated one. */
  function takeMesh(positions, label, deliveryId, reference) {
    if (!positions || positions.length < 9) throw new Error('No usable triangles in that file.');
    var tris = positions.length / 9;
    /* 30k is what a generation asks for; much past that and the software
       rasteriser in this page starts costing the status poll its timeslot,
       which is the bug that produced "printer busy" all afternoon. */
    if (tris > 400000)
      throw new Error(tris.toLocaleString() + ' triangles is too many to spin in the ' +
        'browser. Decimate it to about 30,000 first.');
    nextSculptLoad();
    st.sculpt = positions;
    setSourceReference(reference&&reference.colors,reference&&reference.kind);
    if(deliveryId)sculptDeliveries.set(positions,deliveryId);
    st.libId = null;
    st.icon = null;
    st.skinFrom = label || '';
    st.art = 'gen';
    paintArt('gen');
    var adv = window.keycapSkin && window.keycapSkin.printableAdvice
            ? window.keycapSkin.printableAdvice(
                K.capWidth(st.sizeU) - 2 * K.PROFILES[st.profile].topInset)
            : null;
    say('kcGenNote', 'seated ' + tris.toLocaleString() + ' triangles from ' +
      (label || 'the file') + (adv ? ' \u00b7 ' + adv.note : ''));
    refresh();
    return keepCurrent(label || 'opened model');
  }

  function openModelFile(file) {
    if (!file) return;
    var load=nextSculptLoad();
    if (!window.stlRead) { say('kcGenNote', 'The model reader is missing from this build.', 'bad'); return; }
    if (file.size > 60 * 1024 * 1024) {
      say('kcGenNote', 'That file is ' + (file.size / 1048576).toFixed(0) +
        ' MB. Anything past about 60 MB will not fit in the page.', 'bad');
      return;
    }
    say('kcGenNote', 'reading ' + file.name + '\u2026');
    return file.arrayBuffer().then(function (buf) {
      if(load!==sculptLoadSerial)return false;
      var r = window.stlRead.readModelFile(buf, file.name);
      return parsedReference(r).then(function(ref){if(load!==sculptLoadSerial)return false;return takeMesh(r.positions, file.name.replace(/\.[^.]+$/, ''),null,ref);});
    }).catch(function (e) {
      if(load===sculptLoadSerial)say('kcGenNote', e.message, 'bad');
      return false;
    });
  }

  $('kcOpenWrap')&&$('kcOpenWrap').addEventListener('click',function(){if($('kcFile'))$('kcFile').click();});
  $('kcFile') && $('kcFile').addEventListener('change', function (e) {
    var f = e.target.files && e.target.files[0];
    openModelFile(f);
    e.target.value = '';                 // so the same file can be re-opened
  });

  /* Dropping onto the picture is what people try first. */
  (function () {
    var stage = $('kcCard') && $('kcCard').querySelector('.kcStage');
    if (!stage) return;
    ['dragenter', 'dragover'].forEach(function (ev) {
      stage.addEventListener(ev, function (e) {
        if (!e.dataTransfer || Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') < 0) return;
        e.preventDefault(); e.stopPropagation();
        e.dataTransfer.dropEffect = 'copy';
        stage.classList.add('kcDrop');
      });
    });
    ['dragleave', 'dragend'].forEach(function (ev) {
      stage.addEventListener(ev, function () { stage.classList.remove('kcDrop'); });
    });
    stage.addEventListener('drop', function (e) {
      if (!e.dataTransfer || !e.dataTransfer.files || !e.dataTransfer.files.length) return;
      e.preventDefault(); e.stopPropagation();
      stage.classList.remove('kcDrop');
      openModelFile(e.dataTransfer.files[0]);
    });
  })();

  // ---- the Meshy route ---------------------------------------------------
  function genBusy(on) {
    ['kcGen', 'kcGenClear', 'kcNext', 'kcBack', 'kcPrompt', 'kcSculptHeight', 'kcMeshyDetail','kcMeshyUltra', 'kcSculptStyle', 'kcBrowseStyles', 'kcStyleDraftCancel','kcSculptRotation','kcSculptSize','kcSculptFill','kcSaveProduct','kcProductName'].forEach(function (id) {
      var e = $(id); if (e) e.disabled = !!on;
    });
    if (!on) {syncClear();paintProductState();if($('kcBack'))$('kcBack').disabled=st.step===1;}
  }

  /* ⚠️ #kcGenClear SHIPS DISABLED and used to be enabled only by genBusy(false),
     which only the Generate button and the resume path call. Three of the four
     ways a mesh gets onto a cap - Open a .glb, drag-and-drop, and loading a
     saved design from the shelf or the Library room - never touched it, so the
     only control that removes the figure was permanently greyed out for them.
     One line, called from refreshNow(), covers all four. */
  function syncClear() {
    var b = $('kcGenClear');
    if (b) b.disabled = !st.sculpt;
  }

  /* seat()'s own envelope, so the sentence describes the room the sculpt will
     actually get rather than the cap's nominal size. Keep these in step with
     keycap-sculpt.seat() - they are the same three lines. */
  function capSpec() {
    var pr = K.PROFILES[st.profile];
    if (!pr) return null;
    var capW = K.capWidth(st.sizeU);
    var spread = 1.06;
    var adv = window.keycapSkin && window.keycapSkin.printableAdvice
            ? window.keycapSkin.printableAdvice(capW - 2 * pr.topInset) : null;
    return {
      wMm: Math.min(capW * spread, 19.05 * st.sizeU - 0.4),
      dMm: Math.min(K.DEPTH * spread, 19.05 - 0.4),
      hMm: sculptureHeight(),
      minFeatureMm: adv ? adv.smallestFeatureMm : 0
    };
  }

  /* A generation that was running when the page went away is still running on
     Meshy's side and still billed. If one is outstanding, walk back into it
     rather than making the owner pay twice for the same model. */
  /* When the bytes are blocked but the model exists, the link is the product.
     Rendered as a real anchor so it is one click, and target=_blank so the
     design in progress is not navigated away from. */
  function offerManualDownload(e, prefix) {
    var n = $('kcGenNote');
    if (!n) return;
    if (!e || !e.modelUrl) { say('kcGenNote', (prefix || '') + (e ? e.message : 'failed'), 'bad'); return; }
    n.className = 'hint warn';
    n.textContent = (prefix || '') + e.message + ' ';
    var a = document.createElement('a');
    a.href = e.modelUrl;
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = 'Download the model \u2192';
    a.style.cssText = 'color:var(--link);font-weight:600;white-space:nowrap';
    n.appendChild(a);
  }

  function resumeGeneration() {
    if (!window.meshy || !window.meshy.pending || !window.meshy.pending()) return;
    if (!window.meshyParseGLB) return;
    var d = window.meshy.pending();
    /* ⚠️ WHOSE GENERATION IS THIS. meshy keeps ONE pending slot and used to
       record nothing about which card filled it, and this claimed it
       unconditionally 1.2 seconds after every page load - while meshy-ui, the
       OTHER card that generates models, has no resume code at all. So a model
       started in "Generate a model", interrupted by a reload, came back SEATED
       ON A KEYCAP: the owner's model was gone, the cap had a stranger on it,
       and the credits were spent. Claim only what this card started. Records
       written before this field existed have no `from`, and those still come
       here, because this card is where they used to go. */
    if (d.from && d.from !== 'keycap') return;
    genBusy(true);
    say('kcGenNote', 'a generation was still running - picking it up\u2026');
    window.meshy.resume(function (m) { say('kcGenNote', m); })
      .then(function (state) {
        if (!state || !state.glb) { genBusy(false); return; }
        var parsed = window.meshyParseGLB(state.glb);
        var recoveredCode = d.designCode || d.opts && d.opts.designCode, recoveredDesign = null;
        if (recoveredCode && window.keycapShare) {
          recoveredDesign = window.keycapShare.decode(recoveredCode);
          applyDesign(recoveredDesign);
        }
        return parsedReference(parsed).then(function(ref){return takeMesh(parsed.positions, recoveredDesign && recoveredDesign.prompt || d.prompt || 'recovered generation',state.deliveryId,ref);});
      })
      .catch(function (e) {
        offerManualDownload(e, 'could not recover the interrupted generation: ');
      })
      .then(function () { genBusy(false); });
  }
  setTimeout(resumeGeneration, 1200);

  $('kcGen').addEventListener('click', function () {
    var typed = ($('kcPrompt').value || '').trim();
    /* An icon picked from the drawn set doubles as a starting prompt. The
       wording matters more than the subject: the tail asks for a chunky closed
       figure standing on a base, because the seat refuses a piece that touches
       nothing and the mask cannot hold a limb thinner than half a millimetre.
       (This comment used to claim the opposite - it described the tail from the
       height-field days, which asked for a flat relief and then stood it up.) */
    /* ⚠️ THE TAIL WAS NEVER REACHING A REAL GENERATION. This line read
         typed || (st.icon ? promptFor(st.icon) : '')
       so the moment anybody typed anything - which is every generation anyone
       has ever run - the text went to Meshy raw. No "full 3D figurine", no
       "standing on a base with everything touching it", no "no thin or fragile
       parts". The entire prompt rewrite applied only to the branch that fires
       when the box is EMPTY and a built-in icon is selected, and the picker
       that set st.icon was removed from the markup, so that branch is dead
       code. Meshy has been answering "pikachu" with whatever it felt like.

       Everything goes through promptFor now, and it is handed the cap's real
       print envelope so the generator is told the shape of the space it is
       composing for. */
    var subject = typed || st.icon || '',prompt='';
    if (!window.keycapSkin) {say('kcGenNote','The art prompt tools are missing from this build.','bad');return;}
    var draft=artisanStyleDraft?Object.assign({},artisanStyleDraft):null,envelope=capSpec();
    if(draft&&envelope)envelope.hMm=draft.sculptHeightMm;
    try {prompt=subject?window.keycapSkin.promptFor(subject,null,'sculpt',envelope,draft?draft.sculptStyle:st.sculptStyle):'';}
    catch(e){say('kcGenNote',e.message,'bad');return;}
    var request={polycount:(draft?draft.meshyPolycount:st.meshyPolycount)===100000?100000:30000,ultra:st.meshyUltra===true,subject:subject,styleDraft:draft};
    if (!prompt) { say('kcGenNote', 'Describe your design, or choose a starting point in Browse artisan styles.', 'bad'); return; }
    if (!window.meshy || !window.meshy.hasKey()) {
      say('kcGenNote', 'No Meshy key yet - add it under "Meshy API key" in the Generate a model card, then come back.', 'bad');
      return;
    }
    if (!window.meshyParseGLB || !window.keycapSkin) {
      say('kcGenNote', 'The GLB reader is missing from this build.', 'bad'); return;
    }
    /* ⚠️ THERE IS ALREADY ONE RUNNING. waitFor rejects on the FIRST failed poll
       - one WiFi blip on the printer's own access point, which is the network
       this whole card is about - and the obvious next action is to press
       Generate again. That called createPreview (a second billed task) and
       remember() overwrote the record for the first one, which was still
       running and still paid for. Offer to pick it up instead; the resume path
       already exists and costs nothing. */
    var open = window.meshy.pending && window.meshy.pending();
    if (open && (!open.from || open.from === 'keycap')) {
      var ask = 'A generation from ' +
        (open.at ? new Date(open.at).toLocaleTimeString() : 'earlier') +
        ' is still running' + (open.prompt ? ' ("' + open.prompt.slice(0, 40) + '")' : '') +
        '. Pick that one up instead of paying for a new one?';
      var q = (typeof uiConfirm === 'function')
        ? uiConfirm(ask, { ok: 'Pick it up', cancel: 'Start a new one' })
        : Promise.resolve(confirm(ask));
      Promise.resolve(q).then(function (yes) {
        if (yes) return resumeGeneration();
        var warning='Start a new paid generation and replace this keycap recovery record? The earlier task remains in your Meshy history.';
        var next=typeof uiConfirm==='function'
          ? uiConfirm(warning,{ok:'Generate new keycap',cancel:'Keep existing task'})
          : Promise.resolve(confirm(warning));
        return Promise.resolve(next).then(function(approved){
          if(!approved)return;
          if(!window.meshy.forgetPending(open.id)){say('kcGenNote','The saved task changed. Recover it before starting another.','bad');return;}
          return startGeneration(prompt,request);
        });
      });
      return;
    }
    startGeneration(prompt,request);
  });

  function startGeneration(prompt,request) {
    request=request||{polycount:st.meshyPolycount,ultra:st.meshyUltra===true,subject:prompt};
    if(typeof prompt!=='string'||!prompt.trim()||prompt.length>800){say('kcGenNote','The complete Meshy request must be 1–800 characters. Shorten the art description.','bad');return;}
    var generatedDesign = designOf();
    generatedDesign.prompt = request.subject || prompt;
    generatedDesign.icon = undefined; generatedDesign.braille = undefined;
    generatedDesign.sculptHeightMm = request.styleDraft?request.styleDraft.sculptHeightMm:sculptureHeight();
    if(request.styleDraft){generatedDesign.name=request.styleDraft.title;generatedDesign.sculptStyle=request.styleDraft.sculptStyle;generatedDesign.legendOn=false;generatedDesign.sculptRotationDeg=0;generatedDesign.sculptScalePercent=100;}
    generatedDesign.meshyPolycount = request.polycount === 100000 ? 100000 : 30000;
    generatedDesign.meshyUltra = request.ultra===true;
    var designCode = window.keycapShare ? window.keycapShare.encode(generatedDesign) : null;
    genBusy(true);
    say('kcGenNote', 'asking Meshy\u2026');
    return window.meshy.generate(prompt, { polycount: request.polycount===100000?100000:30000, ultra:request.ultra===true, refine: false, from: 'keycap', designCode: designCode },
      function (m) { say('kcGenNote', m); })
      .then(function (state) {
        var parsed = window.meshyParseGLB(state.glb);
        return parsedReference(parsed).then(function(reference){return {parsed:parsed,state:state,reference:reference};});
      }).then(function(delivered){
        var parsed=delivered.parsed,state=delivered.state;
        /* THE MODEL STAYS A MODEL.

           This used to hand the generated mesh to keycapSkin.heightField(),
           which samples it into a height on the top face. That is the right
           answer for a legend and the wrong one for a figure: a height field
           can only extrude a 2D shape, so it has no undercuts and no
           silhouette - and on a blocky model whose shortest axis is ambiguous,
           the ray cast sights straight through it and what lands on the cap is
           a handful of shards. A generated creeper came out as three spikes.

           keycap-sculpt seats the real mesh on the cap as a second overlapping
           solid instead, which the slicer rasterises as a union. Nothing is
           resampled, nothing is flattened, and the cap's own geometry - the
           stem - is untouched. */
        if(request.styleDraft)cancelArtisanStyleDraft(false);
        applyDesign(generatedDesign);
        st.sculpt = parsed.positions;
        setSourceReference(delivered.reference.colors,delivered.reference.kind);
        if(state.deliveryId)sculptDeliveries.set(st.sculpt,state.deliveryId);
        st.libId = null;
        st.skinFrom = request.subject || prompt;
        var tris = parsed.positions.length / 9;
        /* The triangle count flatters the result - 30k triangles on a 14 mm
           sculpt is far more detail than a 127.5 micron mask can print. Saying
           what the printer can actually hold, on the note that was already
           there, is the difference between a happy preview and a happy part. */
        /* THE NOTE QUOTED A WIDTH THE SCULPT NEVER HAS. This passed the TOP
           FACE width - 12.70 mm on a DSA 1u - while seat() spreads the sculpt
           to min(capWidth * 1.06, pitch - 0.4), which is 18.65. So the "about
           N mm across" figure was out by nearly half, and the smallest-feature
           number derived from it was wrong in the same direction. Measured, not
           predicted: capFor() has already seated the mesh by the time anybody
           reads this, so ask the seat what it actually did. */
        var seatedNow = built && built.seated;
        var adv = window.keycapSkin.printableAdvice
                ? window.keycapSkin.printableAdvice(
                    seatedNow ? seatedNow.sculptMm.x
                              : Math.min(K.capWidth(st.sizeU) * 1.06, 19.05 * st.sizeU - 0.4))
                : null;
        say('kcGenNote', 'seated a ' + tris.toLocaleString() + ' triangle model on the cap' +
          (adv ? ' · ' + adv.note : ''));
        refresh();
        /* Filed immediately. A generation costs credits and takes a minute, so
           losing it to a page reload - which is what used to happen - is the
           one outcome worth engineering against. */
        return keepCurrent(request.subject || prompt);
      })
      /* ⚠️ offerManualDownload, NOT say(). fetchModel attaches e.modelUrl when
         the asset exists but this browser cannot read it - assets.meshy.ai
         sends no CORS header, and the printer's own fetch is refused mid-print
         - and its message ends "open the link and bring the file back in".
         say() renders text. The link was dropped on the floor, so the sentence
         told the owner to click something that was not there, about a model
         they had already paid for. The resume path above has always called
         this; the Generate path did not. */
      .catch(function (e) { offerManualDownload(e); })
      .then(function () { genBusy(false); });
  }

  $('kcGenClear').addEventListener('click', function () {
    dropSculpt(); st.skinFrom = '';
    $('kcGenClear').disabled = true;
    say('kcGenNote', 'Artwork cleared. Generate or open another 3D model.');
    refresh();
  });

  function drawIcons() {
    var list = [{ id: null, label: 'none' }].concat(Object.keys(ICO.ICONS).map(function (n) {
      return { id: n, label: ICO.ICONS[n].name };
    }));
    tiles('kcIcons', list, function (it) { return it.id === st.icon; }, function (it) {
      st.icon = it.id;
      if (it.id) st.art = 'lib';
      // picking a drawn icon also loads its prompt, so Generate replaces it
      if (it.id && $('kcPrompt') && !$('kcPrompt').value.trim() && window.keycapSkin)
        $('kcPrompt').value = window.keycapSkin.promptFor(it.id);
      drawIcons(); refresh();
    });
  }

  // ---- the model ---------------------------------------------------------
  /* A generated skin wins over a drawn icon when there is one - that is the
     intended route, and the drawn set is the fallback that works with no
     account. Both arrive here as the same kind of function, so nothing below
     this point knows or cares which it was. */
  /* One art source at a time. Before this the card could hold a generated
     skin, a drawn icon AND a Braille string simultaneously, and which one you
     got depended on the order of checks inside relief() rather than on
     anything visible. */
  /* SMART DEFAULTS. Most of what this card used to ask for has exactly one
     sensible answer, and asking for it is just work handed to the user:

       Braille    fixed by specification - 0.75 mm, always raised. Not a choice.
       Generated  a sculpt needs real depth or it is embossing; 2.4 mm, raised.
       Drawn      a legend engraves better: no lean, no supports, two per plate,
                  and the recess holds paint. 0.55 mm.

     They are still overridable under Advanced, but nothing has to be touched
     for the common case. */
  var ART_DEFAULTS = {
    gen:     { depth: 2.40, raised: true },
    lib:     { depth: 0.55, raised: false },
    braille: { depth: 0.75, raised: true },
    none:    { depth: 0.55, raised: false }
  };

  /* Painting the mode row is not the same as CHANGING the mode, and conflating
     them is why a restored session came back lying. setArt() also applies the
     mode's defaults and clears the fields that belong to other modes - exactly
     right when somebody clicks a mode button, exactly wrong when you are
     putting back a design that already has its own depth, its own letter and
     its own icon. restoreSession() and useSaved() want only the paint. */
  function paintArt(mode) {
    Array.prototype.forEach.call($('kcModes').querySelectorAll('button'), function (b) {
      b.classList.toggle('on', b.getAttribute('data-mode') === mode);
    });
    Array.prototype.forEach.call($('kcCard').querySelectorAll('[data-art]'), function (p) {
      p.hidden = p.getAttribute('data-art') !== mode;
    });
  }

  /* ⚠️ st.libId IS A POINTER TO A MESH IN IndexedDB, and it used to be set in
     three places and cleared in none. rememberSession persists it
     unconditionally and restoreSession re-hydrates the mesh from it, so every
     path that removes the sculpt - switching to Braille, pressing Clear,
     loading a shared design - left the pointer behind and the figure came back
     on the next reload, on top of whatever the owner had switched to. Clearing
     the mesh and clearing the pointer are one act, so they are one function. */
  function dropSculpt() {
    nextSculptLoad();
    st.sculpt = null;
    st.sourceColors=null;st.seatedColors=null;st.sourceColorKind=null;paintReference();
    st.libId = null;
  }

  function setArt(mode) {
    st.art = mode;
    var d = ART_DEFAULTS[mode];
    if (d && !st.touchedFinish) {
      st.depth = d.depth;
      if ($('kcDepth')) $('kcDepth').value = st.depth;
      if ($('kcDepthVal')) $('kcDepthVal').textContent = st.depth.toFixed(2);
      setFinish(d.raised);
    }
    paintArt(mode);
    if (mode === 'lib') drawShelf();
    if (mode !== 'lib') st.icon = null;
    if (mode !== 'braille') st.braille = '';
    if (mode !== 'gen') { dropSculpt(); st.skinFrom = ''; }
    if (mode === 'braille') setFinish(true);   // a recess is not readable
    if ($('kcBraille') && mode !== 'braille') $('kcBraille').value = '';
    drawIcons();
    refresh();
  }

  /* A corner digit is a LEGEND, and legends are shallow. It used to be
     extruded at whatever the art's relief depth was, so on a 4.65 mm sculpt
     setting the digit's 0.5 mm-wide strokes came out as 4.65 mm spikes - thin
     jagged shards standing off the cap. It only showed on keys that auto-fill
     a digit, which is why it looked like "the number keys are broken".

     0.8 mm is the ceiling: deep enough to read and to hold paint, shallow
     enough that a narrow stroke stays a stroke. */
  var DIGIT_MAX_MM = 0.8;
  function digitDepth() { return Math.min(st.depth, DIGIT_MAX_MM); }

  /* Real type where the browser can draw it, the hand-plotted polylines only
     as a fallback. Placed in the corner at a quarter of the face. */
  /* One switch, read everywhere the corner legend is used. Default on, because
     the board knows the key and putting its own character on it is what you
     want nine times out of ten - but a Tarkov cap or a bare artisan blank
     wants nothing on it, and clearing a box you never typed in is a strange
     way to ask for that. */
  function legendOn() { return st.legendOn !== false; }

  function digitRelief(raised) {
    if (!st.digit) return null;
    return ICO.placedGlyphRelief(st.digit, {depth:digitDepth(),raised:raised,samples:512});
  }

  function relief() {
    /* Braille wins outright when it is set: it is a specification, and mixing
       a decorative icon into it would put shapes a finger cannot distinguish
       from dots next to dots. */
    /* With a model seated on the cap the relief field carries only the corner
       digit, if any - the sculpt is real geometry, not a displacement. */
    if (!legendOn()) {
      if (st.sculpt || st.art === 'none') return null;
    }
    if (st.sculpt) return digitRelief(false);
    if (st.art === 'none') return digitRelief(st.raised);
    if (st.art === 'braille') {
      if (!st.braille || !window.keycapBraille) return null;
      return window.keycapBraille.brailleRelief(st.braille, { dotHeight: Math.max(0.48, st.depth) });
    }
    /* The height-field branch that used to live here read st.skin, which is
       never assigned, so it was unreachable. It was also the path this project
       abandoned: a height field can only extrude a 2D shape, which is why a
       generated creeper came out as three spikes and why keycap-sculpt seats
       the real mesh instead. Gone rather than left as a trap. */
    if (!st.icon && (!st.digit || !legendOn())) return null;
    if (!st.icon) return legendOn() ? digitRelief(st.raised) : null;
    /* Icon and digit at their own depths, combined by whichever stands
       furthest proud - the icon may be deep, the digit must not follow it. */
    var ic = ICO.makeRelief({ icon: st.icon }, { depth: st.depth, raised: st.raised });
    if (!st.digit || !legendOn()) return ic;
    var dg = digitRelief(st.raised);
    var both = function (u, v, w, h) {
      var a = ic(u, v, w, h), b = dg(u, v, w, h);
      return st.raised ? Math.min(a, b) : Math.max(a, b);
    };
    both.depth = st.depth; both.raised = st.raised; both.parts = ic.parts || []; both.detailRegions = dg.detailRegions;
    return both;
  }

  /* WHY THIS IS DEBOUNCED, and why it was making the whole dashboard lie.

     refresh() rebuilds the cap mesh, redraws the 3D view and rasterises the
     flat legend preview - and the legend alone is 200x200 pixels each calling
     the relief function, which evaluates every signed-distance primitive in the
     icon. That is around a million distance evaluations, on the main thread,
     and it ran on EVERY keystroke and every tick of the relief slider.

     The visible symptom was not a slow card. It was the dashboard announcing
     "Printer busy - waiting for it to answer": the status poll's fetch could
     not run while this was blocking, the poll timed out, and the page drew the
     obvious conclusion about a printer that was in fact sitting idle. */
  var pending = 0, sharpen = 0;
  function refresh() {
    clearTimeout(pending);
    clearTimeout(sharpen);
    drawTop.sharp = false;
    pending = setTimeout(refreshNow, 110);
    /* Once it has been still for long enough that nothing is being dragged,
       redraw the legend inset at the size it is shown. */
    sharpen = setTimeout(function () {
      drawTop.sharp = true;
      var rel = null;
      try { rel = relief(); } catch (e) { return; }
      try { drawTop(rel); } catch (e) {}
    }, 520);
  }
  /* One place that builds a cap, at whichever resolution the caller needs. */
  function capFor(mode, rel) {
    var pr = K.PROFILES[st.profile];
    var topW = K.capWidth(st.sizeU) - 2 * pr.topInset;
    var grid = mode === 'print'
      ? K.gridForFace(topW)                  // one sample per printer pixel
      : 31;                                  // enough to judge, cheap to spin
    /* BRAILLE IN A BOWL. The dots are 0.75 mm tall and the profile's own dish
       is 0.80 mm on XDA, 1.10 on DSA and 1.30 on SA - so on every profile the
       cap ships with, the top of a dot sits BELOW the rim of the dish it stands
       in. A finger tracking across the cap feels the rim, not the dot, which
       makes the one feature whose entire purpose is to be felt unreadable.
       Braille caps are flat-topped in real life for exactly this reason.
       build() already honours o.dishDepth, so this is the whole fix. */
    var cap = K.build({ profile: st.profile, row: st.row, sizeU: st.sizeU,
                        relief: rel, topGrid: grid, mx: stemFitMx(),
                        legendPixelMm: mode === 'print' ? K.PIXEL_MM / 2 : K.PIXEL_MM,
                        dishDepth: st.art === 'braille' ? 0 : undefined });
    if (st.sculpt && window.keycapSculpt) {
      var SCp = window.keycapSculpt;
      cap.dishDepth = pr.dishDepth;
      cap.sizeU = st.sizeU;
      var seated = SCp.seat(cap, st.sculpt,
        { heightMm: sculptureHeight(),rotationDeg:st.sculptRotationDeg||0,scalePercent:st.sculptScalePercent||100 });
      /* THE CHECK USED TO BE THE END OF IT. check() found the hovering
         figure, wrote a sentence into cap.sculptCheck, and nothing on the page
         ever rendered it - so a Pokemon the generator left a hair off the rock
         went to the plate as a separate object in mid air. Land it, then check
         the mesh that is actually going to be printed. */
      var chk = SCp.check(seated);
      if (chk.anchorage && chk.anchorage.floating.length && SCp.reseat) {
        var landed = SCp.reseat(seated);
        if (landed.moved.length) { seated = landed; chk = SCp.check(seated); }
      }
      cap.positions = seated.positions;
      cap.triangles = seated.triangles;
      cap.seated = seated;
      cap.printPlan = SCp.printPose(seated, cap);
      cap.size = { x: seated.footprintMm.x, y: seated.footprintMm.y,
                   z: seated.totalHeightMm };
      cap.sculptCheck = chk;
    }
    cap.relief = rel;
    cap.name = (st.key || 'cap') + '-' + (st.icon || (st.sculpt ? 'art' : 'plain'));
    return cap;
  }


  // Staged meshes retain proof for their exact coordinates and print plan.
  // Old/bypassed entries must be rebuilt rather than inheriting a preview check.
  var checkedEntries = new WeakMap();
  function meshUsable(p) {
    if(!p||!p.length||p.length%9)throw new Error('The model has no complete triangles.');
    for(var i=0;i<p.length;i++)if(!Number.isFinite(p[i]))throw new Error('The model has invalid coordinates.');
    var h=window.meshHealth ? window.meshHealth(p) : null;
    if(h&&(h.fatal||h.severity==='bad'))
      throw new Error(h.fatal||h.advice||h.summary||'The model failed its mesh check.');
  }
  function printEntry() {
    var rel=relief(),c=capFor('print',rel);
    if(!c.printPlan||c.printPlan.ok===false)throw new Error(c.printPlan&&c.printPlan.why||'No valid print plan.');
    meshUsable(c.positions);
    var base=c.seated ? c.positions.subarray(0,c.seated.capTriangles*9) : c.positions;
    var valid=K.validate(base,{sizeU:st.sizeU,mx:stemFitMx()});
    if(!valid.ok)throw new Error(valid.issues.join(' '));
    if(c.sculptCheck&&!c.sculptCheck.ok)throw new Error(c.sculptCheck.issues.join(' '));
    var positions=K.orientAsPrinted(c.positions,c.angle,c.printPlan.tilt||0,
      {mouthDown:!!c.printPlan.mouthDown});
    meshUsable(positions);
    var entry={positions:positions,size:c.size,name:c.name,printPlan:c.printPlan};
    checkedEntries.set(entry,{positions:positions.slice(),metadata:JSON.stringify([entry.size,entry.printPlan])});
    return entry;
  }
  function printMesh(){return printEntry().positions;}
  function checkedLayout(caps) {
    caps.forEach(function(c){
      var stamp=checkedEntries.get(c);
      if(!stamp||JSON.stringify([c.size,c.printPlan])!==stamp.metadata||c.positions.length!==stamp.positions.length)
        throw new Error('A staged cap is no longer verified. Clear the plate and add it again.');
      for(var i=0;i<c.positions.length;i++)if(c.positions[i]!==stamp.positions[i])
        throw new Error('A staged cap changed after validation. Clear the plate and add it again.');
      meshUsable(c.positions);
    });
    var lay=K.layout(caps);
    if(!lay.positions.length)throw new Error(lay.issues&&lay.issues[0]||'No cap fits the plate.');
    meshUsable(lay.positions);
    var mn=[Infinity,Infinity,Infinity],mx=[-Infinity,-Infinity,-Infinity];
    for(var q=0;q<lay.positions.length;q+=3)for(var k=0;k<3;k++){
      mn[k]=Math.min(mn[k],lay.positions[q+k]);mx[k]=Math.max(mx[k],lay.positions[q+k]);}
    var bed=K.usableBed(),zLimit=lay.supports?K.BED.zSupported:K.BED.zFlat;
    if(mx[0]-mn[0]>bed.x+0.01||mx[1]-mn[1]>bed.y+0.01||mx[2]-mn[2]>zLimit+0.01)
      throw new Error('The outgoing geometry exceeds the usable print volume.');
    return lay;
  }

  function refreshNow() {
    rememberSession();
    syncClear();          // every route that puts a mesh on the cap, not just Generate
    var rel = null, err = null;
    try { rel = relief(); } catch (e) { err = e.message; }
    try {
      /* PREVIEW AND PRINT DO NOT SHARE A RESOLUTION, and conflating them is
         what made the dashboard shout "Printer busy" again: sampling the cap at
         the printer's pixel takes it from 2,760 triangles to 26,472, and the 3D
         view rasterises every one of them in JavaScript on the main thread,
         every frame. The poll could not get a turn.

         So the preview is built coarse and the fine mesh is built ONCE, on
         demand, by capFor('print') when something is actually exported, sliced
         or put on a plate. What you look at is fast; what the machine gets is
         at full resolution. */
      built = capFor('preview', rel);
      built.relief = rel;
      built.name = (st.key || 'cap') + '-' + (st.icon || (st.sculpt ? 'art' : 'plain'));

    } catch (e) { built = null; err = e.message; }
    drawHero();
    drawTop(rel);
    drawSide();
    if (err) { say('kcState', err, 'bad'); } else say('kcState', '');
    dims(); legendWarn(rel); report();
    if($('kcInsets'))$('kcInsets').hidden=!!st.sculpt&&!rel;
    paintProductState();
    paintSculptMeasurements();
  }

  /* The hero: the actual cap mesh, in 3D, spinnable. A keycap is an object and
     the flat heightfield never showed you one - not the profile, not the row
     angle, not the skirt. */
  /* One place that turns the stylesheet into the numbers the rasteriser wants,
     so the hero, the insets and the share card cannot drift apart. */
  function viewTokens() {
    var cs = getComputedStyle($('kcCard'));
    function rgb(name, fallback) {
      var v = (cs.getPropertyValue(name) || '').trim();
      var m = v.match(/^#([0-9a-f]{6})$/i);
      if (m) return [parseInt(m[1].slice(0, 2), 16), parseInt(m[1].slice(2, 4), 16),
                     parseInt(m[1].slice(4, 6), 16)];
      m = v.match(/rgba?\(([^)]+)\)/);
      if (m) { var n = m[1].split(',').map(parseFloat); return [n[0], n[1], n[2]]; }
      return fallback;
    }
    var light = document.documentElement.getAttribute('data-theme') === 'light';
    return {
      base: rgb('--kCap', light ? [222, 216, 206] : [196, 188, 176]),
      shadow: light ? 'rgba(24,26,32,0.42)' : 'rgba(0,0,0,0.62)'
    };
  }

  function drawHero() {
    var c = $('kcTop'); if (!c || !window.keycapView3d) return;
    if (!hero) {
      /* The rasteriser fell back to a hardcoded warm grey and a near-black
         shadow in BOTH themes, because nothing ever handed it the page's
         tokens - so on the light theme the cap sat in a black puddle. The
         share-card path already reads these; the hero never did. */
      hero = window.keycapView3d.attach(c, { az: -0.62, el: 0.52, dist: 3.0,
                                             spin: false, tokens: viewTokens() });
      /* One slow turn on first sight, stopped by the first touch. Enough to
         read it as an object; not so much that it is annoying to aim at. */
      hero.autoSpin(true);
      setTimeout(function () { if (hero) hero.autoSpin(false); }, 5200);
    }
    if (!built) { hero.setMesh(null); return; }
    if(hero.setAppearance)hero.setAppearance({mode:st.colorMode||'solid',base:st.baseColor,art:st.artColor,useSourceColors:st.useSourceColors!==false},{draw:false});
    var printed=st.pose==='printed',colors=printed&&built.printPlan&&built.printPlan.mouthDown?st.sourceColors:st.seatedColors;
    hero.setMesh(printed ? printedMesh() : built.positions,{artStart:built.seated?built.seated.capTriangles*9:built.positions.length,artColors:colors});
  }

  /* The lean the machine will use: whatever the footprint needs, or whatever a
     raised legend needs, whichever is greater. */
  function printedTilt() {
    return (built && built.printPlan && built.printPlan.tilt) || 0;
  }
  function printedMesh() {
    /* The "as printed" preview has to show the same object the exporter makes,
       or it is the dishonest picture this function exists to replace. */
    return K.orientAsPrinted(built.positions, built.angle, printedTilt(),
      { mouthDown: !!(built.printPlan && built.printPlan.mouthDown) });
  }

  /* The flat top-down view survives as a DETAIL inset: at 13 mm across, the
     relief on the 3D cap is a fraction of a millimetre and legend edges do not
     read. This is where you actually judge the artwork. */
  function drawTop(rel) {
    var c = $('kcFlat'); if (!c) return;
    /* Rendered at a quarter of the pixels and scaled up. This is a thumbnail
       next to a 3D view, not the thing that gets printed - the printability
       check rasterises the field properly at 127.5 microns elsewhere - and at
       200x200 it cost about a million SDF evaluations per keystroke. */
    /* A 100 PX RENDER SHOWN AT 324 IS A 3.2x UPSCALE, and that is the whole
       reason the letter looked soft - not the field, the resampling. But the
       obvious fix is the one that caused the worst bug in this card's history:
       this is five relief evaluations a pixel, so 200x200 is 200,000 SDF calls
       on the main thread, the status poll cannot run, and the dashboard starts
       announcing "Printer busy" about an idle printer.

       So it renders twice. Cheap and immediate while anything is moving, then
       once everything has been still for a moment, again at the size it is
       actually displayed. Dragging the depth slider costs exactly what it cost
       before; the picture you end up looking at is sharp. Nobody judges a
       letter mid-drag. */
    var hi = drawTop.sharp;
    var W = 100, H = 100;
    if (hi) {
      var box = c.getBoundingClientRect();
      var want = Math.round(Math.min(320, Math.max(100,
                   box.width * (window.devicePixelRatio || 1))));
      W = H = want;
    }
    var g = c.getContext('2d');
    c.width = W; c.height = H;
    var img = g.createImageData(W, H);
    var pr = K.PROFILES[st.profile], dd = pr.dishDepth;
    var topW = K.capWidth(st.sizeU) - 2 * pr.topInset;
    var topD = K.DEPTH - 2 * pr.topInset;
    var half = topW / 2, aspect = topW / topD;
    var tanA = Math.tan((pr.rows[st.row] || { angle: 0 }).angle * Math.PI / 180);
    function surf(u, v) {
      var dish = pr.dish === 'cylindrical' ? dd * Math.max(0, 1 - u * u)
                                           : dd * Math.max(0, 1 - (u * u + v * v));
      return dish + v * (topD / 2) * tanA + (rel ? rel(u, v) : 0);
    }
    var e = 1.4 / Math.min(W, H) * 2;
    for (var y = 0; y < H; y++) for (var x = 0; x < W; x++) {
      var u = (x + 0.5) / W * 2 - 1, v = 1 - (y + 0.5) / H * 2;
      var i = (y * W + x) * 4, m = Math.max(Math.abs(u), Math.abs(v));
      if (m > 0.995) { img.data[i] = 16; img.data[i+1] = 17; img.data[i+2] = 20; img.data[i+3] = 255; continue; }
      var gx = (surf(u + e, v) - surf(u - e, v)) / (2 * e * half);
      var gy = (surf(u, v + e) - surf(u, v - e)) / (2 * e * half * aspect);
      var L = 1 / Math.hypot(gx, gy, 1);
      var lam = Math.max(0, (gx * -0.40 + gy * 0.46 + 0.79) * L);
      var hgt = rel ? Math.max(0, Math.min(1, Math.abs(rel(u, v)) / st.depth)) : 0;
      if (rel && !st.raised) hgt = -hgt;                 // engraved reads darker
      var sh = (0.30 + 0.78 * lam) * (0.80 + 0.34 * hgt);
      var sp = Math.pow(Math.max(0, lam), 30) * 0.7;
      var edge = m > 0.965 ? 0.68 : 1;
      var base = [188, 180, 168];
      for (var k = 0; k < 3; k++)
        img.data[i + k] = Math.max(0, Math.min(255, Math.round((base[k] * sh + sp * 255) * edge)));
      img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
  }

  /* Front elevation, to scale, with the stem drawn where it actually is. This
     is the view that makes a too-short row obvious - you can see the stem
     running out of cap. */
  function drawSide() {
    var c = $('kcSide'); if (!c || !built) return;
    var g = c.getContext('2d'), W = c.width, H = c.height;
    var css = getComputedStyle(document.documentElement);
    var ink = css.getPropertyValue('--text').trim() || '#eee';
    var acc = css.getPropertyValue('--accent').trim() || '#e5484d';
    var line = css.getPropertyValue('--line2').trim() || '#333';
    g.clearRect(0, 0, W, H);
    var pr = K.PROFILES[st.profile];
    var capW = K.capWidth(st.sizeU), capH = built.mouthZ;
    var s = Math.min((W - 40) / capW, (H - 28) / capH);
    var ox = W / 2, oy = 14;
    function X(mm) { return ox + mm * s; }
    function Y(mm) { return oy + mm * s; }          // z grows downward here
    var topW = capW - 2 * pr.topInset, dd = pr.dishDepth;
    var tanA = Math.tan((pr.rows[st.row] || { angle: 0 }).angle * Math.PI / 180);

    g.strokeStyle = ink; g.lineWidth = 1.4; g.beginPath();
    // the dished top, sampled
    for (var i = 0; i <= 48; i++) {
      var u = i / 48 * 2 - 1, x = u * topW / 2;
      var dish = pr.dish === 'cylindrical' ? dd * Math.max(0, 1 - u * u)
                                           : dd * Math.max(0, 1 - u * u);
      var z = dish + (built.frontZ - (dd + 0)) * 0;  // front elevation: no y term
      if (i === 0) g.moveTo(X(x), Y(dish)); else g.lineTo(X(x), Y(dish));
    }
    g.lineTo(X(capW / 2), Y(capH));
    g.lineTo(X(-capW / 2), Y(capH));
    g.closePath(); g.stroke();

    // the cavity and the stem
    g.strokeStyle = line; g.lineWidth = 1;
    g.beginPath();
    g.moveTo(X(-capW / 2 + 1.35), Y(capH));
    g.lineTo(X(-topW / 2 + 1.35), Y(built.floorZ));
    g.lineTo(X(topW / 2 - 1.35), Y(built.floorZ));
    g.lineTo(X(capW / 2 - 1.35), Y(capH));
    g.stroke();

    g.fillStyle = acc; g.globalAlpha = 0.85;
    g.fillRect(X(-K.MX.postR), Y(built.floorZ), K.MX.postR * 2 * s, built.stemDepth * s);
    g.globalAlpha = 1;
    g.fillStyle = css.getPropertyValue('--pv').trim() || '#111';
    g.fillRect(X(-built.slotWidth / 2), Y(built.floorZ), built.slotWidth * s, built.stemDepth * s);

    g.fillStyle = css.getPropertyValue('--muted2').trim() || '#888';
    g.font = '10px system-ui,sans-serif'; g.textAlign = 'left';
    g.fillText(capH.toFixed(2) + ' mm tall', 6, H - 6);
    g.textAlign = 'right';
    g.fillText('stem ' + built.stemDepth.toFixed(2) + ' mm', W - 6, H - 6);
  }

  function dims() {
    if (!built) { say('kcDims', ''); return; }
    say('kcDims', built.size.x.toFixed(1) + ' × ' + built.size.y.toFixed(1) +
      ' × ' + built.size.z.toFixed(2) + ' mm · ' +
      built.triangles.toLocaleString() + ' triangles');
  }

  /* Set by the Braille input, rendered by legendWarn - the single owner of
     #kcLegendWarn - so the two cannot race. */
  var brailleNote = '', brailleBad = false;

  /* WHAT THE PRINTER IS ACTUALLY SET TO. The report quoted "269 layers at
     0.05 mm" on a machine that might be set to 0.035 or 0.10 - a number written
     into the card rather than read from the thing that will print it, so the
     clock and the layer count were both wrong by the ratio. Falls back to 0.05
     when the printer has not answered yet, which is the same number as before,
     so nothing regresses on a cold page. */
  function layerMm() {
    var s = window.tmStatus;
    var h = s && Number(s.layerHeight);
    return (h && h > 0.005 && h < 0.3) ? h : 0.05;
  }

  function legendWarn(rel) {
    var pr = K.PROFILES[st.profile];
    /* THE SIZE LINE IS NOT PART OF THE LEGEND CHECK, and treating it as one is
       why a generated cap showed no dimensions at all: this function returned
       early when there was no relief, and the only writer of #kcDims sat below
       that return. A cap has a size whether or not anything is written on it. */
    var plan = built && built.printPlan;
    if (plan) {
      say('kcDims', built.size.x.toFixed(1) + ' \u00d7 ' + built.size.y.toFixed(1) +
        ' \u00d7 ' + built.size.z.toFixed(2) + ' mm \u00b7 ' +
        (st.sculpt ? 'full 3D artwork' : (rel ? (st.raised ? 'raised ' : 'engraved ') + st.depth.toFixed(2) + ' mm' : 'blank cap')) + ' \u00b7 ' +
        (plan.ok===false ? 'adjust size to fit printer' : (plan.tilt ? ('leans ' + plan.tilt + '\u00b0, supports') : 'flat, no supports')));
    }

    /* A seated sculpt has its own health, and it matters more than a legend's:
       a piece that is floating does not come out wrong, it comes out somewhere
       else in the vat. This is the report that used to be computed and thrown
       away. */
    if (st.art === 'braille' && brailleNote) {
      say('kcLegendWarn', brailleNote, brailleBad ? 'bad' : '');
      return;
    }

    var sk = built && built.sculptCheck;
    if (sk) {
      var mv = built.seated && built.seated.moved;
      if (!sk.ok) {
        say('kcLegendWarn', '\u26a0 ' + sk.issues[0], 'bad');
      } else if (mv && mv.length) {
        say('kcLegendWarn', 'landed ' + mv.length + ' loose piece' +
          (mv.length > 1 ? 's' : '') + ' onto ' + mv[0].onto + ' (' +
          mv.map(function (m) { return m.dropMm.toFixed(2) + ' mm'; }).join(', ') +
          ') \u2014 it would have printed in mid air.');
      } else {
        say('kcLegendWarn','');
      }
      return;
    }

    if (!rel) { say('kcLegendWarn', ''); return; }
    var topW = K.capWidth(st.sizeU) - 2 * pr.topInset, topD = K.DEPTH - 2 * pr.topInset;
    var f = ICO.checkLegendField(rel, topW, topD);
    /* Also st.skin, so this said "drawn" about generated art, always. */
    var src = st.sculpt ? 'generated' : 'drawn';
    if (f.ok) say('kcLegendWarn','');
    else say('kcLegendWarn', '⚠ ' + src + ': ' + f.issues[0], 'bad');
  }

  // ---- step 4 ------------------------------------------------------------
  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function report() {
    var el = $('kcReport'); if (!el || !built) return;
    /* One source. The report used to merge the plan with a second, separately
       computed raised-legend tilt - and only for display, so it printed a
       correct 12 degrees next to a layer count taken from the UNtilted height.
       build() folds the lean into printPlan now, so height is the leaning
       height and the clock agrees with the picture. */
    var plan = built.printPlan;
    var tilt = plan.tilt || 0;
    var supports = !!plan.supports;
    var lh = layerMm();
    var layers = Math.ceil((plan.height || built.size.z) / lh);
    var est = window.printSim ? window.printSim.estimate(PROFILE_ANY, layers) : null;
    /* The plan, so this agrees with the plate rather than re-deriving a flat
       cap that the packer never packs. */
    var per = K.perPlate(st.sizeU, null, built && built.size ? built.size.z : null,
                         built && built.printPlan);

    var money = K.costOf(built);
    var rows = [
      /* Escaped at the sink as well as whitelisted at the door. The whitelist
         is the real defence; this is what keeps the next person who adds a
         field here from having to know that. */
      ['Cap', st.profile + ' ' + st.row + ' · ' + st.sizeU + 'u' +
              (st.key ? ' (' + esc(st.key) + ')' : '')],
      ['Size', built.size.x.toFixed(1) + ' × ' + built.size.y.toFixed(1) + ' × ' + built.size.z.toFixed(2) + ' mm'],
      ['Stem', built.stemDepth.toFixed(2) + ' mm deep · ' + built.slotWidth.toFixed(2) +
               ' mm slot (' + built.slotPixels.toFixed(1) + ' px)'],
      /* ⚠️ tilt IS `plan.tilt || 0`, AND printPose RETURNS tilt: null TOGETHER
         WITH ok: false - so "no lean" and "no lean exists" collapsed into the
         same row, and a 2.75u Shift with a figure on it reported "flat, top
         face down", "410 layers at 0.05 mm" and a print time, for a cap that
         cannot be printed at all. Branch on ok first. */
      ['Orientation', plan.ok === false
        ? '<span class="warn">will not fit the plate at any lean</span>'
        : (tilt ? ('tilted ' + tilt + '°') : 'flat, top face down')],
      ['Supports', supports ? '<span class="warn">yes — on the leading edge</span>' : 'none'],
      ['Per plate', per.count + (per.count === 1 ? ' cap' : ' caps')],
      ['Layers', layers.toLocaleString() + ' at ' + lh.toFixed(3).replace(/0+$/, '').replace(/\.$/, '') +
                 ' mm' + (window.tmStatus && window.tmStatus.layerHeight ? '' : ' (assumed)')],
      ['Resin', money.resinMl.toFixed(2) + ' ml' + (money.supportsAdd ? ' incl. supports' : '')],
      ['Cost', money.cost < 0.01 ? 'under a penny' : money.cost.toFixed(2) + ' in resin']
    ];
    /* The number that decides whether this is worth making, lifted clear of
       the list rather than buried as its eighth row - unless there is no such
       number, in which case a confident "1h 47m" over a cap that cannot be
       printed is the worst thing on the card. */
    var html = plan.ok === false
      ? '<div class="kcHero kcHeroBad"><b>does not fit</b><span>' +
        esc(plan.why || 'no lean clears the build volume') + '</span></div>'
      : '<div class="kcHero"><b>' + (est ? est.text : '—') +
        '</b><span>for a full plate of ' + per.count + '</span></div>';
    html += '<dl>' + rows.map(function (r) {
      return '<dt>' + r[0] + '</dt><dd>' + r[1] + '</dd>';
    }).join('') + '</dl>';

    var notes = (built.warnings || []).slice();
    if (plan.why) notes.push(plan.why);
    /* The trade, stated rather than left to be discovered: engraving the same
       legend removes the lean, the supports and most of the print. */
    if (plan.forcedBy === 'relief') {
      var flat = K.fits(built.size.x, built.size.y, built.size.z);
      var flatLayers = Math.ceil(built.size.z / lh);
      notes.push('Engraved instead: no lean, no supports, ' +
        K.perPlate(st.sizeU, null, built.size.z).count + ' per plate and ' +
        flatLayers.toLocaleString() + ' layers instead of ' + layers.toLocaleString() + '.');
    }
    if (notes.length) html += '<div class="hint" style="margin-top:8px">' +
      notes.map(function (n) { return '• ' + n; }).join('<br>') + '</div>';
    el.innerHTML = html;
    /* A control that cannot succeed does not stay lit. All three of these end
       in K.layout(), which will place nothing. */
    var dead = plan.ok === false && !st.plate.length;
    ['kcAdd', 'kcSlice', 'kcStl'].forEach(function (id) {
      var b = $(id); if (!b) return;
      b.disabled = dead;
      b.title = dead ? (plan.why || 'this cap does not fit the plate at any lean') : '';
    });
    say('kcPlate', st.plate.length ? (st.plate.length + ' cap' + (st.plate.length > 1 ? 's' : '') +
      ' on the plate') : stemFitPlateNotice);
  }

  // ---- actions -----------------------------------------------------------
  function actionMessage(message,bad){
    say('kcState',message,bad?'bad':'');
    say('kcActionNote',message,bad?'bad':'');
    if(bad&&window.designerFeedback&&window.designerFeedback.help)window.designerFeedback.help('Action needs attention',message);
  }
  function binarySTL(pos) {
    var n = pos.length / 9, buf = new ArrayBuffer(84 + n * 50), dv = new DataView(buf);
    dv.setUint32(80, n, true);
    var o = 84;
    for (var t = 0; t < n; t++) {
      o += 12;
      for (var k = 0; k < 9; k++) { dv.setFloat32(o, pos[t * 9 + k], true); o += 4; }
      o += 2;
    }
    return new Blob([buf], { type: 'model/stl' });
  }
  function save(blob, name) {
    var u = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = u; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(u); }, 4000);
  }
  /* Anything that leaves this card - the plate, the slicer, an STL - takes
     the full-resolution mesh, not the one on screen. */
  function oriented() {
    if (!built) return null;
    return printMesh();
  }


  $('kcAdd').addEventListener('click', function () {
    try {
      var entry=printEntry(),candidate=st.plate.concat([entry]),lay=checkedLayout(candidate);
      st.plate.push(entry);
      stemFitPlateNotice='';
      say('kcPlate',lay.placed.length+' on the plate'+(lay.leftOver?', '+lay.leftOver+' need another run':''));
      if(window.designerFeedback)window.designerFeedback.notice('Added to plate · '+lay.placed.length+' cap'+(lay.placed.length===1?'':'s'));
    } catch(e){actionMessage(e.message,true);}
  });
  var slicerHandoffBusy=false;
  function sendCurrentToSlicer(){
    if(slicerHandoffBusy)return;
    var caps;
    try {caps=st.plate.length?st.plate.slice():[printEntry()];checkedLayout(caps);}
    catch(e){actionMessage(e.message,true);return;}
    if(typeof window.slicerLoadMesh!=='function'){actionMessage('The slicer is missing from this build.',true);return;}
    slicerHandoffBusy=true;
    actionMessage('Opening the slicer…');
    return kcEnsureSlicer().then(function(ready){
      if(!ready){actionMessage('Could not load the slicer engine. Check the internet connection or install the slicer files on the SD card, then try again.',true);return;}
      sendToSlicer(caps,checkedLayout(caps));
    }).catch(function(e){actionMessage(e.message||'Could not open the slicer.',true);})
      .then(function(){slicerHandoffBusy=false;});
  }
  $('kcSlice').addEventListener('click',sendCurrentToSlicer);

  /* The same on-demand load the other two callers do. slicerLoadMod is a
     top-level const in the assembled page, so it is in scope here - that is how
     meshy-ui.js reaches it too. */
  function kcEnsureSlicer() {
    if (typeof slicerMod !== 'undefined' && slicerMod) return Promise.resolve(true);
    if (typeof slicerLoadMod !== 'function') return Promise.resolve(false);
    say('kcState', 'loading the slicer engine\u2026');
    return Promise.resolve(slicerLoadMod()).then(function () {
      return (typeof slicerMod !== 'undefined' && !!slicerMod);
    }).catch(function () { return false; });
  }

  function sendToSlicer(caps, lay) {
    /* keepPose, or the slicer stands the cap back up on its "best" face and
       undoes printPose - the lean that keeps the sculpt off the plate, the
       height the clock counted, the footprint the plate was packed against.
       A dropped file has no intended pose and should be auto-oriented; a cap
       from this card has one, and it is on the screen next to the button. */
    var ok = window.slicerLoadMesh(lay.positions, (caps.length > 1 ? 'keycaps' : caps[0].name) + '.stl',
                                   lay.positions.byteLength,
                                   /* noScale: a keycap's cross slot is 1.23 mm and
                                      the slicer's auto-fit would shrink it without
                                      being asked. See slicerNoScale. */
                                   { keepPose: true, noScale: true });
    /* AND THEN TAKE THE PERSON THERE. Create shows one tool at a time, and the
       slicer lives in the OTHER one - so "Send to slicer" loaded the mesh into
       a card with display:none and reported success into a room nobody was
       looking at. The press appeared to do nothing. Splitting the rooms is what
       introduced this; the hand-off has to follow.

       The slicer's own accordion may also be shut, so open it, and then put it
       on screen. Nothing here reaches into the slicer's state: it presses the
       same toggle a person would. */
    if (ok) {
      var seg = document.querySelector(".stStageBar .stSeg button[data-st='model']");
      if (seg) seg.click();
      setTimeout(function () {
        var t = $('slicerToggle');
        if (t && window.slicerIsOpen && !window.slicerIsOpen()) t.click();
        var card = $('slicerCard');
        if (card && card.scrollIntoView) card.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 60);
    }
    actionMessage(ok ? 'Opened '+lay.placed.length+' cap'+(lay.placed.length===1?'':'s')+' in the slicer.'
      : 'The slicer refused this mesh. Export it for inspection, or correct the model issues and try again.',!ok);
    if(ok&&window.designerFeedback)window.designerFeedback.notice('Keycap opened in the slicer.');
  }


  $('kcStl').addEventListener('click', function () {
    try {
      var caps=st.plate.length?st.plate:[printEntry()],lay=checkedLayout(caps);
      save(binarySTL(lay.positions),(caps.length>1?'keycap-plate':caps[0].name)+'.stl');
      actionMessage(lay.leftOver?'Downloaded '+lay.placed.length+' of '+caps.length+' caps · '+lay.leftOver+' need another plate.':'STL download started.');
      if(window.designerFeedback)window.designerFeedback.notice('STL download started.');
    } catch(e){actionMessage(e.message,true);}
  });

  $('kcClearPlate') && $('kcClearPlate').addEventListener('click',function(){st.plate=[];stemFitPlateNotice='';say('kcPlate','Plate cleared.');});

  $('kcComb').addEventListener('click', function () {
    /* The one print that settles the only number in this engine that is still
       a guess. Five stems, 0.05 mm apart; keep the first that clicks on. */
    var comb = K.stemTestComb(1.15, 1.35, 0.05);
    save(binarySTL(comb.positions), 'stem-fit-test.stl');
    say('kcState', 'Stem test saved: '+comb.stems.map(function(s){return s.slotMm.toFixed(2);}).join(', ')+
      ' mm. Read left to right across the front row, then the next row. After printing and curing, try the coupons on your switch. Choose the snug one that seats without force, then select it under Stem fit and press Apply coupon.');
  });

  $('kcModes') && Array.prototype.forEach.call($('kcModes').querySelectorAll('button'),
    function (b) {
      b.addEventListener('click', function () { setArt(b.getAttribute('data-mode')); });
    });

  $('kcPose') && Array.prototype.forEach.call($('kcPose').querySelectorAll('button'),
    function (b) {
      b.addEventListener('click', function () {
        st.pose = b.getAttribute('data-pose');
        clearInspectSelection();
        Array.prototype.forEach.call($('kcPose').querySelectorAll('button'), function (o) {
          o.classList.toggle('on', o === b);
        });
        drawHero();
        var t = printedTilt();
        say('kcState', st.pose === 'printed'
          ? (t ? 'as printed - leaning ' + t + '\u00b0, supports on the leading edge'
               : 'as printed - flat on the plate, no supports')
          : '');
      });
    });

  function clearInspectSelection(){
    if(!$('kcInspect'))return;
    Array.prototype.forEach.call($('kcInspect').querySelectorAll('button'),function(o){o.setAttribute('aria-pressed','false');});
  }
  $('kcTop')&&$('kcTop').addEventListener('mousedown',clearInspectSelection);
  $('kcTop')&&$('kcTop').addEventListener('touchstart',clearInspectSelection,{passive:true});
  $('kcViewZoom')&&$('kcViewZoom').addEventListener('input',function(){
    var z=Number(this.value);if(!Number.isFinite(z)||z<80||z>160)return;
    if(!hero)drawHero();if(!hero)return;
    hero.stop();hero.vel=0;hero.o.fov=1.5*z/100;hero.o.maxPx=960;hero.draw();
    if($('kcViewZoomValue'))$('kcViewZoomValue').textContent=z+'%';
  });

  $('kcInspect') && Array.prototype.forEach.call($('kcInspect').querySelectorAll('button'),function(b){
    b.addEventListener('click',function(){
      var views={perspective:[-.62,.52],front:[0,0],side:[Math.PI/2,0],back:[Math.PI,0],bottom:[0,-Math.PI/2]};
      var key=b.getAttribute('data-view');if(!Object.prototype.hasOwnProperty.call(views,key))return;
      st.pose='made';
      if($('kcPose'))Array.prototype.forEach.call($('kcPose').querySelectorAll('button'),function(o){o.classList.toggle('on',o.getAttribute('data-pose')==='made');});
      drawHero();if(!hero)return;
      hero.stop();hero.vel=0;hero.az=views[key][0];hero.el=views[key][1];hero.o.maxPx=960;hero.draw();
      clearInspectSelection();b.setAttribute('aria-pressed','true');
      say('kcState','');
    });
  });

  /* A painting guide: the top of the cap straight down, big, with the relief
     shaded so you can see where the paint goes. The owner asked for this back
     when the point was photographs for painting reference. */
  $('kcPaint') && $('kcPaint').addEventListener('click', function () {
    if(st.sculpt){
      try{sculptPaintGuide();}catch(e){actionMessage(e.message,true);}
      return;
    }
    var rel = null;
    try { rel = relief(); } catch (e) {}
    if (!rel) { actionMessage('Add artwork or lettering to make a painting guide.',true); return; }
    var N = 1000, c = document.createElement('canvas');
    c.width = N; c.height = N;
    var g = c.getContext('2d'), img = g.createImageData(N, N);
    var pr = K.PROFILES[st.profile];
    var topW = K.capWidth(st.sizeU) - 2 * pr.topInset;
    var topD = K.DEPTH - 2 * pr.topInset;
    var d = Math.abs(rel.depth) || 0.55;
    for (var y = 0; y < N; y++) for (var x = 0; x < N; x++) {
      var u = (x + 0.5) / N * 2 - 1, v = 1 - (y + 0.5) / N * 2;
      var h = Math.abs(rel(u, v, topW, topD)) / d;
      var i = (y * N + x) * 4;
      var edge = Math.max(Math.abs(u), Math.abs(v)) > 0.995;
      /* High contrast on purpose: this is held next to a cap under a lamp, not
         admired on a screen. */
      var t = edge ? 0.35 : 1 - Math.min(1, h) * 0.82;
      img.data[i] = img.data[i+1] = img.data[i+2] = Math.round(255 * t);
      img.data[i+3] = 255;
    }
    g.putImageData(img, 0, 0);
    g.fillStyle = '#000';
    g.font = '600 22px ui-sans-serif,system-ui,sans-serif';
    g.fillText(topW.toFixed(1) + ' \u00d7 ' + topD.toFixed(1) + ' mm top face · ' +
               (rel.raised ? 'raised ' : 'engraved ') + d.toFixed(2) + ' mm', 24, N - 26);
    c.toBlob(function (b) {
      if (b) { save(b, 'paint-guide-' + (st.key || st.profile) + '.png');
               say('kcState', 'saved a 1000 px painting guide'); }
    }, 'image/png');
  });

  function sculptPaintGuide(){
    if(!built||!window.keycapView3d)throw new Error('The 3D preview is not ready.');
    var sheet=document.createElement('canvas');sheet.width=1200;sheet.height=1360;
    var g=sheet.getContext('2d');g.fillStyle='#12151b';g.fillRect(0,0,1200,1360);
    g.fillStyle='#f5eff2';g.font='600 30px system-ui';g.fillText((st.name||'Artisan keycap').slice(0,55),38,46);
    g.font='18px system-ui';g.fillStyle='#b5bbc6';g.fillText('PAINTING REFERENCE · '+built.size.x.toFixed(1)+' × '+built.size.y.toFixed(1)+' × '+built.size.z.toFixed(1)+' mm',38,79);
    var canvas=document.createElement('canvas');canvas.width=560;canvas.height=550;
    var view=window.keycapView3d.attach(canvas,{spin:false,interactive:false,dist:3,maxPx:560,tokens:viewTokens()});
    view.setAppearance({mode:'color',base:st.baseColor,art:st.artColor,useSourceColors:st.useSourceColors!==false},{draw:false});
    view.setMesh(built.positions,{artStart:built.seated?built.seated.capTriangles*9:built.positions.length,artColors:st.seatedColors});
    [[-.62,.52,'Three-quarter'],[0,0,'Front'],[Math.PI/2,0,'Side'],[Math.PI,0,'Back']].forEach(function(p,i){
      view.az=p[0];view.el=p[1];view.draw();var x=20+(i%2)*590,y=102+Math.floor(i/2)*585;
      g.drawImage(canvas,x,y,560,550);g.fillStyle='#e8dde2';g.font='20px system-ui';g.fillText(p[2],x+18,y+561);
    });
    view.stop();
    g.font='18px system-ui';g.fillStyle='#b5bbc6';
    g.fillText(st.sourceColors&&st.useSourceColors!==false?'Original model colors (sampled) + selected cap color':'Custom color plan · model has no active source colors',38,1301);
    g.fillText('Reference only · STL and resin output do not contain these colors.',38,1333);
    sheet.toBlob(function(blob){if(!blob){actionMessage('Could not create the painting guide.',true);return;}
      save(blob,'paint-guide-'+(st.name||st.key||'artisan').replace(/[^a-z0-9_-]+/gi,'-').slice(0,65)+'.png');
      actionMessage('Four-view painting guide downloaded.');if(window.designerFeedback)window.designerFeedback.notice('Painting guide download started.');
    },'image/png');
  }

  // ---- the current design, as something that can be written down ---------
  function designOf() {
    return { profile: st.profile, row: st.row, sizeU: st.sizeU,
             icon: st.icon || undefined, digit: st.digit || undefined,
             braille: st.braille || undefined, depth: st.depth, raised: st.raised,
             sculptHeightMm: knownSculptHeight(st.sculptHeightMm)?st.sculptHeightMm:undefined,
             meshyPolycount: st.meshyPolycount, meshyUltra:st.meshyUltra===true, sculptStyle: st.sculptStyle,
             sculptRotationDeg:st.sculptRotationDeg||0,sculptScalePercent:st.sculptScalePercent||100,
             colorMode:st.colorMode||'solid',baseColor:st.baseColor||'#f3bdd6',artColor:st.artColor||'#a9dbcc',useSourceColors:st.useSourceColors!==false,
             /* st.skin was NEVER ASSIGNED A VALUE - null in six places, a
                value in none - so this read `undefined` every single time and
                no share code has ever carried the prompt that made the cap.
                isReproducible() is `!(prompt && !icon && !braille)`, so with no
                prompt it answered TRUE for every generated cap, and the warning
                that the art will come back DIFFERENT could never fire. */
             prompt: st.skinFrom || undefined,
             /* Not `|| undefined`: false is the value worth sending. */
             legendOn: st.legendOn !== false,
             key: st.key || undefined, name: st.name || undefined };
  }
  function applyDesign(d) {
    cancelArtisanStyleDraft(false);
    restoreSculptSettings(d,true);
    restoreReference(d);
    /* Fed by share codes, so this is the one an outsider can aim at. */
    /* Before setArt(), which reads legendOn() while it renders. A code from
       before the field existed has no 'l' and gets today's default, which is
       on - the behaviour those codes were made under. */
    st.legendOn = d.legendOn !== false;
    var dp = knownProfile(d.profile);
    if (dp) st.profile = dp;
    st.row = knownRow(st.profile, d.row);
    /* A SHARE CODE IS SOMEBODY ELSE'S TEXT, and this one reaches innerHTML
       through report()'s 'Cap' row. d.profile, d.row and d.key all go through
       whitelists; sizeU went through nothing at all, so a code carrying
       sizeU: '<img src=x onerror=...>' ran script on the origin that holds the
       Meshy key and can start prints. A key width is a number between 1 and 7.
       Say so, at the door, like the other three. */
    st.sizeU = knownSizeU(d.sizeU, st.sizeU);
    /* THE MODE HAS TO BE CHOSEN FIRST, and it was never chosen at all. A code
       carrying Braille restored st.braille, filled #kcBraille and said "Opened"
       - but left st.art as whatever it already was, and relief() only reaches
       the Braille branch when st.art === 'braille'. On a freshly loaded page
       that is 'gen', so relief() fell through to `if (!st.icon && !st.digit)
       return null` and the dots never reached build(). The cap was previewed,
       plated, sliced and exported blank, with the pasted letter sitting in a
       panel that was hidden. It has to come first because setArt() clears the
       fields belonging to other modes - set it after and it erases what it was
       meant to restore. */
    setArt(d.braille ? 'braille' : d.prompt ? 'gen' : d.icon ? 'lib' : 'gen');
    st.icon = d.icon || null;
    st.digit = d.digit || '';
    st.braille = d.braille || '';
    if (d.depth) st.depth = d.depth;
    paintSculptSettings();
    st.raised = d.raised !== false;
    st.key = safeKeyLabel(d.key);
    st.name = typeof d.name === 'string' ? d.name.slice(0, 120) : '';
    dropSculpt();                     // a mesh cannot travel in a code
    st.skinFrom = d.prompt || '';
    if ($('kcDigit')) $('kcDigit').value = st.digit;
    if ($('kcBraille')) $('kcBraille').value = st.braille;
    if ($('kcDepth')) $('kcDepth').value = st.depth;
    if ($('kcDepthVal')) $('kcDepthVal').textContent = st.depth.toFixed(2);
    if ($('kcPrompt') && d.prompt) $('kcPrompt').value = d.prompt;
    setFinish(st.raised);
    drawProfiles(); drawRows(); drawIcons(); caliper(st.sizeU); refresh();
    paintLegendRow();          // the checkbox and the state agree
  }

  // ---- share, and open what was shared ------------------------------------
  $('kcShare') && $('kcShare').addEventListener('click', function () {
    if (!built || !window.keycapShare) return;
    var SH = window.keycapShare, design = designOf(), code = SH.encode(design);
    var css = getComputedStyle(document.documentElement);
    var tok = {};
    ['text','muted','subh','card','line','accent','warncol'].forEach(function (k) {
      tok[k] = css.getPropertyValue('--' + k).trim();
    });
    var cs = getComputedStyle($('kcCard'));
    tok.sweep = cs.getPropertyValue('--kSweep').trim();
    tok.floor = cs.getPropertyValue('--kFloor').trim();
    var money = K.costOf(built);
    var plan = built.printPlan;
    /* ⚠️ NO BRANCH ON tilt. When the lean is zero this fell back to
       built.size.z - mouthZ, measured in KEYBOARD space - and that is not the
       height the cap stands at once orientForPrint has laid its top face on
       the plate. keycap.js:426 documents fixing exactly this ("on a 13-degree
       row that is a different height from the one measured here, so the layer
       count and the clock derived from it were short by up to five per cent")
       and printPlan.height is already the measured one for every lean,
       including none. report() a few hundred lines up uses it unconditionally;
       the share card - the picture somebody signs off on - did not. */
    var layers = Math.ceil((plan.height || built.size.z) / layerMm());
    var est = window.printSim ? window.printSim.estimate(PROFILE_ANY, layers) : null;
    var card;
    try {
      card = SH.shareCard({
        canvas: $('kcTop'), tokens: tok, code: code,
        title: st.name || (st.key ? st.key + ' · ' + st.profile + ' ' + st.row
                                  : st.profile + ' ' + st.row + ' ' + st.sizeU + 'u'),
        subtitle: SH.describe(design),
        stats: [['size', built.size.x.toFixed(1) + ' × ' + built.size.y.toFixed(1) +
                          ' × ' + built.size.z.toFixed(1) + ' mm'],
                ['resin', money.resinMl.toFixed(2) + ' ml'],
                ['time', est ? est.text : '—']],
        /* Say it on the picture, not afterwards: a generated sculpt does not
           come back the same, so approving this image approves THIS cap, not
           whatever the code regenerates. */
        warn: SH.isReproducible(design) ? '' :
          'The art was generated. Re-opening this code makes the same cap with different art.'
      });
    } catch (e) { actionMessage(e.message,true); return; }

    card.toBlob(function (blob) {
      if (!blob) { actionMessage('Could not make the share picture.',true); return; }
      var file = null;
      try { file = new File([blob], 'keycap.png', { type: 'image/png' }); } catch (e) {}
      /* On a phone this opens the share sheet, which is the actual "send it to
         someone" path. Everywhere else it saves the picture. */
      var delivery;
      try{
        if(file&&navigator.canShare&&navigator.share&&navigator.canShare({files:[file]})){
          delivery=Promise.resolve(navigator.share({files:[file],text:code})).then(function(){return 'Shared picture';},function(e){
            if(e&&e.name==='AbortError'){actionMessage('Sharing canceled.');return null;}
            save(blob,'keycap-'+(st.key||st.profile)+'.png');return 'Sharing unavailable · picture downloaded';
          });
        }else{save(blob,'keycap-'+(st.key||st.profile)+'.png');delivery=Promise.resolve('Picture downloaded');}
      }catch(e){save(blob,'keycap-'+(st.key||st.profile)+'.png');delivery=Promise.resolve('Picture downloaded');}
      /* "code copied" WAS A LIE ON THIS MACHINE. navigator.clipboard only
         exists in a secure context, and the printer serves the dashboard over
         plain HTTP on the LAN - so on the one device this product is used from,
         the object is undefined, the guard is false, nothing is copied, and the
         card said it had been. The person then pastes an old clipboard into a
         message and wonders why the cap is wrong.

         So: try the modern API, fall back to the old execCommand trick which
         still works on an insecure origin, and only say "copied" if one of them
         actually reported success. If neither did, show the code so it can be
         read off the screen - useless is better than false. */
      delivery.then(function(label){if(!label)return;return copyText(code).then(function(ok){
        actionMessage(label+(ok?' · design code copied.':'.'));
        if(window.designerFeedback){window.designerFeedback.notice(label+(ok?' · code copied.':'.'));
          if(!ok)window.designerFeedback.help('Copy this design code',code);}
      });}).catch(function(e){actionMessage(e.message||'Could not share this design.',true);});
      try { window.keycapShare.save(design, { name: st.name || SH.describe(design) }); }
      catch (e) { say('kcState', e.message, 'bad'); }
    }, 'image/png');
  });

  /* One copy, honest about whether it worked. */
  function copyText(text) {
    return new Promise(function (res) {
      try {
        if (navigator.clipboard && window.isSecureContext) {
          navigator.clipboard.writeText(text).then(function () { res(true); },
                                                   function () { res(legacyCopy(text)); });
          return;
        }
      } catch (e) {}
      res(legacyCopy(text));
    });
  }
  function legacyCopy(text) {
    try {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;top:-1000px;opacity:0';
      document.body.appendChild(ta);
      ta.select(); ta.setSelectionRange(0, text.length);
      var ok = document.execCommand && document.execCommand('copy');
      document.body.removeChild(ta);
      return !!ok;
    } catch (e) { return false; }
  }
  window.keycapCopyText = copyText;

  $('kcLoad') && $('kcLoad').addEventListener('click', function () {
    var raw = ($('kcCode').value || '').trim();
    if (!raw) { say('kcCodeNote', 'Paste a code first.', 'bad'); return; }
    try {
      var d = window.keycapShare.decode(raw);
      applyDesign(d);
      say('kcCodeNote', 'Opened: ' + window.keycapShare.describe(d) +
        (window.keycapShare.isReproducible(d) ? ''
          : ' — the art was generated, so press Generate to make it again; it will not be identical.'),
        window.keycapShare.isReproducible(d) ? '' : 'bad');
      go(2);
    } catch (e) { say('kcCodeNote', e.message, 'bad'); }
  });

  // ---- controls ----------------------------------------------------------
  function setFinish(raised) {
    st.raised = !!raised;
    var box = $('kcRaised'); if (box) box.checked = st.raised;
    var seg = $('kcFinish'); if (!seg) return;
    Array.prototype.forEach.call(seg.querySelectorAll('button'), function (b) {
      b.classList.toggle('on', (b.getAttribute('data-raised') === '1') === st.raised);
    });
  }
  $('kcFinish') && Array.prototype.forEach.call($('kcFinish').querySelectorAll('button'),
    function (b) {
      b.addEventListener('click', function () {
        st.touchedFinish = true;
        setFinish(b.getAttribute('data-raised') === '1');
        refresh();
      });
    });

  $('kcBraille') && $('kcBraille').addEventListener('input', function () {
    st.braille = (this.value || '').trim().slice(0, 2);
    if (st.braille && window.keycapBraille) {
      var pr = K.PROFILES[st.profile];
      var chk = window.keycapBraille.check(st.braille,
        K.capWidth(st.sizeU) - 2 * pr.topInset, K.DEPTH - 2 * pr.topInset,
        { dotHeight: Math.max(0.48, st.depth) });
      /* This used to write straight into #kcLegendWarn and then call refresh(),
         which runs legendWarn() and writes over it about a tenth of a second
         later - so the Braille fit warning flashed and was replaced by a legend
         check that knows nothing about dots. Hand it to legendWarn instead and
         let the one function that owns that line render it. */
      brailleNote = chk.ok ? chk.notes[0] : '\u26a0 ' + chk.issues[0];
      brailleBad = !chk.ok;
      // Braille must be raised; a recess is not readable
      if (!st.raised) setFinish(true);
    } else { brailleNote = ''; brailleBad = false; }
    refresh();
  });

  function paintLegendRow() {
    var box = $('kcLegendOn');
    if (!box) return;
    var on = st.legendOn !== false;
    box.checked = on;
    var row = box.closest('.kcLegendRow');
    if (row) row.classList.toggle('off', !on);
    if ($('kcDigit')) $('kcDigit').disabled = !on;
    /* Say WHICH character, not just that there is one - the whole point is that
       the board filled it in without being asked, and a switch labelled
       "Legend" does not tell you what it is about to remove. */
    var w = $('kcLegendWhich');
    if (w) w.textContent = !on
      ? 'No lettering added; your artwork stays unchanged'
      : (st.digit ? 'currently "' + st.digit + '", from the key you picked'
                  : 'this key has no single character, so nothing is added');
  }

  $('kcLegendOn') && $('kcLegendOn').addEventListener('change', function () {
    st.legendOn = this.checked;
    paintLegendRow();
    refresh();
  });

  window.keycapPaintLegendRow = paintLegendRow;

  $('kcDigit').addEventListener('input', function () {
    st.digit = (this.value || '').trim().slice(0, 1); refresh();
  });
  $('kcDepth').addEventListener('input', function () {
    st.touchedFinish = true;
    st.depth = parseFloat(this.value);
    paintSculptSettings();
    $('kcDepthVal').textContent = st.depth.toFixed(2);
    refresh();
  });
  $('kcNext').addEventListener('click', function () {
    if (st.step < 4) { go(st.step + 1); return; }
    /* At step 4 it IS the forward action, not a label. Delegating to the
       existing button keeps one implementation of "send this to the slicer",
       including its engine-loading and its refusals. */
    sendCurrentToSlicer();
  });
  $('kcBack').addEventListener('click', function () { go(Math.max(1, st.step - 1)); });
  Array.prototype.forEach.call($('kcSteps').children, function (li) {
    li.setAttribute('role','button');li.setAttribute('tabindex','0');
    li.addEventListener('keydown',function(e){if(e.key==='Enter'||e.key===' '){e.preventDefault();li.click();}});
    li.addEventListener('click', function () {
      var n = +li.getAttribute('data-step');
      if (n === 1 || st.key) go(n);
    });
  });

  setArt(st.art);
  drawShelf();
  setFinish(st.raised);

  /* Two doors for the studio shell, and no more than two. It relocates this
     card into the Create room and needs to (a) put a saved design back when
     one is picked in the Library room and (b) tell the canvases to re-measure
     after the stage they live in has been shown or resized. Both already
     existed as private functions; exporting them beats the shell reaching
     into this module's internals, which is the thing that rots. */
  window.keycapUseSaved = useSaved;
  $('kcProductName')&&$('kcProductName').addEventListener('input',function(){
    st.name=this.value.slice(0,120);rememberSession();paintProductState();
  });
  $('kcSaveProduct')&&$('kcSaveProduct').addEventListener('click',function(){
    if(artisanStyleDraft||($('kcGen')&&$('kcGen').disabled))return;
    this.disabled=true;
    keepCurrent(st.skinFrom||st.name||'Artisan keycap').then(paintProductState);
  });
  $('kcDownloadProduct')&&$('kcDownloadProduct').addEventListener('click',function(){
    try{
      if(!lastSavedProduct||lastSavedProduct.source!==st.sculpt||lastSavedProduct.key!==currentProductKey(window.keycapShare.encode(designOf())))throw new Error('Save the current product before downloading it.');
      var blob=window.keycapProduct.toSTL(lastSavedProduct.product);
      save(blob,(st.name||st.key||'artisan-keycap').replace(/[^a-z0-9_-]+/gi,'-').slice(0,80)+'.stl');
      if(window.designerFeedback)window.designerFeedback.notice('Product STL download started.',{kind:'success'});
    }catch(e){say('kcProductStatus',e.message,'bad');}
  });
  window.keycapRefresh = function () { try { refresh(); } catch (e) {} };
  /* restoreSession() runs before drawBoard(), so anything it throws takes the
     entire card's initialisation with it and leaves an empty panel that says
     nothing about why. A session is a convenience; the card is not. */
  try { restoreSession(); paintArt(st.art); }
  catch (e) {
    try { localStorage.removeItem(SESSION); } catch (e2) {}
    say('kcState', 'the saved session was unreadable and has been cleared', 'bad');
  }
  bindSculptSettings();bindReference();paintReference();bindStemFit();bindArtisanGallery();restoreArtisanStyleDraft();
  $('kcDepth').value = st.depth;
  $('kcDepthVal').textContent = st.depth.toFixed(2);
  drawBoard(); drawProfiles(); drawRows(); drawIcons();
  /* The step the owner left off on, applied AFTER everything is drawn. This
     used to be a bare go(1) and it is why the card always opened on the
     keyboard however far through you were. */
  go(restoredStep);
})();
