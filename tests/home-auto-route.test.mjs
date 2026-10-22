import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {classifyUiRoute,UI_PREFERENCE_KEY,uiAuthoredPath} from '../app/ui-locale-codec.mjs';
import {createUiLocale} from '../app/ui-locale.mjs';
import hans from '../app/ui-catalogs/zh-Hans.mjs';
import ja from '../app/ui-catalogs/ja.mjs';
import {portalDocument} from '../server/portal-document.mjs';
const source=await readFile(new URL('../app/home.html',import.meta.url),'utf8');
const links=html=>[...html.matchAll(/<a\b[^>]*\bhref="([^"\n]+)"/g)].map(m=>m[1].replaceAll('&amp;','&')).filter(href=>/^\/(?:library|read)(?:[?#]|$)/.test(href));
test('the root is automatic while the English homepage remains an explicit destination',()=>{
 assert.deepEqual(classifyUiRoute('/'),{kind:'canonical',code:null});
 assert.deepEqual(classifyUiRoute('/en'),{kind:'home',code:'en'});
 assert.equal(uiAuthoredPath('/','en'),'/en');
});
test('root detection chooses browser or device without recording an inferred English preference',async()=>{
 for(const [saved,query,expected]of [[null,'','zh-Hans'],['ja','','ja'],['ja','?ui=en','en']]){
  const writes=[],runtime=createUiLocale({getLocation:()=>({href:'https://leafhour.test/'+query}),languages:['zh-CN'],storage:{getItem:key=>key===UI_PREFERENCE_KEY?saved:null,setItem:(...args)=>writes.push(args)},loadCatalogue:async code=>({'zh-Hans':hans,ja}[code])});
  await runtime.initialize();assert.equal(runtime.getUiLocale(),expected);assert.deepEqual(writes,[]);
 }
});
test('automatic first-paint links defer language to the next canonical page; explicit English keeps its language',()=>{
 const automatic=portalDocument(source,'/'),explicit=portalDocument(source,'/en');
 assert.ok(links(automatic).length>=3);assert.ok(links(explicit).length>=3);
 for(const href of links(automatic))assert.equal(new URL(href,'https://leafhour.test').searchParams.has('ui'),false,href);
 for(const href of links(explicit))assert.equal(new URL(href,'https://leafhour.test').searchParams.get('ui'),'en',href);
 assert.match(automatic,/<html lang="en">/);assert.match(explicit,/href="\/en" lang="en"/);
});
