import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyReceiptProvenance,assertPublishedReceipt} from '../scripts/ios/receipt-provenance.mjs';
import {maySubmit} from '../scripts/ios/release-policy.mjs';
const sha='a'.repeat(40),hash='b'.repeat(64),identity={appId:'123',bundleId:'example.verified'};
const apple={...identity,version:'0.1.0',buildNumber:'1.0.1',buildId:'build',uploadId:'upload',uploadState:'COMPLETE',processingState:'VALID'};
const receipt={schemaVersion:1,repository:'getyak/leafhour',...identity,commitSha:sha,ipaSha256:hash,version:'0.1.0',buildNumber:'1.0.1',runId:'100',ciRunId:'99',apple};
const release={draft:false,prerelease:true,author:{login:'github-actions[bot]'},tag_name:'ios/v0.1.0-build1.0.1',target_commitish:sha,assets:[{name:'testflight-receipt.json'},{name:'Leafhour.ipa',size:10,state:'uploaded',digest:'sha256:'+hash}]};
const run=id=>({id:Number(id),head_sha:sha,head_branch:'main',head_repository:{full_name:'getyak/leafhour'},status:'completed',conclusion:'success',path:Number(id)===100?'.github/workflows/release-ios.yml':'.github/workflows/ci.yml',event:Number(id)===100?'workflow_run':'push'});
const proof={getRun:async id=>run(id),getTag:async()=>({type:'commit',sha})};
test('later attempts reconcile an accepted-but-not-yet-visible upload without another submission',()=>{
  assert.equal(maySubmit('1'),true);
  for(const attempt of ['2','3','99',undefined,'0']) assert.equal(maySubmit(attempt),false);
});
test('trusted receipt checks actual successful workflow/CI and live tag provenance',async()=>{
  assert.equal(await verifyReceiptProvenance(release,receipt,identity,proof),true);
  assert.equal(await verifyReceiptProvenance(release,receipt,identity,{...proof,getTag:async()=>({type:'commit',sha:'c'.repeat(40)})}),false);
  for(const changes of [{conclusion:'failure'},{head_sha:'c'.repeat(40)},{path:'.github/workflows/other.yml'},{head_repository:{full_name:'foreign/repo'}}]) assert.equal(await verifyReceiptProvenance(release,receipt,identity,{...proof,getRun:async id=>({...run(id),...changes})}),false);
});
test('finalization validates the published Apple evidence, IPA digest and current tag before idempotent success',async()=>{
  await assertPublishedReceipt(release,receipt,receipt,identity,proof);
  for(const prior of [{...receipt,apple:{...apple,processingState:'FAILED'}},{...receipt,apple:{...apple,buildId:'different'}},{...receipt,apple:undefined}]) await assert.rejects(assertPublishedReceipt(release,prior,receipt,identity,proof));
  await assert.rejects(assertPublishedReceipt(release,receipt,receipt,identity,{...proof,getTag:async()=>({type:'commit',sha:'c'.repeat(40)})}));
});
