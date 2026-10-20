import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fixture} from './reader-audio-fixture.mjs';
import {mountNativeUiLocaleControl} from '../app/ui-locale-controls.mjs';
import en from '../app/ui-catalogs/en.mjs';
import zhHans from '../app/ui-catalogs/zh-Hans.mjs';
import zhHant from '../app/ui-catalogs/zh-Hant.mjs';
import ja from '../app/ui-catalogs/ja.mjs';
test('the existing reader language notice tells the real account status in all four languages',async()=>{
 for(const catalogue of [en,zhHans,zhHant,ja]){
  const f=fixture(await readFile(new URL('../app/index.html',import.meta.url),'utf8')),root=f.document.getElementById('reader-ui-language');let state={effective:'en',phase:'ready',persistence:'saved',account:{phase:'idle',reason:null}},update,retries=0;
  const control=mountNativeUiLocaleControl({root,getState:()=>state,setLocale:()=>{},retry:()=>{retries++;},subscribeState:fn=>{update=fn;return()=>{};},labels:id=>catalogue[id]});
  const notice=root.querySelector('.ui-locale-notice'),retry=root.querySelector('.ui-locale-retry');
  assert.equal(notice.hidden,true);
  for(const phase of ['reading','saving','saved','error','conflict']){state={...state,account:{phase,reason:null}};update();assert.ok(catalogue['ui.accountLocale.'+phase]);assert.equal(notice.hidden,false,phase);assert.equal(notice.textContent,catalogue['ui.accountLocale.'+phase]);assert.equal(retry.hidden,!['error','conflict'].includes(phase));}
  retry.dispatchEvent(new Event('click'));assert.equal(retries,1);
  state={...state,phase:'pending',requested:'ja'};update();assert.equal(notice.textContent,catalogue['ui.locale.loading'],'catalogue loading takes priority over account synchronization');
  state={...state,phase:'ready',persistence:'session-only'};update();assert.equal(notice.textContent,catalogue['ui.locale.sessionOnly'],'a failed device step keeps its truthful notice');
  control.unmount();
 }
});
