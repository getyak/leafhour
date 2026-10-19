import test from 'node:test';
import assert from 'node:assert/strict';

class Element extends EventTarget{
  constructor(tag,id){super();this.tagName=tag;this.id=id;this.isConnected=true;this.children=[];this.attributes={};this.dataset={};this.value='';this.textContent='';this.className='';this.classList={toggle(){},add(){},remove(){}};}
  append(...nodes){for(const node of nodes){if(node.parentElement)node.parentElement.children=node.parentElement.children.filter(child=>child!==node);node.parentElement=this;this.children.push(node);}}
  replaceChildren(...nodes){this.children=[];this.append(...nodes);}
  insertBefore(node,before){this.append(node);this.children=this.children.filter(child=>child!==node);this.children.splice(this.children.indexOf(before),0,node);}
  insertAdjacentElement(position,node){assert.equal(position,'afterend');const siblings=this.parentElement.children;node.parentElement=this.parentElement;siblings.splice(siblings.indexOf(this)+1,0,node);}
  setAttribute(key,value){this.attributes[key]=String(value);}getAttribute(key){return this.attributes[key];}hasAttribute(key){return key in this.attributes;}
  querySelectorAll(selector){const all=this.children.flatMap(child=>[child,...child.querySelectorAll(selector)]);return all.filter(child=>selector==='input'?child.tagName==='input':selector==='[data-icon]'?!!child.dataset.icon:selector==='button[data-hint]'?child.tagName==='button'&&!!child.dataset.hint:false);}
  contains(node){return node===this||this.children.some(child=>child.contains(node));}
  focus(){document.activeElement=this;}
  showModal(){this.open=true;}close(){this.open=false;this.dispatchEvent(new Event('close'));}
}
function fixture(user){
  const doc=new EventTarget(),body=new Element('body'),nodes=new Map();doc.body=body;doc.documentElement=new Element('html');doc.createElement=tag=>new Element(tag);doc.createTextNode=text=>{const n=new Element('#text');n.textContent=text;return n;};doc.querySelectorAll=()=>[];
  const add=(id,parent=body)=>{const node=new Element('button',id);nodes.set(id,node);parent.append(node);return node;};
  const header=add('library-sidebar'),footer=new Element('div');header.append(footer);add('library-settings',footer);
  for(const id of ['sidebar-toggle','sidebar-search-open','library-calendar','library-chat-open','book-search'])add(id,header);
  for(const id of ['library-nav-dialog','library-settings-dialog','library-menu','main'])add(id);
  const seek=(root,id)=>root.id===id?root:root.children.map(child=>seek(child,id)).find(Boolean);
  doc.getElementById=id=>nodes.get(id)||seek(body,id);globalThis.document=doc;globalThis.window={addEventListener(){}};globalThis.CustomEvent=class extends Event{constructor(type,options){super(type);this.detail=options?.detail;}};
  const media=new EventTarget();media.matches=false;globalThis.matchMedia=()=>media;globalThis.localStorage={getItem:()=>null,setItem(){}};
  let session={user},logins=0;return {doc,nodes,footer,media,get:id=>doc.getElementById(id),getSession:()=>session,openAuth:()=>logins++,counts:()=>({logins}),switch(user){session={user};}};
}

test('sidebar account shows the real identity beneath settings and opens editable account settings',async()=>{
  const f=fixture({id:'a',displayName:'林读者',email:'lin@example.com',avatarUrl:'https://example.com/me.png'}),{mountLibraryShell}=await import('../app/library-shell.mjs');
  const shell=mountLibraryShell({getSession:f.getSession,openAuth:f.openAuth,onLogout:async()=>{},onHistory(){},onOpenChat(){},api:async()=>({})});
  const button=f.get('library-account');assert.ok(button,'the sidebar must include a personal account button');assert.equal(f.footer.children.indexOf(button),f.footer.children.indexOf(f.get('library-settings'))+1);
  assert.match(button.getAttribute('aria-label'),/林读者/);assert.match(button.getAttribute('aria-label'),/Account/);
  const texts=button.children.flatMap(child=>[child.textContent,...child.children.map(n=>n.textContent)]).join(' ');assert.match(texts,/林读者/);assert.match(texts,/lin@example.com/);
  button.dispatchEvent(new Event('click'));assert.equal(f.get('library-settings-dialog').open,true);assert.equal(f.get('profile-email').value,'lin@example.com');assert.equal(f.get('profile-email').readOnly,true);
  f.get('sidebar-toggle').dispatchEvent(new Event('click'));assert.equal(f.doc.body.dataset.sidebarCollapsed,'true');assert.match(button.dataset.hint,/林读者/);
  f.switch(null);shell.update();assert.match(button.getAttribute('aria-label'),/Sign in/);button.dispatchEvent(new Event('click'));assert.equal(f.counts().logins,1);
});

