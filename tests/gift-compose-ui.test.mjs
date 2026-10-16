import test from 'node:test';
import assert from 'node:assert/strict';
import {mountGiftComposer} from '../app/gift-compose.mjs';

const tick=()=>new Promise(setImmediate),token='A'.repeat(43);
function mount(t,{seal=async()=>({token,recipient:'Reader'}),revoke=async()=>({})}={}){
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
  const controller=mountGiftComposer({dialog,body,getSession:()=>({user:{id:'owner',displayName:'Reader'}}),getOwner:()=> 'owner',show:()=>{body.replaceChildren();return 1;},current:()=>dialog.open,message:text=>messages.push(text),cover:()=>new Element('div'),api:async(path,data)=>{calls.push({path,data});if(data===undefined)return {gifts:[{token:'B'.repeat(43),recipient:'Old'}]};return path.endsWith('/revoke')?revoke():seal();}});
  const all=node=>[node,...node.children.flatMap(all)],find=text=>all(body).find(node=>node.textContent===text),id=value=>all(body).find(node=>node.id===value);
  const click=element=>{element.focus();if(!element.disabled)element.dispatchEvent(new Event('click'));};
  return {document,dialog,body,messages,calls,controller,find,id,click,all:()=>all(body)};
}

test('local preview does not publish; a failed seal preserves the draft and returns retry focus once',async t=>{
  let reject;const f=mount(t,{seal:()=>new Promise((resolve,no)=>{reject=no;})});await f.controller.open({bookId:'book',title:{zh:'Book'}});
  f.id('gift-recipient').value='Draft reader';f.id('gift-message').value='Draft words';
  f.click(f.find('看看收信时的样子'));assert.equal(f.calls.filter(call=>call.data!==undefined).length,0);
  const seal=f.find('封好这封信，生成链接');f.click(seal);f.click(seal);assert.equal(f.calls.filter(call=>call.data!==undefined).length,1);assert.equal(seal.disabled,true);
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
