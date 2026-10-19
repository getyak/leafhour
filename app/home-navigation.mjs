// GET-188 authored-home mobile navigation. One controller, mounted by
// app/portal.js on the five authored home routes only, owns a quiet pill menu
// trigger and one full-height native dialog sheet. The sheet reuses the real
// localized navigation anchors and language links from the header (cloned, so
// modified clicks and later locale edits stay truthful), keeps the optional
// resume row limited to the current authorized book's real progress, and hands
// sign-in and the command palette back to the existing auth dialog and the one
// palette bootstrap. Close reasons are explicit: only a user close returns the
// initial opener; a breakpoint crossing returns the visible brand; auth and
// palette handoffs focus the visible menu trigger first; navigation closes
// without any later focus steal, apart from one guarded destination RAF that
// preserves default scrolling and any existing tabindex.
import {chooseCurrentBook} from './reading-calendar.mjs';
import {readingBookUrl} from './library-workspace.mjs';
import {safeLibraryReturn} from './library-view-state.mjs';
import {otherOverlayOpen,focusableTrigger} from './popover-controls.mjs';
import {registerDialogFocusOwner} from './interaction-craft.mjs';

export const HOME_NAV_ROUTES=Object.freeze(['/','/en','/zh-hans','/zh-hant','/ja']);
export const HOME_MENU_CLOSE_REASONS=Object.freeze(['user','navigation','auth-handoff','palette-handoff','breakpoint']);
export const HOME_MENU_DESKTOP_QUERY='(min-width:1101px)';
// The signed-in account entry uses the validated GET-179 library view codec.
export const HOME_ACCOUNT_URL=safeLibraryReturn('/library?settings=account')||'/library';

export const isHomeNavRoute=pathname=>HOME_NAV_ROUTES.includes(String(pathname||''));

const appearanceMenuOpen=document=>{const menu=document?.getElementById?.('site-appearance-menu');return !!menu&&!menu.hidden;};

