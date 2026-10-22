import {fail} from './document-import.mjs';

const error=(message,status=400)=>fail(message,status);
const exact=(body,keys)=>{if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!keys.includes(k)))throw error('收费请求格式不正确');return body;};
function paging(url){
 if([...url.searchParams.keys()].some(k=>!['limit','cursor'].includes(k))||[...url.searchParams.keys()].some(k=>url.searchParams.getAll(k).length!==1))throw error('账单分页参数无效');
 const raw=url.searchParams.get('limit'),limit=raw===null?30:Number(raw),cursor=url.searchParams.get('cursor')||undefined;
 if(!Number.isSafeInteger(limit)||limit<1||limit>100||cursor&&cursor.length>512)throw error('账单分页参数无效');
 return {limit,...(cursor?{cursor}:{})};
}
export async function readWebhookBytes(req,{maxBytes=256*1024}={}){
 if(Number(req.headers?.['content-length'])>maxBytes)throw error('支付通知过大',413);
 if(req.rawBody!==undefined){if(!Buffer.isBuffer(req.rawBody))throw error('支付通知必须保留原始字节',415);if(req.rawBody.length>maxBytes)throw error('支付通知过大',413);return req.rawBody;}
 if(req.body!==undefined&&req.body!==null){if(!Buffer.isBuffer(req.body)&&typeof req.body!=='string')throw error('支付通知必须保留原始字节',415);const b=Buffer.isBuffer(req.body)?req.body:Buffer.from(req.body);if(b.length>maxBytes)throw error('支付通知过大',413);return b;}
 const chunks=[];let size=0;
 for await(const part of req){const b=Buffer.isBuffer(part)?part:Buffer.from(part);size+=b.length;if(size>maxBytes)throw error('支付通知过大',413);chunks.push(b);}
 return Buffer.concat(chunks);
}
export function createBillingRoutes({billing,publicOrigin,gate,verifyEmail}={}){
 if(!billing)throw new TypeError('Billing service is required');
 async function webhook({req,send}){
  if(req.method!=='POST')throw error('不支持这个请求',405);
  const rawBody=await readWebhookBytes(req),signature=req.headers?.['creem-signature'];
  const result=await billing.webhook({rawBody,signature});send(200,result||{received:true});return true;
 }
 async function handle({req,res,url,user,body,send}){
  const p=url.pathname;
  if(p==='/api/webhooks/creem')return webhook({req,send});
  if(!p.startsWith('/api/billing/')&&p!=='/api/admin/billing/summary')return false;
  res.setHeader('Cache-Control','private, no-store');res.setHeader('X-Robots-Tag','noindex, nofollow, noarchive');
  if(p==='/api/billing/catalog'){if(req.method!=='GET')throw error('不支持这个请求',405);send(200,await billing.catalog());return true;}
  if(!user?.id)throw error('请先进入自己的书房',401);
  const expected=req.headers?.['x-reader-owner'];
  if(expected&&expected!==user.id||req.method==='POST'&&expected!==user.id)throw error('账户已切换，请重新进入书房',409);
  if(req.method==='POST'&&publicOrigin&&req.headers?.origin!==publicOrigin)throw error('请求来源未授权',403);
  const ownerId=user.id;
  if(p==='/api/billing/account'&&req.method==='GET'){send(200,await billing.account({ownerId}));return true;}
  if(p==='/api/billing/subscriptions'&&req.method==='GET'){send(200,await billing.subscriptions({ownerId}));return true;}
  if(p==='/api/billing/portal'&&req.method==='POST'){
   exact(body,['subscriptionId']);send(200,await billing.portal({ownerId,subscriptionId:body.subscriptionId}));return true;
  }
  if(p==='/api/billing/trial'&&req.method==='POST'){
   exact(body,[]);if(!(verifyEmail?await verifyEmail({req,user}):user.emailVerified===true))throw error('请先验证邮箱后领取试用额度',403);
   send(200,await billing.trial({ownerId,verified:true}));return true;
  }
  if(p==='/api/billing/entries'&&req.method==='GET'){send(200,await billing.entries({ownerId,...paging(url)}));return true;}
  if(p==='/api/billing/orders'&&req.method==='GET'){send(200,await billing.orders({ownerId,...paging(url)}));return true;}
  const order=p.match(/^\/api\/billing\/orders\/([a-zA-Z0-9_-]{1,128})$/);
  if(order&&req.method==='GET'){if([...url.searchParams.keys()].some(k=>k!=='reconcile'))throw error('订单查询参数无效');send(200,await billing.order({ownerId,orderId:order[1],reconcile:url.searchParams.get('reconcile')==='1'}));return true;}
  if(p==='/api/billing/checkouts'&&req.method==='POST'){
   exact(body,['productKey','intentKey']);send(201,await billing.checkout({ownerId,productKey:body.productKey,intentKey:body.intentKey}));return true;
  }
  if(p==='/api/billing/quotes'&&req.method==='POST'){
   exact(body,['action','bookId','input']);if(!gate)throw error('收费功能暂未准备好',503);
   const quote=await gate.quote(user,body);
   // An explicit, authorized AI request also claims the account's once-only
   // verified trial. Reading/account GETs remain free of financial mutations.
   const account=await billing.account({ownerId});
   if(account.trialGranted===false&&(verifyEmail?await verifyEmail({req,user}):user.emailVerified===true)){
    try{await billing.trial({ownerId,verified:true});}
    catch(error){if(error.code!=='trial_budget_exhausted')throw error;}
   }
   send(201,quote);return true;
  }
  if(p==='/api/admin/billing/summary'&&req.method==='GET'){
   if([...url.searchParams.keys()].some(k=>!['from','to'].includes(k)))throw error('统计范围无效');
   const from=url.searchParams.get('from')||new Date(Date.now()-30*86400000).toISOString(),to=url.searchParams.get('to')||new Date().toISOString();
   if(!Number.isFinite(Date.parse(from))||!Number.isFinite(Date.parse(to))||Date.parse(to)<=Date.parse(from)||Date.parse(to)-Date.parse(from)>366*86400000)throw error('统计范围无效');
   send(200,await billing.summary({ownerId,from,to}));return true;
  }
  const known=['/api/billing/account','/api/billing/subscriptions','/api/billing/portal','/api/billing/trial','/api/billing/entries','/api/billing/orders','/api/billing/checkouts','/api/billing/quotes','/api/admin/billing/summary'].includes(p)||order;
  if(known)throw error('不支持这个请求',405);
  return false;
 }
 return {handle,webhook};
}


// Safe retry hint: no account, source text, allocation or fencing permission.
export function billingErrorDetails(error){
 const op=error?.billingOperation;return op&&/^credit-[a-f0-9]{64}$/.test(op.id)&&['released','cancelled','reversed','not_started'].includes(op.status)?{billingOperation:{id:op.id,status:op.status}}:{};
}
