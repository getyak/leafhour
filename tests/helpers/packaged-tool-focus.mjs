import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import {fixture} from '../annotation-dom-fixture.mjs';

// Execute the actual compiled entry and raw optional hub through browser URL
// resolution. A shared URL has one module instance, as it does in a document.
const [root,out,entry]=process.argv.slice(2),origin='https://packaged.leafhour.invalid';
const {document,win}=fixture('<body><header id="reading-header"><button id="header-target"></button></header><section id="reading-session" data-expanded="true"><button id="reading-tools-trigger"></button><div id="reading-tools-panel"></div></section><button id="open-toc"></button></body>');
const frames=new Map(),timers=new Map();let sequence=0;
win.requestAnimationFrame=fn=>{frames.set(++sequence,fn);return sequence;};win.cancelAnimationFrame=id=>frames.delete(id);
win.setTimeout=fn=>{timers.set(++sequence,fn);return sequence;};win.clearTimeout=id=>timers.delete(id);
win.getComputedStyle=()=>({display:'block',visibility:'visible',opacity:'1'});
const context=vm.createContext({document,window:win,console,Event,setTimeout,clearTimeout,queueMicrotask});
const modules=new Map();
async function load(url){
 if(modules.has(url))return modules.get(url);
 let module;
 if(new URL(url).pathname==='/ui-locale.mjs')module=new vm.SyntheticModule(['t','onUiLocaleChange'],function(){this.setExport('t',id=>id);this.setExport('onUiLocaleChange',()=>()=>{});},{context,identifier:url});
 else{
  const pathname=new URL(url).pathname.slice(1),file=pathname===entry?path.join(out,entry):path.join(root,'app',pathname);
  module=new vm.SourceTextModule(await readFile(file,'utf8'),{context,identifier:url,initializeImportMeta:meta=>{meta.url=url;}});
 }
 modules.set(url,module);return module;
}
const link=(specifier,parent)=>load(new URL(specifier,parent.identifier).href);
const core=await load(origin+'/'+entry);await core.link(link);await core.evaluate();
const hub=await load(origin+'/reading-hub.mjs');await hub.link(link);await hub.evaluate();
const pill=document.getElementById('reading-tools-trigger');pill.focus();
const adapter=hub.namespace.mountReadingHub({document,panel:document.getElementById('reading-tools-panel'),toolbar:{reveal(){},conceal(){}}});
context.coreFocus.handoff({document,target:()=>document.getElementById('header-target'),blocked:()=>false});
const click=new Event('click');Object.defineProperty(click,'detail',{value:0});pill.dispatchEvent(click);await Promise.resolve();
assert.equal(frames.size,1,'the raw hub must supersede the compiled header request through the same owner');
assert.equal(timers.size,1,'one bounded deadline belongs to that shared owner');
context.coreFocus.cancel(document);
assert.equal(frames.size,0,'the compiled toolbar cancels the raw hub request');assert.equal(timers.size,0);
const owner=modules.get(origin+'/reading-tool-focus.mjs');assert.ok(owner,'one canonical helper URL is loaded');
assert.equal(context.coreFocus.handoff,owner.namespace.handoffReadingToolFocus);
adapter.unmount();
console.log(JSON.stringify({sharedOwnerUrl:owner.identifier,loadedUrls:[...modules.keys()],frames:frames.size,timers:timers.size}));
