// Small first-paint labels; spending and consent load only on an explicit request.
export function creditActionLabel(action,locale='en'){
 const points=({translation:1,conversation:4,annotation:4})[action];if(!points)return '';
 return locale==='zh-Hans'?`${points} 点`:locale==='zh-Hant'?`${points} 點`:locale==='ja'?`${points} ポイント`:`${points} ${points===1?'point':'points'}`;
}
export function creditErrorId(error){
 return error?.code==='BILLING_CONSENT_CANCELLED'?'billing.cancelled':error?.status===402?'credit.funds':null;
}
