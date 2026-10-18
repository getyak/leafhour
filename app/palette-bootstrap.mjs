// GET-178 shared small command-palette trigger. This module is bundled with the
// page that hosts it and loads app/command-palette.mjs strictly on demand. Page
// adapters arrive through the documented window.marginaliaPaletteAdapter
// registry plus body[data-palette-page]; the palette module never imports an
// unrelated page controller.

export const PALETTE_KEYCAP={mac:'⌘K',other:'Ctrl K'};
export const PALETTE_POINTER_QUERIES=['(pointer: coarse)','(any-pointer: fine)'];
// Explicit owning-component label for a failed on-demand import.
export const PALETTE_BOOTSTRAP_TEXT={loadError:'命令面板暂时无法载入，请重试。'};

// The keycap hint is only useful where a keyboard likely exists: hide it on a
// coarse-only primary pointer, keep it for fine-primary devices even when a
// coarse pointer is also present (fine primary + coarse secondary).
export function paletteKeycapHintAvailable(matchMedia){
  return !matchMedia(PALETTE_POINTER_QUERIES[0]).matches||!!matchMedia(PALETTE_POINTER_QUERIES[1]).matches;
}

// Both shortcuts defer on a handled event, IME composition (isComposing or
// keyCode 229), an editable target and any other open modal or popover.
export function paletteShortcutAllowed(event,{editable=false,modalOpen=false}={}){
  return !event?.defaultPrevented&&!event?.isComposing&&event?.keyCode!==229&&!editable&&!modalOpen;
}

// The home shell keeps its byte-exact <body> for portalDocument; its palette
// page kind resolves from the existing library-page class, other pages from the
// explicit host metadata. Every scoped entry carries a palette host (entry or
// keycap), which is also the self-mount gate for generated home/library shells.
export const palettePageFor=document=>document?.body?.dataset?.palettePage||(document?.body?.classList?.contains?.('library-page')?'library':'home');
export const paletteHasHost=document=>!!document?.querySelectorAll?.('[data-palette-open],[data-palette-keycap]')?.length;

export function mountPaletteBootstrap({document=globalThis.document,navigator=globalThis.navigator,matchMedia=globalThis.matchMedia?.bind?.(globalThis),page=palettePageFor(document),adapter=globalThis.marginaliaPaletteAdapter||null,loadPalette=()=>import('./command-palette.mjs')}={}){
  if(!document)return null;
  const mac=/mac|iphone|ipad/i.test(navigator?.userAgentData?.platform||navigator?.platform||navigator?.userAgent||'');
  for(const node of document.querySelectorAll('[data-palette-keycap]')){
    node.textContent=mac?PALETTE_KEYCAP.mac:PALETTE_KEYCAP.other;
    if(matchMedia&&!paletteKeycapHintAvailable(matchMedia))node.hidden=true;
  }
  let loading=null,notice=null;
  const report=()=>{
    if(notice)return;
    notice=document.createElement('p');notice.setAttribute('role','status');notice.textContent=PALETTE_BOOTSTRAP_TEXT.loadError;
    (document.body||document.documentElement)?.append?.(notice);
  };
  // The controller is built once; every gesture opens it again (reopen after
  // close). A failed import resets the cached loader so the next gesture
  // retries, and reports visibly instead of leaving an unhandled rejection.
  const open=(opener=document.activeElement)=>{
    if(!loading)loading=Promise.resolve().then(loadPalette).then(module=>module.openCommandPalette({document,page,adapter:globalThis.marginaliaPaletteAdapter||adapter,opener}),error=>{loading=null;report();throw error;});
    return loading.then(controller=>{controller?.open?.(opener);return controller;});
  };
  const gesture=opener=>{void open(opener).catch(()=>{});};
  for(const node of document.querySelectorAll('[data-palette-open]'))node.addEventListener?.('click',()=>gesture(node));
  const onKeydown=event=>{
    const key=typeof event.key==='string'?event.key.toLowerCase():'',primary=event.metaKey===true||event.ctrlKey===true,target=event.target;
    const allowed=paletteShortcutAllowed(event,{editable:!!target&&(target.isContentEditable===true||!!target.closest?.('input,textarea,select,[contenteditable="true"]')),modalOpen:!!document.querySelector('dialog[open],[popover]:popover-open')});
    if(key==='k'&&primary&&!event.altKey&&!event.shiftKey&&allowed){event.preventDefault();gesture(target);}
    else if(key==='/'&&!primary&&!event.altKey&&!event.shiftKey&&allowed){
      const input=document.getElementById?.('book-search');
      const visible=!!input&&!input.hidden&&!input.closest?.('[hidden],[inert]')&&(typeof input.getClientRects!=='function'||input.getClientRects().length>0);
      event.preventDefault();if(visible)input.focus();else gesture(target);
    }
  };
  document.addEventListener('keydown',onKeydown);
  return {open};
}

// Self-mount on any scoped page entry that carries a palette host.
if(globalThis.document&&paletteHasHost(globalThis.document))mountPaletteBootstrap();
