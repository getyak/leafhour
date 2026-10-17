import test from 'node:test';
import assert from 'node:assert/strict';
import {createHostedStore} from '../deploy/hosted-store.mjs';
import {createAudioStore} from '../server/audio-store.mjs';
import {createAudioService} from '../server/audio-service.mjs';
import {createListeningGuideService} from '../server/listening-guide-service.mjs';
import {guideScope,validateGuide} from '../server/listening-guide-content.mjs';
import {audioBook,pcmWav} from './audio-fixture.mjs';

const owner={id:'guide-owner'},book=audioBook(),pause=()=>new Promise(resolve=>setTimeout(resolve,3));
function database(){
 const rows=new Map();return createHostedStore({env:{SUPABASE_URL:'https://fixture.example',SUPABASE_SECRET_KEY:'fixture'},fetcher:async(input,options={})=>{
  const url=new URL(input);
  if(url.pathname==='/rest/v1/reader_documents'){const row=rows.get(url.searchParams.get('key').slice(3));return Response.json(row?[structuredClone(row)]:[]);}
  if(url.pathname==='/rest/v1/rpc/reader_document_cas'){const body=JSON.parse(options.body),prior=rows.get(body.document_key),ok=(prior?.version||0)===body.expected_version;if(ok)rows.set(body.document_key,{version:body.expected_version+1,value:structuredClone(body.document_value)});return Response.json(ok);}
  return Response.json({});
 }});
}
async function instance(t,dataStore,{audioGetBook=async()=>structuredClone(book),guideGetBook=async()=>structuredClone(book),provider}={}){
 const pending=[],store=await createAudioStore({dataDir:'/readonly/guides',dataStore}),audio=await createAudioService({store,getBook:audioGetBook,durable:true,schedule:p=>pending.push(p),speechProvider:provider||{available:true,model:'fixture',synthesize:async()=>({bytes:pcmWav(),mimeType:'audio/wav'})}}),guides=createListeningGuideService({audio,library:{getBook:guideGetBook},generator:async()=>{throw Error('no text request expected');},schedule:p=>pending.push(p)});
 t.after(()=>audio.close());return {audio,guides,store,pending};
}
async function seed(a,text='先仔细读。'){
 const scope=guideScope(book,{intent:'explain',chapterId:'ch1',throughPassageId:'p1',contentVersion:'v1'}),candidate=validateGuide(book,scope,{turns:[{speaker:'guide',text,sourceRefs:[{chapterId:'ch1',passageId:'p1',quote:'Read'}]}]}),dialogue=await a.audio.registerDialogue(owner,book.bookId,candidate);
 const job={id:'seeded-guide',status:'preparing',stage:'audio',scope,candidate,verification:[{turnId:'turn-1',supported:true}],readPassageIds:['p1'],outlines:[],batchCount:1,dialogueId:dialogue.id,dialogueRevision:dialogue.revision,lease:null,createdAt:new Date().toISOString()};
 await a.store.mutate(owner.id,book.bookId,data=>{(data.guideJobs??=[]).push(job);return null;});return job;
}
async function drain(a){for(let i=0;i<8;i++){const count=a.pending.length;await Promise.allSettled(a.pending);if(count===a.pending.length)return;}}
async function waitFor(condition){for(let i=0;i<100&&!condition();i++)await pause();assert.ok(condition(),'controlled operation did not start');}

test('a completed cancellation during the final source read cannot start an audio session',async t=>{
 let reads=0,release;const events=[],a=await instance(t,database(),{guideGetBook:async()=>{reads++;if(reads===2)await new Promise(resolve=>release=resolve);return structuredClone(book);}}),job=await seed(a),original=a.audio.createSession;
 a.audio.createSession=async(...args)=>{events.push('createSession');return original(...args);};
 await a.guides.get(owner,book.bookId,job.id);await waitFor(()=>!!release);await a.guides.cancel(owner,book.bookId,job.id);events.push('cancel-complete');release();await drain(a);
 assert.deepEqual(events,['cancel-complete']);assert.equal((await a.store.read(owner.id,book.bookId)).sessions.length,0);
});

test('cross-instance cancellation while audio source loading is blocked prevents session creation and TTS',async t=>{
 let block=false,release,paid=0;const db=database(),a=await instance(t,db,{audioGetBook:async()=>{if(block){block=false;await new Promise(resolve=>release=resolve);}return structuredClone(book);},provider:{available:true,model:'fixture',synthesize:async()=>{paid++;return {bytes:pcmWav(),mimeType:'audio/wav'};}}}),b=await instance(t,db),job=await seed(a);
 block=true;await a.guides.get(owner,book.bookId,job.id);await waitFor(()=>!!release);await b.guides.cancel(owner,book.bookId,job.id);release();await drain(a);
 const data=await a.store.read(owner.id,book.bookId);assert.equal(data.sessions.length,0);assert.equal(paid,0);assert.equal(data.guideJobs[0].status,'cancelled');
});

