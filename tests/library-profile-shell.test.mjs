import test from 'node:test';
import assert from 'node:assert/strict';

class Element extends EventTarget{
  constructor(tag,id){super();this.tagName=tag;this.id=id;this.children=[];this.attributes={};this.dataset={};this.value='';this.textContent='';this.className='';this.classList={toggle(){},add(){},remove(){}};}
  append(...nodes){for(const node of nodes){if(node.parentElement)node.parentElement.children=node.parentElement.children.filter(child=>child!==node);node.parentElement=this;this.children.push(node);}}
  replaceChildren(...nodes){this.children=[];this.append(...nodes);}
  insertBefore(node,before){this.append(node);this.children=this.children.filter(child=>child!==node);this.children.splice(this.children.indexOf(before),0,node);}
  insertAdjacentElement(position,node){assert.equal(position,'afterend');const siblings=this.parentElement.children;node.parentElement=this.parentElement;siblings.splice(siblings.indexOf(this)+1,0,node);}
  setAttribute(key,value){this.attributes[key]=String(value);}getAttribute(key){return this.attributes[key];}hasAttribute(key){return key in this.attributes;}
  querySelectorAll(selector){const all=this.children.flatMap(child=>[child,...child.querySelectorAll(selector)]);return all.filter(child=>selector==='input'?child.tagName==='input':selector==='[data-icon]'?!!child.dataset.icon:selector==='button[data-hint]'?child.tagName==='button'&&!!child.dataset.hint:false);}
  focus(){document.activeElement=this;}
  showModal(){this.open=true;}close(){this.open=false;this.dispatchEvent(new Event('close'));}
}
function fixture(user){
  const doc=new EventTarget(),body=new Element('body'),nodes=new Map();doc.body=body;doc.documentElement=new Element('html');doc.createElement=tag=>new Element(tag);doc.querySelectorAll=()=>[];
  const add=(id,parent=body)=>{const node=new Element('button',id);nodes.set(id,node);parent.append(node);return node;};
  const header=add('library-sidebar'),footer=new Element('div');header.append(footer);add('library-settings',footer);
  for(const id of ['sidebar-toggle','sidebar-search-open','library-calendar','library-chat-open','book-search'])add(id,header);
  for(const id of ['library-nav-dialog','library-settings-dialog','library-menu','main'])add(id);
  const seek=(root,id)=>root.id===id?root:root.children.map(child=>seek(child,id)).find(Boolean);
  doc.getElementById=id=>nodes.get(id)||seek(body,id);globalThis.document=doc;globalThis.window={addEventListener(){}};globalThis.CustomEvent=class extends Event{constructor(type,options){super(type);this.detail=options?.detail;}};
  const media=new EventTarget();media.matches=false;globalThis.matchMedia=()=>media;globalThis.localStorage={getItem:()=>null,setItem(){}};
  let session={user},logins=0;return {doc,nodes,footer,get:id=>doc.getElementById(id),getSession:()=>session,openAuth:()=>logins++,counts:()=>({logins}),switch(user){session={user};}};
}

test('sidebar account shows the real identity beneath settings and opens editable account settings',async()=>{
  const f=fixture({id:'a',displayName:'林读者',email:'lin@example.com',avatarUrl:'https://example.com/me.png'}),{mountLibraryShell}=await import('../app/library-shell.mjs');
  const shell=mountLibraryShell({getSession:f.getSession,openAuth:f.openAuth,onLogout:async()=>{},onHistory(){},onOpenChat(){},api:async()=>({})});
  const button=f.get('library-account');assert.ok(button,'the sidebar must include a personal account button');assert.equal(f.footer.children.indexOf(button),f.footer.children.indexOf(f.get('library-settings'))+1);
  assert.match(button.getAttribute('aria-label'),/林读者/);assert.match(button.getAttribute('aria-label'),/账户/);
  const texts=button.children.flatMap(child=>[child.textContent,...child.children.map(n=>n.textContent)]).join(' ');assert.match(texts,/林读者/);assert.match(texts,/lin@example.com/);
  button.dispatchEvent(new Event('click'));assert.equal(f.get('library-settings-dialog').open,true);assert.equal(f.get('profile-email').value,'lin@example.com');assert.equal(f.get('profile-email').readOnly,true);
  f.get('sidebar-toggle').dispatchEvent(new Event('click'));assert.equal(f.doc.body.dataset.sidebarCollapsed,'true');assert.match(button.dataset.hint,/林读者/);
  f.switch(null);shell.update();assert.match(button.getAttribute('aria-label'),/登录/);button.dispatchEvent(new Event('click'));assert.equal(f.counts().logins,1);
});
