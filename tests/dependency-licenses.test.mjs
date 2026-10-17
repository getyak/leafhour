import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {analyze,buildInventory,checkEvidence,generateEvidence,renderReport,validateExpression,packageNameFromPath,sanitizeResolved,classifyProvenance,EvidenceFailure,REPORT_FILE,REVIEW_FILE} from '../tools/dependency-licenses.mjs';

const reviewed={'MIT':{'status':'reviewed','note':'Permissive; keep the notice.'},'(MIT OR CC0-1.0)':{'status':'reviewed','note':'Disjunctive choice.'},'(MIT AND Zlib)':{'status':'reviewed','note':'Conjunctive.'},'MIT AND Zlib':{'status':'reviewed','note':'Conjunctive, unparenthesized.'},'Apache-2.0 AND LGPL-3.0-or-later AND MIT':{'status':'reviewed','note':'Conjunctive.'},'AGPL-3.0-only':{'status':'reviewed','note':'Root project license.'},'WTFPL':{'status':'reviewed','note':'Reviewed for one test.'},'BSD-3-Clause':{'status':'reviewed','note':'Permissive.'},'ISC':{'status':'reviewed','note':'Permissive.'},'Apache-2.0':{'status':'reviewed','note':'Permissive.'}};
async function fixture(t,packages,{review=reviewed,lockName='fixture'}={}){
  const root=await mkdtemp(path.join(tmpdir(),'dependency-licenses-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  await mkdir(path.join(root,'docs'),{recursive:true});
  const lock={name:lockName,version:'1.0.0',lockfileVersion:3,packages:{'':{name:lockName,version:'1.0.0',license:'AGPL-3.0-only',dependencies:{}},...packages}};
  await writeFile(path.join(root,'package-lock.json'),JSON.stringify(lock,null,2)+'\n');
  if(review!==null)await writeFile(path.join(root,REVIEW_FILE),JSON.stringify({schemaVersion:1,expressions:review},null,2)+'\n');
  return root;
}
function entry(version,license,extra={}){return {version,license,resolved:'https://registry.npmjs.org/pkg/-/pkg-'+version+'.tgz',integrity:'sha512-'+version,...extra};}
async function problemsOf(root){try{await generateEvidence(root);}catch(error){assert.ok(error instanceof EvidenceFailure,'generator must fail closed');return error.problems;}assert.fail('generator should have refused to write');}

test('the report is deterministic, sorted and bound to the lockfile SHA256',async t=>{
  const root=await fixture(t,{'node_modules/b':entry('2.0.0','MIT'),'node_modules/a':entry('1.0.0','ISC')});
  const first=await generateEvidence(root);
  assert.equal(first.written,true);
  const text=await readFile(path.join(root,REPORT_FILE),'utf8');
  const report=JSON.parse(text);
  const lockBytes=await readFile(path.join(root,'package-lock.json'));
  assert.equal(report.lockfile.sha256,createHash('sha256').update(lockBytes).digest('hex'));
  assert.deepEqual(report.root,{name:'fixture',version:'1.0.0',license:'AGPL-3.0-only'});
  assert.deepEqual(report.packages.map(record=>record.name),['a','b']);
  assert.equal(text.endsWith('\n'),true);
  assert.deepEqual(Object.keys(report),['schemaVersion','kind','lockfile','root','summary','packages'],'evidence must stay deterministic and carry no timestamps');
  assert.deepEqual(Object.keys(report.lockfile),['path','sha256','lockfileVersion','name','version']);
  const second=await generateEvidence(root);
  assert.equal(second.written,false,'an unchanged lockfile must not rewrite the report');
  assert.equal(await readFile(path.join(root,REPORT_FILE),'utf8'),text);
  // Record order must not depend on the lockfile map order.
  const entries={'node_modules/a':entry('1.0.0','ISC'),'node_modules/b':entry('2.0.0','MIT')};
  const reversed=Object.fromEntries(Object.entries(entries).reverse());
  assert.equal(renderReport(buildInventory({lockfileVersion:3,packages:{'':{name:'fixture',version:'1.0.0',license:'AGPL-3.0-only'},...entries}},{lockfileSha256:'a'.repeat(64)}).report),renderReport(buildInventory({lockfileVersion:3,packages:{'':{name:'fixture',version:'1.0.0',license:'AGPL-3.0-only'},...reversed}},{lockfileSha256:'a'.repeat(64)}).report));
});

test('check mode rejects a stale report after the lockfile changes and regeneration shows the change',async t=>{
  const root=await fixture(t,{'node_modules/a':entry('1.0.0','MIT')});
  await generateEvidence(root);
  const lock=JSON.parse(await readFile(path.join(root,'package-lock.json'),'utf8'));
  lock.packages['node_modules/a'].version='1.0.1';
  lock.packages['node_modules/a'].resolved='https://registry.npmjs.org/pkg/-/pkg-1.0.1.tgz';
  lock.packages['node_modules/new-pkg']=entry('0.1.0','MIT');
  await writeFile(path.join(root,'package-lock.json'),JSON.stringify(lock,null,2)+'\n');
  const check=await checkEvidence(root);
  assert.equal(check.ok,false);
  const stale=check.problems.find(problem=>problem.code==='stale');
  assert.ok(stale,'a changed lockfile must fail the stale check');
  assert.match(stale.message,/sha256 changed/);
  assert.deepEqual(stale.diff.added,['new-pkg@0.1.0']);
  assert.deepEqual(stale.diff.changed,['a@1.0.1']);
  const regenerated=await generateEvidence(root);
  assert.equal(regenerated.written,true);
  assert.deepEqual(regenerated.diff.added,['new-pkg@0.1.0']);
  assert.deepEqual(regenerated.diff.changed,['a@1.0.1']);
  assert.equal((await checkEvidence(root)).ok,true);
});

test('missing license metadata fails closed and never writes a report',async t=>{
  const root=await fixture(t,{'node_modules/a':entry('1.0.0',undefined),'node_modules/b':entry('2.0.0','MIT')});
  const problems=await problemsOf(root);
  assert.deepEqual(problems.map(problem=>problem.code),['missing']);
  assert.match(problems[0].message,/node_modules\/a/);
  await assert.rejects(readFile(path.join(root,REPORT_FILE),'utf8'),/ENOENT/,'a generator failure must not leave a report behind');
  assert.equal((await checkEvidence(root)).ok,false);
});

test('unknown license expressions and placeholders are rejected',async t=>{
  for(const value of ['UNLICENSED','SEE LICENSE IN ./LICENSE.md','UNKNOWN','MIT OR','(MIT AND Zlib','MIT (Apache-2.0)','LicenseRef-Custom']) {
    const root=await fixture(t,{'node_modules/a':entry('1.0.0',value)});
    const problems=await problemsOf(root);
    assert.deepEqual(problems.map(problem=>problem.code),['unknown'],'expected unknown for '+value);
    assert.match(problems[0].message,/node_modules\/a/);
    await assert.rejects(readFile(path.join(root,REPORT_FILE),'utf8'),/ENOENT/);
  }
});

test('new unreviewed expressions fail closed until the review record changes visibly',async t=>{
  const root=await fixture(t,{'node_modules/a':entry('1.0.0','WTFPL')},{review:{'MIT':{'status':'reviewed','note':'Permissive.'}}});
  const problems=await problemsOf(root);
  const unreviewed=problems.filter(problem=>problem.code==='unreviewed');
  assert.equal(unreviewed.length,1);
  assert.match(unreviewed[0].message,/WTFPL/);
  assert.match(unreviewed[0].message,/a@1\.0\.0/);
  assert.match(unreviewed[0].message,new RegExp(REVIEW_FILE.replace(/[./]/g,'\\$&')));
  await assert.rejects(readFile(path.join(root,REPORT_FILE),'utf8'),/ENOENT/);
  await writeFile(path.join(root,REVIEW_FILE),JSON.stringify({schemaVersion:1,expressions:{'MIT':{'status':'reviewed','note':'Permissive.'},'WTFPL':{'status':'reviewed','note':'Reviewed after reading the license text.'}}},null,2)+'\n');
  assert.equal((await generateEvidence(root)).written,true);
});

test('a broken review record fails closed instead of trusting regeneration',async t=>{
  const root=await fixture(t,{'node_modules/a':entry('1.0.0','MIT')},{review:null});
  await assert.rejects(generateEvidence(root),/Missing expression review record/);
  await writeFile(path.join(root,REVIEW_FILE),JSON.stringify({schemaVersion:1,expressions:{'MIT':{'status':'reviewed','note':'   '}}})+'\n');
  await assert.rejects(checkEvidence(root),/reviewed status and note/);
});

test('AND, OR and parenthesis distinctions are preserved exactly and never split into alternatives',async t=>{
  const root=await fixture(t,{
    'node_modules/choice':entry('1.0.0','(MIT OR CC0-1.0)'),
    'node_modules/both':entry('1.0.0','(MIT AND Zlib)'),
    'node_modules/both-bare':entry('1.0.0','MIT AND Zlib'),
    'node_modules/triple':entry('1.0.0','Apache-2.0 AND LGPL-3.0-or-later AND MIT'),
    'node_modules/plain':entry('1.0.0','MIT'),
  });
  await generateEvidence(root);
  const report=JSON.parse(await readFile(path.join(root,REPORT_FILE),'utf8'));
  const byName=new Map(report.packages.map(record=>[record.name,record]));
  assert.equal(byName.get('choice').license,'(MIT OR CC0-1.0)');
  assert.equal(byName.get('both').license,'(MIT AND Zlib)');
  assert.equal(byName.get('both-bare').license,'MIT AND Zlib');
  assert.equal(byName.get('triple').license,'Apache-2.0 AND LGPL-3.0-or-later AND MIT');
  assert.deepEqual(report.summary.licenseExpressions,{'(MIT AND Zlib)':1,'(MIT OR CC0-1.0)':1,'Apache-2.0 AND LGPL-3.0-or-later AND MIT':1,'MIT':1,'MIT AND Zlib':1});
  for(const expression of ['(MIT OR CC0-1.0)','(MIT AND Zlib)','MIT AND Zlib','Apache-2.0 AND LGPL-3.0-or-later AND MIT','GPL-2.0-only WITH Classpath-exception-2.0'])assert.equal(validateExpression(expression).ok,true,expression);
  for(const expression of ['MIT AND','OR MIT','MIT OR (ISC','MIT OR CC0-1.0)','()','MIT WITH'])assert.equal(validateExpression(expression).ok,false,expression);
  assert.equal(packageNameFromPath('node_modules/x/node_modules/@scope/y'),'@scope/y');
});

test('dev, optional and platform classification is kept exactly as declared',async t=>{
  const root=await fixture(t,{
    'node_modules/prod-pkg':entry('1.0.0','MIT'),
    'node_modules/dev-pkg':entry('1.0.0','ISC',{dev:true}),
    'node_modules/opt-pkg':entry('1.0.0','Apache-2.0',{optional:true}),
    'node_modules/dev-opt-pkg':entry('1.0.0','BSD-3-Clause',{dev:true,optional:true}),
    'node_modules/@scope/native':entry('1.0.0','MIT',{optional:true,os:['darwin'],cpu:['arm64']}),
    'node_modules/string-platform':entry('1.0.0','MIT',{optional:true,os:'linux',cpu:'x64'}),
  });
  await generateEvidence(root);
  const report=JSON.parse(await readFile(path.join(root,REPORT_FILE),'utf8'));
  const byName=new Map(report.packages.map(record=>[record.name,record]));
  assert.deepEqual([byName.get('prod-pkg').dev,byName.get('prod-pkg').optional],[false,false]);
  assert.deepEqual([byName.get('dev-pkg').dev,byName.get('dev-pkg').optional],[true,false]);
  assert.deepEqual([byName.get('opt-pkg').dev,byName.get('opt-pkg').optional],[false,true]);
  assert.deepEqual([byName.get('dev-opt-pkg').dev,byName.get('dev-opt-pkg').optional],[true,true]);
  assert.deepEqual(byName.get('@scope/native').os,['darwin']);
  assert.deepEqual(byName.get('@scope/native').cpu,['arm64']);
  assert.deepEqual(byName.get('string-platform').os,'linux','string platform metadata stays as declared');
  assert.deepEqual(byName.get('string-platform').cpu,'x64');
  assert.equal('os' in byName.get('prod-pkg'),false,'platform metadata is only recorded when declared');
  assert.deepEqual(report.summary.classification,{production:1,dev:1,optional:3,devOptional:1});
  assert.equal(report.summary.platformGated,2);
  assert.equal(report.summary.packageCount,6);
});

test('resolved locations are recorded without credentials and classified by provenance',async t=>{
  const root=await fixture(t,{
    'node_modules/registry-pkg':entry('1.0.0','MIT'),
    'node_modules/credentialed':{version:'1.0.0',license:'MIT',resolved:'https://user:secret@example.test/pkg/-/pkg-1.0.0.tgz?token=abc123#frag',integrity:'sha512-x'},
    'node_modules/mirrored':{version:'1.0.0',license:'MIT',resolved:'https://registry.npmmirror.com/pkg/-/pkg-1.0.0.tgz',integrity:'sha512-y'},
    'node_modules/git-dep':{version:'1.0.0',license:'MIT',resolved:'git+https://example.test/pkg.git#v1.0.0',integrity:null},
  });
  await generateEvidence(root);
  const report=JSON.parse(await readFile(path.join(root,REPORT_FILE),'utf8'));
  const byName=new Map(report.packages.map(record=>[record.name,record]));
  assert.equal(byName.get('credentialed').resolved,'https://example.test/pkg/-/pkg-1.0.0.tgz');
  assert.equal(byName.get('mirrored').provenance,'hosted-tarball');
  assert.equal(byName.get('git-dep').provenance,'git');
  assert.equal(byName.get('registry-pkg').provenance,'npm-registry');
  assert.equal(byName.get('credentialed').provenance,'hosted-tarball','a non-npm host stays a traced hosted tarball');
  const text=await readFile(path.join(root,REPORT_FILE),'utf8');
  assert.doesNotMatch(text,/secret|abc123/,'resolved locations must never carry credentials');
  assert.equal(sanitizeResolved('https://user:secret@example.test/x.tgz?q=1'),'https://example.test/x.tgz');
  assert.equal(sanitizeResolved('not a url'),null);
  assert.equal(classifyProvenance('https://registry.npmjs.org/x.tgz'),'npm-registry');
  assert.equal(classifyProvenance(undefined),'unresolved');
});

test('the checked-in evidence matches the frozen lockfile and records every third-party package',async()=>{
  const root=path.dirname(fileURLToPath(new URL('../package-lock.json',import.meta.url)));
  const result=await checkEvidence(root);
  assert.deepEqual(result.problems.map(problem=>problem.code),[],'the checked-in report must be current and fully reviewed');
  const lockBytes=await readFile(path.join(root,'package-lock.json'));
  const lock=JSON.parse(lockBytes.toString('utf8'));
  const entries=Object.keys(lock.packages).filter(lockPath=>lockPath!=='');
  assert.equal(result.report.summary.packageCount,799);
  assert.equal(result.report.summary.packageCount,entries.length);
  assert.equal(result.report.lockfile.sha256,createHash('sha256').update(lockBytes).digest('hex'));
  assert.equal(result.report.root.license,'AGPL-3.0-only');
  assert.equal(result.report.packages.some(record=>record.path===''),false,'the AGPL root is not a third-party record');
  for(const record of result.report.packages){
    assert.ok(record.name&&record.version&&record.license,record.path+' must keep name, version and the declared expression');
    assert.equal(typeof record.dev,'boolean');
    assert.equal(typeof record.optional,'boolean');
    assert.ok(record.resolved&&record.integrity,record.path+' must keep upstream location and lock integrity');
  }
  for(const expression of ['(MIT AND Zlib)','(MIT OR CC0-1.0)','Apache-2.0 AND LGPL-3.0-or-later AND MIT','LGPL-3.0-or-later','MPL-2.0'])assert.ok(result.report.summary.licenseExpressions[expression]>0,expression);
  const analysis=await analyze(root);
  assert.equal(analysis.rendered,await readFile(path.join(root,REPORT_FILE),'utf8'));
});
