import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parse} from 'acorn';
import vm from 'node:vm';
const source=await readFile(new URL('../app/reader-audio.js',import.meta.url),'utf8');
test('audio definition exposes an explicit mount without browser work on import',async()=>{
 const ast=parse(source,{ecmaVersion:'latest',sourceType:'module'});
 assert.ok(ast.body.some(n=>n.type==='ExportNamedDeclaration'&&n.declaration?.id?.name==='mountReaderAudio'),'pure explicit mount export');
 let body=source;const bindings={};
 for(const n of ast.body.filter(n=>n.type==='ImportDeclaration')){const values=await import(new URL('../app/'+n.source.value.slice(2),import.meta.url));for(const s of n.specifiers)bindings[s.local.name]=values[s.imported.name];}
 for(const n of [...ast.body].reverse()){if(n.type==='ImportDeclaration')body=body.slice(0,n.start)+body.slice(n.end);else if(n.type==='ExportNamedDeclaration')body=body.slice(0,n.start)+body.slice(n.declaration.start);}
 const mount=vm.runInNewContext(body+';mountReaderAudio',bindings);assert.equal(typeof mount,'function');
});
import {audioBoundaryFixture,flush,deferred,locale} from './audio-boundary-fixture.mjs';
const syntheticSession={id:'s',status:'ready',mode:'selection',language:'en',variant:'literal',contentVersion:'a'.repeat(64),chapterId:'ch01',clips:[{id:'clip',passageId:'p1',text:'Source',status:'ready'}]};
const click=(f,id)=>f.$(id).click();
test('no audio intent loads only one shared read-only metadata promise and honest real voice summary',async t=>{
 const f=await audioBoundaryFixture();t.after(()=>f.close());await flush();assert.equal(f.counts.imports,0);assert.equal(f.$('audio-dialog'),null);assert.deepEqual(f.calls.map(c=>c.url),['/api/audio/capabilities','/api/audio/preferences']);assert.match(f.$('settings-listening-summary').textContent,/Real voice 原名/);assert.match(f.$('settings-listening-summary').textContent,/1.5/);
 const before={...f.counts},calls=f.calls.length;for(const language of ['ja','zh-Hant','zh-Hans','en'])await locale.requestUiRoute(language);assert.equal(f.calls.length,calls);assert.equal(f.counts.reads,before.reads);assert.equal(f.counts.storage,before.storage);assert.equal(f.counts.imports,0);assert.equal(f.counts.uuid,0);
 click(f,'open-voice-settings');await flush();assert.equal(f.calls.filter(c=>c.url.endsWith('/capabilities')).length,1);assert.equal(f.calls.filter(c=>c.url.endsWith('/preferences')).length,1);assert.equal(f.$('audio-dialog').open,true);
});
for(const action of ['show-audio','listen-from-here','listen-chapter','open-voice-settings','settings-listening-records','export-listening','import-listening'])test('first '+action+' executes once after the same pending module, without synthetic activation',async t=>{
 const wait=deferred();const f=await audioBoundaryFixture({loader:async(_,module)=>{await wait.promise;return module;}});t.after(()=>f.close());await flush();click(f,action);if(action==='import-listening'){assert.equal(f.counts.picker,1);assert.equal(f.counts.imports,0);f.file({size:2,text:async()=> '{}'});}else click(f,action);await flush();assert.equal(f.counts.imports,1);assert.equal(f.$('audio-dialog'),null);wait.resolve();await flush();assert.equal(f.$('audio-dialog').open,true);assert.equal(f.counts.imports,1);assert.equal(f.document.querySelectorAll('audio').length,1);assert.equal(f.document.querySelectorAll('input[type="file"]').filter(n=>n.id==='audio-import-input').length,1);
 const actions=f.calls.filter(c=>!c.url.endsWith('/capabilities')&&!c.url.endsWith('/preferences')).map(c=>c.url);
 assert.deepEqual(actions,action==='show-audio'||action==='listen-from-here'?['/api/audio/prepare']:action==='settings-listening-records'?['/api/audio/records']:action==='export-listening'?['/api/audio/export']:action==='import-listening'?['/api/audio/validate','/api/audio/import','/api/audio/records']:[]);assert.equal(f.counts.uuid,0);
});
test('intent before uiReady preserves selected parts/language/variant until direct first dispatch',async t=>{
 const gate=deferred(),f=await audioBoundaryFixture({ready:gate.promise});t.after(()=>f.close());click(f,'show-audio');await flush();assert.equal(f.$('audio-dialog'),null);gate.resolve();await flush();const payload=JSON.parse(f.calls.find(c=>c.url.endsWith('/prepare')).options.body);assert.equal(payload.parts[0].start,3);assert.equal(payload.parts[0].end,9);assert.equal(payload.variant,'literal');assert.equal(payload.language,'en');assert.equal(payload.contentVersion,f.book.contentVersion);
});
for(const invalidation of ['selectionABA','ownerABA','bookABA','versionABA','cancel','pagehide','close','otherOverlay'])for(const outcome of ['success','failure'])test('pending '+outcome+' is consumed after '+invalidation+', with no stale surface',async t=>{
 const gate=deferred(),f=await audioBoundaryFixture({loader:async(_,module)=>{await gate.promise;return module;}});t.after(()=>f.close());await flush();if(invalidation==='close')f.$('settings-dialog').showModal();click(f,'show-audio');await flush();
 if(invalidation==='selectionABA'){f.select(null);f.select({chapterId:'ch01',parts:[{passageId:'p1',language:'en'}]});}else if(invalidation==='ownerABA'){f.session.user.id='owner-b';f.document.dispatchEvent(new Event('reader:session-changed'));f.session.user.id='owner-a';f.document.dispatchEvent(new Event('reader:session-changed'));}else if(invalidation==='bookABA'){f.setBook({...f.book,bookId:'b'});f.setBook(f.book);}else if(invalidation==='versionABA'){f.setBook({...f.book,contentVersion:'b'});f.setBook(f.book);}else if(invalidation==='cancel')click(f,'audio-bootstrap-cancel');else if(invalidation==='pagehide')f.event('pagehide',{persisted:true});else if(invalidation==='close')f.$('settings-dialog').close();else f.$('toc-dialog').showModal();
 if(outcome==='failure')gate.reject(Error('Private old failure'));else gate.resolve();await flush();assert.equal(f.calls.some(c=>c.url.endsWith('/prepare')),false);assert.equal(f.$('audio-dialog')?.open||false,false);assert.equal(f.$('audio-bootstrap-status').hidden,true);if(invalidation==='otherOverlay')assert.equal(f.$('toc-dialog').open,true);
});
test('explicit retry consumes only base and fixed retry URL; locale does not import or duplicate business',async t=>{
 let calls=0;const f=await audioBoundaryFixture({loader:async(_,module)=>{if(++calls===1)throw Error('Synthetic 503');return module;}});t.after(()=>f.close());click(f,'show-audio');await flush();assert.equal(f.$('audio-bootstrap-retry').hidden,false);await locale.requestUiRoute('ja');assert.equal(calls,1);click(f,'audio-bootstrap-retry');await flush();assert.deepEqual(f.loads,[false,true]);assert.equal(f.calls.filter(c=>c.url.endsWith('/prepare')).length,1);await locale.requestUiRoute('en');
});
test('second native loader failure exposes only explicit manual reload',async t=>{
 const f=await audioBoundaryFixture({loader:async()=>{throw Error('evaluation');}});t.after(()=>f.close());click(f,'listen-chapter');await flush();click(f,'audio-bootstrap-retry');await flush();assert.deepEqual(f.loads,[false,true]);assert.equal(f.$('audio-bootstrap-retry').hidden,true);assert.equal(f.$('audio-bootstrap-reload').hidden,false);assert.equal(f.counts.reload,undefined);click(f,'audio-bootstrap-reload');assert.equal(f.counts.reload,1);
});
test('file gesture snapshots owner before picker; late File is never read after invalidation',async t=>{
 const f=await audioBoundaryFixture();t.after(()=>f.close());click(f,'import-listening');assert.equal(f.counts.picker,1);f.session.user.id='other';f.document.dispatchEvent(new Event('reader:session-changed'));f.file({size:2,text:()=>assert.fail('stale file read')});await flush();assert.equal(f.counts.imports,0);assert.equal(f.$('audio-import-input').value,'');
});
for(const outcome of ['success','failure'])test('file module '+outcome+' after cancellation never consumes File',async t=>{
 const gate=deferred(),f=await audioBoundaryFixture({loader:async(_,module)=>{await gate.promise;return module;}});t.after(()=>f.close());click(f,'import-listening');f.file({size:2,text:()=>assert.fail('canceled file read')});await flush();click(f,'audio-bootstrap-cancel');if(outcome==='failure')gate.reject(Error('503'));else gate.resolve();await flush();assert.equal(f.calls.some(c=>c.url.endsWith('/validate')),false);assert.equal(f.$('audio-bootstrap-status').hidden,true);
});
test('persisted pagehide cancels pending intent but Back can mount from cached code',async t=>{
 const gate=deferred(),f=await audioBoundaryFixture({loader:async(_,module)=>{await gate.promise;return module;}});t.after(()=>f.close());click(f,'listen-chapter');await flush();f.event('pagehide',{persisted:true});gate.resolve();await flush();f.event('pageshow',{persisted:true});click(f,'listen-chapter');await flush();assert.equal(f.$('audio-dialog').open,true);assert.equal(f.counts.imports,1);
});
test('partial mount rollback removes media, dialog, player, observers and locale owner then allows a clean mount',async t=>{
 const f=await audioBoundaryFixture({failObserver:true});t.after(()=>f.close());click(f,'listen-chapter');await flush();assert.equal(f.$('audio-dialog'),null);assert.equal(f.$('audio-player'),null);assert.equal(f.document.querySelectorAll('audio').length,0);assert.equal(f.counts.disconnected,1);assert.equal(f.counts.unsubscribed,1);assert.equal(f.$('audio-bootstrap-retry').hidden,false);
});
for(const kind of ['position','job','request'])test('authorized '+kind+' restoration uses original marker once, without UUID/autoplay/dialog',async t=>{
 const pending={idempotencyKey:'original-id',intent:'intro',confirmProcessing:true,contentVersion:'a'.repeat(64),chapterId:'ch01'},markers=kind==='position'?{'marginalia-audio-position-v1':JSON.stringify({sessionId:'s',clipIndex:0,seconds:19})}:kind==='job'?{'leafhour-guide-job-v1':'j','leafhour-guide-request-v1':JSON.stringify(pending)}:{'leafhour-guide-request-v1':JSON.stringify(pending),'marginalia-audio-position-v1':JSON.stringify({sessionId:'s'})};
 const f=await audioBoundaryFixture({markers,request:url=>url.endsWith('/guides')||url.endsWith('/guides/j')?Response.json({id:'j',status:'preparing'}):url.endsWith('/sessions/s')?Response.json(syntheticSession):undefined});t.after(()=>f.close());await flush();assert.equal(f.counts.imports,1);assert.equal(f.counts.uuid,0);assert.equal(f.counts.play,0);assert.equal(f.$('audio-dialog').open,false);const business=f.calls.filter(c=>!c.url.endsWith('/capabilities')&&!c.url.endsWith('/preferences'));assert.equal(business.length,1);assert.equal(business[0].url,kind==='position'?'/api/audio/sessions/s':kind==='job'?'/api/audio/guides/j':'/api/audio/guides');if(kind==='request')assert.deepEqual(JSON.parse(business[0].options.body),pending);
});
test('locale while pending formats only cached loading/read-selection/summary leaves',async t=>{
 const gate=deferred(),f=await audioBoundaryFixture({loader:async(_,module)=>{await gate.promise;return module;}});t.after(()=>f.close());await flush();click(f,'show-audio');await flush();const reads=f.counts.reads,storage=f.counts.storage,calls=f.calls.length;await locale.requestUiRoute('ja');assert.equal(f.counts.reads,reads);assert.equal(f.counts.storage,storage);assert.equal(f.calls.length,calls);assert.equal(f.$('audio-bootstrap-message').textContent,locale.t('audioBootstrap.loading'));assert.equal(f.$('show-audio').textContent,locale.t('audio.readSelection'));gate.resolve();await flush();assert.equal(f.calls.filter(c=>c.url.endsWith('/prepare')).length,1);await locale.requestUiRoute('en');
});
test('file pipeline preserves size/validate/import/preferences/save/records order and never repeats succeeded import on failure',async t=>{
 let read=0;const f=await audioBoundaryFixture();t.after(()=>f.close());await flush();const initial=f.calls.length;click(f,'import-listening');f.file({size:32*1024*1024+1,text:()=>assert.fail('oversize read')});await flush();assert.equal(f.calls.length,initial);click(f,'import-listening');f.file({size:2,text:async()=>{read++;return '{}';}});await flush();assert.equal(read,1);assert.deepEqual(f.calls.slice(initial).map(c=>[c.url,c.options.method||'GET']),[['/api/audio/validate','POST'],['/api/audio/import','POST'],['/api/audio/preferences','GET'],['/api/audio/preferences','POST'],['/api/audio/records','GET']]);assert.equal(f.$('audio-import-input').value,'');assert.equal(f.$('audio-bootstrap-status').hidden,true);
});
for(const stage of ['text','validate','import','preferences'])test('file stops after '+stage+' when owner changes; no later file stage or private publication',async t=>{
 const gate=deferred();let armed=false;const f=await audioBoundaryFixture({request:(url,options)=>armed&&stage!=='text'&&url==='/api/audio/'+stage?gate.promise:undefined});t.after(()=>f.close());await flush();armed=true;click(f,'import-listening');f.file({size:2,text:()=>stage==='text'?gate.promise:Promise.resolve('{}')});await flush();const before=f.calls.length;f.session.user.id='other';f.document.dispatchEvent(new Event('reader:session-changed'));gate.resolve(stage==='text'?'{}':Response.json({}));await flush();assert.equal(f.calls.length,before);assert.equal(f.$('audio-dialog'),null);assert.equal(f.$('audio-import-input').value,'');
});
for(const outcome of ['success','failure'])test('selection ABA after dispatch consumes pending preparation '+outcome,async t=>{
 const gate=deferred();const f=await audioBoundaryFixture({request:url=>url.endsWith('/prepare')?gate.promise:undefined});t.after(()=>f.close());await flush();click(f,'show-audio');await flush();const before=f.$('audio-dialog').textContent;f.select(null);f.select({chapterId:'ch01',parts:[{passageId:'p1',language:'en'}]});if(outcome==='failure')gate.reject(Error('old private error'));else gate.resolve(Response.json({estimate:{seconds:1},clips:[{text:'old private source'}]}));await flush();assert.equal(f.$('audio-dialog').textContent,before);assert.equal(f.counts.uuid,0);
});
for(const markers of [{},{'marginalia-audio-preferences-v1':'{"speed":1.5}'},{'leafhour-guide-request-v1':'{broken','marginalia-audio-position-v1':'{broken'},{'leafhour-guide-request-v1':'{}','marginalia-audio-position-v1':'{}'}])test('no valid task marker never initializes media or resumes tasks '+JSON.stringify(markers),async t=>{
 const f=await audioBoundaryFixture({markers});t.after(()=>f.close());await flush();assert.equal(f.counts.imports,0);assert.equal(f.calls.length,2);assert.equal(f.counts.uuid,0);
});
test('storage exceptions and anonymous metadata keep the original read-only request condition',async t=>{
 const f=await audioBoundaryFixture({storageFail:true,anonymous:true});t.after(()=>f.close());await flush();assert.deepEqual(f.calls.map(c=>c.url),['/api/audio/capabilities']);assert.equal(f.counts.imports,0);
});
for(const status of [403,404,409])test('synthetic restore '+status+' retains old marker and never autoplays/starts a new task',async t=>{
 const markers={'marginalia-audio-position-v1':JSON.stringify({sessionId:'s'})},f=await audioBoundaryFixture({markers,request:url=>url.endsWith('/sessions/s')?Response.json({error:'Unavailable'},{status}):undefined});t.after(()=>f.close());await flush();assert.equal(f.storage.get('marginalia-audio-position-v1'),markers['marginalia-audio-position-v1']);assert.equal(f.counts.play,0);assert.equal(f.counts.uuid,0);assert.equal(f.calls.some(c=>c.options.method==='POST'),false);assert.equal(f.$('audio-dialog').open,false);
});
test('restore import failure preserves all markers and explicit intent retry shares the same one boot',async t=>{
 const markers={'marginalia-audio-position-v1':JSON.stringify({sessionId:'s'})};let n=0;const f=await audioBoundaryFixture({markers,loader:async(_,module)=>{if(!n++)throw Error('503');return module;},request:url=>url.endsWith('/sessions/s')?Response.json(syntheticSession):undefined});t.after(()=>f.close());await flush();assert.equal(f.$('audio-bootstrap-status').hidden,false);assert.equal(f.$('audio-dialog'),null);assert.equal(f.storage.get('marginalia-audio-position-v1'),markers['marginalia-audio-position-v1']);click(f,'listen-chapter');await flush();click(f,'audio-bootstrap-retry');await flush();assert.equal(f.calls.filter(c=>c.url.endsWith('/sessions/s')).length,1);assert.equal(f.counts.uuid,0);assert.equal(f.counts.play,0);assert.equal(f.$('audio-dialog').open,true);
});
test('initial not-ready reader restores once at reader:ready, concurrent first action shares mount and metadata',async t=>{
 const gate=deferred(),f=await audioBoundaryFixture({bookReady:false,markers:{'marginalia-audio-position-v1':'{"sessionId":"s"}'},loader:async(_,module)=>{await gate.promise;return module;},request:url=>url.endsWith('/sessions/s')?Response.json(syntheticSession):undefined});t.after(()=>f.close());await flush();assert.equal(f.calls.length,0);f.setBook(f.book);click(f,'listen-chapter');await flush();gate.resolve();await flush();assert.equal(f.counts.imports,1);assert.equal(f.calls.filter(c=>c.url.endsWith('/capabilities')).length,1);assert.equal(f.calls.filter(c=>c.url.endsWith('/sessions/s')).length,1);assert.equal(f.document.querySelectorAll('audio').length,1);assert.equal(f.$('audio-dialog').open,true);
});
test('ready guide restoration keeps no autoplay through real runner and session polling',async t=>{
 const f=await audioBoundaryFixture({markers:{'leafhour-guide-job-v1':'j'},request:url=>url.endsWith('/guides/j')?Response.json({id:'j',status:'ready',sessionId:'s'}):url.endsWith('/sessions/s')?Response.json(syntheticSession):url.includes('/clips/')?new Response(new Blob(['synthetic'])):undefined});t.after(()=>f.close());await flush();assert.equal(f.counts.play,0);assert.equal(f.counts.uuid,0);assert.equal(f.$('audio-dialog').open,false);assert.ok(f.calls.some(c=>c.url==='/api/audio/clips/clip'));
});
test('metadata failure remains honest before intent and old owner metadata cannot overwrite newer state',async t=>{
 const gate=deferred(),f=await audioBoundaryFixture({request:url=>url.endsWith('/preferences')?gate.promise:undefined});t.after(()=>f.close());await flush();f.session.user.id='other';f.document.dispatchEvent(new Event('reader:session-changed'));const before=f.$('settings-listening-summary').textContent;gate.resolve(Response.json({narrator:'private',speed:2}));await flush();assert.equal(f.$('settings-listening-summary').textContent,before);assert.equal(f.counts.imports,0);
 const failed=await audioBoundaryFixture({request:url=>url.endsWith('/preferences')?Response.json({error:'private'},{status:503}):undefined});t.after(()=>failed.close());await flush();assert.equal(failed.$('settings-listening-summary').textContent,locale.t('audioBootstrap.metadataFailed'));assert.equal(failed.counts.imports,0);
});
test('repeated direct mount and bootstrap return the same owner; disposal removes bindings without cancel API',async t=>{
 const f=await audioBoundaryFixture();t.after(()=>f.close());await flush();assert.equal(f.bootstrap.mountAudioBootstrap(f.params),f.handle);click(f,'listen-chapter');await flush();const mounted=f.audio.mountReaderAudio({document:f.document});assert.equal(f.audio.mountReaderAudio({document:f.document}),mounted);const before=f.calls.length;mounted.dispose();mounted.dispose();assert.equal(f.$('audio-dialog'),null);assert.equal(f.calls.length,before);assert.equal(f.counts.disconnected,1);
});
test('background restoration has a local retry/cancel surface without modal, focus, or canceling authorized server work',async t=>{
 let tries=0;const f=await audioBoundaryFixture({markers:{'marginalia-audio-position-v1':'{"sessionId":"s"}'},loader:async(_,module)=>{if(!tries++)throw Error('503');return module;},request:url=>url.endsWith('/sessions/s')?Response.json(syntheticSession):undefined});t.after(()=>f.close());const focused=f.document.activeElement;await flush();assert.equal(f.$('audio-bootstrap-status').hidden,false);assert.equal(f.$('audio-dialog'),null);assert.equal(f.document.activeElement,focused);click(f,'audio-bootstrap-retry');await flush();assert.equal(f.$('audio-bootstrap-status').hidden,true);assert.equal(f.$('audio-dialog').open,false);assert.equal(f.document.activeElement,focused);assert.equal(f.counts.play,0);assert.equal(f.calls.some(c=>c.url.includes('/cancel')),false);
});
test('the original records-panel import entry uses the same synchronous picker and file handler',async t=>{
 const f=await audioBoundaryFixture();t.after(()=>f.close());click(f,'settings-listening-records');await flush();const restore=f.$('audio-dialog').querySelectorAll('button').find(n=>n.textContent===locale.t('audio.restore'));restore.click();assert.equal(f.counts.picker,1);f.file({size:2,text:async()=> '{}'});await flush();assert.equal(f.calls.filter(c=>c.url.endsWith('/import')).length,1);assert.equal(f.document.querySelectorAll('input[type="file"]').filter(n=>n.id==='audio-import-input').length,1);
});
test('BFCache while metadata is pending can recover without publishing the canceled metadata',async t=>{
 const gate=deferred();let reads=0;const f=await audioBoundaryFixture({request:url=>url.endsWith('/preferences')&&++reads===1?gate.promise:undefined});t.after(()=>f.close());await flush();f.event('pagehide',{persisted:true});f.event('pageshow',{persisted:true});gate.resolve(Response.json({narrator:'Old private voice',speed:2}));await flush();click(f,'listen-chapter');await flush();assert.equal(f.$('audio-dialog').open,true);assert.match(f.$('settings-listening-summary').textContent,/Real voice 原名/);assert.doesNotMatch(f.$('settings-listening-summary').textContent,/Old private/);
});
test('capabilities failure preserves the old no-restore branch while the summary stays honest after mount',async t=>{
 const f=await audioBoundaryFixture({markers:{'marginalia-audio-position-v1':'{"sessionId":"s"}'},request:url=>url.endsWith('/capabilities')?Response.json({error:'Unavailable'},{status:503}):undefined});t.after(()=>f.close());await flush();assert.deepEqual(f.calls.map(c=>c.url),['/api/audio/capabilities']);assert.equal(f.$('settings-listening-summary').textContent,locale.t('audioBootstrap.metadataFailed'));assert.equal(f.counts.play,0);assert.equal(f.counts.uuid,0);
});
test('a settings summary changed by the mounted owner is not overwritten by its old eager metadata cache',async t=>{
 const f=await audioBoundaryFixture();t.after(()=>f.close());click(f,'open-voice-settings');await flush();const follow=f.$('audio-dialog').querySelector('input[type="checkbox"]');
 // The fixture parses static attributes; voice follow is set through the native
 // type property in production, so locate it by tag when no attribute exists.
 const check=follow||f.$('audio-dialog').querySelectorAll('input').find(n=>n.type==='checkbox');check.checked=true;check.onchange();await flush();await locale.requestUiRoute('ja');assert.equal(f.$('settings-listening-summary').textContent,locale.t('audio.summary',{voice:'Real voice 原名',speed:1.5,follow:locale.t('audio.following')}));await locale.requestUiRoute('en');
});
for(const persisted of [false,true])test('bootstrap pagehide preserves the mounted audio final position and pause exactly once, persisted='+persisted,async t=>{
 const f=await audioBoundaryFixture({markers:{'marginalia-audio-position-v1':'{"sessionId":"s"}'},request:url=>url.endsWith('/sessions/s')?Response.json(syntheticSession):undefined});t.after(()=>f.close());await flush();f.media.currentTime=37;const before=f.calls.length,pauses=f.counts.pause;f.event('pagehide',{persisted});await flush();assert.equal(JSON.parse(f.storage.get('marginalia-audio-position-v1')).seconds,37);assert.equal(f.calls.slice(before).filter(c=>c.url==='/api/audio/position').length,1);assert.equal(f.calls.some(c=>c.url.includes('/cancel')),false);assert.equal(f.counts.pause-pauses,1);if(persisted){f.event('pageshow',{persisted:true});click(f,'listen-chapter');await flush();assert.equal(f.$('audio-dialog').open,true);}else assert.equal(f.$('audio-dialog'),null);
});
test('a partial setup failure retries cleanly from cached code without duplicate metadata, media or bindings',async t=>{
 const f=await audioBoundaryFixture({failObserver:counts=>counts.observers===1});t.after(()=>f.close());click(f,'listen-chapter');await flush();assert.equal(f.$('audio-dialog'),null);assert.equal(f.counts.unsubscribed,1);click(f,'audio-bootstrap-retry');await flush();assert.equal(f.$('audio-dialog').open,true);assert.equal(f.document.querySelectorAll('audio').length,1);assert.equal(f.counts.imports,1);assert.equal(f.calls.filter(c=>c.url.endsWith('/capabilities')).length,1);assert.equal(f.counts.observers,2);assert.equal(f.counts.disconnected,1);
});

