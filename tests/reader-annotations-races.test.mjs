import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createReaderAnnotationsService} from '../server/reader-annotations.mjs';
import * as model from '../app/reader-annotation-records.mjs';
const user={id:'synthetic-review-owner'},stamp='2026-10-20T00:00:00.000Z',start=Date.parse(stamp);
const book=()=>({bookId:'b',contentVersion:'v1',title:'Synthetic',chapters:[{id:'c',title:'Synthetic chapter'}],sections:[{chapterId:'c',paragraphs:[{id:'p',original:'S'+'x'.repeat(2100),translations:{}}]}]});
const quote=()=>({kind:'leafhour-reading-quote',schemaVersion:1,bookId:'b',contentVersion:'v1',chapterId:'c',parts:[{passageId:'p',layer:'original',start:0,end:1,text:'S'}]});
const input=(id='r',threadId='target',extra={})=>({id,threadId,quote:quote(),...extra});
const gate=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const observe=()=>{};
function fixture({archive=model.createAnnotationArchive('b'),runs=[],generate=async()=>({kind:'annotation',text:'Synthetic answer'})}={}){
 let state={archive:structuredClone(archive),runs:structuredClone(runs)},time=start,records={highlights:[]},bookFailure=false,recordsFailure=false,mutations=Promise.resolve();const counts={provider:0,quota:0,reserve:0,release:0};const errors=[];
 const getBook=async()=>{if(bookFailure)throw Object.assign(Error('synthetic source unavailable'),{status:typeof bookFailure==='number'?bookFailure:503});return book();};
 const library={getBook,records:async()=>{if(recordsFailure)throw Error('synthetic records unavailable');return structuredClone(records);}};
 const service=createReaderAnnotationsService({library,bookFor:getBook,identity:u=>u,dataDir:'/synthetic-only-not-written',read:async()=>structuredClone(state),mutate:async(_file,_fallback,fn)=>{const task=mutations.then(async()=>{const draft=structuredClone(state);const result=await fn(draft);state=draft;return result;});mutations=task.catch(()=>{});return task;},quota:async()=>{counts.quota++;},reserveGlobal:async()=>{counts.reserve++;return {};},releaseGlobal:async()=>{counts.release++;},clock:()=>time,generator:async job=>{counts.provider++;return generate(job);},onError:(e,meta)=>errors.push({status:e.status,message:e.message,...meta})});
 return {service,counts,errors,state:()=>structuredClone(state),setTime:v=>{time=v;},setBookFailure:v=>{bookFailure=v;},setRecordsFailure:v=>{recordsFailure=v;},setRecords:v=>{records=v;}};
}

