import {mountReadingToolbar} from './reading-toolbar.mjs';

// GET-184 tools coordinator: the single owner of the reader pill's expanded
// state, its five-second concealment and the pointer/keyboard/dialog holds
// across BOTH tools surfaces (panel and focused header). The pill keeps exactly
// one click handler and one timer, both inside mountReadingToolbar; this
// coordinator drives the immersion surface and owns the explicit chat seams
// (injected trigger host, companion bubble anchor, focus callback, unread
// callback). Shared pill ARIA and presentation stay here, never in chat or the
// companion.

let currentTools=null;

// Sibling reader scripts (reading-session.js) reach the mounted coordinator
// through this handle instead of mounting a second toolbar.
export const readerTools=()=>currentTools;

export function mountReaderTools({sessionRoot,immersion=null,document=globalThis.document}={}){
  const pill=sessionRoot.querySelector('#reading-tools-trigger');
  const restorePill=()=>{if(pill&&pill.isConnected!==false&&!pill.hidden){pill.focus({preventScroll:true});return true;}immersion?.restoreToolFocus?.();};
  const header=document.getElementById('reading-header');
  const handoffHost=sessionRoot.querySelector('#reading-tools-chat-slot');
  const toolbar=mountReadingToolbar(sessionRoot,{onExpandedChange(expanded,{focus}={}){
    if(expanded){immersion?.showTools?.({focus:!!focus});return;}
    const inside=!!header?.contains?.(document.activeElement);
    immersion?.closeTools?.();
    if(inside||!document.activeElement||document.activeElement.hidden||document.activeElement===document.body)restorePill();
  }});
  // The single conceal timer is held while either tools surface is used.
  if(header?.addEventListener){
    header.addEventListener('pointerenter',event=>{if(event.pointerType==='mouse')toolbar.hold('header-pointer',true);});
    header.addEventListener('pointerleave',event=>{if(event.pointerType==='mouse')toolbar.hold('header-pointer',false);});
    header.addEventListener('focusin',()=>toolbar.hold('header-keyboard',true));
    header.addEventListener('focusout',()=>queueMicrotask(()=>toolbar.hold('header-keyboard',!!header.contains?.(document.activeElement))));
  }
  const chatIntegration={
    triggerHost:handoffHost,
    companionAnchor:pill,
    focusReturn:restorePill,
    onUnread:value=>{if(!pill)return;pill.classList.toggle('has-companion-message',!!value);pill.setAttribute('aria-description',value?'有陪读消息':'');},
    onOpen:()=>toolbar.conceal()
  };
  toolbar.setControlMode(document.body?.classList?.contains('is-focused')?'focused':'unfocused');
  document.addEventListener?.('reader:focus',event=>toolbar.setControlMode(event?.detail?.focused===false?'unfocused':'focused'));
  currentTools={toolbar,chatIntegration,closeRequest:target=>{if(sessionRoot.contains(target)||header?.contains(target))return false;toolbar.conceal();return true;}};
  return currentTools;
}
