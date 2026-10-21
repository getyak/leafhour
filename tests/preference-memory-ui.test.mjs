import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './annotation-dom-fixture.mjs';
import {initialPreferenceMemory} from '../app/preference-memory-codec.mjs';
import {mountPreferenceMemory} from '../app/preference-memory-ui.mjs';
const flush=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};
test('onboarding recommends a real book before three choices and does not repeat a started write',async t=>{
 const {document}=fixture('<body><section id="root"></section></body>'),root=document.getElementById('root');
 const session={user:{id:'alice'},preferenceMemory:{revision:0,preferences:null,memory:initialPreferenceMemory()}};let calls=[],opened=0;
 const ui=mountPreferenceMemory({root,kind:'onboarding',getSession:()=>session,getBooks:()=>[{bookId:'public-book',title:{en:'A real book'}}],open:()=>opened++,api:async(url,input)=>{calls.push(input);return {...session.preferenceMemory,revision:1};},onSaved:value=>session.preferenceMemory=value});t.after(()=>ui.dispose());
 ui.update();await flush();assert.equal(opened,1);assert.equal(calls.length,1);assert.match(root.querySelector('a').href,/public-book/);
 assert.equal(root.querySelectorAll('[data-memory-choice]').length,5);
 ui.update();await flush();assert.equal(calls.length,1,'business renders do not resend started events');
});
test('failed writes show an error and late owner responses never adopt another account preferences',async t=>{
 const {document}=fixture('<body><section id="root"></section></body>'),root=document.getElementById('root');
 let session={user:{id:'alice'},preferenceMemory:{revision:0,preferences:null,memory:initialPreferenceMemory()}},resolve,adopted=0;
 const ui=mountPreferenceMemory({root,kind:'settings',getSession:()=>session,api:()=>new Promise(r=>resolve=r),onSaved:()=>adopted++});t.after(()=>ui.dispose());
 ui.update();const select=root.querySelector('select');select.value='philosophy';select.dispatchEvent(new Event('change'));
 session={user:{id:'bob'},preferenceMemory:{revision:0,preferences:null,memory:initialPreferenceMemory()}};ui.update();resolve({revision:1,memory:initialPreferenceMemory(),preferences:null});await flush();assert.equal(adopted,0);
});

test('a late read cannot roll back a newer same-account preference save',async t=>{
 const {document}=fixture('<body><section id="root"></section></body>'),root=document.getElementById('root');let resolve,adopted=0;
 const old={revision:1,preferences:{theme:'system'},memory:initialPreferenceMemory()},session={user:{id:'alice'},preferenceMemory:old};
 const ui=mountPreferenceMemory({root,getSession:()=>session,api:()=>new Promise(r=>resolve=r),onSaved:()=>adopted++});t.after(()=>ui.dispose());ui.update();const pending=ui.refresh();
 session.preferenceMemory={...old,revision:2,preferences:{theme:'night'}};ui.update();resolve(old);await pending;
 assert.equal(adopted,0);assert.equal(root.querySelector('#memory-setting-theme').value,'night');
});

test('a read adoption callback cannot recursively start another read while refreshing',async t=>{
 const {document}=fixture('<body><section id="root"></section></body>'),root=document.getElementById('root');let calls=0;
 const view={revision:1,preferences:null,memory:initialPreferenceMemory()},session={user:{id:'alice'},preferenceMemory:view};
 const ui=mountPreferenceMemory({root,getSession:()=>session,api:async()=>{if(++calls>2)throw Error('recursive read');return view;},onSaved:()=>{void ui.refresh();}});t.after(()=>ui.dispose());ui.update();await ui.refresh();await flush();assert.equal(calls,1);
});

test('settings selection restores focus after its asynchronous save replaces controls',async t=>{
 const {document}=fixture('<body><section id="root"></section></body>'),root=document.getElementById('root');let resolve;
 const session={user:{id:'alice'},preferenceMemory:{revision:1,preferences:{theme:'system'},memory:initialPreferenceMemory()}};
 const ui=mountPreferenceMemory({root,getSession:()=>session,api:()=>new Promise(r=>resolve=r),onSaved:v=>session.preferenceMemory=v});t.after(()=>ui.dispose());ui.update();
 const select=root.querySelector('#memory-setting-theme');select.focus();select.value='night';select.dispatchEvent(new Event('change'));
 resolve({...session.preferenceMemory,revision:2,preferences:{theme:'night'}});await flush();assert.ok(document.activeElement===root.querySelector('#memory-setting-theme'),'focus returns to the saved field');
});

test('locale commits update recommendation URLs and labels without replacing editing controls',async t=>{
 const {requestUiRoute}=await import('../app/ui-locale.mjs');await requestUiRoute('en');t.after(()=>requestUiRoute('en'));
 const {document}=fixture('<body><section id="one"></section><section id="two"></section></body>'),session={user:{id:'alice'},preferenceMemory:{revision:1,preferences:null,memory:initialPreferenceMemory()}};
 session.preferenceMemory.memory.onboarding.events=[{event:'started',at:new Date().toISOString(),order:['topic','language','style']}];
 const ui=mountPreferenceMemory({root:document.getElementById('one'),kind:'onboarding',getSession:()=>session,getBooks:()=>[{bookId:'book',title:{en:'Book'}}],api:async()=>session.preferenceMemory});
 const settings=mountPreferenceMemory({root:document.getElementById('two'),getSession:()=>session,api:async()=>session.preferenceMemory});t.after(()=>{ui.dispose();settings.dispose();});ui.update();settings.update();
 const select=document.querySelector('#memory-setting-theme');await requestUiRoute('zh-Hans');assert.match(document.querySelector('a').href,/ui=zh-Hans/);assert.equal(select.getAttribute('aria-label'),'阅读纸面');assert.ok(select===document.querySelector('#memory-setting-theme'),'locale preserves the field node');
});

test('a confirmed settings save queues one required read behind an older pending read',async t=>{
 const {document}=fixture('<body><section id="root"></section></body>'),root=document.getElementById('root'),resolves=[];
 const old={revision:1,preferences:{theme:'system'},memory:initialPreferenceMemory()},session={user:{id:'alice'},readingPreferences:old,preferenceMemory:old};let calls=0;
 const ui=mountPreferenceMemory({root,getSession:()=>session,api:()=>{calls++;return new Promise(r=>resolves.push(r));},onSaved:value=>{session.preferenceMemory=value;}});t.after(()=>ui.dispose());ui.update();const first=ui.refresh();
 session.readingPreferences={...old,revision:2,preferences:{theme:'night'}};void ui.refresh({changed:true,keys:['theme']});resolves.shift()(old);await first;await flush();assert.equal(calls,2);
 resolves.shift()(session.readingPreferences);await flush();assert.equal(session.preferenceMemory.preferences.theme,'night');
});