test('B1 pre-aborted signal must prevent provider/quota',async()=>{
 const f=fixture(),controller=new AbortController();controller.abort();try{const r=await f.service.explain(user,'b',input(),{signal:controller.signal});observe('B1',{...f.counts,status:r.request?.status});assert.equal(f.counts.provider,0);}finally{await f.service.close();}
});
test('B2 cancel while dispatch authorization awaits must prevent queued generator',async()=>{
 const f=fixture(),entered=gate(),resume=gate();let auth=0;
 try{const pending=f.service.explain(user,'b',input(),{authorize:async()=>{if(++auth===2){entered.resolve();await resume.promise;}return true;}});await entered.promise;await f.service.cancel(user,'b','r');resume.resolve();const r=await pending;observe('B2',{...f.counts,status:r.request?.status});assert.equal(f.counts.provider,0);}finally{resume.resolve();await f.service.close();}
});
test('B3 clock must be checked after awaited final authorization',async()=>{
 const f=fixture();let auth=0;try{const r=await f.service.explain(user,'b',input(),{authorize:async()=>{if(++auth===3)f.setTime(start+90001);return true;}});observe('B3',{status:r.request?.status,messages:r.thread?.messages.length,timePastLeaseMs:1});assert.notEqual(r.request?.status,'completed');}finally{await f.service.close();}
});
for(const failure of ['source','records'])test('B4 '+failure+' failure must fail fence ACK, not permit already-checked publication',async()=>{
 const f=fixture(),entered=gate(),resume=gate();let auth=0;
 f.setRecords({highlights:[{id:'h',bookId:'b',contentVersion:'v1',parts:[{passageId:'p',language:'en',start:0,end:1,text:'S'}]}]});
 try{const pending=f.service.explain(user,'b',input('r','target',{highlightId:'h'}),{authorize:async()=>{if(++auth===3){entered.resolve();await resume.promise;}return true;}});await entered.promise;f.setRecords({highlights:[]});if(failure==='source')f.setBookFailure(true);else f.setRecordsFailure(true);let ack,error;try{ack=await f.service.fence(user,'b',{type:'highlight-deleted',ids:['h']});}catch(e){error=e.message;}f.setBookFailure(false);f.setRecordsFailure(false);resume.resolve();const r=await pending;observe('B4-'+failure,{ack:ack??null,error:error??null,status:r.request?.status,messages:r.thread?.messages.length});assert.ok(error,'fence must reject failed source-read ACK');}finally{resume.resolve();await f.service.close();}
});
function filledArchive(){const a=model.createAnnotationArchive('b');for(let t=0;t<5;t++)a.threads.push({id:'fill-'+t,quote:quote(),createdAt:stamp,updatedAt:stamp,messages:Array.from({length:17},(_,i)=>({id:'m'+i,origin:'user',body:'x'.repeat(11600),createdAt:stamp}))});return model.validateAnnotationArchive(a,book());}
test('B5 worst-case JSON answer must fit before provider is called',async()=>{
 const archive=filledArchive(),f=fixture({archive,generate:async()=>({kind:'annotation',text:'\u0001'.repeat(12000)})});
 try{let result,error;try{result=await f.service.explain(user,'b',input());}catch(e){error=e.status;}observe('B5',{bytes:Buffer.byteLength(JSON.stringify(archive)),counts:f.counts,status:result?.request?.status,error:error??null,errors:f.errors});assert.equal(f.counts.provider,0);}finally{await f.service.close();}
});
test('B6 registry citations larger than tiny anchor must fit before provider',async()=>{
 const archive=filledArchive(),f=fixture({archive,generate:async job=>{
  const read=await job.tools.execute('reader_get_context',{});assert.equal(read.error,undefined);
  for(let i=0;i<20;i++){const ref=await job.tools.execute('reader_cite',{bookId:'b',passageId:'p',layer:'original',quote:'x'.repeat(1981+i)});assert.equal(ref.error,undefined);}
  return {kind:'annotation',text:'文'.repeat(12000)};
 }});
 try{let result,error;try{result=await f.service.explain(user,'b',input());}catch(e){error=e.status;}observe('B6',{bytes:Buffer.byteLength(JSON.stringify(archive)),counts:f.counts,status:result?.request?.status,error:error??null,errors:f.errors});assert.equal(f.counts.provider,0);}finally{await f.service.close();}
});
test('B7 validateArchive must preflight merge conflicts',async()=>{
 let a=model.createAnnotationThread(model.createAnnotationArchive('b'),book(),{id:'t',quote:quote()},{now:stamp});a=model.appendAnnotationMessage(a,book(),'t',{id:'m',origin:'user',body:'kept words',createdAt:stamp});const incoming=structuredClone(a);incoming.threads[0].messages[0].body='conflicting words';const f=fixture({archive:a});
 try{let preflight,restore;try{await f.service.validateArchive(user,book(),incoming);preflight='accepted';}catch(e){preflight=e.status;}try{await f.service.restoreArchive(user,book(),incoming);restore='accepted';}catch(e){restore=e.status;}observe('B7',{preflight,restore});assert.equal(preflight,409);}finally{await f.service.close();}
});
test('B8 validateArchive supplied new book should not require destination book already installed',async()=>{
 const f=fixture();f.setBookFailure(404);try{let status;try{await f.service.validateArchive(user,book(),model.createAnnotationArchive('b'));status='accepted';}catch(e){status=e.status;}observe('B8',{status});assert.equal(status,'accepted');}finally{f.setBookFailure(false);await f.service.close();}
});
test('B9 history must come from completed request/message pairs, not arbitrary adjacency',async()=>{
 let archive=model.createAnnotationThread(model.createAnnotationArchive('b'),book(),{id:'target',quote:quote()},{now:stamp});archive=model.appendAnnotationMessage(archive,book(),'target',{id:'failed-user',origin:'user',body:'FAILED_FOLLOWUP_SENTINEL',createdAt:stamp});archive=model.appendAnnotationMessage(archive,book(),'target',{id:'imported-ai',origin:'ai',body:'UNRELATED_IMPORTED_ANSWER',createdAt:stamp,provenance:{source:'external-agent',label:'Synthetic external'}});
 let history;const f=fixture({archive,runs:[{id:'failed',threadId:'target',status:'failed',userMessageId:'failed-user',aiMessageId:'missing-ai',createdAt:stamp}],generate:async job=>{history=job.history;return {kind:'annotation',text:'Synthetic answer'};}});try{await f.service.explain(user,'b',input('next','target',{text:'new follow-up'}));observe('B9',{history});assert.equal(JSON.stringify(history).includes('FAILED_FOLLOWUP_SENTINEL'),false);}finally{await f.service.close();}
});
test('B7b validateArchive must preflight union capacity',async()=>{
 const current=model.createAnnotationArchive('b'),incoming=model.createAnnotationArchive('b');
 for(let i=0;i<60;i++){const row={id:'c'+i,quote:quote(),createdAt:stamp,updatedAt:stamp,messages:[]};current.threads.push(row);incoming.threads.push({...structuredClone(row),id:'i'+i});}
 const f=fixture({archive:current});try{let preflight,restore;try{await f.service.validateArchive(user,book(),incoming);preflight='accepted';}catch(e){preflight=e.status;}try{await f.service.restoreArchive(user,book(),incoming);restore='accepted';}catch(e){restore=e.status;}observe('B7b',{preflight,restore});assert.equal(preflight,413);}finally{await f.service.close();}
});

