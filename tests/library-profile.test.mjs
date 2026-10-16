import test from 'node:test';
import assert from 'node:assert/strict';

const profileModule=await import('../app/library-profile.mjs').catch(()=>({}));
class Element extends EventTarget{
  constructor(tag){super();this.tagName=tag.toUpperCase();this.children=[];this.attributes={};this.dataset={};this.className='';this.textContent='';this.value='';this.hidden=false;this.disabled=false;this.classList={add:()=>{},remove:()=>{},toggle:()=>{}};}
  append(...children){for(const child of children){child.parentElement=this;this.children.push(child);}}
  replaceChildren(...children){this.children=[];this.append(...children);}
  setAttribute(key,value){this.attributes[key]=String(value);}
  removeAttribute(key){delete this.attributes[key];}
  getAttribute(key){return this.attributes[key];}
  focus(){}
}
const documentFixture=Object.assign(new EventTarget(),{body:{},createElement:tag=>new Element(tag)});
function find(node,id){if(node.id===id)return node;return node.children.map(child=>find(child,id)).find(Boolean);}
const tick=()=>new Promise(setImmediate);
function mount({api=async()=>({displayName:'New'}),onProfileUpdated=()=>{}}={}){
  assert.equal(typeof profileModule.mountLibraryProfile,'function','profile editor must be mounted with owner-aware save behavior');
  globalThis.document=documentFixture;
  let session={user:{id:'a',email:'reader@example.com',displayName:'Reader',avatarUrl:null}};
  const root=new Element('section'),controller=profileModule.mountLibraryProfile({root,api,getSession:()=>session,onProfileUpdated});
  return {root,controller,get:id=>find(root,id),session:()=>session,switch(next){session=next;controller.update();}};
}

test('avatar initials support Chinese names, email-only accounts and the guest state',()=>{
  assert.equal(typeof profileModule.profileInitials,'function');
  assert.equal(profileModule.profileInitials({displayName:'熊新伟'}),'熊');
  assert.equal(profileModule.profileInitials({displayName:'Lin Reader'}),'LR');
  assert.equal(profileModule.profileInitials({email:'reader@example.com'}),'R');
  assert.equal(profileModule.profileInitials(null),'访');
});
test('avatars use no-referrer images and return to initials when loading fails',()=>{
  assert.equal(typeof profileModule.renderProfileAvatar,'function');globalThis.document=documentFixture;
  const holder=new Element('span');profileModule.renderProfileAvatar(holder,{displayName:'Reader',avatarUrl:'https://example.com/me.jpg'});
  const image=holder.children.find(n=>n.tagName==='IMG');assert.ok(image);assert.equal(image.referrerPolicy,'no-referrer');assert.equal(image.alt,'');
  image.dispatchEvent(new Event('error'));assert.equal(holder.textContent,'R');assert.equal(holder.children.length,0);
  profileModule.renderProfileAvatar(holder,{displayName:'Reader',avatarUrl:'javascript:alert(1)'});assert.equal(holder.children.length,0);assert.equal(holder.textContent,'R');
});
test('the account editor keeps identity read-only and only saves after explicit submission',async()=>{
  const calls=[];let saved;const f=mount({api:async(path,body)=>{calls.push({path,body});return {displayName:body.displayName,avatarUrl:null};},onProfileUpdated:value=>{saved=value;}});
  assert.equal(f.get('profile-email').value,'reader@example.com');assert.equal(f.get('profile-email').readOnly,true);
  f.get('profile-display-name').value='新的称呼';f.get('profile-display-name').dispatchEvent(new Event('input'));assert.equal(calls.length,0);
  f.get('account-profile-form').dispatchEvent(new Event('submit',{cancelable:true}));await tick();
  assert.deepEqual(calls,[{path:'/api/account/profile',body:{displayName:'新的称呼'}}]);assert.equal(saved.displayName,'新的称呼');assert.match(f.get('profile-status').textContent,/已保存/);
});
test('a pending profile save cannot update a different owner or render a stale failure',async()=>{
  let resolve,reject,updates=0;const promise=new Promise((ok,no)=>{resolve=ok;reject=no;}),f=mount({api:()=>promise,onProfileUpdated:()=>updates++});
  f.get('profile-display-name').value='Private Name';f.get('account-profile-form').dispatchEvent(new Event('submit',{cancelable:true}));
  assert.equal(f.get('profile-save').disabled,true);f.switch({user:{id:'b',email:'other@example.com',displayName:'Other'}});
  resolve({displayName:'Private Name',avatarUrl:null});await tick();assert.equal(updates,0);assert.equal(f.get('profile-display-name').value,'Other');assert.equal(f.get('profile-status').textContent,'');
  const g=mount({api:()=>new Promise((ok,no)=>{reject=no;}),onProfileUpdated:()=>updates++});g.get('account-profile-form').dispatchEvent(new Event('submit',{cancelable:true}));g.switch({user:null});reject(Error('private error'));await tick();
  assert.equal(g.root.children[0].hidden,true);assert.equal(g.get('profile-status').textContent,'');assert.equal(updates,0);
});
test('a replaced session for the same owner also invalidates an in-flight profile save',async()=>{
  let finish,updates=0;const f=mount({api:()=>new Promise(resolve=>{finish=resolve;}),onProfileUpdated:()=>updates++});
  f.get('account-profile-form').dispatchEvent(new Event('submit',{cancelable:true}));f.switch({user:{...f.session().user}});finish({displayName:'Old'});await tick();assert.equal(updates,0);
});
test('save errors are visible, preserve the draft and allow retry without sending twice while busy',async()=>{
  let reject,calls=0;const f=mount({api:()=>{calls++;return new Promise((ok,no)=>{reject=no;});}});f.get('profile-display-name').value='My Draft';
  f.get('account-profile-form').dispatchEvent(new Event('submit',{cancelable:true}));f.get('account-profile-form').dispatchEvent(new Event('submit',{cancelable:true}));assert.equal(calls,1);
  reject(Error('暂时无法保存'));await tick();assert.equal(f.get('profile-display-name').value,'My Draft');assert.equal(f.get('profile-save').disabled,false);assert.match(f.get('profile-status').textContent,/暂时无法保存/);
});

