import test from 'node:test';
import assert from 'node:assert/strict';
import {createHostedStore} from '../deploy/hosted-store.mjs';
import {createAudioStore} from '../server/audio-store.mjs';
import {createAudioService} from '../server/audio-service.mjs';
import {createListeningGuideService} from '../server/listening-guide-service.mjs';
import {audioBook,pcmWav} from './audio-fixture.mjs';

const owner={id:'guide-owner'},book=audioBook(),pause=()=>new Promise(resolve=>setTimeout(resolve,5));
const request={intent:'explain',chapterId:'ch1',throughPassageId:'p1',contentVersion:'v1',idempotencyKey:'same-request',confirmProcessing:true};
const jsonb=value=>Array.isArray(value)?value.map(jsonb):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>[key,jsonb(item)])):value;
function database(){
 const rows=new Map(),objects=new Map();
 const store=createHostedStore({env:{SUPABASE_URL:'https://fixture.example',SUPABASE_SECRET_KEY:'fixture'},fetcher:async(input,options={})=>{
  const url=new URL(input);
  if(url.pathname==='/rest/v1/reader_documents'){const row=rows.get(url.searchParams.get('key').slice(3));return Response.json(row?[structuredClone(row)]:[]);}
  if(url.pathname==='/rest/v1/rpc/reader_document_cas'){
   const body=JSON.parse(options.body),prior=rows.get(body.document_key),matches=(prior?.version||0)===body.expected_version;
   if(matches)rows.set(body.document_key,{version:body.expected_version+1,value:jsonb(body.document_value)});
   return Response.json(matches);
  }
  if(options.method==='POST'){objects.set(url.pathname,Buffer.from(options.body));return Response.json({});}
  return objects.has(url.pathname)?new Response(objects.get(url.pathname)):new Response('{}',{status:404});
 }});
 return {store,rows};
}
async function instance(t,db,generator){
 const store=await createAudioStore({dataDir:'/readonly/guides',dataStore:db.store}),scheduled=[],library={getBook:async()=>structuredClone(book)};
 const audio=await createAudioService({store,getBook:library.getBook,durable:true,speechProvider:{available:true,model:'fixture',synthesize:async()=>({bytes:pcmWav(),mimeType:'audio/wav'})},schedule:p=>scheduled.push(p)});
 const service=createListeningGuideService({audio,library,generator,schedule:p=>scheduled.push(p)});
 t.after(()=>audio.close());return {service,audio,store,scheduled};
}
async function output(input){
 if(input.stage==='outline')return {passageIds:input.passages.map(p=>p.id),summary:'仔细读原文。',claims:[{text:'先仔细读。',sourceRefs:[{chapterId:'ch1',passageId:'p1',quote:'Read'}]}]};
 if(input.stage==='script')return {turns:[{speaker:'guide',text:'先仔细读。',sourceRefs:[{chapterId:'ch1',passageId:'p1',quote:'Read'}]}]};
 return {checks:input.turns.map(t=>({turnId:t.id,supported:true}))};
}
async function settle(service,id){for(let n=0;n<100;n++){const job=await service.get(owner,book.bookId,id);if(job.status!=='preparing')return job;await pause();}throw Error('guide did not settle');}

test('independent hosted instances share CAS guide stages, one budget and one published dialogue',async t=>{
 const db=database(),calls=[];let release;
 const generate=async input=>{calls.push(input.stage);if(input.stage==='outline')await new Promise(resolve=>release=resolve);return output(input);};
 const a=await instance(t,db,generate),b=await instance(t,db,generate);
 const [one,two]=await Promise.all([a.service.create(owner,book.bookId,request),b.service.create(owner,book.bookId,request)]);
 assert.equal(one.id,two.id);while(!release)await pause();await b.service.get(owner,book.bookId,one.id);assert.deepEqual(calls,['outline']);
 release();const ready=await settle(b.service,one.id);assert.equal(ready.status,'ready');assert.deepEqual(calls,['outline','script','verify']);
 const data=await a.store.read(owner.id,book.bookId);assert.equal(data.guideJobs.length,1);assert.equal(data.dialogues.length,1);assert.equal(data.sessions.length,1);
 const budget=db.rows.get('audio/limits/guides').value.reservations;assert.equal(budget.length,1);assert.equal(budget[0].calls,3);assert.equal(budget[0].stages.length,3);
 await assert.rejects(b.service.get({id:'other-owner'},book.bookId,one.id),{status:404});
});

test('a cancellation tombstone blocks a late request on an independent hosted process',async t=>{
 const db=database();let calls=0;const generate=async input=>{calls++;return output(input);},a=await instance(t,db,generate),b=await instance(t,db,generate);
 await a.service.cancelRequest(owner,book.bookId,request.idempotencyKey);
 const late=await b.service.create(owner,book.bookId,request);assert.equal(late.status,'cancelled');assert.equal(calls,0);assert.ok(!db.rows.has('audio/limits/guides'));
});
