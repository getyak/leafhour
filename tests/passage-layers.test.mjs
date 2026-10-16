import test from 'node:test';import assert from 'node:assert/strict';
import {passagePresentation,visibleQuoteLanguage} from '../app/passage-layers.mjs';
const passage={id:'p1',original:'The original words stay unchanged.',translations:{}};
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
test('a parallel untranslated passage contains one original and a truthful empty translation layer',()=>{
  const view=passagePresentation(passage,{mode:'parallel',variant:'literal',sourceLanguage:'en'});assert.equal(view.layers.filter(p=>p.kind==='original').length,1);assert.equal(view.layers[0].text,passage.original);assert.equal(view.layers[1].kind,'missing');assert.equal(view.layers[1].text,null);assert.match(view.layers[1].label,/直译.*尚未翻译/);assert.equal(view.notice,null);
});
test('one saved variant never fills in the other variant',()=>{
  const p={...passage,translations:{interpretive:{text:'独立意译。'}}},before=structuredClone(p);
  assert.equal(passagePresentation(p,{mode:'parallel',variant:'literal'}).layers[1].kind,'missing');assert.equal(passagePresentation(p,{mode:'parallel',variant:'interpretive'}).layers[1].text,'独立意译。');assert.deepEqual(p,before);
});
test('an unavailable single translation falls back to a selectable original and original quote ownership',()=>{
  const view=passagePresentation(passage,{mode:'zh',variant:'interpretive',sourceLanguage:'en'});assert.equal(view.layers.length,1);assert.equal(view.layers[0].kind,'original');assert.equal(view.layers[0].lang,'en');assert.match(view.notice,/显示原文/);assert.equal(visibleQuoteLanguage(passage,{mode:'zh',variant:'interpretive'}),'en');assert.equal(visibleQuoteLanguage(passage,{mode:'parallel',variant:'interpretive'}),'en');
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
