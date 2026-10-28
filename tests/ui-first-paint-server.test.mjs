import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {UI_HINT_COOKIE,encodeUiLanguageHint} from '../app/ui-first-paint-codec.mjs';
import {UI_FIRST_PAINT_SCRIPT} from '../app/ui-first-paint-bootstrap.mjs';
const backend=()=>import('../server/ui-first-paint.mjs');
const token='A'.repeat(43),cookie=(preference,browserLocale='en')=>UI_HINT_COOKIE+'='+encodeUiLanguageHint({preference,browserLocale});
const user={id:'synthetic-owner'},snapshot=uiLocale=>({revision:1,updatedAt:'2026-10-28T00:00:00Z',uiLocale});
const at=search=>new URL('/library'+search,'https://leafhour.test');

test('one exact ui query is authoritative and never requests account data',async()=>{
 const {selectInitialUiLanguage}=await backend();let reads=0;
 const result=await selectInitialUiLanguage({url:at('?ui=zh-Hans&book=literal%2Fid'),cookie:cookie('ja'),acceptLanguage:'en',getUser:()=>{reads++;throw Error('no account read');}});
 assert.equal(result.locale,'zh-Hans');assert.equal(result.source,'page');assert.equal(result.preference,'zh-Hans');assert.equal(result.ownerId,undefined);assert.equal(reads,0);
});
test('ambiguous ui cannot override a freshly verified account choice',async()=>{
 const {selectInitialUiLanguage}=await backend();
 for(const query of ['?ui=ja&ui=ja','?ui=ja&ui=en','?ui=unsupported']){
  let identities=0;const result=await selectInitialUiLanguage({url:at(query),cookie:'marginalia_session='+token+'; '+cookie('en'),getUser:async()=>{identities++;return user;},getAccountPreference:async()=>snapshot('zh-Hant')});
  assert.equal(result.locale,'zh-Hant');assert.equal(result.source,'account');assert.equal(result.ownerId,user.id);assert.equal(identities,2);
 }
});
test('account and device system choices follow the current browser hint',async()=>{
 const {selectInitialUiLanguage}=await backend();
 const account=await selectInitialUiLanguage({url:at(''),cookie:'marginalia_session='+token+'; '+cookie('en','ja'),acceptLanguage:'zh-CN',getUser:async()=>user,getAccountPreference:async()=>snapshot('system')});
 assert.equal(account.locale,'ja');assert.equal(account.source,'account');assert.equal(account.preference,'system');
 const device=await selectInitialUiLanguage({url:at(''),cookie:cookie('system','zh-Hant'),acceptLanguage:'en'});assert.equal(device.locale,'zh-Hant');assert.equal(device.source,'device');
});
test('browser quality weights, corrupt hints and absent account preferences recover without persistence',async()=>{
 const {selectInitialUiLanguage}=await backend();
 assert.equal((await selectInitialUiLanguage({url:at(''),acceptLanguage:'en;q=0,ja;q=0.9,zh-CN;q=0.3'})).locale,'ja');
 assert.equal((await selectInitialUiLanguage({url:at(''),cookie:UI_HINT_COOKIE+'=bad',acceptLanguage:'zh-TW,en;q=0.5'})).locale,'zh-Hant');
 const result=await selectInitialUiLanguage({url:at(''),cookie:'marginalia_session='+token+'; '+cookie('ja'),getUser:async()=>user,getAccountPreference:async()=>({revision:0,updatedAt:null,uiLocale:null})});assert.equal(result.locale,'ja');assert.equal(result.source,'device');assert.equal(result.ownerId,undefined);
});
test('changed owner, corrupt records and a hanging identity never produce a false account shell',async()=>{
 const {selectInitialUiLanguage}=await backend();let identity=0;
 await assert.rejects(selectInitialUiLanguage({url:at(''),cookie:'marginalia_session='+token,getUser:async()=>({id:identity++?'new':'old'}),getAccountPreference:async()=>snapshot('ja')}),error=>error.status===503&&error.code==='UI_INITIAL_UNAVAILABLE');
 await assert.rejects(selectInitialUiLanguage({url:at(''),cookie:'marginalia_session='+token,getUser:async()=>user,getAccountPreference:async()=>({revision:1,updatedAt:'valid',uiLocale:'invalid'})}),error=>error.status===503);
 await assert.rejects(selectInitialUiLanguage({url:at(''),cookie:'marginalia_session='+token,getUser:()=>new Promise(()=>{}),timeoutMs:5}),error=>error.status===503);
});
test('localized library HTML and fixed bootstrap agree before any module can run',async()=>{
 const {portalDocument}=await import('../server/portal-document.mjs'),source=await readFile(new URL('../app/home.html',import.meta.url),'utf8');
 for(const [locale,title,loading]of [['en','My reading room','Opening the reading room'],['zh-Hans','我的书房','正在打开书房'],['zh-Hant','我的書房','正在打開書房'],['ja','自分の書斎','書斎を開いています']]){
  const html=portalDocument(source,'/library',{locale,source:'page',preference:locale,deviceHint:''});
  assert.match(html,new RegExp('<html[^>]*lang="'+locale+'"'));assert.ok(html.includes(title),locale+' title');assert.ok(html.includes(loading),locale+' loading');
  assert.ok(html.includes('data-ui-initial-locale="'+locale+'"'));const script='<script data-ui-first-paint>'+UI_FIRST_PAINT_SCRIPT+'</script>';assert.ok(html.includes(script),locale+' exact bootstrap');assert.ok(html.indexOf(script)<html.indexOf('<script type="module"'));
  assert.match(html,/noindex,nofollow/);assert.match(html,/href="https:\/\/leafhour.com\/library"/);
 }
});
test('reader localization touches only owned UI, never source text, code, style or URLs',async()=>{
 const {readerDocument}=await backend();
 const script='const source="<span data-ui=\"reader.shell.loading\">Source</span>";',style='p:after{content:"source < English"}';
 const source='<!doctype html><html lang="en" data-theme="paper"><head><title data-ui="reader.shell.pageTitle">Read</title><style>'+style+'</style><script>'+script+'</script></head><body><p data-ui="reader.shell.loading">Opening the book…</p><button data-ui-aria-label="reader.shell.close">×</button><textarea data-ui-placeholder="notebook.search">English source &lt; raw</textarea><article><p>Opening the book… source</p><pre><span data-ui="reader.shell.loading">Literal code</span></pre></article><script type="module" src="/reader-web/literal.js"></script></body></html>';
 const html=readerDocument(source,{locale:'zh-Hans',source:'account',preference:'zh-Hans',ownerId:'owner"<&',deviceHint:''});
 assert.ok(html.includes('正在展开书页'));
 assert.ok(html.includes('<script>'+script+'</script>'));assert.ok(html.includes('<style>'+style+'</style>'));assert.ok(html.includes('Opening the book… source'));assert.ok(html.includes('>Literal code</span>'));assert.ok(html.includes('>English source &lt; raw</textarea>'));assert.ok(html.includes('src="/reader-web/literal.js"'));assert.ok(html.includes('data-ui-initial-owner="owner&quot;&lt;&amp;"'));
});
test('CSP grants only the fixed parser-blocking bootstrap bytes on canonical entry pages',async()=>{
 const {contentSecurityPolicy}=await import('../server/content-security.mjs');const hash=createHash('sha256').update(UI_FIRST_PAINT_SCRIPT).digest('base64');
 for(const route of ['/library','/read']){const policy=contentSecurityPolicy(route);assert.ok(policy.includes("'sha256-"+hash+"'"));assert.ok(!policy.split(';').find(part=>part.trim().startsWith('script-src')).includes('unsafe-inline'));}
 assert.ok(!contentSecurityPolicy('/privacy').includes(hash));
});

