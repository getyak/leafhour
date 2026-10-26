// GET-178 shared small command-palette trigger. This module is bundled with the
// page that hosts it and loads app/command-palette.mjs strictly on demand. Page
// adapters arrive through the documented window.marginaliaPaletteAdapter
// registry plus body[data-palette-page]; the palette module never imports an
// unrelated page controller.
import {overlayOpen,focusableTrigger} from './popover-controls.mjs';
import {t,onUiLocaleChange,uiReady,mountUiLocaleNotice,bindUi} from './ui-locale.mjs';

export const PALETTE_KEYCAP={mac:'⌘K',other:'Ctrl K'};
export const PALETTE_POINTER_QUERIES=['(pointer: coarse)','(any-pointer: fine)'];
// Explicit owning-component labels for a failed on-demand load. The failure is
// always visible in the current viewport (shared styles in interaction-craft.css)
// and disappears as soon as a request succeeds again. After the one finite
// import retry is spent, the only honest fallback is a manually activated page
// reload: it is never invoked automatically and never relabelled as a retry.
// Labels read the shared stable-ID runtime and relabel in place; the legacy
// export stays for non-localized callers and tests that assert the raw values.
export const PALETTE_BOOTSTRAP_TEXT={loadError:'命令面板暂时无法载入。',retry:'重试',reload:'重新加载页面'};
const paletteText=()=>({loadError:t('pn.loadError'),retry:t('pn.retry'),reload:t('pn.reload')});
// Owned data-ui markers let the shared runtime relabel this notice in place,
// even before the palette import succeeds, without any synthetic gesture.

// The keycap hint is only useful where a keyboard likely exists: hide it on a
// coarse-only primary pointer, keep it for fine-primary devices even when a
// coarse pointer is also present (fine primary + coarse secondary).
export function paletteKeycapHintAvailable(matchMedia){
  return !matchMedia(PALETTE_POINTER_QUERIES[0]).matches||!!matchMedia(PALETTE_POINTER_QUERIES[1]).matches;
}

// Both shortcuts defer on a handled event, IME composition (isComposing or
// keyCode 229), an editable target and any other open modal or popover.
export function paletteShortcutAllowed(event,{editable,modalOpen}={}){
  return !event?.defaultPrevented&&!event?.isComposing&&event?.keyCode!==229&&!editable&&!modalOpen;
}

// The home shell keeps its byte-exact <body> for portalDocument; its palette
// page kind resolves from the existing library-page class, other pages from the
// explicit host metadata. Every scoped entry carries a palette host (entry or
// keycap), which is also the self-mount gate for generated home/library shells.
export const palettePageFor=document=>document?.body?.dataset?.palettePage||(document?.body?.classList?.contains?.('library-page')?'library':'home');
export const paletteHasHost=document=>!!document?.querySelectorAll?.('[data-palette-open],[data-palette-keycap]')?.length;

