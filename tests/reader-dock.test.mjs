import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fixture} from './annotation-dom-fixture.mjs';

test('the source reader has a persistent settings dock independent of the sleeping tools',async()=>{
 const {document}=fixture(await readFile(new URL('../app/index.html',import.meta.url),'utf8'));
 const dock=document.getElementById('reader-dock');assert.ok(dock,'the real reader needs the persistent dock');
 assert.equal(document.getElementById('reading-session').contains(dock),false);
 const settings=document.getElementById('reader-dock-settings');assert.ok(dock.contains(settings));assert.equal(settings.getAttribute('aria-controls'),'settings-dialog');
});

test('the dock uses existing settings and chat, and disposal restores the original chat host',async t=>{
 const {mountReaderDock}=await import('../app/reader-dock.mjs');
 const {document,win}=fixture(await readFile(new URL('../app/index.html',import.meta.url),'utf8'));
 const host=document.getElementById('reading-tools-chat-slot'),original=host.parentElement,trigger=document.createElement('button');trigger.className='library-chat-trigger';host.append(trigger);
 let opened=0,disposed=0,laidOut=0,config;
 const dock=mountReaderDock({document,window:win,onSettings:()=>opened++,onLayout:()=>laidOut++,mountPosition:options=>{config=options;return {layout(){laidOut++;},dispose(){disposed++;},updateLabels(){}};}});
 assert.ok(document.getElementById('reader-dock').contains(host));assert.equal(config.handle,trigger);assert.equal(config.storageKey,'marginalia:reader-dock-position:v1');
 document.getElementById('reader-dock-settings').dispatchEvent(new Event('click'));assert.equal(opened,1);
 const beforeMotion=laidOut,page=document.getElementById('book-page');
 page.dispatchEvent(Object.assign(new Event('transitionrun'),{propertyName:'transform'}));win.flushFrames();assert.ok(laidOut>beforeMotion,'moving text must trigger placement before the animation completes');
 const duringMotion=laidOut;win.flushFrames();assert.ok(laidOut>duringMotion,'placement continues while the text is moving');
 page.dispatchEvent(Object.assign(new Event('transitionend'),{propertyName:'transform'}));win.flushFrames();
 dock.unmount();assert.equal(host.parentElement,original);assert.equal(disposed,1);
 document.getElementById('reader-dock-settings').dispatchEvent(new Event('click'));assert.equal(opened,1,'disposed dock cannot reopen settings');
});
