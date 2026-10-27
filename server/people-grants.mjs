import {randomBytes,createHash} from 'node:crypto';
import {validPersonId} from '../app/person-model.mjs';
const hash=x=>createHash('sha256').update(x).digest('hex');
const fail=(status=403,code='SCOPE_DENIED',message='Person access expired or its scope is insufficient. Reconnect to continue.')=>Object.assign(Error(message),{status,code});
const requestId=x=>typeof x==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(x);
export const PEOPLE_SCOPES=['people:read','people:write','people:create','people:generate'];
export function createPeopleGrants({store,people,clock=Date.now}){
 const key='people/agent-grants-v1',empty=()=>({grants:[]});
 const rowFor=(data,token)=>data.grants.find(g=>g.tokenHash===hash(token));
 const tokenValid=token=>{if(typeof token!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(token))throw fail(401);};
 const check=(row,scope,personId)=>{if(!row||row.revoked||row.expiresAt<=clock()||!row.scopes.includes(scope)||scope!=='people:create'&&personId&&!row.personIds.includes(personId)&&!row.createdPersonIds.includes(personId))throw fail();return {id:row.ownerId,grant:structuredClone(row)};};
 async function issue(user,personIds,scopes){
  if(typeof user?.id!=='string'||!user.id||user.id.length>512||user.is_anonymous)throw fail(401);
  if(!Array.isArray(scopes)||!scopes.includes('people:read')||new Set(scopes).size!==scopes.length||scopes.some(s=>!PEOPLE_SCOPES.includes(s))||!Array.isArray(personIds)||personIds.length>20||new Set(personIds).size!==personIds.length||personIds.some(x=>!validPersonId(x))||!personIds.length&&!scopes.includes('people:create'))throw fail(400);
  for(const personId of personIds)await people.get(user,personId);
  const token=randomBytes(32).toString('base64url'),grant={id:randomBytes(16).toString('hex'),tokenHash:hash(token),ownerId:user.id,personIds:[...personIds],createdPersonIds:[],creationRequests:[],scopes:[...scopes],expiresAt:clock()+3600000,revoked:false,readStateRevision:0,readState:null};
  await store.mutate(key,empty(),data=>{data.grants=data.grants.filter(g=>g.revocationPending===true||g.expiresAt>clock()&&!g.revoked);if(data.grants.length>=1000)throw fail(429);data.grants.push(grant);});
  return {id:grant.id,token,expiresAt:new Date(grant.expiresAt).toISOString()};
 }
 async function authenticate(token,scope='people:read',personId){tokenValid(token);return check(rowFor(await store.read(key,empty()),token),scope,personId);}
 async function create(token,input,operation){
  tokenValid(token);if(!input||Object.keys(input).some(k=>!['personId','requestId','fingerprint'].includes(k))||!validPersonId(input.personId)||!requestId(input.requestId)||typeof input.fingerprint!=='string'||!/^[a-f0-9]{64}$/.test(input.fingerprint)||typeof operation!=='function')throw fail(400,'INVALID_ARGUMENTS');
  const reservation=await store.mutate(key,empty(),data=>{
   const row=rowFor(data,token);check(row,'people:create');row.creationRequests??=[];const prior=row.creationRequests.find(r=>r.requestId===input.requestId);
   if(prior){if(prior.personId!==input.personId||prior.fingerprint!==input.fingerprint)throw fail(409,'IDEMPOTENCY_CONFLICT','Creation requestId already belongs to another payload.');return prior;}
   if(row.personIds.includes(input.personId)||row.createdPersonIds.includes(input.personId)||row.creationRequests.some(r=>r.personId===input.personId))throw fail(409,'PERSON_EXISTS','This person is already selected or being created.');
   const occupied=new Set([...row.personIds,...row.createdPersonIds,...row.creationRequests.map(r=>r.personId)]);if(occupied.size>=20)throw fail(409,'PERSON_LIMIT','This connection already contains twenty people, including pending creations.');
   const created={...input,reservationId:randomBytes(16).toString('hex'),status:'reserved'};row.creationRequests.push(created);return created;
  });
  if(reservation.status==='complete')return structuredClone(reservation.result);
  const release=()=>store.mutate(key,empty(),data=>{const row=rowFor(data,token);if(row)row.creationRequests=(row.creationRequests||[]).filter(r=>r.reservationId!==reservation.reservationId||r.status==='complete');});
  // A transport/storage failure can happen after the domain committed. Keep
  // its slot until an idempotent retry recovers the receipt; only a definite
  // validation/permission rejection proves that no object was created.
  await authenticate(token,'people:create');const result=await operation();
  if(result?.error){if(['INVALID_ARGUMENTS','INVALID_PERSON','INVALID_PROOF','PERSON_EXISTS','REVISION_CONFLICT','IDEMPOTENCY_CONFLICT','AUTH_REQUIRED','SCOPE_DENIED','REQUEST_TOO_LARGE'].includes(result.error.code))await release();return result;}
  if(result?.id!==input.personId||!Number.isSafeInteger(result.revision)||result.revision<1)throw fail(500,'INVALID_CREATE_RECEIPT','The creation receipt could not be verified.');
  // Keep a pending reservation if admission fails after the domain commit.
  // Retrying the same request can recover it; releasing it could exceed the cap.
  await store.mutate(key,empty(),data=>{const row=rowFor(data,token);check(row,'people:create');const current=(row.creationRequests||[]).find(r=>r.reservationId===reservation.reservationId);if(!current)throw fail(409,'CREATION_CONFLICT');if(!row.createdPersonIds.includes(input.personId))row.createdPersonIds.push(input.personId);current.status='complete';current.result=structuredClone(result);row.readState=null;row.readStateRevision=(row.readStateRevision||0)+1;});
  return result;
 }
 async function readState(token){tokenValid(token);const row=rowFor(await store.read(key,empty()),token);check(row,'people:read');return {revision:row.readStateRevision||0,state:structuredClone(row.readState??null)};}
 async function saveReadState(token,expectedRevision,state){
  tokenValid(token);if(!Number.isSafeInteger(expectedRevision)||expectedRevision<0||!state||typeof state!=='object'||Array.isArray(state)||Buffer.byteLength(JSON.stringify(state))>256*1024)throw fail(400,'INVALID_READ_STATE');
  return store.mutate(key,empty(),data=>{const row=rowFor(data,token);check(row,'people:read');if((row.readStateRevision||0)!==expectedRevision)throw fail(409,'READ_STATE_CONFLICT','The reading state changed in another request; retry from the last completed page.');row.readState=structuredClone(state);row.readStateRevision=expectedRevision+1;return {revision:row.readStateRevision};});
 }
 async function invalidateReadState(token){tokenValid(token);return store.mutate(key,empty(),data=>{const row=rowFor(data,token);check(row,'people:read');row.readState=null;row.readStateRevision=(row.readStateRevision||0)+1;return {revision:row.readStateRevision};});}
 async function revoke(user,grantId){
  if(!user?.id)throw fail(401);
  const result=await store.mutate(key,empty(),data=>{const row=data.grants.find(g=>g.id===grantId&&g.ownerId===user.id);if(!row)throw fail(404);row.revoked=true;row.revocationPending=true;row.readState=null;return {revoked:true};});
  // A failed fence leaves access revoked but cannot acknowledge withdrawal.
  // Retain its row across grant cleanup so the owner can retry the barrier.
  if(typeof people?.fenceWrites==='function')await people.fenceWrites();
  await store.mutate(key,empty(),data=>{const row=data.grants.find(g=>g.id===grantId&&g.ownerId===user.id);if(row)row.revocationPending=false;});
  return result;
 }
 return {issue,authenticate,create,readState,saveReadState,invalidateReadState,revoke};
}
