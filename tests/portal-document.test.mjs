import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {portalDocument} from '../server/portal-document.mjs';
test('the library response presents the library before JavaScript loads',async()=>{
  const source=await readFile(new URL('../app/home.html',import.meta.url),'utf8'),library=portalDocument(source,'/library');
  assert.match(library,/<title>我的书房 · Leafhour<\/title>/);assert.match(library,/<div id="home-view" hidden>/);assert.match(library,/<div id="library-view">/);assert.doesNotMatch(library,/class="home-nav" href=/);assert.equal(portalDocument(library,'/library'),library);
});
test('homepage rendering leaves the authored document and its public navigation unchanged',async()=>{const source=await readFile(new URL('../app/home.html',import.meta.url),'utf8');assert.equal(portalDocument(source,'/'),source);});
test('private library metadata is idempotently excluded from indexing and uses its own canonical URL',()=>{
  const source='<head><title>Home</title><link rel="canonical" href="https://leafhour.com/"><meta property="og:url" content="https://leafhour.com/"></head><body><div id="home-view"><div id="library-view" hidden>';
  const library=portalDocument(source,'/library');
  assert.match(library,/<meta name="robots" content="noindex,nofollow">/);
  assert.match(library,/<link rel="canonical" href="https:\/\/leafhour.com\/library">/);
  assert.match(library,/<meta property="og:url" content="https:\/\/leafhour.com\/library">/);
  assert.equal(portalDocument(library,'/library'),library);
});
