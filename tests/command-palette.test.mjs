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
  doc.querySelector=selector=>{if(String(selector).includes(':popover-open'))throw Error('unsupported selector: '+selector);return null;};
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
  for(const [phase,expected] of [['loading',/载入/],['ready',/没有/],['error',/无法|失败/]]){
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
  f.input().value='设置';f.input().dispatchEvent(new Event('input'));
  const options=f.options();
  assert.ok(options.length>0);
  const settings=options.find(option=>option.textContent.includes('设置'));
  settings.dispatchEvent(new Event('click',{bubbles:true}));
  assert.equal(f.dialog.open,false);
  assert.notEqual(f.doc.activeElement,f.opener,'a settings handoff must not restore stale focus');
  assert.equal(f.nav[0],'/library?settings=appearance','the destination uses the exact GET-179 codec output');
});

test('reader appearance commands use the existing appearance adapter and preserve the launch point',()=>{
  const calls=[];const adapter={appearance:{setTheme:value=>calls.push(['theme',value]),adjustFont:delta=>calls.push(['font',delta])}};
  const library={view:()=>({phase:'ready',count:0}),load:async()=>{},search:()=>[]};
  const f=openFixture({page:'reader',adapter,library});f.palette.open();
  f.input().value='夜';f.input().dispatchEvent(new Event('input'));
  const night=f.options().find(option=>option.textContent.includes('夜色'));
  assert.equal(f.status().textContent,'夜色 · 1 项结果','a matching command must not also announce no matches');
  night.dispatchEvent(new Event('click',{bubbles:true}));
  assert.deepEqual(calls,[['theme','night']]);
  assert.equal(f.dialog.open,false);
  assert.equal(f.doc.activeElement,f.opener,'theme actions return to the launch point');
  const fixed=openFixture({library});fixed.palette.open();
  fixed.input().value='夜';fixed.input().dispatchEvent(new Event('input'));
  assert.equal(fixed.options().some(option=>option.textContent.includes('夜色')),false,'a console without an appearance adapter offers no dead theme actions');
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
  const tools=mountPaletteBootstrap({document:doc,navigator:{userAgentData:{platform:'macOS'}},matchMedia:()=>({matches:true}),loadPalette:async()=>{attempts++;if(attempts===1)throw Error('module unavailable');return {openCommandPalette:()=>({open:at=>opens.push(at)})};}});
  opener.click();await flush();
  assert.deepEqual(opens,[],'a failed import cannot open the dialog');
  const notice=doc.querySelectorAll('[role="status"]').find(node=>node.textContent.includes('命令面板'));
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
    input.value='全屏';input.dispatchEvent(new Event('input'));
    const option=doc.querySelectorAll('[role=option]').find(node=>node.textContent.includes('全屏'));
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
  assert.match(f.status().textContent,/载入/,'loading is visible while the typed query waits');
  resolveLoad();await flush();
  assert.ok(f.options().some(option=>option.textContent.includes('爱丽丝梦游仙境')),'settlement refreshes the already-typed query');
  assert.match(f.status().textContent,/1/);
  const failing=openFixture({library:{view:()=>({phase:'error',count:0}),search:()=>[],load:async()=>{throw Error('503');}}});
  failing.palette.open();await flush();
  failing.input().value='x';failing.input().dispatchEvent(new Event('input'));
  assert.match(failing.status().textContent,/无法|失败/,'an error is not an empty result');
  const retry=failing.options().find(option=>option.textContent.includes('重新载入'));
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
