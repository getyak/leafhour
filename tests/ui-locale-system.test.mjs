import test from 'node:test';
import assert from 'node:assert/strict';
import {createUiLocale} from '../app/ui-locale.mjs';
import {enterAutoHome} from '../app/home-entry.mjs';
import en from '../app/ui-catalogs/en.mjs';
import ja from '../app/ui-catalogs/ja.mjs';
import hans from '../app/ui-catalogs/zh-Hans.mjs';
import hant from '../app/ui-catalogs/zh-Hant.mjs';
import {browserUiLocale,parseUiParam,normalizeUiLocale,UI_PREFERENCE_KEY,UI_SESSION_PREFERENCE_KEY} from '../app/ui-locale-codec.mjs';
import {readerLoginUrl} from '../app/reader-return.mjs';
import {createAccountUiPreferencesBridge} from '../app/account-ui-preferences.mjs';
const catalogues={en,ja,'zh-Hans':hans,'zh-Hant':hant};
function fixture({denied=false,href='https://leafhour.com/library',languages=['ja-JP'],preference='en',getLanguages=()=>languages,loader,historyDenied=false}={}){
 const location={href},writes=[],loads=[];let saved=preference;
 const runtime=createUiLocale({getLanguages,loadCatalogue:async(code,options)=>{loads.push([code,options.retry]);return loader?loader(code,options):catalogues[code];},storage:{getItem:()=>saved,setItem:(k,v)=>{if(denied)throw Error('denied');saved=v;writes.push([k,v]);}},history:{replaceState(s,t,url){if(historyDenied)throw Error('denied');location.href=new URL(url,location.href).href;}},getLocation:()=>location});
 return {runtime,location,writes,loads};
}
test('GET-219 regression: account system survives history with an old device language',async()=>{
 const {runtime}=fixture();await runtime.initialize();await runtime.requestAccountUiLocale('system');await runtime.handlePopstate();
 assert.equal(runtime.getUiLocaleState().preference,'system');assert.equal(runtime.getUiLocale(),'ja');
});

