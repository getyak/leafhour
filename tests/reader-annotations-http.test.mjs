import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {createReaderServer} from '../server/server.mjs';
import {readingBook,readingRecords} from './reading-fixtures.mjs';

const owner={id:'synthetic-annotation-http-a'},other={id:'synthetic-annotation-http-b'};
const gate=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
async function fixture(t,{generator=async()=>({kind:'annotation',text:'Synthetic explanation.'}),userFor}={}){
 const dir=await mkdtemp(path.join(tmpdir(),'annotation-http-'));
 const auth={userFor:userFor|| (async token=>token==='fixture-a'?owner:token==='fixture-b'?other:null)};
 const server=await createReaderServer({bookPath:path.join(dir,'absent.json'),recordsPath:path.join(dir,'records.json'),authService:auth,annotationGenerator:generator,chatGenerator:null,companionGenerator:null,translator:null,sendCode:null,speechProvider:null,dialogueGenerator:null,guideGenerator:null,paddleProvider:null,env:{}});
 t.after(async()=>{await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});});
 for(const user of [owner,other])await server.portal.library.restoreLibrary(user,{kind:'marginalia-library',schemaVersion:1,books:[{book:structuredClone(readingBook),records:readingRecords()}]});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const base='http://127.0.0.1:'+server.address().port,route='/api/library/books/'+readingBook.bookId+'/annotations';
 const headers={Cookie:'marginalia_session=fixture-a','X-Reader-Owner':owner.id,Origin:base,'Content-Type':'application/json'};
 const request=(suffix='',body,overrides={})=>fetch(base+route+suffix,{method:body===undefined?'GET':'POST',headers:{...headers,...overrides},...(body===undefined?{}:{body:JSON.stringify(body)})});
 const p=readingBook.sections[0].paragraphs[0],chapterId=readingBook.sections[0].chapterId;
 const input={id:'r1',threadId:'t1',quote:{kind:'leafhour-reading-quote',schemaVersion:1,bookId:readingBook.bookId,contentVersion:readingBook.contentVersion,chapterId,parts:[{passageId:p.id,layer:'original',start:0,end:Math.min(12,p.original.length),text:p.original.slice(0,12)}]}};
 return {server,base,route,headers,request,input};
}

test('annotation HTTP enforces identity/CSRF, preserves exact retries and isolates owner archives',async t=>{
 let calls=0;
 const f=await fixture(t,{generator:async()=>{calls++;return {kind:'annotation',text:'Synthetic explanation.'};}});
 assert.equal((await f.request('',undefined,{Cookie:'','X-Reader-Owner':''})).status,401);
 assert.equal((await f.request('/explain',f.input,{'X-Reader-Owner':other.id})).status,409);
 assert.equal((await f.request('/explain',f.input,{Origin:'https://untrusted.invalid'})).status,403);
 assert.equal((await f.request('/explain',{...f.input,owner:owner.id})).status,400);
 const before=await (await f.request()).json();assert.deepEqual(before.archive.threads,[]);assert.equal(calls,0);
 const response=await f.request('/explain',f.input);assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'private, no-store');
 const first=await response.json();assert.equal(first.request.status,'completed');assert.equal(first.thread.messages.length,1);assert.equal(first.thread.messages[0].origin,'ai');
 assert.deepEqual(await (await f.request('/explain',f.input)).json(),first);assert.equal(calls,1);
 assert.equal((await f.request('/explain',{...f.input,text:'different immutable input'})).status,409);
 const theirs=await (await f.request('',undefined,{Cookie:'marginalia_session=fixture-b','X-Reader-Owner':other.id})).json();assert.deepEqual(theirs.archive.threads,[]);
 const follow=await (await f.request('/explain',{...f.input,id:'r2',text:'  Synthetic actor question  '})).json();
 assert.equal(follow.thread.messages[1].body,'  Synthetic actor question  ');assert.equal(follow.thread.messages[1].origin,'user');assert.equal(calls,2);
 const removed=await (await f.request('/threads/t1/remove',{})).json();assert.ok(removed.deletedAt);
 assert.equal((await f.request('/explain',{...f.input,id:'r3'})).status,409);assert.equal(calls,2);
});

test('an HTTP cancellation persists a terminal receipt before a late provider completes',async t=>{
 const entered=gate(),release=gate();t.after(()=>release.resolve());
 const f=await fixture(t,{generator:async()=>{entered.resolve();await release.promise;return {kind:'annotation',text:'Late synthetic answer.'};}});
 const pending=f.request('/explain',f.input);await entered.promise;
 const cancelled=await (await f.request('/requests/r1/cancel',{})).json();assert.equal(cancelled.request.status,'cancelled');
 release.resolve();const result=await (await pending).json();assert.equal(result.request.status,'cancelled');assert.deepEqual(result.thread.messages,[]);
 assert.equal((await f.request('/requests/missing/cancel',{})).status,404);
});

test('a response destroyed during awaited authentication never dispatches generation',async t=>{
 const entered=gate(),release=gate(),completed=gate();let calls=0,armed=false;
 const f=await fixture(t,{generator:async()=>{calls++;return {kind:'annotation',text:'Must not run.'};},userFor:async token=>{if(armed){entered.resolve();await release.promise;}return token==='fixture-a'?owner:null;}});
 armed=true;
 const client=http.request(f.base+f.route+'/explain',{method:'POST',headers:f.headers});client.on('error',()=>{});client.on('close',()=>completed.resolve());client.end(JSON.stringify(f.input));
 await entered.promise;client.destroy();await completed.promise;release.resolve();
 // Reading through the same route lets the earlier handler finish its await.
 const view=await (await f.request()).json();assert.equal(calls,0);assert.deepEqual(view.requests,[]);assert.deepEqual(view.archive.threads,[]);
});
