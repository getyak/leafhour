// A quote is usable on [checkedAt, validUntil); creation never leases a stale
// reference for the rest of a run. Test clocks are explicit, never global dates.
export function assertPricingWindow(pricing,now=Date.now(),{minimumRemainingMs=0,maximumValidityMs=Infinity}={}){
 const checked=Date.parse(pricing?.checkedAt),until=Date.parse(pricing?.validUntil);
 if(!Number.isFinite(now)||!Number.isFinite(checked)||!Number.isFinite(until)||checked>now||until<=checked||now>=until||until-checked>maximumValidityMs||until-now<minimumRemainingMs)throw Object.assign(Error('Pricing reference expired or unavailable'),{code:'PRICING_REFERENCE_UNAVAILABLE'});
 return pricing;
}
