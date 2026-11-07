import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {request as httpRequest} from 'node:http';
import vm from 'node:vm';
import {fixture as domFixture} from './annotation-dom-fixture.mjs';
import {openingReadingPreferences} from '../app/reading-preferences.mjs';
import {createSafariFixture} from '../tools/get273-safari-fixture.mjs';

const commit='a'.repeat(40),sha=value=>createHash('sha256').update(value).digest('hex');
async function setup(t){
 const root=await mkdtemp(path.join(process.env.GET273_TEST_ROOT||tmpdir(),'safari-fixture-'));await mkdir(path.join(root,'reader-web'));
 const script='globalThis.readerFixtureLoaded=true;';
 await writeFile(path.join(root,'reader-web/reader.js'),script);await writeFile(path.join(root,'reader-account.mjs'),script);await writeFile(path.join(root,'release.json'),JSON.stringify({sourceCommit:commit}));
 await writeFile(path.join(root,'offline-resources.json'),JSON.stringify({resources:['/reader-web/reader.js','/reader-account.mjs'].map(url=>({url,bytes:Buffer.byteLength(script),sha256:sha(script)}))}));
 const template='<!doctype html><html><head><meta charset="utf-8"><script type="module" src="/reader-web/reader.js"></script></head><body><main id="chapter-text"></main></body></html>';
 const fixture=await createSafariFixture({buildRoot:root,template,sourceCommit:commit});const base=await fixture.listen();
 t.after(async()=>{await fixture.close();await rm(root,{recursive:true,force:true});});
 const request=(route,options={})=>fetch(base+route,{...options,headers:{Origin:base,...options.headers}});
 const post=(route,value,headers)=>request(route,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(value)});
 return {root,fixture,base,request,post};
}
test('serves immutable built assets and parser-blocking observation before all reader scripts',async t=>{
 const f=await setup(t),response=await f.request('/read?book=touch-fixture&ui=en'),html=await response.text();
 assert.equal(response.status,200);assert.ok(html.indexOf('/qa/observer.js')<html.indexOf('data-ui-first-paint'));assert.ok(html.indexOf('/qa/observer.js')<html.indexOf('src="/reader-web/reader.js"'));
 const observerTag=html.match(/<script[^>]*src="\/qa\/observer.js"[^>]*>/)[0];assert.doesNotMatch(observerTag,/async|defer|type=/);
 assert.match(response.headers.get('content-security-policy'),/connect-src 'self'/);assert.doesNotMatch(response.headers.get('content-security-policy'),/img-src[^;]*https:/);
 assert.equal((await f.request('/reader-web/reader.js')).status,200);
 assert.equal((await f.request('/reader-account.mjs?retry=1')).status,200);assert.equal((await f.request('/reader-account.mjs?retry=2')).status,403);
 await writeFile(path.join(f.root,'reader-web/reader.js'),'altered after freeze');assert.equal(await(await f.request('/reader-web/reader.js')).text(),'globalThis.readerFixtureLoaded=true;');
});
test('only exact synthetic methods, paths and payloads succeed; generation and other books fail closed',async t=>{
 const f=await setup(t),book=await(await f.request('/api/library/books/touch-fixture/reading')).json();assert.equal(book.bookId,'touch-fixture');assert.ok(book.readingCache.chapters['fixture-c']);
 assert.equal((await f.post('/api/library/reading-guide',{bookId:'touch-fixture',contentVersion:'fixture-v1',sourceKind:'cloud',locale:'en',action:'view'})).status,200);
 for(const action of ['ensure','retry','generate'])assert.equal((await f.post('/api/library/reading-guide',{bookId:'touch-fixture',action})).status,403);
 for(const route of ['/api/library/books/other/reading','/api/library/books/touch-fixture/chat','/api/library/books/touch-fixture/comments','/qa/exec','/qa/storage'])assert.equal((await f.post(route,{})).status,403);
 assert.equal((await f.request('/api/library/books/touch-fixture/reading?token=secret-marker')).status,403);
 assert.equal((await f.request('/api/library/books/touch-fixture/reading?passageId=fixture-p0')).status,200);
 assert.equal((await f.request('/api/library/books/touch-fixture/reading?passageId=other')).status,403);
 assert.doesNotMatch(JSON.stringify(f.fixture.report()),/secret-marker/);
});
test('rejects cross-origin and hostile Host requests without storing supplied credentials or bodies',async t=>{
 const f=await setup(t);
 assert.equal((await f.request('/api/auth/session',{headers:{Origin:'http://other.invalid',Cookie:'synthetic-private-marker',Authorization:'synthetic-private-marker'}})).status,403);
 const hostile=await new Promise((resolve,reject)=>{const req=httpRequest(f.base+'/api/auth/session',{headers:{Host:'other.invalid'}},res=>{res.resume();resolve(res.statusCode);});req.on('error',reject);req.end();});assert.equal(hostile,403);
 assert.equal((await f.request('/api/auth/session',{headers:{'X-Reader-Owner':'other-owner-marker'}})).status,403);
 const session=await(await f.request('/api/auth/session',{headers:{Cookie:'synthetic-private-marker',Authorization:'synthetic-private-marker'}})).json();assert.equal(session.user.id,'synthetic-touch-owner');
 assert.doesNotMatch(JSON.stringify(f.fixture.report()),/synthetic-private-marker|other-owner-marker/);
});
test('collector accepts only exact known synthetic text and never promotes client observations to OS acceptance',async t=>{
 const f=await setup(t),run=f.fixture.runId,documentId='b'.repeat(32),base={run,documentId,seq:0,t:0,trusted:false};
 assert.equal((await f.post('/qa/events',{...base,kind:'observer-ready'})).status,204);
 const event={...base,seq:1,t:500,kind:'selection',trusted:true,collapsed:false,parts:[{passageId:'fixture-p0',layer:'original',variant:'interpretive',start:7,end:12,text:'grows'}]};
 assert.equal((await f.post('/qa/events',event)).status,204);
 assert.equal((await f.post('/qa/events',{...event,seq:2,parts:[{...event.parts[0],text:'private-unknown-marker'}]})).status,403);
 for(const variant of ['private-variant-marker',{secret:'private-variant-marker'}])assert.equal((await f.post('/qa/events',{...event,seq:2,parts:[{...event.parts[0],variant}]})).status,403);
 const missing={...event.parts[0]};delete missing.variant;assert.equal((await f.post('/qa/events',{...event,seq:2,parts:[missing]})).status,403);
 assert.equal((await f.post('/qa/events',{...base,seq:3,kind:'observer-ready',cookies:'private-unknown-marker'})).status,403);
 const report=await(await f.request('/qa/evidence')).json();assert.equal(report.nativeAcceptance,'unrun');assert.equal(report.events.length,2);assert.doesNotMatch(JSON.stringify(report),/private-unknown-marker|private-variant-marker|cookies/);
});
test('normal startup explicitly declines service workers without running one or reporting an unknown-path failure',async t=>{
 const f=await setup(t);assert.equal((await f.request('/reading-worker.js')).status,410);assert.equal(f.fixture.report().violations.length,0);assert.equal(f.fixture.report().capabilities.serviceWorker,'intentionally-unavailable');
});
test('refuses a source mismatch before opening a port',async t=>{
 const f=await setup(t);await assert.rejects(createSafariFixture({buildRoot:f.root,template:'<head></head>',sourceCommit:'c'.repeat(40)}),/provenance/);
});
test('normal reader progress is acknowledged only in memory with exact mode, variant and source bounds',async t=>{
 const f=await setup(t),body={...openingReadingPreferences(),chapterId:'fixture-c',passageId:'fixture-p0',offset:50,withinParagraph:.2,contentVersion:'fixture-v1',baseRevision:0,observedAt:'2026-11-07T00:00:00.000Z'};
 const response=await f.post('/api/library/books/touch-fixture/progress',body);assert.equal(response.status,200);const saved=await response.json();assert.equal(saved.mode,'en');assert.equal(saved.variant,'interpretive');assert.equal(saved.revision,1);
 assert.deepEqual((await(await f.request('/api/library/books/touch-fixture/records')).json()).position,saved);
 assert.equal((await f.post('/api/library/books/touch-fixture/progress',{...body,baseRevision:1,variant:'private-variant-marker'})).status,403);
});
test('passive observer captures the first raw range before a later reader listener; this is synthetic sequencing only',async t=>{
 const f=await setup(t),script=await(await f.request('/qa/observer.js')).text();
 const {document}=domFixture('<body><main id="chapter-text"><div class="passage" id="fixture-p0"><p data-reading-layer="original" data-variant="interpretive">The <em>🌱</em> grows slowly. A second sentence remains.</p></div></main></body>');
 const prose=document.querySelector('p'),tail=prose.childNodes.at(-1),first=prose.childNodes[0],posted=[];let now=0;
 let range=Object.freeze({startContainer:tail,startOffset:1,endContainer:tail,endOffset:6,intersectsNode:node=>node===prose});
 const selection=Object.freeze({rangeCount:1,isCollapsed:false,anchorNode:tail,getRangeAt:()=>range});document.getSelection=()=>selection;
 const window={document,performance:{now:()=>now},crypto:{randomUUID:()=> 'b'.repeat(32)},fetch:(_url,options)=>{posted.push(JSON.parse(options.body));return Promise.resolve({ok:true});}};
 for(const key of ['localStorage','sessionStorage','navigator'])Object.defineProperty(window,key,{get(){throw Error('forbidden read: '+key);}});Object.defineProperty(document,'cookie',{get(){throw Error('forbidden cookie read');}});
 vm.runInNewContext(script,{window});assert.equal(posted[0].kind,'observer-ready');
 document.addEventListener('selectionchange',()=>{range=Object.freeze({startContainer:first,startOffset:0,endContainer:tail,endOffset:14,intersectsNode:node=>node===prose});});
 now=500;document.dispatchEvent(new Event('selectionchange'));assert.equal(posted[1].parts[0].text,'grows');assert.equal(posted[1].parts[0].start,7);assert.equal(posted[1].trusted,false);
 now=620;document.dispatchEvent(new Event('selectionchange'));assert.equal(posted[2].parts[0].text,'The 🌱 grows slowly.');
 for(const event of posted)assert.equal((await f.post('/qa/events',event)).status,204);
 assert.equal(f.fixture.report().nativeAcceptance,'unrun');
 const before=posted.length;prose.dataset.variant='private-variant-marker';document.dispatchEvent(new Event('selectionchange'));assert.equal(posted.length,before);prose.dataset.variant='interpretive';prose.textContent='unknown-private-marker';document.dispatchEvent(new Event('selectionchange'));assert.equal(posted.length,before);
});
