import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {portalDocument} from '../server/portal-document.mjs';
test('the library response presents the library before JavaScript loads',async()=>{
  const source=await readFile(new URL('../app/home.html',import.meta.url),'utf8'),library=portalDocument(source,'/library');
  assert.match(library,/<title>我的书房 · Leafhour<\/title>/);assert.match(library,/<div id="home-view" hidden>/);assert.match(library,/<div id="library-view">/);assert.doesNotMatch(library,/class="home-nav" href=/);assert.equal(portalDocument(library,'/library'),library);
});
test('the default homepage renders in English and every language keeps its own URL',async()=>{
  const source=await readFile(new URL('../app/home.html',import.meta.url),'utf8'),english=portalDocument(source,'/');
  assert.match(english,/<html lang="en">/);assert.match(english,/<link rel="canonical" href="https:\/\/leafhour.com\/">/);assert.match(english,/Make a little time\. Settle into a book\./);
  const alias=portalDocument(source,'/en');assert.match(alias,/<link rel="canonical" href="https:\/\/leafhour.com\/">/);
  const simplified=portalDocument(source,'/zh-hans');
  assert.match(simplified,/<html lang="zh-Hans">/);assert.match(simplified,/<link rel="canonical" href="https:\/\/leafhour.com\/zh-hans">/);assert.match(simplified,/留一点时间，读进一本书。/);
  for(const [route,lang,label]of [['/zh-hant','zh-Hant','留一點時間，讀進一本書。'],['/ja','ja','少しの時間をとって、一冊の本に向き合う。']]){
    const html=portalDocument(source,route);assert.match(html,new RegExp('<html lang="'+lang+'">'));assert.match(html,new RegExp('<link rel="canonical" href="https://leafhour\\.com'+route+'">'));assert.ok(html.includes(label));
  }
});
test('private library metadata is idempotently excluded from indexing and uses its own canonical URL',()=>{
  const source='<head><title>Home</title><link rel="canonical" href="https://leafhour.com/"><meta property="og:url" content="https://leafhour.com/"></head><body><div id="home-view"><div id="library-view" hidden>';
  const library=portalDocument(source,'/library');
  assert.match(library,/<meta name="robots" content="noindex,nofollow">/);
  assert.match(library,/<link rel="canonical" href="https:\/\/leafhour.com\/library">/);
  assert.match(library,/<meta property="og:url" content="https:\/\/leafhour.com\/library">/);
  assert.equal(portalDocument(library,'/library'),library);
});