test('hosted HTML handler keeps current URL query, uses exact templates and rejects ambiguous route markers',async t=>{
 const {createUiEntryHandler}=await import('../api/ui-entry.js');let calls=0;
 const handler=createUiEntryHandler({env:{READER_PUBLIC_ORIGIN:'https://leafhour.test'},readTemplate:async surface=>{calls++;return surface==='library'?await readFile(new URL('../app/home.html',import.meta.url),'utf8'):'<html lang="en"><head><title data-ui="reader.shell.pageTitle">Read</title></head><body><p data-ui="reader.shell.loading">Opening…</p></body></html>';},storeFactory:()=>{throw Error('explicit query must not initialize hosted auth');}});
 const server=createServer((req,res)=>handler(req,res));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const base='http://127.0.0.1:'+server.address().port,response=await fetch(base+'/api/ui-entry?__leafhour_surface=library&ui=zh-Hans&book=literal%2Fid');assert.equal(response.status,200);assert.match(response.headers.get('content-type'),/text\/html/);assert.match(response.headers.get('cache-control'),/private.*no-store/);assert.match(response.headers.get('vary'),/Cookie/);assert.match(response.headers.get('vary'),/Accept-Language/);assert.ok((await response.text()).includes('我的书房'));assert.equal(calls,1);
 const bad=await fetch(base+'/api/ui-entry?__leafhour_surface=library&__leafhour_surface=read&ui=ja');assert.equal(bad.status,400);assert.equal(calls,1);
});

