import {createHmac,createHash,timingSafeEqual} from 'node:crypto';

const error=(code,status=400)=>Object.assign(new Error(code),{code,status});
const invalid=(code,status=400)=>{throw error(code,status);};
const id=value=>typeof value==='string'?value:value?.id;
const integer=value=>Number.isSafeInteger(value)&&value>=0?value:undefined;
const modes=value=>value==='sandbox'?'test':value==='prod'?'live':value;

export function safeCreemCheckoutUrl(value){
  let url;try{url=new URL(value);}catch{invalid('unsafe_checkout_url',502);}
  if(url.protocol!=='https:'||url.username||url.password||url.port||!['checkout.creem.io','test-checkout.creem.io','www.creem.io','creem.io'].includes(url.hostname))invalid('unsafe_checkout_url',502);
  if(['www.creem.io','creem.io'].includes(url.hostname)&&!/^\/(?:payment\/|(?:test\/)?checkout\/)/.test(url.pathname))invalid('unsafe_checkout_url',502);
  return url.href;
}

export function safeCreemPortalUrl(value){
  let url;try{url=new URL(value);}catch{invalid('unsafe_portal_url',502);}
  if(url.protocol!=='https:'||url.username||url.password||url.port||!['creem.io','www.creem.io'].includes(url.hostname)||!url.pathname.startsWith('/my-orders/'))invalid('unsafe_portal_url',502);
  return url.href;
}

export function verifyCreemSignature(rawBody,signature,secret){
  if(!(Buffer.isBuffer(rawBody)||rawBody instanceof Uint8Array)||rawBody.byteLength>262144||rawBody.byteLength===0)invalid('invalid_webhook');
  if(typeof secret!=='string'||!secret)invalid('creem_unavailable',503);
  if(typeof signature!=='string'||!/^\w{64}$/.test(signature)||!/^[a-f0-9]{64}$/i.test(signature))invalid('invalid_signature',403);
  const expected=createHmac('sha256',secret).update(rawBody).digest(),provided=Buffer.from(signature,'hex');
  if(provided.length!==expected.length||!timingSafeEqual(expected,provided))invalid('invalid_signature',403);
  return true;
}

// Normalize only finance references; never retain the complete supplier/customer payload.
// Amounts remain undefined when the supplier did not report them: fulfillment fails closed.
export function normalizeCreemEvent(payload){
  if(!payload||typeof payload!=='object'||typeof payload.id!=='string'||typeof payload.eventType!=='string')invalid('invalid_webhook');
  const object=payload.object||{},type=payload.eventType;
  const subscriptionEvent=['subscription.active','subscription.paid','subscription.canceled','subscription.scheduled_cancel','subscription.past_due','subscription.unpaid','subscription.expired','subscription.update','subscription.trialing','subscription.paused'].includes(type);
  if(!subscriptionEvent&&!['checkout.completed','refund.created','dispute.created'].includes(type))return {id:payload.id,type,ignored:true};
  if(subscriptionEvent)return {id:payload.id,type,mode:modes(object.mode),subscriptionId:id(object),customerId:id(object.customer),productId:id(object.product),transactionId:object.last_transaction_id||id(object.last_transaction),status:object.status,ownerId:object.metadata?.ownerId,orderId:object.metadata?.orderId,currentPeriodStart:object.current_period_start_date,currentPeriodEnd:object.current_period_end_date,supplierUpdatedAt:object.updated_at};
  const checkout=type==='checkout.completed'?object:object.checkout||{},order=object.order&&typeof object.order==='object'?object.order:checkout.order||{},transaction=object.transaction||{};
  const metadata=checkout.metadata||object.metadata||{},product=checkout.product||order.product||{};
  const amount=integer(typeof product==='object'?product.price:undefined)??integer(order.sub_total)??integer(order.amount),taxAmount=integer(order.tax_amount??transaction.tax_amount),discountAmount=integer(order.discount_amount??checkout.discount_amount);
  return {
    id:payload.id,type,mode:modes(object.mode??checkout.mode??order.mode??transaction.mode),orderId:checkout.request_id||metadata.orderId,
    ownerId:metadata.ownerId,checkoutId:id(checkout),providerOrderId:id(order)||id(transaction.order)||id(object.order),productId:id(product),
    subscriptionId:id(object.subscription)||id(transaction.subscription),customerId:id(object.customer)||id(order.customer)||id(transaction.customer),transactionId:id(order.transaction)||id(object.transaction),
    status:checkout.status||object.status,orderStatus:order.status,quantity:checkout.units??1,billingType:typeof product==='object'?(product.billing_type==='onetime'?'one-time':product.billing_type):undefined,
    amount,currency:order.currency||transaction.currency||object.refund_currency,paidAmount:integer(order.amount_paid??transaction.amount_paid),taxAmount,
    discountAmount:discountAmount??(integer(order.sub_total)!==undefined&&amount!==undefined?amount-order.sub_total:undefined),discountId:id(order.discount||checkout.discount),
    refundId:type==='refund.created'?id(object):undefined,refundAmount:integer(object.refund_amount),cumulativeRefundAmount:integer(transaction.refunded_amount??order.refunded_amount),refundStatus:object.status,
  };
}

