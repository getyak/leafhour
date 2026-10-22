import {billingError} from './billing-memory-store.mjs';

// Validate before checkout: a fulfillment mismatch would be too late to
// prevent a customer from buying a different price or billing period.
export function validateBillingProduct(product,{productId,mode,productKey='reading_monthly_100'}){
 const supplierMode=product?.mode==='prod'?'live':product?.mode==='sandbox'?'test':product?.mode;
 const metered=product?.usage_prices!=null&&(!Array.isArray(product.usage_prices)||product.usage_prices.length>0);
 if(productKey!=='reading_monthly_100'||!product||product.id!==productId||supplierMode!==mode||product.price!==500||product.currency!=='USD'||product.billing_type!=='recurring'||product.status!=='active'||product.tax_mode!=='exclusive'||metered||product.pay_what_you_want===true||(product.billing_period!=='every-month'||product.trial_period_days!=null&&product.trial_period_days!==0||product.recurring_interval!==undefined&&product.recurring_interval!=='month'||product.recurring_interval_count!==undefined&&product.recurring_interval_count!==1))throw billingError('billing_product_unverified',503);
 return true;
}
