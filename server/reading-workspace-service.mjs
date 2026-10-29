import {createLockedJsonStore} from './locked-json-store.mjs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
const fail=(message,status=400)=>{throw Object.assign(Error(message),{status});};
const object=v=>v&&typeof v==='object'&&!Array.isArray(v);
const canonical=v=>Array.isArray(v)?v.map(canonical):object(v)?Object.fromEntries(Object.keys(v).sort().map(key=>[key,canonical(v[key])])):v;
const hash=v=>createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex');
const candidateProof=({id,kind,origin,createdAt,scope,items})=>hash({id,kind,origin,createdAt,scope,items});
const identity=user=>{if(typeof user?.id!=='string'||!user.id)fail('Authentication required',401);return createHash('sha256').update(user.id).digest('hex');};
const text=(v,max=2000)=>typeof v==='string'&&v.trim()&&v.length<=max&&v.isWellFormed();
const id=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(v);
const fields=(v,allowed)=>{if(!object(v)||Object.keys(v).some(k=>!allowed.includes(k)))fail('Invalid workspace fields');};
const revision=v=>Number.isSafeInteger(v)&&v>=0;
const fresh=()=>({revision:0,topics:[],recordStates:{},relations:[],candidates:[],requests:{},changes:{}});
const kinds=['search','compare','review'],types=['supports','extends','contrasts','related'];
export function validateNotebookItems(value,kind,noteKeys){
 fields(value,['items']);if(Buffer.byteLength(JSON.stringify(value))>16384)fail('Generated item budget exceeded',502);if(!Array.isArray(value.items)||value.items.length>(kind==='review'?3:24))fail('Invalid generated items',502);
 const allowed=new Set(noteKeys);
 return value.items.map(item=>{fields(item,['text','noteKeys','type','next']);if(!text(item.text,4000)||!Array.isArray(item.noteKeys)||item.noteKeys.length>24||item.noteKeys.some(key=>!allowed.has(key))||new Set(item.noteKeys).size!==item.noteKeys.length||item.noteKeys.length<(kind==='compare'?2:1)||kind==='compare'&&!types.includes(item.type)||kind!=='compare'&&item.type!==undefined||kind==='review'&&!['reread','write','question'].includes(item.next)||kind!=='review'&&item.next!==undefined)fail('Invalid generated citations',502);return structuredClone(item);});
}
function validateSourceSnapshots(scope){
 if(!object(scope.sourceSnapshots)||Object.keys(scope.sourceSnapshots).length!==scope.noteKeys.length||Buffer.byteLength(JSON.stringify(Object.values(scope.sourceSnapshots)))>24576)fail('Invalid historical source snapshots');
 const short=(value,max=2000)=>typeof value==='string'&&value.length<=max&&value.isWellFormed();
 const stamp=value=>value===null||typeof value==='string'&&Number.isFinite(Date.parse(value));
 for(const noteKey of scope.noteKeys){
  const record=scope.sourceSnapshots[noteKey];fields(record,['noteKey','bookId','kind','recordId','revision','contentVersion','title','author','origin','createdAt','updatedAt','text','quote','quoteOrigin','quoteLanguage','parts','passageId','sourceHash','workspace']);
  let identity;try{identity=JSON.parse(noteKey);}catch{fail('Invalid historical note identity');}
  if(!Array.isArray(identity)||identity.length!==3||identity.some(v=>!short(v,128)||!v)||JSON.stringify(identity)!==noteKey||record.noteKey!==noteKey||record.bookId!==identity[0]||record.kind!==identity[1]||record.recordId!==identity[2]||!['comment','question','highlight'].includes(record.kind)||!revision(record.revision)||!short(record.contentVersion,256)||!record.contentVersion||record.origin!=='user'||!stamp(record.createdAt)||!stamp(record.updatedAt)||!short(record.author,24576)||!short(record.text,24576)||!(record.quote===null||short(record.quote,4000))||![null,'original','translation'].includes(record.quoteOrigin)||![null,'en','zh'].includes(record.quoteLanguage)||!(record.passageId===null||short(record.passageId,128))||!short(record.sourceHash,128)||!record.sourceHash)fail('Invalid historical note snapshot');
  if(!(short(record.title,24576)||object(record.title)&&Object.values(record.title).every(value=>short(value,24576))))fail('Invalid historical book metadata');
  if(record.parts!==null){if(!Array.isArray(record.parts)||record.parts.length>8)fail('Invalid historical quote');for(const part of record.parts){fields(part,['passageId','language','variant','start','end','text']);if(!short(part.passageId,128)||!['en','zh'].includes(part.language)||!['literal','interpretive'].includes(part.variant)||!revision(part.start)||!revision(part.end)||part.end<=part.start||!text(part.text,4000)||part.text.length!==part.end-part.start)fail('Invalid historical quote');}}
  fields(record.workspace,record.kind==='question'?['status','understandings']:['understandings']);if(record.kind==='question'&&!['open','understood'].includes(record.workspace.status)||!Array.isArray(record.workspace.understandings)||record.workspace.understandings.length>100)fail('Invalid historical user understanding');
  const ids=new Set();for(const item of record.workspace.understandings){fields(item,['id','text','createdAt','origin']);if(!id(item.id)||ids.has(item.id)||!text(item.text)||item.origin!=='user'||!stamp(item.createdAt)||item.createdAt===null)fail('Invalid historical user understanding');ids.add(item.id);}
  if(hash(record)!==scope.sourceHashes[noteKey])fail('Historical snapshot hash mismatch');
 }
}
export function createReadingWorkspaceService({library,dataDir,dataStore=null,generator=null,env={}}={}){
 const root=path.join(dataDir,'reading-workspaces');
 const file=user=>{const account=identity(user);return library.workspaceStateFile?library.workspaceStateFile(user):path.join(dataDir,'users',account,'notebook-workspace.json');};
 // The domain supplies the owning account path. Local lock files and documents
 // live beside that path; the sponsored global quota retains its separate root.
 const storeFor=key=>dataStore||createLockedJsonStore({dataDir:path.dirname(key),busyMessage:'Workspace is being saved; retry shortly'});
 const read=(key,fallback)=>storeFor(key).read(key,fallback);
 // The local store uses OS locks shared by every factory/process; model calls
 // remain outside these short persistence transactions.
 const mutate=(key,fallback,operation)=>storeFor(key).mutate(key,fallback,async row=>{const result=await operation(row);if(Buffer.byteLength(JSON.stringify(row))>2000000)fail('Workspace capacity exceeded',413);return result;});
 const visible=row=>structuredClone({revision:row.revision,topics:row.topics,recordStates:row.recordStates,relations:row.relations,candidates:row.candidates,capabilities:{generation:!!generator,maxNotes:24,maxContextBytes:24576}});
 const view=async user=>visible(await read(file(user),fresh()));
 const cas=(row,base)=>{if(!revision(base))fail('Invalid workspace revision');if(row.revision!==base)fail('Workspace changed; reload',409);if(row.revision>=Number.MAX_SAFE_INTEGER)fail('Workspace revision exhausted',409);};
 const resolve=async(user,keys)=>{try{return await library.workspaceRecords(user,keys);}catch(error){if(error.status===404)fail('Selected saved notes are unavailable',403);throw error;}};
 const selectedMetadata=(row,noteKey)=>{const state=row.recordStates[noteKey];return {...(JSON.parse(noteKey)[1]==='question'?{status:state?.status||'open'}:{}),understandings:structuredClone(state?.understandings||[])};};
 const selectedSnapshot=(record,row)=>({...structuredClone(record),workspace:selectedMetadata(row,record.noteKey)});
 const selectedHash=(record,row)=>hash(selectedSnapshot(record,row));
 const snapshots=async(user,candidate,state)=>{let rows;try{rows=await resolve(user,candidate.scope.noteKeys);}catch(error){if(error.status===403||error.status===404)fail('Selected notes changed',409);throw error;}if(rows.some(row=>selectedHash(row,state)!==candidate.scope.sourceHashes[row.noteKey]))fail('Selected notes changed',409);return rows;};
 async function change(user,input){
  const actionFields={'create-topic':['name'],'assign-topic':['noteKey','topicId','enabled'],'set-question-state':['noteKey','status'],'add-understanding':['noteKey','text'],'adopt-candidate':['candidateId'],'dismiss-candidate':['candidateId'],'remove-relation':['relationId']};
  if(!actionFields[input?.action])fail('Unknown workspace action');fields(input,['action','id','baseRevision',...actionFields[input.action]]);if(!id(input.id))fail('Invalid request id');const signature=hash(input);
  return mutate(file(user),fresh(),async row=>{
   if(row.changes[input.id]){if(row.changes[input.id]!==signature)fail('Request id conflict',409);return visible(row);}cas(row,input.baseRevision);
   if(input.noteKey!==undefined)await resolve(user,[input.noteKey]);
   const state=()=>row.recordStates[input.noteKey]??={status:'open',topicIds:[],understandings:[]};
   if(input.action==='create-topic'){if(!text(input.name,80)||row.topics.length>=100)fail('Invalid topic');row.topics.push({id:input.id,name:input.name.trim()});}
   if(input.action==='assign-topic'){if(!row.topics.some(t=>t.id===input.topicId)||typeof input.enabled!=='boolean')fail('Invalid topic assignment');const current=state();current.topicIds=current.topicIds.filter(t=>t!==input.topicId);if(input.enabled)current.topicIds.push(input.topicId);}
   if(input.action==='set-question-state'){if(JSON.parse(input.noteKey)[1]!=='question'||!['open','understood'].includes(input.status))fail('Invalid question state');state().status=input.status;}
   if(input.action==='add-understanding'){if(!text(input.text,2000)||state().understandings.length>=100)fail('Invalid understanding');state().understandings.push({id:input.id,text:input.text,createdAt:new Date().toISOString(),origin:'user'});}
   if(['adopt-candidate','dismiss-candidate'].includes(input.action)){
    const candidate=row.candidates.find(c=>c.id===input.candidateId);if(!candidate)fail('Candidate unavailable',404);
    if(input.action==='adopt-candidate'){if(candidate.status!=='candidate')fail('Candidate is no longer pending',409);await snapshots(user,candidate,row);candidate.status='adopted';row.relations.push(...candidate.items.map((item,index)=>({id:hash([candidate.id,index]).slice(0,40),candidateId:candidate.id,kind:candidate.kind,origin:'assistant',adoptedAt:new Date().toISOString(),...item})));}
    else {candidate.status='dismissed';row.relations=row.relations.filter(r=>r.candidateId!==candidate.id);}
   }
   if(input.action==='remove-relation'){const relation=row.relations.find(r=>r.id===input.relationId);if(!relation)fail('Relation unavailable',404);row.relations=row.relations.filter(r=>r.id!==input.relationId);const candidate=row.candidates.find(c=>c.id===relation.candidateId);if(candidate&&!row.relations.some(r=>r.candidateId===candidate.id))candidate.status='candidate';}
   if(Object.keys(row.changes).length>=10000)fail('Workspace operation capacity exceeded',413);row.changes[input.id]=signature;row.revision++;return visible(row);
  });
 }
 const check=async(user,{signal,authorize}={})=>{identity(user);if(signal?.aborted)fail('Analysis cancelled',409);if(authorize&&(await authorize())?.id!==user.id)fail('Owner authorization changed',403);};
 const cachedCandidate=(row,requestId,signature)=>{
  const request=Object.hasOwn(row.requests,requestId)?row.requests[requestId]:null,candidate=row.candidates.find(c=>c.id===requestId);
  if(request){if(request.signature!==signature)fail('Request id conflict',409);if(request.status==='complete'&&candidate){if(request.candidateProof!==candidateProof(candidate))fail('Restored candidate request cannot be verified',409);return structuredClone(candidate);}fail('Analysis request is already attempted',409);}
  if(candidate)fail('Restored candidate request cannot be verified',409);return null;
 };
 async function analyze(user,input,options={}){
  identity(user);fields(input,['id','kind','noteKeys','query','consent','locale','sourceRevisions','workspaceRevision']);
  if(!revision(input.workspaceRevision)||!id(input.id)||!kinds.includes(input.kind)||input.consent!==true||!Array.isArray(input.noteKeys)||!input.noteKeys.length||input.noteKeys.length>24||new Set(input.noteKeys).size!==input.noteKeys.length||input.noteKeys.some(k=>typeof k!=='string'||k.length>512)||!text(input.query,2000)||!['en','zh-Hans','zh-Hant','ja'].includes(input.locale)||!object(input.sourceRevisions)||Object.keys(input.sourceRevisions).length!==input.noteKeys.length||input.noteKeys.some(k=>!revision(input.sourceRevisions[k])))fail('Explicit saved-note scope and consent required');
  await check(user,options);const signature=hash(input),cached=cachedCandidate(await read(file(user),fresh()),input.id,signature);if(cached){await check(user,options);return cached;}if(!generator)fail('Notebook generation unavailable',503);
  const selected=await resolve(user,input.noteKeys);if(selected.some(row=>row.revision!==input.sourceRevisions[row.noteKey]))fail('Selected notes changed',409);
  const workspace=await read(file(user),fresh()),context={kind:input.kind,query:input.query,locale:input.locale,notes:selected.map(record=>selectedSnapshot(record,workspace))};if(Buffer.byteLength(JSON.stringify(context))>24576)fail('Selected context exceeds limit',413);
  const sourceSnapshots=Object.fromEntries(context.notes.map(record=>[record.noteKey,structuredClone(record)])),scope={noteKeys:[...input.noteKeys],sourceHashes:Object.fromEntries(selected.map(record=>[record.noteKey,selectedHash(record,workspace)])),sourceSnapshots};validateSourceSnapshots(scope);
  const attemptId=randomUUID(),day=new Date().toISOString().slice(0,10),limit=Math.min(10,Math.max(1,Number(env.NOTEBOOK_DAILY_ATTEMPTS)||5));
  const existing=await mutate(file(user),fresh(),row=>{
   const cached=cachedCandidate(row,input.id,signature);if(cached)return cached;
   if(row.candidates.length>=100||Object.values(row.requests).filter(r=>r.day===day).length>=limit)fail('Notebook sponsored daily limit reached',429);
   if(row.revision!==input.workspaceRevision||workspace.revision!==input.workspaceRevision)fail('Workspace changed; reload selected notes',409);
   if(Object.keys(row.requests).length>=10000)fail('Workspace request capacity exceeded',413);row.requests[input.id]={attemptId,signature,day,status:'pending'};return null;
  });if(existing)return existing;
  try{
   // Durable global cap makes the per-owner sponsorship limit bounded across accounts too.
   await mutate(path.join(root,'sponsored-quota.json'),{day,count:0},row=>{if(row.day!==day){row.day=day;row.count=0;}const cap=Math.min(200,Math.max(1,Number(env.NOTEBOOK_GLOBAL_DAILY_ATTEMPTS)||50));if(row.count>=cap)fail('Notebook sponsored daily limit reached',429);row.count++;});
   await check(user,options);const dispatchState=await read(file(user),fresh());if(dispatchState.revision!==input.workspaceRevision)fail('Workspace changed before dispatch',409);const output=await generator({user,context,signal:options.signal});const items=validateNotebookItems(output,input.kind,input.noteKeys);
   const candidate={id:input.id,kind:input.kind,status:'candidate',origin:'assistant',createdAt:new Date().toISOString(),scope,items};
   return await mutate(file(user),fresh(),async row=>{await check(user,options);const request=row.requests[input.id];if(!request||request.attemptId!==attemptId||request.signature!==signature||request.status!=='pending'||row.candidates.some(existing=>existing.id===candidate.id))fail('Analysis publication conflicts with restored state',409);if(row.candidates.length>=100)fail('Workspace candidate capacity exceeded',429);if(row.revision>=Number.MAX_SAFE_INTEGER)fail('Workspace revision exhausted',409);await snapshots(user,candidate,row);await check(user,options);row.candidates.push(candidate);row.requests[input.id].status='complete';row.requests[input.id].candidateProof=candidateProof(candidate);row.revision++;return structuredClone(candidate);});
  }catch(error){await mutate(file(user),fresh(),row=>{const request=row.requests[input.id];if(request?.attemptId===attemptId&&request.signature===signature&&request.status==='pending')request.status='failed';}).catch(()=>{});throw error;}
 }
 async function exportState(user){const row=await read(file(user),fresh());return structuredClone({kind:'leafhour-reading-workspace',schemaVersion:1,exportedAt:new Date().toISOString(),state:{topics:row.topics,recordStates:row.recordStates,relations:row.relations,candidates:row.candidates}});}
 async function importState(user,input){
  fields(input,['backup','baseRevision']);const backup=input.backup;fields(backup,['kind','schemaVersion','exportedAt','state']);if(backup.kind!=='leafhour-reading-workspace'||backup.schemaVersion!==1||Buffer.byteLength(JSON.stringify(backup))>2500000)fail('Invalid workspace backup');const state=structuredClone(backup.state);fields(state,['topics','recordStates','relations','candidates']);
  if(!Array.isArray(state.topics)||state.topics.length>100||!object(state.recordStates)||Object.keys(state.recordStates).length>10000||!Array.isArray(state.candidates)||state.candidates.length>100||!Array.isArray(state.relations)||state.relations.length>2400)fail('Invalid workspace backup');
  const topics=new Set();for(const topic of state.topics){fields(topic,['id','name']);if(!id(topic.id)||topics.has(topic.id)||!text(topic.name,80))fail('Invalid backup topic');topics.add(topic.id);}
  const keys=new Set(Object.keys(state.recordStates));for(const record of Object.values(state.recordStates)){fields(record,['status','topicIds','understandings']);if(!['open','understood'].includes(record.status)||!Array.isArray(record.topicIds)||record.topicIds.some(t=>!topics.has(t))||new Set(record.topicIds).size!==record.topicIds.length||!Array.isArray(record.understandings)||record.understandings.length>100)fail('Invalid backup note state');const ids=new Set();for(const item of record.understandings){fields(item,['id','text','createdAt','origin']);if(!id(item.id)||ids.has(item.id)||!text(item.text,2000)||item.origin!=='user'||!Number.isFinite(Date.parse(item.createdAt)))fail('Invalid backup understanding');ids.add(item.id);}}
  const candidates=new Map();for(const candidate of state.candidates){fields(candidate,['id','kind','status','origin','createdAt','scope','items']);fields(candidate.scope,['noteKeys','sourceHashes','sourceSnapshots']);if(!id(candidate.id)||candidates.has(candidate.id)||!kinds.includes(candidate.kind)||!['candidate','adopted','dismissed'].includes(candidate.status)||candidate.origin!=='assistant'||!Number.isFinite(Date.parse(candidate.createdAt))||!Array.isArray(candidate.scope.noteKeys)||!candidate.scope.noteKeys.length||candidate.scope.noteKeys.length>24||new Set(candidate.scope.noteKeys).size!==candidate.scope.noteKeys.length||!object(candidate.scope.sourceHashes)||Object.keys(candidate.scope.sourceHashes).length!==candidate.scope.noteKeys.length||candidate.scope.noteKeys.some(k=>typeof candidate.scope.sourceHashes[k]!=='string'))fail('Invalid backup candidate');validateSourceSnapshots(candidate.scope);validateNotebookItems({items:candidate.items},candidate.kind,candidate.scope.noteKeys);for(const key of candidate.scope.noteKeys)keys.add(key);candidates.set(candidate.id,candidate);}
  const relations=new Set();for(const relation of state.relations){fields(relation,['id','candidateId','kind','origin','adoptedAt','text','noteKeys','type','next']);const candidate=candidates.get(relation.candidateId);if(!id(relation.id)||relations.has(relation.id)||!candidate||candidate.status!=='adopted'||relation.kind!==candidate.kind||relation.origin!=='assistant'||!Number.isFinite(Date.parse(relation.adoptedAt))||!candidate.items.some(item=>item.text===relation.text&&JSON.stringify(item.noteKeys)===JSON.stringify(relation.noteKeys)&&item.type===relation.type&&item.next===relation.next))fail('Invalid backup relation');relations.add(relation.id);}
  await resolve(user,[...keys]);return mutate(file(user),fresh(),async row=>{cas(row,input.baseRevision);await resolve(user,[...keys]);Object.assign(row,state);row.revision++;return visible(row);});
 }
 return {view,change,analyze,exportState,importState};
}
