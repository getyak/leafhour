import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parse} from 'acorn';
import {fixture} from './annotation-dom-fixture.mjs';
import {createNoteDrafts} from '../app/note-drafts.mjs';

const source=await readFile(new URL('../app/reader.js',import.meta.url),'utf8'),tree=parse(source,{ecmaVersion:'latest',sourceType:'module'});
const declaration=name=>{const node=tree.body.find(n=>n.type==='FunctionDeclaration'&&n.id.name===name);assert.ok(node,name);return source.slice(node.start,node.end);};
// Listener bodies may span lines as the reader adds scoped receipt handling.
// Extract the real parsed statement rather than truncating it at a newline.
const readerListener=name=>{const node=tree.body.find(n=>n.type==='ExpressionStatement'&&n.expression.type==='CallExpression'&&n.expression.callee.name==='listen'&&n.expression.arguments[0]?.name==='document'&&n.expression.arguments[1]?.value===name);assert.ok(node,name);return source.slice(node.start,node.end);};
function setup({width=1400}={}){
 const f=fixture('<body><main id="chapter-text"><div class="passage" data-id="p1" id="p1"><p>First passage.</p></div><div class="passage" data-id="p2" id="p2"><p>Second passage.</p></div></main><aside id="note-panel"><h2 id="panel-title"></h2><span id="panel-anchor"></span><nav class="panel-tabs"><button data-panel-tab="comment"></button><button data-panel-tab="question"></button></nav><button id="panel-source"></button><div id="panel-content"></div></aside><div id="paragraph-tools" hidden></div></body>');
 const $=id=>f.document.getElementById(id),el=(tag,cls,text)=>{const n=f.document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
 let panelMoves=0;for(const node of f.document.querySelectorAll('.passage')){const after=node.after.bind(node);node.after=panel=>{panelMoves++;after(panel);};Object.defineProperty(node,'nextElementSibling',{get(){return node.parentNode.children[node.parentNode.children.indexOf(node)+1]||null;}});}
 const paragraphs=['p1','p2'].map(id=>({id,source:{},original:'Original '+id,annotationIds:[],termIds:[],translations:{}})),book={bookId:'synthetic',contentVersion:'v1',sections:[{paragraphs}]},records={comments:[],questions:[]},noteDrafts=createNoteDrafts();
 const scope={document:f.document,innerWidth:width,pagination:{active:false},$,el,pruneLabels(){},records,paragraphMap:new Map(paragraphs.map(p=>[p.id,p])),selectedId:'p1',selectedQuote:'',selectedQuoteLanguage:'en',label:(n,id)=>{n.textContent=id;},allRecords:false,panelTab:'comment',READER_UI:'reader.b1.',READER_SHELL:'reader.shell.',ownedLabels:{forget(){}},renderPanelSource(){},syncPanelTextHighlight(){},clearPanelTextHighlight(){},recordsUnavailable:false,noteDrafts,book,readerSession:{user:{id:'synthetic'}},readerEpoch:0,readerDisposed:false,persistDrafts:()=>true,fixed:(tag,cls,id)=>el(tag,cls,id),button:()=>el('button'),listenNode:(n,name,fn)=>n.addEventListener(name,fn),recordNode:record=>el('section','personal-record',record.text),draftSaveReceipt:()=>'',receiptFor:()=>{},noteSaveReceipt:()=>'',flow:null,prepareFollowingChapter(){},anchor:()=>null,fillPassage:(n,p)=>{n.textContent=p.original;},applyAppearance(){},restoreAnchor(){},positionTools(){},persist(){},dispatchReaderEvent(){},state:{mode:'en'},announceUi(){},listen:(n,name,fn)=>n.addEventListener(name,fn)};
 const highlightStart=source.indexOf('onChange:()=>{flow?.invalidatePrepared();'),highlightEnd=source.indexOf(',announce,loginUrl:',highlightStart);
 const code='let panelComposers=new WeakMap();'+declaration('mountPanel')+declaration('renderPanel')+declaration('updateText')+';'+readerListener('reader:translation')+';return {render:renderPanel,highlightChanged:()=>{'+source.slice(highlightStart+'onChange:()=>{'.length,highlightEnd-1)+'},select(id,type="comment"){selectedId=id;panelTab=type;renderPanel();}};';
 const controller=new Function(...Object.keys(scope),code)(...Object.values(scope));controller.render();
 const input=(text,composing=false)=>{const area=$('thought-text');area.value=text;area.dispatchEvent(new Event('input'));area.focus();if(composing)area.dispatchEvent(new Event('compositionstart'));return area;};
 return {...f,$,controller,input,records,noteDrafts,get panelMoves(){return panelMoves;},translation(){const event=new Event('reader:translation');Object.defineProperty(event,'detail',{value:{id:'p1',translations:{literal:{text:'译文',status:'draft'}},reveal:false}});f.document.dispatchEvent(event);}};
}

for(const background of ['translation','highlight records'])test('background '+background+' preserves the physical focused note composer',()=>{
 const f=setup(),area=f.input('Keep this unfinished thought',true);area.selectionStart=5;area.selectionEnd=9;
 f.records.comments.push({id:'other-note',passageId:'p1',text:'A confirmed separate note'});
 (background==='translation'?()=>f.translation():()=>f.controller.highlightChanged())();
 assert.ok(f.$('thought-text')===area,'background adoption must retain the physical editor, including IME state');assert.ok(area.isConnected);assert.ok(f.document.activeElement===area);assert.equal(area.value,'Keep this unfinished thought');assert.equal(area.selectionStart,5);assert.equal(area.selectionEnd,9);assert.match(f.$('panel-content').textContent,/A confirmed separate note/);
});

test('switching passage or note type replaces the composer and restores the right draft',()=>{
 const f=setup(),first=f.input('First thought');f.controller.select('p2');assert.notEqual(f.$('thought-text'),first);assert.equal(f.$('thought-text').value,'');f.input('Second thought');f.controller.select('p1');assert.equal(f.$('thought-text').value,'First thought');f.controller.select('p1','question');assert.equal(f.$('thought-text').value,'');f.input('First question');f.controller.select('p1','comment');assert.equal(f.$('thought-text').value,'First thought');
});

test('an unchanged inline note panel is not reparented during background adoption',()=>{
 const f=setup({width:900}),area=f.input('An inline unfinished thought',true),moves=f.panelMoves;f.translation();assert.equal(f.panelMoves,moves,'moving the same panel would detach its focused editor in a real browser');assert.ok(f.$('thought-text')===area);assert.ok(f.document.activeElement===area);
});
