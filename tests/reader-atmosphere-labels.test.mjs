import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {parse} from 'acorn';
import {requestUiRoute,t} from '../app/ui-locale.mjs';

const source=await readFile(new URL('../app/reader-atmosphere.js',import.meta.url),'utf8');
const sceneLabels=parse(source,{ecmaVersion:'latest',sourceType:'module'}).body.find(node=>node.type==='FunctionDeclaration'&&node.id.name==='sceneLabels');

for(const [locale,expected] of [
 ['en','Reading atmosphere: Just the page'],
 ['zh-Hans','阅读氛围：只留纸面'],
 ['zh-Hant','閱讀氛圍：只留紙面'],
 ['ja','読書の雰囲気：紙面だけ']
])test('the no-scene trigger names its current state in '+locale,async()=>{
 await requestUiRoute(locale);
 const elements=new Map(),element=id=>{
  if(!elements.has(id))elements.set(id,{textContent:'',attributes:new Map(),setAttribute(name,value){this.attributes.set(name,value);}});
  return elements.get(id);
 };
 const context=vm.createContext({$:element,t,SCENE_UI:'reader.atmosphere.',cachedScene:'none',motionReduced:false});
 vm.runInContext(source.slice(sceneLabels.start,sceneLabels.end)+'\nsceneLabels();',context);
 assert.equal(element('open-atmosphere').attributes.get('aria-label'),expected);
 assert.ok(element('atmosphere-preview-name').textContent.length>0);
});
