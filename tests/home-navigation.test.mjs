import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {requestUiRoute,t,getUiLocale,createUiLocale} from '../app/ui-locale.mjs';
import jaCatalogue from '../app/ui-catalogs/ja.mjs';
import hansCatalogue from '../app/ui-catalogs/zh-Hans.mjs';
import hantCatalogue from '../app/ui-catalogs/zh-Hant.mjs';
const catalogues={ja:jaCatalogue,'zh-Hans':hansCatalogue,'zh-Hant':hantCatalogue};
import {parse} from 'acorn';
import vm from 'node:vm';
import {authReturnTarget} from '../app/library-view-state.mjs';
const mounted=[];test.afterEach(async()=>{for(const menu of mounted.splice(0))menu.dispose();await requestUiRoute('en');});
import {mountHomeNavigation,isHomeNavRoute,HOME_NAV_ROUTES,HOME_MENU_CLOSE_REASONS} from '../app/home-navigation.mjs';

// Realistic DOM fixture: real dialog open/close lifecycle, computed-style
// visibility for focusableTrigger, and owned RAF scheduling so the guarded
// destination focus can be observed exactly once.
class Node{
  constructor(tag,doc){
    this.tagName=String(tag).toUpperCase();this.ownerDocument=doc;this.parentElement=null;this.children=[];
    this.attributes=new Map();this.dataset={};this.className='';this.id='';this.textContent='';this.hidden=false;this.disabled=false;
    this.listeners=new Map();this._visible=true;this.isConnected=true;this.open=false;this.focusLog=[];
  }
  addEventListener(type,fn){this.listeners.set(type,[...(this.listeners.get(type)||[]),fn]);}
  removeEventListener(type,fn){this.listeners.set(type,(this.listeners.get(type)||[]).filter(x=>x!==fn));}
  dispatchEvent(event){dispatch(this,event);return !event.defaultPrevented;}
  emit(type,props={}){dispatch(this,makeEvent(type,props));}
  setAttribute(key,value){this.attributes.set(key,String(value));if(key==='id')this.id=String(value);}
  getAttribute(key){return this.attributes.has(key)?this.attributes.get(key):null;}
  hasAttribute(key){return this.attributes.has(key);}
  removeAttribute(key){this.attributes.delete(key);}
  get classList(){
    const owner=this;
    return {
      add(...names){const set=new Set(owner.className.split(/\s+/).filter(Boolean));for(const name of names)set.add(name);owner.className=[...set].join(' ');},
      remove(...names){const set=new Set(owner.className.split(/\s+/).filter(Boolean));for(const name of names)set.delete(name);owner.className=[...set].join(' ');},
      toggle(name,force){const on=force===undefined?!owner.classList.contains(name):!!force;on?owner.classList.add(name):owner.classList.remove(name);return on;},
      contains(name){return owner.className.split(/\s+/).includes(name);}
    };
  }
  append(...nodes){for(const node of nodes){node.remove();node.parentElement=this;this.children.push(node);}}
  cloneNode(deep=false){
    const copy=new Node(this.tagName,this.ownerDocument);
    copy.id=this.id;copy.className=this.className;copy.textContent=this.textContent;copy.hidden=this.hidden;copy.disabled=this.disabled;
    copy.attributes=new Map(this.attributes);copy.dataset={...this.dataset};
    if(deep)for(const child of this.children)copy.append(child.cloneNode(true));
    return copy;
  }
  replaceChildren(...nodes){for(const node of this.children)node.parentElement=null;this.children=[];this.append(...nodes);}
  remove(){if(this.parentElement){const parent=this.parentElement;parent.children=parent.children.filter(node=>node!==this);this.parentElement=null;}}
  contains(node){let current=node;while(current){if(current===this)return true;current=current.parentElement;}return false;}
  closest(selector){let current=this.parentElement;while(current){if(current.matches?.(selector))return current;current=current.parentElement;}return null;}
  matches(selector){
    if(String(selector).includes(':popover-open'))throw Error('unsupported selector: '+selector);
    return String(selector).split(',').some(part=>matchesOne(this,part.trim()));
  }
  querySelector(selector){return query(this,selector)[0]||null;}
  querySelectorAll(selector){return query(this,selector);}
  focus(){if(this.ownerDocument)this.ownerDocument.activeElement=this;this.focusLog.push(this);}
  getClientRects(){return this.isConnected&&this._visible&&!this.hidden?[{}]:[];}
  getBoundingClientRect(){return {left:0,top:0,right:0,bottom:0,width:0,height:0};}
  showModal(){if(this.open)throw Error('InvalidStateError');this._returnFocus=this.ownerDocument?.activeElement||null;this.open=true;this.setAttribute('open','');this.ownerDocument.activeElement=this;}
  show(){this.open=true;this.setAttribute('open','');}
  close(){if(!this.open)return;this.open=false;this.removeAttribute('open');if(this._returnFocus&&this._returnFocus.isConnected!==false&&this.ownerDocument)this.ownerDocument.activeElement=this._returnFocus;this.emit('close',{});}
  click(props={}){return this.dispatchEvent(makeEvent('click',{button:0,...props}));}
}
function matchesOne(node,selector){
  const compound=/^([a-zA-Z][\w-]*)?((?:[#.][\w-]+|\[[^\]]+\]|:[\w-]+)*)$/.exec(selector);
  if(!compound)throw Error('fixture cannot match selector: '+selector);
  const [,tag,rest]=compound;
  if(tag&&node.tagName!==tag.toUpperCase())return false;
  for(const token of rest.match(/[#.][\w-]+|\[[^\]]+\]|:[\w-]+/g)||[]){
    if(token.startsWith('#')){if(node.id!==token.slice(1))return false;}
    else if(token.startsWith('.')){if(!node.classList.contains(token.slice(1)))return false;}
    else if(token.startsWith('[')){
      const [,key,value]=/^\[([\w-]+)(?:=([^\]]*))?\]$/.exec(token)||[];
      if(value===undefined){if(!node.hasAttribute(key))return false;}
      else if(node.getAttribute(key)!==value.replace(/^["']|["']$/g,''))return false;
    }else if(token===':disabled'){if(node.disabled!==true)return false;}
    else throw Error('fixture cannot match selector: '+selector);
  }
  return true;
}
function query(root,selector){
  if(String(selector).includes(':popover-open'))throw Error('unsupported selector: '+selector);
  const parts=String(selector).split(',').map(part=>part.trim()),found=[];
  const walk=node=>{for(const child of node.children){if(parts.some(part=>matchesOne(child,part)))found.push(child);walk(child);}};
  walk(root);
  return found;
}
function makeEvent(type,props={}){
  const event=new Event(type,{bubbles:props.bubbles!==false,cancelable:props.cancelable!==false});
  for(const [key,value]of Object.entries(props))if(key!=='bubbles'&&key!=='cancelable')Object.defineProperty(event,key,{value,configurable:true});
  return event;
}
function dispatch(target,event){
  if(!Object.getOwnPropertyDescriptor(event,'target'))Object.defineProperty(event,'target',{value:target,configurable:true});
  for(const fn of [...(target.listeners?.get(event.type)||[])])fn.call(target,event);
  if(event.bubbles&&!event.cancelBubble&&target.parentElement)dispatch(target.parentElement,event);
}
class Doc{
  constructor(){
    this.listeners=new Map();this.activeElement=null;this._byId=new Map();
    this.body=new Node('body',this);this.body.parentElement=this;this.documentElement=this.body;
    const view={};
    view.getComputedStyle=node=>({visibility:node?.style?.visibility||'visible'});
    this.defaultView=view;
  }
  createElement(tag){return new Node(tag,this);}
  getElementById(id){return this._byId.get(id)||query(this.body,'#'+id)[0]||null;}
  querySelector(selector){return query(this.body,selector)[0]||null;}
  querySelectorAll(selector){return query(this.body,selector);}
  addEventListener(type,fn){this.listeners.set(type,[...(this.listeners.get(type)||[]),fn]);}
  removeEventListener(type,fn){this.listeners.set(type,(this.listeners.get(type)||[]).filter(x=>x!==fn));}
  dispatchEvent(event){dispatch(this,event);return !event.defaultPrevented;}
  emit(type,props={}){dispatch(this,makeEvent(type,props));}
  make(tag,id,attrs={}){
    const node=this.createElement(tag);
    node.id=id;this._byId.set(id,node);
    for(const [key,value]of Object.entries(attrs))node.setAttribute(key,value);
    this.body.append(node);
    return node;
  }
}
function menuFixture({user=null,books=[],owner={owner:'guest',revision:0},getOwner=null,extraLinks=[],ui,authoredLang}={}){
  const document=new Doc(),raf=[];if(authoredLang)document.documentElement.lang=authoredLang;
  const header=document.createElement('header');header.className='site-header';document.body.append(header);
  const brand=document.createElement('a');brand.className='brand';brand.setAttribute('href','/');header.append(brand);
  const nav=document.createElement('nav');nav.className='home-navigation';header.append(nav);
  const libraryLink=document.createElement('a');libraryLink.setAttribute('href','/library');libraryLink.textContent='书房';nav.append(libraryLink);
  const paletteEntry=document.createElement('button');paletteEntry.className='home-nav palette-entry';paletteEntry.setAttribute('data-palette-open','');nav.append(paletteEntry);
  const howLink=document.createElement('a');howLink.className='home-nav';howLink.setAttribute('href','#how');howLink.textContent='阅读的方法';nav.append(howLink);
  const ownershipLink=document.createElement('a');ownershipLink.className='home-nav';ownershipLink.setAttribute('href','#ownership');ownershipLink.textContent='自己的书房';nav.append(ownershipLink);
  const languages=document.createElement('span');languages.className='home-languages';
  for(const route of ['/','/zh-hans','/zh-hant','/ja']){const link=document.createElement('a');link.setAttribute('href',route);languages.append(link);}
  nav.append(languages);
  const bodyLinks=extraLinks.map(href=>{const a=document.createElement('a');a.setAttribute('href',href);a.textContent='Literal body link';document.body.append(a);return a;});
  const trigger=document.make('button','home-menu-trigger');
  const dialog=document.make('dialog','home-menu');
  dialog.className='home-menu-sheet';
  dialog.setAttribute('aria-labelledby','home-menu-title');
  const title=document.createElement('h2');title.id='home-menu-title';dialog.append(title);
  const signIn=document.createElement('button');signIn.id='home-menu-signin';dialog.append(signIn);
  const account=document.createElement('a');account.id='home-menu-account';account.setAttribute('href','/library?settings=account');dialog.append(account);
  const resume=document.createElement('a');resume.id='home-menu-resume';resume.hidden=true;dialog.append(resume);
  const resumeTitle=document.createElement('strong');resumeTitle.id='home-menu-resume-title';resume.append(resumeTitle);
  const resumeAuthor=document.createElement('span');resumeAuthor.id='home-menu-resume-author';resume.append(resumeAuthor);
  const search=document.createElement('button');search.id='home-menu-search';dialog.append(search);
  const links=document.createElement('nav');links.id='home-menu-links';dialog.append(links);
  const languageSlot=document.createElement('div');languageSlot.id='home-menu-languages';dialog.append(languageSlot);
  const destination=document.createElement('section');
  destination.className='home-section';destination.id='how';destination.setAttribute('tabindex','0');document.body.append(destination);
  const ownership=document.createElement('section');
  ownership.className='home-section';ownership.id='ownership';document.body.append(ownership);
  const desktop={matches:false,listeners:new Set(),addEventListener(type,fn){if(type==='change')this.listeners.add(fn);},fire(){for(const fn of [...this.listeners])fn({matches:this.matches});}};
  const calls={auth:0,palette:[],books:0,identity:0};
  let session={user},current={...owner};
  const menu=mountHomeNavigation({
    document,ui,
    getSession:()=>{calls.identity++;return session;},
    getBooks:()=>{calls.books++;return books;},
    getOwner:getOwner||(()=>({...current})),
    openAuth:()=>{calls.auth++;},
    openPalette:opener=>{calls.palette.push(opener);},
    matchMedia:query=>query==='(min-width:1101px)'?desktop:null,
    requestAnimationFrame:fn=>{raf.push(fn);},
  });
  mounted.push(menu);
  return {document,bodyLinks,menu,trigger,dialog,nav,links,languageSlot,signIn,account,resume,resumeTitle,resumeAuthor,search,brand,destination,ownership,desktop,raf,calls,
    flushRaf(){while(raf.length)raf.shift()({timeStamp:0});},
    setUser(next){session={user:next};},
    setBooks(next){books=next;},
    setOwner(next){current={...next};},
  };
}
const currentBook=()=>({bookId:'walden',title:{zh:'瓦尔登湖',en:'Walden'},author:'Thoreau',resume:{passageId:'p9',label:'第五页'},journey:{lastReadAt:'2026-10-19T00:00:00Z'}});

test('the menu mounts on the five authored home routes and never on the canonical library',()=>{
  assert.deepEqual(HOME_NAV_ROUTES,['/','/en','/zh-hans','/zh-hant','/ja']);
  for(const route of HOME_NAV_ROUTES)assert.equal(isHomeNavRoute(route),true,route);
  for(const route of ['/library','/read','/mcp','/zh-hans/mcp','/en/','/JA'])assert.equal(isHomeNavRoute(route),false,route);
  assert.deepEqual([...HOME_MENU_CLOSE_REASONS].sort(),['auth-handoff','breakpoint','navigation','palette-handoff','user']);
});

test('the authored home markup ships one trigger and one native sheet with the exact ids the controller needs',async()=>{
  const source=await readFile(new URL('../app/home.html',import.meta.url),'utf8');
  for(const id of ['home-menu','home-menu-trigger','home-menu-links','home-menu-languages'])
    assert.match(source,new RegExp('id="'+id+'"'),'home.html must keep the production id '+id);
  assert.match(source,/id="home-menu-trigger"[^>]*aria-haspopup="dialog"/);
  assert.match(source,/id="home-menu-trigger"[^>]*aria-controls="home-menu"/);
  const header=source.match(/<header class="site-header"[\s\S]*?<\/header>/)[0];
  const nav=header.match(/<nav class="home-navigation"[\s\S]*?<\/nav>/)[0];
  assert.doesNotMatch(nav,/data-palette-open|home-languages|href="\/library"/,'public navigation keeps one account entry and no search or language list');
  assert.equal((header.match(/id="account-button"/g)||[]).length,1);
  assert.doesNotMatch(source,/id="home-menu-(?:signin|account|search|resume)"/,'the menu does not duplicate account, search or reading controls');
  assert.equal((source.match(/id="home-menu"/g)||[]).length,1,'exactly one menu sheet');
});

test('the sheet opens and closes like a native dialog and Escape returns the visible opener',()=>{
  const f=menuFixture();
  assert.equal(f.dialog.open,false);
  f.trigger.focus();f.trigger.click();
  assert.equal(f.dialog.open,true,'the trigger opens the native modal sheet');
  assert.equal(f.trigger.getAttribute('aria-expanded'),'true');
  assert.equal(f.menu.lastCloseReason(),null);
  f.dialog.close();
  assert.equal(f.dialog.open,false);
  assert.equal(f.document.activeElement,f.trigger,'closing returns the connected visible opener');
  assert.equal(f.menu.lastCloseReason(),'user');
  assert.equal(f.trigger.getAttribute('aria-expanded'),'false');
  f.trigger.click();
  f.dialog.emit('cancel',{});f.dialog.close();
  assert.equal(f.document.activeElement,f.trigger,'Escape is a user close');
  assert.equal(f.menu.lastCloseReason(),'user');
});

test('opening refuses another open modal and the open appearance popover',()=>{
  const f=menuFixture();
  const other=f.document.make('dialog','auth-dialog');other.showModal();
  f.trigger.click();
  assert.equal(f.dialog.open,false,'a second modal is refused');
  other.close();
  const appearance=f.document.make('div','appearance-menu');appearance.id='site-appearance-menu';
  f.trigger.click();
  assert.equal(f.dialog.open,false,'the open appearance popover is refused');
  appearance.hidden=true;
  f.trigger.click();
  assert.equal(f.dialog.open,true,'nothing open means the sheet may open');
});

test('the sheet reuses the real navigation anchors and localized language links',()=>{
  const f=menuFixture();
  const cloned=[...f.links.querySelectorAll('a')];
  assert.deepEqual(cloned.map(a=>a.getAttribute('href')),["/library","#how","#ownership"],'all three destinations stay real anchors');
  assert.equal(cloned.some(a=>a.hasAttribute('data-palette-open')),false,'the unwired cloned palette launcher is never copied');
  const languages=[...f.languageSlot.querySelectorAll('a')];
  assert.deepEqual(languages.map(a=>a.getAttribute('href')),['/','/zh-hans','/zh-hant','/ja'],'language links reuse the actual localized hrefs');
});

test('a normal destination anchor keeps default scrolling and focuses the real target in one guarded RAF',()=>{
  const f=menuFixture();
  f.trigger.focus();f.trigger.click();
  const anchor=[...f.links.querySelectorAll('a')].find(a=>a.getAttribute('href')==='#how');
  const handled=anchor.click();
  assert.equal(handled,true,'the anchor click is never prevented: default scrolling stays native');
  assert.equal(f.dialog.open,false,'the sheet closes before the destination focus');
  assert.equal(f.menu.lastCloseReason(),'navigation');
  assert.deepEqual(f.destination.focusLog,[],'the destination focus waits for the guarded frame');
  f.flushRaf();
  assert.deepEqual(f.destination.focusLog,[f.destination],'exactly one RAF focuses the real destination');
  assert.equal(f.document.activeElement,f.destination);
  assert.equal(f.destination.getAttribute('tabindex'),'0','an existing tabindex is preserved exactly');
});

test('the guarded destination focus adds the focus affordance only when the target has none',()=>{
  const f=menuFixture();
  f.trigger.click();
  const anchor=[...f.links.querySelectorAll('a')].find(a=>a.getAttribute('href')==='#ownership');
  anchor.click();f.flushRaf();
  assert.equal(f.document.activeElement,f.ownership);
  assert.equal(f.ownership.getAttribute('tabindex'),'-1','a target without a tabindex gets the standard -1 affordance');
});

test('a newer modal or a superseded destination request never steals the destination focus',()=>{
  const f=menuFixture();
  f.trigger.click();
  const anchor=[...f.links.querySelectorAll('a')].find(a=>a.getAttribute('href')==='#how');
  anchor.click();
  const other=f.document.make('dialog','auth-dialog');other.showModal();
  f.flushRaf();
  assert.deepEqual(f.destination.focusLog,[],'a newer modal wins over the pending destination focus');
  other.close();
  const second=menuFixture();
  second.trigger.focus();second.trigger.click();
  const secondAnchor=[...second.links.querySelectorAll('a')].find(a=>a.getAttribute('href')==='#how');
  secondAnchor.click();
  second.trigger.click();
  second.flushRaf();
  assert.deepEqual(second.destination.focusLog,[],'a superseded navigation request may not steal focus later');
});

test('modified clicks keep native anchor behaviour and leave the sheet alone',()=>{
  const f=menuFixture();
  f.trigger.focus();f.trigger.click();
  const anchor=[...f.links.querySelectorAll('a')].find(a=>a.getAttribute('href')==='#how');
  for(const props of [{ctrlKey:true},{metaKey:true},{shiftKey:true},{altKey:true},{button:1},{button:2}]){
    const event=makeEvent('click',{button:0,...props});anchor.dispatchEvent(event);
    assert.equal(event.defaultPrevented,false,JSON.stringify(props)+' keeps the native click');
    assert.equal(f.dialog.open,true,'a modified click does not close the sheet');
    assert.deepEqual(f.destination.focusLog,[],'a modified click never schedules a destination focus');
  }
});

test('non-fragment destinations close without any later focus steal',()=>{
  const f=menuFixture();
  f.trigger.focus();f.trigger.click();
  const library=[...f.links.querySelectorAll('a')].find(a=>a.getAttribute('href')==='/library');
  library.click();
  assert.equal(f.dialog.open,false);
  assert.equal(f.menu.lastCloseReason(),'navigation');
  assert.equal(f.document.activeElement,f.trigger,'a real navigation closes without stealing focus');
  f.flushRaf();
  assert.equal(f.document.activeElement,f.trigger,'and no later frame steals it either');
});

test('the sign-in handoff closes the sheet, focuses the visible trigger and opens auth immediately',()=>{
  const f=menuFixture({user:null});
  f.trigger.focus();f.trigger.click();
  const order=[];
  f.signIn.focus();
  f.trigger.focus=()=>{order.push('focus');f.document.activeElement=f.trigger;};
  f.signIn.click();
  assert.equal(f.dialog.open,false,'the sheet closes first');
  assert.deepEqual(order,['focus'],'focus lands on the visible menu trigger before the handoff');
  assert.equal(f.calls.auth,1,'the existing auth dialog opens immediately, without timers');
  assert.equal(f.menu.lastCloseReason(),'auth-handoff');
  assert.equal(f.document.activeElement,f.trigger);
});

test('the palette entry closes the sheet, focuses the visible trigger and hands that same opener over',()=>{
  const f=menuFixture();
  f.trigger.focus();f.trigger.click();
  f.search.click();
  assert.equal(f.dialog.open,false);
  assert.equal(f.menu.lastCloseReason(),'palette-handoff');
  assert.deepEqual(f.calls.palette,[f.trigger],'the handoff passes the actual visible menu trigger');
  assert.equal(f.document.activeElement,f.trigger);
  f.flushRaf();
  assert.equal(f.document.activeElement,f.trigger,'no later frame overrides the handoff focus decision');
});

test('crossing the desktop breakpoint closes the sheet and returns the visible brand',()=>{
  const f=menuFixture();
  f.trigger.focus();f.trigger.click();
  f.desktop.matches=true;f.desktop.fire();
  assert.equal(f.dialog.open,false,'the media transition never leaves focus in hidden content');
  assert.equal(f.menu.lastCloseReason(),'breakpoint');
  assert.deepEqual(f.brand.focusLog,[f.brand],'the visible brand is the desktop fallback');
  const second=menuFixture();
  second.trigger.click();
  second.brand.hidden=true;
  second.desktop.matches=true;second.desktop.fire();
  assert.equal(second.dialog.open,false);
  assert.notEqual(second.document.activeElement,second.brand,'a hidden brand is never focused blindly');
});

test('owner clear and same-owner retry remove stale resume rows and stale updates are rejected',()=>{
  const f=menuFixture({owner:{owner:'reader',revision:3}});
  f.setBooks([currentBook()]);
  assert.equal(f.menu.update({owner:'reader',revision:3}),true);
  assert.equal(f.resume.hidden,false);
  assert.equal(f.resume.getAttribute('href'),"/read?book=walden",'the resume link is the book-only protocol');
  assert.equal(f.resumeTitle.textContent,'瓦尔登湖','the dynamic title is exact textContent, never translated');
  assert.equal(f.resumeAuthor.textContent,'Thoreau');
  assert.equal(f.menu.update({owner:'reader',revision:2}),false,'a stale captured revision is rejected');
  f.menu.clear({owner:'reader',revision:3});
  assert.equal(f.resume.hidden,true,'clear removes the stale optional resume row');
  assert.equal(f.resume.getAttribute('href'),null);
  assert.equal(f.resumeTitle.textContent,'');
  assert.equal(f.resumeAuthor.textContent,'');
  f.setBooks([currentBook()]);
  f.menu.update({owner:'reader',revision:3});
  assert.equal(f.resume.hidden,false,'a same-owner retry renders the fresh row');
  f.menu.clear({owner:'reader',revision:3});
  f.setBooks([currentBook()]);
  f.menu.update({owner:'reader',revision:3});
  assert.equal(f.resume.getAttribute('href'),"/read?book=walden");
});

test('resume eligibility comes only from real current progress; guests without progress see no continue row',()=>{
  const f=menuFixture({user:null,books:[{bookId:'gutenberg-alice',title:{zh:'爱丽丝梦游仙境',en:'Alice'},author:'Carroll'}]});
  f.menu.update({owner:'guest',revision:0});
  assert.equal(f.resume.hidden,true,'a sample book without progress is never a fictitious continue');
  assert.equal(f.resume.getAttribute('href'),null);
  f.setUser({id:'reader'});f.setOwner({owner:'reader',revision:1});
  f.setBooks([{bookId:'gutenberg-alice',title:{zh:'爱丽丝梦游仙境',en:'Alice'},journey:{status:'finished',lastReadAt:'2026-10-18'}}]);
  f.menu.update({owner:'reader',revision:1});
  assert.equal(f.resume.hidden,true,'a finished journey is not current progress');
  f.setOwner({owner:'reader',revision:2});
  f.setBooks([{bookId:'mine',title:{zh:'我的书'},author:'我',journey:{lastReadAt:'2026-10-19T00:00:00Z'}}]);
  f.menu.update({owner:'reader',revision:2});
  assert.equal(f.resume.hidden,false,'real current authorized progress gets the optional row');
  assert.equal(f.resume.getAttribute('href'),"/read?book=mine",'readingBookUrl(book,null) only: the reader restores the full resume');
});

test('the home account row opens the reading room without an extra account dialog',()=>{
  const f=menuFixture({user:null});
  f.menu.update({owner:'guest',revision:0});
  assert.equal(f.signIn.hidden,false);
  assert.equal(f.account.hidden,true);
  f.setUser({id:'reader'});f.setOwner({owner:'reader',revision:1});
  f.menu.update({owner:'reader',revision:1});
  assert.equal(f.signIn.hidden,true);
  assert.equal(f.account.hidden,false);
  assert.equal(f.account.getAttribute('href'),"/library");
});

test('dispose detaches the sheet from the shared focus registry and the page listeners',()=>{
  const f=menuFixture();
  f.trigger.click();
  assert.equal(f.dialog.open,true);
  f.menu.dispose();
  f.dialog.close();
  f.trigger.click();
  assert.equal(f.dialog.open,false,'a disposed controller no longer opens the sheet');
});

// ---- GET-188 review batch: actual production refresh wiring regressions ----
import {createOwnerScope} from '../app/owner-scope.mjs';
const portalSource=await readFile(new URL('../app/portal.js',import.meta.url),'utf8');
const portalAst=parse(portalSource,{ecmaVersion:'latest',sourceType:'module'});
const refreshLabelDeclarations=['chromeLabels','specText','applySpec','own'].map(name=>{const node=portalAst.body.find(n=>n.declarations?.some(d=>d.id.name===name));assert.ok(node);return portalSource.slice(node.start,node.end);}).join('\n');
const refreshBody=portalSource.slice(portalSource.indexOf('async function refresh(knownSession)'),portalSource.indexOf('async function signOut('));
// The integration fixture executes the actual portal refresh function body
// against the actual home-navigation controller; only DOM, api and incidental
// services are deterministic synthetic fixtures.
function productionRefresh({api,homeMenu,ownerScope,document:doc,observations={},session={user:{id:'reader'}}}={}){
  const nodes=new Map();
  const $=id=>{if(!nodes.has(id))nodes.set(id,doc.createElement('div'));return nodes.get(id);};
  return new Function('api','homeMenu','ownerScope','$','doc','observations','t','getUiLocale',`
    let refreshGeneration=0,session=${JSON.stringify(session)},books=[],shelfRevision=0,pendingUpload=false,pendingChat=false,bootstrapped=false,identityResolved=false;
    const adoptUiOwner=id=>{(observations.uiOwners??=[]).push(id);return Promise.resolve({adopted:true});};
    const deviceBookStore=()=>({adopt:async()=>{}}),prepareOfflineResources=async()=>false;
    const ensureReadingWorkspace=async()=>null;
    const document=doc,isLibrary=false,dashboard=null,shell=null,setupInvite=null,shelfControls=null,authDialog={updateCapabilities(){},isSettingPasswordFor(){return false;}},pdfOnboarding={refresh(){}},homeText=x=>x,homeLocale=()=>'en',status=()=>{},renderBooks=()=>{},landingBookCard=()=>doc.createElement('article');
    function clearPrivateUI(options){(observations.resetOptions??=[]).push(options);observations.clearCalls=(observations.clearCalls||0)+1;homeMenu.clear(ownerScope.capture());}
    ${refreshLabelDeclarations}
    ${refreshBody}
    return refresh;`)(api,homeMenu,ownerScope,$,doc,observations,t,getUiLocale);
}

test('the actual refresh wiring clears the optional resume at every generation start through pending and failure',async()=>{
  const scope=createOwnerScope('reader');
  const f=menuFixture({user:{id:'reader'},getOwner:()=>scope.capture()});
  const books=[{bookId:'private-synthetic',title:{zh:'Synthetic title'},author:'Synthetic author',visibility:'private',journey:{lastReadAt:'2026-10-19T00:00:00Z'}}];
  f.setBooks(books);
  let calls=0,rejectSecond;
  const api=async()=>{if(++calls===1)return {books};return new Promise((resolve,reject)=>{rejectSecond=reject;});};
  const refresh=productionRefresh({api,homeMenu:f.menu,ownerScope:scope,document:f.document});
  await refresh({user:{id:'reader'}});
  assert.equal(f.resume.hidden,false,'the first successful refresh renders the real resume row');
  assert.equal(f.resume.getAttribute('href'),"/read?book=private-synthetic");
  assert.equal(f.resumeTitle.textContent,'Synthetic title');
  const retry=refresh({user:{id:'reader'}});
  assert.equal(f.resume.hidden,true,'the same-owner refresh generation clears the stale row synchronously at its start');
  assert.equal(f.resume.getAttribute('href'),null);
  assert.equal(f.resumeTitle.textContent,'');
  await Promise.resolve();
  assert.equal(f.resume.hidden,true,'the stale row stays gone while the library request is pending');
  rejectSecond(Error('synthetic library refresh failed'));
  await retry.catch(()=>{});
  assert.equal(f.resume.hidden,true,'a failed same-owner refresh keeps the optional row cleared');
  assert.equal(f.resume.getAttribute('href'),null,'no stale href survives the failure');
  assert.equal(f.resumeTitle.textContent,'','no stale title survives the failure');
});

test('the actual refresh wiring syncs identity rows when the session settles even if the library request fails',async()=>{
  const scope=createOwnerScope('reader');
  const f=menuFixture({user:{id:'reader'},getOwner:()=>scope.capture()});
  f.signIn.hidden=false;f.account.hidden=true;
  const api=async()=>{throw Error('synthetic library unavailable');};
  const refresh=productionRefresh({api,homeMenu:f.menu,ownerScope:scope,document:f.document});
  await refresh({user:{id:'reader'}}).catch(()=>{});
  assert.equal(f.signIn.hidden,true,'signed-in identity rows sync without waiting for optional book data');
  assert.equal(f.account.hidden,false);
  assert.equal(f.account.getAttribute('href'),"/library");
  assert.equal(f.resume.hidden,true,'resume stays cleared without current valid books');
});

test('owner transitions keep identity and resume rows in step with the adopted session',async()=>{
  const scope=createOwnerScope('guest'),observations={clearCalls:0};
  const f=menuFixture({user:null,getOwner:()=>scope.capture()});
  const books=[{bookId:'private-synthetic',title:{zh:'Synthetic title'},author:'Synthetic author',visibility:'private',journey:{lastReadAt:'2026-10-19T00:00:00Z'}}];
  let mode='guest';
  const api=async url=>url==='/api/auth/session'?{user:mode==='guest'?null:{id:'reader'}}:{books:mode==='guest'?[]:books};
  const refresh=productionRefresh({api,homeMenu:f.menu,ownerScope:scope,document:f.document,observations,session:null});
  await refresh();
  assert.equal(f.signIn.hidden,false,'a guest session settles on the sign-in row');
  assert.equal(f.account.hidden,true);
  mode='reader';f.setUser({id:'reader'});f.setBooks(books);
  await refresh();
  assert.equal(observations.clearCalls,1,'the owner transition clears through the real owner boundary');
  assert.equal(f.signIn.hidden,true);
  assert.equal(f.account.hidden,false);
  assert.equal(f.resume.hidden,false,'current authorized progress renders after the transition');
  mode='guest';f.setUser(null);f.setBooks([]);
  await refresh();
  assert.equal(observations.clearCalls,2);
  assert.deepEqual(observations.uiOwners,[null,'reader',null],'the locale bridge receives only the independently settled session owner');
  assert.equal(f.signIn.hidden,false,'signing out returns the sign-in row');
  assert.equal(f.account.hidden,true);
  assert.equal(f.resume.hidden,true);
  assert.equal(f.resume.getAttribute('href'),null);
  assert.equal(f.menu.updateIdentity({owner:'reader',revision:99}),false,'a stale captured revision can never repaint identity rows');
  assert.equal(f.signIn.hidden,false);
});

test('a failed first library request cannot preserve one account view when the next account arrives',async()=>{
  const scope=createOwnerScope('guest'),observations={},f=menuFixture({user:null,getOwner:()=>scope.capture()});
  const refresh=productionRefresh({api:async()=>{throw Error('synthetic library unavailable');},homeMenu:f.menu,ownerScope:scope,document:f.document,observations,session:null});
  await refresh({user:{id:'reader-a'}}).catch(()=>{});
  await refresh({user:{id:'reader-b'}}).catch(()=>{});
  assert.equal(observations.resetOptions[0].preserveView,true,'the first identity can preserve the entry URL');
  assert.equal(observations.resetOptions[1].preserveView,false,'a real owner change clears the previous view even before the first successful library load');
});

test('portal wires the owner settlement token beside the real user id getter',()=>{
  assert.match(portalSource,/getOwnerToken:/,'the bootstrap fence needs the monotonic settlement token on the adapter');
  assert.match(portalSource,/getOwner:\(\)=>session\?\.user\?\.id\|\|null/,'the palette library keeps the real user id getter');
});

test('home locale labels and existing owned links change without querying identity or books or replacing the active sheet',async()=>{
  const f=menuFixture({user:{id:'a'},books:[currentBook()]});f.menu.update({owner:'guest',revision:0});f.trigger.click();f.search.focus();
  const children=[...f.dialog.children],booksBefore=f.calls.books,identityBefore=f.calls.identity,title=f.resumeTitle.textContent,author=f.resumeAuthor.textContent;
  await requestUiRoute('ja');
  assert.equal(f.dialog.open,true);assert.equal(f.document.activeElement,f.search);assert.deepEqual(f.dialog.children,children);assert.equal(f.calls.books,booksBefore);assert.equal(f.calls.identity,identityBefore);assert.equal(f.resumeTitle.textContent,title);assert.equal(f.resumeAuthor.textContent,author);
  assert.equal(f.account.getAttribute('href'),"/library");assert.equal(f.resume.getAttribute('href'),"/read?book=walden");assert.equal(f.links.querySelector('a').getAttribute('href'),"/library");assert.equal(f.dialog.getAttribute('lang'),'ja');
  f.menu.clear();await requestUiRoute('zh-Hant');assert.equal(f.resume.hidden,true);assert.equal(f.resume.getAttribute('href'),null);assert.equal(f.calls.books,booksBefore);
  f.menu.dispose();await requestUiRoute('en');assert.equal(f.account.getAttribute('href'),"/library");
});


test('owned hero, sample and footer links retain locale without rebuilding body content or rewriting unowned targets',async()=>{
  const targets=['/library','/library?settings=about','/read?book=literal%2Fid&passage=p1#source','/read#sample','#how','/privacy','https://example.test/read?book=literal','/api/books/export?signature=literal','/library-extra'];
  const f=menuFixture({extraLinks:targets});
  const nodes=[...f.bodyLinks],calls={...f.calls};
  for(const code of ['en','ja','zh-Hant','zh-Hans']){
    await requestUiRoute(code);
    for(let i=0;i<targets.length;i++){
      const expected=targets[i];
      assert.equal(f.bodyLinks[i].getAttribute('href'),expected);
      assert.equal(f.bodyLinks[i],nodes[i]);assert.equal(nodes[i].textContent,'Literal body link');
    }
    assert.deepEqual(f.calls,calls,'language commits do not read identity/books or open other features');
  }
});

for(const code of ['ja','zh-Hans','zh-Hant'])for(const outcome of ['success','failure'])test(`authored ${code} links survive the initial pending catalogue, then follow ${outcome} settlement and retry`,async()=>{
 let resolve,reject;const pending=new Promise((a,b)=>{resolve=a;reject=b;});let retry=false;
 const catalogue=catalogues[code];
 const runtime=createUiLocale({getLocation:()=>({href:'https://leafhour.com/'+({ja:'ja','zh-Hans':'zh-hans','zh-Hant':'zh-hant'}[code])}),loadCatalogue:()=>retry?Promise.resolve(catalogue):pending});
 const initial=runtime.initializeOnce(),targets=['/library?ui='+code,'/read?book=literal%2Fid&ui='+code+'#source','https://example.test/read?ui=literal','/api/export?signature=literal'];
 const f=menuFixture({user:{id:'a'},books:[currentBook()],authoredLang:code,extraLinks:targets,ui:runtime});f.menu.update({owner:'guest',revision:0});
 const context={uiHref:runtime.uiHref,ownedLinks:new Set()};vm.createContext(context);const owned=portalAst.body.find(n=>n.type==='FunctionDeclaration'&&n.id.name==='ownedHref');vm.runInContext(portalSource.slice(owned.start,owned.end)+';this.link=ownedHref;',context);const generated=f.document.createElement('a');context.link(generated,'/read?book=literal%2Fid');assert.equal(generated.href,"/read?book=literal%2Fid");
 const auth=portalAst.body.find(n=>n.declarations?.some(d=>d.id.name==='authDialog')).declarations[0].init.arguments[0].properties.find(p=>p.key.name==='getReturnTo').value;const login=vm.runInNewContext('('+portalSource.slice(auth.start,auth.end)+')',{authReturnTarget,pendingUpload:false,pendingNotebook:false,returnToReader:null,returnToLibrary:null,currentLibraryReturn:()=>'/library',getUiNavigationLocale:runtime.getUiNavigationLocale,uiHref:runtime.uiHref});assert.equal(login(),"/library");
 assert.equal(runtime.getUiLocaleState().phase,'pending');assert.equal(runtime.getUiLocale(),'en');
 assert.equal(f.bodyLinks[0].getAttribute('href'),'/library');assert.equal(f.bodyLinks[1].getAttribute('href'),'/read?book=literal%2Fid#source');
 assert.equal(f.account.getAttribute('href'),"/library");assert.equal(f.resume.getAttribute('href'),"/read?book=walden");assert.equal(f.links.querySelector('a').getAttribute('href'),"/library");
 const calls={...f.calls},nodes=[...f.bodyLinks];f.trigger.click();f.search.focus();
 if(outcome==='failure')reject(Error('synthetic catalogue failure'));else resolve(catalogue);
 await initial;await runtime.uiReady;await Promise.resolve();
 const effective=outcome==='success'?code:'en';context.link(generated,'/read?book=literal%2Fid');assert.equal(generated.href,"/read?book=literal%2Fid");assert.equal(login(),"/library");assert.equal(runtime.getUiLocale(),effective);assert.equal(f.bodyLinks[0].getAttribute('href'),"/library");assert.equal(f.account.getAttribute('href'),"/library");
 assert.equal(f.resume.getAttribute('href'),"/read?book=walden");assert.equal(f.links.querySelector('a').getAttribute('href'),"/library");
 if(outcome==='failure'){retry=true;await runtime.retryUiLocale();assert.equal(f.bodyLinks[0].getAttribute('href'),'/library');assert.equal(f.resume.getAttribute('href'),"/read?book=walden");}
 assert.equal(f.bodyLinks[2].getAttribute('href'),targets[2]);assert.equal(f.bodyLinks[3].getAttribute('href'),targets[3]);assert.deepEqual(f.bodyLinks,nodes);assert.equal(f.document.activeElement,f.search);assert.equal(f.dialog.open,true);assert.deepEqual(f.calls,calls);
});

test('disposing an authored home during first load fences late successful settlement',async()=>{
 let resolve;const pending=new Promise(r=>resolve=r),catalogue=jaCatalogue;
 const runtime=createUiLocale({getLocation:()=>({href:'https://leafhour.com/ja'}),loadCatalogue:()=>pending});const initial=runtime.initializeOnce();
 const f=menuFixture({authoredLang:'ja',extraLinks:['/library?ui=ja'],ui:runtime});const href=f.bodyLinks[0].getAttribute('href'),label=f.trigger.getAttribute('aria-label');f.menu.dispose();resolve(catalogue);await initial;await runtime.uiReady;await Promise.resolve();assert.equal(f.bodyLinks[0].getAttribute('href'),href);assert.equal(f.trigger.getAttribute('aria-label'),label);
});