const stamp='2026-10-25T00:00:00Z';
const snapshot=(uiLocale,revision=2)=>({uiLocale,revision,updatedAt:revision?stamp:null});
const tick=()=>new Promise(setImmediate);
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
for(const [tag,code] of [['en-NZ','en'],['ja-Latn-JP','ja'],['zh-Hant-CN','zh-Hant'],['zh-Hans-TW','zh-Hans'],['zh-HK','zh-Hant'],['zh-SG','zh-Hans'],['zh-Hant-HK-u-nu-hanidec','zh-Hant']])test('navigator tag '+tag+' resolves separately from URL grammar',()=>{
 assert.equal(normalizeUiLocale(tag),code);assert.equal(parseUiParam('ui='+tag).code,null);
});
test('unsupported/empty navigator and system URL are bounded',()=>{
 assert.equal(browserUiLocale(['fr-FR','de-DE']),'en');assert.equal(browserUiLocale([]),'en');
 for(const query of ['ui=system','ui=ja&ui=ja','ui=system&ui=en','ui=ja&ui=en'])assert.notEqual(parseUiParam(query).status,'valid');
});
test('selected mode, actual language and page override are independent and opening never writes',async()=>{
 const f=fixture({preference:'system',href:'https://leafhour.com/read?book=b&passage=p3&ui=zh-Hant#note'});await f.runtime.initialize();
 const s=f.runtime.getUiLocaleState();assert.equal(s.preference,'system');assert.equal(s.effective,'zh-Hant');assert.equal(s.source,'page');assert.deepEqual(f.writes,[]);
 assert.equal(f.runtime.uiHref('/read?book=b&passage=p3&ui=zh-Hant#note'),'/read?book=b&passage=p3#note');
 await f.runtime.requestAccountUiLocale('ja');assert.equal(f.runtime.getUiLocale(),'zh-Hant');assert.equal(f.runtime.getUiLocaleState().preference,'ja');
 f.location.href='https://leafhour.com/read?book=b&passage=p3#note';await f.runtime.handlePopstate();assert.equal(f.runtime.getUiLocale(),'ja');assert.deepEqual(f.writes,[]);
});
test('authored prose stays path authoritative under account and manual choices',async()=>{
 const f=fixture({href:'https://leafhour.com/zh-hant/privacy?ui=ja',preference:'en'});await f.runtime.initialize();await f.runtime.requestAccountUiLocale('system');
 assert.equal(f.runtime.getUiLocale(),'zh-Hant');assert.equal(f.runtime.getUiLocaleState().preference,'system');assert.deepEqual(f.writes,[]);
});
test('same-effective fixed to system changes mode, links and one persisted value',async()=>{
 const f=fixture({preference:'ja'});await f.runtime.initialize();let commits=0;f.runtime.onUiLocaleManualCommit(()=>commits++);
 await f.runtime.setUiLocale('system');assert.equal(f.runtime.getUiLocale(),'ja');assert.equal(f.runtime.getUiLocaleState().preference,'system');assert.equal(f.runtime.uiHref('/library?ui=ja'),'/library');
 await f.runtime.setUiLocale('system');assert.equal(commits,1);assert.deepEqual(f.writes,[[UI_PREFERENCE_KEY,'system']]);
});
test('system rereads browser languages while fixed and page overrides ignore languagechange',async()=>{
 let languages=['ja-JP'];const f=fixture({preference:'system',getLanguages:()=>languages});await f.runtime.initialize();
 languages=['zh-Hant-TW'];await f.runtime.handleLanguagechange();assert.equal(f.runtime.getUiLocale(),'zh-Hant');assert.deepEqual(f.writes,[]);
 await f.runtime.setUiLocale('en');languages=['ja-JP'];await f.runtime.handleLanguagechange();assert.equal(f.runtime.getUiLocale(),'en');
});
test('denied system persistence remains honest after history and language events',async()=>{
 let languages=['ja'];const f=fixture({denied:true,getLanguages:()=>languages});await f.runtime.initialize();await f.runtime.setUiLocale('system');
 await f.runtime.handlePopstate();assert.equal(f.runtime.getUiLocaleState().persistence,'session-only');languages=['zh-TW'];await f.runtime.handleLanguagechange();
 assert.equal(f.runtime.getUiLocale(),'zh-Hant');assert.equal(f.runtime.getUiLocaleState().persistence,'session-only');assert.equal(f.runtime.uiHref('/library'),'/library');
});
test('same-target languagechange never cancels the base or spends its explicit retry',async()=>{
 const gate=deferred(),f=fixture({preference:'system',loader:()=>gate.promise});const initial=f.runtime.initialize();await tick();
 await f.runtime.handleLanguagechange();await f.runtime.handleLanguagechange();assert.deepEqual(f.loads,[['ja',false]]);
 gate.reject(Error('offline'));await initial;await f.runtime.handleLanguagechange();assert.deepEqual(f.loads,[['ja',false]]);
 await f.runtime.retryUiLocale();assert.deepEqual(f.loads,[['ja',false],['ja',true]]);assert.equal(f.runtime.getUiLocaleState().offerReload,true);
});
test('repeated pending system choices share one attempt and bind their original intent',async()=>{
 const gate=deferred(),f=fixture({loader:()=>gate.promise});await f.runtime.initialize();let intents=0;f.runtime.onUiLocaleManualIntent(()=>intents++);
 const first=f.runtime.setUiLocale('system'),second=f.runtime.setUiLocale('system');assert.equal(first,second);assert.equal(intents,1);assert.deepEqual(f.loads,[['ja',false]]);
 gate.resolve(ja);await first;assert.deepEqual(f.writes,[[UI_PREFERENCE_KEY,'system']]);
});
test('history rejection leaves both mode and persisted choice untouched',async()=>{
 const f=fixture({historyDenied:true});await f.runtime.initialize();await f.runtime.setUiLocale('system');
 assert.equal(f.runtime.getUiLocale(),'en');assert.equal(f.runtime.getUiLocaleState().preference,'en');assert.equal(f.runtime.getUiLocaleState().fallbackReason,'history');assert.deepEqual(f.writes,[]);
});
test('storage events respect account priority and session-only choices',async()=>{
 const f=fixture({preference:'en'});await f.runtime.initialize();await f.runtime.requestAccountUiLocale('system');await f.runtime.handleStorage();assert.equal(f.runtime.getUiLocale(),'ja');assert.equal(f.runtime.getUiLocaleState().preferenceSource,'account');assert.deepEqual(f.writes,[]);
});
test('legacy account null at nonzero revision still delegates to device instead of system',async()=>{
 const f=fixture();await f.runtime.initialize();let writes=0;
 const bridge=createAccountUiPreferencesBridge({runtime:f.runtime,getLocation:()=>f.location,read:async()=>snapshot(null,9),write:()=>{writes++;}});
 await bridge.adoptOwner('synthetic-a');assert.equal(f.runtime.getUiLocale(),'en');assert.equal(f.runtime.getUiLocaleState().preference,'en');assert.equal(writes,0);bridge.dispose();
});
test('account system restores independently on two devices, without device or account writes',async()=>{
 for(const [languages,code] of [[['ja-JP'],'ja'],[['zh-Hans-CN'],'zh-Hans']]){
  const f=fixture({languages});await f.runtime.initialize();let writes=0;
  const bridge=createAccountUiPreferencesBridge({runtime:f.runtime,getLocation:()=>f.location,read:async()=>snapshot('system'),write:()=>{writes++;}});
  await bridge.adoptOwner('synthetic-a');assert.equal(f.runtime.getUiLocale(),'ja'===code?'ja':code);assert.equal(f.runtime.getUiLocaleState().preference,'system');assert.equal(writes,0);assert.deepEqual(f.writes,[]);bridge.dispose();
 }
});
test('A to B to A revokes late old picker, reads and retries before they can commit',async()=>{
 const gate=deferred(),readB=deferred(),readA=deferred(),f=fixture({loader:code=>code==='ja'?gate.promise:catalogues[code]});await f.runtime.initialize();let reads=0,writes=0;
 const bridge=createAccountUiPreferencesBridge({runtime:f.runtime,getLocation:()=>f.location,read:owner=>++reads===1?snapshot('en'):owner==='synthetic-b'?readB.promise:readA.promise,write:()=>{writes++;}});
 await bridge.adoptOwner('synthetic-a');const picker=f.runtime.setUiLocale('system');await tick();const b=bridge.adoptOwner('synthetic-b');await tick();const a=bridge.adoptOwner('synthetic-a');await tick();
 readB.resolve(snapshot('ja'));readA.resolve(snapshot('zh-Hant'));gate.resolve(ja);await Promise.all([picker,b,a]);
 assert.equal(f.runtime.getUiLocale(),'zh-Hant');assert.equal(f.runtime.getUiLocaleState().preference,'zh-Hant');assert.equal(writes,0);assert.deepEqual(f.writes,[]);bridge.dispose();
});
test('system CAS conflict keeps local mode and only explicit retry saves the exact system value',async()=>{
 const f=fixture();await f.runtime.initialize();const posts=[];let revision=3;
 const bridge=createAccountUiPreferencesBridge({runtime:f.runtime,getLocation:()=>f.location,read:async()=>snapshot('en',revision),write:async(owner,input)=>{posts.push(input);if(posts.length===1){revision=4;throw Object.assign(Error('conflict'),{status:409});}return snapshot(input.uiLocale,input.baseRevision+1);}});
 await bridge.adoptOwner('synthetic-a');await f.runtime.setUiLocale('system');for(let i=0;i<8;i++)await tick();
 assert.equal(bridge.getState().phase,'conflict');assert.equal(f.runtime.getUiLocaleState().preference,'system');assert.deepEqual(posts,[{baseRevision:3,uiLocale:'system'}]);
 await bridge.retry();assert.equal(bridge.getState().phase,'saved');assert.deepEqual(posts[1],{baseRevision:4,uiLocale:'system'});bridge.dispose();
});
test('system login links preserve business deep links with neither outer nor nested ui',async()=>{
 const f=fixture({preference:'system'});await f.runtime.initialize();
 const link=new URL(readerLoginUrl({bookId:'literal_id',passageId:'p3',contentVersion:'v1',layer:'original',ui:f.runtime.getUiLinkLocale()}),'https://synthetic.invalid');
 assert.equal(link.searchParams.has('ui'),false);const next=new URL(link.searchParams.get('next'),link);
 assert.equal(next.searchParams.has('ui'),false);assert.equal(next.searchParams.get('book'),'literal_id');assert.equal(next.searchParams.get('passage'),'p3');assert.equal(next.searchParams.get('layer'),'original');
});
test('session fallback survives a full document and root entry; both-denied is explicitly page scoped',async()=>{
 const values=new Map(),sessionStorage={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)},storage={getItem:()=> 'en',setItem(){throw Error('denied');}};
 const make=()=>createUiLocale({storage,sessionStorage,languages:['ja'],loadCatalogue:async c=>catalogues[c],history:{replaceState(){}},getLocation:()=>({href:'https://synthetic.invalid/library'})});
 const first=make();await first.initialize();await first.setUiLocale('system');assert.equal(first.getUiLocaleState().persistenceScope,'tab');assert.equal(values.get(UI_SESSION_PREFERENCE_KEY),'system');
 const second=make();await second.initialize();assert.equal(second.getUiLocale(),'ja');assert.equal(second.getUiLocaleState().persistence,'session-only');
 const root=await enterAutoHome({location:{href:'https://synthetic.invalid/',replace(){}},storage,sessionStorage,languages:['ja'],request:async()=>Response.json({user:null})});assert.equal(root.locale,'ja');
 const denied=fixture({denied:true});await denied.runtime.initialize();await denied.runtime.setUiLocale('system');assert.equal(denied.runtime.getUiLocaleState().persistenceScope,'page');
});
test('session-only Retry resolves the current system language instead of replaying an old catalogue',async()=>{
 let denied=true,languages=['ja'],saved='en';const r=createUiLocale({getLanguages:()=>languages,loadCatalogue:async c=>catalogues[c],storage:{getItem:()=>saved,setItem:(k,v)=>{if(denied)throw Error('denied');saved=v;}},history:{replaceState(){}},getLocation:()=>({href:'https://synthetic.invalid/library'})});
 await r.initialize();await r.setUiLocale('system');languages=['zh-TW'];await r.handleLanguagechange();denied=false;await r.retryUiLocale();assert.equal(r.getUiLocale(),'zh-Hant');assert.equal(saved,'system');assert.equal(r.getUiLocaleState().persistence,'saved');
});
test('owner clear and restore share one pending physical catalogue import',async()=>{
 const gate=deferred(),f=fixture({preference:'zh-Hans',href:'https://leafhour.com/library?ui=en',loader:c=>c==='zh-Hans'?gate.promise:catalogues[c]});await f.runtime.initialize();
 const bridge=createAccountUiPreferencesBridge({runtime:f.runtime,getLocation:()=>f.location,read:async owner=>snapshot(owner==='a'?'system':null),write:()=>assert.fail('read-only')});
 await bridge.adoptOwner('a');f.location.href='https://leafhour.com/library';await f.runtime.handlePopstate();assert.equal(f.runtime.getUiLocale(),'ja');
 const b=bridge.adoptOwner('b');await tick();assert.deepEqual(f.loads.filter(([c])=>c==='zh-Hans'),[['zh-Hans',false]]);gate.resolve(hans);await b;assert.equal(f.runtime.getUiLocale(),'zh-Hans');assert.equal(f.runtime.getUiLocaleState().offerReload,false);bridge.dispose();
});
test('GET-219 regression: root home uses account system instead of the old device language',async()=>{
 const location={href:'https://leafhour.com/',replace(url){this.target=url;}};
 const result=await enterAutoHome({location,languages:['ja-JP'],storage:{getItem:()=> 'en'},request:async path=>({ok:true,json:async()=>path==='/api/auth/session'?{user:{id:'synthetic-owner'}}:{revision:2,updatedAt:'2026-10-25T00:00:00Z',uiLocale:'system'}})});
 assert.equal(result.locale,'ja');assert.equal(location.target,'/ja');
});
test('GET-219 regression: denied storage keeps session system in generated links',async()=>{
 const {runtime}=fixture({denied:true});await runtime.initialize();await runtime.setUiLocale('system');
 assert.equal(runtime.getUiLocale(),'ja');assert.equal(runtime.getUiLocaleState().persistence,'session-only');
 assert.equal(runtime.uiHref('/library?book=a&book=b#p3'),'/library?book=a&book=b#p3');
});
test('restored session-only choice can retry persistence in a new document with a new manual intent',async()=>{
 const session=new Map([[UI_SESSION_PREFERENCE_KEY,'system']]),writes=[],intents=[];
 const r=createUiLocale({languages:['ja'],loadCatalogue:async c=>catalogues[c],storage:{getItem:()=> 'en',setItem:(k,v)=>writes.push([k,v])},sessionStorage:{getItem:k=>session.get(k),removeItem:k=>session.delete(k)},history:{replaceState(){}},getLocation:()=>({href:'https://synthetic.invalid/library'})});
 r.onUiLocaleManualIntent(x=>intents.push(x));await r.initialize();await r.retryUiLocale();
 assert.deepEqual(writes,[[UI_PREFERENCE_KEY,'system']]);assert.equal(session.size,0);assert.equal(intents.length,1);assert.equal(r.getUiLocaleState().persistence,'saved');
});
test('same-language owner clearing publishes the mode change to existing owned links',async()=>{
 const f=fixture({preference:null,languages:['en']});await f.runtime.initialize();let link=f.runtime.uiHref('/read?book=b');f.runtime.onUiLocaleChange(()=>{link=f.runtime.uiHref('/read?book=b');});
 await f.runtime.requestAccountUiLocale('en');assert.match(link,/ui=en/);await f.runtime.invalidateUiOwner();assert.equal(link,'/read?book=b');
});
test('returning from an account choice restores the tab persistence failure notice',async()=>{
 const sessionStorage={getItem:()=> 'system'},r=createUiLocale({languages:['ja'],sessionStorage,storage:{getItem:()=> 'en'},loadCatalogue:async c=>catalogues[c],getLocation:()=>({href:'https://synthetic.invalid/library'})});
 await r.initialize();await r.requestAccountUiLocale('en');await r.requestAccountUiLocale(null);assert.equal(r.getUiLocale(),'ja');assert.equal(r.getUiLocaleState().persistence,'session-only');assert.equal(r.getUiLocaleState().persistenceScope,'tab');
});
test('another tab cannot replace the successful current-document picker before an account reload',async()=>{
 let saved='en';const r=createUiLocale({languages:['ja'],storage:{getItem:()=>saved,setItem:(k,v)=>saved=v},history:{replaceState(){}},getLocation:()=>({href:'https://synthetic.invalid/library'}),loadCatalogue:async c=>catalogues[c]});
 await r.initialize();await r.setUiLocale('system');saved='en';await r.handleStorage();assert.equal(r.getUiLocaleState().preference,'system');assert.equal(r.getUiLocale(),'ja');
});