test('selected avatars are cropped into a bounded local preview and temporary image URLs are released',async(t)=>{
  assert.equal(typeof profileModule.prepareAvatarFile,'function');
  const oldImage=globalThis.Image,oldDocument=globalThis.document,oldCreate=URL.createObjectURL,oldRevoke=URL.revokeObjectURL,calls=[],released=[];
  t.after(()=>{globalThis.Image=oldImage;globalThis.document=oldDocument;URL.createObjectURL=oldCreate;URL.revokeObjectURL=oldRevoke;});
  URL.createObjectURL=()=> 'blob:avatar-fixture';URL.revokeObjectURL=url=>released.push(url);
  globalThis.Image=class {naturalWidth=1000;naturalHeight=500;set src(value){this.source=value;queueMicrotask(()=>this.onload());}};
  const context={fillRect(){},drawImage(...args){calls.push(args);}},canvas={getContext:()=>context,toDataURL:()=> 'data:image/jpeg;base64,/9j/2Q=='};globalThis.document={createElement:()=>canvas};
  const result=await profileModule.prepareAvatarFile({type:'image/png',size:5000});assert.match(result,/^data:image\/jpeg;base64,/);assert.equal(canvas.width,256);assert.equal(canvas.height,256);assert.deepEqual(calls[0].slice(1),[250,0,500,500,0,0,256,256]);assert.deepEqual(released,['blob:avatar-fixture']);
  await assert.rejects(profileModule.prepareAvatarFile({type:'image/svg+xml',size:10}),/JPG/);await assert.rejects(profileModule.prepareAvatarFile({type:'image/png',size:9000000}),/8 MB/);
});

test('updating an owner inside the existing session object clears the previous owner draft',()=>{
  const f=mount();f.get('profile-display-name').value='Private Draft';f.session().user={id:'b',displayName:'Next Reader',email:'next@example.com'};f.controller.update();
  assert.equal(f.get('profile-display-name').value,'Next Reader');assert.equal(f.get('profile-email').value,'next@example.com');
});
