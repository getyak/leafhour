import test from 'node:test';
import assert from 'node:assert/strict';
import {mountGiftComposer} from '../app/gift-compose.mjs';

const tick=()=>new Promise(setImmediate),token='A'.repeat(43);
const prepared=(text='Read this first.',receipt='Q'.repeat(32),selection='ai-selected')=>({receipt,selection,text,chapterId:'ch01',chapterTitle:'Opening',passageId:'p1',start:0,end:16,codepoints:16,expiresAt:'2026-10-18T05:00:00.000Z'});
const quoteReply=(quote,bookId='book')=>({kind:'marginalia-gift-quote',schemaVersion:1,bookId,contentVersion:'edition-1',quote});
const sealPosts=calls=>calls.filter(call=>call.path.endsWith('/gifts')&&call.data!==undefined);
const quotePosts=calls=>calls.filter(call=>call.path.endsWith('/gift-quote'));
function mount(t,{seal=async()=>({token,recipient:'Reader'}),revoke=async()=>({}),quote=()=>quoteReply(prepared()),getOwner=()=> 'owner'}={}){
  const saved=Object.fromEntries(['document','window','location'].map(key=>[key,globalThis[key]]));
  const document=Object.assign(new EventTarget(),{activeElement:null});
  class Element extends EventTarget{
    constructor(tag){super();this.tagName=tag.toUpperCase();this.children=[];this.dataset={};this.attributes={};this.className='';this.textContent='';this.value='';this.classList={add(){}};this.contentWindow={postMessage(){}};}
    contains(target){return this===target||this.children.some(child=>child.contains(target));}
    append(...children){for(const child of children){child.parentElement=this;this.children.push(child);}}
    prepend(child){child.parentElement=this;this.children.unshift(child);}
    replaceChildren(...children){if(this.children.some(child=>child.contains(document.activeElement)))document.activeElement=document.body;this.children=[];this.append(...children);}
    remove(){if(this.contains(document.activeElement))document.activeElement=document.body;this.parentElement.children=this.parentElement.children.filter(child=>child!==this);}
    set hidden(value){this._hidden=value;if(value&&this.contains(document.activeElement))document.activeElement=document.body;}
    get hidden(){return !!this._hidden;}
    set disabled(value){this._disabled=value;if(value&&document.activeElement===this)document.activeElement=document.body;}
    get disabled(){return !!this._disabled;}
    setAttribute(key,value){this.attributes[key]=String(value);}
    removeAttribute(key){delete this.attributes[key];}
    focus(){document.activeElement=this;const event=new Event('focusin');Object.defineProperty(event,'target',{value:this});document.dispatchEvent(event);}
  }
  document.body=new Element('body');document.activeElement=document.body;document.createElement=tag=>new Element(tag);
  globalThis.document=document;globalThis.window=new EventTarget();globalThis.location={origin:'https://example.invalid'};
  t.after(()=>{for(const [key,value]of Object.entries(saved))if(value===undefined)delete globalThis[key];else globalThis[key]=value;});
  const dialog=new Element('dialog'),body=new Element('div'),messages=[],calls=[];dialog.open=true;dialog.append(body);
  let sequence=0;
  const controller=mountGiftComposer({dialog,body,getSession:()=>({user:{id:'owner',displayName:'Reader'}}),getOwner,show:()=>{body.replaceChildren();sequence++;return sequence;},current:ticket=>ticket===sequence&&dialog.open,message:text=>messages.push(text),cover:()=>new Element('div'),api:async(path,data)=>{calls.push({path,data});if(path.endsWith('/gift-quote'))return quote();if(data===undefined)return {gifts:[{token:'B'.repeat(43),recipient:'Old'}]};return path.endsWith('/revoke')?revoke():seal();}});
  const all=node=>[node,...node.children.flatMap(all)],find=text=>all(body).find(node=>node.textContent===text),id=value=>all(body).find(node=>node.id===value);
  const click=element=>{element.focus();if(!element.disabled)element.dispatchEvent(new Event('click'));};
  return {document,dialog,body,messages,calls,controller,find,id,click,all:()=>all(body)};
}