test('a failed logout restores its retry target without taking focus from another control',async()=>{
  const f=fixture({id:'a',displayName:'Reader',email:'reader@example.invalid'}),{mountLibraryShell}=await import('../app/library-shell.mjs');
  let reject;
  mountLibraryShell({getSession:f.getSession,openAuth:f.openAuth,onLogout:()=>new Promise((_,no)=>{reject=no;}),onHistory(){},onOpenChat(){},api:async()=>({})});
  f.get('library-account').dispatchEvent(new Event('click'));
  const all=root=>[root,...root.children.flatMap(all)],logout=all(f.get('library-settings-dialog')).find(node=>node.textContent==='Sign out');
  logout.focus();logout.dispatchEvent(new Event('click'));f.doc.activeElement=f.doc.body;
  reject(Error('暂未退出'));await new Promise(setImmediate);
  assert.equal(logout.disabled,false);assert.equal(f.doc.activeElement===logout,true);
  logout.dispatchEvent(new Event('click'));const name=f.get('profile-display-name');name.focus();
  reject(Error('仍未退出'));await new Promise(setImmediate);
  assert.equal(f.doc.activeElement===name,true);
});

test('direct data settings entry returns keyboard focus to settings instead of an unfocusable body',async()=>{
 const f=fixture({id:'a',email:'reader@example.invalid'}),{mountLibraryShell}=await import('../app/library-shell.mjs');f.doc.activeElement=f.doc.body;
 const shell=mountLibraryShell({getSession:f.getSession,openAuth:f.openAuth,onLogout:async()=>{},onHistory(){},onOpenChat(){},api:async()=>({})});shell.openSettings('data');f.get('library-settings-dialog').close();assert.equal(f.doc.activeElement,f.get('library-settings'));
});

test('shell account labels use a cached account during locale changes without reading the session',async()=>{
 const {requestUiRoute}=await import('../app/ui-locale.mjs');await requestUiRoute('en');const f=fixture({id:'a',displayName:'阅读',email:'literal@example.invalid'}),{mountLibraryShell}=await import('../app/library-shell.mjs');let reads=0;
 const shell=mountLibraryShell({getSession(){reads++;return f.getSession();},openAuth:f.openAuth,onLogout:async()=>{},onHistory(){},onOpenChat(){},api:async()=>({})});await Promise.resolve();const before=reads;
 for(const code of ['ja','zh-Hant','zh-Hans','en']){await requestUiRoute(code);assert.equal(reads,before);shell.updateLabels();assert.equal(reads,before);}
});

test('sidebar locale refresh uses the last real sidebar state without replaying layout or session work',async()=>{
 const {requestUiRoute,t}=await import('../app/ui-locale.mjs');await requestUiRoute('en');
 const f=fixture({id:'sidebar-locale',email:'literal@example.invalid'}),{mountLibraryShell}=await import('../app/library-shell.mjs');let reads=0,calls=0,mediaReads=0,expandedWrites=0;
 const shell=mountLibraryShell({getSession(){reads++;return f.getSession();},openAuth:f.openAuth,onLogout:async()=>{},onHistory(){},onOpenChat(){},api:async()=>{calls++;return {};}});await new Promise(setImmediate);
 const toggle=f.get('sidebar-toggle'),setAttribute=toggle.setAttribute.bind(toggle);toggle.setAttribute=(name,value)=>{if(name==='aria-expanded')expandedWrites++;setAttribute(name,value);};
 let compact=false;Object.defineProperty(f.media,'matches',{get(){mediaReads++;return compact;}});
 try{
  for(const state of ['expanded','collapsed','compact']){
   if(state==='collapsed')toggle.dispatchEvent(new Event('click'));
   if(state==='compact'){compact=true;f.media.dispatchEvent(new Event('change'));}
   const before={reads,calls,mediaReads,expandedWrites,collapsed:f.doc.body.dataset.sidebarCollapsed,expanded:toggle.getAttribute('aria-expanded')},focus=f.get('book-search');focus.focus();
   for(const code of ['ja','zh-Hant','zh-Hans','en']){await requestUiRoute(code);assert.equal(toggle.getAttribute('aria-label'),t(state==='compact'?'shell.sidebar.closeNav':state==='collapsed'?'shell.sidebar.expand':'shell.sidebar.collapse'));assert.equal(toggle.dataset.hint,t(state==='expanded'?'shell.sidebar.collapse':'shell.sidebar.expand'));assert.deepEqual({reads,calls,mediaReads,expandedWrites,collapsed:f.doc.body.dataset.sidebarCollapsed,expanded:toggle.getAttribute('aria-expanded')},before);assert.equal(f.doc.activeElement,focus);assert.equal(f.get('sidebar-toggle'),toggle);}
  }
 }finally{await requestUiRoute('en');}
});

