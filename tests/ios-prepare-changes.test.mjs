import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {existsSync,mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {prepare} from '../scripts/ios/prepare.mjs';

const repository='getyak/leafhour';
const baseSha='a'.repeat(40),headSha='d'.repeat(40),otherSha='e'.repeat(40);
const identity={appId:'123',bundleId:'example.verified'};
const reviewedFiles=[
  {path:'apps/ios/project.yml',base:'6f4f1640cecae45e2ee86f692df8bdeb840ac640',head:'026bfb94225bb058ceb725147f3678cd2df3d5a8'},
  {path:'apps/ios/Leafhour.xcodeproj/project.pbxproj',base:'7020d4306d650f6d8680b77e055c213727295e03',head:'5c0645ea7ce691dd3e98d37a4eaa48da66f66c7b'},
  {path:'apps/ios/Leafhour/VideoAcceptanceFixture.swift',base:'352f1e568158996348fdef37d69746b2e46a07fd',head:'8299124e331c20d8cce23db6150bcff0b0086839'},
];
const change=(filename,extra={})=>({filename,status:'modified',sha:otherSha,...extra});
const qaPaths=[
  'apps/ios/Config/GET328Acceptance.xcconfig',
  'apps/ios/Config/GET328Acceptance-Info.plist',
  'apps/ios/Leafhour.xcodeproj/xcshareddata/xcschemes/LeafhourGET328CurrentAcceptance.xcscheme',
];
const testOnlyFiles=()=>[
  ...reviewedFiles.map(file=>change(file.path,{sha:file.head})),
  ...qaPaths.map(filename=>change(filename,{status:'added'})),
  change('apps/ios/LeafhourCore/Tests/LeafhourCoreTests/ReaderOpeningTests.swift'),
  change('apps/ios/LeafhourUITests/GET328CurrentAcceptance.swift'),
  change('apps/ios/LeafhourAppTests/ReaderPaginationTests.swift'),
  change('docs/verification/2026-11-07-get-328-current-acceptance/README.md',{status:'added'}),
  change('tests/ios-prepare-changes.test.mjs',{status:'added'}),
  change('tests/test_ios_prepare.py',{status:'added'}),
  change('scripts/ios/prepare.mjs'),
  change('scripts/ios/release-changes.mjs',{status:'added'}),
  change('scripts/ios/get328_build_only.py',{status:'added'}),
  change('scripts/ios/build_only_budget.py',{status:'added'}),
  change('scripts/ios/verify-get328-app-traits.mjs',{status:'added'}),
];
const docChange=()=>change('docs/verification/2026-11-07-get-328-current-acceptance/README.md');

function receiptArchive(receipt) {
  return execFileSync('python3',['-c','import sys,io,zipfile; b=io.BytesIO(); z=zipfile.ZipFile(b,"w"); z.writestr("testflight-receipt.json",sys.stdin.buffer.read()); z.close(); sys.stdout.buffer.write(b.getvalue())'],{input:JSON.stringify(receipt),maxBuffer:65536});
}

// The only external boundary is a finite set of synthetic GitHub reads. prepare(),
// ZIP digest/decoding, source-run provenance, and the filesystem plan write are real.
async function runPrepare(options={}) {
  const receipt={
    schemaVersion:2,repository,...identity,commitSha:baseSha,ipaSha256:'b'.repeat(64),
    version:'0.1.0',buildNumber:'1.0.1',runId:'100',ciRunId:'99',
    apple:{...identity,version:'0.1.0',buildNumber:'1.0.1',buildId:'build',uploadId:'upload',uploadState:'COMPLETE',processingState:'VALID'},
    ...options.receipt,
  };
  const archive=receiptArchive(receipt);
  const artifact={
    id:500,name:'ios-testflight-receipt',expired:false,size_in_bytes:archive.length,
    digest:'sha256:'+createHash('sha256').update(archive).digest('hex'),
    workflow_run:{id:100,head_sha:baseSha,head_branch:'main'},...options.artifact,
  };
  const sourceRun={id:100,head_sha:baseSha,head_branch:'main',head_repository:{full_name:repository},status:'completed',conclusion:'success',path:'.github/workflows/release-ios.yml',event:'workflow_run',...options.sourceRun};
  const receiptCIRun={id:99,head_sha:baseSha,head_branch:'main',head_repository:{full_name:repository},status:'completed',conclusion:'success',path:'.github/workflows/ci.yml',event:'push',...options.receiptCIRun};
  const currentCIRun={id:199,head_sha:headSha,head_branch:'main',head_repository:{full_name:repository},status:'completed',conclusion:'success',path:'.github/workflows/ci.yml',event:'push',...options.currentCIRun};
  const comparison={base_commit:{sha:baseSha},merge_base_commit:{sha:baseSha},status:'ahead',ahead_by:1,behind_by:0,total_commits:1,commits:[{sha:headSha}],files:options.files??testOnlyFiles(),...options.comparison};
  const bounded=args=>{
    assert.equal(args.owner,'getyak');
    assert.equal(args.repo,'leafhour');
  };
  const github={rest:{repos:{
    getBranch:async args=>{bounded(args);assert.equal(args.branch,'main');return {data:{commit:{sha:options.tip??headSha}}};},
    compareCommitsWithBasehead:async args=>{bounded(args);assert.equal(args.basehead,`${baseSha}...${headSha}`);return {data:comparison};},
    getContent:async args=>{
      bounded(args);assert.equal(args.ref,baseSha);
      const reviewed=reviewedFiles.find(file=>file.path===args.path);
      assert.ok(reviewed,`Unexpected baseline read: ${args.path}`);
      if(options.baseReadError)throw options.baseReadError;
      const data=Object.hasOwn(options.baseFiles??{},args.path)?options.baseFiles[args.path]:{type:'file',path:args.path,sha:reviewed.base};
      return {data};
    },
  },actions:{
    listWorkflowRuns:async args=>{bounded(args);assert.equal(args.workflow_id,'ci.yml');assert.equal(args.head_sha,headSha);assert.equal(args.event,'push');return {data:{workflow_runs:options.manualCIRuns??[currentCIRun]}};},
    listWorkflowRunArtifacts:async args=>{bounded(args);assert.equal(args.run_id,100);return {data:{artifacts:[artifact]}};},
    downloadArtifact:async args=>{bounded(args);assert.equal(args.artifact_id,500);assert.equal(args.archive_format,'zip');return {data:options.archiveBytes??archive};},
    getWorkflowRun:async args=>{bounded(args);assert.ok([99,100].includes(args.run_id));return {data:args.run_id===100?sourceRun:receiptCIRun};},
  }},paginate:async (method,args)=>{assert.equal(method,github.rest.actions.listWorkflowRuns);bounded(args);assert.equal(args.workflow_id,'release-ios.yml');assert.equal(args.branch,'main');assert.equal(args.status,'success');return [sourceRun];}};
  const context={repo:{owner:'getyak',repo:'leafhour'},payload:{repository:{full_name:repository},workflow_run:currentCIRun},eventName:'workflow_run',ref:'refs/heads/main',sha:headSha,runId:200,runNumber:300,...options.context};
  const outputs={},summaries=[];
  const summary={addHeading(){return this;},addRaw(value){summaries.push(value);return this;},async write(){}};
  const env={IOS_TESTFLIGHT_ENABLED:'true',IOS_AUTOMATIC_TESTFLIGHT:'true',IOS_APP_ID:identity.appId,IOS_BUNDLE_ID:identity.bundleId,...options.env};
  const directory=mkdtempSync(join(tmpdir(),'leafhour-ios-prepare-changes-'));
  const previous=process.cwd();
  try {
    mkdirSync(join(directory,'apps/ios'),{recursive:true});
    writeFileSync(join(directory,'apps/ios/release.json'),JSON.stringify({marketingVersion:'0.1.0'}));
    process.chdir(directory);
    let error;
    try {await prepare({github,context,core:{setOutput:(key,value)=>{outputs[key]=value;},summary},env});}catch(cause){error=cause;}
    const planExists=existsSync(join(directory,'release-plan.json'));
    return {outputs,summaries,error,planExists,plan:planExists?JSON.parse(readFileSync(join(directory,'release-plan.json'),'utf8')):undefined};
  }finally{
    process.chdir(previous);
    rmSync(directory,{recursive:true,force:true});
  }
}

function assertDecision(result,publish) {
  assert.ifError(result.error);
  assert.equal(result.outputs.publish,String(publish));
  assert.equal(result.outputs.sha,headSha);
  assert.equal(result.planExists,publish);
  if(publish)assert.deepEqual(result.plan,{version:'0.1.0',buildNumber:'1.3.0',commitSha:headSha,repository,...identity,runId:'200',ciRunId:'199'});
  else assert.equal(result.plan,undefined);
}

test('automatic preparation skips the exact reviewed QA-only batch after a trusted Apple receipt',async()=>{
  assertDecision(await runPrepare(),false);
});

test('automatic preparation still writes a release plan when QA changes accompany product code',async()=>{
  assertDecision(await runPrepare({files:[...testOnlyFiles(),change('apps/ios/Leafhour/ReaderScreen.swift')]}),true);
});

for(const filename of [
  'apps/ios/Config/Release.xcconfig',
  'apps/ios/Leafhour/Info.plist',
  'apps/ios/ListeningWidget/Info.plist',
  'apps/ios/release.json',
  'apps/ios/Leafhour/Assets.xcassets/AppIcon.appiconset/Contents.json',
  'apps/ios/Vendor/Reader/Reader.swift',
  'scripts/ios/archive.sh',
  'scripts/ios/upload.sh',
  'scripts/ios/release-policy.mjs',
  'scripts/ios/receipt-provenance.mjs',
  '.github/workflows/release-ios.yml',
  '.github/workflows/ci.yml',
  '.github/workflows/refresh-ios-signing.yml',
  'apps/ios/LeafhourCore/Sources/LeafhourCore/ReaderSession.swift',
  'apps/ios/LeafhourCore/Package.swift',
  'package-lock.json',
  'unknown/possible-build-input.json',
])test(`automatic preparation keeps ${filename} release-relevant`,async()=>{
  assertDecision(await runPrepare({files:[docChange(),change(filename)]}),true);
});

test('automatic preparation considers both sides when product code is renamed into a test directory',async()=>{
  assertDecision(await runPrepare({files:[change('apps/ios/LeafhourUITests/FormerReader.swift',{status:'renamed',previous_filename:'apps/ios/Leafhour/ReaderScreen.swift'})]}),true);
});

test('automatic preparation considers both sides when a test is renamed into product code',async()=>{
  assertDecision(await runPrepare({files:[change('apps/ios/Leafhour/ReaderScreen.swift',{status:'renamed',previous_filename:'apps/ios/LeafhourUITests/FormerReader.swift'})]}),true);
});

for(const reviewed of reviewedFiles)test(`automatic preparation only exempts the reviewed head blob for ${reviewed.path}`,async()=>{
  assertDecision(await runPrepare({files:[change(reviewed.path,{sha:otherSha})]}),true);
});

for(const [label,baseFile] of [
  ['different baseline blob',{type:'file',path:reviewedFiles[0].path,sha:otherSha}],
  ['wrong returned path',{type:'file',path:'apps/ios/another-project.yml',sha:reviewedFiles[0].base}],
  ['directory metadata',{type:'dir',path:reviewedFiles[0].path,sha:reviewedFiles[0].base}],
  ['missing blob metadata',{type:'file',path:reviewedFiles[0].path}],
])test(`automatic preparation rejects an unproven reviewed pair: ${label}`,async()=>{
  assertDecision(await runPrepare({files:[change(reviewedFiles[0].path,{sha:reviewedFiles[0].head})],baseFiles:{[reviewedFiles[0].path]:baseFile}}),true);
});

for(const [label,comparison] of [
  ['missing file list',{files:undefined}],
  ['null file list',{files:null}],
  ['300-file truncation boundary',{files:Array.from({length:300},(_,index)=>change(`docs/verification/evidence-${index}.md`))}],
  ['diverged history',{status:'diverged'}],
  ['different comparison base',{base_commit:{sha:otherSha}}],
  ['different merge base',{merge_base_commit:{sha:otherSha}}],
  ['missing comparison base',{base_commit:undefined}],
  ['missing merge base',{merge_base_commit:undefined}],
  ['invalid file status',{files:[change('docs/verification/evidence.md',{status:'unknown'})]}],
  ['missing file blob',{files:[{filename:'docs/verification/evidence.md',status:'modified'}]}],
])test(`automatic preparation publishes conservatively for ${label}`,async()=>{
  assertDecision(await runPrepare({files:[docChange()],comparison}),true);
});

test('baseline permission failure aborts preparation before any upload plan exists',async()=>{
  const denied=Object.assign(new Error('Baseline read permission denied'),{status:403});
  const result=await runPrepare({baseReadError:denied});
  assert.ok(result.error,'permission errors must not be swallowed into a release or skip decision');
  assert.match(result.error.message,/permission|baseline|classif|base/i);
  assert.notEqual(result.outputs.publish,'true');
  assert.equal(result.planExists,false);
});

for(const [label,options] of [
  ['expired artifact',{artifact:{expired:true}}],
  ['mismatched artifact digest',{artifact:{digest:'sha256:'+'0'.repeat(64)}}],
  ['invalid Apple processing state',{receipt:{apple:{...identity,version:'0.1.0',buildNumber:'1.0.1',buildId:'build',uploadId:'upload',uploadState:'COMPLETE',processingState:'FAILED'}}}],
  ['wrong receipt app',{receipt:{appId:'456'}}],
  ['unsuccessful receipt workflow',{sourceRun:{conclusion:'failure'}}],
  ['foreign receipt CI provenance',{receiptCIRun:{head_repository:{full_name:'foreign/leafhour'}}}],
  ['mismatched receipt CI commit',{receiptCIRun:{head_sha:otherSha}}],
])test(`automatic preparation never uses ${label} to skip a release`,async()=>{
  assertDecision(await runPrepare({files:[docChange()],...options}),true);
});

for(const [label,options] of [
  ['disabled channel',{env:{IOS_TESTFLIGHT_ENABLED:'false'}}],
  ['disabled automatic publishing',{env:{IOS_AUTOMATIC_TESTFLIGHT:'false'}}],
  ['failed current CI',{currentCIRun:{conclusion:'failure'}}],
  ['foreign current CI',{currentCIRun:{head_repository:{full_name:'foreign/leafhour'}}}],
  ['non-push current CI',{currentCIRun:{event:'pull_request'}}],
  ['stale main SHA',{tip:otherSha}],
])test(`change classification does not bypass the ${label} guard`,async()=>{
  assertDecision(await runPrepare(options),false);
});

test('manual explicit publish still writes the plan for a test-only batch',async()=>{
  assertDecision(await runPrepare({context:{eventName:'workflow_dispatch'},env:{PUBLISH_TESTFLIGHT:'true'}}),true);
});

test('manual publish requires the explicit publish setting',async()=>{
  assertDecision(await runPrepare({context:{eventName:'workflow_dispatch'}}),false);
});

test('manual publish refuses a newer failed exact CI run',async()=>{
  const ci={head_sha:headSha,head_branch:'main',head_repository:{full_name:repository},status:'completed',event:'push'};
  assertDecision(await runPrepare({context:{eventName:'workflow_dispatch'},env:{PUBLISH_TESTFLIGHT:'true'},manualCIRuns:[{...ci,id:198,conclusion:'success'},{...ci,id:199,conclusion:'failure'}]}),false);
});
