import {AsyncLocalStorage} from 'node:async_hooks';
import {randomUUID} from 'node:crypto';
import {priceProviderUsage} from './provider-pricing.mjs';

const storage=new AsyncLocalStorage();
const field=(value,key)=>{try{const d=Object.getOwnPropertyDescriptor(value,key);return d&&Object.hasOwn(d,'value')?d.value:undefined;}catch{return undefined;}};
const count=value=>Number.isSafeInteger(value)&&value>=0?value:null;
const identifier=(value,max=160)=>typeof value==='string'&&value.length>0&&value.length<=max&&/^[a-zA-Z0-9_.:@/-]+$/.test(value)?value:undefined;
const iso=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))?new Date(value).toISOString():undefined;

export const providerMeterContext=()=>storage.getStore();
export function withProviderMeter(context,fn){
 if(typeof fn!=='function'||!identifier(context?.ownerId)||typeof context.record!=='function'||!identifier(context.feature)||!identifier(context.funding))throw Error('Invalid provider meter context');
 const safe={ownerId:context.ownerId,feature:context.feature,funding:context.funding,record:context.record};
 if(context.operationId!==undefined){if(!identifier(context.operationId))throw Error('Invalid provider meter operation');safe.operationId=context.operationId;}
 if(context.maxCostUsd!==undefined){if(!Number.isFinite(context.maxCostUsd)||context.maxCostUsd<=0)throw Error('Invalid provider meter budget');safe.maxCostUsd=context.maxCostUsd;}
 return storage.run(Object.freeze(safe),fn);
}
export function normalizeDshUsage(raw){
 return Object.fromEntries(['inputTokens','outputTokens','cacheReadTokens','cacheWriteTokens'].map(key=>[key,count(field(raw,key))]));
}
export function normalizeDeepSeekUsage(raw){
 const total=count(field(raw,'prompt_tokens')),hit=count(field(raw,'prompt_cache_hit_tokens')),miss=count(field(raw,'prompt_cache_miss_tokens'));
 let input=miss;
 if(total!==null&&hit!==null){const difference=total-hit;if(difference<0||(miss!==null&&miss!==difference))input=null;else input=difference;}
 return {inputTokens:input,outputTokens:count(field(raw,'completion_tokens')),cacheReadTokens:hit,cacheWriteTokens:null};
}
// Persist before crossing the provider boundary. A process lost after dispatch
// leaves one visible unknown attempt instead of disappearing from cost coverage.
export const recordProviderDispatch=facts=>recordProviderCall({...facts,status:'unknown'});
export async function recordProviderCall(facts){
 const context=storage.getStore();if(!context)return null;
 const id=identifier(field(facts,'id')),model=identifier(field(facts,'model')),provider=identifier(field(facts,'provider')),startedAt=iso(field(facts,'startedAt'));
 if(!id||!model||!provider||!startedAt)throw Error('Invalid provider call facts');
 const status=['completed','failed','cancelled','unknown'].includes(field(facts,'status'))?field(facts,'status'):'unknown';
 const usage=normalizeDshUsage(field(facts,'usage'));
 const row={ownerId:context.ownerId,...(context.operationId?{operationId:context.operationId}:{}),feature:context.feature,funding:context.funding,id,provider,model,status,usage,startedAt,...(iso(field(facts,'finishedAt'))?{finishedAt:iso(field(facts,'finishedAt'))}:{})};
 const rated=field(facts,'costStatus'),cost=field(facts,'costMicrousd');
 row.costStatus=['reported_usage_rated','partial','invoice_reconciled'].includes(rated)&&count(cost)!==null?rated:'unknown';row.costMicrousd=row.costStatus==='unknown'?null:cost;
 const pricingVersion=identifier(field(facts,'pricingVersion'));if(pricingVersion)row.pricingVersion=pricingVersion;
 try{return await context.record(Object.freeze(row));}catch{throw Object.assign(Error('Provider metering unavailable'),{code:'provider_meter_unavailable',status:503});}
}

// Installed DSH 0.2.1-alpha.2: assistant/message.data.usage is the single
// authoritative step counter. A failed assistant/attempt has compact stream
// records {type:'chunk',time,chunk:{type:'usage',usage}}. Never sum the stream
// and message counter, nor add reasoningTokens to outputTokens.
export function createDshMeter({model='deepseek-flash',startedAt=new Date().toISOString(),idPrefix=randomUUID()}={}){
 const events=[],seenSeq=new Set(),seenObjects=new WeakSet();let flushed=false,flushing;
 return {
  observe(event){
   const type=field(event,'type');if(!['assistant/message','assistant/attempt'].includes(type))return;
   const seq=field(event,'seq');if(Number.isSafeInteger(seq)){if(seenSeq.has(seq))return;seenSeq.add(seq);}else if(event&&typeof event==='object'){if(seenObjects.has(event))return;seenObjects.add(event);}
   const data=field(event,'data'),stream=field(data,'stream');let raw=type==='assistant/message'?field(data,'usage'):undefined,finish;
   if(Array.isArray(stream))for(const record of stream){if(field(record,'type')!=='chunk')continue;const chunk=field(record,'chunk');if(type==='assistant/attempt'&&field(chunk,'type')==='usage')raw=field(chunk,'usage');if(field(chunk,'type')==='finish')finish=field(field(chunk,'reason'),'kind');}
   const interrupted=field(data,'interrupted')===true;
   const status=interrupted||finish==='aborted'?'cancelled':type==='assistant/attempt'||(finish&&finish!=='stop'&&finish!=='tool-calls')?'failed':'completed';
   const time=field(event,'time');events.push({seq:Number.isSafeInteger(seq)?seq:null,usage:normalizeDshUsage(raw),status,finishedAt:Number.isFinite(time)?new Date(time).toISOString():undefined});
  },
  async flush({attempts=[],finishedAt=new Date().toISOString()}={}){
   if(flushed)return;if(flushing)return flushing;
   flushing=(async()=>{
    for(let i=0;i<Math.max(events.length,attempts.length);i++){
     const event=events[i],attempt=attempts[i],usage=event?.usage??normalizeDshUsage();
     const begun=attempt?.startedAt||startedAt;
     await recordProviderCall({id:attempt?.id||`${idPrefix}:${event?.seq??i}`,provider:'deepseek',model,status:event?.status||'unknown',usage,startedAt:begun,finishedAt:event?.finishedAt||finishedAt,...priceProviderUsage({usage,model,startedAt:begun})});
    }
    flushed=true;
   })();
   try{await flushing;}finally{flushing=undefined;}
  }
 };
}
