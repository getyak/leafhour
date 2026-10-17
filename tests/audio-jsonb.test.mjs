import test from 'node:test';
import assert from 'node:assert/strict';
import {createHostedStore} from '../deploy/hosted-store.mjs';
import {createAudioStore} from '../server/audio-store.mjs';
import {createAudioService} from '../server/audio-service.mjs';
import {createAudioBackup,validateAudioBackup} from '../server/audio-backup.mjs';
import {audioHash} from '../server/audio-content.mjs';
import {prepareDialogueScenes} from '../server/audio-scenes.mjs';
import {guideScope,validateGuide} from '../server/listening-guide-content.mjs';
import {createListeningGuideService} from '../server/listening-guide-service.mjs';
import {audioBook,pcmWav} from './audio-fixture.mjs';

const owner={id:'jsonb-owner'},other={id:'jsonb-other'};
const jsonb=value=>Array.isArray(value)?value.map(jsonb):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,jsonb(value[key])])):value;
const book=audioBook();
book.sections[0].paragraphs[0].id='z-source';
book.sections[0].paragraphs[1].id='a-source';
const legacy={chapterId:'ch1',turns:[{speaker:'guide',text:'仔细读原文。',sourceRefs:[{passageId:'z-source',quote:'Read'}]}]};

function database(){
 const rows=new Map(),objects=new Map();
 return createHostedStore({env:{SUPABASE_URL:'https://fixture.example',SUPABASE_SECRET_KEY:'fixture'},fetcher:async(input,options={})=>{
  const url=new URL(input);
  if(url.pathname==='/rest/v1/reader_documents'){const row=rows.get(url.searchParams.get('key').slice(3));return Response.json(row?[row]:[]);}
  if(url.pathname==='/rest/v1/rpc/reader_document_cas'){
   const body=JSON.parse(options.body),prior=rows.get(body.document_key),matches=(prior?.version||0)===body.expected_version;
   if(matches)rows.set(body.document_key,{version:body.expected_version+1,value:jsonb(body.document_value)});
   return Response.json(matches);
  }
  if(options.method==='POST'){objects.set(url.pathname,Buffer.from(options.body));return Response.json({});}
  return objects.has(url.pathname)?new Response(objects.get(url.pathname)):new Response('{}',{status:404});
 }});
}

async function instance(t,dataStore=database()){
 const store=await createAudioStore({dataStore}),pending=[];let calls=0;
 const audio=await createAudioService({store,getBook:async()=>jsonb(book),speechProvider:{available:true,model:'fixture',synthesize:async()=>{calls++;return {bytes:pcmWav(),mimeType:'audio/wav'};}},schedule:p=>pending.push(p)});
 t.after(()=>audio.close());
 return {audio,store,pending,calls:()=>calls,backup:createAudioBackup({audio,store,getBook:async()=>jsonb(book)})};
}

function guided(){
 const scope=guideScope(book,{intent:'explain',chapterId:'ch1',scopeMode:'chapter',contentVersion:'v1'});
 return validateGuide(book,scope,{turns:[{speaker:'guide',text:'先仔细读，再提出疑问。',style:'reflective',sourceRefs:[{chapterId:'ch1',passageId:'z-source',quote:'Read'}]},{speaker:'questioner',text:'接下来应该问什么？',style:'curious',sourceRefs:[{chapterId:'ch1',passageId:'a-source',quote:'Then'}]}]});
}

test('hosted source hashes survive JSONB key ordering through dialogue reads and edits',async t=>{
 const a=await instance(t),d=await a.audio.registerDialogue(owner,book.bookId,legacy);
 assert.deepEqual((await a.audio.getDialogue(owner,book.bookId,d.id)).turns.map(t=>t.text),['仔细读原文。']);
 const updated=await a.audio.editDialogue(owner,book.bookId,d.id,{revision:1,turns:[{...d.turns[0],text:'把原文仔细读一遍。'}]});
 assert.equal(updated.revision,2);assert.equal((await a.audio.getDialogue(owner,book.bookId,d.id)).turns[0].text,'把原文仔细读一遍。');
});

test('hosted session retries accept reordered request fields without weakening content conflicts or changing legacy hashes',async t=>{
 const a=await instance(t),input={contentVersion:'v1',chapterId:'ch1',language:'en',parts:[{passageId:'z-source',start:0,end:4}],idempotencyKey:'same-request'},session=await a.audio.createSession(owner,book.bookId,input);
 await Promise.all(a.pending);assert.equal((await a.audio.getSession(owner,book.bookId,session.id)).status,'ready');
 const before=(await a.store.read(owner.id,book.bookId)).sessions[0];
 assert.equal((await a.audio.createSession(owner,book.bookId,jsonb(input))).id,session.id);assert.equal(a.calls(),1);
 const after=(await a.store.read(owner.id,book.bookId)).sessions[0];assert.equal(after.requestHash,before.requestHash);assert.equal(after.contentHash,before.contentHash);assert.equal(after.clips[0].cacheKey,before.clips[0].cacheKey);
 await assert.rejects(a.audio.createSession(owner,book.bookId,{...jsonb(input),parts:[{passageId:'a-source',start:0,end:4}]}),{status:409});
});

