import {assertPricingWindow} from './pricing-reference.mjs';
// Verified against the official pricing page on 2026-10-27. USD estimates are
// separate from customer credits and from the legacy CNY admission guard.
export const DEEPSEEK_PRICING=Object.freeze({
 version:'deepseek-flash-usd-2026-10-27',model:'deepseek-flash',currency:'USD',
 source:'https://api-docs.deepseek.com/quick_start/pricing/',
 checkedAt:'2026-10-27T00:19:49.314Z',validUntil:'2026-10-31T16:00:00.000Z',
 peak:Object.freeze({inputPerMillion:.3,cacheReadPerMillion:.006,outputPerMillion:1.2}),
 offpeak:Object.freeze({inputPerMillion:.15,cacheReadPerMillion:.003,outputPerMillion:.6}),
 searchPerThousand:.75,fetchPerThousand:.75,harnessToolsFreeUntil:'2026-10-31T16:00:00.000Z'
});
const knownCount=value=>Number.isSafeInteger(value)&&value>=0;
function reference(pricing,model,now){
 if(model!==pricing?.model||model!=='deepseek-flash')throw Error('Model pricing unavailable');
 assertPricingWindow(pricing,now);
 for(const period of ['peak','offpeak'])for(const field of ['inputPerMillion','cacheReadPerMillion','outputPerMillion'])if(!Number.isFinite(pricing[period]?.[field])||pricing[period][field]<=0)throw Error('Pricing reference unavailable');
 return pricing;
}

// UTF-8 bytes are deliberately a conservative reservation proxy, never stored
// as billed tokens. Tool fees reserve the standalone price even during a free
// promotion because the installed auxiliary adapter does not expose fee identity.
export function createProviderBudget({model='deepseek-flash',maxCostUsd=.12,pricing=DEEPSEEK_PRICING,clock=Date.now,maxRequests=8,maxToolCalls=24}={}){
 reference(pricing,model,clock());
 if(!Number.isFinite(maxCostUsd)||maxCostUsd<=0||!Number.isSafeInteger(Math.round(maxCostUsd*1e6))||Math.floor(maxCostUsd*1e6)<1||!Number.isSafeInteger(maxRequests)||maxRequests<=0||!knownCount(maxToolCalls))throw Error('Invalid cost budget');
 const maxCostMicrousd=Math.floor(maxCostUsd*1e6);let requests=0,toolCalls=0,reservedCostMicrousd=0,blocked=false;const requestSizes=[];
 const fail=()=>{blocked=true;throw Error('Generation budget exhausted');};
 return {
  reserveRequest({inputBytes,maxTokens,kind}={}){
   reference(pricing,model,clock());
   if(blocked||!['main','web'].includes(kind)||!knownCount(inputBytes)||inputBytes>65536||!knownCount(maxTokens)||maxTokens===0||requests>=maxRequests)return fail();
   const cost=Math.ceil(inputBytes*pricing.peak.inputPerMillion+maxTokens*pricing.peak.outputPerMillion+(kind==='web'?pricing.searchPerThousand*1000:0));
   if(!Number.isSafeInteger(cost)||cost+reservedCostMicrousd>maxCostMicrousd)return fail();
   requests++;reservedCostMicrousd+=cost;requestSizes.push({kind,inputBytes,maxTokens});return {maxTokens};
  },
  tool(){if(blocked||++toolCalls>maxToolCalls)return fail();},
  snapshot:()=>({requests,toolCalls,reservedCostMicrousd,maxCostMicrousd,currency:'USD',settlement:'reservation-not-invoice',requestSizes:requestSizes.map(row=>({...row})),pricing:{version:pricing.version,source:pricing.source,checkedAt:pricing.checkedAt,validUntil:pricing.validUntil},toolFeeBasis:'standalone-upper-bound'})
 };
}

// Outside weekday peak windows, off-peak is authoritative regardless of the
// Chinese holiday calendar. Inside them, a missing holiday calendar makes the
// peak calculation an upper bound, so it is explicitly partial, not exact cost.
export function priceProviderUsage({usage,model='deepseek-flash',startedAt,pricing=DEEPSEEK_PRICING,clock=Date.now,cacheWriteIncludedInInput=false}={}){
 const unknown={costMicrousd:null,costStatus:'unknown'};
 try{reference(pricing,model,clock());}catch{return unknown;}
 if(!knownCount(usage?.inputTokens)||!knownCount(usage?.outputTokens)||!knownCount(usage?.cacheReadTokens))return unknown;
 if(!knownCount(usage.cacheWriteTokens)&&!(cacheWriteIncludedInInput&&usage.cacheWriteTokens===null))return unknown;
 const time=new Date(startedAt),hour=time.getUTCHours(),weekday=time.getUTCDay();
 if(!Number.isFinite(time.getTime()))return unknown;
 const peak=weekday>=1&&weekday<=5&&((hour>=1&&hour<4)||(hour>=6&&hour<10));
 const rate=peak?pricing.peak:pricing.offpeak;
 const costMicrousd=Math.ceil((usage.inputTokens+(usage.cacheWriteTokens??0))*rate.inputPerMillion+usage.cacheReadTokens*rate.cacheReadPerMillion+usage.outputTokens*rate.outputPerMillion);
 if(!Number.isSafeInteger(costMicrousd))return unknown;
 return {costMicrousd,costStatus:peak?'partial':'reported_usage_rated',pricingVersion:pricing.version};
}
