import test from 'node:test';
import assert from 'node:assert/strict';
import {createPeopleFunding} from '../server/people-funding.mjs';
import {providerMeterContext} from '../server/provider-metering.mjs';
const fixture=()=>{const rows=new Map();return {read:async(k,f)=>structuredClone(rows.get(k)??f),mutate:async(k,f,fn)=>{const d=structuredClone(rows.get(k)??f),r=await fn(d);rows.set(k,d);return r;}};};
test('person generation requires run consent and enforces sponsor quota before dispatch',async()=>{const f=createPeopleFunding({store:fixture(),perOwnerLimit:1}),user={id:'reader'};let calls=0;const input={user,personId:'woolf',taskId:'one',maxCostCny:.75,run:async()=>{calls++;assert.equal(providerMeterContext().maxCostUsd,.02);return {ok:true};}};await assert.rejects(f.fund(input));assert.equal(calls,0);assert.deepEqual(await f.fund({...input,fundingConsent:true}),{ok:true});await assert.rejects(f.fund({...input,taskId:'two',fundingConsent:true}),e=>e.status===429);assert.equal(calls,1);});
