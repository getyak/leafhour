import test from 'node:test';import assert from 'node:assert/strict';
import {createTranslationState} from '../app/translation-state.mjs';
const first={id:'p1',original:'First paragraph.',translations:{}},second={id:'p2',original:'Another paragraph.',translations:{}},capabilities={authenticated:true,available:true};
test('a late result belongs to its original paragraph and cannot reveal a different selection',()=>{
  const tasks=createTranslationState();tasks.select('p1');tasks.begin('p1');tasks.select('p2');assert.equal(tasks.complete('p1'),false);
  const view=tasks.view(second,capabilities);assert.equal(view.label,'翻译这段');assert.equal(view.disabled,false);assert.match(view.notice,/之前选择/);assert.match(view.notice,/当前段落尚未翻译/);
});
test('returning to a paragraph that is still translating keeps the request locked',()=>{
  const tasks=createTranslationState();tasks.select('p1');tasks.begin('p1');tasks.select('p2');tasks.select('p1');assert.equal(tasks.view(first,capabilities).disabled,true);assert.throws(()=>tasks.begin('p1'));assert.equal(tasks.complete('p1'),true);
});
test('a failure is kept with the original paragraph and retry clears the error',()=>{
  const tasks=createTranslationState();tasks.select('p1');tasks.begin('p1');tasks.select('p2');tasks.fail('p1','服务繁忙');assert.equal(tasks.view(second,capabilities).label,'翻译这段');
  tasks.select('p1');assert.equal(tasks.view(first,capabilities).label,'重试翻译');assert.match(tasks.view(first,capabilities).notice,/服务繁忙/);tasks.begin('p1');assert.equal(tasks.view(first,capabilities).label,'正在翻译…');
});
test('existing independent drafts can be opened locally even without a translation service',()=>{
  const tasks=createTranslationState(),saved={...first,translations:{literal:{text:'直译'},interpretive:{text:'意译'}}};assert.equal(tasks.view(saved,{authenticated:false,available:false}).label,'查看双译');assert.equal(tasks.view(saved,{authenticated:false,available:false}).disabled,false);
  assert.equal(tasks.view(first,{authenticated:true,available:false}).disabled,true);assert.equal(tasks.view({...first,original:'中文原文。'},capabilities).disabled,true);
});
test('changing chapters clears selection without losing the background request',()=>{
  const tasks=createTranslationState();tasks.select('p1');tasks.begin('p1');tasks.select(null);assert.equal(tasks.complete('p1'),false);assert.match(tasks.view(null,capabilities).notice,/已保存/);
});
test('dismissed selection invalidates reveal while keeping the submitted paragraph result',()=>{
  const tasks=createTranslationState();tasks.select('p1');tasks.begin('p1');tasks.select(null);assert.equal(tasks.selectedId(),null);assert.equal(tasks.complete('p1'),false);
  assert.equal(tasks.view(null,capabilities).disabled,true);assert.match(tasks.view(null,capabilities).notice,/之前选择/);
});
test('anonymous readers are not promised translation when the service is unavailable',()=>{const tasks=createTranslationState(),view=tasks.view(first,{authenticated:false,available:false});assert.equal(view.label,'翻译未配置');assert.equal(view.disabled,true);assert.doesNotMatch(view.notice,/登录.*翻译/);assert.equal(tasks.view(first,{authenticated:false,available:true}).label,'登录后翻译');});
