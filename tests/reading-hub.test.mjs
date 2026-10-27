import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './annotation-dom-fixture.mjs';
import {readFile} from 'node:fs/promises';
import {mountReadingHub} from '../app/reading-hub.mjs';

const html=await readFile(new URL('../app/index.html',import.meta.url),'utf8');
test('hub keeps the original live actions while grouping tools and secondary controls',()=>{
 const {document}=fixture(html),panel=document.getElementById('reading-tools-panel'),contents=document.getElementById('open-toc'),settings=document.getElementById('open-settings'),notes=document.getElementById('show-all-records'),chat=document.getElementById('reading-tools-chat-slot');
 let calls=0;contents.addEventListener('click',()=>calls++);
 const hub=mountReadingHub({document,panel});
 const primary=document.getElementById('reading-hub-primary'),advanced=document.getElementById('reading-hub-more');
 assert.equal(primary.contains(contents),true);assert.equal(primary.contains(settings),true);assert.equal(primary.contains(notes),true);
 assert.equal(panel.contains(chat),true,'reading conversation belongs to the same opened surface');
 for(const id of ['open-atmosphere','enter-focus','open-reader-account','manual-reading-open','reading-timer-settings','reading-guide-open'])assert.equal(advanced.contains(document.getElementById(id)),true,id);
 assert.equal(advanced.open,false,'occasional controls do not compete with the four reading actions');
 contents.dispatchEvent(new Event('click'));assert.equal(calls,1,'reparenting preserves the action owner and one listener');
 assert.equal(document.querySelectorAll('#open-toc').length,1);
 hub.unmount();assert.equal(document.getElementById('reading-header').contains(contents),true);
});
test('moving a note entry hands off after its original owner and retains focus in the opened note view',async()=>{
 const {document}=fixture(html),notes=document.getElementById('show-all-records'),panel=document.getElementById('note-panel'),events=[];
 notes.addEventListener('click',()=>{events.push('notes');panel.hidden=false;});
 const hub=mountReadingHub({document,panel:document.getElementById('reading-tools-panel'),onHandoff:()=>events.push('handoff')});
 notes.dispatchEvent(new Event('click'));await Promise.resolve();
 assert.deepEqual(events,['notes','handoff']);assert.equal(document.activeElement,document.getElementById('close-panel'));
 hub.unmount();
});
test('a hub label refresh preserves action nodes, open disclosure and focused controls',()=>{
 const {document}=fixture(html),hub=mountReadingHub({document,panel:document.getElementById('reading-tools-panel')}),notes=document.getElementById('show-all-records'),more=document.getElementById('reading-hub-more');
 more.open=true;notes.focus();hub.updateLabels();
 assert.equal(more.open,true);assert.equal(document.activeElement,notes);assert.equal(document.getElementById('show-all-records'),notes);hub.unmount();
});

// Browsers blur a focused descendant when append reparents its ancestor.
// The general fixture keeps focus, so reproduce that native condition here.
function focusLosingFixture(){
 const result=fixture(html),{document}=result;
 for(const element of document.querySelectorAll('*')){
  const remove=element.remove.bind(element);
  element.remove=function(){if(this.parentElement&&this.contains(document.activeElement))document.activeElement=document.body;remove();};
 }
 for(const id of ['reading-header','reading-session','reading-tools-panel']){const node=document.getElementById(id);node.inert=false;node.removeAttribute('inert');node.hidden=false;node.removeAttribute('hidden');}
 document.getElementById('reading-session').dataset.expanded='true';
 return result;
}
test('delayed hub mount preserves a focused existing primary action after native reparent blur',()=>{
 const {document}=focusLosingFixture(),settings=document.getElementById('open-settings');settings.focus();
 const hub=mountReadingHub({document,panel:document.getElementById('reading-tools-panel')});
 assert.ok(document.activeElement===settings,'enhancement must not reset keyboard focus to body');
 assert.equal(document.getElementById('reading-hub-primary').contains(settings),true);
 hub.unmount();assert.ok(document.activeElement===settings,'restoring the original layout preserves the same visible action');
 assert.equal(document.getElementById('reading-header').contains(settings),true);
});
test('delayed hub mount opens More before restoring its focused existing advanced action',()=>{
 const {document}=focusLosingFixture(),atmosphere=document.getElementById('open-atmosphere');atmosphere.focus();
 const hub=mountReadingHub({document,panel:document.getElementById('reading-tools-panel')});
 assert.ok(document.activeElement===atmosphere,'advanced action retains native focus');
 assert.equal(document.getElementById('reading-hub-more').open,true,'a focused action cannot be hidden inside a closed disclosure');
 hub.unmount();assert.ok(document.activeElement===atmosphere,'advanced action retains native focus');
});
test('unmount returns focus to the visible tools entry when a note action returns to a closed settings dialog',()=>{
 const {document}=focusLosingFixture(),hub=mountReadingHub({document,panel:document.getElementById('reading-tools-panel')}),notes=document.getElementById('show-all-records');notes.focus();
 hub.unmount();
 assert.ok(document.activeElement===document.getElementById('reading-tools-trigger'),'unmount returns to the visible tools entry');
});

test('optional hub styles share one same-origin request and report readiness only after load',async()=>{
 const {loadReadingHubStyles}=await import('../app/reading-hub.mjs');
 const {document}=fixture('<head></head><body></body>');
 const first=loadReadingHubStyles(document),second=loadReadingHubStyles(document);
 assert.ok(first===second,'concurrent enhancement calls share one stylesheet load');
 const links=document.querySelectorAll('link[data-reading-hub-style]');assert.equal(links.length,1);
 assert.equal(links[0].href,'/reading-hub.css');assert.equal(links[0].rel,'stylesheet');
 let ready=false;void first.then(()=>ready=true);await Promise.resolve();assert.equal(ready,false);
 links[0].dispatchEvent(new Event('load'));assert.equal(await first,true);
 assert.equal(await loadReadingHubStyles(document),true);assert.equal(document.querySelectorAll('link[data-reading-hub-style]').length,1);
});
test('optional hub stylesheet failure leaves a retryable request instead of mutating controls',async()=>{
 const {loadReadingHubStyles}=await import('../app/reading-hub.mjs');
 const {document}=fixture('<head></head><body><button id="open-settings">Aa</button></body>'),settings=document.getElementById('open-settings');
 const first=loadReadingHubStyles(document),failed=document.querySelector('link[data-reading-hub-style]');failed.dispatchEvent(new Event('error'));
 assert.equal(await first,false);assert.equal(document.querySelector('link[data-reading-hub-style]'),null);
 assert.ok(settings.parentElement===document.body,'styles alone never reparent existing controls');
 const retry=loadReadingHubStyles(document),next=document.querySelector('link[data-reading-hub-style]');assert.ok(next!==failed);next.dispatchEvent(new Event('load'));assert.equal(await retry,true);
});
