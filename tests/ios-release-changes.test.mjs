import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {classifyIOSReleaseChanges} from '../scripts/ios/release-changes.mjs';

const baseSha='a'.repeat(40),headSha='b'.repeat(40),otherSha='c'.repeat(40);
// Independent literals from the reviewed main baseline and DEBUG-only QA blob proofs.
const pairs=[
  ['apps/ios/project.yml','6f4f1640cecae45e2ee86f692df8bdeb840ac640','026bfb94225bb058ceb725147f3678cd2df3d5a8'],
  ['apps/ios/Leafhour.xcodeproj/project.pbxproj','7020d4306d650f6d8680b77e055c213727295e03','5c0645ea7ce691dd3e98d37a4eaa48da66f66c7b'],
  ['apps/ios/Leafhour/VideoAcceptanceFixture.swift','352f1e568158996348fdef37d69746b2e46a07fd','8299124e331c20d8cce23db6150bcff0b0086839'],
];
const file=(filename,extra={})=>({filename,status:'modified',sha:otherSha,...extra});
const comparison=files=>({status:'ahead',base_commit:{sha:baseSha},merge_base_commit:{sha:baseSha},files});
const metadata=async path=>({type:'file',path,sha:pairs.find(p=>p[0]===path)?.[1]??otherSha});
const classify=(files,options={})=>classifyIOSReleaseChanges({comparison:comparison(files),baseSha,headSha,readBaseFile:metadata,...options});

test('the exact reviewed GET-328 mixed blobs and standalone test/QA changes need no binary',async()=>{
  const files=[];
  for(const [path,,expected] of pairs){
    // These immutable reviewed metadata fixtures do not freeze future source
    // files. Unknown/new product blobs are required to remain release-relevant.
    files.push(file(path,{sha:expected}));
  }
  for(const path of ['apps/ios/LeafhourUITests/ReadingUITests.swift','apps/ios/LeafhourAppTests/ReaderTapTests.swift',
    'apps/ios/LeafhourCore/Tests/LeafhourCoreTests/BookParserTests.swift','apps/ios/verification/GET-328/reader.png',
    'apps/ios/Config/GET328Acceptance.xcconfig','apps/ios/Config/GET328Acceptance-Info.plist',
    'apps/ios/Leafhour.xcodeproj/xcshareddata/xcschemes/LeafhourGET328CurrentAcceptance.xcscheme',
    'tests/ios-prepare-changes.test.mjs','tests/test_ios_signing.py','scripts/ios/prepare.mjs','scripts/ios/release-changes.mjs',
    'scripts/ios/get328_build_only.py','scripts/ios/build_only_budget.py','scripts/ios/verify-get328-app-traits.mjs',
    'docs/verification/2026-11-07-get-328-preparation.md']) files.push(file(path));
  const result=await classify(files);
  assert.equal(result.releaseRelevant,false);
  assert.match(result.reason,/Release|binary/);
});

test('a product input mixed with any number of tests still requires a binary',async t=>{
  for(const path of ['apps/ios/Leafhour/ReaderScreen.swift','apps/ios/LeafhourCore/Sources/LeafhourCore/Models.swift',
    'apps/ios/ListeningShared/ListeningStatus.swift','apps/ios/ListeningWidget/Info.plist',
    'apps/ios/Config/Release.xcconfig','apps/ios/Leafhour/Info.plist',
    'apps/ios/Leafhour/Assets.xcassets/AppIcon.appiconset/Contents.json',
    'apps/ios/Vendor/ZIPFoundation/Sources/ZIPFoundation/Archive.swift','apps/ios/LeafhourCore/Package.swift',
    'apps/ios/release.json','apps/ios/Config/FutureConfiguration.xcconfig',
    'scripts/ios/archive.sh','.github/workflows/release-ios.yml','.github/workflows/refresh-ios-signing.yml']){
    await t.test(path,async()=>assert.equal((await classify([file('apps/ios/LeafhourUITests/Test.swift'),file(path)])).releaseRelevant,true));
  }
});

