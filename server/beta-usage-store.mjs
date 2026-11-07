import path from 'node:path';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {createLockedJsonStore} from './locked-json-store.mjs';
const fail=(message,status=400)=>Object.assign(Error(message),{status});
const hash=value=>createHash('sha256').update(value).digest('hex');
const keys=['id','ownerId','operationId','feature','funding','provider','model','status','usage','costMicrousd','costStatus','startedAt','finishedAt','pricingVersion'];
const identity=['id','ownerId','operationId','feature','funding','provider','model','startedAt'];
const identifier=value=>typeof value==='string'&&value.length>0&&value.length<=200&&/^[A-Za-z0-9_.:@/-]+$/.test(value);
const count=value=>Number.isSafeInteger(value)&&value>=0;
function clean(facts){
 const row=Object.fromEntries(keys.filter(k=>facts[k]!==undefined).map(k=>[k,structuredClone(facts[k])]));
 if(['id','ownerId','feature','funding','provider','model'].some(k=>!identifier(row[k]))||row.operationId!==undefined&&!identifier(row.operationId))throw fail('Invalid usage identity');
 if(!['completed','failed','cancelled','unknown'].includes(row.status)||!['reported_usage_rated','partial','invoice_reconciled','unknown'].includes(row.costStatus)||row.costMicrousd!==null&&!count(row.costMicrousd))throw fail('Invalid usage facts');
 for(const key of ['startedAt','finishedAt'])if(row[key]!==undefined){const date=Date.parse(row[key]);if(!Number.isFinite(date))throw fail('Invalid usage time');row[key]=new Date(date).toISOString();}
 if(!row.startedAt)throw fail('Missing usage time');
 row.usage=Object.fromEntries(['inputTokens','outputTokens','cacheReadTokens','cacheWriteTokens'].map(k=>{const value=row.usage?.[k]??null;if(value!==null&&!count(value))throw fail('Invalid usage count');return [k,value];}));
 return row;
}
const known=row=>count(row.costMicrousd)&&['reported_usage_rated','invoice_reconciled'].includes(row.costStatus);
export function providerUsageSummary(rows,{from,to}){
 const calls=rows.length,unknownCostCalls=rows.filter(row=>!known(row)).length;
 const group=key=>{const result=Object.create(null);for(const row of rows){const entry=result[row[key]]??={calls:0,knownCostMicrousd:0,unknownCostCalls:0};entry.calls++;entry.knownCostMicrousd+=row.costMicrousd||0;if(!known(row))entry.unknownCostCalls++;}return result;};
 return {calls,knownCostMicrousd:rows.reduce((n,row)=>n+(row.costMicrousd||0),0),unknownCostCalls,callsByFunding:group('funding'),callsByFeature:group('feature'),costCoverage:calls?(calls-unknownCostCalls)/calls:null,complete:calls>0&&unknownCostCalls===0,costBasis:'usage_estimate',from,to};
}
export function mergeProviderUsage(prior,current){
 const result={...prior,...current};
 for(const key of ['calls','knownCostMicrousd','unknownCostCalls'])result[key]=(prior[key]||0)+(current[key]||0);
 for(const key of ['callsByFunding','callsByFeature']){result[key]=Object.create(null);for(const source of [prior[key]||{},current[key]||{}])for(const [name,value]of Object.entries(source)){const row=result[key][name]??={calls:0,knownCostMicrousd:0,unknownCostCalls:0};for(const metric of ['calls','knownCostMicrousd','unknownCostCalls'])row[metric]+=value[metric]||0;}}
 result.costCoverage=result.calls?(result.calls-result.unknownCostCalls)/result.calls:null;result.complete=result.calls>0&&result.unknownCostCalls===0;
 return result;
}
function memoryStore(){const rows=new Map();return {async read(key,seed){return structuredClone(rows.get(key)??seed);},async mutate(key,seed,fn){const row=structuredClone(rows.get(key)??seed),result=fn(row);rows.set(key,row);return structuredClone(result);}};}
// Existing reader-document CAS storage: no commercial schema, credit grant or
// payment readiness is needed. Stable call-ID shards retain history without a
// daily usage allocation; the index contains only the 256 possible shard names.
export function createBetaUsageStore({dataDir,dataStore}={}){
 const store=dataStore||(dataDir?createLockedJsonStore({dataDir:path.join(dataDir,'beta-usage')}):memoryStore()),indexed=new Set();
 const root=mode=>{if(!['test','live'].includes(mode))throw fail('Invalid usage mode');return 'usage/beta/v1/'+mode;};
 return {async command(action,p){
  const base=root(p.mode);
  if(action==='providerCall'){
   const row=clean(p),key=hash(row.id),shard=key.slice(0,2),indexKey=base+'/index';
   if(!indexed.has(base+'/'+shard)){await store.mutate(indexKey,{schemaVersion:1,shards:{}},index=>{index.shards[shard]=true;return null;});indexed.add(base+'/'+shard);}
   return store.mutate(base+'/'+shard,{schemaVersion:1,calls:{}},bucket=>{
    const prior=bucket.calls[key];
    if(prior&&!isDeepStrictEqual(prior,row)){
     const open=prior.status==='unknown'&&!prior.finishedAt&&prior.costStatus==='unknown'&&prior.costMicrousd===null&&Object.values(prior.usage).every(value=>value===null);
     if(!identity.every(k=>prior[k]===row[k])||!open||!row.finishedAt)throw fail('Usage identity conflict',409);
    }
    bucket.calls[key]=row;return row;
   });
  }
  if(action!=='summary')throw fail('Unsupported usage action');
  const from=Date.parse(p.from),to=Date.parse(p.to);
  if(!Number.isFinite(from)||!Number.isFinite(to)||to<=from||to-from>366*86400000)throw fail('Invalid usage range');
  const index=await store.read(base+'/index',{shards:{}}),shards=Object.keys(index.shards),rows=[];
  if(shards.some(shard=>!/^[a-f0-9]{2}$/.test(shard)))throw fail('Usage index unavailable',503);
  for(let i=0;i<shards.length;i+=8){const buckets=await Promise.all(shards.slice(i,i+8).map(shard=>store.read(base+'/'+shard,{calls:{}})));for(const bucket of buckets)for(const row of Object.values(bucket.calls)){const at=Date.parse(row.startedAt);if(at>=from&&at<to)rows.push(row);}}
  return providerUsageSummary(rows,p);
 }};
}
