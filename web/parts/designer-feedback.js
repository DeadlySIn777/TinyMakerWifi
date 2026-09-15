// Optional help and short success messages. Critical errors stay with the field.
(function(root){
  'use strict';
  var dialog=document.getElementById('designerHelpDialog'),noticeBox=document.getElementById('designerNotice');
  var noticeText=document.getElementById('designerNoticeText'),timer=0,returnFocus=null;
  function dismiss(){clearTimeout(timer);if(noticeBox)noticeBox.hidden=true;}
  function expire(){clearTimeout(timer);if(noticeBox&&noticeBox.contains(document.activeElement))return;timer=setTimeout(dismiss,6000);}
  function help(title,text,trigger){
    if(!dialog)return;
    returnFocus=trigger||document.activeElement;
    document.getElementById('designerHelpTitle').textContent=title||'Help';
    document.getElementById('designerHelpBody').textContent=text||'';
    if(!dialog.open)dialog.showModal();
    document.getElementById('designerHelpClose').focus();
  }
  function notice(text,opts){
    if(!noticeBox||!noticeText||!text)return;
    noticeText.textContent=String(text);noticeBox.hidden=false;expire();
  }
  if(dialog){
    document.getElementById('designerHelpClose').addEventListener('click',function(){dialog.close();});
    dialog.addEventListener('click',function(e){if(e.target===dialog){var r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.close();}});
    dialog.addEventListener('close',function(){if(returnFocus&&returnFocus.isConnected)returnFocus.focus();returnFocus=null;});
  }
  if(noticeBox){
    document.getElementById('designerNoticeClose').addEventListener('click',dismiss);
    noticeBox.addEventListener('mouseenter',function(){clearTimeout(timer);});
    noticeBox.addEventListener('mouseleave',expire);
    noticeBox.addEventListener('focusin',function(){clearTimeout(timer);});
    noticeBox.addEventListener('focusout',expire);
  }
  document.addEventListener('click',function(e){
    var b=e.target&&e.target.closest&&e.target.closest('[data-designer-help]');if(!b)return;
    var source=document.getElementById(b.getAttribute('data-designer-help'));if(!source)return;
    help(b.getAttribute('data-help-title')||'Help',source.textContent,b);
  });
  root.designerFeedback={help:help,notice:notice,dismiss:dismiss};
})(window);
