import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createAudioStore} from '../server/audio-store.mjs';
import {createAudioService} from '../server/audio-service.mjs';
import {createAudioBackup} from '../server/audio-backup.mjs';
import {createListeningGuideService} from '../server/listening-guide-service.mjs';
import {audioBook,pcmWav} from './audio-fixture.mjs';

const owner={id:'source-owner'},target={id:'restored-owner'},request={intent:'explain',chapterId:'ch1',throughPassageId:'p1',contentVersion:'v1',idempotencyKey:'private-request',confirmProcessing:true};
const pause=()=>new Promise(resolve=>setTimeout(resolve,3));
async function fixture(t){
 const root=await mkdtemp(path.join(tmpdir(),'guide-history-')),book=audioBook(),instances=[];let paidCalls=0;
 t.after(async()=>{for(const i of instances)await i.audio.close();await rm(root,{recursive:true,force:true});});
 async function instance(name,{supported=false}={}){
  const store=await createAudioStore({dataDir:path.join(root,name)}),library={getBook:async()=>structuredClone(book)},audio=await createAudioService({store,getBook:library.getBook,speechProvider:{available:true,model:'fixture',synthesize:async()=>{paidCalls++;return {bytes:pcmWav(),mimeType:'audio/wav'};}}});
  const generator=async input=>{
   paidCalls++;
   if(input.stage==='outline')return {passageIds:input.passages.map(p=>p.id),summary:'仔细读。',claims:[{text:'仔细读。',sourceRefs:[{chapterId:'ch1',passageId:'p1',quote:'Read'}]}]};
   if(input.stage==='script')return {turns:[{speaker:'guide',text:'这是一份尚待核验的讲解。',sourceRefs:[{chapterId:'ch1',passageId:'p1',quote:'Read'}]}]};
   return {checks:input.turns.map(turn=>({turnId:turn.id,supported}))};
  };
  const guides=createListeningGuideService({audio,library,generator}),backup=createAudioBackup({audio,store,getBook:library.getBook}),result={audio,store,guides,backup};instances.push(result);return result;
 }
 return {instance,book,calls:()=>paidCalls};
}
async function settled(guides,job){for(let i=0;i<100;i++){const j=await guides.get(owner,'audio-book',job.id);if(j.status!=='preparing')return j;await pause();}throw Error('guide did not settle');}

test('failed paid guide candidates remain discoverable as owner-scoped record summaries',async t=>{
 const f=await fixture(t),a=await f.instance('a'),failed=await settled(a.guides,await a.guides.create(owner,'audio-book',request));assert.equal(failed.status,'failed');
 const records=await a.audio.listRecords(owner,'audio-book');assert.ok(Array.isArray(records.guideJobs));assert.equal(records.guideJobs.length,1);
 assert.deepEqual(records.guideJobs[0],{id:failed.id,intent:'explain',chapterId:'ch1',status:'failed',createdAt:(await a.store.read(owner.id,'audio-book')).guideJobs[0].createdAt,hasTranscript:true,verified:false});
 assert.deepEqual((await a.audio.listRecords(target,'audio-book')).guideJobs,[]);assert.equal((await a.guides.get(owner,'audio-book',records.guideJobs[0].id)).transcript.turns[0].text,'这是一份尚待核验的讲解。');
});

test('optional guide history exports only terminal transcripts and omits executable or private task metadata',async t=>{
 const f=await fixture(t),a=await f.instance('a'),failed=await settled(a.guides,await a.guides.create(owner,'audio-book',request));
 const cancelled=await settled(a.guides,await a.guides.create(owner,'audio-book',{...request,idempotencyKey:'second-private-request'}));await a.guides.cancel(owner,'audio-book',cancelled.id);
 await a.store.mutate(owner.id,'audio-book',data=>{
  data.guideJobs[0].lease={token:'LEASE_SECRET',inFlight:true};data.guideJobs[0].authorityKey='AUTHORITY_SECRET';
  data.guideJobs.push({...structuredClone(data.guideJobs[0]),id:'queued-history',status:'preparing',stage:'verify'});
  return null;
 });
 const pack=await a.backup.exportAudio({owner,bookId:'audio-book'});assert.ok(Array.isArray(pack.guideJobs));assert.deepEqual(pack.guideJobs.map(j=>j.status),['failed','cancelled']);
 assert.equal(pack.guideJobs[0].transcript.turns[0].text,'这是一份尚待核验的讲解。');assert.equal(pack.guideJobs[0].id,failed.id);
 for(const privateText of ['LEASE_SECRET','AUTHORITY_SECRET','private-request','source-owner','outlines','readPassageIds','maxCalls'])assert.ok(!JSON.stringify(pack).includes(privateText));
 assert.ok(!pack.guideJobs.some(j=>j.id==='queued-history'));assert.ok(pack.guideJobs.every(j=>!('lease'in j)&&!('stage'in j)&&!('idempotencyKey'in j)));
});

