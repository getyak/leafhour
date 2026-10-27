import test from 'node:test';import assert from 'node:assert/strict';
import {passagePresentation,visibleQuoteLanguage,sourcePresentationNodes,quotePanelSourceNodes} from '../app/passage-layers.mjs';
import {sourceEmphasisEligible} from '../app/source-emphasis.mjs';
const passage={id:'p1',original:'The original words stay unchanged.',translations:{}};
test('source language metadata is retained instead of labelling every non-Chinese book English',()=>{
  assert.equal(passagePresentation({...passage,original:'Un texte original.'},{mode:'en',sourceLanguage:'fr'}).layers[0].lang,'fr');
});
test('a source heading remains an original label rather than an untranslated prose warning',()=>{
  const view=passagePresentation({...passage,kind:'source_heading'},{mode:'zh'});assert.equal(view.layers[0].kind,'original');assert.equal(view.notice,null);
});
test('an explicit DOM selection keeps its actual layer despite an original-view override',()=>{
  const p={...passage,translations:{interpretive:{text:'独立意译。'}}};assert.equal(visibleQuoteLanguage(p,{mode:'en',variant:'interpretive'},'zh'),'zh');assert.equal(visibleQuoteLanguage(p,{mode:'parallel',variant:'interpretive'},'en'),'en');assert.equal(visibleQuoteLanguage(p,{mode:'parallel',variant:'interpretive'}),'zh');
});
test('an unrevealed parallel translation is never the default quotation for notes or listening',()=>{
  const p={...passage,translations:{interpretive:{text:'尚未揭晓的意译。'}}};
  assert.equal(visibleQuoteLanguage(p,{mode:'parallel',variant:'interpretive',translationHidden:true}),'en');
  assert.equal(visibleQuoteLanguage(p,{mode:'parallel',variant:'interpretive',translationHidden:false}),'zh');
});
test('a parallel untranslated passage renders only its selectable original',()=>{
  const view=passagePresentation(passage,{mode:'parallel',variant:'literal',sourceLanguage:'en'});assert.equal(view.layers.filter(p=>p.kind==='original').length,1);assert.equal(view.layers[0].text,passage.original);assert.equal(view.layers.length,1);assert.equal(view.notice,null);
});
test('one saved variant never fills in the other variant',()=>{
  const p={...passage,translations:{interpretive:{text:'独立意译。'}}},before=structuredClone(p);
  assert.deepEqual(passagePresentation(p,{mode:'parallel',variant:'literal'}).layers.map(layer=>layer.kind),['original']);assert.equal(passagePresentation(p,{mode:'parallel',variant:'interpretive'}).layers[1].text,'独立意译。');assert.deepEqual(p,before);
});
test('an unavailable single translation falls back to a selectable original and original quote ownership',()=>{
  const view=passagePresentation(passage,{mode:'zh',variant:'interpretive',sourceLanguage:'en'});assert.equal(view.layers.length,1);assert.equal(view.layers[0].kind,'original');assert.equal(view.layers[0].lang,'en');assert.equal(view.notice,null);assert.equal(visibleQuoteLanguage(passage,{mode:'zh',variant:'interpretive'}),'en');assert.equal(visibleQuoteLanguage(passage,{mode:'parallel',variant:'interpretive'}),'en');
});
test('independent translations retain their texts and Chinese originals keep their language',()=>{
  const p={...passage,translations:{literal:{text:'直译。'},interpretive:{text:'意译。'}}};assert.equal(passagePresentation(p,{mode:'parallel',variant:'literal'}).layers[1].text,'直译。');assert.equal(passagePresentation(p,{mode:'parallel',variant:'interpretive'}).layers[1].text,'意译。');assert.equal(visibleQuoteLanguage(p,{mode:'zh',variant:'literal'}),'zh');assert.equal(passagePresentation({...passage,original:'中文原文。'},{mode:'en',sourceLanguage:'zh'}).layers[0].lang,'zh-Hans');
});

test('source lineation travels with originals and never changes translation text or source anchors',()=>{
 const p={...passage,source:{lineBreaks:[3,12]},translations:{literal:{text:'现有直译。'}}};
 assert.deepEqual(passagePresentation(p,{mode:'en'}).layers[0].lineBreaks,[3,12]);
 assert.deepEqual(passagePresentation(p,{mode:'zh',variant:'interpretive'}).layers[0].lineBreaks,[3,12]);
 assert.equal(passagePresentation(p,{mode:'zh',variant:'literal'}).layers[0].lineBreaks,undefined);
 assert.equal(p.original,passage.original);
});

