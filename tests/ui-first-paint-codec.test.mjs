import test from 'node:test';
import assert from 'node:assert/strict';
import {encodeUiLanguageHint,parseUiLanguageHint,readInitialUiDecision} from '../app/ui-first-paint-codec.mjs';
const documentFor=values=>({documentElement:{getAttribute:key=>values[key]??null}});
test('device hints retain preference mode and browser language without owner or auth data',()=>{
 for(const preference of [null,'system','en','zh-Hans','zh-Hant','ja'])for(const browserLocale of ['en','zh-Hans','zh-Hant','ja']){
  const hint=encodeUiLanguageHint({preference,browserLocale});assert.deepEqual(parseUiLanguageHint(hint),{preference,browserLocale});assert.ok(hint.length<40);
 }
 for(const hint of ['1.ja.en;owner=x','1.ja.xx','1.ja.en.extra','1.zh-cn.en','2.ja.en','1..en','1.owner.en',null])assert.equal(parseUiLanguageHint(hint),null);
 assert.equal(encodeUiLanguageHint({preference:'owner',browserLocale:'en'}),null);
});
test('initial account metadata is validated and bound to a verified owner',()=>{
 const values={'data-ui-initial-locale':'ja','data-ui-initial-source':'account','data-ui-initial-preference':'ja','data-ui-initial-owner':'owner-a','data-ui-device-hint':'1.en.zh-Hans'};
 assert.deepEqual(readInitialUiDecision(documentFor(values)),{locale:'ja',source:'account',preference:'ja',ownerId:'owner-a',deviceHint:'1.en.zh-Hans'});
 for(const patch of [{'data-ui-initial-owner':''},{'data-ui-initial-locale':'en'},{'data-ui-initial-owner':'bad\nowner'},{'data-ui-initial-source':'private'},{'data-ui-initial-preference':'unknown'}])assert.equal(readInitialUiDecision(documentFor({...values,...patch})),null);
});

test('document handoff paths are a closed owned map and never contain user URL data',async()=>{
 const {canonicalUiEntryPath,internalUiEntryPath}=await import('../app/ui-first-paint-codec.mjs');assert.equal(typeof canonicalUiEntryPath,'function');
 for(const [canonical,internal]of [['/','/_ui/home'],['/library','/_ui/library'],['/read','/_ui/read']]){assert.equal(internalUiEntryPath(canonical),internal);assert.equal(canonicalUiEntryPath(internal),canonical);assert.equal(canonicalUiEntryPath(canonical),canonical);}
 for(const value of ['//evil.test','/_ui/else','/read?book=x','/library/../read'])assert.equal(canonicalUiEntryPath(value),null);
});
