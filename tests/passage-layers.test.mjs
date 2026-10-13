import test from 'node:test';import assert from 'node:assert/strict';
import {passagePresentation,visibleQuoteLanguage} from '../app/passage-layers.mjs';
const passage={id:'p1',original:'The original words stay unchanged.',translations:{}};
test('an explicit DOM selection keeps its actual layer despite an original-view override',()=>{
  const p={...passage,translations:{interpretive:{text:'独立意译。'}}};assert.equal(visibleQuoteLanguage(p,{mode:'en',variant:'interpretive'},'zh'),'zh');assert.equal(visibleQuoteLanguage(p,{mode:'parallel',variant:'interpretive'},'en'),'en');assert.equal(visibleQuoteLanguage(p,{mode:'parallel',variant:'interpretive'}),'zh');
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
