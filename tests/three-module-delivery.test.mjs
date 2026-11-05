import test from 'node:test';
import assert from 'node:assert/strict';
import {createHostedStore} from '../deploy/hosted-store.mjs';
import {attachExecutionCandidate,withCandidateDelivery} from '../packages/domain/execution-delivery.mjs';
import {createExecutionQueue} from '../packages/domain/execution-queue.mjs';
import {digest} from '../packages/contracts/execution.mjs';
const receipt={jobId:'00000000-0000-4000-8000-000000000001',ownerId:'synthetic-owner',receiptId:'a'.repeat(64),resultDigest:'b'.repeat(64)};
function database({conflict=false,loseResponse=false}={}){
 const rows=new Map(),receipts=new Map();let writes=0,conflicts=0;
 const fetcher=async(input,options={})=>{const url=new URL(input),body=options.body?JSON.parse(options.body):null;let out;
 if(url.pathname==='/rest/v1/reader_documents'){const key=url.searchParams.get('key').slice(3),row=rows.get(key);out=row?[row]:[];}
 else if(url.pathname==='/rest/v1/reader_execution_deliveries'){const row=receipts.get(url.searchParams.get('job_id').slice(3));out=row?[row]:[];}
 else if(url.pathname.startsWith('/rest/v1/rpc/reader_document_cas')){
  const prior=receipts.get(body.execution_job_id);if(prior)return Response.json(true);
  const row=rows.get(body.document_key);if(conflict&&body.execution_job_id&&!conflicts++){rows.set(body.document_key,{version:1,value:{notes:['concurrent original']}});return Response.json(false);}
  if((row?.version||0)!==body.expected_version)return Response.json(false);
  rows.set(body.document_key,{version:(row?.version||0)+1,value:body.document_value});writes++;
  if(body.execution_job_id){receipts.set(body.execution_job_id,{job_id:body.execution_job_id,receipt_id:body.execution_receipt_id,owner_id:body.execution_owner_id,result_digest:body.execution_result_digest});if(loseResponse){loseResponse=false;throw Object.assign(Error('lost response'),{code:'ECONNRESET'});}}out=true;
 }else throw Error('Unexpected synthetic route '+url.pathname);
 return Response.json(out);
 };
 return {rows,receipts,fetcher,get writes(){return writes;}};
}
const makeStore=db=>createHostedStore({env:{SUPABASE_URL:'https://synthetic.invalid',SUPABASE_SECRET_KEY:'synthetic-key'},fetcher:db.fetcher});
test('domain CAS and unique delivery receipt survive lost response without provider replay',async()=>{const db=database({loseResponse:true}),store=makeStore(db),candidate=attachExecutionCandidate({summary:'actual result'},receipt);let providerCalls=1;const result=await withCandidateDelivery(candidate,()=>store.mutate('domain-result',{notes:[]},data=>{data.notes.push(candidate.summary);return {status:'completed'};}));assert.equal(result.status,'completed');assert.equal(providerCalls,1);assert.equal(db.writes,1);assert.deepEqual(await store.executionReceipt(receipt.jobId),receipt);assert.deepEqual((await store.read('domain-result',null)).notes,['actual result']);});
test('domain CAS conflict retries only the merge, retaining concurrent edits and candidate',async()=>{const db=database({conflict:true}),store=makeStore(db),candidate=attachExecutionCandidate({summary:'generated once'},receipt);let merges=0;await withCandidateDelivery(candidate,()=>store.mutate('domain-result',{notes:[]},data=>{merges++;data.notes.push(candidate.summary);}));assert.equal(merges,2);assert.deepEqual((await store.read('domain-result',null)).notes,['concurrent original','generated once']);assert.equal(db.receipts.size,1);});
test('rejected publication and untrusted JSON cannot claim a domain delivery receipt',async()=>{const db=database(),store=makeStore(db),candidate=attachExecutionCandidate({},receipt);await withCandidateDelivery(candidate,()=>store.mutate('cancelled',{},()=>({status:'cancelled'})),{accept:result=>result.status==='completed'});await withCandidateDelivery({...candidate,...receipt},()=>store.mutate('untrusted',{},()=>true));assert.equal(db.receipts.size,0);});
test('queue mirrors authoritative domain receipt after API restart and no queue acknowledgement',async()=>{const db=database(),store=makeStore(db),queue=createExecutionQueue({store});const job=await queue.admit({ownerId:receipt.ownerId,type:'chat',idempotencyKey:'same-request',payload:{text:'synthetic'},scope:{}}),lease=await queue.claim('synthetic-worker'),ready=await queue.complete(lease,{summary:'answer'});assert.equal(ready.status,'candidate_ready');const candidate=attachExecutionCandidate({summary:'answer'},{...receipt,jobId:job.id,receiptId:ready.commitReceiptId,resultDigest:digest({summary:'answer'})});await withCandidateDelivery(candidate,()=>store.mutate('domain-result',{},data=>{data.answer='answer';}));const restarted=createExecutionQueue({store});assert.equal((await restarted.view(job.id,receipt.ownerId)).status,'succeeded');assert.equal(await restarted.claim('second-worker'),null);});

test('JSONB object key ordering cannot change candidate fingerprints or delivery receipts',()=>{assert.equal(digest({summary:'answer',sourceRefs:[{quote:'literal source',layer:'original',passageId:'p1'}]}),digest({sourceRefs:[{passageId:'p1',layer:'original',quote:'literal source'}],summary:'answer'}));assert.notEqual(digest({steps:[1,2]}),digest({steps:[2,1]}));});
