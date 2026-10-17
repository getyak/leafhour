import {createIntroductionController} from './book-introduction-controller.mjs';
import {introductionFor} from './book-introduction.mjs';
import {mountGiftComposer} from './gift-compose.mjs';
import {paintBookCover} from './book-binding.mjs';
import {readerLoginUrl} from './reader-return.mjs';

export function mountReaderBookActions({document,getBook,api,session,bookId}){
  const $=id=>document.getElementById(id),popover=$('book-info'),trigger=$('open-book-info'),generate=$('book-intro-generate'),login=$('book-intro-login'),share=$('book-info-share'),status=$('book-intro-status'),note=$('book-intro-provenance'),scope=$('book-intro-scope');
  const make=(tag,cls,text)=>{const node=document.createElement(tag);if(cls)node.className=cls;if(text!==undefined)node.textContent=text;return node;};
  const signedIn=!!(bookId&&session?.user),loginUrl=()=>readerLoginUrl({bookId});
  function render(value){
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
  generate.addEventListener('click',()=>intro.generate());
  popover.addEventListener('toggle',event=>{if(event.newState==='open'){render();if(signedIn)void intro.open();}else intro.close();});
  for(const event of ['reader:ready','reader:chapter'])document.addEventListener(event,()=>{const value=intro.snapshot(),book=getBook();render(value.bookId===book?.bookId&&value.contentVersion===book?.contentVersion&&value.phase!=='idle'?value:undefined);});

  const dialog=make('dialog','book-action-dialog reader-book-gift');dialog.id='reader-book-gift';dialog.setAttribute('aria-labelledby','reader-gift-title');
  const head=make('header','book-action-heading'),heading=make('h2'),close=make('button','book-action-close','×');heading.id='reader-gift-title';close.type='button';close.setAttribute('aria-label','关闭赠书');head.append(heading,close);
  const body=make('div','book-action-body'),messageNode=make('p','book-action-status');messageNode.setAttribute('role','status');dialog.append(head,body,messageNode);document.body.append(dialog);
  let sequence=0,activeBookId=null,activeVersion=null;
  const message=(text,error=false)=>{messageNode.textContent=text;messageNode.setAttribute('role',error?'alert':'status');};
  const current=ticket=>ticket===sequence&&dialog.open&&getBook()?.bookId===activeBookId&&getBook()?.contentVersion===activeVersion;
  const composer=mountGiftComposer({api,dialog,body,getSession:()=>session,getOwner:()=>session?.user?.id||'guest',message,current,
    cover:book=>{const node=make('div','action-book-cover');node.setAttribute('aria-hidden','true');paintBookCover(node,book);return node;},
    show:(book,title)=>{sequence++;activeBookId=book.bookId;activeVersion=book.contentVersion;heading.textContent=title;body.replaceChildren();message('');intro.close();if(popover.matches(':popover-open'))popover.hidePopover();if(!dialog.open)dialog.showModal();return sequence;}});
  close.addEventListener('click',()=>dialog.close());
  dialog.addEventListener('close',()=>{sequence++;body.replaceChildren();message('');dialog.classList.remove('gift-compose-dialog');trigger.focus({preventScroll:true});});
  share.addEventListener('click',()=>{if(!bookId)return;if(!signedIn){document.defaultView.location.assign(loginUrl());return;}const book=getBook();if(book)void composer.open(book).catch(error=>message(error.message,true));});
  document.addEventListener('reader:ready',()=>{if(dialog.open&&!current(sequence))dialog.close();});
  return {render,clear:()=>{intro.close();if(dialog.open)dialog.close();composer.clear();}};
}