test('concurrent threads and imports cannot spend capacity already reserved by a running answer',async()=>{
 const archive=filledArchive();archive.threads=archive.threads.slice(0,3);
 const entered=gate(),release=gate();
 const f=fixture({archive,generate:async()=>{entered.resolve();await release.promise;return {kind:'annotation',text:'Reserved answer.'};}});
 try{
  const pending=f.service.explain(user,'b',input('first','first-thread'));await entered.promise;
  await assert.rejects(f.service.explain(user,'b',input('second','second-thread')),error=>error.status===413);
  assert.equal(f.counts.provider,1);assert.equal(f.counts.quota,1);
  await assert.rejects(f.service.validateArchive(user,book(),filledArchive()),error=>error.status===413);
  await assert.rejects(f.service.restoreArchive(user,book(),filledArchive()),error=>error.status===413);
  assert.equal(f.state().archive.threads.length,4);
  release.resolve();assert.equal((await pending).request.status,'completed');
  const restored=await f.service.restoreArchive(user,book(),filledArchive());assert.equal(restored.threads.length,6);
  assert.equal(f.counts.provider,1,'restore never starts a model or runtime job');
 }finally{release.resolve();await f.service.close();}
});

test('restore cannot occupy an answer identity reserved by an in-flight paid request',async()=>{
 const entered=gate(),release=gate(),f=fixture({generate:async()=>{entered.resolve();await release.promise;return {kind:'annotation',text:'Actual synthetic provider answer.'};}});
 try{
  const pending=f.service.explain(user,'b',input());await entered.promise;
  const incoming=await f.service.exportArchive(user,'b');
  const id='ai-'+createHash('sha256').update('r').digest('hex').slice(0,32);
  incoming.threads[0].messages.push({id,origin:'ai',body:'Conflicting imported answer.',createdAt:stamp,provenance:{source:'external-agent',label:'Synthetic'}});
  await assert.rejects(f.service.validateArchive(user,book(),incoming),error=>error.status===409);
  await assert.rejects(f.service.restoreArchive(user,book(),incoming),error=>error.status===409);
  release.resolve();const result=await pending;assert.equal(result.request.status,'completed');
  assert.equal(result.thread.messages[0].body,'Actual synthetic provider answer.');assert.equal(f.counts.provider,1);
 }finally{release.resolve();await f.service.close();}
});
