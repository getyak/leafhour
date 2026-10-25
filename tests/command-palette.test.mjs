import test from 'node:test';
import assert from 'node:assert/strict';
import {openCommandPalette,paletteCommands,PALETTE_TEXT} from '../app/command-palette.mjs';
import {mountPaletteBootstrap,paletteKeycapHintAvailable,paletteShortcutAllowed,palettePageFor,paletteHasHost,PALETTE_KEYCAP,PALETTE_POINTER_QUERIES} from '../app/palette-bootstrap.mjs';

class Element extends EventTarget {
  constructor(tag,doc){super();this.tagName=String(tag).toUpperCase();this.doc=doc;this.children=[];this.attrs={};this.dataset={};this.style={};this.className='';this.textContent='';this.value='';this.hidden=false;this.open=false;this.disabled=false;this.classList={add:c=>{if(!this.className.split(' ').includes(c))this.className+=(this.className?' ':'')+c;},remove:c=>{this.className=this.className.split(' ').filter(x=>x&&x!==c).join(' ');},toggle:(c,on)=>{on?this.classList.add(c):this.classList.remove(c);},contains:c=>this.className.split(' ').includes(c)};}
  append(...nodes){for(const n of nodes){n.remove();n.parentElement=this;this.children.push(n);}}
  appendChild(n){this.append(n);return n;}
  insertBefore(n,before){n.remove();const i=before?this.children.indexOf(before):this.children.length;this.children.splice(i,0,n);n.parentElement=this;}
  remove(){if(this.parentElement){const p=this.parentElement;p.children=p.children.filter(n=>n!==this);this.parentElement=null;}}
  replaceChildren(...nodes){this.children=[];this.append(...nodes);}
  setAttribute(k,v){this.attrs[k]=String(v);}getAttribute(k){return this.attrs[k];}hasAttribute(k){return k in this.attrs;}removeAttribute(k){delete this.attrs[k];}
  addEventListener(name,fn,options){if(!this.listeners)this.listeners=new Map();if(!this.listeners.has(name))this.listeners.set(name,0);this.listeners.set(name,this.listeners.get(name)+1);super.addEventListener(name,fn,options);}
  contains(n){return n===this||this.children.some(c=>c.contains(n));}
  closest(selector){let node=this.parentElement;while(node){if(node.matches?.(selector))return node;node=node.parentElement;}return null;}
  matches(selector){if(String(selector).includes(':popover-open'))throw Error('unsupported selector: '+selector);return false;}
  focus(){this.doc.activeElement=this;}
  showModal(){this.open=true;this.doc.activeElement=this;}
  show(){this.open=true;}
  close(){this.open=false;this.dispatchEvent(new Event('close'));}
  click(){this.dispatchEvent(new Event('click',{cancelable:true}));}
  querySelector(selector){if(String(selector).includes(':popover-open'))throw Error('unsupported selector: '+selector);return this.children.map(c=>c.querySelector?.(selector)).find(Boolean)||null;}
  querySelectorAll(selector){if(String(selector).includes(':popover-open'))throw Error('unsupported selector: '+selector);return this.children.flatMap(c=>[...(c.querySelectorAll?.(selector)||[]),...(c.matches?.(selector)?[c]:[])]);}
}
function fixture(){
  const doc=new EventTarget();doc.createElement=tag=>new Element(tag,doc);doc.body=doc.createElement('body');doc.activeElement=doc.body;
  const all=n=>[n,...n.children.flatMap(all)];doc.getElementById=id=>all(doc.body).find(n=>n.id===id)||null;
  doc.querySelectorAll=selector=>all(doc.body).filter(n=>selector==='.command-palette'?n.className.split(' ').includes('command-palette'):selector==='[data-palette-keycap]'?n.dataset.paletteKeycap!==undefined:selector==='[data-palette-open]'?n.dataset.paletteOpen!==undefined:selector==='[role=option]'?n.getAttribute('role')==='option':selector==='[role="status"]'?n.getAttribute('role')==='status':selector==='[data-palette-open],[data-palette-keycap]'?(n.dataset.paletteOpen!==undefined||n.dataset.paletteKeycap!==undefined):false);
  // Minimal truthful compound/descendant matching so production selectors like
  // overlayOpen's safe marker query and the brand fallback resolve real nodes.
  const matchToken=(node,token)=>{
    if(String(token).includes(':popover-open'))throw Error('unsupported selector: '+token);
    const parsed=/^([a-zA-Z][\w-]*)?((?:[#.][\w-]+|\[[^\]]+\])*)$/.exec(token);
    if(!parsed)return false;
    const [,tag,rest]=parsed;
    if(tag&&node.tagName!==tag.toUpperCase())return false;
    for(const piece of rest.match(/[#.][\w-]+|\[[^\]]+\]/g)||[]){
      if(piece.startsWith('#')){if(node.id!==piece.slice(1))return false;}
      else if(piece.startsWith('.')){if(!node.className.split(/\s+/).includes(piece.slice(1)))return false;}
      else{
        const [,key,value]=/^\[([\w-]+)(?:=([^\]]*))?\]$/.exec(piece)||[];
        if(key==='open'&&value===undefined){if(!(node.open===true||node.hasAttribute('open')))return false;continue;}
        if(value===undefined){if(!node.hasAttribute(key))return false;}
        else if(node.getAttribute(key)!==value.replace(/^["']|["']$/g,''))return false;
      }
    }
    return true;
  };
  doc.querySelector=selector=>{
    if(String(selector).includes(':popover-open'))throw Error('unsupported selector: '+selector);
    for(const part of String(selector).split(',')){
      const chain=part.trim().split(/\s+/);
      for(const node of all(doc.body)){
        if(!matchToken(node,chain[chain.length-1]))continue;
        let ancestor=node.parentElement,matched=true;
        for(let index=chain.length-2;index>=0;index--){
          let found=false;
          while(ancestor){if(matchToken(ancestor,chain[index])){found=true;ancestor=ancestor.parentElement;break;}ancestor=ancestor.parentElement;}
          if(!found){matched=false;break;}
        }
        if(matched)return node;
      }
    }
    return null;
  };
  return doc;
}
const key=(target,init={})=>{const event=new Event('keydown',{cancelable:true,bubbles:true});Object.assign(event,{key:'k',isComposing:false,keyCode:0,...init});Object.defineProperty(event,'target',{value:target});return event;};

function openFixture({page='home',adapter=null,library,nav=[]}={}){
  const doc=fixture();
  const opener=doc.createElement('button');doc.body.append(opener);opener.focus();
  const palette=openCommandPalette({document:doc,page,adapter,navigate:url=>nav.push(url),library});
  return {doc,opener,nav,palette,dialog:palette.dialog,input:()=>doc.getElementById('command-palette-input'),status:()=>doc.getElementById('command-palette-status'),options:()=>doc.querySelectorAll('[role=option]'),all:n=>[n,...n.children.flatMap(all)]};
}

test('palette keyboard keeps one active result coherent across arrows, Home/End and Enter',()=>{
  const library={view:()=>({phase:'ready',count:2}),load:async()=>{},search:()=>[{bookId:'one',title:{zh:'一本书',en:'A book'},author:'作者',resume:{passageId:'p7'}},{bookId:'two',title:{zh:'二',en:'B'},author:'乙'}]};
  const f=openFixture({library});
  f.palette.open();
  const input=f.input();
  const type=text=>{input.value=text;input.dispatchEvent(new Event('input'));};
  type('一');
  const options=f.options();
  assert.equal(options.length,2);
  assert.equal(input.getAttribute('aria-activedescendant'),options[0].id,'the first result starts active');
  assert.match(f.status().textContent,/2/,'the palette announces the result count');
  const down=key(input,{key:'ArrowDown'});input.dispatchEvent(down);
  assert.equal(input.getAttribute('aria-activedescendant'),options[1].id);assert.equal(down.defaultPrevented,true);
  input.dispatchEvent(key(input,{key:'ArrowDown'}));
  assert.equal(input.getAttribute('aria-activedescendant'),options[0].id,'arrow movement wraps');
  input.dispatchEvent(key(input,{key:'End'}));
  assert.equal(input.getAttribute('aria-activedescendant'),options[1].id);
  input.dispatchEvent(key(input,{key:'Home'}));
  assert.equal(input.getAttribute('aria-activedescendant'),options[0].id);
  const enter=key(input,{key:'Enter'});input.dispatchEvent(enter);
  assert.equal(enter.defaultPrevented,true);
  assert.deepEqual(f.nav,['/read?book=one&passage=p7'],'Enter runs the active result with its real resume id');
});

test('the dialog announces loading, empty and error states and Escape restores the opener',()=>{
  for(const [phase,expected] of [['loading',/Loading/],['ready',/No matching/],['error',/could not|unavailable|failed/]]){
    const library={view:()=>({phase,count:0}),load:async()=>{},search:()=>[]};
    const f=openFixture({library});f.palette.open();
    f.input().value='nothing';f.input().dispatchEvent(new Event('input'));
    assert.match(f.status().textContent,expected,phase);
    f.dialog.dispatchEvent(new Event('cancel'));
    assert.equal(f.doc.activeElement,f.opener,'Escape restores only the actual opener');
    assert.equal(f.dialog.open,false);
  }
});

test('modal handoff closes the palette without stale focus restoration',()=>{
  const library={view:()=>({phase:'ready',count:0}),load:async()=>{},search:()=>[]};
  const f=openFixture({library});f.palette.open();
  f.input().value='settings';f.input().dispatchEvent(new Event('input'));
  const options=f.options();
  assert.ok(options.length>0);
  const settings=options.find(option=>option.textContent.includes('Open settings'));
  settings.dispatchEvent(new Event('click',{bubbles:true}));
  assert.equal(f.dialog.open,false);
  assert.notEqual(f.doc.activeElement,f.opener,'a settings handoff must not restore stale focus');
  assert.equal(f.nav[0],'/library?settings=appearance','the destination uses the exact GET-179 codec output');
});

test('reader appearance commands use the existing appearance adapter and preserve the launch point',()=>{
  const calls=[];const adapter={appearance:{setTheme:value=>calls.push(['theme',value]),adjustFont:delta=>calls.push(['font',delta])}};
  const library={view:()=>({phase:'ready',count:0}),load:async()=>{},search:()=>[]};
  const f=openFixture({page:'reader',adapter,library});f.palette.open();
  f.input().value='night';f.input().dispatchEvent(new Event('input'));
  const night=f.options().find(option=>option.textContent.includes('Night'));
  assert.equal(f.status().textContent,'Night · 1 results','a matching command must not also announce no matches');
  night.dispatchEvent(new Event('click',{bubbles:true}));
  assert.deepEqual(calls,[['theme','night']]);
  assert.equal(f.dialog.open,false);
  assert.equal(f.doc.activeElement,f.opener,'theme actions return to the launch point');
  const fixed=openFixture({library});fixed.palette.open();
  fixed.input().value='night';fixed.input().dispatchEvent(new Event('input'));
  assert.equal(fixed.options().some(option=>option.textContent.includes('Night')),false,'a console without an appearance adapter offers no dead theme actions');
});

test('palette commands are explicit per page and never claim search-in-book',()=>{
  const reader=paletteCommands('reader',{appearance:{setTheme(){},adjustFont(){}}});
  const support=paletteCommands('support',{});
  assert.ok(reader.some(command=>command.id==='theme-night'));
  assert.equal(support.some(command=>command.id==='theme-night'),false);
  for(const commands of [reader,support])assert.equal(commands.some(command=>/书内|全书搜索|search-in-book/.test(command.label)),false);
  assert.ok(Object.keys(PALETTE_TEXT).length>0);
});

test('owner races and late returns never surface private names in the palette',async()=>{
  const {createPaletteLibrary}=await import('../app/palette-library.mjs');
  let slowResolve=null;const slow=new Promise(resolve=>{slowResolve=resolve;});
  let owner='reader-one';
  const request=async url=>{
    if(url==='/api/auth/session')return {ok:true,status:200,headers:{get:()=>null},json:async()=>({user:{id:'reader-one'}})};
    await slow;return {ok:true,status:200,headers:{get:()=>null},json:async()=>({books:[{bookId:'mine',title:{zh:'我的私书',en:'Mine'},visibility:'private'}]})};
  };
  const library=createPaletteLibrary({request,getOwner:()=>owner});
  const f=openFixture({library});
  f.palette.open();
  const loading=library.load();owner='reader-two';slowResolve();await loading;
  f.input().value='书';f.input().dispatchEvent(new Event('input'));
  assert.equal(f.options().some(option=>option.textContent.includes('私书')),false,'a late owner return can never appear');
  assert.equal(f.options().some(option=>option.textContent.includes('旧账户')),false);
  assert.equal(f.status().textContent.includes('私书'),false);
});

test('the bootstrap defers both shortcuts on handled events, IME, editing and other modals',()=>{
  assert.equal(paletteShortcutAllowed(key({},{})),true);
  const handled=key({},{});handled.preventDefault();
  assert.equal(paletteShortcutAllowed(handled),false,'handled events are respected');
  assert.equal(paletteShortcutAllowed(key({},{isComposing:true})),false);
  assert.equal(paletteShortcutAllowed(key({},{keyCode:229})),false,'IME keyCode 229 defers');
  assert.equal(paletteShortcutAllowed(key({},{}),{editable:true}),false);
  assert.equal(paletteShortcutAllowed(key({},{}),{modalOpen:true}),false);
});

test('the small bootstrap owns keycaps, exact pointer predicates and one on-demand import',async()=>{
  const doc=fixture();doc.body.dataset.palettePage='home';
  const keycap=doc.createElement('kbd');keycap.dataset.paletteKeycap='';doc.body.append(keycap);
  const opener=doc.createElement('button');opener.dataset.paletteOpen='';doc.body.append(opener);
  const queries=[];
  assert.equal(paletteKeycapHintAvailable(q=>{queries.push(q);return q==='(any-pointer: fine)'?{matches:true}:{matches:true};}),true,'fine primary with a coarse secondary still hints shortcuts');
  assert.deepEqual(queries,[...PALETTE_POINTER_QUERIES]);
  assert.equal(paletteKeycapHintAvailable(q=>q==='(pointer: coarse)'?{matches:true}:{matches:false}),false,'a coarse-only device hides the keycap hint');
  const loads=[];
  const tools=mountPaletteBootstrap({document:doc,navigator:{userAgentData:{platform:'macOS'}},matchMedia:()=>({matches:true}),loadPalette:async()=>{loads.push(1);return {openCommandPalette:()=>({opened:true})};}});
  assert.equal(keycap.textContent,PALETTE_KEYCAP.mac);
  assert.deepEqual(loads,[],'the palette module stays on demand');
  opener.click();await Promise.resolve();
  assert.equal(loads.length,1);
  const again=key(opener,{key:'k',metaKey:true});doc.dispatchEvent(again);
  await Promise.resolve();assert.equal(loads.length,1,'the palette is not re-imported per shortcut');
  const shift=key(opener,{key:'k',metaKey:true,shiftKey:true});doc.dispatchEvent(shift);
  await Promise.resolve();assert.equal(loads.length,1,'unintended modifier combinations keep browser shortcuts');
  assert.equal(typeof tools.open,'function');
});

// ---- repair batch: actual bootstrap -> controller open/reopen integration ----
const flush=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
test('the bootstrap actually opens the controller, reopens after close, and keeps one listener set',async()=>{
  const doc=fixture();doc.body.dataset.palettePage='home';
  const opener=doc.createElement('button');opener.dataset.paletteOpen='';doc.body.append(opener);
  const opens=[];
  const controller={open(at){opens.push(at);this.isOpen=true;},close(){this.isOpen=false;}};
  let factoryCalls=0;
  const tools=mountPaletteBootstrap({document:doc,navigator:{userAgentData:{platform:'macOS'}},matchMedia:()=>({matches:true}),loadPalette:async()=>{factoryCalls++;return {openCommandPalette:options=>{assert.equal(options.page,'home');return controller;}};}});
  opener.click();await flush();
  assert.deepEqual(opens,[opener],'the first gesture runs controller.open on the actual opener');
  assert.equal(factoryCalls,1);
  controller.close();
  const again=key(opener,{key:'k',metaKey:true});doc.dispatchEvent(again);await flush();
  assert.deepEqual(opens,[opener,opener],'closing the dialog allows a fresh reopen');
  assert.equal(factoryCalls,1,'the controller is built once');
  assert.equal(typeof tools.open,'function');
});

test('a failed palette import is visible, safe and retried on the next gesture',async()=>{
  const doc=fixture();doc.body.dataset.palettePage='home';
  const opener=doc.createElement('button');opener.dataset.paletteOpen='';doc.body.append(opener);
  let attempts=0;const opens=[];
  const load=async()=>{attempts++;if(attempts===1)throw Error('module unavailable');return {openCommandPalette:()=>({open:at=>opens.push(at)})};};
  const tools=mountPaletteBootstrap({document:doc,navigator:{userAgentData:{platform:'macOS'}},matchMedia:()=>({matches:true}),loadPalette:load,loadRetry:load});
  opener.click();await flush();
  assert.deepEqual(opens,[],'a failed import cannot open the dialog');
  const notice=noticeOf(doc);
  assert.ok(notice,'the failure is reported visibly, not as an unhandled rejection');
  opener.click();await flush();
  assert.equal(attempts,2,'the failed import is retried');
  assert.deepEqual(opens,[opener]);
  assert.equal(typeof tools.open,'function');
});

test('the real dialog controller keeps one owner and listener set across repeated opens',()=>{
  const doc=fixture();
  const palette=openCommandPalette({document:doc,page:'home',library:{view:()=>({phase:'ready',count:0}),load:async()=>{},search:()=>[]}});
  const dialog=palette.dialog,input=doc.getElementById('command-palette-input');
  const counts=()=>({dialog:[...dialog.listeners].filter(([name])=>name==='cancel').reduce((n,[,c])=>n+c,0),input:[...input.listeners].filter(([name])=>name==='keydown').reduce((n,[,c])=>n+c,0)});
  const before=counts();
  palette.open();palette.close({restoreFocus:false});palette.open();palette.close({restoreFocus:false});palette.open();
  assert.deepEqual(counts(),before,'reopening never stacks dialog or keyboard listeners');
  assert.equal(dialog.open,true);
});

test('reader fullscreen runs through the production palette adapter path',async()=>{
  const calls=[];
  const doc=fixture();doc.body.dataset.palettePage='reader';
  const opener=doc.createElement('button');opener.dataset.paletteOpen='';doc.body.append(opener);
  // The exact adapter shape app/reader.js registers on the page.
  globalThis.marginaliaPaletteAdapter={getOwner:()=>null,appearance:{setTheme:theme=>calls.push(['theme',theme]),adjustFont:d=>calls.push(['font',d])},fullscreen:()=>calls.push(['fullscreen'])};
  const library={view:()=>({phase:'ready',count:0}),load:async()=>{},search:()=>[]};
  try{
    const tools=mountPaletteBootstrap({document:doc,navigator:{userAgentData:{platform:'macOS'}},matchMedia:()=>({matches:true}),loadPalette:async()=>({openCommandPalette:options=>openCommandPalette({...options,library,navigate:()=>{}})})});
    opener.click();await flush();
    const input=doc.getElementById('command-palette-input');
    input.value='full';input.dispatchEvent(new Event('input'));
    const option=doc.querySelectorAll('[role=option]').find(node=>node.textContent.includes('Full-screen'));
    assert.ok(option,'the reader adapter exposes a fullscreen command');
    option.dispatchEvent(new Event('click',{bubbles:true}));
    assert.deepEqual(calls,[['fullscreen']],'fullscreen must run through the production adapter, not a default no-op');
  }finally{delete globalThis.marginaliaPaletteAdapter;}
});

// ---- repair batch: owner lifecycle + async load settlement refresh ----
test('owner transition clears rendered results and cached search before any async identity check',async()=>{
  const {createPaletteLibrary}=await import('../app/palette-library.mjs');
  let owner='owner-a',subscribers=[];
  const request=async url=>url==='/api/auth/session'?{ok:true,status:200,headers:{get:()=>null},json:async()=>({user:{id:'owner-a'}})}:{ok:true,status:200,headers:{get:()=>null},json:async()=>({books:[{bookId:'mine',title:{zh:'Owner A 私人书',en:'Private'},visibility:'private'}]})};
  const library=createPaletteLibrary({request,getOwner:()=>owner,subscribe:fn=>{subscribers.push(fn);return ()=>{};}});
  const adapter={getOwner:()=>owner,subscribe:fn=>{subscribers.push(fn);return ()=>{};}};
  const f=openFixture({library});f.palette.open();
  await flush();
  f.input().value='私人';f.input().dispatchEvent(new Event('input'));
  assert.ok(f.options().some(option=>option.textContent.includes('Owner A 私人书')),'owner A sees own private results');
  owner='owner-b';for(const fn of subscribers)fn();
  assert.equal(f.options().some(option=>option.textContent.includes('Owner A 私人书')),false,'rendered DOM clears synchronously on the owner transition');
  assert.equal(library.search('私人').length,0,'cached search is owner-fenced');
  void adapter;
});

test('load settlement refreshes the typed query and errors offer a real retry',async()=>{
  let resolveLoad;const pending=new Promise(r=>resolveLoad=r);let attempt=0;
  const library={
    _phase:'idle',
    view(){return {phase:this._phase,count:0};},
    search(query){return this._phase==='ready'&&query==='爱丽'?[{bookId:'alice',title:{zh:'爱丽丝梦游仙境',en:'Alice'},author:'Carroll'}]:[];},
    async load(){attempt++;this._phase='loading';if(attempt===1){await pending;}this._phase='ready';}
  };
  const f=openFixture({library});f.palette.open();
  f.input().value='爱丽';f.input().dispatchEvent(new Event('input'));
  assert.match(f.status().textContent,/Loading/,'loading is visible while the typed query waits');
  resolveLoad();await flush();
  assert.ok(f.options().some(option=>option.textContent.includes('爱丽丝梦游仙境')),'settlement refreshes the already-typed query');
  assert.match(f.status().textContent,/1/);
  const failing=openFixture({library:{view:()=>({phase:'error',count:0}),search:()=>[],load:async()=>{throw Error('503');}}});
  failing.palette.open();await flush();
  failing.input().value='x';failing.input().dispatchEvent(new Event('input'));
  assert.match(failing.status().textContent,/could not|unavailable|failed/,'an error is not an empty result');
  const retry=failing.options().find(option=>option.textContent.includes('Reload the catalogue'));
  assert.ok(retry,'an error offers a meaningful retry');
});

test('the generated /library document keeps the exact body shell and resolves the library palette page',async()=>{
  const {portalDocument}=await import('../server/portal-document.mjs');
  const {readFile}=await import('node:fs/promises');
  const source=await readFile(new URL('../app/home.html',import.meta.url),'utf8');
  assert.match(source,/<body>/,'the authored home body shell stays byte-exact for portalDocument');
  const library=portalDocument(source,'/library');
  assert.match(library,/<body class="library-page">/,'the server body replace keeps adding the library page class');
  assert.equal(library.includes('data-palette-page='),false,'no palette host metadata may break the exact replace');
  assert.ok(library.includes('palette-bootstrap.mjs'),'the shared bootstrap ships in the generated library shell');
  assert.ok(library.includes('id="library-view"')&&library.includes('id="home-view" hidden'),'full authored content survives generation');
  assert.ok(library.includes('id="featured-books"'),'GET180 card markup remains exact in the generated shell');
  const home=portalDocument(source,'/');
  assert.match(home,/<body>/,'the home route keeps the plain body shell');
  // The bootstrap resolves the palette page from the generated shell's class.
  const doc=fixture();doc.body.classList.add('library-page');
  const opener=doc.createElement('button');opener.dataset.paletteOpen='';doc.body.append(opener);
  let seen=null;
  const tools=mountPaletteBootstrap({document:doc,navigator:{userAgentData:{platform:'macOS'}},matchMedia:()=>({matches:true}),loadPalette:async()=>({openCommandPalette:options=>{seen=options.page;return {open(){}};}})});
  opener.click();await flush();
  assert.equal(seen,'library','palette page comes from the existing library-page class');
  assert.equal(typeof tools.open,'function');
});

test('page account lifecycles synchronously invalidate an open palette cache and DOM',async()=>{
  const {createPaletteLibrary,invalidatePaletteLibraries}=await import('../app/palette-library.mjs');
  const request=async url=>url==='/api/auth/session'?{ok:true,status:200,headers:{get:()=>null},json:async()=>({user:{id:'owner-a'}})}:{ok:true,status:200,headers:{get:()=>null},json:async()=>({books:[{bookId:'mine',title:{zh:'Owner A 私人书',en:'Private'},visibility:'private'}]})};
  const library=createPaletteLibrary({request,getOwner:()=> 'owner-a'});
  const f=openFixture({library});f.palette.open();
  await flush();
  f.input().value='私人';f.input().dispatchEvent(new Event('input'));
  assert.ok(f.options().some(option=>option.textContent.includes('Owner A 私人书')));
  invalidatePaletteLibraries();
  assert.equal(f.options().some(option=>option.textContent.includes('Owner A 私人书')),false,'the account lifecycle clears rendered private results synchronously');
  assert.deepEqual(library.search('私人'),[]);
});

test('generated home and library shells carry palette hosts for the self-mount gate',async()=>{
  const {portalDocument}=await import('../server/portal-document.mjs');
  const {readFile}=await import('node:fs/promises');
  const source=await readFile(new URL('../app/home.html',import.meta.url),'utf8');
  for(const route of ['/','/library']){
    const shell=portalDocument(source,route);
    assert.ok(/data-palette-open/.test(shell),route+' ships a palette host entry');
    assert.ok(/data-palette-keycap/.test(shell),route+' ships the visible keycap');
  }
  const host=fixture();const entry=doc=>doc.createElement('button');
  const button=entry(host);button.dataset.paletteOpen='';host.body.append(button);host.body.classList.add('library-page');
  assert.equal(paletteHasHost(host),true);
  assert.equal(palettePageFor(host),'library');
  const home=fixture();const homeButton=entry(home);homeButton.dataset.paletteOpen='';home.body.append(homeButton);
  assert.equal(palettePageFor(home),'home');
  const bare=fixture();assert.equal(paletteHasHost(bare),false,'a page without a palette host does not self-mount');
});

// ---- GET-188: explicit palette:open port, delayed-import fences, corrected setup-retry regression ----
const bootstrapFixture=({loadPalette,loadRetry=loadPalette,adapter=undefined}={})=>{
  const doc=fixture();doc.body.dataset.palettePage='home';
  const opener=doc.createElement('button');opener.dataset.paletteOpen='';doc.body.append(opener);
  const tools=mountPaletteBootstrap({document:doc,adapter,navigator:{userAgentData:{platform:'macOS'}},matchMedia:()=>({matches:true}),loadPalette,loadRetry});
  return {doc,opener,tools};
};
const noticeOf=doc=>doc.querySelectorAll('[role="status"]').find(node=>node.textContent.includes('command palette')||node.children.some(child=>String(child.textContent||'').includes('command palette')))||null;
const noticeParts=doc=>{
  const notice=doc.body.children.find(node=>String(node.className).includes('palette-notice'))||null;
  const child=name=>notice?notice.children.find(node=>String(node.className).includes(name))||null:null;
  return {notice,retry:child('palette-retry'),reload:child('palette-reload')};
};
// A loadPalette whose module builds a controller, counting every stage.
const countingModule=(counters,{failImport=false,failSetup=false,failOpen=false}={})=>async()=>{
  counters.imports++;
  if(failImport&&counters.imports===1)throw Error('import unavailable');
  let openAttempts=0;
  return {
    openCommandPalette(){
      counters.setups++;
      if(failSetup&&counters.setups===1)throw Error('setup unavailable');
      return {
        open(){
          openAttempts++;
          if(failOpen&&openAttempts===1)throw Error('open unavailable');
          counters.opens++;
        },
        close(){}
      };
    }
  };
};

test('the document palette:open request routes through the one existing gesture path with its actual opener',async()=>{
  const opens=[];
  const f=bootstrapFixture({loadPalette:async()=>({openCommandPalette:()=>({open:at=>opens.push(at),close(){}})})});
  const request=f.doc.createElement('button');f.doc.body.append(request);
  f.doc.dispatchEvent(new CustomEvent('palette:open',{detail:request}));
  await flush();
  assert.deepEqual(opens,[request],'the event detail opener goes through the existing open path');
  f.opener.click();await flush();
  assert.deepEqual(opens,[request,f.opener],'the old static launchers keep their behaviour beside the event port');
  const shortcut=key(f.opener,{key:'k',metaKey:true});f.doc.dispatchEvent(shortcut);await flush();
  assert.deepEqual(opens,[request,f.opener,f.opener],'Ctrl K still opens the same single controller');
});

test('a stale late import only caches code and never mounts or focuses',async()=>{
  let release;const pending=new Promise(resolve=>{release=resolve;});
  const counters={imports:0,setups:0,opens:0};const opened=[];
  const f=bootstrapFixture({loadPalette:async()=>{
    counters.imports++;
    await pending;
    return {openCommandPalette:()=>{counters.setups++;return {open:at=>opened.push(at),close(){}};}};
  }});
  const late=f.tools.open(f.opener);
  const newer=f.doc.createElement('button');f.doc.body.append(newer);
  const current=f.tools.open(newer);
  release();await Promise.all([late,current]);
  assert.deepEqual(counters,{imports:1,setups:1,opens:0},'the stale request only consumes the shared cached code');
  assert.deepEqual(opened,[newer],'only the current request mounts and focuses the palette');
});

test('a modal opened during the import wait wins; the stale request mounts and focuses nothing',async()=>{
  let release;const pending=new Promise(resolve=>{release=resolve;});
  const counters={imports:0,setups:0,opens:0};
  const f=bootstrapFixture({loadPalette:async()=>{
    counters.imports++;
    await pending;
    return {openCommandPalette:()=>{counters.setups++;return {open:()=>{counters.opens++;},close(){}};}};
  }});
  const focused=f.doc.activeElement;
  const late=f.tools.open(f.opener);
  const other=f.doc.createElement('dialog');f.doc.body.append(other);other.open=true;other.setAttribute('open','');
  release();await late;
  assert.deepEqual(counters,{imports:1,setups:0,opens:0},'a newer modal cancels the request instead of stacking');
  assert.equal(f.doc.activeElement,focused,'the cancelled request never moves focus');
});

test('an owner change during the import wait makes the request stale without mounting or focusing',async()=>{
  let release;const pending=new Promise(resolve=>{release=resolve;});
  const counters={imports:0,setups:0,opens:0};
  let owner='reader-one';
  globalThis.marginaliaPaletteAdapter={getOwner:()=>owner};
  try{
    const f=bootstrapFixture({loadPalette:async()=>{
      counters.imports++;
      await pending;
      return {openCommandPalette:()=>{counters.setups++;return {open:()=>{counters.opens++;},close(){}};}};
    }});
    const late=f.tools.open(f.opener);
    owner='reader-two';
    release();await late;
    assert.deepEqual(counters,{imports:1,setups:0,opens:0},'an owner transition invalidates the captured request');
  }finally{delete globalThis.marginaliaPaletteAdapter;}
});

test('a breakpoint-hidden opener hands the palette a visible brand fallback, never a closed-sheet child',async()=>{
  const doc=fixture();doc.body.dataset.palettePage='home';
  const header=doc.createElement('header');header.className='site-theme-header site-header';doc.body.append(header);
  const brand=doc.createElement('a');brand.className='brand';header.append(brand);
  const opener=doc.createElement('button');opener.dataset.paletteOpen='';opener.getClientRects=()=>[];doc.body.append(opener);
  const opens=[];
  const tools=mountPaletteBootstrap({document:doc,navigator:{userAgentData:{platform:'macOS'}},matchMedia:()=>({matches:true}),loadPalette:async()=>({openCommandPalette:()=>({open:at=>opens.push(at),close(){}})})});
  await tools.open(opener);
  assert.deepEqual(opens,[brand],'the visible brand is the eventual focus-return target');
});

test('the corrected regression consumes the whole import+setup+open failure and retries visibly',async()=>{
  let imports=0,setups=0,opens=0;
  const f=bootstrapFixture({loadPalette:async()=>{
    imports++;
    return {openCommandPalette(){
      setups++;
      if(setups===1)throw Error('synthetic setup failure');
      return {open(){opens++;},close(){}};
    }};
  }});
  await assert.rejects(f.tools.open(f.opener),/synthetic setup failure/,'the first explicit open surfaces one consumed failure');
  assert.deepEqual({imports,setups,opens},{imports:1,setups:1,opens:0});
  assert.ok(noticeOf(f.doc),'the failure is visible, not silent');
  const {notice,retry}=noticeParts(f.doc);
  assert.ok(retry,'a current retry control accompanies the notice');
  assert.equal(retry.hidden,false);
  const second=await f.tools.open(f.opener);
  assert.ok(second,'the second explicit open re-runs the cleared chain and succeeds');
  assert.deepEqual({imports,setups,opens},{imports:1,setups:2,opens:1},'a setup failure retries with the already loaded module identity, never a second import');
  assert.equal(notice.hidden,true,'the notice reflects the current state after success');
});

for(const stage of ['import','setup','open'])test('the '+stage+' failure is consumed with one visible retry and no duplicate open',async()=>{
  const counters={imports:0,setups:0,opens:0};
  const f=bootstrapFixture({loadPalette:countingModule(counters,{failImport:stage==='import',failSetup:stage==='setup',failOpen:stage==='open'})});
  await assert.rejects(f.tools.open(f.opener),new RegExp(stage+' unavailable'),'the '+stage+' failure reaches the explicit caller once');
  assert.ok(noticeOf(f.doc),'the '+stage+' failure is visible');
  const {notice,retry}=noticeParts(f.doc);
  assert.ok(retry,'the '+stage+' failure offers one visible retry control');
  retry.click();await flush();
  assert.equal(counters.opens,1,'the visible retry control opens exactly once');
  assert.equal(notice.hidden,true,'the notice is no longer current after success');
});

test('a failing real setup rolls back only its own partial DOM and retry keeps one controller and one listener set',async()=>{
  const doc=fixture();doc.body.dataset.palettePage='home';
  const opener=doc.createElement('button');opener.dataset.paletteOpen='';doc.body.append(opener);
  let broken=true,imports=0;
  // The library reads the sabotage flag lazily: the settled contract reuses the
  // loaded module identity across setup retries, so the namespace must not bake
  // the failure in.
  const library={view(){if(broken)throw Error('late setup failure');return {phase:'ready',count:0};},load:async()=>{},search:()=>[]};
  const loadPalette=async()=>{imports++;return {openCommandPalette:options=>openCommandPalette({...options,library,navigate:()=>{}})};};
  const tools=mountPaletteBootstrap({document:doc,navigator:{userAgentData:{platform:'macOS'}},matchMedia:()=>({matches:true}),loadPalette});
  await assert.rejects(tools.open(opener),/late setup failure/);
  assert.equal(doc.getElementById('command-palette'),null,'the failed transaction removes its own dialog instead of leaving a poisoned reuse');
  broken=false;
  const controller=await tools.open(opener);
  assert.ok(controller);
  assert.equal(doc.body.children.filter(node=>String(node.className).includes('command-palette')).length,1,'exactly one palette overlay after retry');
  const dialog=doc.getElementById('command-palette'),input=doc.getElementById('command-palette-input');
  const counts=()=>({dialog:[...dialog.listeners].filter(([name])=>name==='cancel').reduce((n,[,c])=>n+c,0),input:[...input.listeners].filter(([name])=>name==='keydown').reduce((n,[,c])=>n+c,0)});
  const before=counts();
  controller.open(opener);controller.close({restoreFocus:false});controller.open(opener);
  assert.deepEqual(counts(),before,'reopening after the rolled-back setup never stacks listeners');
  assert.equal(imports,1,'the loaded module identity is reused across setup retries');
});

// ---- GET-188 review batch: finite import recovery, settlement fence, owned library rollback ----
test('the import stage recovers once through the exact retry URL and then falls back to manual page reload',async()=>{
  let initial=0,retry=0,opens=0;
  const f=bootstrapFixture({
    loadPalette:async()=>{initial++;throw Error('import unavailable');},
    loadRetry:async()=>{retry++;throw Error('retry unavailable');}
  });
  await assert.rejects(f.tools.open(f.opener),/import unavailable/);
  assert.deepEqual({initial,retry},{initial:1,retry:0},'the first failure is the initial module URL only');
  assert.ok(noticeOf(f.doc));
  let parts=noticeParts(f.doc);
  assert.equal(parts.retry.hidden,false,'an import failure offers the explicit retry');
  assert.equal(parts.reload.hidden,true,'no page-reload fallback before the finite retry is spent');
  parts.retry.click();await flush();
  assert.deepEqual({initial,retry},{initial:1,retry:1},'the one explicit retry uses the exact second URL once');
  parts=noticeParts(f.doc);
  assert.equal(parts.retry.hidden,true,'the spent retry is no longer offered as a module retry');
  assert.equal(parts.reload.hidden,false,'the honest final fallback is manual page reload');
  assert.equal(f.doc.body.children.filter(node=>String(node.className).includes('palette-notice')).length,1,'one notice only');
  await assert.rejects(f.tools.open(f.opener),/命令面板/,'later opens stay honest without new imports');
  assert.deepEqual({initial,retry},{initial:1,retry:1},'no unbounded import attempts after the finite retry');
  assert.equal(f.doc.body.children.filter(node=>String(node.className).includes('palette-notice')).length,1,'one notice only');
});

test('the exact retry URL recovers the palette and hides the failure notice',async()=>{
  let retry=0,opens=0;
  const f=bootstrapFixture({
    loadPalette:async()=>{throw Error('import unavailable');},
    loadRetry:async()=>{retry++;return {openCommandPalette:()=>({open:()=>{opens++;},close(){}})};}
  });
  await assert.rejects(f.tools.open(f.opener),/import unavailable/);
  noticeParts(f.doc).retry.click();await flush();
  assert.equal(retry,1);assert.equal(opens,1,'the recovered palette opens exactly once');
  assert.equal(noticeParts(f.doc).notice.hidden,true,'the notice reflects the current state after recovery');
});

test('the manual reload fallback reloads only when the user activates it',async()=>{
  let reloads=0;
  const previous=globalThis.location;
  globalThis.location={reload(){reloads++;}};
  try{
    const f=bootstrapFixture({loadPalette:async()=>{throw Error('import unavailable');},loadRetry:async()=>{throw Error('retry unavailable');}});
    await assert.rejects(f.tools.open(f.opener),/import unavailable/);
    noticeParts(f.doc).retry.click();await flush();
    assert.equal(reloads,0,'nothing reloads automatically');
    noticeParts(f.doc).reload.click();
    assert.equal(reloads,1,'the final fallback reloads only on manual activation');
  }finally{if(previous===undefined)delete globalThis.location;else globalThis.location=previous;}
});

test('a stale rejected request never closes newer state or paints a notice for the new owner',async()=>{
  let owner='A',rejectLoad;
  const f=bootstrapFixture({adapter:{getOwner:()=>owner},loadPalette:()=>new Promise((resolve,reject)=>{rejectLoad=reject;})});
  const pending=f.tools.open(f.opener);
  await Promise.resolve();
  owner='B';
  rejectLoad(Error('old owner network failure'));
  await assert.rejects(pending,/old owner network failure/,'the explicit caller still sees one consumed failure');
  assert.equal(noticeOf(f.doc),null,'a stale catch creates no visible notice');
  assert.deepEqual(noticeParts(f.doc),{notice:null,retry:null,reload:null});
});

test('the owner settlement token cancels an A->B->A stale request and a later request still opens',async()=>{
  let token='A:0',resolveLoad;
  const counters={setups:0,opens:0};
  const f=bootstrapFixture({adapter:{getOwner:()=>'reader',getOwnerToken:()=>token},loadPalette:()=>new Promise(resolve=>{resolveLoad=resolve;})});
  const stale=f.tools.open(f.opener);
  await Promise.resolve();
  token='B:1';token='A:2';
  resolveLoad({openCommandPalette:()=>{counters.setups++;return {open:()=>{counters.opens++;},close(){}};}});
  assert.equal(await stale,null,'the settled owner revision makes the old request stale');
  assert.deepEqual(counters,{setups:0,opens:0},'a stale module result never mounts or focuses');
  const later=await f.tools.open(f.opener);
  assert.ok(later,'a later valid request reuses the cached code and opens');
  assert.deepEqual(counters,{setups:1,opens:1});
  assert.equal(noticeOf(f.doc),null,'the cancelled request leaves no failure notice');
});

test('setup and open failures retry with the loaded module identity and never re-import',async()=>{
  for(const stage of ['setup','open']){
    let imports=0,setups=0,opens=0;
    const moduleFactory=async()=>{
      imports++;
      let openCalls=0;
      return {openCommandPalette(){
        setups++;
        if(stage==='setup'&&setups===1)throw Error('setup unavailable');
        return {open(){openCalls++;if(stage==='open'&&openCalls===1)throw Error('open unavailable');opens++;},close(){}};
      }};
    };
    const f=bootstrapFixture({loadPalette:moduleFactory,loadRetry:moduleFactory});
    await assert.rejects(f.tools.open(f.opener),new RegExp(stage+' unavailable'));
    noticeParts(f.doc).retry.click();await flush();
    assert.deepEqual({imports,setups,opens},stage==='setup'?{imports:1,setups:2,opens:1}:{imports:1,setups:1,opens:1},stage+' failure retries without a second module identity');
    assert.equal(noticeParts(f.doc).notice.hidden,true);
  }
});

test('a failed setup disposes only its internally created palette library',async()=>{
  const {createPaletteLibrary,invalidatePaletteLibraries}=await import('../app/palette-library.mjs');
  invalidatePaletteLibraries();
  let ownerReads=0,subscribes=0,releases=0;
  const adapter={getOwner:()=>{ownerReads++;return 'reader-a';},subscribe:()=>{subscribes++;return ()=>{releases++;};}};
  const failingDoc={querySelectorAll:()=>[],getElementById:()=>null,head:{append(){}},createElement(){throw Error('synthetic DOM setup failure');}};
  for(let attempt=0;attempt<3;attempt++)assert.throws(()=>openCommandPalette({document:failingDoc,adapter,request:()=>{throw Error('no API request permitted');}}),/synthetic DOM setup failure/);
  assert.deepEqual({subscribes,releases},{subscribes:3,releases:3},'every internally created library is disposed with its subscription');
  const before=ownerReads;
  invalidatePaletteLibraries();
  assert.equal(ownerReads,before,'failed setups leave no retained library behind the global invalidation');
  // An externally injected library keeps its own ownership across setup failure.
  const external=createPaletteLibrary({request:async()=>({ok:true,status:200,headers:{get:()=>null},json:async()=>({books:[]})}),getOwner:()=> 'reader-a'});
  let disposed=false;const realDispose=external.dispose;external.dispose=()=>{disposed=true;realDispose();};
  assert.throws(()=>openCommandPalette({document:failingDoc,library:external,adapter,request:()=>{throw Error('no API request permitted');}}),/synthetic DOM setup failure/);
  assert.equal(disposed,false,'an externally injected library is never disposed by this factory');
  assert.deepEqual(external.view().phase,'idle','the external library stays usable');
  external.dispose();
});


test('language refresh preserves palette result identity, query, active choice and focus without searching again',async()=>{
  const {requestUiRoute,t}=await import('../app/ui-locale.mjs');
  await requestUiRoute('en');let searches=0;
  const f=openFixture({library:{view:()=>({phase:'ready'}),search:()=>{searches++;return [{bookId:'one',title:{en:'Open a real book'}}];}}});
  try{
    f.palette.open();const input=f.input();input.value='open';input.dispatchEvent(new Event('input'));
    input.dispatchEvent(key(input,{key:'ArrowDown'}));
    const before=f.options(),active=input.getAttribute('aria-activedescendant'),count=searches;
    f.dialog.scrollTop=39;
    await requestUiRoute('ja');
    assert.equal(input.value,'open');assert.equal(f.doc.activeElement,input);assert.equal(f.dialog.scrollTop,39);
    assert.equal(searches,count);assert.equal(input.getAttribute('aria-activedescendant'),active);
    assert.deepEqual(f.options(),before);assert.equal(before[1].textContent,t('palette.settings'));
    input.dispatchEvent(key(input,{key:'Enter'}));assert.equal(f.nav[0],'/library?settings=appearance');
  }finally{f.palette.dispose();await requestUiRoute('en');}
});

test('palette destinations carry Japanese through authored home and canonical pages, including without a saved preference',async()=>{
  const {requestUiRoute,createUiLocale}=await import('../app/ui-locale.mjs');
  const ja=(await import('../app/ui-catalogs/ja.mjs')).default;
  await requestUiRoute('ja');
  try{
    const nav=[];const commands=paletteCommands('home',null,url=>nav.push(url));
    for(const id of ['home','library','settings','calendar'])commands.find(x=>x.id===id).run();
    assert.deepEqual(nav,['/ja','/library','/library?settings=appearance','/library?calendar=1']);
    for(const saved of [null,'ja'])for(const target of nav){
      const location={href:'https://leafhour.com'+target};
      const runtime=createUiLocale({getLocation:()=>location,storage:{getItem:()=>saved,setItem(){}},languages:['en'],loadCatalogue:async()=>ja,history:{replaceState(){}},eventTarget:null});
      await runtime.initialize();assert.equal(runtime.getUiLocale(),target==='/ja'?'ja':saved||'en',target+' follows the selected preference');
    }
  }finally{await requestUiRoute('en');}
});

test('disposing a palette fences late catalogue completion and future opens',async()=>{
  let finish,view={phase:'idle'},searches=0,unwatched=0;
  const f=openFixture({adapter:{getOwner:()=>null},library:{view:()=>view,watch:()=>()=>unwatched++,search:()=>{searches++;return [];},load:()=>new Promise(resolve=>{finish=()=>{view={phase:'ready'};resolve();};})}});
  f.palette.open();f.input().value='query';const list=f.doc.getElementById('command-palette-list'),before=[...list.children],count=searches;
  f.palette.dispose();finish();await new Promise(setImmediate);f.palette.open();f.palette.refresh();
  assert.deepEqual(list.children,before);assert.equal(f.doc.getElementById('command-palette'),null);assert.equal(searches,count);assert.equal(f.dialog.open,false);assert.equal(unwatched,1);
});


test('dispose followed by a fresh mount on the same document binds working search and Enter once',()=>{
  const doc=fixture(),nav=[],library={view:()=>({phase:'ready'}),search:()=>[{bookId:'again',title:{en:'Again'}}]};
  const first=openCommandPalette({document:doc,library,navigate:url=>nav.push(url)});first.open();const old=first.dialog;first.dispose();
  assert.equal(doc.getElementById('command-palette'),null);
  const second=openCommandPalette({document:doc,library,navigate:url=>nav.push(url)});
  try{second.open();assert.notEqual(second.dialog,old);const input=doc.getElementById('command-palette-input');input.value='Again';input.dispatchEvent(new Event('input'));input.dispatchEvent(key(input,{key:'Enter'}));assert.deepEqual(nav,['/read?book=again']);}
  finally{second.dispose();}
});
