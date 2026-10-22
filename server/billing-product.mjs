import {billingError} from './billing-memory-store.mjs';
import {billingPlan} from './billing-plans.mjs';

// Validate before checkout: a fulfillment mismatch would be too late to
// prevent a customer from buying a different price or billing period.
export function validateBillingProduct(product,{productId,mode,productKey='reading_monthly_100'}){
 const plan=billingPlan(productKey);
 const supplierMode=product?.mode==='prod'?'live':product?.mode==='sandbox'?'test':product?.mode;
 const metered=product?.usage_prices!=null&&(!Array.isArray(product.usage_prices)||product.usage_prices.length>0);
 if(!plan||!product||product.id!==productId||supplierMode!==mode||product.price!==plan.amount||product.currency!=='USD'||product.billing_type!=='recurring'||product.status!=='active'||product.tax_mode!=='exclusive'||metered||product.pay_what_you_want===true||(product.billing_period!==plan.billingPeriod||product.trial_period_days!=null&&product.trial_period_days!==0||product.recurring_interval!==undefined&&product.recurring_interval!==plan.interval||product.recurring_interval_count!==undefined&&product.recurring_interval_count!==1))throw billingError('billing_product_unverified',503);
 return true;
}
