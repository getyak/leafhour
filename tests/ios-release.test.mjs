import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash, generateKeyPairSync, verify} from 'node:crypto';
import {releaseDecision, releaseMetadata, trustedReceipt} from '../scripts/ios/release-policy.mjs';
import {createToken, createClient, exactUpload, waitForBuild, PermanentError} from '../scripts/ios/app-store-connect.mjs';

const sha = 'a'.repeat(40);
const event = {event:'workflow_run', ref:'refs/heads/main', sha, tip:sha, ci:{event:'push', conclusion:'success', head_branch:'main', head_sha:sha, head_repository:{full_name:'getyak/leafhour'}}, repository:'getyak/leafhour'};
test('publishing requires both channel enablement and explicit manual or automatic authorization', () => {
  assert.equal(releaseDecision({...event}).publish, false);
  assert.equal(releaseDecision({...event, enabled:true}).publish, false);
  assert.equal(releaseDecision({...event, enabled:true, automatic:true}).publish, true);
  assert.equal(releaseDecision({...event, event:'workflow_dispatch', enabled:true, publish:true, ciVerified:true}).publish, true);
  assert.equal(releaseDecision({...event, event:'workflow_dispatch', enabled:true, publish:true, ciVerified:false}).publish, false);
});
test('stale CI, PR workflows, foreign repositories and non-main dispatch cannot publish', () => {
  for (const change of [{tip:'b'.repeat(40)}, {ref:'refs/heads/feature'}, {ci:{...event.ci,event:'pull_request'}}, {ci:{...event.ci,head_repository:{full_name:'elsewhere/leafhour'}}}, {ci:{...event.ci,conclusion:'failure'}}]) {
    assert.equal(releaseDecision({...event,enabled:true,automatic:true,...change}).publish,false);
  }
});
test('versions are strict and build numbers are monotonic, Apple-sized, and stable on reruns', () => {
  const meta = releaseMetadata({version:'0.1.0',runNumber:'10000',offset:'0',sha});
  assert.equal(meta.buildNumber,'2.0.0');
  assert.equal(releaseMetadata({version:'0.1.0',runNumber:'9999',offset:'0',sha}).buildNumber,'1.99.99');
  assert.equal(meta.tag,'ios/v0.1.0-build2.0.0');
  for (const input of [{version:'1.2.3;touch bad'}, {version:'01.2.3'}, {runNumber:'1e3'}, {offset:'-1'}, {runNumber:'99990000'}, {sha:'short'}]) {
    assert.throws(() => releaseMetadata({version:'0.1.0',runNumber:'1',offset:'0',sha,...input}));
  }
});
test('a trusted receipt binds source, artifact, workflow, Apple app and exact valid build', () => {
  const receipt={schemaVersion:1,repository:'getyak/leafhour',commitSha:sha,version:'0.1.0',buildNumber:'1.0.1',bundleId:'example.verified',appId:'123',ipaSha256:'b'.repeat(64),runId:'100',ciRunId:'99',apple:{appId:'123',bundleId:'example.verified',version:'0.1.0',buildNumber:'1.0.1',buildId:'abc',uploadId:'def',uploadState:'COMPLETE',processingState:'VALID'}};
  const release={draft:false,prerelease:true,author:{login:'github-actions[bot]'},tag_name:'ios/v0.1.0-build1.0.1',target_commitish:sha,assets:[{name:'testflight-receipt.json'},{name:'Leafhour.ipa',size:10,state:'uploaded',digest:'sha256:'+receipt.ipaSha256}]};
  assert.equal(trustedReceipt(release,receipt,{bundleId:'example.verified',appId:'123'}),true);
  for (const change of [{commitSha:'short'}, {ipaSha256:'fake'}, {apple:{...receipt.apple,processingState:'PROCESSING'}}, {bundleId:'other.app'}, {runId:''}]) {
    assert.equal(trustedReceipt(release,{...receipt,...change},{bundleId:'example.verified',appId:'123'}),false);
  }
  assert.equal(trustedReceipt({...release,author:{login:'human'}},receipt,{bundleId:'example.verified',appId:'123'}),false);
  for(const change of [{appId:'OTHER_APP'},{bundleId:'other.app'},{version:'9.0.0'},{buildNumber:'9.0.0'},{appId:undefined}]) assert.equal(trustedReceipt(release,{...receipt,apple:{...receipt.apple,...change}},{bundleId:'example.verified',appId:'123'}),false);
  assert.equal(trustedReceipt({...release,assets:release.assets.map(a=>a.name==='Leafhour.ipa'?{...a,digest:'sha256:'+'c'.repeat(64)}:a)},receipt,{bundleId:'example.verified',appId:'123'}),false);
});