test('renames cannot hide a native input behind a test filename or the reverse',async t=>{
  for(const [from,to] of [
    ['apps/ios/Leafhour/ReaderScreen.swift','apps/ios/LeafhourUITests/ReaderScreen.swift'],
    ['apps/ios/LeafhourUITests/ReaderScreen.swift','apps/ios/Leafhour/ReaderScreen.swift'],
    ['apps/ios/project.yml','apps/ios/Config/GET328Acceptance.xcconfig'],
    ['scripts/ios/archive.sh','scripts/ios/prepare.mjs'],
  ])await t.test(from+' -> '+to,async()=>assert.equal((await classify([file(to,{status:'renamed',previous_filename:from})])).releaseRelevant,true));
});

test('each shared-file exemption requires both exact reviewed blobs, status, path and file type',async t=>{
  for(const [path,before,after] of pairs){
    const known=file(path,{sha:after});
    await t.test(path+' unknown head',async()=>assert.equal((await classify([file(path)])).releaseRelevant,true));
    await t.test(path+' unknown baseline',async()=>assert.equal((await classify([known],{readBaseFile:async()=>({type:'file',path,sha:otherSha})})).releaseRelevant,true));
    for(const status of ['added','removed','renamed'])await t.test(path+' '+status,async()=>assert.equal((await classify([file(path,{sha:after,status,previous_filename:status==='renamed'?'docs/renamed':undefined})])).releaseRelevant,true));
    for(const change of [{type:'dir'},{path:'another/path'},{sha:null}])await t.test(path+' wrong '+Object.keys(change)[0],async()=>assert.equal((await classify([known],{readBaseFile:async()=>({type:'file',path,sha:before,...change})})).releaseRelevant,true));
  }
});

test('a real Release-code append to the DEBUG fixture cannot inherit its old exemption',async()=>{
  const path='apps/ios/Leafhour/VideoAcceptanceFixture.swift';
  const bytes=Buffer.concat([await readFile(new URL('../'+path,import.meta.url)),Buffer.from('\nenum ReleaseBehaviorChanged { static let enabled = true }\n')]);
  const sha=createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
  assert.equal((await classify([file(path,{sha})])).releaseRelevant,true);
});

test('the retired observer-free blob and lookalike host scripts are not new exemptions',async()=>{
  const path='apps/ios/Leafhour/VideoAcceptanceFixture.swift';
  assert.equal((await classify([file(path,{sha:'d37c67f3ccfff4ab4ea6cc52d978b9f0e081fbd7'})])).releaseRelevant,true);
  assert.equal((await classify([file(path,{sha:pairs[2][2]})],{
    readBaseFile:async()=>({type:'file',path,sha:'d37c67f3ccfff4ab4ea6cc52d978b9f0e081fbd7'}),
  })).releaseRelevant,true);
  assert.equal((await classify([file('scripts/ios/verify-get328-app-traits-future.mjs')])).releaseRelevant,true);
});

test('incomplete or non-receipt comparisons cannot establish Release equivalence',async t=>{
  for(const [name,value] of [
    ['missing comparison',null],['missing files',{}],['300 files',comparison(Array.from({length:300},(_,i)=>file(`docs/${i}.md`)))],
    ['diverged',{...comparison([]),status:'diverged'}],['wrong base',{...comparison([]),base_commit:{sha:otherSha}}],
    ['wrong merge base',{...comparison([]),merge_base_commit:{sha:otherSha}}],
    ['missing merge base',{...comparison([]),merge_base_commit:undefined}],
    ['unknown status',{...comparison([]),status:'future-status'}],
  ])await t.test(name,async()=>assert.equal((await classify([],{comparison:value})).releaseRelevant,true));
});

test('malformed change metadata cannot make an automatic release disappear',async t=>{
  for(const entry of [null,{},file('apps/ios/../LeafhourUITests/Test.swift'),file('/apps/ios/LeafhourUITests/Test.swift'),
    file('apps/ios/LeafhourUITests/Test.swift',{status:'future-status'}),file('apps/ios/LeafhourUITests/Test.swift',{sha:'bad'})]){
    await t.test(JSON.stringify(entry),async()=>assert.equal((await classify([entry])).releaseRelevant,true));
  }
});

test('a failed baseline permission read stops preparation instead of authorizing an unnecessary archive',async()=>{
  await assert.rejects(classify([file(pairs[0][0],{sha:pairs[0][2]})],{readBaseFile:async()=>{throw Object.assign(Error('PRIVATE_PROVIDER_ERROR'),{status:403});}}),/Release|baseline|equivalence/);
});
