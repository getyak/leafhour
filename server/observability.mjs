import {mkdir,readFile,writeFile,rename,unlink} from 'node:fs/promises';
import path from 'node:path';
import {createHash,createHmac,randomUUID} from 'node:crypto';
import {validateObservabilityBatch,validateObservabilityEvent,observabilityCategory} from '../app/observability-contract.mjs';

const queues=new Map(),MAX_PENDING=100,MAX_SEEN=256,RETENTION_MS=86400000,TIMEOUT_MS=1800;
const serverNames=new Set(['ingestion_completed','ingestion_failed','chat_failed']);
let sentryActive=0;const sentryWaiting=[];
async function sentrySlot(execute){if(sentryActive>=4)await new Promise(resolve=>sentryWaiting.push(resolve));else sentryActive++;try{return await execute();}finally{const next=sentryWaiting.shift();if(next)next();else sentryActive--;}}
const fail=status=>Object.assign(new Error('Observability request unavailable'),{status});
const initial=()=>({kind:'leafhour-observability',schemaVersion:1,revision:0,analytics:false,diagnostics:false});
function identity(user){if(typeof user?.id!=='string'||!user.id||user.id.length>512||/[\x00-\x1f\x7f]/.test(user.id))throw fail(401);return user.id;}
function parseConsent(value){if(value?.excluded!==undefined&&typeof value.excluded!=='boolean')throw fail(409);if(!value||value.kind!=='leafhour-observability'||value.schemaVersion!==1||!Number.isSafeInteger(value.revision)||value.revision<0||typeof value.analytics!=='boolean'||typeof value.diagnostics!=='boolean')throw fail(409);return value;}
function releaseOf(env){const value=env.VERCEL_GIT_COMMIT_SHA||env.GITHUB_SHA||env.SOURCE_VERSION;return typeof value==='string'&&/^[a-f0-9]{7,64}$/i.test(value)?value.toLowerCase():null;}
function secureOrigin(value){try{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password&&url.pathname==='/'&&!url.search&&!url.hash?url.origin:null;}catch{return null;}}
function sentryDsn(value){try{const url=new URL(value);return url.protocol==='https:'&&/^\w+$/.test(url.username)&&!url.password&&/^\/[0-9]+$/.test(url.pathname)&&!url.search&&!url.hash?url.href:null;}catch{return null;}}
function suppressed(properties){return properties?.errorKind==='aborted'||properties?.outcome==='cancelled'||properties?.status>=400&&properties.status<500;}
// No SDK initialization or global instrumentation occurs at import or construction.
export function createObservability({dataDir,dataStore=null,env=process.env,schedule=()=>{},fetcher=globalThis.fetch,now=()=>Date.now()}={}){
  const release=releaseOf(env),secret=typeof env.OBSERVABILITY_ID_SECRET==='string'&&env.OBSERVABILITY_ID_SECRET.length>=32?env.OBSERVABILITY_ID_SECRET:null;
  const posthogHost=secureOrigin(env.POSTHOG_HOST||'https://us.i.posthog.com'),projectKey=typeof env.POSTHOG_PROJECT_KEY==='string'&&env.POSTHOG_PROJECT_KEY.length<=512?env.POSTHOG_PROJECT_KEY:null,dsn=sentryDsn(env.SENTRY_DSN);
  const globallyEnabled=['1','true'].includes(env.LEAFHOUR_OBSERVABILITY_ENABLED),enabled=globallyEnabled&&!!secret&&!!(projectKey&&posthogHost||dsn);
  const environment=['production','preview','development'].includes(env.VERCEL_ENV)?env.VERCEL_ENV:'development';
  const excludedIds=new Set(String(env.OBSERVABILITY_EXCLUDED_USER_IDS||'').split(',').map(value=>value.trim()).filter(Boolean));
  let pending=0,systemSeen=[];
  const excluded=(user,record)=>String(user?.email||'').trim().toLowerCase()==='test@cubxxw.com'||excludedIds.has(user?.id)||record?.excluded===true;
  const file=(user,name='observability.json')=>path.join(dataDir,'users',createHash('sha256').update(identity(user)).digest('hex'),name);
  async function read(location,fallback){const waiting=queues.get(location);if(waiting)await waiting.catch(()=>{});if(dataStore){const value=await dataStore.read(location,fallback());return value===undefined?fallback():value;}try{return JSON.parse(await readFile(location,'utf8'));}catch(error){if(error.code==='ENOENT')return fallback();throw error;}}
  async function mutate(location,fallback,operation){
    if(dataStore)return dataStore.mutate(location,fallback(),operation);
    const previous=queues.get(location)||Promise.resolve(),work=previous.catch(()=>{}).then(async()=>{
      let value;try{value=JSON.parse(await readFile(location,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;value=fallback();}
      const result=operation(value),temp=location+'.'+randomUUID()+'.pending';await mkdir(path.dirname(location),{recursive:true,mode:0o700});
      try{await writeFile(temp,JSON.stringify(value),{mode:0o600});await rename(temp,location);}finally{await unlink(temp).catch(()=>{});}return result;
    });queues.set(location,work);try{return await work;}finally{if(queues.get(location)===work)queues.delete(location);}
  }
  const consent=async user=>parseConsent(await read(file(user),initial));
  async function config(user){identity(user);const value=await consent(user);return {enabled,analytics:value.analytics,diagnostics:value.diagnostics,excluded:excluded(user,value),release};}
  async function setConsent(user,input){
    identity(user);if(!input||Array.isArray(input)||typeof input!=='object'||Object.keys(input).length!==2||Object.keys(input).some(key=>!['analytics','diagnostics'].includes(key))||typeof input.analytics!=='boolean'||typeof input.diagnostics!=='boolean')throw fail(400);
    await mutate(file(user),initial,value=>{parseConsent(value);if(value.revision===Number.MAX_SAFE_INTEGER)throw fail(409);value.excluded=excluded(user,value);value.revision++;value.analytics=input.analytics;value.diagnostics=input.diagnostics;});return config(user);
  }
  async function boundedFetch(url,options){
    const controller=new AbortController();let timer;
    const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('Observability transport timed out'));},TIMEOUT_MS);});
    try{return await Promise.race([Promise.resolve().then(()=>fetcher(url,{...options,redirect:'error',signal:controller.signal})),timeout]);}finally{clearTimeout(timer);}
  }
  async function allowed(user,revision,category){const value=await consent(user);return value.revision===revision&&value[category]&&!(category==='analytics'&&excluded(user,value));}
  async function posthog(user,revision,event,actor,synthetic){
    if(!projectKey||!posthogHost||!await allowed(user,revision,observabilityCategory(event.name)))return;
    const payload={api_key:projectKey,event:event.name,distinct_id:actor,timestamp:event.occurredAt,uuid:event.id,properties:{...event.properties,operationId:event.operationId,release,environment,synthetic,$process_person_profile:false,$ip:null,disable_geoip:true}};
    await boundedFetch(posthogHost+'/i/v0/e/',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
  }
  async function sendSentry(user,revision,event,actor,synthetic,system=false){
    if(!dsn||observabilityCategory(event.name)!=='diagnostics'||event.name==='ingestion_completed'||suppressed(event.properties))return;
    const {NodeClient,createTransport}=await import('@sentry/node');
    if(!system&&!await allowed(user,revision,'diagnostics'))return;
    const tags={event:event.name,operationId:event.operationId,synthetic:String(synthetic),system:String(system)};for(const [key,value] of Object.entries(event.properties))tags[key]=String(value);
    const safe={event_id:event.id.replaceAll('-',''),timestamp:Date.parse(event.occurredAt)/1000,platform:'javascript',level:'error',release:release||undefined,environment,...(system?{}:{user:{id:actor}}),tags,exception:{values:[{type:'LeafhourOperationalError',value:event.name}]},fingerprint:[event.name,event.properties.stage||'unknown',event.properties.errorKind||'unknown',String(event.properties.status||0)]};
    const client=new NodeClient({dsn,defaultIntegrations:false,integrations:[],sendDefaultPii:false,sendClientReports:false,autoSessionTracking:false,enableTracing:false,includeServerName:false,enableRuntimeChannelInjection:false,enableLogs:false,enableMetrics:false,beforeSend:()=>structuredClone(safe),transport:options=>createTransport({bufferSize:1},async request=>{
      // Recheck directly before the actual HTTP request as SDK preparation can yield.
      if(!system&&!await allowed(user,revision,'diagnostics'))return {statusCode:200};
      const response=await boundedFetch(options.url,{method:'POST',headers:{'Content-Type':'application/x-sentry-envelope'},body:request.body});return {statusCode:response.status,headers:{}};
    })});client.captureEvent(structuredClone(safe));try{await client.flush(TIMEOUT_MS+100);}finally{await client.close(0);}
  }
  async function sentry(...args){if(!dsn||observabilityCategory(args[2].name)!=='diagnostics'||args[2].name==='ingestion_completed'||suppressed(args[2].properties))return;return sentrySlot(()=>sendSentry(...args));}
  async function accept(user,input,trusted={}){
    identity(user);const events=validateObservabilityBatch(input);if(trusted.internal!==true&&events.some(event=>event.properties.client==='server'||serverNames.has(event.name)))throw fail(400);if(!enabled||pending>=MAX_PENDING)return {accepted:0};
    let value;try{value=await consent(user);}catch{return {accepted:0};}
    const selected=events.filter(event=>value[observabilityCategory(event.name)]&&!(observabilityCategory(event.name)==='analytics'&&excluded(user,value))&&!(observabilityCategory(event.name)==='diagnostics'&&suppressed(event.properties)));
    if(!selected.length)return {accepted:0};
    let accepted;try{accepted=await mutate(file(user,'observability-seen.json'),()=>({seen:[]}),record=>{
      if(!Array.isArray(record.seen))record.seen=[];const at=now();record.seen=record.seen.filter(row=>typeof row.id==='string'&&Number.isFinite(row.at)&&at-row.at<RETENTION_MS);const seen=new Set(record.seen.map(row=>row.id)),fresh=[],budget=Math.max(0,Math.min(MAX_SEEN-record.seen.length,30-record.seen.filter(row=>at-row.at<60000).length));
      for(const event of selected){if(seen.has(event.id)||fresh.length>=budget)continue;seen.add(event.id);record.seen.push({id:event.id,at});fresh.push(event);}return fresh;
    });}catch{return {accepted:0};}
    if(!accepted.length||pending>=MAX_PENDING)return {accepted:0};
    // Capture only this request's authenticated identity; there is no global scope.
    const owner={id:user.id,email:user.email},synthetic=trusted.synthetic===true||excluded(user,value),actor=createHmac('sha256',secret).update(user.id).digest('hex');pending++;
    const work=new Promise(resolve=>setTimeout(resolve,0)).then(()=>Promise.allSettled(accepted.flatMap(event=>[posthog(owner,value.revision,event,actor,synthetic),sentry(owner,value.revision,event,actor,synthetic)]))).catch(()=>{}).finally(()=>{pending--;});
    try{schedule(work);}catch{}return {accepted:accepted.length};
  }
  async function event(user,name,properties={},context={}){
    let id=randomUUID();
    if(secret&&typeof context.dedupKey==='string'&&context.dedupKey.length<=512){const hex=createHmac('sha256',secret).update(JSON.stringify([identity(user),name,context.dedupKey])).digest('hex'),variant=(parseInt(hex[16],16)&3|8).toString(16);id=hex.slice(0,8)+'-'+hex.slice(8,12)+'-4'+hex.slice(13,16)+'-'+variant+hex.slice(17,20)+'-'+hex.slice(20,32);}
    const row=validateObservabilityEvent({id,operationId:context.operationId||randomUUID(),name,occurredAt:new Date(now()).toISOString(),properties:{...properties,client:'server'}});if(!row)return false;
    try{return (await accept(user,{events:[row]},{internal:true,synthetic:context.synthetic===true})).accepted===1;}catch{return false;}
  }
  async function reportError(user,error,context={}){
    if(!user?.id||error?.name==='AbortError'||error?.code==='ABORT_ERR'||Number.isInteger(error?.status)&&error.status<500)return false;
    const status=Number.isInteger(error?.status)&&error.status>=500&&error.status<=599?error.status:500;
    const errorKind=['ETIMEDOUT','UND_ERR_CONNECT_TIMEOUT'].includes(error?.code)?'timeout':['ECONNRESET','ECONNREFUSED','ENOTFOUND'].includes(error?.code)?'network':'internal';
    const page=['reader','library','other'].includes(context.page)?context.page:'other',stage=['reader_load','ingestion','chat','request'].includes(context.stage)?context.stage:'request';
    return event(user,stage==='chat'?'chat_failed':stage==='ingestion'?'ingestion_failed':'request_failed',{page,stage,status,errorKind,outcome:'failure'},context);
  }
  async function reportSystemError(error,context={}){
    if(!globallyEnabled||!dsn||pending>=MAX_PENDING||error?.name==='AbortError'||error?.code==='ABORT_ERR'||Number.isInteger(error?.status)&&error.status<500)return false;
    const at=now();systemSeen=systemSeen.filter(time=>at-time<RETENTION_MS);if(systemSeen.length>=100||systemSeen.filter(time=>at-time<60000).length>=5)return false;systemSeen.push(at);
    const status=Number.isInteger(error?.status)&&error.status>=500&&error.status<=599?error.status:500;
    const row={id:randomUUID(),operationId:randomUUID(),name:'request_failed',occurredAt:new Date(at).toISOString(),properties:{page:'other',stage:'request',client:'server',outcome:'failure',errorKind:'internal',status}};
    pending++;const work=Promise.resolve().then(()=>sentry(null,null,row,null,false,true)).catch(()=>{}).finally(()=>{pending--;});try{schedule(work);}catch{}return true;
  }
  return {config,setConsent,accept,reportError,reportSystemError,event};
}