// Independent review counterexamples, retained as actual-owner regressions.
test('review R: cancel during mounted readiness prevents deferred restoration request and publication',async t=>{
 const gate=deferred();const pending={idempotencyKey:'authorized-original',intent:'intro',confirmProcessing:true,contentVersion:'a'.repeat(64),chapterId:'ch01'};
 const f=await audioBoundaryFixture({markers:{'leafhour-guide-request-v1':JSON.stringify(pending)},request:url=>url.endsWith('/preferences')?gate.promise:url.endsWith('/guides')?Response.json({id:'j',status:'preparing'}):undefined});t.after(()=>f.close());
 await flush();f.$('listen-chapter').click();await flush();assert.ok(f.$('audio-player'),'mount has started');f.$('audio-bootstrap-cancel').click();
 gate.resolve(Response.json({narrator:'Puck'}));await flush();
 assert.equal(f.calls.filter(c=>c.url==='/api/audio/guides').length,0,'canceled pending mount must not POST original pending request after metadata settles');
 assert.equal(f.$('audio-player')?.hidden??true,true,'canceled setup must not publish player');
});

test('review R: real reader selection-end invalidates pending source intent',async t=>{
 const gate=deferred();const f=await audioBoundaryFixture({loader:async(_,module)=>{await gate.promise;return module;}});t.after(()=>f.close());
 await flush();f.$('show-audio').click();await flush();
 // reader.js dismissTools emits selection-end, without reader:selection.
 f.reader.getAudioSelection=()=>null;f.reader.getExcerpt=()=>null;f.document.dispatchEvent(new Event('reader:selection-end'));
 gate.resolve();await flush();
 assert.equal(f.calls.filter(c=>c.url.endsWith('/prepare')).length,0,'ended selection must not be prepared after loading');
 assert.equal(f.$('audio-dialog')?.open??false,false);
});

