import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fixture} from './annotation-dom-fixture.mjs';

const source=await readFile(new URL('../app/reader.js',import.meta.url),'utf8');
const start=source.indexOf("let passagePointerType='';");
const end=source.indexOf('\nfunction captureExcerpt(',start);

async function readerClick() {
 const {document}=fixture('<body><main id="chapter-text"><div class="passage" data-id="p1"><p data-reading-layer="original">A sentence to read.</p></div></main><div id="paragraph-tools" hidden></div></body>');
 const effects=[];
 const scope={document,getSelection:()=>({toString:()=>''}),selectedExcerpt:null,$:id=>document.getElementById(id),choosePassage:(...args)=>effects.push(args),dismissTools(){},closePanel(){},listen:(node,name,handler)=>node.addEventListener(name,handler)};
 new Function(...Object.keys(scope),source.slice(start,end))(...Object.values(scope));
 const target=document.querySelector('p');
 const click=(patch={})=>{const event=new Event('click',{cancelable:true});Object.defineProperty(event,'target',{value:target});Object.assign(event,{button:0,detail:1,clientY:180,...patch});document.dispatchEvent(event);return event;};
 const input=(type,patch={})=>{const event=new Event(type);Object.assign(event,patch);document.dispatchEvent(event);};
 return {input,effects,click};
}

test('an actual touch click on reader prose does not select a passage or consume native input',async()=>{
 const f=await readerClick();
 assert.equal(f.click({pointerType:'touch'}).defaultPrevented,false);
 assert.deepEqual(f.effects,[]);
});

test('legacy touch clicks stay quiet, while a later physical mouse can activate the passage',async()=>{
 const f=await readerClick();
 f.input('touchstart');f.click();assert.deepEqual(f.effects,[]);
 f.input('pointerdown',{pointerType:'mouse'});f.click();assert.deepEqual(f.effects,[['p1',180,'','en']]);
});

test('WebKit touch release followed by a mouse-typed compatibility click stays quiet',async()=>{
 const f=await readerClick();
 f.input('pointerdown',{pointerType:'touch',pointerId:0});f.input('touchstart');
 f.input('pointerup',{pointerType:'touch',pointerId:0});
 f.click({pointerType:'mouse',pointerId:1});assert.deepEqual(f.effects,[]);
 f.input('pointerdown',{pointerType:'mouse',pointerId:1});f.click({pointerType:'mouse',pointerId:1});
 assert.deepEqual(f.effects,[['p1',180,'','en']]);
});

test('touch-capable hardware still permits explicit mouse and keyboard activation',async()=>{
 const f=await readerClick();
 f.click({pointerType:'mouse'});f.click({detail:0});
 assert.deepEqual(f.effects,[['p1',180,'','en'],['p1',180,'','en']]);
});

test('a compatibility click explicitly attributed to touch never activates prose',async()=>{
 const f=await readerClick();f.click({sourceCapabilities:{firesTouchEvents:true}});assert.deepEqual(f.effects,[]);
});

test('touch release does not reopen an old quote; native selection changes and mouse release still capture',t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const {document}=fixture('<body><main id="chapter-text"><p>Native selected text</p></main></body>');
 const anchorNode=document.querySelector('p').childNodes[0],captured=[];
 let text='old quote';
 const scope={document,book:{},getSelection:()=>({anchorNode,toString:()=>text}),$:id=>document.getElementById(id),captureExcerpt:y=>captured.push({text,y}),clearTimeout,setTimeout,listen:(node,name,handler)=>node.addEventListener(name,handler)};
 const releaseStart=source.indexOf("listen(document,'pointerup',e=>");
 const releaseEnd=source.indexOf('\n// Reading intent',releaseStart);
 new Function(...Object.keys(scope),'let excerptTimer;'+source.slice(releaseStart,releaseEnd))(...Object.values(scope));
 const release=pointerType=>{const event=new Event('pointerup');Object.defineProperty(event,'target',{value:document.querySelector('p')});Object.assign(event,{pointerType,button:0,clientY:180});document.dispatchEvent(event);};
 release('touch');assert.deepEqual(captured,[]);
 text='new native quote';document.dispatchEvent(new Event('selectionchange'));t.mock.timers.tick(120);
 assert.deepEqual(captured,[{text:'new native quote',y:undefined}]);
 text='expanded native quote';document.dispatchEvent(new Event('selectionchange'));t.mock.timers.tick(120);
 assert.deepEqual(captured.at(-1),{text:'expanded native quote',y:undefined});
 text='';document.dispatchEvent(new Event('selectionchange'));t.mock.timers.tick(120);assert.equal(captured.length,2);
 text='mouse quote';release('mouse');assert.deepEqual(captured.at(-1),{text:'mouse quote',y:180});
});