test('root entry is localized without private indexing metadata and authored paths remain authoritative',async()=>{
 const {portalDocument}=await import('../server/portal-document.mjs'),source=await readFile(new URL('../app/home.html',import.meta.url),'utf8');
 const root=portalDocument(source,'/',{locale:'ja',source:'browser',preference:null,deviceHint:''});assert.match(root,/<html[^>]*lang="ja"/);assert.ok(root.includes('一冊の本に、<br>もう少し時間を。'));assert.match(root,/data-ui-first-paint/);assert.ok(root.includes('application/ld+json'));assert.ok(!root.includes('noindex,nofollow'));
 const authored=portalDocument(source,'/en',{locale:'ja',source:'page',preference:'ja'});assert.match(authored,/<html lang="en">/);assert.ok(!authored.includes('data-ui-first-paint'));
});
test('route normalization preserves literal business query bytes and rejects conflicting framework fields',async()=>{
 const {uiEntryTarget}=await import('../api/ui-entry.js');const value=uiEntryTarget({url:'/api/ui-entry?book=literal%2Fid&__leafhour_surface=read&source=a%20b&ui=ja&source=c'});
 assert.equal(value.url.pathname+value.url.search,'/read?book=literal%2Fid&source=a%20b&ui=ja&source=c');
 assert.throws(()=>uiEntryTarget({url:'/api/ui-entry?__leafhour_surface=read',query:{__leafhour_surface:'library'}}),error=>error.status===400);
});
test('hosted account selection is private and unavailable preferences return a native selected-language retry',async t=>{
 const {createUiEntryHandler}=await import('../api/ui-entry.js');let current=user,fail=false;
 const handler=createUiEntryHandler({env:{READER_PUBLIC_ORIGIN:'https://leafhour.test'},readTemplate:async()=>'<html lang="en"><head><title data-ui="reader.shell.pageTitle">Read</title></head><body><p data-ui="reader.shell.loading">Opening…</p></body></html>',storeFactory:()=>({}),authFactory:()=>({userFor:async()=>current}),preferencesFactory:()=>({get:async()=>{if(fail)throw Error('not available');return snapshot('ja');}})});
 const server=createServer((req,res)=>handler(req,res));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));const base='http://127.0.0.1:'+server.address().port;
 const response=await fetch(base+'/api/ui-entry?__leafhour_surface=read&book=literal%2Fid',{headers:{Cookie:'marginalia_session='+token}});assert.equal(response.status,200);const html=await response.text();assert.match(html,/data-ui-initial-source="account"/);assert.match(html,/data-ui-initial-owner="synthetic-owner"/);assert.match(html,/<html[^>]*lang="ja"/);
 fail=true;const unavailable=await fetch(base+'/api/ui-entry?__leafhour_surface=read&book=literal%2Fid&passage=p1',{headers:{Cookie:'marginalia_session='+token+'; '+cookie('ja')}});assert.equal(unavailable.status,503);assert.equal(unavailable.headers.get('retry-after'),'5');const retry=await unavailable.text();assert.match(retry,/<html lang="ja">/);assert.match(retry,/data-ui-initial-retry href="\/read\?book=literal%2Fid&amp;passage=p1"/);assert.ok(!retry.includes('type="module"'));assert.ok(!retry.includes('data-ui-initial-owner'));
});