test('the session is atomically linked before quota awaits so another instance can stop the first TTS request',async t=>{
 let release,returnSession,paid=0;const db=database(),a=await instance(t,db,{provider:{available:true,model:'fixture',synthesize:async()=>{paid++;return {bytes:pcmWav(),mimeType:'audio/wav'};}}}),b=await instance(t,db),job=await seed(a),reserve=a.store.reserveGeneration,create=a.audio.createSession;
 a.store.reserveGeneration=async(...args)=>{await new Promise(resolve=>release=resolve);return reserve(...args);};
 a.audio.createSession=async(...args)=>{const session=await create(...args);await new Promise(resolve=>returnSession=resolve);return session;};
 await a.guides.get(owner,book.bookId,job.id);await waitFor(()=>!!release&&!!returnSession);
 const linked=(await b.store.read(owner.id,book.bookId)).guideJobs[0];
 await b.guides.cancel(owner,book.bookId,job.id);release();returnSession();await drain(a);assert.ok(linked.sessionId);assert.equal(paid,0);
 assert.equal((await b.audio.getSession(owner,book.bookId,linked.sessionId)).status,'cancelled');
});

test('generic status polling on a fresh instance resumes active guide slices and stops after the guide is cancelled',async t=>{
 let paid=0;const db=database(),provider={available:true,model:'fixture',synthesize:async()=>{paid++;return {bytes:pcmWav(),mimeType:'audio/wav'};}},a=await instance(t,db,{provider}),b=await instance(t,db,{provider}),job=await seed(a,'认真理解原文中的条件。'.repeat(40));
 await a.guides.get(owner,book.bookId,job.id);await drain(a);
 const data=await a.store.read(owner.id,book.bookId),guide=data.guideJobs[0];assert.equal(guide.status,'ready');assert.equal(paid,1);assert.ok(data.sessions[0].clips.length>2);
 await b.audio.getSession(owner,book.bookId,guide.sessionId);await drain(b);assert.equal(paid,2);
 await a.guides.cancel(owner,book.bookId,job.id);await b.audio.getSession(owner,book.bookId,guide.sessionId);await drain(b);assert.equal(paid,2);
});

test('a fresh worker cannot resume a guide session whose guide history has become inactive',async t=>{
 let paid=0;const db=database(),provider={available:true,model:'fixture',synthesize:async()=>{paid++;return {bytes:pcmWav(),mimeType:'audio/wav'};}},a=await instance(t,db,{provider}),b=await instance(t,db,{provider}),job=await seed(a,'认真理解原文中的条件。'.repeat(40));
 await a.guides.get(owner,book.bookId,job.id);await drain(a);assert.equal(paid,1);
 await a.store.mutate(owner.id,book.bookId,data=>{data.guideJobs[0].status='cancelled';return null;});
 const guide=(await b.store.read(owner.id,book.bookId)).guideJobs[0];await b.audio.getSession(owner,book.bookId,guide.sessionId);await drain(b);assert.equal(paid,1);
});

test('cross-instance cancellation after a delayed text submission marker prevents a new model request',async t=>{
 let release,paid=0,block=true;const db=database(),a=await instance(t,db),b=await instance(t,db),original=a.store.mutate;
 a.store.mutate=async(...args)=>{const result=await original(...args);if(block&&result?.lease?.inFlight){block=false;await new Promise(resolve=>release=resolve);}return result;};
 a.guides=createListeningGuideService({audio:a.audio,library:{getBook:async()=>structuredClone(book)},generator:async()=>{paid++;return {};},schedule:p=>a.pending.push(p)});
 const job=await a.guides.create(owner,book.bookId,{intent:'explain',chapterId:'ch1',throughPassageId:'p1',contentVersion:'v1',idempotencyKey:'delayed-marker',confirmProcessing:true});
 await waitFor(()=>!!release);await b.guides.cancel(owner,book.bookId,job.id);release();await drain(a);assert.equal(paid,0);
});

test('a late TTS result from another process cannot publish after cancellation completes',async t=>{
 let release,paid=0;const db=database(),a=await instance(t,db,{provider:{available:true,model:'fixture',synthesize:()=>{paid++;return new Promise(resolve=>release=()=>resolve({bytes:pcmWav(),mimeType:'audio/wav'}));}}}),b=await instance(t,db),job=await seed(a);
 await a.guides.get(owner,book.bookId,job.id);await waitFor(()=>!!release);await b.guides.cancel(owner,book.bookId,job.id);release();await drain(a);
 const data=await b.store.read(owner.id,book.bookId);assert.equal(paid,1);assert.equal(data.guideJobs[0].status,'cancelled');assert.equal(data.sessions[0].status,'cancelled');assert.ok(data.sessions[0].clips.every(c=>c.status!=='ready'));
});
