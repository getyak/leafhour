import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {portalDocument} from '../server/portal-document.mjs';
test('calendar and notes arrive with the shared companion and contextual status before JavaScript',async()=>{
 const source=await readFile(new URL('../app/home.html',import.meta.url),'utf8');
 for(const locale of ['en','zh-Hans','zh-Hant','ja'])for(const page of ['calendar','notes']){
  const html=portalDocument(source,'/library',{locale,source:'browser',workspace:page});
  assert.doesNotMatch(html.match(/<section id="reading-workspace"[^>]*>/)?.[0],/\bhidden\b/,'the arrival must actually be visible before scripts');
  const section=html.match(/<section id="reading-workspace"[^>]*>([\s\S]*?)<\/section>/)?.[1];
  assert.match(section,/data-reading-arrival="(?:calendar|notes)"/);
  assert.match(section,/paper-companion-loading/);
  assert.match(section,/aria-hidden="true"/);
  assert.match(section,/role="status"/);
  assert.match(section,/arrival-quote/);
  assert.doesNotMatch(section,/<p data-ui="ws.loading">/);
  assert.doesNotMatch(html,/<section id="reading-workspace"[^>]*aria-live=/,'only the changing status is live');
 }
});
test('the expanded reading story is public-only and keeps its exact source entry',async()=>{
 const source=await readFile(new URL('../app/home.html',import.meta.url),'utf8');
 assert.match(source,/href="\/home-story\.css"/);assert.match(source,/class="story-continuity"/);
 assert.match(source,/book=gutenberg-alice&amp;passage=01b38ea4c710a84b-p00008&amp;layer=original/);
 const library=portalDocument(source,'/library');assert.doesNotMatch(library,/href="\/home-story\.css"/);assert.match(library,/<div id="home-view" hidden>/);
});
test('the library response presents a complete safe English shell before JavaScript loads',async()=>{
  const source=await readFile(new URL('../app/home.html',import.meta.url),'utf8'),library=portalDocument(source,'/library');
  assert.match(library,/<title>My reading room · Leafhour<\/title>/);
  assert.match(library,/<html lang="en"(?:\s[^>]*)?>/,'the canonical shell starts in English');
  assert.match(library,/<div id="home-view" hidden>/);assert.match(library,/<div id="library-view">/);assert.doesNotMatch(library,/class="home-nav" href=/);
  // Title, lang, loading and return entries are complete safe English before
  // any meaningful control exists.
  assert.match(library,/Opening the reading room…/,'the static loading entry is English');
  assert.match(library,/Reopen the reading room/,'the static retry/return entry is English');
  assert.match(library,/Search by title or author/);
  assert.match(library,/Bring a book/);
  assert.match(library,/Sign in \/ Sign up/);
  assert.doesNotMatch(library,/正在打开书房/,'no source-language loading text remains in the canonical shell');
  assert.doesNotMatch(library,/我的书房/,'no source-language title remains');
  assert.equal(portalDocument(library,'/library'),library);
});
test('the default homepage renders in English and every language keeps its own URL',async()=>{
  const source=await readFile(new URL('../app/home.html',import.meta.url),'utf8'),english=portalDocument(source,'/');
  assert.match(english,/<html lang="en"(?:\s[^>]*)?>/);assert.match(english,/<link rel="canonical" href="https:\/\/leafhour.com\/">/);assert.match(english,/Stay with a book\.<br>A little longer\./);
  const alias=portalDocument(source,'/en');assert.match(alias,/<link rel="canonical" href="https:\/\/leafhour.com\/">/);
  const simplified=portalDocument(source,'/zh-hans');
  assert.match(simplified,/<html lang="zh-Hans">/);assert.match(simplified,/<link rel="canonical" href="https:\/\/leafhour.com\/zh-hans">/);assert.match(simplified,/给一本书，<br>多一点时间。/);
  for(const [route,lang,label]of [['/zh-hant','zh-Hant','給一本書，<br>多一點時間。'],['/ja','ja','一冊の本に、<br>もう少し時間を。']]){
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
test('the library does not download homepage-only motion, light and sample assets',async()=>{
 const source=await readFile(new URL('../app/home.html',import.meta.url),'utf8'),library=portalDocument(source,'/library');for(const name of ['home-motion','home-atmosphere','home-sample']){assert.doesNotMatch(library,new RegExp('/'+name+'\\.(?:mjs|css)'));assert.match(portalDocument(source,'/en'),new RegExp('/'+name+'\\.mjs'));}assert.match(library,/src="\/portal\.js"/);assert.match(library,/palette-bootstrap\.mjs/);assert.match(library,/reading-arrival\.mjs/);
});
