import {billingError} from './billing-memory-store.mjs';

const fail=(code,status=409)=>{throw billingError(code,status);};
const id=value=>typeof value==='string'?value:value?.id;
const modeOf=value=>value==='sandbox'?'test':value==='prod'?'live':value;
const identifier=value=>{if(typeof value!=='string'||!value||value.length>200)fail('payment_binding_mismatch');return value;};
const integer=value=>Number.isSafeInteger(value)&&value>=0;
const iso=value=>{const time=typeof value==='number'?value:typeof value==='string'?Date.parse(value):NaN;if(!Number.isFinite(time)||time<=0)fail('payment_period_unverified',503);return new Date(time).toISOString();};
const periods=(start,end)=>{const periodStart=iso(start),periodEnd=iso(end);if(periodEnd<=periodStart)fail('payment_period_unverified',503);return {periodStart,periodEnd};};
const statuses=new Set(['active','trialing','past_due','unpaid','paused','canceled','scheduled_cancel','expired']);

// Supplier snapshots determine lifecycle state. Financial identity always comes
// from the original signed event or the immutable initial checkout order.
export function createBillingSubscriptions({command,creem,mode,now,monthlyProductId,units}){
 async function snapshot(subscriptionId,local){
  if(typeof creem?.retrieveSubscription!=='function')fail('creem_unavailable',503);
  const subscription=await creem.retrieveSubscription({subscriptionId:identifier(subscriptionId)});
  if(subscription?.id!==subscriptionId||id(subscription.product)!==monthlyProductId())fail('payment_binding_mismatch');
  if(modeOf(subscription.mode)!==mode||subscription.product?.mode&&modeOf(subscription.product.mode)!==mode||subscription.customer?.mode&&modeOf(subscription.customer.mode)!==mode)fail('payment_environment_mismatch');
  const customerId=identifier(id(subscription.customer)),status=subscription.status==='cancelled'?'canceled':subscription.status;
  if(!statuses.has(status))fail('subscription_state_unverified',503);
  if(local&&(local.customerId&&customerId!==local.customerId||subscription.metadata?.ownerId&&subscription.metadata.ownerId!==local.ownerId||subscription.metadata?.orderId&&subscription.metadata.orderId!==(local.initialOrderId||local.id)))fail('payment_binding_mismatch');
  const {periodStart,periodEnd}=periods(subscription.current_period_start_date,subscription.current_period_end_date);
  return {subscriptionId,customerId,status,currentPeriodStart:periodStart,currentPeriodEnd:periodEnd,supplierUpdatedAt:iso(subscription.updated_at)};
 }
 async function paid(event,subscription,{initialOrderId,initialProviderOrderId}={}){
  if(typeof creem?.retrieveTransaction!=='function')fail('creem_unavailable',503);
  const transactionId=identifier(event.transactionId),transaction=await creem.retrieveTransaction({transactionId});
  if(transaction?.id!==transactionId||id(transaction.subscription)!==subscription.subscriptionId||id(transaction.customer)!==subscription.customerId)fail('payment_binding_mismatch');
  if(modeOf(transaction.mode)!==mode)fail('payment_environment_mismatch');
  const providerOrderId=identifier(id(transaction.order));
  if(initialProviderOrderId&&providerOrderId!==initialProviderOrderId)fail('payment_binding_mismatch');
  const refunded=['refunded','partialRefund','partially_refunded'].includes(transaction.status),disputed=['chargedBack','chargeback','disputed'].includes(transaction.status);
  if(transaction.type!=='invoice'||transaction.status!=='paid'&&!refunded&&!disputed)fail('payment_not_completed');
  if(transaction.amount!==500||transaction.currency!=='USD')fail('payment_mismatch');
  // Creem's documented ordinary paid invoice reports refunded_amount:null.
  // Only that explicit value with authoritative paid status means no refund;
  // an omitted field, or null on a refunded/disputed invoice, stays unverified.
  const refundedAmount=transaction.refunded_amount===null&&transaction.status==='paid'?0:transaction.refunded_amount;
  if(!integer(transaction.amount_paid)||!integer(transaction.tax_amount)||!integer(transaction.discount_amount)||transaction.discount_amount!==0||transaction.amount_paid!==500+transaction.tax_amount||!integer(refundedAmount)||refundedAmount>transaction.amount_paid||refunded&&refundedAmount<=0||transaction.status==='refunded'&&refundedAmount!==transaction.amount_paid)fail('payment_amount_unverified');
  const period=periods(transaction.period_start,transaction.period_end);
  // The current subscription period can already be newer than this paid event.
  // Compare transaction periods only against this cycle's persisted identity.
  return command('subscriptionPaid',{ownerId:subscription.ownerId,subscriptionId:subscription.subscriptionId,customerId:subscription.customerId,transactionId,providerOrderId,...(initialOrderId?{orderId:initialOrderId}:providerOrderId===subscription.initialProviderOrderId?{orderId:subscription.initialOrderId}:{}),...period,amount:500,paidAmount:transaction.amount_paid,taxAmount:transaction.tax_amount,discountAmount:transaction.discount_amount,currency:'USD',units,cumulativeRefundAmount:refundedAmount,disputed,eventId:identifier(event.id),eventHash:identifier(event.eventHash),now:now()});
 }
 return {
  async checkout(event,local){
   if(event.status!=='completed'||event.quantity!==1||event.billingType&&event.billingType!=='recurring')fail('payment_not_completed');
   if(event.productId!==local.productId||local.productId!==monthlyProductId()||event.amount!==local.amount||event.currency!==local.currency)fail('payment_mismatch');
   identifier(event.providerOrderId);const facts=await snapshot(event.subscriptionId,local);
   if(event.customerId&&event.customerId!==facts.customerId)fail('payment_binding_mismatch');
   if(!local.checkoutId){if(event.orderId!==local.id||event.ownerId!==local.ownerId)fail('payment_binding_pending',503);await command('checkout',{ownerId:local.ownerId,orderId:local.id,checkoutId:event.checkoutId,now:now()});}
   const subscription=await command('bindSubscription',{...facts,ownerId:local.ownerId,orderId:local.id,providerOrderId:event.providerOrderId,productId:local.productId,productKey:'reading_monthly_100',now:now()});
   // Some checkout notifications do not include a transaction. Binding is safe;
   // the separately signed subscription.paid event supplies the grant authority.
   if(!event.transactionId)return command('getOrder',{ownerId:local.ownerId,orderId:local.id});
   return paid(event,subscription,{initialOrderId:local.id,initialProviderOrderId:event.providerOrderId});
  },
  async event(event){
   const subscriptionId=identifier(event.subscriptionId),subscription=await command('lookupSubscription',{subscriptionId});
   if(!subscription)fail('payment_binding_pending',503);
   if(event.customerId&&event.customerId!==subscription.customerId||event.productId&&event.productId!==subscription.productId||event.ownerId&&event.ownerId!==subscription.ownerId||event.orderId&&event.orderId!==subscription.initialOrderId)fail('payment_binding_mismatch');
   const facts=await snapshot(subscriptionId,subscription);
   await command('subscriptionState',{...facts,ownerId:subscription.ownerId,now:now()});
   return event.type==='subscription.paid'?paid(event,subscription):null;
  },
 };
}