test('self-hosted root, library and reader use the same query/device/account decision without JavaScript',async t=>{
 const {mkdtemp,rm}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),path=await import('node:path'),{createReaderServer}=await import('../server/server.mjs');
 const dir=await mkdtemp(path.join(tmpdir(),'leafhour-first-paint-'));
 const server=await createReaderServer({recordsPath:path.join(dir,'records.json'),env:{},sendCode:null,translator:null,chatGenerator:null,companionGenerator:null,introductionGenerator:null,speechProvider:null,annotationGenerator:null});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await rm(dir,{recursive:true,force:true});});const base='http://127.0.0.1:'+server.address().port;
 for(const route of ['/','/library','/read?book=gutenberg-alice']){
  const response=await fetch(base+route+(route.includes('?')?'&':'?')+'ui=zh-Hant',{headers:{'Accept-Language':'en'}});assert.equal(response.status,200);const html=await response.text();assert.match(html,/<html[^>]*lang="zh-Hant"/);assert.match(html,/data-ui-initial-source="page"/);assert.match(response.headers.get('cache-control'),/private.*no-store/);assert.match(response.headers.get('vary'),/Accept-Language/);
 }
 const session=await server.portal.auth.localSession();await server.portal.uiPreferences.save(session.user,{baseRevision:0,uiLocale:'ja'});
 const response=await fetch(base+'/library',{headers:{Cookie:'marginalia_session='+session.token+'; '+cookie('en','zh-Hans')}});const html=await response.text();assert.equal(response.status,200);assert.match(html,/<html[^>]*lang="ja"/);assert.match(html,/data-ui-initial-source="account"/);assert.match(html,/data-ui-initial-owner="local-owner"/);
 const root=await fetch(base+'/',{headers:{'Accept-Language':'ja;q=1,en;q=0.5'}});assert.equal(root.headers.get('x-robots-tag'),null);assert.ok((await root.text()).includes('application/ld+json'));
 for(const file of ['ui-first-paint-codec.mjs','ui-first-paint-bootstrap.mjs']){const asset=await fetch(base+'/'+file);assert.equal(asset.status,200);assert.match(asset.headers.get('content-type'),/javascript/);}
});

test('hosted canonical entries and private templates precede generic API routing and remain within packaging limits',async()=>{
 const config=JSON.parse(await readFile(new URL('../vercel.json',import.meta.url),'utf8'));
 assert.equal(Object.keys(config.functions)[0],'api/ui-entry.js','Vercel uses the first matching function pattern');
 assert.equal(config.functions['api/ui-entry.js'].includeFiles,'{app/home.html,.ui-entry/read.html}');
 for(const [pathname,surface]of [['/','home'],['/library','library'],['/read','read']]){
  const rule=config.rewrites.find(item=>item.source===pathname);assert.equal(rule.destination,'/api/ui-entry?__leafhour_surface='+surface);assert.ok(config.rewrites.indexOf(rule)<config.rewrites.findIndex(item=>item.source==='/api/:path*'));
 }
 assert.equal(config.cleanUrls,true,'the platform canonicalizes legacy .html entry URLs before rewrite routing');
});

test('charset stays early and the fixed classic bootstrap precedes module evaluation',async()=>{
 const {portalDocument}=await import('../server/portal-document.mjs'),{readerDocument}=await backend(),source=await readFile(new URL('../app/home.html',import.meta.url),'utf8');
 for(const html of [portalDocument(source,'/library',{locale:'ja',source:'page',preference:'ja'}),readerDocument('<html lang="en"><head><script>const sample="<meta charset=example>";</script></head><body></body></html>',{locale:'ja',source:'page',preference:'ja'})]){
  const charset=html.indexOf('<meta charset="utf-8">'),bootstrap=html.indexOf('<script data-ui-first-paint>');assert.ok(charset>=0&&charset<1024);assert.ok(charset<bootstrap);assert.ok(html.slice(bootstrap).startsWith('<script data-ui-first-paint>'));
 }
});
test('native canonical library links do not freeze browser or system-following language',async()=>{
 const {portalDocument}=await import('../server/portal-document.mjs'),source=await readFile(new URL('../app/home.html',import.meta.url),'utf8');
 for(const decision of [{locale:'ja',source:'browser',preference:null},{locale:'ja',source:'account',preference:'system',ownerId:user.id}]){
  const html=portalDocument(source,'/library',decision),hrefs=[...html.matchAll(/<a\b[^>]*href="(\/(?:library|read)(?:[?#][^"]*)?)"/g)].map(match=>match[1]);assert.ok(hrefs.length>0);assert.ok(hrefs.every(href=>!new URL(href.replaceAll('&amp;','&'),'https://leafhour.test').searchParams.has('ui')));
 }
 const fixed=portalDocument(source,'/library',{locale:'ja',source:'page',preference:'ja'});assert.ok(fixed.includes('href="/read?book=gutenberg-alice&amp;ui=ja"'));
});