test('settings privacy link follows the authored locale at creation and in place on later commits',async()=>{
 const {requestUiRoute}=await import('../app/ui-locale.mjs');await requestUiRoute('ja');const f=fixture({id:'privacy-owner'}),{mountLibraryShell}=await import('../app/library-shell.mjs');
 mountLibraryShell({getSession:f.getSession,openAuth:f.openAuth,onLogout:async()=>{},onHistory(){},onOpenChat(){},api:async()=>({})});
 const all=root=>[root,...root.children.flatMap(all)],privacy=all(f.get('library-settings-dialog')).find(n=>n.tagName==='a'&&n.href!=='https://github.com/getyak/leafhour');
 try{assert.equal(privacy.href,'/ja/privacy');for(const [code,path]of [['zh-Hant','/zh-hant/privacy'],['zh-Hans','/zh-hans/privacy'],['en','/privacy'],['ja','/ja/privacy']]){await requestUiRoute(code);assert.equal(privacy.href,path);assert.equal(all(f.get('library-settings-dialog')).includes(privacy),true);}}
 finally{await requestUiRoute('en');}
});

for(const outcome of ['failure','success'])test('retained logout '+outcome+' relabels in place without replaying logout or account updates',async()=>{
 const {requestUiRoute,t}=await import('../app/ui-locale.mjs');await requestUiRoute('en');const f=fixture({id:'logout-locale',email:'literal@example.invalid'}),{mountLibraryShell}=await import('../app/library-shell.mjs');let finish,logouts=0,reads=0,calls=0;
 const shell=mountLibraryShell({getSession(){reads++;return f.getSession();},openAuth:f.openAuth,onLogout:()=>{logouts++;return new Promise((resolve,reject)=>{finish=()=>{if(outcome==='success'){f.switch(null);resolve();}else reject(Error('opaque remote failure'));};});},onHistory(){},onOpenChat(){},api:async()=>{calls++;return {};}});shell.openSettings('account');await new Promise(setImmediate);
 const all=root=>[root,...root.children.flatMap(all)],logout=all(f.get('library-settings-dialog')).find(n=>n.textContent===t('shell.account.logout')),status=all(f.get('library-settings-dialog')).find(n=>n.className==='settings-status');logout.focus();logout.dispatchEvent(new Event('click'));
 try{const pending={reads,calls};await requestUiRoute('ja');assert.equal(logout.disabled,true);assert.equal(logout.textContent,t('shell.account.loggingOut'));assert.equal(f.doc.activeElement,logout);assert.deepEqual({reads,calls},pending);assert.equal(logouts,1);finish();await new Promise(setImmediate);assert.equal(status.textContent,t(outcome==='success'?'shell.account.loggedOut':'ui.generic.error'));
  const before={reads,calls},focus=f.doc.activeElement;for(const code of ['zh-Hant','zh-Hans','en','ja']){await requestUiRoute(code);assert.equal(status.textContent,t(outcome==='success'?'shell.account.loggedOut':'ui.generic.error'));assert.equal(all(f.get('library-settings-dialog')).includes(status),true);assert.equal(f.doc.activeElement,focus);assert.equal(logout.disabled,false);assert.equal(logouts,1);assert.deepEqual({reads,calls},before);}
  f.switch({id:'next-owner'});shell.update();assert.equal(status.textContent,'');await requestUiRoute('en');assert.equal(status.textContent,'');
 }finally{await requestUiRoute('en');}
});
