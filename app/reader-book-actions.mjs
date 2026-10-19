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
  const make=(tag,cls,text)=>{const node=document.createElement(tag);if(cls)node.className=cls;if(text!==undefined)node.textContent=text;return node;};
  const signedIn=!!(bookId&&session?.user),loginUrl=()=>readerLoginUrl({bookId});
  let disposed=false,unsubscribe=()=>{},sequence=0,activeBookId=null,activeVersion=null,composer=null,giftModule=null,openingTicket=null;
  // Terminal disposal makes every action, render and asynchronous handler
  // inert: a captured stale control can never call the API or re-enable a
  // control afterwards.
  function render(value){
    if(disposed)return;
    const book=getBook();if(!book)return;
    const display=value||{...introductionFor(book),introduction:book.introduction||null,phase:'idle',available:true};
    $('book-info-description').textContent=display.text||'这本书还没有简介。';
    note.hidden=display.source!=='ai';note.textContent=display.source==='ai'?'AI 简介初稿 · 仅依据目录与正文开头取样，尚未人工核对。':'';
    const missing=display.source==='missing',working=['generating','loading'].includes(display.phase);
    generate.hidden=!missing||!signedIn;generate.disabled=working||display.available===false;generate.textContent=display.phase==='generating'?'正在生成 AI 简介…':display.available===false?'AI 简介暂未配置':'生成 AI 简介';
    login.hidden=!bookId||signedIn||!missing;login.href=loginUrl();
    scope.hidden=!missing;scope.textContent=!bookId?'将书导入自己的书房后，可以生成简介和分享。':signedIn?'由已配置的 AI 读取书名、目录和开头最多 6 段（6000 字符），不含私人笔记。单次费用上限 ¥0.10。':'登录后可以生成并保存自己的 AI 简介初稿。';
    status.textContent=display.error|| (display.phase==='generating'?'正在生成，关闭介绍会取消本次请求。':display.phase==='loading'?'正在读取已保存的简介…':'');status.setAttribute('role',display.error?'alert':'status');
    share.disabled=!bookId;share.textContent=signedIn?'分享这本书':'登录后分享这本书';
  }
  const intro=createIntroductionController({getBook,request:(data,options)=>api('/api/introduction',data,options),onChange:render,onSaved:value=>{const book=getBook();if(book&&introductionFor({...book,introduction:value}).source==='ai')book.introduction=value;}});
  const message=(text,error=false)=>{messageNode.textContent=text;messageNode.setAttribute('role',error?'alert':'status');};
  const current=ticket=>ticket===sequence&&dialog.open&&getBook()?.bookId===activeBookId&&getBook()?.contentVersion===activeVersion;
  const show=(book,title)=>{sequence++;activeBookId=book.bookId;activeVersion=book.contentVersion;heading.textContent=title;body.replaceChildren();message('');intro.close();info.close();if(!dialog.open)dialog.showModal();return sequence;};
  // The optional gift module loads once; its controller is constructed only
  // after the import settles for a request that is still current and alive, so
  // a late module is never more than cached code and ordinary close/reopen
  // keeps the existing draft semantics through the shared composer.
  const loadGiftModule=()=>giftModule??=(Promise.resolve(loadGiftComposer()).catch(error=>{giftModule=null;throw error;}));
  const attachGift=({mountGiftComposer,paintBookCover})=>composer??=mountGiftComposer({api,dialog,body,getSession:()=>session,getOwner:()=>session?.user?.id||'guest',message,current,
    cover:book=>{const node=make('div','action-book-cover');node.setAttribute('aria-hidden','true');paintBookCover(node,book);return node;},
    show});
  const onGenerate=()=>{if(!disposed)intro.generate();};
  const onShare=async()=>{
    if(disposed||!bookId)return;if(!signedIn){document.defaultView.location.assign(loginUrl());return;}
    const book=getBook();if(!book||openingTicket!==null&&current(openingTicket))return;
    const ticket=show(book,'写一封赠书信');openingTicket=ticket;message('正在打开赠书信…');
    try{
      const module=await loadGiftModule();
      // Recheck terminal disposal and the captured source/sequence before the
      // late controller is constructed, not only before it is opened.
      if(disposed||!current(ticket))return;
      await attachGift(module).open(book);
    }
    catch{if(!disposed&&current(ticket))message('赠书信暂时无法打开，请关闭后重试。',true);}
    finally{if(openingTicket===ticket)openingTicket=null;}
  };
  const onClose=()=>dialog.close();
  const onDialogClose=()=>{sequence++;body.replaceChildren();message('');dialog.classList.remove('gift-compose-dialog');
    // An old close never steals focus from a newer modal or an intentional
    // outside target; the connected visible title trigger takes it otherwise.
    const active=document.activeElement;
    if((!active||active===document.body||dialog.contains(active))&&trigger&&trigger.isConnected!==false&&!trigger.hidden&&!trigger.closest?.('[inert]')&&trigger.getClientRects?.().length!==0)trigger.focus({preventScroll:true});
  };
  const refresh=()=>{if(disposed)return;const value=intro.snapshot(),book=getBook();render(value.bookId===book?.bookId&&value.contentVersion===book?.contentVersion&&value.phase!=='idle'?value:undefined);};
  const staleDialog=()=>{if(dialog.open&&!current(sequence))dialog.close();};
  // clear() is ordinary owner reset; dispose() additionally unsubscribes,
  // detaches listeners and disables this enhancement's controls before an
  // owner/session leave so stale private UI cannot be touched afterwards.
  const cancel=()=>{sequence++;intro.close();if(dialog.open)dialog.close();composer?.clear();};
  const dispose=()=>{
    if(disposed)return;
    disposed=true;
    unsubscribe();
    generate.removeEventListener('click',onGenerate);
    share.removeEventListener('click',onShare);
    close.removeEventListener('click',onClose);
    dialog.removeEventListener('close',onDialogClose);
    for(const event of ['reader:ready','reader:chapter'])document.removeEventListener(event,refresh);
    document.removeEventListener('reader:ready',staleDialog);
    cancel();
    generate.hidden=true;login.hidden=true;share.disabled=true;share.textContent='分享这本书';
    dialog.remove?.();
  };
  const dialog=make('dialog','book-action-dialog reader-book-gift');dialog.id='reader-book-gift';dialog.setAttribute('aria-labelledby','reader-gift-title');
  const head=make('header','book-action-heading'),heading=make('h2'),close=make('button','book-action-close','×');heading.id='reader-gift-title';close.type='button';close.setAttribute('aria-label','关闭赠书');head.append(heading,close);
  const body=make('div','book-action-body'),messageNode=make('p','book-action-status');messageNode.setAttribute('role','status');dialog.append(head,body,messageNode);
  try{
    document.body.append(dialog);
    generate.addEventListener('click',onGenerate);
    share.addEventListener('click',onShare);
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
