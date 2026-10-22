// Sale terms are separate from saved order facts. Retired orders keep their own
// price, point grant and provider product even when sale configuration changes.
const U=1_000_000;
export const BILLING_PLANS=Object.freeze([
 Object.freeze({key:'reading_monthly_100',amount:500,currency:'USD',units:100*U,points:100,taxMode:'exclusive',billingType:'recurring',billingPeriod:'every-month',interval:'month',schemaVersion:2,variable:'CREEM_PRODUCT_READING_MONTHLY_100'}),
 Object.freeze({key:'reading_yearly_1200',amount:5000,currency:'USD',units:1200*U,points:1200,taxMode:'exclusive',billingType:'recurring',billingPeriod:'every-year',interval:'year',schemaVersion:3,variable:'CREEM_PRODUCT_READING_YEARLY_1200'}),
]);
export const billingPlan=key=>BILLING_PLANS.find(plan=>plan.key===key);
export const billingPeriodFor=order=>order.billingPeriod||(order.productKey==='reading_monthly_100'?'every-month':undefined);
export function billingPeriodMatches(start,end,period){
 const days=(Date.parse(end)-Date.parse(start))/86_400_000;
 return period==='every-month'?days>=28&&days<=31:period==='every-year'?days>=365&&days<=366:false;
}
