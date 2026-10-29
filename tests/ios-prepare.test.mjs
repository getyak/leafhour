import test from 'node:test';
import assert from 'node:assert/strict';
import {prepare} from '../scripts/ios/prepare.mjs';

test('disabled channels read no signing credentials and publish no plan',async()=>{
  const outputs={},requests=[];
  const sha='a'.repeat(40);
  const github={rest:{repos:{getBranch:async()=>{requests.push('branch');return {data:{commit:{sha}}};}}}};
  const summary={addHeading(){return this;},addRaw(){return this;},async write(){}};
  await prepare({github,context:{repo:{owner:'getyak',repo:'leafhour'},payload:{repository:{full_name:'getyak/leafhour'},workflow_run:{head_sha:sha}},eventName:'workflow_run',ref:'refs/heads/main'},core:{setOutput:(k,v)=>outputs[k]=v,summary},env:{}});
  assert.equal(outputs.publish,'false');assert.equal(outputs.tag,undefined);assert.deepEqual(requests,['branch']);
});

test('dispatch verifies the latest exact CI run and refuses a newer failed run',async()=>{
  const outputs={};const sha='a'.repeat(40);
  const github={rest:{repos:{getBranch:async()=>({data:{commit:{sha}}})},actions:{listWorkflowRuns:async({head_sha,workflow_id,event})=>{
    assert.equal(head_sha,sha);assert.equal(workflow_id,'ci.yml');assert.equal(event,'push');
    return {data:{workflow_runs:[{id:1,head_branch:'main',head_repository:{full_name:'getyak/leafhour'},status:'completed',conclusion:'success'},{id:2,head_branch:'main',head_repository:{full_name:'getyak/leafhour'},status:'completed',conclusion:'failure'}]}};
  }}}};
  const summary={addHeading(){return this;},addRaw(){return this;},async write(){}};
  await prepare({github,context:{repo:{owner:'getyak',repo:'leafhour'},payload:{repository:{full_name:'getyak/leafhour'}},eventName:'workflow_dispatch',ref:'refs/heads/main',sha},core:{setOutput:(k,v)=>outputs[k]=v,summary},env:{IOS_TESTFLIGHT_ENABLED:'true',PUBLISH_TESTFLIGHT:'true'}});
  assert.equal(outputs.publish,'false');
});
