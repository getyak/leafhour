import {withProviderMeter} from './provider-metering.mjs';
const fail=(message,status)=>Object.assign(Error(message),{status});
// This explicit, capped sponsored action does not debit a reader's balance.
// Attempts retain their reservation even after transport failure; unknown cost
// is never silently reclassified as zero and cannot admit an unlimited retry.
export function createPeopleFunding({store,clock=Date.now,perOwnerLimit=20,totalLimit=80,maxCostUsd=.02}={}){
 if(!store?.mutate||maxCostUsd<=0||maxCostUsd>.02)throw Error('Person funding requires a bounded durable store');
 const key='people/funding-v1',empty=()=>({day:Math.floor(clock()/86400000),attempts:{},calls:{}});
 async function fund({user,personId,taskId,maxCostCny,fundingConsent,signal,run}){
  if(!user?.id||user.is_anonymous)throw fail('请先进入自己的书房。',401);
  if(fundingConsent!==true||typeof taskId!=='string'||taskId.length>128||typeof run!=='function'||!Number.isFinite(maxCostCny)||maxCostCny<=0||maxCostCny>.75)throw fail('请先确认这次人物整理的范围。',402);
  signal?.throwIfAborted();
  await store.mutate(key,empty(),data=>{const day=Math.floor(clock()/86400000);if(data.day!==day){data.day=day;data.attempts={};data.calls={};}if(data.attempts[taskId])throw fail('这次整理已进入处理，请查看原任务。',409);const rows=Object.values(data.attempts);if(rows.length>=totalLimit||rows.filter(r=>r.ownerId===user.id).length>=perOwnerLimit)throw fail('今天的人物整理额度已用完，已有资料仍可阅读。',429);data.attempts[taskId]={ownerId:user.id,personId,maxCostUsd,status:'reserved',startedAt:new Date(clock()).toISOString()};});
  const record=async facts=>store.mutate(key,empty(),data=>{const reservation=data.attempts[taskId];if(!reservation||reservation.ownerId!==user.id)throw Error('Missing person funding reservation');data.calls[facts.id]={...facts,taskId};return null;});
  try{signal?.throwIfAborted();const result=await withProviderMeter({ownerId:user.id,operationId:taskId,feature:'person-portrait',funding:'sponsored',maxCostUsd,record},run);await store.mutate(key,empty(),d=>{if(d.attempts[taskId])d.attempts[taskId].status='completed';});return result;}
  catch(error){await store.mutate(key,empty(),d=>{if(d.attempts[taskId])d.attempts[taskId].status=signal?.aborted?'cancelled':'failed';});throw error;}
 }
 return {fund,maxCostUsd,perOwnerLimit,totalLimit};
}