test('visual line breaks retain every source character and reject invalid offsets',async()=>{
 const api=await import('../app/passage-layers.mjs');assert.equal(typeof api.applySourceLineation,'function');
 const document={createTextNode:text=>({textContent:text}),createElement:tag=>({tagName:tag,textContent:''})};
 const node={children:[],get textContent(){return this.children.map(c=>c.textContent).join('');},set textContent(text){this.children=[{textContent:text}];},replaceChildren(...children){this.children=children;},ownerDocument:document};
 const original='First line. Second line.';node.textContent=original;api.applySourceLineation(node,[11]);
 assert.equal(node.textContent,original);assert.equal(node.children.filter(c=>c.tagName==='br').length,1);
 assert.equal(node.children[0].textContent,'First line.');assert.equal(node.children[2].textContent,' Second line.');
 for(const offsets of [[0],[-1],[999],[4,3],[3,3],['3'],Array(1001).fill(1)]){node.textContent=original;api.applySourceLineation(node,offsets);assert.equal(node.textContent,original);assert.equal(node.children.length,1);}
});

// GET-190: presentation nodes keep the raw source string in the DOM exactly
// once while hiding syntax markers and rendering real emphasis content.
function fakeDom(){
 class Node{
  constructor(tagName='',text=''){this.tagName=tagName;this.value=text;this.children=[];this.dataset={};this.className='';this.attributes={};this.ownerDocument=document;}
  get textContent(){return this.tagName==='#text'?this.value:this.children.map(n=>n.textContent).join('');}
  set textContent(text){this.children=[new Node('#text',text)];}
  setAttribute(name,value){this.attributes[name]=value;}
  append(...nodes){for(const node of nodes)this.children.push(...(node.tagName==='#fragment'?node.children:[node]));}
  replaceChildren(...nodes){this.children=[];this.append(...nodes);}
 }
 const document={createTextNode:text=>new Node('#text',text),createElement:tag=>new Node(tag),createDocumentFragment:()=>new Node('#fragment')};
 return {document,Node};
}
const descendants=node=>node.children.flatMap(child=>[child,...descendants(child)]);

test('source presentation renders hidden markers, real em content and verse breaks over one raw text',()=>{
 const {document,Node}=fakeDom();
 const text='Line one _very_ line two.\nSecond verse.';
 const emphasis=[{start:10,end:14}],lineBreaks=[text.indexOf('\n')];
 const nodes=sourcePresentationNodes(document,text,emphasis,{start:0,lineBreaks});
 const root=new Node('div');root.append(...nodes);
 assert.equal(root.textContent,text);
 assert.equal(descendants(root).filter(n=>n.tagName==='br').length,1);
 const ems=descendants(root).filter(n=>n.tagName==='em');assert.equal(ems.length,1);assert.equal(ems[0].textContent,'very');
 const hidden=descendants(root).filter(n=>n.className==='source-syntax');
 assert.deepEqual(hidden.map(n=>n.textContent),['_','_']);
 assert.ok(hidden.every(n=>n.attributes['aria-hidden']==='true'));
});

test('a segment start intersects registered full ranges instead of reparsing detached text',()=>{
 const {document,Node}=fakeDom();
 const text='xx _very_ yy',emphasis=[{start:4,end:8}];
 const first=sourcePresentationNodes(document,text.slice(0,7),emphasis,{start:0}),second=sourcePresentationNodes(document,text.slice(7),emphasis,{start:7});
 const root=new Node('div');root.append(...first,...second);
 assert.equal(root.textContent,text);
 assert.deepEqual(descendants(root).filter(n=>n.className==='source-syntax').map(n=>n.textContent),['_','_']);
 const ems=descendants(root).filter(n=>n.tagName==='em');assert.deepEqual(ems.map(n=>n.textContent),['ver','y']);
 assert.deepEqual(emphasis,[{start:4,end:8}],'the registered full ranges never change');
});

test('emphasis presentation belongs to originals of eligible books only and never rewrites text',()=>{
 const eligible={visibility:'public',source:{format:'txt'}},privateBook={visibility:'private',source:{format:'txt'}};
 const p={id:'p1',original:'Keep _raw_ source.',translations:{interpretive:{text:'保留 _raw_ 原文。'}}};
 const view=passagePresentation(p,{mode:'parallel',variant:'interpretive',sourceEmphasis:sourceEmphasisEligible(eligible)});
 assert.deepEqual(view.layers[0].emphasis,[{start:6,end:9}]);
 assert.equal(view.layers[1].emphasis,undefined,'translations never interpret underscores as author emphasis');
 assert.deepEqual(view.layers[0].text,p.original);
 const hidden=passagePresentation(p,{mode:'en',sourceEmphasis:sourceEmphasisEligible(privateBook)});
 assert.equal(hidden.layers[0].emphasis,undefined);
 assert.equal(sourceEmphasisEligible({visibility:'public',source:{format:'json'}}),false);
});