export function createCreemClient({env={},fetcher=globalThis.fetch}={}){
  const mode=env.CREEM_MODE||'test',apiKey=env.CREEM_API_KEY,secret=env.CREEM_WEBHOOK_SECRET,productId=env.CREEM_PRODUCT_READING_MONTHLY_100,productIds={reading_monthly_100:productId,reading_yearly_1200:env.CREEM_PRODUCT_READING_YEARLY_1200};
  // Authenticated payment retrieval must outlive products removed from new sales.
  const validMode=['test','live'].includes(mode),ready=Boolean(validMode&&apiKey&&secret),base=mode==='live'?'https://api.creem.io':'https://test-api.creem.io';
  async function request(path,{body}={}){
    if(!ready)invalid('creem_unavailable',503);
    let response;try{response=await fetcher(base+path,{method:body?'POST':'GET',headers:{'x-api-key':apiKey,...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(15000)});}catch{invalid('creem_request_unknown',503);}
    if(!response.ok)invalid('creem_unavailable',503);
    try{return await response.json();}catch{invalid('invalid_creem_response',503);}
  }
  return {
    ready,mode,productId,productIds,reviewDiscountIds:String(env.CREEM_REVIEW_DISCOUNT_IDS||'').split(',').map(x=>x.trim()).filter(x=>/^dis_[a-zA-Z0-9_-]+$/.test(x)),
    async retrieveProduct({productId:requestedProduct=productId}={}){if(typeof requestedProduct!=='string'||!/^prod_[a-zA-Z0-9_-]+$/.test(requestedProduct))invalid('invalid_input');if(!Object.values(productIds).includes(requestedProduct))invalid('unknown_product');return request('/v1/products/'+encodeURIComponent(requestedProduct));},
    async createCheckout({orderId,ownerId,productId:requestedProduct,successUrl}){
      if(!requestedProduct||!Object.values(productIds).includes(requestedProduct))invalid('unknown_product');
      const response=await request('/v1/checkouts',{body:{product_id:requestedProduct,request_id:orderId,units:1,success_url:successUrl,metadata:{orderId,ownerId,mode}}});
      if(typeof response.id!=='string')invalid('invalid_creem_response',503);
      return {id:response.id,checkoutUrl:safeCreemCheckoutUrl(response.checkout_url)};
    },
    async retrieveCheckout({checkoutId}){if(typeof checkoutId!=='string'||!/^ch(?:k)?_[a-zA-Z0-9_-]+$/.test(checkoutId))invalid('invalid_input');return request('/v1/checkouts?checkout_id='+encodeURIComponent(checkoutId));},
    async retrieveSubscription({subscriptionId}){if(typeof subscriptionId!=='string'||!/^sub_[a-zA-Z0-9_-]+$/.test(subscriptionId))invalid('invalid_input');return request('/v1/subscriptions?subscription_id='+encodeURIComponent(subscriptionId));},
    async retrieveTransaction({transactionId}){if(typeof transactionId!=='string'||!/^(?:tran|txn|tx)_[a-zA-Z0-9_-]+$/.test(transactionId))invalid('invalid_input');return request('/v1/transactions?transaction_id='+encodeURIComponent(transactionId));},
    async createPortal({customerId}){if(typeof customerId!=='string'||!/^cust_[a-zA-Z0-9_-]+$/.test(customerId))invalid('invalid_input');const response=await request('/v1/customers/billing',{body:{customer_id:customerId}});return {portalUrl:safeCreemPortalUrl(response.customer_portal_link)};},
    verifyWebhook({rawBody,signature}){
      verifyCreemSignature(rawBody,signature,secret);
      let parsed;try{parsed=JSON.parse(Buffer.from(rawBody).toString('utf8'));}catch{invalid('invalid_webhook');}
      return {...normalizeCreemEvent(parsed),eventHash:createHash('sha256').update(rawBody).digest('hex')};
    },
  };
}
export const createCreem=createCreemClient;
