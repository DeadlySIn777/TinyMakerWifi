/* Human-directed artisan review. All geometry, storage and Meshy work belongs
 * to the supplied callbacks; opening/changing views never starts a paid task. */
(function(root){
  'use strict';
  var active=null;
  var CORRECTIONS=[['too-small','Make it larger'],['larger-face','Larger face / head'],
    ['compact-character','Compact character'],['sturdier-parts','Fewer fragile parts'],
    ['extra-parts','Extra ears / limbs'],['simpler-silhouette','Simpler silhouette']];
  var VIEWS=['perspective','front','side','back'];
  function request(corrections,feedback,view){
    var keys=CORRECTIONS.map(function(c){return c[0];}),seen=[];
    (Array.isArray(corrections)?corrections:[]).forEach(function(k){if(keys.indexOf(k)>=0&&seen.indexOf(k)<0)seen.push(k);});
    return {corrections:seen,feedback:typeof feedback==='string'?feedback.trim().slice(0,180):'',view:VIEWS.indexOf(view)>=0?view:'perspective'};
  }
  function open(options){
    var o=Object.assign({},options||{}),doc=root.document;
    if(!doc||!doc.body||typeof o.renderPreview!=='function')return false;
    if(active)active.close('replaced');
    var prior=doc.activeElement,closed=false,busy=false,view='perspective',chosen=[],renderVersion=0,noticeVersion=0,confirmation=null;
    function el(tag,cls,text){var n=doc.createElement(tag);if(cls)n.className=cls;if(text!=null)n.textContent=text;return n;}
    function button(cls,text){var n=el('button',cls,text);n.type='button';return n;}
    var dialog=el('dialog','arDialog');dialog.setAttribute('aria-labelledby','arTitle');
    var style=el('style');style.textContent=[
      '.arDialog{position:fixed;inset:0;margin:auto;padding:0;border:1px solid #65303a;border-radius:18px;background:#111215;color:#eee;width:1020px;max-width:calc(100vw - 24px);height:min(800px,calc(100vh - 24px));height:min(800px,calc(100dvh - 24px));max-height:calc(100dvh - 24px);overflow:hidden;box-shadow:0 24px 100px #000b;color-scheme:dark;font:14px/1.4 system-ui,sans-serif}',
      '.arDialog[open]{display:flex;flex-direction:column}.arDialog::backdrop{background:#000b}.arDialog *{box-sizing:border-box}',
      '.arDialog button,.arDialog textarea{font:inherit;color:inherit;margin:0;min-width:0;max-width:100%;width:auto;border:1px solid #51414a;border-radius:9px;background:#211c21;padding:10px 12px;text-transform:none;letter-spacing:normal;line-height:1.3;height:auto;min-height:40px}',
      '.arDialog button{cursor:pointer;white-space:normal}.arDialog button:disabled{opacity:.45;cursor:default}.arDialog button:focus-visible,.arDialog textarea:focus-visible,.arDialog summary:focus-visible{outline:2px solid #ff5a64;outline-offset:3px}',
      '.arDialog .arHead{display:flex;align-items:center;gap:16px;padding:17px 20px;border-bottom:1px solid #30282d;flex:0 0 auto;min-width:0}.arDialog .arHeading{flex:1;min-width:0}.arDialog h2{margin:0;font-size:22px;line-height:1.2;color:#f5eff1}.arDialog .arName{margin:5px 0 0;color:#bcb2b8;overflow-wrap:anywhere;font-size:13px}.arDialog .arClose{flex:0 0 auto}',
      '.arDialog .arBody{display:grid;grid-template-columns:minmax(0,1fr) minmax(275px,340px);gap:20px;padding:20px;overflow-y:auto;overflow-x:hidden;min-height:0;flex:1;align-items:start;overscroll-behavior:contain}',
      '.arDialog .arPreview{min-width:0}.arDialog .arCanvas{width:100%;aspect-ratio:1;max-height:min(500px,calc(100dvh - 310px));object-fit:contain;display:block;background:#090b0e;border:1px solid #332c32;border-radius:13px}.arDialog .arViews{display:flex;gap:7px;margin-top:10px}.arDialog .arViews button{flex:1;padding:9px 6px;font-size:12px}.arDialog button[aria-pressed=true]{border-color:#ff545e;background:#482127}',
      '.arDialog .arControls{display:grid;gap:19px;min-width:0}.arDialog .arPhysical{border:1px solid #3a3338;border-radius:12px;padding:13px}.arDialog h3{font-size:14px;margin:0 0 8px;color:#eee}.arDialog .arPhysicalText{margin:0;font-size:13px;color:#c1b8bd;overflow-wrap:anywhere}.arDialog .arPhysicalText[data-state=needs-attention]{color:#ffbd70}.arDialog .arPhysicalText[data-state=ready]{color:#a3d8bd}',
      '.arDialog .arIssues{font-size:12px;color:#c4b8c0;margin-top:9px}.arDialog .arIssues summary,.arDialog .arHelp summary{cursor:pointer}.arDialog .arIssues ul{padding-left:18px;margin:8px 0 0;overflow-wrap:anywhere}.arDialog .arPrompt{margin:0 0 10px;font-size:13px;color:#bcb2b8}',
      '.arDialog .arChips{display:flex;flex-wrap:wrap;gap:7px}.arDialog .arChips button{padding:8px 10px;min-height:36px;font-size:12px}.arDialog .arFeedbackLabel{display:block;font-size:12px;color:#c8bcc3;margin-top:14px}.arDialog textarea{display:block;width:100%;min-height:78px;max-height:150px;margin-top:6px;resize:vertical;background:#0c0e12}.arDialog .arFeedbackCount{display:block;text-align:right;color:#91848d;font-size:11px;margin-top:3px}',
      '.arDialog .arHelp{font-size:12px;color:#a79ba4}.arDialog .arHelp p{margin:8px 0 0;line-height:1.5}.arDialog .arUnavailable{margin:0;color:#b8aab2;font-size:12px;overflow-wrap:anywhere}.arDialog .arUnavailable[hidden]{display:none}',
      '.arDialog .arFoot{flex:0 0 auto;padding:14px 20px;border-top:1px solid #342b30;background:#171317}.arDialog .arNotice{margin:0 0 10px;font-size:13px;color:#c3b4be;overflow-wrap:anywhere}.arDialog .arNotice:empty{display:none}.arDialog .arNotice[data-error=true]{color:#ff9d9d}.arDialog .arActions{display:flex;gap:9px;flex-wrap:wrap;justify-content:flex-end}.arDialog .arGenerate{background:#ac2232;border-color:#ff535f;font-weight:650}.arDialog .arGenerate[hidden]{display:none}.arDialog .arPaid{font-size:11px;color:#ac9ba5;margin:7px 0 0;text-align:right}.arDialog .arPaid[hidden]{display:none}',
      '.arDialog .arConfirm{position:absolute;inset:0;z-index:2;display:flex;align-items:center;justify-content:center;padding:18px;background:#09090ce8}.arDialog .arConfirmCard{width:470px;max-width:100%;max-height:100%;overflow:auto;border:1px solid #8e434d;border-radius:14px;background:#1a151a;padding:22px;box-shadow:0 12px 60px #0009}.arDialog .arConfirmText{margin:0 0 20px;font-size:15px;line-height:1.6;white-space:pre-wrap;overflow-wrap:anywhere}.arDialog .arConfirmButtons{display:flex;gap:10px;flex-wrap:wrap;justify-content:flex-end}.arDialog .arConfirmButtons button{flex:1 1 150px}.arDialog .arConfirmApprove{background:#ac2232;border-color:#ff535f;font-weight:650}',
      '@media(max-width:650px){.arDialog{max-width:calc(100vw - 12px);height:calc(100dvh - 12px);max-height:calc(100dvh - 12px);border-radius:13px}.arDialog .arHead{padding:12px;gap:10px}.arDialog h2{font-size:20px}.arDialog .arBody{grid-template-columns:minmax(0,1fr);gap:16px;padding:12px}.arDialog .arCanvas{max-height:360px;object-fit:contain}.arDialog .arFoot{padding:10px 12px}.arDialog .arActions button{flex:1 1 140px;font-size:12px;padding:10px 8px}.arDialog .arActions .arKeep{flex:1 1 100%}.arDialog .arPaid{text-align:center}.arDialog .arControls{gap:14px}}'
    ].join('');dialog.appendChild(style);
    var head=el('header','arHead'),heading=el('div','arHeading'),title=el('h2',null,'Review artisan');title.id='arTitle';
    var name=el('p','arName',String(o.title||'Current keycap').slice(0,120));heading.appendChild(title);heading.appendChild(name);head.appendChild(heading);
    var closeButton=button('arClose','Close');head.appendChild(closeButton);dialog.appendChild(head);
    var body=el('div','arBody'),preview=el('section','arPreview'),canvas=el('canvas','arCanvas');canvas.width=640;canvas.height=640;canvas.setAttribute('aria-label','Current keycap preview');canvas.setAttribute('role','img');preview.appendChild(canvas);
    var views=el('div','arViews');views.setAttribute('role','group');views.setAttribute('aria-label','Model view');
    var viewButtons=[];[['perspective','3/4'],['front','Front'],['side','Side'],['back','Back']].forEach(function(v){var b=button('',v[1]);b.setAttribute('data-view',v[0]);b.setAttribute('aria-label',v[0]==='perspective'?'Three-quarter view':v[1]+' view');b.addEventListener('click',function(){view=v[0];draw();});views.appendChild(b);viewButtons.push(b);});preview.appendChild(views);body.appendChild(preview);
    var controls=el('section','arControls'),physical=el('div','arPhysical');physical.appendChild(el('h3',null,'Print checks'));
    var physicalText=el('p','arPhysicalText');physical.appendChild(physicalText);
    var issues=el('details','arIssues'),issueList=el('ul');issues.appendChild(el('summary',null,'Check details'));issues.appendChild(issueList);physical.appendChild(issues);controls.appendChild(physical);
    var visual=el('div');visual.appendChild(el('h3',null,'Your visual review'));visual.appendChild(el('p','arPrompt','Choose what to improve.'));
    var chips=el('div','arChips');chips.setAttribute('role','group');chips.setAttribute('aria-label','Artwork corrections');var chipButtons=[];
    CORRECTIONS.forEach(function(c){var b=button('',c[1]);b.setAttribute('data-correction',c[0]);b.setAttribute('aria-pressed','false');b.addEventListener('click',function(){var i=chosen.indexOf(c[0]);if(i<0)chosen.push(c[0]);else chosen.splice(i,1);sync();});chips.appendChild(b);chipButtons.push(b);});visual.appendChild(chips);
    var label=el('label','arFeedbackLabel','Anything else?'),feedback=el('textarea');feedback.id='arFeedback';feedback.maxLength=180;feedback.placeholder='For example: one pair of rounded ears, larger cheeks…';label.htmlFor='arFeedback';label.appendChild(feedback);visual.appendChild(label);
    var count=el('span','arFeedbackCount','0 / 180');visual.appendChild(count);controls.appendChild(visual);
    var help=el('details','arHelp');help.appendChild(el('summary',null,'About this review'));help.appendChild(el('p',null,'Print checks cover geometry and fit. Appearance is your review; there is no automatic visual reviewer or quality score. Local fixes keep the artwork. Uses two paid Meshy tasks: image revision and a new textured sculpture. Your current design is kept.'));controls.appendChild(help);
    var unavailable=el('p','arUnavailable');controls.appendChild(unavailable);body.appendChild(controls);dialog.appendChild(body);
    var foot=el('footer','arFoot'),notice=el('p','arNotice');notice.setAttribute('role','status');notice.setAttribute('aria-live','polite');foot.appendChild(notice);
    var actions=el('div','arActions'),keep=button('arKeep','Keep current'),local=button('arLocal','Apply local fit fixes'),generate=button('arGenerate','Revise with Meshy');actions.appendChild(keep);actions.appendChild(local);actions.appendChild(generate);foot.appendChild(actions);
    var paid=el('p','arPaid','Two paid Meshy tasks · one revised candidate');foot.appendChild(paid);dialog.appendChild(foot);
    function message(text,error){if(closed)return;noticeVersion++;notice.textContent=text||'';notice.setAttribute('data-error',String(!!error));}
    function sync(){
      if(closed)return;
      var p=o.physical||{},state=['ready','needs-attention'].indexOf(p.state)>=0?p.state:'unknown';
      physicalText.setAttribute('data-state',state);physicalText.textContent=String(p.summary||(state==='ready'?'Geometry checks passed':state==='needs-attention'?'Needs attention':'Not checked')).slice(0,400);
      issueList.textContent='';(Array.isArray(p.issues)?p.issues:[]).slice(0,8).forEach(function(t){issueList.appendChild(el('li',null,String(t).slice(0,300)));});issues.hidden=!issueList.childNodes.length;
      chipButtons.forEach(function(b){b.setAttribute('aria-pressed',String(chosen.indexOf(b.getAttribute('data-correction'))>=0));b.disabled=busy;});
      feedback.disabled=busy;count.textContent=feedback.value.length+' / 180';
      local.disabled=busy||o.canApplyLocal!==true||typeof o.onApplyLocal!=='function';
      var hasGenerator=o.canGenerate===true&&typeof o.onGenerate==='function';generate.hidden=!hasGenerator;paid.hidden=!hasGenerator;
      generate.disabled=busy||(!chosen.length&&!feedback.value.trim());unavailable.hidden=hasGenerator;
      unavailable.textContent=String(o.generateUnavailableReason||'Meshy revision is unavailable. You can still review the model and apply local fit fixes.').slice(0,300);
      dialog.setAttribute('aria-busy',String(busy));
    }
    function draw(){
      if(closed)return;var token=++renderVersion,currentView=view,beforeNote=noticeVersion;
      viewButtons.forEach(function(b){b.setAttribute('aria-pressed',String(b.getAttribute('data-view')===view));});
      // An old async render never paints over the newest selected view.
      var staged=el('canvas');staged.width=640;staged.height=640;
      Promise.resolve().then(function(){return o.renderPreview(staged,currentView);}).then(function(){
        if(closed||token!==renderVersion)return;
        if(!staged.width||!staged.height||staged.width>2048||staged.height>2048)throw new Error('The preview size is unavailable.');
        canvas.width=staged.width;canvas.height=staged.height;var g=canvas.getContext('2d');g.clearRect(0,0,canvas.width,canvas.height);g.drawImage(staged,0,0);
        canvas.setAttribute('aria-label','Current keycap · '+currentView+' view');
      }).catch(function(e){if(!closed&&token===renderVersion&&beforeNote===noticeVersion)message('Preview unavailable: '+(e.message||'could not render'),true);});
    }
    function update(patch){if(closed)return false;var p=patch||{};['title','physical','canGenerate','generateUnavailableReason','canApplyLocal','renderPreview'].forEach(function(k){if(Object.prototype.hasOwnProperty.call(p,k))o[k]=p[k];});name.textContent=String(o.title||'Current keycap').slice(0,120);sync();draw();if(p.message)message(p.message,false);return true;}
    function resolveConfirm(yes,restoreFocus){
      var c=confirmation;if(!c)return;confirmation=null;
      if(c.overlay.parentNode)c.overlay.parentNode.removeChild(c.overlay);
      [head,body,foot].forEach(function(n){n.inert=false;});
      if(restoreFocus&&!closed){var target=c.prior&&c.prior.isConnected&&!c.prior.disabled?c.prior:closeButton;target.focus();}
      c.resolve(yes===true);
    }
    function confirmAction(options){
      if(closed||confirmation)return Promise.resolve(false);
      var p=options||{},overlay=el('section','arConfirm'),card=el('div','arConfirmCard');
      overlay.setAttribute('role','alertdialog');overlay.setAttribute('aria-modal','true');overlay.setAttribute('aria-labelledby','arConfirmText');
      var text=el('p','arConfirmText',String(p.message||'Continue with this change?').slice(0,1400));text.id='arConfirmText';card.appendChild(text);
      var buttons=el('div','arConfirmButtons'),cancel=button('arConfirmCancel',String(p.cancel||'Keep current').slice(0,60)),approve=button('arConfirmApprove',String(p.ok||'Continue').slice(0,60));
      buttons.appendChild(cancel);buttons.appendChild(approve);card.appendChild(buttons);overlay.appendChild(card);
      var focus=doc.activeElement;[head,body,foot].forEach(function(n){n.inert=true;});dialog.appendChild(overlay);
      var promise=new Promise(function(resolve){confirmation={overlay:overlay,prior:focus,resolve:resolve};});
      cancel.addEventListener('click',function(){resolveConfirm(false,true);});approve.addEventListener('click',function(){resolveConfirm(true,true);});
      cancel.focus();return promise;
    }
    function close(reason){
      if(closed)return;closed=true;renderVersion++;resolveConfirm(false,false);
      if(typeof dialog.close==='function')dialog.close();if(dialog.parentNode)dialog.parentNode.removeChild(dialog);
      if(active&&active.dialog===dialog)active=null;
      if(prior&&prior.isConnected!==false&&typeof prior.focus==='function')prior.focus();
      if(typeof o.onClose==='function')try{o.onClose(reason||'close');}catch(e){}
    }
    function run(kind){
      var fn=kind==='generate'?o.onGenerate:o.onApplyLocal,b=kind==='generate'?generate:local;
      if(closed||busy||b.disabled||b.hidden||typeof fn!=='function')return Promise.resolve(false);
      var payload=request(chosen,feedback.value,view);busy=true;sync();message(kind==='generate'?'Preparing one revised candidate…':'Applying local fit fixes…',false);
      return Promise.resolve().then(function(){if(closed)return false;return fn(payload);}).then(function(result){
        if(closed)return false;busy=false;sync();
        if(result===false){message('Current design kept.',false);return false;}
        if(result&&result.close===true){close(kind);return true;}
        if(result&&typeof result==='object')update(result);else draw();
        message(result&&result.message||'Current design kept. Review the result before continuing.',false);return true;
      }).catch(function(e){if(!closed){busy=false;sync();message(e&&e.message||'Could not complete this change. Current design kept.',true);}return false;});
    }
    feedback.addEventListener('input',sync);closeButton.addEventListener('click',function(){close('close');});
    keep.addEventListener('click',function(){if(typeof o.onKeep==='function')try{o.onKeep();}catch(e){message(e.message||'Could not keep the current design.',true);return;}close('keep');});
    local.addEventListener('click',function(){run('local');});generate.addEventListener('click',function(){run('generate');});
    dialog.addEventListener('cancel',function(e){e.preventDefault();if(confirmation)resolveConfirm(false,true);else close('escape');});
    dialog.addEventListener('keydown',function(e){
      if(e.key==='Escape'){e.preventDefault();e.stopPropagation();if(confirmation)resolveConfirm(false,true);else close('escape');return;}
      if(e.key!=='Tab')return;
      var focusRoot=confirmation?confirmation.overlay:dialog;
      var all=Array.prototype.filter.call(focusRoot.querySelectorAll('button,textarea,summary'),function(n){return !n.disabled&&!n.hidden&&n.getClientRects().length;});
      if(!all.length)return;var first=all[0],last=all[all.length-1];
      if(e.shiftKey&&doc.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&doc.activeElement===last){e.preventDefault();first.focus();}
    });
    doc.body.appendChild(dialog);var handle={dialog:dialog,close:close,update:update,confirm:confirmAction};active=handle;sync();
    if(typeof dialog.showModal==='function')dialog.showModal();else{dialog.setAttribute('open','');dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');}
    closeButton.focus();draw();return handle;
  }
  root.artisanReview={open:open,request:request,corrections:CORRECTIONS.map(function(c){return {id:c[0],label:c[1]};})};
  if(typeof module!=='undefined'&&module.exports)module.exports=root.artisanReview;
})(typeof window!=='undefined'?window:globalThis);