// GET-186/190 quote panel: the real helper used by renderPanelSource only
// formats a slice when the snapshot identity and raw slice still validate
// against the current full source; historical excerpts stay literal.
test('a validated quote slice formats from its full source with delimiters partly outside',()=>{
  const {document,Node}=fakeDom(),book={bookId:'b1',contentVersion:'v1',visibility:'public',source:{format:'txt'}};
  const snapshot={bookId:'b1',contentVersion:'v1'};
  const part={passageId:'p1',language:'en',variant:'interpretive',start:1,end:4,text:'new'};
  const {nodes,displayText,formatted}=quotePanelSourceNodes(document,{book,snapshot,parts:[part],originalFor:()=>'_new_'});
  const root=new Node('div');root.append(...nodes);
  assert.equal(formatted[0],true);
  assert.equal(displayText,'new','the presented excerpt omits markers only when formatting is valid');
  assert.equal(root.textContent,'new');
  assert.deepEqual(descendants(root).filter(n=>n.tagName==='em').map(n=>n.textContent),['new']);
});

test('a historical excerpt whose raw slice no longer matches stays literal and is never reparsed',()=>{
  const {document,Node}=fakeDom(),book={bookId:'b1',contentVersion:'v1',visibility:'public',source:{format:'txt'}};
  const snapshot={bookId:'b1',contentVersion:'v1'};
  // Reviewer reproduction: current original '_new_', saved part.text 'old'.
  const part={passageId:'p1',language:'en',variant:'interpretive',start:1,end:4,text:'old'};
  const {nodes,displayText,formatted}=quotePanelSourceNodes(document,{book,snapshot,parts:[part],originalFor:()=>'_new_'});
  const root=new Node('div');root.append(...nodes);
  assert.equal(formatted[0],false);
  assert.equal(root.textContent,'old','the saved historical text survives literally');
  assert.equal(displayText,'old');
  assert.equal(descendants(root).filter(n=>n.tagName==='em').length,0);
  assert.equal(descendants(root).filter(n=>n.className==='source-syntax').length,0);
});

test('quote panel formatting requires matching book/version, integer bounds and one shared join',()=>{
  const {document,Node}=fakeDom(),book={bookId:'b1',contentVersion:'v2',visibility:'public',source:{format:'txt'}};
  const current=()=>'_very_';
  for(const snapshot of [{bookId:'b1',contentVersion:'v1'},{bookId:'other',contentVersion:'v2'}]){
    const out=quotePanelSourceNodes(document,{book,snapshot,parts:[{passageId:'p1',language:'en',start:1,end:5,text:'very'}],originalFor:current});
    assert.equal(out.formatted[0],false,JSON.stringify(snapshot));
  }
  for(const bounds of [{start:1.5,end:5},{start:-1,end:5},{start:1,end:99},{start:5,end:1}]){
    const out=quotePanelSourceNodes(document,{book,snapshot:{bookId:'b1',contentVersion:'v2'},parts:[{passageId:'p1',language:'en',...bounds,text:'very'}],originalFor:current});
    assert.equal(out.formatted[0],false,JSON.stringify(bounds));
  }
  const stale={passageId:'p1',language:'en',start:1,end:5,text:'old'},good={passageId:'p2',language:'en',start:1,end:5,text:'very'},translation={passageId:'p3',language:'zh',variant:'interpretive',start:0,end:2,text:'意译'};
  const out=quotePanelSourceNodes(document,{book,snapshot:{bookId:'b1',contentVersion:'v2'},parts:[good,stale,translation],originalFor:part=>part.language==='zh'?undefined:current()});
  const root=new Node('div');root.append(...out.nodes);
  assert.equal(root.textContent,'very　old　意译');
  assert.deepEqual(out.formatted,[true,false,false]);
  assert.equal(out.displayText,'very　old　意译');
});

test('empty drafts and typographic separators stay quiet in either translation variant',()=>{
 for(const original of ['Untranslated prose.','···','* * *'])for(const variant of ['literal','interpretive']){
  const p={id:'quiet',original,translations:{[variant]:{text:'   ',status:'draft'}}},before=structuredClone(p);
  for(const mode of ['parallel','zh','en']){const view=passagePresentation(p,{mode,variant});assert.deepEqual(view.layers.map(layer=>layer.kind),['original']);assert.equal(view.layers[0].text,original);assert.equal(view.notice,null);}
  assert.deepEqual(p,before);
 }
});
