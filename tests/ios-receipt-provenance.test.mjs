import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {verifyReceiptProvenance,decodeReceiptArchive,decodePlanArchive,verifySourceRun,verifyOriginalPlan} from '../scripts/ios/receipt-provenance.mjs';
import {maySubmit,trustedReceipt} from '../scripts/ios/release-policy.mjs';
const sha='a'.repeat(40),hash='b'.repeat(64),identity={appId:'123',bundleId:'example.verified'};
const apple={...identity,version:'0.1.0',buildNumber:'1.0.1',buildId:'build',uploadId:'upload',uploadState:'COMPLETE',processingState:'VALID'};
const receipt={schemaVersion:2,repository:'getyak/leafhour',...identity,commitSha:sha,ipaSha256:hash,version:'0.1.0',buildNumber:'1.0.1',runId:'100',ciRunId:'99',apple};
const artifact={id:500,name:'ios-testflight-receipt',expired:false,size_in_bytes:1000,digest:'sha256:'+'c'.repeat(64),workflow_run:{id:100,head_sha:sha,head_branch:'main'}};
const run=id=>({id:Number(id),head_sha:sha,head_branch:'main',head_repository:{full_name:'getyak/leafhour'},status:'completed',conclusion:'success',path:Number(id)===100?'.github/workflows/release-ios.yml':'.github/workflows/ci.yml',event:Number(id)===100?'workflow_run':'push'});
const proof={getRun:async id=>run(id)};
test('later workflow attempts never make an uncertain second transport submission',()=>{
  assert.equal(maySubmit('1'),true);
  for(const attempt of ['2','3','99',undefined,'0'])assert.equal(maySubmit(attempt),false);
});
test('a minimal receipt is trusted only with its matching successful source workflow and CI artifact',async()=>{
  assert.equal(await verifyReceiptProvenance(artifact,receipt,identity,proof),true);
  assert.equal(trustedReceipt({...artifact,expired:true},receipt,identity),false);
  assert.equal(trustedReceipt({...artifact,workflow_run:{...artifact.workflow_run,head_sha:'d'.repeat(40)}},receipt,identity),false);
  for(const change of [{appId:'other'},{buildNumber:'2.0.0'},{processingState:'FAILED'}])assert.equal(trustedReceipt(artifact,{...receipt,apple:{...apple,...change}},identity),false);
  for(const change of [{conclusion:'failure'},{head_sha:'d'.repeat(40)},{path:'.github/workflows/other.yml'},{head_repository:{full_name:'foreign/repo'}}])assert.equal(await verifyReceiptProvenance(artifact,receipt,identity,{getRun:async id=>({...run(id),...change})}),false);
});
test('receipt ZIP downloads require the server digest and exactly the allowlisted small JSON',()=>{
  const zip=execFileSync('python3',['-c','import sys,io,zipfile; b=io.BytesIO(); z=zipfile.ZipFile(b,"w"); z.writestr(sys.argv[1],sys.stdin.buffer.read()); z.close(); sys.stdout.buffer.write(b.getvalue())','testflight-receipt.json'],{input:JSON.stringify(receipt)});
  const meta={...artifact,digest:'sha256:'+createHash('sha256').update(zip).digest('hex')};
  assert.deepEqual(decodeReceiptArchive(zip,meta),receipt);
  assert.throws(()=>decodeReceiptArchive(Buffer.concat([zip,Buffer.from('tamper')]),meta),/digest/);
  const wrong=execFileSync('python3',['-c','import sys,io,zipfile; b=io.BytesIO(); z=zipfile.ZipFile(b,"w"); z.writestr("Leafhour.ipa",b"not allowed"); z.close(); sys.stdout.buffer.write(b.getvalue())']);
  assert.throws(()=>decodeReceiptArchive(wrong,{...artifact,digest:'sha256:'+createHash('sha256').update(wrong).digest('hex')}));
});
test('read-only recovery accepts a failed source run only when its exact plan, app and successful CI match',async()=>{
  await verifyOriginalPlan(receipt,identity,'100',{getRun:async id=>({...run(id),...(Number(id)===100?{conclusion:'failure'}:{})})});
  await assert.rejects(verifyOriginalPlan(receipt,identity,'101',proof));
  await assert.rejects(verifyOriginalPlan(receipt,{...identity,appId:'other'},'100',proof));
});
test('recovery validates the selected main workflow before accepting a bounded plan with no executable paths',async()=>{
  await verifySourceRun('100',proof);
  await assert.rejects(verifySourceRun('100',{getRun:async()=>({...run('100'),head_branch:'feature'})}));
  const good=execFileSync('python3',['-c','import sys,io,zipfile; b=io.BytesIO(); z=zipfile.ZipFile(b,"w"); z.writestr("release-plan.json",sys.stdin.buffer.read()); z.close(); sys.stdout.buffer.write(b.getvalue())'],{input:JSON.stringify(receipt)});
  assert.deepEqual(decodePlanArchive(good,{...artifact,name:'ios-release-plan',digest:'sha256:'+createHash('sha256').update(good).digest('hex')}),receipt);
  const zip=execFileSync('python3',['-c','import sys,io,zipfile; b=io.BytesIO(); z=zipfile.ZipFile(b,"w"); z.writestr("release-plan.json",sys.stdin.buffer.read()); z.writestr("scripts/ios/receipt-provenance.mjs",b"untrusted executable source"); z.close(); sys.stdout.buffer.write(b.getvalue())'],{input:JSON.stringify(receipt)});
  assert.throws(()=>decodePlanArchive(zip,{...artifact,name:'ios-release-plan',digest:'sha256:'+createHash('sha256').update(zip).digest('hex')}));
});
