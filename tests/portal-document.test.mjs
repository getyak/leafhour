import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {portalDocument} from '../server/portal-document.mjs';
test('the library response presents the library before JavaScript loads',async()=>{
  const source=await readFile(new URL('../app/home.html',import.meta.url),'utf8'),library=portalDocument(source,'/library');
  assert.match(library,/<title>我的书房 · 循页 Page by Page<\/title>/);assert.match(library,/<div id="home-view" hidden>/);assert.match(library,/<div id="library-view">/);assert.doesNotMatch(library,/class="home-nav" href=/);assert.equal(portalDocument(library,'/library'),library);
});
test('homepage rendering leaves the authored document and its public navigation unchanged',async()=>{const source=await readFile(new URL('../app/home.html',import.meta.url),'utf8');assert.equal(portalDocument(source,'/'),source);});