test('review R: settings action keeps cancellation surface in active modal subtree',async t=>{
 const gate=deferred();const f=await audioBoundaryFixture({loader:async(_,module)=>{await gate.promise;return module;}});t.after(()=>{gate.resolve();f.close();});
 await flush();f.$('settings-dialog').showModal();f.$('open-voice-settings').click();await flush();
 const modal=f.document.querySelector('dialog[open]');
 assert.ok(!modal||modal.contains(f.$('audio-bootstrap-cancel')),'body sibling controls are inert under showModal');
});

test('review R: resize uses current viewport height rather than mount-time snapshot',async t=>{
 const f=await audioBoundaryFixture();t.after(()=>f.close());f.$('listen-chapter').click();await flush();
 let clearance;f.document.body.style.setProperty=(name,value)=>{if(name==='--audio-player-clearance')clearance=value;};
 f.$('audio-player').hidden=false;f.win.innerHeight=500;f.event('resize');
 assert.equal(clearance,'412px','500 viewport - 100 player top + 12');
});

test('review R: invalidated export failure cannot publish into newer voice panel',async t=>{
 const gate=deferred();const f=await audioBoundaryFixture({request:url=>url.endsWith('/export')?gate.promise:undefined});t.after(()=>f.close());
 await flush();f.$('export-listening').click();await flush();f.select(null);f.$('open-voice-settings').click();await flush();
 const before=f.$('audio-dialog').textContent;gate.resolve(Response.json({private:'old-export'}));await flush();
 assert.equal(f.$('audio-dialog').textContent,before,'stale export error must not change replacement panel');
});