test('local preview does not publish; a failed seal preserves the draft and returns retry focus once',async t=>{
  let reject;const f=mount(t,{seal:()=>new Promise((resolve,no)=>{reject=no;})});await f.controller.open({bookId:'book',title:{zh:'Book'}});
  f.id('gift-recipient').value='Draft reader';f.id('gift-message').value='Draft words';
  f.click(f.find('看看收信时的样子'));assert.equal(sealPosts(f.calls).length,0);
  const seal=f.find('封好这封信，生成链接');f.click(seal);f.click(seal);assert.equal(sealPosts(f.calls).length,1);assert.equal(seal.disabled,true);
  reject(Error('Try again'));await tick();assert.equal(seal.disabled,false);assert.equal(f.document.activeElement,seal);assert.equal(f.id('gift-message').value,'Draft words');assert.equal(f.id('gift-recipient').value,'Draft reader');
});

test('sealing after the reader moves focus preserves that new focus',async t=>{
  let resolve;const f=mount(t,{seal:()=>new Promise(ok=>{resolve=ok;})});await f.controller.open({bookId:'book',title:{zh:'Book'}});f.click(f.find('看看收信时的样子'));f.click(f.find('封好这封信，生成链接'));
  const elsewhere=f.document.createElement('button');elsewhere.focus();resolve({token});await tick();assert.equal(f.document.activeElement,elsewhere);assert.ok(f.find('复制赠书链接'));
});

test('keep and failed revoke return focus; successful revoke focuses its receipt and rewriting enters the draft',async t=>{
  let fail=true;const f=mount(t,{revoke:async()=>{if(fail)throw Error('Try again');return {};}});await f.controller.open({bookId:'book',title:{zh:'Book'}});await tick();
  const revoke=f.find('收回');f.click(revoke);assert.equal(f.document.activeElement,f.find('确认收回'));f.click(f.find('保留'));assert.equal(f.document.activeElement,revoke);
  f.click(revoke);f.click(f.find('确认收回'));await tick();assert.equal(f.document.activeElement,f.find('确认收回'));assert.equal(f.find('保留').disabled,false);
  fail=false;f.click(f.find('确认收回'));await tick();assert.equal(f.document.activeElement.textContent,'');assert.equal(f.document.activeElement.children[0].textContent,'这封信已收回。');
  f.click(f.find('看看收信时的样子'));f.click(f.find('封好这封信，生成链接'));await tick();const current=f.all().find(node=>node.dataset.token===token&&node.className==='gift-history-row');f.click(current.children.find(node=>node.textContent==='收回'));f.click(f.find('确认收回'));await tick();f.click(f.find('重新写一封'));assert.equal(f.document.activeElement,f.id('gift-recipient'));
});

test('opening the composer prepares one quotation, states its source and seals only the receipt',async t=>{
  const f=mount(t);const opening=f.controller.open({bookId:'book',title:{zh:'Book'}});
  assert.equal(quotePosts(f.calls).length,1,'the default quotation is requested once per opening');
  assert.ok(f.find('引文会从这本书的原文中选出，不会用到你的笔记和阅读记录。'),'the source rule is stated before any result');
  assert.ok(f.find('正在从这本书的原文中选出引文…'));
  await opening;await tick();
  assert.ok(f.find('Read this first.'));assert.ok(f.find('Opening · p1'),'chapter and passage travel with the quotation');
  assert.ok(f.find('从这本书的原文中由 AI 选出'),'the selection label is honest');
  f.id('gift-recipient').value='Draft reader';f.id('gift-message').value='Draft words';
  f.click(f.find('看看收信时的样子'));f.click(f.find('封好这封信，生成链接'));await tick();
  assert.deepEqual(sealPosts(f.calls)[0].data,{recipient:'Draft reader',message:'Draft words',includeTranslations:true,quoteReceipt:'Q'.repeat(32)},'seal carries the prepared receipt and no client quote text');
  assert.equal(quotePosts(f.calls).length,1,'sealing reuses the prepared selection instead of asking twice');
});

