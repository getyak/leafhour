import test from 'node:test';
import assert from 'node:assert/strict';
import {mountSaveFeedback} from '../app/settings-save-feedback.mjs';
import {createUiMessage} from '../app/ui-locale.mjs';

class Element extends EventTarget {
 constructor(tag){super();this.tagName=tag;this.children=[];this.attributes={};this.dataset={};this.hidden=false;this.textContent='';this.className='';this.classList={toggle(){}};}
 append(...nodes){for(const n of nodes){if(n.parentElement)n.parentElement.children=n.parentElement.children.filter(x=>x!==n);n.parentElement=this;this.children.push(n);}}
 setAttribute(k,v){this.attributes[k]=String(v);}getAttribute(k){return this.attributes[k]??null;}
}
function clock(){let now=0,next=1;const tasks=new Map(),callbacks=[];return {callbacks,setTimeout(fn,ms){const id=next++;tasks.set(id,{at:now+ms,fn});callbacks.push(fn);return id;},clearTimeout(id){tasks.delete(id);},advance(ms){const end=now+ms;for(;;){const pair=[...tasks].sort((a,b)=>a[1].at-b[1].at).find(([,task])=>task.at<=end);if(!pair)break;tasks.delete(pair[0]);now=pair[1].at;pair[1].fn();}now=end;},count:()=>tasks.size};}
function fixture(){const timers=clock(),status=new Element('p'),retry=new Element('button'),recover=new Element('button');status.id='habits-status';retry.hidden=recover.hidden=true;let owner='synthetic-a',locale='en',ownerReads=0;const ui=mountSaveFeedback({document:{createElement:tag=>new Element(tag)},status,retry,recover,getOwner:()=>{ownerReads++;return owner;},timers,createMessage:render=>createUiMessage(render,id=>locale+':'+id)});return {ui,status,retry,recover,timers,setOwner:value=>{owner=value;},setLocale:value=>{locale=value;},ownerReads:()=>ownerReads};}

test('the feedback retains original live status and recovery nodes without inventing actions',()=>{
 const f=fixture();assert.deepEqual(f.ui.root.children,[f.status,f.retry,f.recover]);assert.equal(f.ui.root.hidden,true);let retries=0;f.retry.addEventListener('click',()=>retries++);
 f.ui.set('prefs.saving');assert.equal(f.ui.root.hidden,false);assert.equal(f.status.textContent,'en:prefs.saving');assert.equal(f.status.getAttribute('role'),'status');
 f.retry.hidden=false;f.ui.set('prefs.saveFailed',null,true);assert.equal(f.status.getAttribute('role'),'alert');assert.equal(f.status.getAttribute('aria-live'),'assertive');f.ui.refresh();f.ui.sync();assert.equal(retries,0);
 f.retry.dispatchEvent(new Event('click'));assert.equal(retries,1);f.ui.clear();f.retry.hidden=true;f.ui.sync();assert.equal(f.ui.root.hidden,true);
});

test('success stays for1500ms and completes its160ms fade without hiding a new message',()=>{
 const f=fixture();f.ui.set('prefs.saved');f.timers.advance(1499);assert.equal(f.status.textContent,'en:prefs.saved');assert.equal(f.ui.root.hidden,false);f.timers.advance(1);assert.equal(f.ui.root.hidden,false);f.timers.advance(159);assert.equal(f.status.textContent,'en:prefs.saved');f.timers.advance(1);assert.equal(f.status.textContent,'');assert.equal(f.ui.root.hidden,true);
});

test('a stale success fade can never erase a newer persistent error',()=>{
 const f=fixture();f.ui.set('prefs.saved');f.timers.advance(1500);const stale=f.timers.callbacks.at(-1);f.retry.hidden=false;f.ui.set('prefs.conflict',null,true);stale();f.timers.advance(10000);assert.equal(f.status.textContent,'en:prefs.conflict');assert.equal(f.status.getAttribute('role'),'alert');assert.equal(f.ui.root.hidden,false);
});

test('owner change and disposal invalidate pending presentation callbacks',()=>{
 const f=fixture();f.ui.set('prefs.saved');const old=f.timers.callbacks[0];f.setOwner('synthetic-b');f.ui.clear();f.ui.set('prefs.saveFailed',null,true);old();assert.equal(f.status.textContent,'en:prefs.saveFailed');f.ui.set('prefs.saved');const late=f.timers.callbacks.at(-1);f.ui.dispose();const snapshot=f.status.textContent;late();f.ui.set('prefs.conflict',null,true);assert.equal(f.status.textContent,snapshot);assert.equal(f.timers.count(),0);assert.equal(f.ui.root.hidden,true);
});

test('locale refresh relabels the current status without restarting its lifetime or reading the owner',()=>{
 const f=fixture();f.ui.set('prefs.saved');f.timers.advance(1000);const before=f.ownerReads();f.setLocale('ja');f.ui.refresh();assert.equal(f.status.textContent,'ja:prefs.saved');assert.equal(f.ownerReads(),before);f.timers.advance(660);assert.equal(f.ui.root.hidden,true);
});