for(const stage of ['guides','guides/j','sessions/s'])test('review R1: cancel unfinished restore at '+stage+' fences later stages without server cancellation',async t=>{
 const gate=deferred(),pending={idempotencyKey:'authorized-original',intent:'intro',confirmProcessing:true,contentVersion:'a'.repeat(64),chapterId:'ch01'};
 const markers=stage==='guides'?{'leafhour-guide-request-v1':JSON.stringify(pending)}:stage==='guides/j'?{'leafhour-guide-job-v1':'j'}:{'marginalia-audio-position-v1':'{"sessionId":"s"}'};
 const f=await audioBoundaryFixture({markers,request:url=>url==='/api/audio/'+stage?gate.promise:undefined});t.after(()=>f.close());await flush();click(f,'listen-chapter');await flush();const before=f.calls.length;click(f,'audio-bootstrap-cancel');assert.equal(f.$('audio-player'),null);
 gate.resolve(Response.json(stage==='sessions/s'?syntheticSession:{id:'j',status:'ready',sessionId:'s'}));await flush();assert.equal(f.calls.length,before);assert.equal(f.$('audio-player'),null);assert.equal(f.calls.some(c=>c.url.includes('/cancel')),false);assert.equal(f.counts.uuid,0);assert.equal(f.counts.play,0);
});
test('review R1: cancel retains completed playback owner and a new action reuses it',async t=>{
 const f=await audioBoundaryFixture({markers:{'marginalia-audio-position-v1':'{"sessionId":"s"}'},request:url=>url.endsWith('/sessions/s')?Response.json(syntheticSession):undefined});t.after(()=>f.close());await flush();const player=f.$('audio-player'),media=f.media;click(f,'listen-chapter');click(f,'audio-bootstrap-cancel');await flush();assert.equal(f.$('audio-player'),player);assert.equal(f.media,media);assert.equal(player.hidden,false);click(f,'listen-chapter');await flush();assert.equal(f.$('audio-dialog').open,true);assert.equal(f.calls.filter(c=>c.url.endsWith('/sessions/s')).length,1);assert.equal(f.counts.observers,1);
});
for(const action of ['show-audio','listen-from-here'])test('review R3: committed '+action+' tolerates its own real synchronous dismissal but later end fences response',async t=>{
 const gate=deferred(),f=await audioBoundaryFixture({request:url=>url.endsWith('/prepare')?gate.promise:undefined});t.after(()=>f.close());f.reader.dismissTools=()=>{f.reader.getExcerpt=f.reader.getAudioSelection=()=>null;f.document.dispatchEvent(new Event('reader:selection-end'));};click(f,action);await flush();assert.equal(f.calls.filter(c=>c.url.endsWith('/prepare')).length,1);assert.equal(f.$('show-audio').textContent,locale.t('audio.read'));const before=f.$('audio-dialog').textContent;f.document.dispatchEvent(new Event('reader:selection-end'));gate.resolve(Response.json({clips:[{text:'stale selection'}],estimate:{seconds:1}}));await flush();assert.equal(f.$('audio-dialog').textContent,before);
});
test('review R4: failed settings load keeps retry and cancel interactive with owned focus',async t=>{
 const f=await audioBoundaryFixture({loader:async()=>{throw Error('503');}});t.after(()=>f.close());await flush();const modal=f.$('settings-dialog'),trigger=f.$('open-voice-settings');modal.showModal();trigger.focus();click(f,'open-voice-settings');await flush();assert.ok(modal.contains(f.$('audio-bootstrap-retry')));assert.equal(f.document.activeElement,f.$('audio-bootstrap-retry'));click(f,'audio-bootstrap-cancel');assert.equal(f.document.activeElement,trigger);assert.equal(f.$('audio-bootstrap-status').parentElement,f.document.body);assert.equal(modal.open,true);
});
test('review R4: mounted records picker observes dynamic modal close before consuming File',async t=>{
 const f=await audioBoundaryFixture();t.after(()=>f.close());click(f,'settings-listening-records');await flush();const dialog=f.$('audio-dialog'),restore=dialog.querySelectorAll('button').find(n=>n.textContent===locale.t('audio.restore'));restore.focus();restore.click();dialog.close();f.file({size:2,text:()=>assert.fail('closed picker read')});await flush();assert.equal(f.calls.some(c=>c.url.endsWith('/validate')),false);assert.equal(dialog.open,false);assert.equal(f.$('audio-bootstrap-status').hidden,true);
});
test('review R4: mounted records import waiting for ready keeps loading inside its modal',async t=>{
 const f=await audioBoundaryFixture();t.after(()=>f.close());click(f,'settings-listening-records');await flush();const dialog=f.$('audio-dialog'),restore=dialog.querySelectorAll('button').find(n=>n.textContent===locale.t('audio.restore'));restore.focus();restore.click();f.file({size:2,text:async()=> '{}'});assert.ok(dialog.contains(f.$('audio-bootstrap-cancel')));click(f,'audio-bootstrap-cancel');await flush();assert.equal(f.document.activeElement,restore);assert.equal(f.calls.some(c=>c.url.endsWith('/validate')),false);assert.equal(dialog.open,true);
});
for(const outcome of ['resolve','reject'])test('review R6: panel replacement alone fences export '+outcome+' and download',async t=>{
 const gate=deferred(),f=await audioBoundaryFixture({request:url=>url.endsWith('/export')?gate.promise:undefined});t.after(()=>f.close());click(f,'export-listening');await flush();click(f,'open-voice-settings');await flush();const before=f.$('audio-dialog').textContent;const creates=f.counts.downloads||0;if(outcome==='resolve')gate.resolve(Response.json({private:'stale'}));else gate.reject(Error('old private failure'));await flush();assert.equal(f.$('audio-dialog').textContent,before);assert.equal(f.counts.downloads||0,creates);
});
test('review R4: a newer modal opened above settings keeps focus after old loader failure',async t=>{
 const gate=deferred(),f=await audioBoundaryFixture({loader:async()=>{await gate.promise;throw Error('old failure');}});t.after(()=>f.close());await flush();const settings=f.$('settings-dialog');settings.showModal();click(f,'open-voice-settings');await flush();const newer=f.document.createElement('dialog'),button=f.document.createElement('button');newer.append(button);f.document.body.append(newer);newer.showModal();button.focus();gate.resolve();await flush();assert.equal(f.document.activeElement,button);assert.equal(f.$('audio-bootstrap-status').hidden,true);assert.equal(newer.open,true);assert.equal(settings.open,true);
});
test('review R5: follow visibility uses resized height when playback starts',async t=>{
 const f=await audioBoundaryFixture({markers:{'marginalia-audio-position-v1':'{"sessionId":"s"}'},request:url=>url.endsWith('/sessions/s')?Response.json(syntheticSession):url.endsWith('/preferences')?Response.json({follow:true}):url.includes('/clips/')?new Response(new Blob(['synthetic'])):undefined});t.after(()=>f.close());await flush();const p=f.document.createElement('p');p.id='p1';p.getBoundingClientRect=()=>({top:150,bottom:400});f.document.body.append(p);let went=0;f.reader.goToPassage=()=>went++;f.win.innerHeight=500;click(f,'audio-toggle');await flush();assert.equal(went,1);
});
test('review R1: canceled initialization can remount cached code on new intent with original restoration payload',async t=>{
 const gate=deferred(),pending={idempotencyKey:'authorized-original',intent:'intro',confirmProcessing:true,contentVersion:'a'.repeat(64),chapterId:'ch01'};
 const f=await audioBoundaryFixture({markers:{'leafhour-guide-request-v1':JSON.stringify(pending)},request:url=>url.endsWith('/preferences')?gate.promise:url.endsWith('/guides')?Response.json({id:'j',status:'preparing'}):undefined});t.after(()=>f.close());await flush();click(f,'listen-chapter');await flush();click(f,'audio-bootstrap-cancel');gate.resolve(Response.json({narrator:'Puck'}));await flush();assert.equal(f.$('audio-player'),null);click(f,'listen-chapter');await flush();const requests=f.calls.filter(c=>c.url==='/api/audio/guides');assert.equal(requests.length,1);assert.deepEqual(JSON.parse(requests[0].options.body),pending);assert.equal(f.$('audio-dialog').open,true);assert.equal(f.document.querySelectorAll('audio').length,1);assert.equal(f.counts.imports,1);assert.equal(f.counts.uuid,0);assert.equal(f.counts.play,0);assert.equal(f.calls.some(c=>c.url.includes('/cancel')),false);
});

