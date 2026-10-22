import {authMessageId} from './auth-errors.mjs';
export function billingErrorDetails(body){
  const receipt=body?.billingOperation;
  return receipt&&typeof receipt.id==='string'&&receipt.id.length>0&&receipt.id.length<=256&&['not_started','released','cancelled','reversed'].includes(receipt.status)?{billingOperation:{id:receipt.id,status:receipt.status}}:{};
}

export function createOwnerScope(initial='guest'){
  let owner=initial,revision=0;
  const current=ticket=>ticket?.owner===owner&&ticket.revision===revision;
  const assert=ticket=>{if(!current(ticket))throw Object.assign(Error('账户已切换，请重新操作。'),{status:409});};
  return {capture:()=>({owner,revision}),isCurrent:current,assertCurrent:assert,adopt(next){if(owner===next)return false;owner=next;revision++;return true;},async run(ticket,operation){assert(ticket);let value;try{value=await operation();}catch(error){assert(ticket);throw error;}assert(ticket);return value;}};
}

export function readOwnerResponse(scope,ticket,request,onSessionChanged){
  return scope.run(ticket,async()=>{
    const response=await request();
    scope.assertCurrent(ticket);
    if(response.headers.get('X-Reader-Session-Changed')==='1'){
      onSessionChanged();throw Error('账户已切换，请重新进入书房。');
    }
    let body;try{body=await response.json();}catch{throw Object.assign(Error('服务暂时无法连接，请稍后重试'),{status:response.status,retryable:response.ok||[408,500,502,503,504].includes(response.status)});}
    if(!response.ok){const error=Object.assign(Error(typeof body?.error==='string'?body.error:'暂时无法完成'),{status:response.status,...billingErrorDetails(body)});const messageId=authMessageId(body?.messageId);if(messageId)error.messageId=messageId;if(Number.isInteger(body?.retryAfter)&&body.retryAfter>0)error.retryAfter=Math.min(3600,body.retryAfter);throw error;}
    return body;
  });
}