const upload = (state='COMPLETE',processing='VALID') => ({data:[{id:'up',attributes:{cfBundleVersion:'1.0.1',cfBundleShortVersionString:'0.1.0',platform:'IOS',state:{state}},relationships:{build:{data:{type:'builds',id:'build'}}}}],included:[{type:'builds',id:'build',attributes:{version:'1.0.1',processingState:processing}}]});
const identity={buildNumber:'1.0.1',version:'0.1.0'};
test('build lookup requires exact iOS version and build, rejecting ambiguity and terminal failure', () => {
  assert.equal(exactUpload(upload(),identity).buildId,'build');
  assert.equal(exactUpload(upload(),{...identity,version:'9.0.0'}),null);
  assert.throws(()=>exactUpload({...upload(),data:[...upload().data,...upload().data]},identity),PermanentError);
  assert.throws(()=>exactUpload(upload('FAILED'),identity),PermanentError);
  assert.throws(()=>exactUpload(upload('COMPLETE','INVALID'),identity),PermanentError);
});
test('Apple processing retries transient reads, waits for VALID, and bounds the deadline', async () => {
  let now=0, calls=0;
  const result=await waitForBuild({lookup:async()=>{calls++; if(calls===1)throw Error('network');return calls===2?exactUpload(upload('PROCESSING','PROCESSING'),identity):exactUpload(upload(),identity);}, now:()=>now,sleep:async ms=>{now+=ms;},timeoutMs:100,pollMs:20,log:()=>{}});
  assert.equal(result.buildId,'build');assert.equal(calls,3);
  await assert.rejects(waitForBuild({lookup:async()=>null, now:()=>now,sleep:async ms=>{now+=ms;},timeoutMs:40,pollMs:20,log:()=>{}}),/unconfirmed/);
  let permanentCalls=0;
  await assert.rejects(waitForBuild({lookup:async()=>{permanentCalls++;throw new PermanentError('forbidden');},log:()=>{}}),PermanentError);
  assert.equal(permanentCalls,1);
});
test('API client retries only transient failures and never follows credential-bearing redirects', async () => {
  let calls=0;
  const client=createClient({token:()=> 'opaque',fetchImpl:async(url,init)=>{calls++;assert.equal(init.redirect,'error');assert.equal(new URL(url).origin,'https://api.appstoreconnect.apple.com');return {ok:calls===2,status:calls===2?200:429,json:async()=>({data:[]})};},sleep:async()=>{}});
  assert.deepEqual(await client.get('/v1/apps'),{data:[]});assert.equal(calls,2);
  await assert.rejects(client.get('https://evil.example/v1/apps'),/path/);
  const denied=createClient({token:()=> 'opaque',fetchImpl:async()=>({ok:false,status:403}),sleep:async()=>{}});
  await assert.rejects(denied.get('/v1/apps'),PermanentError);
});
test('ASC JWT uses ES256 with a short lifetime and valid JOSE signature', () => {
  const {privateKey,publicKey}=generateKeyPairSync('ec',{namedCurve:'prime256v1'});
  const token=createToken({privateKey,keyId:'EXAMPLEKEY',issuerId:'issuer',now:1000000});
  const [header,payload,signature]=token.split('.');
  assert.equal(JSON.parse(Buffer.from(header,'base64url')).alg,'ES256');
  const body=JSON.parse(Buffer.from(payload,'base64url'));assert.equal(body.exp-body.iat,600);
  assert.equal(verify('sha256',Buffer.from(`${header}.${payload}`),{key:publicKey,dsaEncoding:'ieee-p1363'},Buffer.from(signature,'base64url')),true);
});
