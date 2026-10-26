import {getUiLinkLocale,t,getUiLocale,uiReady,onUiLocaleChange,createUiLabels,createUiMessage} from './ui-locale.mjs';
import {createIntroductionController} from './book-introduction-controller.mjs';
import {introductionFor} from './book-introduction.mjs';
import {readerLoginUrl} from './reader-return.mjs';

// GET-173 lazy bookplate enhancement (AI introduction and gifting). It is
// loaded on actual book-info open by reader-book-actions-bootstrap.mjs and is
// injected with the page's one shared popover handle; this module never
// imports or mounts popover-controls.mjs itself, so a second registry copy
// cannot exist beside the eagerly bundled controller.
export function mountReaderBookActions({document,info,getBook,api,session,bookId,loadGiftComposer=()=>Promise.all([import('./gift-compose.mjs'),import('./book-binding.mjs')]).then(modules=>Object.assign({},...modules))}){
  const $=id=>document.getElementById(id),trigger=$('open-book-info'),generate=$('book-intro-generate'),login=$('book-intro-login'),share=$('book-info-share'),status=$('book-intro-status'),note=$('book-intro-provenance'),scope=$('book-intro-scope');
  const exportButton=$('book-info-export'),retry=$('book-intro-retry');
  const make=(tag,cls,text)=>{const node=document.createElement(tag);if(cls)node.className=cls;if(text!==undefined)node.textContent=text;return node;};
  const signedIn=!!(bookId&&session?.user),loginUrl=()=>readerLoginUrl({bookId,ui:getUiLinkLocale()});
  let disposed=false,unsubscribe=()=>{},sequence=0,activeBookId=null,activeVersion=null,composer=null,giftModule=null,openingTicket=null;
  const labels=createUiLabels(),descriptionLabels=createUiLabels(),dialogLabels=createUiLabels();let descriptionFallback=false,loginPath=null;
  const text=(n,key,params)=>labels.text(n,'bookActions.'+key,params);
  const relabel=()=>{if(disposed)return;labels.refresh();descriptionLabels.refresh();dialogLabels.refresh();if(descriptionFallback)$('book-info-description').setAttribute('lang',getUiLocale());if(loginPath)login.href=readerLoginUrl({bookId:loginPath,ui:getUiLinkLocale()});statusMessage.refresh();giftMessage.refresh();};
  let offLocale=()=>{};
  // Terminal disposal makes every action, render and asynchronous handler
  // inert: a captured stale control can never call the API or re-enable a
  // control afterwards.
  function render(value){
    if(disposed)return;
    const book=getBook();if(!book)return;
    labels.clear();
    const display=value||{...introductionFor(book),introduction:book.introduction||null,phase:'idle',available:null};
    const working=['generating','loading'].includes(display.phase),failed=display.phase==='error',missing=display.source==='missing';
    descriptionLabels.clear();descriptionFallback=!display.text&&!working&&!failed;
    const description=$('book-info-description');if(display.text){if(description.textContent!==display.text)description.textContent=display.text;description.setAttribute('lang','und');}else if(descriptionFallback){descriptionLabels.text(description,'bookActions.missing');description.setAttribute('lang',getUiLocale());}else description.textContent='';
    description.hidden=!display.text&&!descriptionFallback;
    const region=$('book-info');if(region){region.dataset.introductionState=working?'loading':failed?'error':display.text?'ready':'empty';}
    description.setAttribute('aria-busy',String(working));
    note.hidden=display.source!=='ai';if(display.source==='ai')text(note,'aiNote');else note.textContent='';
    generate.hidden=!missing||!signedIn;generate.disabled=working||display.available!==true;text(generate,display.phase==='generating'?'generating':display.available===false?'unavailable':'generate');
    login.hidden=!bookId||signedIn||!missing;loginPath=bookId;login.href=loginUrl();text(login,'signIn');
    scope.hidden=!!bookId&&(!missing||working);text(scope,!bookId?'importScope':signedIn?'scope':'signInScope');
    if(retry){retry.hidden=!failed;text(retry,'retry');}
    if(display.error){const key=({timeout:'introTimeout',access:'introAccess',busy:'introBusy',changed:'introChanged',generate:'generateFailure'})[display.errorKind]||'introFailure';statusMessage.set('bookActions.'+key,undefined,true);}else if(display.phase==='generating'||display.phase==='loading')statusMessage.set('bookActions.'+(display.phase==='generating'?'generatingNote':'loading'));else statusMessage.clear();
    if(exportButton){exportButton.disabled=!bookId;labels.text(exportButton,'export.title');}
    share.disabled=!bookId;if(bookId)share.removeAttribute('aria-describedby');else share.setAttribute('aria-describedby','book-intro-scope');text(share,signedIn?'share':'signInShare');
  }
  const intro=createIntroductionController({getBook,getOwner:()=>session?.user?.id||'guest',request:(data,options)=>api('/api/introduction',data,options),onChange:render,onSaved:value=>{const book=getBook();if(book&&introductionFor({...book,introduction:value}).source==='ai')book.introduction=value;}});
  const statusMessage=createUiMessage((text,error)=>{status.textContent=text;status.setAttribute('role',error?'alert':'status');status.setAttribute('aria-live',error?'assertive':'polite');});
  const giftMessage=createUiMessage((text,error)=>{messageNode.textContent=text;messageNode.setAttribute('role',error?'alert':'status');});
  const message=(text,error=false)=>{giftMessage.clear();messageNode.textContent=text;messageNode.setAttribute('role',error?'alert':'status');};
  const notice=(id,error=false)=>giftMessage.set('bookActions.'+id,undefined,error);
  const current=ticket=>!disposed&&ticket===sequence&&dialog.open&&getBook()?.bookId===activeBookId&&getBook()?.contentVersion===activeVersion;
  const show=(book,title)=>{sequence++;activeBookId=book.bookId;activeVersion=book.contentVersion;dialogLabels.clear();dialogLabels.attr(close,'aria-label','bookActions.closeGift');if(title&&typeof title==='object')dialogLabels.text(heading,title.id,title.params);else heading.textContent=title;dialogLabels.attr(close,'aria-label','bookActions.closeGift');body.replaceChildren();message('');intro.close();info.close();if(!dialog.open)dialog.showModal();return sequence;};
  // The optional gift module loads once; its controller is constructed only
  // after the import settles for a request that is still current and alive, so
  // a late module is never more than cached code and ordinary close/reopen
  // keeps the existing draft semantics through the shared composer.
  const loadGiftModule=()=>giftModule??=(Promise.resolve(loadGiftComposer()).catch(error=>{giftModule=null;throw error;}));
  const attachGift=({mountGiftComposer,paintBookCover})=>composer??=mountGiftComposer({api,dialog,body,getSession:()=>session,getOwner:()=>session?.user?.id||'guest',message,current,
    cover:book=>{const node=make('div','action-book-cover');node.setAttribute('aria-hidden','true');paintBookCover(node,book);return node;},
    show});
  const onRetry=()=>{if(!disposed&&info.isOpen()){if(document.activeElement===retry)info.element?.focus({preventScroll:true});void intro.open();}};
  const onGenerate=()=>{if(!disposed&&!generate.disabled&&!generate.hidden)intro.generate();};
  const onShare=async()=>{
    if(disposed||!bookId)return;if(!signedIn){document.defaultView.location.assign(loginUrl());return;}
    const book=getBook();if(!book||openingTicket!==null&&current(openingTicket))return;
    const ticket=show(book,{id:'bookActions.writeGift'});openingTicket=ticket;notice('openingGift');
    try{
      const module=await loadGiftModule();
      // Recheck terminal disposal and the captured source/sequence before the
      // late controller is constructed, not only before it is opened.
      if(disposed||!current(ticket))return;
      await attachGift(module).open(book);
    }
    catch{if(!disposed&&current(ticket))notice('giftFailure',true);}
    finally{if(openingTicket===ticket)openingTicket=null;}
  };
  const onExport=async()=>{
    if(disposed||!bookId)return;const book=getBook();if(!book)return;
    const ticket=show(book,{id:'export.title'});dialogLabels.attr(close,'aria-label','export.close');
    const notify=(id,params,error)=>giftMessage.set(id,params,error);
    try{const {mountBookExport}=await import('./book-export-ui.mjs');if(!current(ticket))return;await mountBookExport({document,body,book,api,current:()=>current(ticket),t,locale:getUiLocale,notice:notify,label:(el,id)=>dialogLabels.text(el,id)});}
    catch{if(current(ticket))notify('export.error',null,true);}
  };
  const onClose=()=>dialog.close();
  const onDialogClose=()=>{sequence++;body.replaceChildren();message('');dialog.classList.remove('gift-compose-dialog');
    // An old close never steals focus from a newer modal or an intentional
    // outside target; the connected visible title trigger takes it otherwise.
    const active=document.activeElement;
    if((!active||active===document.body||dialog.contains(active))&&trigger&&trigger.isConnected!==false&&!trigger.hidden&&!trigger.closest?.('[inert]')&&trigger.getClientRects?.().length!==0)trigger.focus({preventScroll:true});
  };
  const refresh=()=>{if(disposed)return;const value=intro.snapshot(),book=getBook();if(value.bookId!==book?.bookId||value.contentVersion!==book?.contentVersion){intro.close();render();if(signedIn&&info.isOpen())void intro.open();return;}render(value);};
  const staleDialog=()=>{if(dialog.open&&!current(sequence))dialog.close();};
  // clear() is ordinary owner reset; dispose() additionally unsubscribes,
  // detaches listeners and disables this enhancement's controls before an
  // owner/session leave so stale private UI cannot be touched afterwards.
  const cancel=()=>{sequence++;intro.close();if(dialog.open)dialog.close();composer?.clear();labels.clear();descriptionLabels.clear();dialogLabels.clear();descriptionFallback=false;loginPath=null;statusMessage.clear();giftMessage.clear();$('book-info-description').textContent='';note.textContent='';};
  const dispose=()=>{
    if(disposed)return;
    disposed=true;
    unsubscribe();offLocale();
    generate.removeEventListener('click',onGenerate);retry?.removeEventListener('click',onRetry);
    share.removeEventListener('click',onShare);
    exportButton?.removeEventListener('click',onExport);if(exportButton)exportButton.disabled=true;
    close.removeEventListener('click',onClose);
    dialog.removeEventListener('close',onDialogClose);
    for(const event of ['reader:ready','reader:chapter'])document.removeEventListener(event,refresh);
    document.removeEventListener('reader:ready',staleDialog);
    cancel();
    generate.hidden=true;login.hidden=true;share.disabled=true;share.textContent=t('bookActions.share');
    dialog.remove?.();
  };
  const dialog=make('dialog','book-action-dialog reader-book-gift');dialog.id='reader-book-gift';dialog.setAttribute('aria-labelledby','reader-gift-title');
  const head=make('header','book-action-heading'),heading=make('h2'),close=make('button','book-action-close','×');heading.id='reader-gift-title';close.type='button';close.setAttribute('aria-label',t('bookActions.closeGift'));head.append(heading,close);
  const body=make('div','book-action-body'),messageNode=make('p','book-action-status');messageNode.setAttribute('role','status');dialog.append(head,body,messageNode);
  try{
    offLocale=onUiLocaleChange(relabel);void uiReady.then(relabel);
    document.body.append(dialog);
    generate.addEventListener('click',onGenerate);retry?.addEventListener('click',onRetry);
    share.addEventListener('click',onShare);
    exportButton?.addEventListener('click',onExport);
    close.addEventListener('click',onClose);
    dialog.addEventListener('close',onDialogClose);
    // The injected shared handle owns every transition: subscribing while the
    // bookplate already shows processes that open state exactly once.
    unsubscribe=info.subscribe({onChange:open=>{if(disposed)return;if(open){render();if(signedIn)void intro.open();}else intro.close();}});
    for(const event of ['reader:ready','reader:chapter'])document.addEventListener(event,refresh);
    document.addEventListener('reader:ready',staleDialog);
  }catch(error){
    // A setup failure rolls back every partially attached listener and node so
    // an honest retry can never duplicate or poison the mounted state.
    dispose();
    throw error;
  }
  return {render,clear:cancel,dispose};
}
