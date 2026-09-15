(function () {
  'use strict';
  function $(id){return document.getElementById(id);}
  if(!$('topperCard')||!window.topper)return;
  var built=null,art=null,artName='',viewer=null,revision=0,sourceRevision=0,saving=false,generating=false,artReadRevision=null;
  var ids=['tpPreset','tpModel','tpShape','tpWidth','tpSecondWidth','tpDepth','tpWall','tpFit','tpArtHeight','tpArtRotation','tpPrompt'];
  var draftReady=!window.indexedDB,draftWriting=false,pendingDraft=null,fitStored=false,pendingGenerated=null;
  function note(s,bad){$('tpState').textContent=s||'';$('tpState').hidden=!s;$('tpState').className='hint'+(bad?' warn':'');}
  function draftNote(s,bad){$('tpDraftState').textContent=bad?s||'':'';$('tpDraftState').hidden=!bad;$('tpDraftState').className='hint'+(bad?' warn':'');}
  function completed(s){note('');if(window.designerFeedback)window.designerFeedback.notice(s,{kind:'success'});else note(s);}
  function fields(){var out={};ids.forEach(function(id){out[id]=$(id).value;});return out;}
  // Keep the original artwork with its settings, separately from Library models.
  // IndexedDB commits the pair atomically; never put large meshes in localStorage.
  function draftStore(mode,value){return new Promise(function(resolve,reject){
    var request,failed=false;try{request=window.indexedDB.open('tmTopperDraft',1);}catch(e){reject(e);return;}
    request.onupgradeneeded=function(){if(!request.result.objectStoreNames.contains('draft'))request.result.createObjectStore('draft');};
    request.onerror=function(){failed=true;reject(request.error||new Error('Browser storage is unavailable.'));};
    request.onblocked=function(){failed=true;reject(new Error('Another tab is holding draft storage open.'));};
    request.onsuccess=function(){var db=request.result,tx,read;
      if(failed){db.close();return;}
      try{tx=db.transaction('draft',mode);var store=tx.objectStore('draft');if(mode==='readonly')read=store.get('current');else store.put(value,'current');}
      catch(e){db.close();reject(e);return;}
      tx.oncomplete=function(){db.close();resolve(read?read.result:null);};
      tx.onerror=tx.onabort=function(){db.close();reject(tx.error||new Error('Browser storage could not keep this draft.'));};
    };
  });}
  function persistDraft(){
    if(!draftReady)return;
    if(!window.indexedDB){draftNote(art?'Artwork will not survive a reload in this browser. Save to Library or export the STL.':fitStored?'Fit settings are kept in this browser.':'Browser storage is unavailable. Export before leaving; settings will not survive a reload.',!!art||!fitStored);return;}
    draftNote('Saving draft in this browser…');
    pendingDraft={version:1,fields:fields(),art:art,artName:artName,revision:revision,pendingGenerated:pendingGenerated};
    if(draftWriting)return;
    draftWriting=true;
    (async function(){while(pendingDraft){var next=pendingDraft;pendingDraft=null;
      try{await draftStore('readwrite',next);if(next.revision===revision)draftNote('Draft kept in this browser · use Save to Library to keep a finished model.');}
      catch(e){if(next.revision===revision)draftNote('Draft was not kept: '+e.message+' Save to Library or export before leaving.',true);}
    }draftWriting=false;})();
  }
  function flip(p,z){var out=new Float32Array(p.length);for(var i=0;i<p.length;i+=9)for(var k=0;k<3;k++){var a=i+[0,2,1][k]*3,b=i+k*3;out[b]=p[a];out[b+1]=p[a+1];out[b+2]=z-p[a+2];}return out;}
  function bounds(p){var lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];for(var i=0;i<p.length;i+=3)for(var k=0;k<3;k++){lo[k]=Math.min(lo[k],p[i+k]);hi[k]=Math.max(hi[k],p[i+k]);}return {lo:lo,hi:hi,size:hi.map(function(v,k){return v-lo[k];})};}
  function params(f){f=f||fields();return {preset:f.tpPreset,modelLabel:f.tpModel.trim(),socketShape:f.tpShape,diameterMm:Number(f.tpWidth)||NaN,acrossFlatsMm:Number(f.tpWidth)||NaN,secondAxisMm:Number(f.tpSecondWidth)||NaN,clearanceMm:Number(f.tpFit),socketDepthMm:Number(f.tpDepth),wallMm:Number(f.tpWall),roofMm:2};}
  function make(candidateArt,settings){
    var f=settings||fields();
    var sculpt=arguments.length?candidateArt:art;
    var b=window.topper.build(params(f));if(b.ok===false)throw new Error((b.issues||['Invalid topper dimensions.']).join(' '));
    var bb=bounds(b.positions),cap={positions:flip(b.positions,bb.hi[2]),size:{x:bb.size[0],y:bb.size[1],z:bb.size[2]},angle:0,dishDepth:0,sizeU:1};
    var down=cap.positions,artSize=null;
    if(sculpt){var S=window.keycapSculpt;if(!S)throw new Error('Sculpt tools are unavailable.');
      var height=Number(f.tpArtHeight);if(!Number.isFinite(height)||height<3||height>28)throw new Error('Choose a sculpt height from 3 to 28 mm.');
      var seated=S.seat(cap,sculpt,{heightMm:height,rotationDeg:Number(f.tpArtRotation),spread:1.35,pitch:28,pitchD:28,bite:.8});
      var check=S.check(seated,{pitch:28,pitchD:28});if(!check.ok)throw new Error(check.issues.join(' '));down=seated.positions;artSize=seated.sculptMm||null;
    }
    var out=flip(down,bb.hi[2]),bo=bounds(out);for(var i=2;i<out.length;i+=3)out[i]-=bo.lo[2];
    if(bo.size[0]>35.8||bo.size[1]>25.6||bo.size[2]>50)throw new Error('This topper needs to be smaller to leave room for supports on the TinyMaker bed.');
    var h=window.meshHealth&&window.meshHealth(out);if(h&&(h.fatal||h.severity==='bad'))throw new Error('Topper geometry did not pass the mesh check.');
    return {positions:out,preview:down,size:bo.size,params:params(f),artSize:artSize,artHeightMm:Number(f.tpArtHeight),artRotationDeg:Number(f.tpArtRotation)};
  }
  function refresh(keepRevision){if(keepRevision!==true)revision++;built=null;note('');try{built=make();$('tpDims').textContent=built.size.map(function(v){return v.toFixed(2);}).join(' × ')+' mm';
      if(!viewer&&window.keycapView3d)viewer=window.keycapView3d.attach($('tpPreview'),{spin:false});if(viewer)viewer.setMesh(built.preview);
    }catch(e){note(e.message,true);$('tpDims').textContent='Enter valid dimensions to build a topper.';if(viewer)viewer.setMesh(null);}
    ['tpSave','tpSlice','tpExport'].forEach(function(id){$(id).disabled=!built||(id==='tpSave'&&saving);});$('tpFitValue').textContent=Number($('tpFit').value).toFixed(2)+' mm';
    var oval=$('tpShape').value==='oval';$('tpSecondWidth').hidden=!oval;$('tpSecondLabel').hidden=!oval;$('tpSecondWidth').disabled=!oval;
    $('tpArtRotation').disabled=!art;$('tpClearArt').disabled=!art;$('tpRotationValue').textContent=Number($('tpArtRotation').value)+'°';
    $('tpArtSize').textContent=built&&built.artSize?['x','y','z'].map(function(k){return built.artSize[k].toFixed(2);}).join(' × ')+' mm':'';$('tpArtSize').hidden=!(built&&built.artSize);
    try{localStorage.setItem('tmTopperFit',JSON.stringify(fields()));fitStored=true;}catch(e){fitStored=false;}
    persistDraft();
    paintGeneration();
  }
  function binary(p){var buf=new ArrayBuffer(84+p.length/9*50),d=new DataView(buf);d.setUint32(80,p.length/9,true);for(var i=0;i<p.length/9;i++)for(var j=0;j<9;j++)d.setFloat32(84+i*50+12+j*4,p[i*9+j],true);return new Blob([buf],{type:'model/stl'});}
  function name(){return 'Topper-'+($('tpModel').value.trim()||$('tpPreset').value);}
  function generationNote(s,bad){var n=$('tpGenState');if(!n)return;n.textContent=s||'';n.hidden=!s;n.className='hint'+(bad?' warn':'');}
  function pendingTask(){return window.meshy&&window.meshy.pending?window.meshy.pending():null;}
  function activeCandidate(){return pendingGenerated&&pendingGenerated.active!==false;}
  function detachCandidate(){
    // Keep paid artwork recoverable, but Save must follow the source the user
    // explicitly chose after a failed assembly, rather than restoring it.
    if(pendingGenerated){pendingGenerated.active=false;generationNote('Previous Meshy artwork is kept. Use Recover to return to it.');}
  }
  function requireDraft(){
    if(!draftReady)throw new Error('Wait for your saved topper draft to finish loading.');
    if(artReadRevision!==null)throw new Error('Wait for the selected artwork to finish loading.');
    if(generating)throw new Error('Wait for artwork generation to finish.');
  }
  function cancelArtworkRead(){artReadRevision=null;$('tpArtFile').value='';}
  function paintGeneration(){
    var task=pendingTask(),other=task&&task.from!=='topper',go=$('tpGenerate'),recover=$('tpRecover');
    if(go){go.disabled=generating||saving||artReadRevision!==null||!!other||!draftReady;go.textContent=generating?'Working…':art||task&&task.from==='topper'?'Regenerate artwork + cap':'Generate artwork + cap';
      go.title=other?'Recover the task in '+(task.from==='model'?'Models':'Keycaps')+' before starting a topper.':'';}
    if(recover){recover.hidden=!(task&&task.from==='topper');recover.disabled=generating||saving||artReadRevision!==null||!draftReady;}
    if(generating)['tpSave','tpSlice','tpExport','tpFitTest','tpArtFile','tpClearArt'].forEach(function(id){if($(id))$(id).disabled=true;});
    else {
      var waiting=!draftReady||artReadRevision!==null;
      $('tpSave').disabled=waiting||saving||!built&&!activeCandidate();$('tpSlice').disabled=waiting||!built;$('tpExport').disabled=waiting||!built;
      if($('tpFitTest')){
        var fitReady=!!built;
        if(!fitReady&&!waiting)try{make(null);fitReady=true;}catch(e){}
        $('tpFitTest').disabled=waiting||!fitReady;
      }
      $('tpArtFile').disabled=false;$('tpClearArt').disabled=!art&&artReadRevision===null;
    }
  }
  function recipe(f){
    var r={version:1,fields:f||fields()},out={};
    ids.forEach(function(id){var v=r.fields[id];if(typeof v!=='string'||v.length>(id==='tpPrompt'?180:id==='tpModel'?60:200))throw new Error('Topper settings are incomplete or too long.');out[id]=v;});
    if(!Number.isFinite(Number(out.tpArtHeight))||Number(out.tpArtHeight)<3||Number(out.tpArtHeight)>28||
      !Number.isFinite(Number(out.tpArtRotation))||Number(out.tpArtRotation)<0||Number(out.tpArtRotation)>360)throw new Error('Choose a sculpt height from 3 to 28 mm and a rotation from 0 to 360°.');
    make(null,out);return {version:1,fields:out};
  }
  function readRecipe(raw){var d=typeof raw==='string'?JSON.parse(raw):raw;if(!d||d.version!==1||!d.fields)throw new Error('The saved topper recipe is unavailable. Your Meshy task is still recoverable.');return recipe(d.fields);}
  function applyRecipe(r){ids.forEach(function(id){$(id).value=r.fields[id];});}
  function sourceOkay(p){
    if(!(p instanceof Float32Array)||!p.length||p.length%9||p.length>2700000)throw new Error('Choose artwork with at most 300,000 triangles.');
    var h=window.meshHealth&&window.meshHealth(p);if(!h||h.fatal||h.severity==='bad')throw new Error('The generated artwork did not pass the mesh check. Its Meshy task is kept for recovery.');
    return p;
  }
  function fittedRecord(x,r,source,label,id){return {id:id||undefined,name:label||'Topper-'+(r.fields.tpModel.trim()||r.fields.tpPreset),kind:'model',positions:x.positions,
    prompt:r.fields.tpPrompt||'Decorative back-end topper'+(artName?' · '+artName:''),topperRecipe:r,topperSource:source?new Float32Array(source):null,
    facts:{sizeMm:x.size,sourceTool:'topper',topper:x.params,artHeightMm:x.artHeightMm,artRotationDeg:x.artRotationDeg}};}
  async function finishGenerated(data,useCurrent,stamp){
    var r=useCurrent?recipe():readRecipe(data.recipe);data.recipe=r;pendingGenerated=data;persistDraft();
    var x=make(data.positions,r.fields);
    if(!window.keycapLibrary)throw new Error('Library is unavailable. The task is kept for recovery.');
    var rec=await window.keycapLibrary.save(fittedRecord(x,r,data.positions,'Topper · '+r.fields.tpPrompt.slice(0,70),'topper-'+data.deliveryId));
    if(!rec||!rec.id)throw new Error('Library did not confirm this save. The task is kept for recovery.');
    var ack=window.meshy&&window.meshy.acknowledge&&window.meshy.acknowledge(data.deliveryId);
    if(pendingGenerated===data)pendingGenerated=null;
    var applied=stamp===revision;
    if(applied){applyRecipe(r);sourceRevision++;art=data.positions;artName=r.fields.tpPrompt||'Meshy topper';$('tpArtName').textContent=artName;refresh();
      completed('Fitted topper saved to Library.');}
    else {persistDraft();generationNote('Finished topper saved to Library. Your newer editor changes were kept.');}
    if(!ack)generationNote('Topper saved. Its recovery record is still present; Recover can retry without generating again.',true);
    else if(applied)generationNote('');
    return rec;
  }
  async function acceptGeneration(state,r,stamp){
    if(!state||!state.glb||!state.deliveryId)throw new Error('Meshy did not return a recoverable model.');
    var parsed=window.meshyParseGLB(state.glb),p=sourceOkay(parsed.positions);
    var data={positions:p,recipe:r,deliveryId:state.deliveryId,active:stamp===revision};pendingGenerated=data;persistDraft();
    return finishGenerated(data,false,stamp);
  }
  function failGeneration(e){generationNote((e&&e.message||'Generation could not finish.')+(activeCandidate()?' Adjust the fit or sculpt height, then Save to Library to retry locally.':pendingGenerated?' Use Recover to return to the kept Meshy artwork.':'') ,true);}
  async function recoverTopper(useCurrent){
    if(generating||saving||artReadRevision!==null||!draftReady)return false;var task=pendingTask();if(!task||task.from!=='topper')return false;
    if(!useCurrent&&pendingGenerated&&pendingGenerated.active===false){generationNote('Previous Meshy artwork is kept. Use Recover to return to it.');return false;}
    var stamp=revision;generating=true;paintGeneration();generationNote('Recovering existing Meshy artwork…');
    try{
      if(pendingGenerated&&pendingGenerated.deliveryId===task.id){pendingGenerated.active=true;return await finishGenerated(pendingGenerated,!!useCurrent,stamp);}
      var r=readRecipe(task.topperRecipe||task.opts&&task.opts.topperRecipe);
      if(!window.meshy.hasKey())throw new Error('Set your Meshy API key in AI settings in this browser, then Recover.');
      var state=await window.meshy.resume(function(m){generationNote(m);});return await acceptGeneration(state,r,stamp);
    }catch(e){failGeneration(e);return false;}finally{generating=false;paintGeneration();}
  }
  async function generateTopper(){
    if(generating||saving)return;var stamp=revision;
    try{
      requireDraft();
      if(!window.meshy||!window.meshyParseGLB)throw new Error('Meshy tools are unavailable. Reload the page.');
      if(!window.meshy.hasKey())throw new Error('Set your Meshy API key in AI settings in this browser. No generation was submitted.');
      var r=recipe(),subject=r.fields.tpPrompt.trim();if(!subject)throw new Error('Describe the cute artwork you want first.');
      var task=pendingTask();if(task&&task.from!=='topper')throw new Error('Recover the existing task in '+(task.from==='model'?'Models':'Keycaps')+' before generating a topper.');
      // Own the button while the confirmation is open as well as during HTTP.
      // Two modal promises must not unlock one another's in-flight generation.
      generating=true;paintGeneration();
      if(art||task){
        var q='Generate new Meshy artwork using credits? Your current topper stays until the new one is fitted and saved.'+(task?' This replaces the previous task recovery record; its artwork remains in Meshy history.':'');
        var yes=typeof uiConfirm==='function'?await uiConfirm(q,{ok:'Generate new artwork',cancel:'Keep current'}):typeof confirm==='function'&&confirm(q);
        if(!yes)return;if(stamp!==revision)throw new Error('Topper settings changed. Review them and generate again.');
        if(task&&(!window.meshy.forgetPending||!window.meshy.forgetPending(task.id)))throw new Error('The pending task changed. Recover it first.');
      }
      generating=true;pendingGenerated=null;paintGeneration();generationNote('Asking Meshy for topper artwork…');
      var base=make(null,r.fields),width=Math.min(26,Math.max(base.size[0],base.size[1])*1.35);
      var prompt='Decorative pencil or stylus topper sculpture: '+subject+'. Cute collectible artisan design, rounded expressive forms, a large readable face when a character, compact seated silhouette, chunky connected details. Exactly one subject; no duplicate ears or limbs. Solid flat underside, one connected watertight mesh. Decoration only: no pencil, no socket, no hole, no keycap, no pedestal. Printable at '+width.toFixed(1)+' mm wide and '+Number(r.fields.tpArtHeight).toFixed(1)+' mm tall; no detached parts or details thinner than 0.65 mm.';
      var state=await window.meshy.generate(prompt,{polycount:100000,refine:false,ultra:false,from:'topper',topperRecipe:JSON.stringify(r)},function(m){generationNote(m);});
      return await acceptGeneration(state,r,stamp);
    }catch(e){failGeneration(e);}finally{generating=false;paintGeneration();}
  }
  if($('tpGenerate'))$('tpGenerate').addEventListener('click',generateTopper);
  if($('tpRecover'))$('tpRecover').addEventListener('click',function(){return recoverTopper(true);});
  window.topperUseSaved=function(rec){
    if(!rec||!rec.topperRecipe)throw new Error('The saved topper has no editable recipe.');
    var r=readRecipe(rec.topperRecipe),p=rec.topperSource?sourceOkay(new Float32Array(rec.topperSource)):null;make(p,r.fields);
    applyRecipe(r);cancelArtworkRead();sourceRevision++;art=p;artName=p?r.fields.tpPrompt||rec.name||'Saved topper':'';detachCandidate();
    $('tpArtName').textContent=artName||'Plain socket';refresh();if(!pendingGenerated)generationNote('');return true;
  };
  if(typeof window.addEventListener==='function')window.addEventListener('storage',paintGeneration);
  if(typeof setInterval==='function')setInterval(paintGeneration,1500);
  ids.forEach(function(id){$(id).addEventListener(id==='tpFit'||id==='tpArtRotation'?'input':'change',function(){
    if(id==='tpPreset'){
      var v=$('tpPreset').value;$('tpShape').value=v==='pencil-hex'?'hex':'round';
      $('tpWidth').value=v.indexOf('pencil-')===0?'7':'';$('tpModel').value='';
    }refresh();
  });});
  function tweak(d){$('tpFit').value=Math.max(0,Math.min(.6,Number($('tpFit').value)+d)).toFixed(2);refresh();}
  $('tpTight').addEventListener('click',function(){tweak(.02);});$('tpLoose').addEventListener('click',function(){tweak(-.02);});
  $('tpClearArt').addEventListener('click',function(){cancelArtworkRead();sourceRevision++;art=null;artName='';detachCandidate();$('tpArtName').textContent='Plain socket';refresh();if(built)completed('Sculpt cleared. Your socket fit is unchanged.');});
  $('tpArtFile').addEventListener('change',async function(e){var f=e.target.files&&e.target.files[0];if(!f)return;var seq=++revision;artReadRevision=seq;paintGeneration();note('Reading '+f.name+'…');try{
      if(f.size>60*1024*1024)throw new Error('Choose a sculpt smaller than 60 MB.');
      var raw=await f.arrayBuffer();if(seq!==revision)return;var parsed=window.stlRead.readModelFile(raw,f.name),p=parsed.positions;
      var h=window.meshHealth(p);if(h.fatal||h.severity==='bad')throw new Error('This sculpt failed the mesh check.');
      // Validate the candidate's seat and final footprint before replacing the
      // working sculpt, preview or actions. A readable file may still not fit.
      make(p);
      sourceRevision++;art=p;artName=f.name;detachCandidate();$('tpArtName').textContent=artName;refresh();
    }catch(err){if(seq===revision)note(err.message,true);}
    finally{if(artReadRevision===seq){artReadRevision=null;e.target.value='';paintGeneration();}}
  });
  // A fit sample uses the same socket recipe without changing the current art,
  // draft, or Library. It never sends anything to the printer.
  if($('tpFitTest'))$('tpFitTest').addEventListener('click',function(){try{
    requireDraft();var x=make(null),url=URL.createObjectURL(binary(x.positions)),a=document.createElement('a');
    a.href=url;a.download=name()+'-fit-test.stl';document.body.appendChild(a);a.click();a.remove();
    setTimeout(function(){URL.revokeObjectURL(url);},2000);completed('Plain socket fit test downloaded. Your sculpt is unchanged.');
  }catch(e){note(e.message,true);}});
  function inspectTopper(socket){
    if(!viewer||!built)return;viewer.stop();viewer.vel=0;viewer.az=socket?0:-.62;viewer.el=socket?-Math.PI/2:.52;viewer.draw();
    if($('tpView3d'))$('tpView3d').setAttribute('aria-pressed',String(!socket));
    if($('tpViewSocket'))$('tpViewSocket').setAttribute('aria-pressed',String(socket));
  }
  if($('tpView3d'))$('tpView3d').addEventListener('click',function(){inspectTopper(false);});
  if($('tpViewSocket'))$('tpViewSocket').addEventListener('click',function(){inspectTopper(true);});
  function freeTopperView(){['tpView3d','tpViewSocket'].forEach(function(id){if($(id))$(id).setAttribute('aria-pressed','false');});}
  $('tpPreview').addEventListener('mousedown',freeTopperView);
  $('tpPreview').addEventListener('touchstart',freeTopperView,{passive:true});
  $('tpExport').addEventListener('click',function(){try{requireDraft();var x=make(),url=URL.createObjectURL(binary(x.positions)),a=document.createElement('a');a.href=url;a.download=name()+'.stl';document.body.appendChild(a);a.click();a.remove();setTimeout(function(){URL.revokeObjectURL(url);},2000);completed('Topper STL downloaded.');}catch(e){note(e.message,true);}});
  $('tpSave').addEventListener('click',async function(){if(saving||generating)return;var stamp=revision;try{
      requireDraft();if(activeCandidate()){saving=true;paintGeneration();await finishGenerated(pendingGenerated,true,stamp);return;}
      var x=make();if(!window.keycapLibrary)throw new Error('Library is unavailable.');
      saving=true;$('tpSave').disabled=true;
      var saved=await window.keycapLibrary.save(fittedRecord(x,recipe(),art,name()));
      if(!saved||typeof saved.id!=='string'||!saved.id.trim())throw new Error('Library did not confirm this save. Export the STL or try saving again.');
      if(stamp===revision)completed('Topper saved to Library.');else note('Saved the previous version to Library. Your current changes still need saving.',true);
    }catch(e){note('Not saved: '+e.message,true);}finally{saving=false;paintGeneration();}});
  $('tpSlice').addEventListener('click',async function(){var stamp=revision;try{requireDraft();var x=make();
      var ok=typeof slicerLoadMod==='function'?await slicerLoadMod():false;requireDraft();if(stamp!==revision)throw new Error('Topper changed. Send the current version again.');
      if(!ok||!window.slicerLoadMesh||!window.slicerLoadMesh(x.positions,name()+'.stl',x.positions.byteLength,{keepPose:true,noScale:true}))throw new Error('Slicer could not load this topper.');
      if(window.studioStage)window.studioStage('model');if(window.studioGo)window.studioGo('create');note('Sent at the exact socket size. Review supports and keep the bore clear before printing.');
    }catch(e){note(e.message,true);}});
  try{var saved=JSON.parse(localStorage.getItem('tmTopperFit')||'null');if(saved)ids.forEach(function(id){if(typeof saved[id]==='string')$(id).value=saved[id];});}catch(e){}
  window.topperRefresh=refresh;refresh();
  if(window.indexedDB){var restoreStamp=revision,restoreSourceStamp=sourceRevision,restoreFields=JSON.stringify(fields());draftNote('Checking for your saved topper draft…');
    draftStore('readonly').then(function(d){
      if(!d)return;
      if(d.version!==1||!d.fields||typeof d.fields!=='object')throw new Error('The saved draft format could not be read.');
      if(d.art&&(!(d.art instanceof Float32Array)||d.art.length%9||d.art.length>2700000))throw new Error('The saved artwork could not be read.');
      var task=pendingTask();if(d.pendingGenerated&&task&&task.from==='topper'&&d.pendingGenerated.deliveryId===task.id){
        pendingGenerated={deliveryId:task.id,positions:sourceOkay(d.pendingGenerated.positions),recipe:readRecipe(d.pendingGenerated.recipe),active:d.pendingGenerated.active!==false&&sourceRevision===restoreSourceStamp};
      }
      // Typing a new dimension does not discard the stored source sculpt. Only
      // an explicit Clear or a successful new import replaces that source.
      if(revision===restoreStamp&&JSON.stringify(fields())===restoreFields)ids.forEach(function(id){if(typeof d.fields[id]==='string')$(id).value=d.fields[id];});
      if(sourceRevision===restoreSourceStamp){art=d.art||null;artName=art&&typeof d.artName==='string'?d.artName:'';}
      $('tpArtName').textContent=artName||'Plain socket';
      // Restoring the saved source must not invalidate a file already loading.
      refresh(true);
    }).then(function(){draftReady=true;persistDraft();paintGeneration();recoverTopper(false);},function(e){draftReady=true;draftNote('Draft could not be restored: '+e.message+' Your Library is unchanged.',true);paintGeneration();});
  }
  else if(typeof setTimeout==='function')setTimeout(function(){recoverTopper(false);},1800);
})();