export function mountHomeNavigation({
  document=globalThis.document,
  getSession=()=>null,
  getBooks=()=>[],
  getOwner=()=>null,
  openAuth=()=>{},
  openPalette=()=>{},
  matchMedia=globalThis.matchMedia?.bind?.(globalThis),
  requestAnimationFrame=fn=>globalThis.requestAnimationFrame(fn),
}={}){
  const dialog=document?.getElementById?.('home-menu');
  const trigger=document?.getElementById?.('home-menu-trigger');
  if(!dialog||!trigger)return null;
  const signInRow=document.getElementById('home-menu-signin');
  const accountRow=document.getElementById('home-menu-account');
  const resumeRow=document.getElementById('home-menu-resume');
  const resumeTitle=document.getElementById('home-menu-resume-title');
  const resumeAuthor=document.getElementById('home-menu-resume-author');
  const searchRow=document.getElementById('home-menu-search');
  const linksSlot=document.getElementById('home-menu-links');
  const languageSlot=document.getElementById('home-menu-languages');
  const nav=document.querySelector('.home-navigation');
  let opener=null,pendingReason=null,lastReason=null,destinationGeneration=0,disposed=false;

  const brandNode=()=>document.querySelector('.site-header')?.querySelector('.brand')||document.querySelector('a.brand')||null;
  const focusNode=node=>{if(node&&typeof node.focus==='function')node.focus({preventScroll:true});};
  const focusVisibleTrigger=()=>{
    const target=focusableTrigger(trigger)?trigger:focusableTrigger(brandNode())?brandNode():null;
    focusNode(target);
    return target;
  };
  const restoreOpener=()=>{
    const target=focusableTrigger(opener)?opener:focusableTrigger(trigger)?trigger:focusableTrigger(brandNode())?brandNode():null;
    focusNode(target);
    return target;
  };
  const focusBrand=()=>{const brand=brandNode();if(focusableTrigger(brand))focusNode(brand);};

  // The sheet's rows are the actual header anchors: one clone pass keeps real
  // localized hrefs and real anchor semantics. The unwired cloned palette
  // launcher is never copied; the sheet's own search row is the explicit port.
  const wireRow=row=>{
    if(!row||typeof row.addEventListener!=='function')return;
    row.addEventListener('click',event=>{
      if(disposed||event.defaultPrevented)return;
      if(typeof event.button==='number'&&event.button!==0)return;
      if(event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
      const href=row.getAttribute('href')||'';
      if(!href.startsWith('#')){closeMenu('navigation');return;}
      const target=href.length>1?document.getElementById(href.slice(1)):null;
      closeMenu('navigation');
      // One guarded destination frame: default anchor scrolling is never
      // prevented, an existing tabindex is never rewritten, and a newer modal
      // or superseded request may not steal focus later.
      const stamp=++destinationGeneration;
      requestAnimationFrame(()=>{
        if(disposed||stamp!==destinationGeneration||document.querySelector('dialog[open]'))return;
        if(!target||typeof target.focus!=='function')return;
        if(typeof target.hasAttribute==='function'&&!target.hasAttribute('tabindex')&&typeof target.setAttribute==='function')target.setAttribute('tabindex','-1');
        focusNode(target);
      });
    });
  };
  if(nav&&linksSlot){
    for(const child of [...nav.children]){
      if(child.tagName==='A'&&child.getAttribute('href')&&typeof child.cloneNode==='function'){
        const copy=child.cloneNode(true);
        linksSlot.append(copy);
        wireRow(copy);
      }else if(child.classList?.contains('home-languages')&&languageSlot&&typeof child.cloneNode==='function'){
        const copy=child.cloneNode(true);
        languageSlot.append(copy);
        for(const link of copy.querySelectorAll?.('a')||[])wireRow(link);
      }
    }
  }

  const clear=()=>{
    if(!resumeRow)return;
    resumeRow.hidden=true;
    resumeRow.removeAttribute('href');
    resumeRow.removeAttribute('title');
    if(resumeTitle)resumeTitle.textContent='';
    if(resumeAuthor)resumeAuthor.textContent='';
  };
  // Updates apply only against the captured current owner revision: a slow
  // refresh from a previous account can never write into this menu. Identity
  // rows sync on their own hook the moment a session settles; the optional
  // resume row needs current valid books and is never rebuilt from stale ones.
  const updateIdentity=ticket=>{
    const current=typeof getOwner==='function'?getOwner():null;
    if(ticket&&current&&(ticket.owner!==current.owner||ticket.revision!==current.revision))return false;
    const user=(typeof getSession==='function'?getSession():null)?.user||null;
    if(signInRow)signInRow.hidden=!!user;
    if(accountRow){accountRow.hidden=!user;if(user)accountRow.setAttribute('href',HOME_ACCOUNT_URL);}
    return true;
  };
  const update=ticket=>{
    if(!updateIdentity(ticket))return false;
    clear();
    const list=typeof getBooks==='function'?getBooks():null;
    const book=chooseCurrentBook(Array.isArray(list)?list:[]);
    if(book&&resumeRow){
      resumeRow.hidden=false;
      resumeRow.setAttribute('href',readingBookUrl(book,null));
      if(resumeTitle)resumeTitle.textContent=book.title?.zh||book.title?.en||'';
      if(resumeAuthor)resumeAuthor.textContent=book.author||book.source?.filename||'';
    }
    return true;
  };

  const onClose=()=>{
    const reason=pendingReason||'user';
    pendingReason=null;
    lastReason=reason;
    trigger.setAttribute('aria-expanded','false');
    if(reason==='user')restoreOpener();
  };
  function closeMenu(reason='user'){
    if(disposed)return;
    const use=HOME_MENU_CLOSE_REASONS.includes(reason)?reason:'user';
    pendingReason=use;
    lastReason=use;
    if(dialog.open)dialog.close();
    if(use==='auth-handoff'){focusVisibleTrigger();openAuth();}
    else if(use==='palette-handoff'){const target=focusVisibleTrigger()||trigger;openPalette(target);}
    else if(use==='breakpoint')focusBrand();
    return use;
  }
  const openMenu=()=>{
    if(disposed||dialog.open)return;
    // Refuse another modal or the open appearance popover instead of stacking.
    if(otherOverlayOpen(document)||appearanceMenuOpen(document))return;
    destinationGeneration++;
    const active=document.activeElement;
    opener=active&&active!==document.body&&typeof active.focus==='function'?active:trigger;
    pendingReason=null;
    trigger.setAttribute('aria-expanded','true');
    if(typeof dialog.showModal==='function')dialog.showModal();
    else dialog.setAttribute('open','');
  };

  const onTrigger=()=>{if(dialog.open)closeMenu('user');else openMenu();};
  const onSignIn=()=>closeMenu('auth-handoff');
  const onSearch=()=>closeMenu('palette-handoff');
  trigger.setAttribute('aria-haspopup','dialog');
  trigger.setAttribute('aria-controls','home-menu');
  trigger.setAttribute('aria-expanded','false');
  trigger.addEventListener('click',onTrigger);
  dialog.addEventListener('close',onClose);
  signInRow?.addEventListener?.('click',onSignIn);
  searchRow?.addEventListener?.('click',onSearch);
  wireRow(accountRow);
  wireRow(resumeRow);
  // This dialog owns its focus return per close reason; the shared close RAF in
  // interaction-craft must never compete with it.
  const releaseFocusOwner=registerDialogFocusOwner(dialog,'home-navigation');

  const desktop=typeof matchMedia==='function'?matchMedia(HOME_MENU_DESKTOP_QUERY):null;
  const onBreakpoint=()=>{if(desktop?.matches&&dialog.open)closeMenu('breakpoint');};
  if(desktop?.addEventListener)desktop.addEventListener('change',onBreakpoint);
  else desktop?.addListener?.(onBreakpoint);

  return {
    clear,
    update,
    updateIdentity,
    close:closeMenu,
    lastCloseReason:()=>lastReason,
    dispose(){
      if(disposed)return;
      disposed=true;
      if(dialog.open)dialog.close();
      trigger.removeEventListener('click',onTrigger);
      dialog.removeEventListener('close',onClose);
      signInRow?.removeEventListener?.('click',onSignIn);
      searchRow?.removeEventListener?.('click',onSearch);
      if(desktop?.removeEventListener)desktop.removeEventListener('change',onBreakpoint);
      else desktop?.removeListener?.(onBreakpoint);
      releaseFocusOwner();
    }
  };
}