// Run the real reader event callbacks and dismissTools together with the actual
// bootstrap. The small DOM fixture does not bubble events, so invoke the owner
// callback explicitly after the control's target listener, as in the review probe.
const readerEventSource=await readFile(new URL('../app/reader.js',import.meta.url),'utf8');
const readerEventAst=parse(readerEventSource,{ecmaVersion:'latest',sourceType:'module'});
function readerRecoveryEvents(f){
 const effects={dismiss:0,closed:0,captured:0,fullscreen:0};
 const context=vm.createContext({document:f.document,$:f.$,book:f.book,getSelection:()=>null,selectedExcerpt:null,selectionKind:'passage',highlights:{updateTools(){effects.dismiss++;}},clearPanelTextHighlight(){},closePanel(){effects.closed++;},captureExcerpt(){effects.captured++;},readerInteractionBlocked:()=>false,readerTools:{toolbar:{conceal(){}}},immersion:{toggleFullscreen(){effects.fullscreen++;}},CustomEvent:class extends Event{constructor(name){super(name);}}});
 const dismiss=readerEventAst.body.find(n=>n.type==='FunctionDeclaration'&&n.id.name==='dismissTools');
 vm.runInContext(readerEventSource.slice(dismiss.start,dismiss.end),context);f.reader.dismissTools=context.dismissTools;
 const handlers={};for(const type of ['click','pointerup','keyup','keydown']){const node=readerEventAst.body.find(n=>n.type==='ExpressionStatement'&&n.expression.type==='CallExpression'&&n.expression.callee.name==='listen'&&n.expression.arguments[0]?.name==='document'&&n.expression.arguments[1]?.value===type).expression.arguments[2];handlers[type]=vm.runInContext('('+readerEventSource.slice(node.start,node.end)+')',context);}
 return {effects,...handlers};
}
for(const action of ['show-audio','listen-from-here'])test('review R7: '+action+' retry survives real reader click and dispatch dismissal exactly once',async t=>{
 let loads=0;const f=await audioBoundaryFixture({loader:async(_,module)=>{if(++loads===1)throw Error('503');return module;}});t.after(()=>f.close());const events=readerRecoveryEvents(f);await flush();click(f,action);events.click({target:f.$(action)});await flush();assert.equal(f.$('audio-bootstrap-retry').hidden,false);const target=f.$('audio-bootstrap-retry');target.click();events.click({target});await flush();assert.equal(loads,2);assert.equal(f.calls.filter(c=>c.url.endsWith('/prepare')).length,1);assert.equal(f.$('audio-dialog').open,true);assert.equal(events.effects.dismiss,1,'only the committed action dismisses the selection');
});
for(const control of ['retry','cancel','reload'])test('review R7: recovery '+control+' keeps click and selection keyboard events inside its surface',async t=>{
 let loads=0;const f=await audioBoundaryFixture({loader:async()=>{loads++;throw Error('503');}});t.after(()=>f.close());const events=readerRecoveryEvents(f);await flush();click(f,'show-audio');await flush();if(control==='reload'){click(f,'audio-bootstrap-retry');await flush();}const target=f.$('audio-bootstrap-'+control);assert.equal(target.hidden,false);target.focus();events.pointerup({target,button:0,clientY:100});events.keyup({target,key:'Shift',shiftKey:true});events.keydown({target,key:'f',defaultPrevented:false,preventDefault(){}});events.keydown({target,key:'Escape',defaultPrevented:false,preventDefault(){}});target.click();events.click({target});await flush();assert.deepEqual(events.effects,{dismiss:0,closed:0,captured:0,fullscreen:0});if(control==='retry'){assert.equal(loads,2);assert.equal(f.$('audio-bootstrap-reload').hidden,false);}if(control==='cancel'){assert.equal(loads,1);assert.equal(f.$('audio-bootstrap-status').hidden,true);}if(control==='reload')assert.equal(f.counts.reload,1);
});
for(const end of ['outside-click','selection-end'])test('review R7: '+end+' still cancels waiting retry independently of recovery controls',async t=>{
 const gate=deferred();let loads=0;const f=await audioBoundaryFixture({loader:async(_,module)=>{if(++loads===1)throw Error('503');await gate.promise;return module;}});t.after(()=>f.close());const events=readerRecoveryEvents(f);await flush();click(f,'show-audio');await flush();const target=f.$('audio-bootstrap-retry');target.click();events.click({target});await flush();assert.equal(loads,2);assert.equal(f.$('audio-bootstrap-status').hidden,false);if(end==='outside-click')events.click({target:f.document.body});else f.document.dispatchEvent(new Event('reader:selection-end'));gate.resolve();await flush();assert.equal(f.calls.filter(c=>c.url.endsWith('/prepare')).length,0);assert.equal(f.$('audio-dialog')?.open??false,false);assert.equal(f.$('audio-bootstrap-status').hidden,true);
});
test('review R7: ordinary reader pointer and keyboard callbacks remain active outside recovery surface',async t=>{
 const f=await audioBoundaryFixture();t.after(()=>f.close());const events=readerRecoveryEvents(f),target=f.document.body;events.pointerup({target,button:0,clientY:100});events.keyup({target,key:'Shift',shiftKey:true});events.keydown({target,key:'f',defaultPrevented:false,preventDefault(){}});events.keydown({target,key:'Escape',defaultPrevented:false,preventDefault(){}});assert.equal(events.effects.captured,2);assert.equal(events.effects.fullscreen,1);
});