test('owned internal entries normalize to canonical routes and reject role conflicts',async()=>{
 const {uiEntryTarget}=await import('../api/ui-entry.js');
 for(const [surface,canonical,alias]of [['home','/','/_ui/home'],['library','/library','/_ui/library'],['read','/read','/_ui/read']]){
  const target=uiEntryTarget({url:alias+'?book=a%2Fb&source=a%20b#literal'});assert.equal(target.surface,surface);assert.equal(target.internal,true);assert.equal(target.url.pathname+target.url.search+target.url.hash,canonical+'?book=a%2Fb&source=a%20b#literal');
  const normalized=uiEntryTarget({url:'/api/ui-entry?__leafhour_surface=internal-'+surface+'&book=a%2Fb'});assert.equal(normalized.surface,surface);assert.equal(normalized.internal,true);assert.equal(normalized.url.pathname,canonical);
  const ordinary=uiEntryTarget({url:'/api/ui-entry?__leafhour_surface='+surface});assert.equal(ordinary.internal,false);
  assert.throws(()=>uiEntryTarget({url:canonical+'?__leafhour_surface=internal-'+surface}),error=>error.status===400);
  assert.throws(()=>uiEntryTarget({url:alias+'?__leafhour_surface='+surface}),error=>error.status===400);
 }
 assert.throws(()=>uiEntryTarget({url:'/_ui/unknown?__leafhour_surface=library'}),error=>error.status===400);
});
test('Strict-session handoff is bounded to canonical cross-site entries without an authoritative ui or usable cookie',async()=>{
 const {needsUiSessionHandoff}=await backend();
 for(const route of ['/','/library','/read?book=a%2Fb#source']){
  const url=new URL(route,'https://leafhour.test');assert.equal(needsUiSessionHandoff({url,secFetchSite:'cross-site'}),true);
  assert.equal(needsUiSessionHandoff({url,secFetchSite:'cross-site',cookie:cookie('ja')}),true,'Lax language hint is not identity');
  assert.equal(needsUiSessionHandoff({url,secFetchSite:'cross-site',cookie:'marginalia_session=invalid'}),true);
  assert.equal(needsUiSessionHandoff({url,secFetchSite:'cross-site',cookie:'marginalia_session='+token}),false);
  for(const secFetchSite of ['same-origin','same-site','none',undefined])assert.equal(needsUiSessionHandoff({url,secFetchSite}),false);
  url.searchParams.set('ui','ja');assert.equal(needsUiSessionHandoff({url,secFetchSite:'cross-site'}),false);
  url.searchParams.append('ui','en');assert.equal(needsUiSessionHandoff({url,secFetchSite:'cross-site'}),true,'ambiguous ui is not a choice');
 }
 for(const route of ['/_ui/home','/_ui/library','/_ui/read','/en','/api/ui-entry'])assert.equal(needsUiSessionHandoff({url:new URL(route,'https://leafhour.test'),secFetchSite:'cross-site'}),false);
});
test('the session handoff document is language-neutral and has no app owner or module startup',async()=>{
 const {sessionUiHandoffDocument}=await backend(),html=sessionUiHandoffDocument(at('?book=a%2Fb#source'),{locale:'en',source:'browser',preference:null});
 assert.match(html,/data-ui-session-handoff="true"/);assert.ok(html.includes('<script data-ui-first-paint>'+UI_FIRST_PAINT_SCRIPT+'</script>'));assert.ok(!html.includes('type="module"'));assert.doesNotMatch(html,/<html[^>]*data-ui-initial-owner/);
 const body=html.match(/<body[^>]*>([\s\S]*?)<\/body>/)?.[1]||'';assert.doesNotMatch(body,/Opening|reading|正在|书房|書斎/);assert.match(html,/noindex/);
});
test('hosted Strict-session hop runs before language or template reads and aliases cannot loop',async t=>{
 const {createUiEntryHandler}=await import('../api/ui-entry.js');let serviceReads=0,templates=0;
 const handler=createUiEntryHandler({env:{READER_PUBLIC_ORIGIN:'https://leafhour.test'},storeFactory:()=>{serviceReads++;return {};},authFactory:()=>({userFor:async()=>user}),preferencesFactory:()=>({get:async()=>snapshot('ja')}),readTemplate:async()=>{templates++;return readFile(new URL('../app/home.html',import.meta.url),'utf8');}});
 const server=createServer((req,res)=>handler(req,res));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));const base='http://127.0.0.1:'+server.address().port;
 const first=await fetch(base+'/library?book=a%2Fb',{headers:{'Sec-Fetch-Site':'cross-site',Cookie:cookie('en')}});assert.equal(first.status,200);assert.match(await first.text(),/data-ui-session-handoff="true"/);assert.equal(serviceReads,0);assert.equal(templates,0);assert.match(first.headers.get('vary'),/Sec-Fetch-Site/);assert.equal(first.headers.get('set-cookie'),null);
 const viaFramework=await fetch(base+'/api/ui-entry?__leafhour_surface=library',{headers:{'Sec-Fetch-Site':'cross-site'}});assert.match(await viaFramework.text(),/data-ui-session-handoff="true"/);assert.equal(templates,0);
 const alias=await fetch(base+'/_ui/library?book=a%2Fb',{headers:{'Sec-Fetch-Site':'same-origin',Cookie:'marginalia_session='+token}});const html=await alias.text();assert.equal(alias.status,200);assert.doesNotMatch(html,/<html[^>]*data-ui-session-handoff/);assert.match(html,/data-ui-initial-locale="ja"/);assert.match(html,/data-ui-initial-source="account"/);assert.match(alias.headers.get('x-robots-tag'),/noindex/);assert.equal(templates,1);
 const noCookieAlias=await fetch(base+'/_ui/home',{headers:{'Sec-Fetch-Site':'cross-site'}});assert.equal(noCookieAlias.status,200);assert.doesNotMatch(await noCookieAlias.text(),/<html[^>]*data-ui-session-handoff/);assert.match(noCookieAlias.headers.get('x-robots-tag'),/noindex/);
});

