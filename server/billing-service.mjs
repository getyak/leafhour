import {BILLING_PLANS,billingPlan} from './billing-plans.mjs';
import {randomUUID,createHash} from 'node:crypto';
import {billingError} from './billing-memory-store.mjs';
import {normalizeCreemEvent,safeCreemCheckoutUrl,safeCreemPortalUrl} from './creem.mjs';
import {validateBillingProduct} from './billing-product.mjs';
import {createBillingSubscriptions} from './billing-subscriptions.mjs';

export const CREDIT_UNITS=1_000_000;
const PRICE_VERSION='2026-10-21-v1';
const PRICES={translation:CREDIT_UNITS,conversation:4*CREDIT_UNITS,annotation:4*CREDIT_UNITS};
const fail=(code,status=400)=>{throw billingError(code,status);};
const identifier=value=>{if(typeof value!=='string'||!value||value.length>200)fail('invalid_input');return value;};
const supplierId=value=>typeof value==='string'?value:value?.id;
const supplierMode=value=>value==='sandbox'?'test':value==='prod'?'live':value;
const safeScope=scope=>{
  if(!scope||typeof scope!=='object'||Array.isArray(scope))fail('invalid_scope');
  const clean={};
  for(const key of ['bookId','contentVersion','sourceVersion','passageId','requestId','requestHash','inputHash','contextPolicy'])if(scope[key]!==undefined)clean[key]=identifier(scope[key]);
  if(!clean.bookId||!(clean.sourceVersion||clean.contentVersion)||!(clean.requestHash||clean.inputHash))fail('invalid_scope');
  if(scope.costLimitMicrousd!==undefined){if(!Number.isSafeInteger(scope.costLimitMicrousd)||scope.costLimitMicrousd<=0)fail('invalid_scope');clean.costLimitMicrousd=scope.costLimitMicrousd;}
  return clean;
};
const hashScope=scope=>createHash('sha256').update(JSON.stringify(Object.fromEntries(Object.entries(scope).sort(([a],[b])=>a.localeCompare(b))))).digest('hex');
const validReceipt=(receipt,op)=>{
  if(!receipt||receipt.ownerId!==op.ownerId||receipt.bookId!==op.scope.bookId||receipt.contentVersion!==op.scope.contentVersion||receipt.sourceVersion!==op.scope.sourceVersion||receipt.passageId!==op.scope.passageId||receipt.operationId!==undefined&&receipt.operationId!==op.id)fail('invalid_receipt');
  const clean={};for(const key of ['ownerId','bookId','contentVersion','sourceVersion','passageId','resultId','kind','operationId'])if(receipt[key]!==undefined)clean[key]=identifier(receipt[key]);if(!clean.resultId)fail('invalid_receipt');return clean;
};