test('failed transcript history restores on another owner without resuming work and repeated import deduplicates it',async t=>{
 const f=await fixture(t),a=await f.instance('a'),failed=await settled(a.guides,await a.guides.create(owner,'audio-book',request)),pack=await a.backup.exportAudio({owner,bookId:'audio-book'}),b=await f.instance('b');
 const before=f.calls(),restored=await b.backup.restoreAudio({owner:target,bookId:'audio-book',backup:pack});assert.equal(restored.guideJobs,1);
 const records=await b.audio.listRecords(target,'audio-book');assert.equal(records.guideJobs.length,1);assert.notEqual(records.guideJobs[0].id,failed.id);
 const history=await b.guides.get(target,'audio-book',records.guideJobs[0].id);assert.equal(history.status,'failed');assert.equal(history.transcript.verified,false);assert.equal(history.transcript.turns[0].text,failed.transcript.turns[0].text);
 await b.backup.restoreAudio({owner:target,bookId:'audio-book',backup:pack});assert.equal((await b.audio.listRecords(target,'audio-book')).guideJobs.length,1);assert.equal(f.calls(),before);
 const roundtrip=await b.backup.exportAudio({owner:target,bookId:'audio-book'});await b.backup.restoreAudio({owner:target,bookId:'audio-book',backup:roundtrip});assert.equal((await b.audio.listRecords(target,'audio-book')).guideJobs.length,1);
 const stored=(await b.store.read(target.id,'audio-book')).guideJobs[0];assert.equal(stored.stage,'history');assert.ok(!('idempotencyKey'in stored));assert.ok(!stored.lease);assert.deepEqual(stored.verification,[]);
 await assert.rejects(b.guides.get(owner,'audio-book',records.guideJobs[0].id),{status:404});
});

test('published guide sessions migrate without copying their executable guide-job link',async t=>{
 const f=await fixture(t),a=await f.instance('a',{supported:true}),ready=await settled(a.guides,await a.guides.create(owner,'audio-book',request));assert.equal(ready.status,'ready');
 for(let n=0;n<100;n++){if((await a.audio.getSession(owner,'audio-book',ready.sessionId)).status==='ready')break;await pause();}
 const pack=await a.backup.exportAudio({owner,bookId:'audio-book',includeAudio:true});assert.equal(pack.guideJobs,undefined);assert.equal(pack.sessions[0].input.guideJobId,undefined);
 const b=await f.instance('b'),before=f.calls();await b.backup.restoreAudio({owner:target,bookId:'audio-book',backup:pack});assert.equal((await b.audio.getSession(target,'audio-book',ready.sessionId)).status,'ready');assert.equal(f.calls(),before);
});

test('guide history rejects changed source hashes and forged citations before restoring any record',async t=>{
 const f=await fixture(t),a=await f.instance('a');await settled(a.guides,await a.guides.create(owner,'audio-book',request));const pack=await a.backup.exportAudio({owner,bookId:'audio-book'}),b=await f.instance('b');
 assert.ok(pack.guideJobs?.length);
 for(const mutate of [p=>p.guideJobs[0].transcript.sourceHashes.p1='0'.repeat(64),p=>p.guideJobs[0].transcript.turns[0].sourceRefs[0].quote='invented',p=>p.guideJobs[0].status='preparing']){
  const corrupt=structuredClone(pack);mutate(corrupt);await assert.rejects(b.backup.restoreAudio({owner:target,bookId:'audio-book',backup:corrupt}));assert.deepEqual((await b.audio.listRecords(target,'audio-book')).guideJobs,[]);
 }
 const forged=structuredClone(pack);forged.guideJobs[0].verified=true;forged.guideJobs[0].verification=[{turnId:'turn-1',supported:true}];await b.backup.restoreAudio({owner:target,bookId:'audio-book',backup:forged});
 const [row]=(await b.audio.listRecords(target,'audio-book')).guideJobs;assert.equal((await b.guides.get(target,'audio-book',row.id)).transcript.verified,false);
});
