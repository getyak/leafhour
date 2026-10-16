import test from 'node:test';
import assert from 'node:assert/strict';
import {applySourceLineation} from '../app/passage-layers.mjs';
import {mountReaderHighlights,textRange} from '../app/reader-highlights.mjs';

function dom(){
  class Node{
    constructor(tagName='',text=''){this.tagName=tagName;this.value=text;this.children=[];this.dataset={};this.ownerDocument=document;}
    get textContent(){return this.tagName==='#text'?this.value:this.children.map(n=>n.textContent).join('');}
    set textContent(text){this.children=[new Node('#text',text)];}
    append(...nodes){for(const node of nodes)this.children.push(...(node.tagName==='#fragment'?node.children:[node]));}
    replaceChildren(...nodes){this.children=[];this.append(...nodes);}
    addEventListener(){}
  }
  const elements=new Map(),document={createTextNode:text=>new Node('#text',text),createElement:tag=>new Node(tag),createDocumentFragment:()=>new Node('#fragment'),getElementById:id=>elements.get(id),addEventListener(){},createTreeWalker(node){const texts=[];function walk(n){if(n.tagName==='#text')texts.push(n);else n.children.forEach(walk);}walk(node);return {nextNode:()=>texts.shift()};},createRange(){return {setStart(node,offset){this.startContainer=node;this.startOffset=offset;},setEnd(node,offset){this.endContainer=node;this.endOffset=offset;}};}};
  for(const id of ['chapter-text','show-highlight','highlight-status'])elements.set(id,new Node('div'));
  return {document,Node};
}
const descendants=node=>node.children.flatMap(child=>[child,...descendants(child)]);

test('initial paint, overlapping highlights across verse lines, and removal preserve source lineation and quote offsets',()=>{
  const {document}=dom(),prose=document.createElement('p'),original='First line. Second line. Third line.';
  prose.textContent=original;prose.dataset.readingLayer='original';applySourceLineation(prose,[11,24],document);
  let records={highlights:[]};
  const {paint}=mountReaderHighlights({document,getRecords:()=>records});
  const check=()=>{assert.equal(prose.textContent,original);assert.equal(descendants(prose).filter(n=>n.tagName==='br').length,2);};
  paint(prose,'p1');check();
  records={highlights:[{id:'one',parts:[{passageId:'p1',language:'en',start:6,end:30,text:original.slice(6,30)}]},{id:'two',parts:[{passageId:'p1',language:'en',start:11,end:24,text:original.slice(11,24)}]}]};
  paint(prose,'p1');check();assert.equal(descendants(prose).filter(n=>n.tagName==='mark').length,3);
  const range=textRange(document,prose,9,26);assert.equal(range.startContainer.textContent.slice(range.startOffset),'e.');assert.equal(range.endContainer.textContent.slice(0,range.endOffset),' T');
  records={highlights:[]};paint(prose,'p1');check();assert.equal(descendants(prose).filter(n=>n.tagName==='mark').length,0);
  paint(prose,'p1');check();
});