import {mediaConfiguration} from '../server/media-config.mjs';
const builtinVoices=mediaConfiguration({}).public.voices;
test('canonical voice UI: eager and mounted Kore descriptors follow locale without business effects',async t=>{
 await locale.requestUiRoute('en');const f=await audioBoundaryFixture({request:url=>url.endsWith('/capabilities')?Response.json({local:true,speechAvailable:true,dialogueAvailable:true,voices:builtinVoices}):url.endsWith('/preferences')?Response.json({narrator:'Kore',guide:'Charon',questioner:'Puck',speed:1.5,follow:false}):undefined});t.after(async()=>{f.close();await locale.requestUiRoute('en');});await flush();assert.equal(f.counts.imports,0);assert.equal(f.$('settings-listening-summary').textContent,locale.t('audio.summary',{voice:'Steady',speed:1.5,follow:locale.t('audio.freeReading')}));
 const firstCalls=f.calls.length,firstReads=f.counts.reads,firstStorage=f.counts.storage;await locale.requestUiRoute('ja');assert.match(f.$('settings-listening-summary').textContent,/落ち着いた声/);assert.equal(f.counts.imports,0);assert.equal(f.calls.length,firstCalls);assert.equal(f.counts.reads,firstReads);assert.equal(f.counts.storage,firstStorage);
 click(f,'open-voice-settings');await flush();const dialog=f.$('audio-dialog'),narrator=dialog.querySelector('select'),options=[...narrator.options],description=dialog.querySelector('.audio-policy');assert.equal(narrator.value,'Kore');assert.equal(options.find(o=>o.value==='Kore').textContent,'落ち着いた声');assert.equal(description.textContent,'芯のある声で、ゆったりと読みます');
 const calls=f.calls.length,reads=f.counts.reads,storage=f.counts.storage;narrator.focus();for(const lang of ['en','zh-Hant','zh-Hans','ja']){await locale.requestUiRoute(lang);assert.equal(narrator.value,'Kore');assert.equal(f.document.activeElement,narrator);for(const option of options)assert.equal(option.textContent,locale.t('audio.voice.'+option.value+'.label'));assert.equal(description.textContent,locale.t('audio.voice.Kore.description'));assert.equal(f.calls.length,calls);assert.equal(f.counts.reads,reads);assert.equal(f.counts.storage,storage);}assert.equal(f.calls.some(c=>c.options.method==='POST'),false);assert.equal(f.counts.uuid,0);assert.equal(f.counts.play,0);
});
for(const id of ['Kore','CustomVoice'])test('canonical voice UI: custom '+id+' label and description remain literal',async t=>{
 await locale.requestUiRoute('en');const voice={id,label:'沉稳 {audio.voice.Kore.label} custom',description:'Custom description {audio.voice.Kore.description}'};const f=await audioBoundaryFixture({request:url=>url.endsWith('/capabilities')?Response.json({voices:[voice]}):url.endsWith('/preferences')?Response.json({narrator:id}):undefined});t.after(async()=>{f.close();await locale.requestUiRoute('en');});await flush();assert.ok(f.$('settings-listening-summary').textContent.includes(voice.label));click(f,'open-voice-settings');await flush();const select=f.$('audio-dialog').querySelector('select'),description=f.$('audio-dialog').querySelector('.audio-policy'),calls=f.calls.length;await locale.requestUiRoute('ja');assert.equal(select.value,id);assert.equal(select.options[0].textContent,voice.label);assert.equal(description.textContent,voice.description);assert.ok(f.$('settings-listening-summary').textContent.includes(voice.label));assert.equal(f.calls.length,calls);
});
test('canonical voice UI: restored player metadata retains descriptor across locale commits',async t=>{
 await locale.requestUiRoute('en');const session={...syntheticSession,clips:syntheticSession.clips.map(c=>({...c,voice:'Kore'}))};const f=await audioBoundaryFixture({markers:{'marginalia-audio-position-v1':'{"sessionId":"s"}'},request:url=>url.endsWith('/capabilities')?Response.json({voices:builtinVoices}):url.endsWith('/preferences')?Response.json({narrator:'Kore'}):url.endsWith('/sessions/s')?Response.json(session):undefined});t.after(async()=>{f.close();await locale.requestUiRoute('en');});await flush();assert.ok(f.$('audio-now-meta').textContent.includes('Steady'));const calls=f.calls.length;await locale.requestUiRoute('ja');assert.ok(f.$('audio-now-meta').textContent.includes('落ち着いた声'));assert.equal(f.calls.length,calls);assert.equal(f.counts.play,0);
});
test('canonical voice UI: helper recognizes only exact server identity and field pairs',async()=>{
 const helper=await import('../app/reader-audio-metadata.mjs');assert.equal(typeof helper.audioVoiceUi,'function');for(const voice of builtinVoices)for(const field of ['label','description']){const value=helper.audioVoiceUi(voice,field);assert.equal(value.id,'audio.voice.'+voice.id+'.'+field);assert.deepEqual(value.params,{});assert.equal(helper.audioVoiceUi({...voice,[field]:voice[field]+' custom'},field),voice[field]+' custom');assert.equal(helper.audioVoiceUi({...voice,id:'unknown'},field),voice[field]);}assert.equal(helper.audioVoiceUi(undefined,'label'),undefined);
});

