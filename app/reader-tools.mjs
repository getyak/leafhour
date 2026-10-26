import {mountReadingToolbar} from './reading-toolbar.mjs';
import {t,onUiLocaleChange} from './ui-locale.mjs';

// GET-184 tools coordinator: the single owner of the reader pill's expanded
// state, its five-second concealment and the pointer/keyboard/dialog holds
// across BOTH tools surfaces (panel and focused header). The pill keeps exactly
// one click handler and one timer, both inside mountReadingToolbar; this
// coordinator drives the immersion surface and owns the explicit chat seams
// (injected trigger host, companion bubble anchor, focus callback, unread
// callback). Shared pill ARIA and presentation stay here, never in chat or the
// companion.

let currentTools=null,resolveTools;
export const readerToolsReady=new Promise(resolve=>{resolveTools=resolve;});

// Sibling reader scripts (reading-session.js) reach the mounted coordinator
// through this handle instead of mounting a second toolbar.
export const readerTools=()=>currentTools;

export function mountReaderTools({sessionRoot,immersion=null,document=globalThis.document}={}){
  currentTools?.unmount();
  let disposed=false;
  const listeners=[];
  const listen=(target,name,fn)=>{const owned=event=>{if(!disposed)fn(event);};target.addEventListener(name,owned);listeners.push(()=>target.removeEventListener(name,owned));};
  const pill=sessionRoot.querySelector('#reading-tools-trigger');
  const restorePill=()=>{if(disposed)return false;if(pill&&pill.isConnected!==false&&!pill.hidden){pill.focus({preventScroll:true});return true;}immersion?.restoreToolFocus?.();};
  const header=document.getElementById('reading-header');
  const handoffHost=sessionRoot.querySelector('#reading-tools-chat-slot');
  let unread=false;
  const restoreChat=()=>{if(disposed)return false;const trigger=handoffHost?.querySelector?.('.library-chat-trigger');if(trigger?.isConnected!==false&&trigger){toolbar.reveal(false);trigger.focus({preventScroll:true});return true;}return restorePill();};
  const updateUnreadLabel=()=>{if(!disposed){handoffHost?.setAttribute('aria-label',t('chat.entry'));handoffHost?.setAttribute('aria-description',unread?t('reader.tools.companion'):'');}};
  const offLocale=onUiLocaleChange(updateUnreadLabel);
  handoffHost?.setAttribute('role','group');handoffHost?.classList.toggle('has-companion-message',false);updateUnreadLabel();
  const toolbar=mountReadingToolbar(sessionRoot,{document,header,onExpandedChange(expanded,{focus,preview,restoreFocus=true}={}){
    if(expanded){if(!preview)immersion?.showTools?.({focus:!!focus});return;}
    const inside=!!header?.contains?.(document.activeElement);
    immersion?.closeTools?.();
    if(restoreFocus&&inside)restorePill();
  }});
  const chatIntegration={
    triggerHost:handoffHost,
    companionAnchor:handoffHost||pill,
    focusReturn:restoreChat,
    onUnread:value=>{if(disposed)return;unread=!!value;handoffHost?.classList.toggle('has-companion-message',unread);updateUnreadLabel();},
    onOpen:()=>toolbar.conceal()
  };
  toolbar.setControlMode(document.body?.classList?.contains('is-focused')?'focused':'unfocused');
  listen(document,'reader:focus',event=>toolbar.setControlMode(event?.detail?.focused===false?'unfocused':'focused'));
  const tools={toolbar,chatIntegration,get toolFocusTarget(){return disposed?null:pill;},closeRequest:target=>{if(disposed||sessionRoot.contains(target)||header?.contains(target))return false;toolbar.conceal({restoreFocus:!target});return true;},unmount(){if(disposed)return;disposed=true;offLocale();toolbar.unmount();for(const release of listeners)release();listeners.length=0;if(currentTools===tools)currentTools=null;}};
  currentTools=tools;resolveTools(tools);return tools;
}