test('restoring an unchanged hosted dialogue backup is not mistaken for an edited script conflict',async t=>{
 const a=await instance(t);await a.audio.registerDialogue(owner,book.bookId,legacy);
 const backup=await a.backup.exportAudio({owner,bookId:book.bookId});
 await a.backup.restoreAudio({owner,bookId:book.bookId,backup});
 assert.equal((await a.audio.listRecords(owner,book.bookId)).dialogues.length,1);
 const changed=structuredClone(backup);changed.dialogues[0].turns[0].text='另一份修改。';
 await assert.rejects(a.backup.restoreAudio({owner,bookId:book.bookId,backup:changed}),{status:409});
});

test('native scene backup validation ignores JSONB field order but rejects changed style and sources',()=>{
 const script={...guided(),id:'dialogue',revision:1},prepared=prepareDialogueScenes(book.bookId,script),pack={kind:'marginalia-audio-backup',schemaVersion:1,bookId:book.bookId,contentVersion:'v1',dialogues:[script],audio:[],sessions:[{id:'session',idempotencyKey:'scene',chunkingVersion:3,input:{mode:'dialogue',dialogueId:script.id,revision:1},contentHash:audioHash(prepared.clips),clips:prepared.clips.map((clip,i)=>({...clip,id:'clip-'+i,voice:'Sulafat',turns:clip.turns.map(turn=>({...turn,voice:turn.speaker==='guide'?'Charon':'Puck'})),status:'pending'})),position:{clipIndex:0,seconds:0}}]};
 const sorted=jsonb(pack);assert.equal(validateAudioBackup(book,sorted).sessions[0].status,'interrupted');
 for(const change of [p=>p.sessions[0].clips[0].turns[0].style='emphatic',p=>p.sessions[0].clips[0].turns[0].sourceRefs[0].quote='Then']){
  const corrupt=structuredClone(sorted);change(corrupt);assert.throws(()=>validateAudioBackup(book,corrupt));
 }
});

test('a complete hosted guide keeps native scene fingerprints and cache identities through JSONB and migration',async t=>{
 const a=await instance(t),stages=[],guides=createListeningGuideService({audio:a.audio,library:{getBook:async()=>jsonb(book)},schedule:p=>a.pending.push(p),generator:async input=>{
  stages.push(input.stage);
  if(input.stage==='outline')return {passageIds:['z-source','a-source'],summary:'先读，再问。',claims:[{text:'先仔细读，再提出疑问。',sourceRefs:[{chapterId:'ch1',passageId:'z-source',quote:'Read'},{chapterId:'ch1',passageId:'a-source',quote:'Then'}]}]};
  if(input.stage==='script')return {turns:guided().turns};
  return {checks:input.turns.map(turn=>({turnId:turn.id,supported:true}))};
 }});
 let job=await guides.create(owner,book.bookId,{intent:'explain',chapterId:'ch1',scopeMode:'chapter',contentVersion:'v1',idempotencyKey:'complete-guide',confirmProcessing:true});
 for(let n=0;n<12&&job.status==='preparing';n++){await Promise.all(a.pending);job=await guides.get(owner,book.bookId,job.id);}
 assert.equal(job.status,'ready');assert.deepEqual(stages,['outline','script','verify']);
 const script=await a.audio.getDialogue(owner,book.bookId,job.dialogueId),input={mode:'dialogue',dialogueId:script.id,revision:1,idempotencyKey:'guide:'+job.id},session={id:job.sessionId};
 await Promise.all(a.pending);const ready=await a.audio.getSession(owner,book.bookId,session.id);assert.equal(ready.status,'ready');assert.equal(a.calls(),1);
 const backup=await a.backup.exportAudio({owner,bookId:book.bookId,includeAudio:true}),b=await instance(t);
 await b.backup.restoreAudio({owner,bookId:book.bookId,backup});const restored=await b.audio.getSession(owner,book.bookId,session.id);
 assert.equal(restored.contentHash,ready.contentHash);assert.equal(restored.clips[0].cacheKey,ready.clips[0].cacheKey);assert.equal(b.calls(),0);
 assert.deepEqual((await b.audio.getClip(owner,book.bookId,restored.clips[0].id)).bytes,pcmWav());
 assert.equal((await b.audio.createSession(owner,book.bookId,input)).id,session.id);assert.equal(b.calls(),0);
 await b.backup.restoreAudio({owner:other,bookId:book.bookId,backup});assert.notEqual((await b.audio.getSession(other,book.bookId,session.id)).clips[0].cacheKey,ready.clips[0].cacheKey);
});