export function createBillingService({store,creem,enabled=false,mode='test',publicOrigin='http://localhost:3000',adminIds=[],clock=Date.now,trialBudgetUnits=mode==='live'?0:10_000*CREDIT_UNITS}={}){
  if(!['test','live'].includes(mode))fail('invalid_mode');
  if(enabled&&mode==='live'&&(!store?.durable||store.kind==='reference'))fail('durable_store_required',503);
  if(!Number.isSafeInteger(trialBudgetUnits)||trialBudgetUnits<0)fail('invalid_trial_budget');
  let origin;try{origin=new URL(publicOrigin).origin;}catch{fail('invalid_origin');}
  const now=()=>new Date(clock()).toISOString(),inflight=new Map(),checkouts=new Map();
  const productId=key=>creem?.productIds?.[key]||(key==='reading_monthly_100'?creem?.productId:undefined);
  const available=(key='reading_monthly_100')=>Boolean(enabled&&store?.command&&creem?.ready&&creem.mode===mode&&productId(key));
  const requireEnabled=()=>{if(!enabled)fail('billing_disabled',503);if(!store?.command)fail('billing_store_unavailable',503);};
  const command=(action,p={})=>{requireEnabled();return store.command(action,{...p,mode});};
  const product=key=>{const {interval,schemaVersion,variable,...terms}=billingPlan(key);return terms;};
  const getOrder=({ownerId,orderId})=>command('getOrder',{ownerId:identifier(ownerId),orderId:identifier(orderId)});
  // Retired offers remain auditable, but old clients must not resume their payment links.
  const orderView=order=>{if(!order||billingPlan(order.productKey))return order;const {checkoutUrl,...details}=order;return details;};
  const productChecks=new Map(),productsVerifiedUntil=new Map();
  async function checkProduct(productKey,force=false){
    if(typeof creem?.retrieveProduct!=='function'){if(mode==='live')fail('billing_product_unverified',503);return;}
    if(!force&&productsVerifiedUntil.get(productKey)>clock())return;
    if(!productChecks.has(productKey))productChecks.set(productKey,(async()=>{validateBillingProduct(await creem.retrieveProduct({productId:productId(productKey)}),{productId:productId(productKey),productKey,mode});productsVerifiedUntil.set(productKey,clock()+300000);})());
    try{await productChecks.get(productKey);}catch(error){productsVerifiedUntil.delete(productKey);throw error;}finally{productChecks.delete(productKey);}
  }
  async function readiness({forceProduct=false,productKey='reading_monthly_100'}={}){
    if(!enabled)return {enabled:false,ready:false,mode,reason:'billing_disabled'};
    if(!billingPlan(productKey)||!available(productKey))return {enabled:true,ready:false,mode,reason:'billing_configuration_incomplete'};
    const status=await command('readiness');
    if(!(status.schemaVersion>=billingPlan(productKey).schemaVersion))return {...status,enabled:true,ready:false,mode,reason:'billing_schema_outdated'};
    await checkProduct(productKey,forceProduct);
    return {...status,enabled:true,mode,ready:Boolean(mode==='test'&&status.backend==='reference'||status.ready&&(mode!=='live'||status.durable&&status.backend==='postgres'))};
  }
  const subscriptionFulfillment=createBillingSubscriptions({command,creem,mode,now});
  async function fulfill(event,{recheck=true}={}){
    if(event.ignored)return {received:true,ignored:true};
    if(event.mode!==mode)fail('payment_environment_mismatch',409);
    if(event.type.startsWith('subscription.'))return subscriptionFulfillment.event(event);
    let local,subscription;
    if(event.subscriptionId&&event.type!=='checkout.completed'){
      subscription=await command('lookupSubscription',{subscriptionId:event.subscriptionId});
      if(!subscription)fail('payment_binding_pending',503);
      if(event.ownerId&&event.ownerId!==subscription.ownerId||event.customerId&&event.customerId!==subscription.customerId||event.orderId&&event.orderId!==subscription.initialOrderId)fail('payment_binding_mismatch',409);
    }else if(event.orderId&&event.ownerId)local=await getOrder({ownerId:event.ownerId,orderId:event.orderId});
    if(!local&&event.providerOrderId)local=await command('lookupOrder',{providerOrderId:event.providerOrderId});
    if(!local&&event.checkoutId&&!event.subscriptionId)local=await command('lookupOrder',{checkoutId:event.checkoutId});
    if(!local)fail('payment_binding_pending',503);
    if(event.ownerId&&event.ownerId!==local.ownerId||!subscription&&event.orderId&&event.orderId!==local.id||event.checkoutId&&local.checkoutId&&event.checkoutId!==local.checkoutId||event.providerOrderId&&local.providerOrderId&&event.providerOrderId!==local.providerOrderId||event.subscriptionId&&local.subscriptionId&&event.subscriptionId!==local.subscriptionId||subscription&&local.ownerId!==subscription.ownerId)fail('payment_binding_mismatch',409);
    if(event.productId&&event.productId!==local.productId)fail('payment_mismatch',409);
    const common={ownerId:local.ownerId,orderId:local.id,eventId:identifier(event.id),eventHash:identifier(event.eventHash),now:now()};
    if(event.type==='checkout.completed'){
      if(recheck&&creem.retrieveCheckout){
        const checkout=await creem.retrieveCheckout({checkoutId:event.checkoutId});
        if(checkout?.id!==event.checkoutId)fail('payment_binding_mismatch',409);
        const latest=normalizeCreemEvent({id:event.id,eventType:event.type,object:checkout});
        return fulfill({...latest,eventHash:event.eventHash},{recheck:false});
      }
      if(billingPlan(local.productKey))return subscriptionFulfillment.checkout(event,local);
      if(event.status!=='completed'||!['paid','refunded','partially_refunded','chargeback','disputed'].includes(event.orderStatus)||event.quantity!==1||event.billingType&&event.billingType!=='one-time')fail('payment_not_completed',409);
      // Historical purchases are bound to their saved product, not current sale configuration.
      if(local.productKey!=='reading_100'||event.productId!==local.productId||event.amount!==local.amount||event.currency!==local.currency)fail('payment_mismatch',409);
      const approvedReview=event.discountAmount===local.amount&&event.paidAmount===0&&event.taxAmount===0&&creem.reviewDiscountIds?.includes(event.discountId);
      if(!Number.isSafeInteger(event.paidAmount)||!Number.isSafeInteger(event.taxAmount)||!Number.isSafeInteger(event.discountAmount)||event.discountAmount!==0&&!approvedReview||event.paidAmount!==event.amount-event.discountAmount+event.taxAmount)fail('payment_amount_unverified',409);
      if(!local.checkoutId){
        if(event.orderId!==local.id||event.ownerId!==local.ownerId)fail('payment_binding_pending',503);
        await command('checkout',{ownerId:local.ownerId,orderId:local.id,checkoutId:event.checkoutId,now:now()});
      }
      if(['refunded','partially_refunded'].includes(event.orderStatus)){
        if(!Number.isSafeInteger(event.cumulativeRefundAmount)||event.cumulativeRefundAmount<=0)fail('refund_amount_unverified',503);
        await command('refund',{...common,eventId:'reconciled-refund:'+event.id+':'+event.cumulativeRefundAmount,refundId:'reconciled:'+event.providerOrderId+':'+event.cumulativeRefundAmount,refundAmount:event.cumulativeRefundAmount,cumulativeRefundAmount:event.cumulativeRefundAmount,paidAmount:event.paidAmount});
      }
      if(['chargeback','disputed'].includes(event.orderStatus))await command('dispute',{...common,eventId:'reconciled-dispute:'+event.id});
      // A stale paid event must not undo a persisted refund/dispute tombstone.
      return command('payment',{...common,checkoutId:event.checkoutId,providerOrderId:event.providerOrderId,productId:event.productId,amount:event.amount,currency:event.currency,paidAmount:event.paidAmount,taxAmount:event.taxAmount,discountAmount:event.discountAmount,units:local.units});
    }
    if(event.type==='refund.created'){
      if(event.refundStatus!=='succeeded')return {received:true,ignored:true};
      if(event.currency!==local.currency||!Number.isSafeInteger(event.paidAmount)||!Number.isSafeInteger(event.cumulativeRefundAmount)||!Number.isSafeInteger(event.refundAmount))fail('refund_amount_unverified',409);
      return command('refund',{...common,refundId:event.refundId,refundAmount:event.refundAmount,cumulativeRefundAmount:event.cumulativeRefundAmount,paidAmount:event.paidAmount});
    }
    return command('dispute',common);
  }
  const service={
    enabled,mode,readiness,
    async catalog(){const products=await Promise.all(BILLING_PLANS.map(async ({key})=>{let ready=false;try{ready=(await readiness({productKey:key})).ready;}catch{}return {...product(key),available:available(key)&&ready};}));return {enabled,mode,available:products.some(p=>p.available),products,prices:{...PRICES},unitsPerPoint:CREDIT_UNITS,priceVersion:PRICE_VERSION,trialUnits:10*CREDIT_UNITS};},
    account:({ownerId})=>command('account',{ownerId:identifier(ownerId)}),
    trial:({ownerId,verified=false})=>{if(!verified)fail('verified_account_required',403);return command('trial',{ownerId:identifier(ownerId),grantId:'trial:'+ownerId,units:10*CREDIT_UNITS,campaignBudgetUnits:trialBudgetUnits,now:now()});},
    entries:({ownerId,limit,cursor})=>command('entries',{ownerId:identifier(ownerId),limit,cursor}),
    async orders({ownerId,limit,cursor}){const result=await command('orders',{ownerId:identifier(ownerId),limit,cursor});return {...result,orders:result.orders.map(orderView)};},
    async subscriptions({ownerId}){const result=await command('subscriptions',{ownerId:identifier(ownerId)});return {subscriptions:result.subscriptions.map(row=>({id:row.subscriptionId,subscriptionId:row.subscriptionId,status:row.status,productKey:row.productKey,currentPeriodStart:row.currentPeriodStart,currentPeriodEnd:row.currentPeriodEnd}))};},
    async portal({ownerId,subscriptionId}){identifier(ownerId);identifier(subscriptionId);const subscription=await command('lookupSubscription',{subscriptionId});if(!subscription||subscription.ownerId!==ownerId)fail('not_found',404);if(!creem?.ready||creem.mode!==mode||typeof creem.createPortal!=='function')fail('creem_unavailable',503);const response=await creem.createPortal({customerId:subscription.customerId});return {portalUrl:safeCreemPortalUrl(response.portalUrl)};},
    async checkout({ownerId,productKey='reading_monthly_100',intentKey}){
      identifier(ownerId);identifier(intentKey);if(!billingPlan(productKey))fail('unknown_product');if(!available(productKey)||!(await readiness({forceProduct:true,productKey})).ready)fail('creem_unavailable',503);
      const key=JSON.stringify([ownerId,intentKey,productKey]);if(checkouts.has(key))return checkouts.get(key);
      const task=(async()=>{
        if((await command('account',{ownerId})).frozen)fail('frozen_account',403);
        const order=await command('order',{ownerId,id:randomUUID(),intentKey,productKey,productId:productId(productKey),amount:billingPlan(productKey).amount,currency:billingPlan(productKey).currency,units:billingPlan(productKey).units,billingPeriod:billingPlan(productKey).billingPeriod,now:now()});
        if(order.status==='expired')fail('checkout_expired',409);
        if(order.checkoutId){if(!order.checkoutUrl)fail('checkout_reconciliation_required',503);return {checkoutUrl:safeCreemCheckoutUrl(order.checkoutUrl),order};}
        // Mark an intent before the external request. A timeout stays unknown and is
        // reconciled; a later process must never blindly create a second checkout.
        const claim=await command('checkoutAttempt',{ownerId,orderId:order.id,now:now()});
        if(!claim.claimed)fail('checkout_reconciliation_required',503);
        const response=await creem.createCheckout({orderId:order.id,ownerId,productId:productId(productKey),successUrl:origin+'/pricing?order='+encodeURIComponent(order.id)});
        const saved=await command('checkout',{ownerId,orderId:order.id,checkoutId:response.id,checkoutUrl:safeCreemCheckoutUrl(response.checkoutUrl),now:now()});
        return {checkoutUrl:saved.checkoutUrl,order:saved};
      })();checkouts.set(key,task);try{return await task;}finally{checkouts.delete(key);}
    },
    async order({ownerId,orderId,reconcile=false}){
      const order=await getOrder({ownerId,orderId});if(!order||!reconcile||!order.checkoutId||!creem?.retrieveCheckout)return orderView(order);
      const checkout=await creem.retrieveCheckout({checkoutId:order.checkoutId});
      if(checkout?.id!==order.checkoutId)fail('payment_binding_mismatch',409);
      if(checkout.status==='expired'){
        if(supplierMode(checkout.mode)!==mode||checkout.product?.mode&&supplierMode(checkout.product.mode)!==mode)fail('payment_environment_mismatch',409);
        if(supplierId(checkout.product)!==order.productId||checkout.request_id!==order.id||checkout.metadata?.ownerId!==undefined&&checkout.metadata.ownerId!==order.ownerId||checkout.metadata?.orderId!==undefined&&checkout.metadata.orderId!==order.id)fail('payment_binding_mismatch',409);
        const financialOrder=checkout.order;
        if(order.paymentVerified||order.subscriptionId||!['pending','expired'].includes(order.status)||checkout.subscription!=null||checkout.transaction!=null||financialOrder!=null&&(typeof financialOrder!=='object'||!['pending','unpaid','canceled','cancelled','void','expired'].includes(financialOrder.status)||financialOrder.amount_paid!=null&&financialOrder.amount_paid!==0||financialOrder.transaction!=null))fail('checkout_expiry_unverified',409);
        return orderView(await command('expireCheckout',{ownerId:order.ownerId,orderId:order.id,checkoutId:order.checkoutId,now:now()}));
      }
      if(checkout.status==='completed'){
        const {id:ignoredId,...snapshot}=normalizeCreemEvent({id:'reconciliation',eventType:'checkout.completed',object:checkout});
        const eventHash=createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
        // A retrieved snapshot can evolve from paid to refunded. Its identity
        // includes those immutable snapshot facts; signed webhook IDs retain
        // their original raw-byte identity and conflict detection.
        await fulfill({...snapshot,id:'reconcile:'+order.checkoutId+':'+eventHash,eventHash},{recheck:false});
      }
      return orderView(await getOrder({ownerId,orderId}));
    },
    async quote({ownerId,action,scope}){
      identifier(ownerId);if(!Object.hasOwn(PRICES,action))fail('unsupported_billing_action');const clean=safeScope(scope),time=clock();
      return command('quote',{ownerId,id:randomUUID(),action,units:PRICES[action],scopeHash:hashScope(clean),scope:clean,priceVersion:PRICE_VERSION,expiresAt:new Date(time+600000).toISOString(),now:new Date(time).toISOString()});
    },
    async run({ownerId,quoteId,operationId=randomUUID(),idempotencyKey,scope,execute,signal}){
      identifier(ownerId);identifier(quoteId);identifier(idempotencyKey);const clean=safeScope(scope);
      const op=await command('reserve',{ownerId,quoteId,operationId,idempotencyKey,scopeHash:hashScope(clean),now:now()});
      if(['settled','reversed','released','cancelled'].includes(op.status))return op;
      if(op.status==='result_saved')return command('settle',{ownerId,operationId:op.id,reservationToken:op.reservationToken,now:now()});
      if(inflight.has(op.id))return inflight.get(op.id);
      if(op.status==='running')return op; // A lost worker is recovered without redispatch.
      const task=(async()=>{
        let saved=false,completionKnown=false;
        try{
          if(signal?.aborted)fail('cancelled',409);
          const running=await command('running',{ownerId,operationId:op.id,reservationToken:op.reservationToken,now:now()});
          if(running.executionClaimed===false)return running;
          if(typeof execute!=='function')fail('missing_executor');
          const result=await execute({operationId:op.id,reservationToken:op.reservationToken,scope:clean});
          if(signal?.aborted)fail('cancelled',409);
          if(result?.status&&['failed','cancelled','error'].includes(result.status)||!result?.receipt)fail('result_not_delivered',409);
          const receipt=validReceipt(result.receipt,op);completionKnown=true;
          await command('result',{ownerId,operationId:op.id,reservationToken:op.reservationToken,receipt,now:now()});saved=true;
          return await command('settle',{ownerId,operationId:op.id,reservationToken:op.reservationToken,now:now()});
        }catch(error){
          // A durable receipt is the recovery boundary: never release a result
          // merely because the settlement transaction is temporarily unavailable.
          if(!saved&&!completionKnown)await command('release',{ownerId,operationId:op.id,reservationToken:op.reservationToken,reason:error.code==='cancelled'?'cancelled':'failed',now:now()}).catch(()=>{});
          throw error;
        }
      })();inflight.set(op.id,task);try{return await task;}finally{inflight.delete(op.id);}
    },
    operation:({ownerId,operationId,consistent=false})=>command('operation',{ownerId:identifier(ownerId),operationId:identifier(operationId),...(consistent?{consistent:true}:{})}),
    async complete({ownerId,operationId,receipt}){
      const op=await service.operation({ownerId,operationId});if(!op)fail('not_found',404);
      if(['settled','reversed','released','cancelled'].includes(op.status))return op;
      await command('result',{ownerId,operationId,reservationToken:op.reservationToken,receipt:validReceipt(receipt,op),now:now()});
      return command('settle',{ownerId,operationId,reservationToken:op.reservationToken,now:now()});
    },
    ackPublished:({ownerId,operationId})=>command('ackPublished',{ownerId:identifier(ownerId),operationId:identifier(operationId),now:now()}),
    async cancel({ownerId,operationId,expectedStatus}){const op=await service.operation({ownerId,operationId});if(!op)fail('not_found',404);return command('release',{ownerId,operationId,reservationToken:op.reservationToken,reason:'cancelled',expectedStatus,now:now()});},
    reverse:({ownerId,operationId,reason='undeliverable'})=>command('reverse',{ownerId:identifier(ownerId),operationId:identifier(operationId),reason,now:now()}),
    recover:({ownerId})=>command('recover',{ownerId:identifier(ownerId),now:now()}),
    async webhook({rawBody,signature}){requireEnabled();if(!creem?.verifyWebhook)fail('creem_unavailable',503);const event=creem.verifyWebhook({rawBody,signature});const order=await fulfill(event);return {received:true,...(order?.id?{orderId:order.id,status:order.status}:{ignored:true})};},
    summary({ownerId,from,to}){if(!adminIds.includes(ownerId))fail('admin_required',403);return command('summary',{from,to});},
    recordProviderCall:facts=>command('providerCall',facts),
  };
  return service;
}
