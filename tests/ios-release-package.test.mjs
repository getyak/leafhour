import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {checkPackage,makeReceipt} from '../scripts/ios/release.mjs';
const bytes=Buffer.from('isolated synthetic artifact');
const plan={commitSha:'a'.repeat(40),ipaSha256:createHash('sha256').update(bytes).digest('hex'),appId:'123',bundleId:'example.verified',version:'0.1.0',buildNumber:'1.0.1'};
const apple={appId:plan.appId,bundleId:plan.bundleId,version:plan.version,buildNumber:plan.buildNumber,buildId:'build',uploadId:'upload',uploadState:'COMPLETE',processingState:'VALID'};
test('a different IPA cannot use the archived release metadata',()=>{
  assert.equal(checkPackage(plan,bytes),plan.ipaSha256);
  assert.throws(()=>checkPackage(plan,Buffer.from('different artifact')),/digest/);
});
test('a receipt requires matching exact identity and independent valid processing proof',()=>{
  assert.equal(makeReceipt(plan,apple).apple.buildId,'build');
  for(const change of [{appId:'999'},{version:'9.0.0'},{buildNumber:'2.0.0'},{processingState:'PROCESSING'},{uploadId:null}]) assert.throws(()=>makeReceipt(plan,{...apple,...change}));
});
test('the persisted receipt drops arbitrary plan/proof fields and contains no binary or secret metadata',()=>{
  const result=makeReceipt({...plan,repository:'getyak/leafhour',runId:'100',ciRunId:'99',secret:'must not persist',tag:'must not persist'},{...apple,secret:'must not persist'});
  assert.equal(result.schemaVersion,2);assert.equal(result.secret,undefined);assert.equal(result.tag,undefined);assert.equal(result.apple.secret,undefined);
});