test('self-hosted owned aliases retain the recovered account language and canonical CSP without another session hop',async t=>{
 const {mkdtemp,rm}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),path=await import('node:path'),{createReaderServer}=await import('../server/server.mjs');
 const dir=await mkdtemp(path.join(tmpdir(),'leafhour-ui-session-'));
 const server=await createReaderServer({recordsPath:path.join(dir,'records.json'),env:{},sendCode:null,translator:null,chatGenerator:null,companionGenerator:null,introductionGenerator:null,speechProvider:null,annotationGenerator:null});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await rm(dir,{recursive:true,force:true});});const base='http://127.0.0.1:'+server.address().port;
 const first=await fetch(base+'/library?book=a%2Fb',{headers:{'Sec-Fetch-Site':'cross-site'}});assert.equal(first.status,200);assert.match(await first.text(),/data-ui-session-handoff="true"/);assert.match(first.headers.get('vary'),/Sec-Fetch-Site/);
 const session=await server.portal.auth.localSession();await server.portal.uiPreferences.save(session.user,{baseRevision:0,uiLocale:'ja'});
 for(const alias of ['/_ui/home','/_ui/library','/_ui/read']){
  const response=await fetch(base+alias+'?book=gutenberg-alice',{headers:{Cookie:'marginalia_session='+session.token,'Sec-Fetch-Site':'same-origin'}}),html=await response.text();assert.equal(response.status,200,alias);assert.match(html,/<html[^>]*lang="ja"/);assert.match(html,/data-ui-initial-source="account"/);assert.doesNotMatch(html,/<html[^>]*data-ui-session-handoff/);assert.match(response.headers.get('x-robots-tag'),/noindex/);
  const {contentSecurityPolicy}=await import('../server/content-security.mjs'),canonical=alias==='/_ui/home'?'/':alias.replace('/_ui','');assert.equal(response.headers.get('content-security-policy'),contentSecurityPolicy(canonical));
 }
 const unknown=await fetch(base+'/_ui/unknown');assert.equal(unknown.status,404);
});
test('all owned alias rewrites carry an unambiguous internal role before generic routing',async()=>{
 const config=JSON.parse(await readFile(new URL('../vercel.json',import.meta.url),'utf8'));
 for(const [alias,surface]of [['/_ui/home','home'],['/_ui/library','library'],['/_ui/read','read']]){const rule=config.rewrites.find(row=>row.source===alias);assert.equal(rule.destination,'/api/ui-entry?__leafhour_surface=internal-'+surface);assert.ok(config.rewrites.indexOf(rule)<config.rewrites.findIndex(row=>row.source==='/api/:path*'));}
});