test('removing, restoring and re-fetching the quotation keeps the handwritten message and recipient',async t=>{
  const replies=[quoteReply(prepared()),quoteReply(prepared('Keep your own question.','W'.repeat(32),'original-excerpt'))];let index=0;
  const f=mount(t,{quote:()=>replies[index++]});
  await f.controller.open({bookId:'book',title:{zh:'Book'}});await tick();
  f.id('gift-recipient').value='Draft reader';f.id('gift-message').value='Draft words';
  f.click(f.find('移除引文'));assert.equal(f.find('Read this first.'),undefined);assert.ok(f.find('引文已移除，可以恢复或重新获取。'));
  assert.equal(f.id('gift-message').value,'Draft words');assert.equal(f.id('gift-recipient').value,'Draft reader');
  assert.ok(f.find('恢复引文'),'after removal the same prepared selection can be restored');
  f.click(f.find('恢复引文'));assert.ok(f.find('Read this first.'));
  assert.equal(quotePosts(f.calls).length,1,'restoring reuses the prepared selection without a new request');
  assert.ok(f.find('重新获取只是恢复选句，不承诺换一句；已有引文可能保持不变。'),'recovery wording is honest about unchanged text');
  f.click(f.find('重新获取引文'));assert.ok(f.find('正在从这本书的原文中选出引文…'));
  await tick();assert.ok(f.find('Keep your own question.'));assert.ok(f.find('这本书的原文节选'));
  assert.equal(f.id('gift-message').value,'Draft words');assert.equal(f.id('gift-recipient').value,'Draft reader');
  assert.equal(quotePosts(f.calls).length,2);
  f.click(f.find('看看收信时的样子'));f.click(f.find('封好这封信，生成链接'));await tick();
  assert.equal(sealPosts(f.calls)[0].data.quoteReceipt,'W'.repeat(32));
});

test('a slow quotation answer after an account switch, another book or a closed dialog cannot replace the dialog or create a share',async t=>{
  let release,call=0,owner='owner';const deferred=[];
  const f=mount(t,{getOwner:()=>owner,quote:()=>{call++;if(call<3)return new Promise(ok=>{deferred.push(ok);});return quoteReply(prepared('Fresh quote.','F'.repeat(32)));}});
  const opening=f.controller.open({bookId:'book',title:{zh:'Book'}});
  owner='other';await tick();deferred[0](quoteReply(prepared('STALE ACCOUNT QUOTE','S'.repeat(32))));await opening;await tick();
  assert.equal(f.find('STALE ACCOUNT QUOTE'),undefined,'an account switch discards the in-flight answer');
  assert.ok(f.find('正在从这本书的原文中选出引文…'));
  owner='owner';f.dialog.open=false;f.controller.clear();f.dialog.open=true;
  const reopened=f.controller.open({bookId:'book',title:{zh:'Book'}});await reopened;
  deferred[1](quoteReply(prepared('WRONG BOOK QUOTE','S'.repeat(32)),'another-book'));await tick();
  assert.equal(f.find('WRONG BOOK QUOTE'),undefined,'an answer for another book or version never enters this dialog');
  f.click(f.find('重新获取引文'));await tick();
  assert.ok(f.find('Fresh quote.'),'the reopened dialog recovers with its own quotation');
  f.click(f.find('看看收信时的样子'));f.click(f.find('封好这封信，生成链接'));await tick();
  assert.equal(sealPosts(f.calls)[0].data.quoteReceipt,'F'.repeat(32),'a stale answer can never feed a share');
});

test('an unusable quotation payload fails closed instead of forging an AI label',async t=>{
  const f=mount(t,{quote:()=>quoteReply({selection:'ai-selected',text:'FORGED <img src=x> quote',chapterTitle:'Nowhere',passageId:'x'})});
  await f.controller.open({bookId:'book',title:{zh:'Book'}});await tick();
  assert.equal(f.find('FORGED <img src=x> quote'),undefined);assert.equal(f.find('从这本书的原文中由 AI 选出'),undefined);
  assert.ok(f.find('引文暂时没有选出，可以重新获取。'));
  f.click(f.find('看看收信时的样子'));f.click(f.find('封好这封信，生成链接'));await tick();
  assert.equal(sealPosts(f.calls)[0].data.quoteReceipt,null);
});
