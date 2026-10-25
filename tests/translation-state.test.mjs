import test from 'node:test';import assert from 'node:assert/strict';
import {createTranslationState} from '../app/translation-state.mjs';
const first={id:'p1',original:'First paragraph.',translations:{}},second={id:'p2',original:'Another paragraph.',translations:{}},capabilities={authenticated:true,available:true};
test('a guest cannot be sent to unavailable email login for untranslated text',()=>{
  const state=createTranslationState();state.select(first.id);const view=state.view(first,{authenticated:false,available:true,loginAvailable:false});
  assert.equal(view.disabled,true);assert.equal(view.label,'登录准备中');assert.match(view.notice,/尚未翻译/);
});
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

test('an optional presentation formatter receives stable messages without changing pending jobs or source identity',()=>{
 let descriptions=0;const tasks=createTranslationState({present:view=>{descriptions++;return view;}});tasks.select('p1');tasks.begin('p1');
 const running=tasks.view(first,capabilities);assert.equal(running.label.id,'translation.translating');assert.equal(running.disabled,true);assert.equal(running.notice[0].id,'translation.translatingNotice');assert.equal(tasks.selectedId(),'p1');assert.throws(()=>tasks.begin('p1'));
 tasks.select('p2');assert.equal(tasks.complete('p1'),false);const background=tasks.view(second,capabilities);assert.equal(background.label.id,'translation.translate');assert.deepEqual(background.notice.map(m=>m.id),['translation.backgroundSaved','translation.untranslated']);assert.equal(tasks.selectedId(),'p2');assert.equal(descriptions,2);assert.equal(first.original,'First paragraph.');
});

test('acknowledging a confirmed save never dismisses an in-flight task or failure',()=>{
 const tasks=createTranslationState();tasks.select('p1');tasks.begin('p1');assert.equal(tasks.acknowledgeSaved('p1'),false);
 tasks.complete('p1');tasks.select(null);assert.match(tasks.view(null,capabilities).notice,/已保存/);assert.equal(tasks.acknowledgeSaved('p2'),false);assert.equal(tasks.acknowledgeSaved('p1'),true);assert.equal(tasks.view(null,capabilities).notice,'');
 tasks.begin('p1');tasks.fail('p1','Offline');assert.equal(tasks.acknowledgeSaved('p1'),false);assert.match(tasks.view(null,capabilities).notice,/未完成/);
});