// The one amended recovery edge is this exact literal retry URL, imported only
// by the palette bootstrap and only at the import stage. Its backing file is
// the same released app/command-palette.mjs entry.
const paletteRetryImport=()=>import('./command-palette.mjs?retry=1');
export function mountPaletteBootstrap({document=globalThis.document,navigator=globalThis.navigator,matchMedia=globalThis.matchMedia?.bind?.(globalThis),page=palettePageFor(document),adapter=globalThis.marginaliaPaletteAdapter||null,loadPalette=()=>import('./command-palette.mjs'),loadRetry=paletteRetryImport}={}){
  if(!document)return null;
  const mac=/mac|iphone|ipad/i.test(navigator?.userAgentData?.platform||navigator?.platform||navigator?.userAgent||'');
  for(const node of document.querySelectorAll('[data-palette-keycap]')){
    node.textContent=mac?PALETTE_KEYCAP.mac:PALETTE_KEYCAP.other;
    if(matchMedia&&!paletteKeycapHintAvailable(matchMedia))node.hidden=true;
  }
  let modulePromise,importStage=0,notice,retryControl,reloadControl,controller,generation=0,lastOpener;
  // One request transaction: a stale request may only cache code, never mount,
  // focus, close newer state or paint a notice. The owner fence prefers the
  // adapter's monotonic owner revision/settlement token so an A->B->A lifecycle
  // can never make an old request look current; the palette library keeps the
  // real user id getter for /api/auth/session compatibility.
  const live=()=>globalThis.marginaliaPaletteAdapter||adapter;
  const ownerNow=()=>{try{const a=live()||null;return a?.getOwnerToken?.()??a?.getOwner?.();}catch{return null;}};
  const blocked=()=>page!=='reader'&&(overlayOpen(document)||document.getElementById?.('site-appearance-menu')?.hidden===false);
  const current=stamp=>stamp.generation===generation&&stamp.owner===ownerNow()&&stamp.overlay===live()?.getOverlayRevision?.();
  // The eventual focus-return target is the actual visible opener; a breakpoint
  // that hid it falls back to the visible brand or an existing safe page-level
  // target, never a closed sheet's child.
  const returnTarget=opener=>focusableTrigger(opener)?opener:[document.querySelector?.('a.brand'),document.getElementById?.('main')].find(focusableTrigger)||document.body||null;
  // Import recovery is finite: the initial URL once, then after an import-stage
  // rejection exactly one explicit retry through the fixed retry URL. A failed
  // Chrome module-map entry is never replayed; setup/open failures after a
  // successful import reuse the loaded namespace instead of a second identity.
  const ensureModule=()=>{
    if(modulePromise)return modulePromise;
    if(importStage>1)return Promise.reject(Error(PALETTE_BOOTSTRAP_TEXT.loadError));
    const retry=importStage>0;importStage=retry?2:1;
    const chained=Promise.resolve().then(retry?loadRetry:loadPalette).catch(error=>{if(modulePromise===chained)modulePromise=null;throw error;});
    return modulePromise=chained;
  };
  const button=(className,text,onClick)=>{
    const control=document.createElement('button');
    control.type='button';control.className=className;control.textContent=text;
    control.addEventListener('click',onClick);
    return control;
  };
  const relabelPaletteNotice=()=>{if(!notice)return;bindUi(notice);};
  const showFailure=()=>{
    if(!notice){
      notice=document.createElement('div');notice.className='palette-notice';notice.setAttribute('role','status');
      const message=document.createElement('span');message.dataset.ui='pn.loadError';message.textContent=paletteText().loadError;
      retryControl=button('palette-retry',paletteText().retry,()=>gesture(lastOpener||document.activeElement));retryControl.dataset.ui='pn.retry';
      reloadControl=button('palette-reload',paletteText().reload,()=>globalThis.location?.reload?.());reloadControl.dataset.ui='pn.reload';
      notice.append(message,retryControl,reloadControl);
      (document.body||document.documentElement)?.append?.(notice);
      bindUi(notice);
    }
    const exhausted=!modulePromise&&importStage>1;
    retryControl.hidden=exhausted;
    reloadControl.hidden=!exhausted;
    notice.hidden=false;
  };
  const open=async(opener=document.activeElement)=>{
    const stamp={generation:++generation,owner:ownerNow(),overlay:live()?.getOverlayRevision?.()};
    lastOpener=opener;
    try{
      const module=await ensureModule();
      // Another modal or the open appearance popover defers under the same
      // existing policy; a just-closed menu never blocks its own handoff.
      if(!current(stamp)||blocked())return null;
      if(!controller)controller=module.openCommandPalette({document,page,adapter:live(),opener});
      // Revalidate immediately before displaying the lazily built palette.
      if(!current(stamp)||blocked())return null;
      // Seal this request's own synchronous handoff before show/focus/render
      // can fail; a genuinely newer surface still invalidates its catch.
      controller.open(returnTarget(opener),{onPrepared:()=>{stamp.overlay=live()?.getOverlayRevision?.();}});
      if(notice)notice.hidden=true;
      return controller;
    }catch(error){
      // Failure side effects are fenced like success side effects: a stale
      // catch may not close newer state or paint a stale notice.
      if(current(stamp)){try{controller?.close?.({restoreFocus:false});}catch{}showFailure();}
      throw error;
    }
  };
  const gesture=opener=>void open(opener).catch(()=>{});
  // Shared explicit locale fallback/retry notices live in the external runtime
  // (same /ui-locale.mjs identity) and stay separate from the palette's own
  // retry budget; this bootstrap merely hosts them on every actual page.
  const localeNotice=mountUiLocaleNotice({document});
  void uiReady.then(()=>{localeNotice.update();});
  for(const node of document.querySelectorAll('[data-palette-open]'))node.addEventListener?.('click',()=>gesture(node));
  // The explicit handoff port: one listener per mount, routed through the same
  // gesture/open path with the caller's actual visible opener.
  document.addEventListener?.('palette:open',event=>gesture(event?.detail||document.activeElement));
  const onKeydown=event=>{
    const key=event.key?.toLowerCase?.()||'',primary=event.metaKey||event.ctrlKey,target=event.target;
    const handoff=primary&&page==='reader';
    const allowed=paletteShortcutAllowed(event,{editable:!handoff&&!!target&&(target.isContentEditable||!!target.closest?.('input,textarea,select,[contenteditable="true"]')),modalOpen:!handoff&&overlayOpen(document)});
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