function bubbleAudioPickerClick(f,events){const input=f.$('audio-import-input'),pick=input.click;input.click=()=>{pick.call(input);input.dispatchEvent(new Event('click'));events.click({target:input});};}
test('review R8: first settings File survives its hidden input click through the real reader handler',async t=>{
 const f=await audioBoundaryFixture();t.after(()=>f.close());const events=readerRecoveryEvents(f);bubbleAudioPickerClick(f,events);await flush();assert.equal(f.counts.imports,0);f.$('settings-dialog').showModal();click(f,'import-listening');events.click({target:f.$('import-listening')});assert.equal(f.counts.picker,1);assert.equal(f.counts.imports,0);let reads=0;f.file({size:2,text:async()=>{reads++;return '{}';}});await flush();assert.equal(reads,1);assert.equal(f.counts.imports,1);assert.equal(f.calls.filter(c=>c.url.endsWith('/validate')).length,1);assert.equal(f.calls.filter(c=>c.url.endsWith('/import')).length,1);assert.equal(f.$('audio-dialog').open,true);assert.equal(f.$('audio-import-input').value,'');assert.equal(events.effects.dismiss,0);assert.equal(f.counts.uuid,0);assert.equal(f.counts.play,0);
});
for(const cancel of ['selection-end','owner','overlay-close','new-overlay'])test('review R8: genuine '+cancel+' still cancels the File captured after the owned input click',async t=>{
 const f=await audioBoundaryFixture();t.after(()=>f.close());const events=readerRecoveryEvents(f);bubbleAudioPickerClick(f,events);await flush();f.$('settings-dialog').showModal();click(f,'import-listening');assert.equal(events.effects.dismiss,0,'owned input must not dismiss selection before genuine cancellation');if(cancel==='selection-end')f.document.dispatchEvent(new Event('reader:selection-end'));else if(cancel==='owner'){f.session.user.id='other';f.document.dispatchEvent(new Event('reader:session-changed'));}else if(cancel==='overlay-close')f.$('settings-dialog').close();else{const newer=f.document.createElement('dialog');f.document.body.append(newer);newer.showModal();}
 f.file({size:2,text:()=>assert.fail('canceled file read')});await flush();assert.equal(f.calls.some(c=>c.url.endsWith('/validate')||c.url.endsWith('/import')),false);assert.equal(f.$('audio-dialog')?.open??false,false);assert.equal(f.$('audio-import-input').value,'');
});
test('review R8: reader still dismisses on an unrelated input click',async t=>{
 const f=await audioBoundaryFixture();t.after(()=>f.close());const events=readerRecoveryEvents(f),input=f.document.createElement('input');input.id='unrelated-file-input';input.type='file';f.document.body.append(input);events.click({target:input});assert.equal(events.effects.dismiss,1);assert.equal(events.effects.closed,1);
});
