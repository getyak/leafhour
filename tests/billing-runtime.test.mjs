import test from 'node:test';
import assert from 'node:assert/strict';
import {createBillingRuntime} from '../server/billing-runtime.mjs';
test('disabled billing leaves self-hosted reading independent of payment credentials',async()=>{
 const b=await createBillingRuntime({env:{}});assert.equal(b.enabled,false);assert.equal((await b.catalog()).available,false);assert.deepEqual((await b.catalog()).products.map(p=>p.key),['reading_monthly_100','reading_yearly_1200']);
});
test('enabled live billing without durable configuration blocks generation without taking down reading',async()=>{
 const b=await createBillingRuntime({env:{READER_BILLING_ENABLED:'true',CREEM_MODE:'live'}});
 assert.equal(b.enabled,true);assert.equal((await b.catalog()).available,false);
 await assert.rejects(b.quote({ownerId:'u',action:'translation',scope:{bookId:'b',contentVersion:'v',requestHash:'h'}}),e=>e.status===503);
});
test('invalid environment or campaign budget never silently enables live billing',async()=>{
 for(const env of [{CREEM_MODE:'typo'},{CREEM_MODE:'live',READER_BILLING_TRIAL_BUDGET_POINTS:'-1'}]){
  const b=await createBillingRuntime({env:{READER_BILLING_ENABLED:'true',...env}});assert.equal((await b.catalog()).available,false);
 }
});
