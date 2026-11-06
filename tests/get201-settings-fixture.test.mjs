import test from 'node:test';
import assert from 'node:assert/strict';
import {createSettingsFixture as constructFixture,installNetworkFence,installNavigationFence} from '../tools/settings-acceptance/model.mjs';
import {fixtureResponse,makeCoverage} from '../tools/settings-acceptance/host.mjs';
import {globalPreferencesDefaults,normalizeGlobalPreferences} from '../app/reading-preferences.mjs';
import {initialPreferenceMemory} from '../app/preference-memory-codec.mjs';
const createSettingsFixture=()=>constructFixture({defaults:globalPreferencesDefaults,normalizePreferences:normalizeGlobalPreferences,initialMemory:initialPreferenceMemory});
import {isAccountUiSnapshot} from '../app/account-ui-preferences.mjs';

test('only known synthetic identities and exact memory routes are accepted',async()=>{
 const f=createSettingsFixture();
 for(const identity of ['test@cubxxw.com','owner','local-owner','unknown'])assert.throws(()=>f.setIdentity(identity));
 for(const route of ['https://leafhour.com/api/account/profile','//leafhour.com/api/account/profile','/api/account/profile?owner=x','/api/reader/generate','/api/library/daily-reading/claim','/api/account/observability/events','/api/auth/session'])await assert.rejects(f.api(route),/Fixture denied/);
 assert.equal((await f.api('/api/account/profile')).displayName,'Synthetic Reader A');
 f.setIdentity('guest');await assert.rejects(f.api('/api/account/profile'),/Fixture denied/);
 assert.ok(f.ledger().every(row=>!('body' in row)&&!('email' in row)));
});
test('delayed A response is rejected across A to B to A and faults do not write',async()=>{
 const f=createSettingsFixture();f.setFault('/api/account/reading-preferences',{delayMs:15});
 const old=f.api('/api/account/reading-preferences');f.setIdentity('synthetic-b');f.setIdentity('synthetic-a');await assert.rejects(old,/generation/);
 const initial=await f.api('/api/account/reading-preferences');
 f.setFault('/api/account/reading-preferences',{status:503});
 await assert.rejects(f.api('/api/account/reading-preferences',{baseRevision:initial.revision,preferences:initial.preferences}),e=>e.status===503);
 assert.deepEqual(await f.api('/api/account/reading-preferences'),initial);
 await assert.rejects(f.api('/api/library/daily-reading',{}),/Fixture denied/);
});
test('memory adapters match real UI snapshots and daily baseRevision payloads',async()=>{
 const f=createSettingsFixture(),ui=await f.api('/api/account/ui-preferences');
 assert.equal(isAccountUiSnapshot(ui),true);
 const saved=await f.api('/api/account/ui-preferences',{baseRevision:ui.revision,uiLocale:'system'});assert.equal(isAccountUiSnapshot(saved),true);
 const daily=await f.api('/api/library/daily-reading');
 assert.equal((await f.api('/api/library/daily-reading/pause',{baseRevision:daily.plan.revision})).plan.status,'paused');
 await assert.rejects(f.api('/api/library/daily-reading/resume',{revision:2}),/Fixture denied/);
});
test('fetch fence never delegates a denied request to native networking',async()=>{
 let network=0;const target={fetch:()=>network++,navigator:{sendBeacon:()=>network++},WebSocket:class{},XMLHttpRequest:class{},EventSource:class{},Worker:class{},SharedWorker:class{},open:()=>network++};
 const f=createSettingsFixture();installNetworkFence(target,f,'http://127.0.0.1:5555');
 assert.equal((await target.fetch('/api/account/observability')).status,200);
 for(const url of ['https://leafhour.com/api/account/profile','http://127.0.0.1:5555/api/account/profile?x=1','/api/account/observability/events'])await assert.rejects(target.fetch(url));
 assert.throws(()=>target.navigator.sendBeacon('https://example.com'));
 assert.throws(()=>new target.XMLHttpRequest());assert.throws(()=>new target.WebSocket('ws://example.com'));
 assert.throws(()=>target.open('https://example.com'));assert.equal(network,0);
});
test('host denies foreign hosts/origins, credentials, mutation and path escapes',()=>{
 const assets=new Map([['/',{bytes:Buffer.from('fixture'),type:'text/html'}]]);
 const call=(url='/',headers={},method='GET')=>fixtureResponse({url,method,headers:{host:'127.0.0.1:5555',...headers}},assets,'127.0.0.1:5555');
 assert.equal(call().status,200);
 for(const args of [['/',{host:'evil.test'}],['/',{origin:'https://leafhour.com'}],['/',{cookie:'session=unknown'}],['/',{authorization:'Bearer unknown'}],['/',{'sec-fetch-site':'cross-site'}],['/api/account/profile'],['/%2e%2e/.env'],['/?secret=x']])assert.notEqual(call(...args).status,200);
 assert.equal(call('/',{},'POST').status,405);
 assert.equal(call('/?ui=ja',{cookie:'leafhour.ui.hint.v1=1.ja.en'}).status,200);
 assert.equal(call('/',{cookie:'leafhour.ui.hint.v1=1.ja.en; session=unknown'}).status,403);
 assert.match(call().headers['Content-Security-Policy'],/connect-src 'none'/);
 assert.match(call().headers['Content-Security-Policy'],/form-action 'none'/);
 assert.match(call().headers['Content-Security-Policy'],/sandbox allow-scripts allow-same-origin allow-downloads/);
});
test('link destinations are neutralized for auxiliary and context-menu navigation, including download attributes',()=>{
 const attributes=new Map([['href','https://leafhour.com/private'],['target','_blank'],['download','disguise.json']]);
 const a={get href(){return attributes.get('href');},get download(){return attributes.get('download');},getAttribute:key=>attributes.get(key),setAttribute:(key,value)=>attributes.set(key,value),removeAttribute:key=>attributes.delete(key),closest:()=>a};
 const events=new Map(),document={documentElement:{},querySelectorAll:()=>[a],addEventListener:(key,fn)=>events.set(key,fn)};
 let changed;const MutationObserver=class{constructor(fn){changed=fn;}observe(){}};
 installNavigationFence({document,MutationObserver},createSettingsFixture());
 assert.equal(a.href,'#fixture-navigation-disabled');assert.equal(attributes.has('target'),false);
 attributes.set('href','https://example.com');changed();assert.equal(a.href,'#fixture-navigation-disabled');
 let prevented=false;assert.throws(()=>events.get('auxclick')({target:a,preventDefault(){prevented=true;}}));assert.equal(prevented,true);
});
test('coverage starts pending and never turns a planned screenshot into a pass',()=>{
 const ledger=makeCoverage('d302393d4ed01a82af6828d7200969be3b8addc9');
 assert.equal(ledger.screenshots.length,216);
 assert.equal(ledger.screenshots.filter(r=>r.firstBatch&&r.browser==='Safari').length,36);
 assert.ok(ledger.screenshots.every(r=>r.status==='pending'&&r.evidence===null));
 assert.equal(ledger.humanStudy.status,'pending');assert.equal(ledger.humanStudy.participants,2);
});
