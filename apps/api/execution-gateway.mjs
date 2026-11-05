import http from 'node:http';
import {executionAuthority,withExecutionAuthority} from '../../packages/domain/execution-authority.mjs';
export {executionAuthority,withExecutionAuthority} from '../../packages/domain/execution-authority.mjs';
import {timingSafeEqual,randomUUID} from 'node:crypto';
import {mkdir,lstat,unlink,chmod} from 'node:fs/promises';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {attachExecutionCandidate} from '../../packages/domain/execution-delivery.mjs';
import {createExecutionQueue} from '../../packages/domain/execution-queue.mjs';
import {EXECUTION_PROTOCOL,executionError as fail,exactObject,encodeData,decodeData,digest,validToolArguments} from '../../packages/contracts/execution.mjs';
import {providerMeterContext,withProviderMeter,recordProviderCall} from '../../server/provider-metering.mjs';
export async function createExecutionGateway({store,socketPath,token,appendDispatch,pollMs=100,leaseMs=30000}={}){
 if(!token||!socketPath)throw Error('Execution gateway identity and socket required');
 const queue=createExecutionQueue({store,appendDispatch,leaseMs}),bindings=new Map();let closed=false;
 const controlKey='execution/control/'+digest(socketPath);
 const control=async paused=>{if(typeof paused==='boolean')await store.mutate(controlKey,{paused:false},state=>{state.paused=paused;});const state=await store.read(controlKey,{paused:false});return {...await queue.control(),paused:state.paused};};
 const check=async lease=>{const job=await queue.authorize(lease),binding=bindings.get(job.id);if(!binding){await queue.fail(lease,'api_context_lost');throw fail('execution_context_unavailable');}if(binding.signal?.aborted)throw fail('cancelled');if(!await binding.authority.authorize(job.scope))throw fail('authority_revoked',403);return {job,binding};};
 const dispatch=async(lease,body)=>{await check(lease);return queue.dispatch(lease,body);};
 const handle=async(method,input)=>{
  if(method==='control'){exactObject(input,['paused']);return control(input.paused);}
  if(method==='claim'){exactObject(input,['workerId','types']);if(!Array.isArray(input.types)||input.types.some(t=>typeof t!=='string'))throw fail('invalid_capabilities',400);if((await store.read(controlKey,{paused:false})).paused)return null;return queue.claim(input.workerId,input.types);}
  const keys={context:['lease'],heartbeat:['lease'],'tool-check':['lease','name','args'],tool:['lease','name','args','webResult'],progress:['lease','sequence','text'],dispatch:['lease','stepId','provider','model','inputDigest'],meter:['lease','facts'],complete:['lease','result'],fail:['lease','code']}[method];if(!keys)throw fail('unknown_internal_method',404);exactObject(input,keys);
  const {job,binding}=await check(input.lease);
  if(method==='context')return {...await queue.context(input.lease),toolDefinitions:binding.tools?.definitions||[],progress:typeof binding.onProgress==='function',meter:binding.meter?{feature:binding.meter.feature,funding:binding.meter.funding,...(binding.meter.maxCostUsd?{maxCostUsd:binding.meter.maxCostUsd}:{})}:null};
  if(method==='heartbeat')return queue.heartbeat(input.lease);
  if(method==='dispatch'){const {lease,...body}=input;return dispatch(lease,body);}
  if(method==='tool'||method==='tool-check'){
   const definition=binding.tools?.definitions?.find(d=>d.name===input.name);if(!definition||!validToolArguments(input.args,definition.parameters))throw fail('tool_scope_denied',403);if(method==='tool-check')return {ok:true};if(input.webResult!==undefined&&input.name!=='reader_search_web')throw fail('tool_scope_denied',403);
   // The closure enforces account/book/source permissions and runtime schemas.
   const value=await withExecutionAuthority({...binding.authority,webResult:input.webResult},()=>binding.tools.execute(input.name,input.args,{signal:binding.signal,reserveRequest:request=>({maxTokens:request.maxTokens})}));await check(input.lease);
   return {value,sources:binding.tools.sources?.()||[],recommendations:binding.tools.recommendations?.()||[]};
  }
  if(method==='progress'){const value={sequence:input.sequence,text:input.text};if(!Number.isSafeInteger(value.sequence)||value.sequence<1||typeof value.text!=='string'||!value.text.isWellFormed())throw fail('invalid_progress',400);if(value.sequence>(binding.progressSequence||0)){binding.progressSequence=value.sequence;await binding.onProgress?.(value);if(!binding.lastPersistedProgressAt||Date.now()-binding.lastPersistedProgressAt>=1000){await queue.progress(input.lease,value);binding.lastPersistedProgressAt=Date.now();}}return {ok:true};}
  if(method==='meter'){
   exactObject(input.facts,['ownerId','operationId','feature','funding','id','provider','model','status','usage','startedAt','finishedAt','costStatus','costMicrousd','pricingVersion']);
   if(input.facts.status==='unknown')await dispatch(input.lease,{stepId:'provider-'+input.facts.id,provider:input.facts.provider,model:input.facts.model,inputDigest:job.inputDigest});
   const meter=binding.meter||{ownerId:job.ownerId,feature:job.type,funding:'sponsored'};await withProviderMeter({...meter,record:async facts=>{if(binding.meter)await binding.meter.record(facts);return queue.providerReceipt(input.lease,facts);}},()=>recordProviderCall(input.facts));return {ok:true};
  }
  if(method==='complete'){await binding.tools?.verify?.();await check(input.lease);return queue.complete(input.lease,encodeData(input.result));}
  if(method==='fail')return queue.fail(input.lease,input.code);
 };
 const auth=Buffer.from('Bearer '+token),server=http.createServer(async(req,res)=>{
  const send=(status,value)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(encodeData(value)));};
  try{const header=Buffer.from(req.headers.authorization||'');if(header.length!==auth.length||!timingSafeEqual(header,auth))throw fail('unauthorized_executor',401);if(req.method!=='POST'||!req.url.startsWith('/internal/v1/'))throw fail('internal_route_not_found',404);let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>360*1024*1024)throw fail('execution_input_too_large',413);chunks.push(chunk);}const input=decodeData(JSON.parse(Buffer.concat(chunks)));send(200,await handle(req.url.slice('/internal/v1/'.length),input));}catch(error){send(error.status||500,{code:error.code||'execution_request_failed'});}
 });
 await mkdir(path.dirname(socketPath),{recursive:true,mode:0o770});try{const stat=await lstat(socketPath);if(!stat.isSocket())throw Error('Internal socket path occupied');throw Error('Internal socket already exists; verify old API stopped before removing stale socket');}catch(error){if(error.code!=='ENOENT')throw error;}
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(socketPath,resolve);});await chmod(socketPath,0o660);
 const generator=type=>async job=>{
  if(closed)throw fail('api_draining',503);const authority=executionAuthority();if(!authority?.ownerId||typeof authority.authorize!=='function')throw fail('execution_authority_required',403);if(!await authority.authorize())throw fail('authority_revoked',403);
  const {signal,tools,onProgress,user,...data}=job;const payload=encodeData(data),scope={...(data.book?.bookId?{bookId:data.book.bookId,contentVersion:data.book.contentVersion,...(data.book.source==='local-device'?{localDevice:true}:{})}:{}),...(data.bookId?{bookId:data.bookId,contentVersion:data.contentVersion}:{}),type};
  const key=(scope.bookId?scope.bookId+':':'')+String(data.requestId||data.runId||authority.operationId||randomUUID());
  const queued=await queue.admit({ownerId:authority.ownerId,type,idempotencyKey:key,payload,scope});bindings.set(queued.id,{authority,signal,tools,onProgress,meter:providerMeterContext()});
  const cancel=()=>queue.cancel(queued.id,authority.ownerId).catch(()=>{});signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted)await cancel();
  try{while(!closed){const row=await queue.view(queued.id,authority.ownerId);if(['candidate_ready','succeeded'].includes(row.status)){
      const result=decodeData(row.result);
      // Revalidate saved citation registrations when a caller reattaches after
      // a lost API response. This is local merging, never model regeneration.
      if(tools?.definitions?.some(d=>d.name==='reader_cite'))for(const ref of result.sourceRefs||[])await tools.execute('reader_cite',{bookId:ref.bookId||scope.bookId,passageId:ref.passageId,quote:ref.quote,layer:ref.layer});
      return attachExecutionCandidate(result,{jobId:row.id,receiptId:row.commitReceiptId,ownerId:authority.ownerId,resultDigest:digest(row.result),validate:async()=>{if(signal?.aborted||!await authority.authorize(scope))throw fail('authority_revoked',403);const current=await queue.view(row.id,authority.ownerId);if(!['candidate_ready','succeeded'].includes(current.status)||current.commitReceiptId!==row.commitReceiptId)throw fail('candidate_revoked');}});
     }if(['failed','cancelled','needs_reconciliation'].includes(row.status))throw fail(row.status==='needs_reconciliation'?'provider_outcome_unknown':row.error||row.status,503);await delay(pollMs);}throw fail('api_draining',503);}finally{signal?.removeEventListener('abort',cancel);bindings.delete(queued.id);}
 };
 return {queue,generator,control,server,async close(){closed=true;await new Promise(resolve=>server.close(resolve));await unlink(socketPath).catch(error=>{if(error.code!=='ENOENT')throw error;});}};
}
