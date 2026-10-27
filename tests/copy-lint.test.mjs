import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,mkdir,readFile,rm,chmod} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {collectCopy,sha256} from '../scripts/copy-inventory.mjs';
import {exportCopy} from '../scripts/export-copy.mjs';
import {lintCopy,resolveLintTools,validateDebtBindings,checkTextlintConfig} from '../tools/copy-lint.mjs';

const REPO_ROOT=path.dirname(fileURLToPath(new URL('../package.json',import.meta.url)));
const FROZEN='43187d0ecaa63aa6575700677744c7cf4b3d099e';
const tools=resolveLintTools({root:REPO_ROOT});
const realCliSkip=tools.missing.length>0
  ? 'lint CLIs unavailable ('+tools.missing.join(', ')+'); the real-CLI planted negatives run in tools/copy-canaries.mjs and in the copy checks in CI'
  : false;

async function corpusFixture(t,values,{files={},reviews=[]}={}){
  const root=await mkdtemp(path.join(tmpdir(),'copy-lint-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const locales=['en','zh-Hans','zh-Hant','ja'];
  for(const locale of locales){
    const rows=Object.entries(values).map(([id,byLocale])=>[id,byLocale[locale]]);
    const source='// fixture\nexport default Object.freeze({\n'+rows.map(([id,value])=>'  '+JSON.stringify(id)+': '+JSON.stringify(value)+',').join('\n')+'\n});\n';
    await mkdir(path.join(root,'app/ui-catalogs'),{recursive:true});
    await writeFile(path.join(root,'app/ui-catalogs',locale+'.mjs'),source);
  }
  for(const [file,content] of Object.entries(files)){
    await mkdir(path.dirname(path.join(root,file)),{recursive:true});
    await writeFile(path.join(root,file),content);
  }
  const inventory=await collectCopy({root});
  const outDir=path.join(root,'build/copy');
  await exportCopy({inventory,outDir,reviews});
  return {root,inventory,manifest:path.join(outDir,'manifest.json')};
}
function frozenFrom(values){
  const catalogues={};
  for(const locale of ['en','zh-Hans','zh-Hant','ja']){
    catalogues[locale]=Object.fromEntries(Object.entries(values).map(([id,byLocale])=>[id,byLocale[locale]]));
  }
  return {catalogues};
}
function baselineOf(values,rows){
  return {
    schemaVersion:1,
    frozenCommit:FROZEN,
    binding:'frozen-source',
    entries:rows.map(([id,locale,rule])=>({
      itemId:id,locale,rule,valueSha256:sha256(values[id][locale]),match:'',kind:'existing-debt',state:'unreviewed'
    }))
  };
}
function allowanceOf(values,rows){
  return {
    schemaVersion:1,
    policy:'Exact item + locale + rule + value hash with a concrete reason; never page-wide.',
    entries:rows.map(([id,locale,rule,reason])=>({
      itemId:id,locale,rule,valueSha256:sha256(values[id][locale]),reason,kind:'justified-exception',state:'reviewed'
    }))
  };
}
const lintOptions=({root,manifest,frozen,baseline,allowances})=>({
  root,manifest,frozen,
  baseline:baseline||{schemaVersion:1,frozenCommit:FROZEN,binding:'frozen-source',entries:[]},
  allowances:allowances||{schemaVersion:1,policy:'none',entries:[]},
  valeBin:tools.valeBin,textlintBin:tools.textlintBin,
  valeConfig:path.join(REPO_ROOT,'.vale.ini'),
  textlintConfig:path.join(REPO_ROOT,'.textlintrc.json')
});

const cleanValues={
  a:{en:'Choose a book','zh-Hans':'选择一本书','zh-Hant':'選擇一本書','ja':'本をえらぶ'}
};

test('a newly introduced T1 fails the lint while its alerts stay visible',{skip:realCliSkip},async t=>{
  const values={
    a:{en:'Retry the receipt','zh-Hans':'重新提交回执','zh-Hant':'重新提交回執',ja:'リクエストを送る'}
  };
  const {root,manifest}=await corpusFixture(t,values);
  const report=await lintCopy(lintOptions({root,manifest,frozen:frozenFrom(values)}));
  const rules=report.newErrors.map(entry=>entry.rule);
  assert.ok(rules.includes('Leafhour.DevSpeak'),'EN/ZH dev-speak is a T1 error');
  assert.ok(rules.includes('prh'),'JA dev-speak is a prh T1 error');
  assert.equal(report.ok,false);
  assert.ok(report.newErrors.length>=4,JSON.stringify(report.newErrors));
  for(const error of report.newErrors){
    assert.ok(error.itemId&&error.locale&&error.match!==undefined&&error.message,'every failed alert keeps its evidence');
  }
});

test('warning-only copy still succeeds and keeps every warning visible',{skip:realCliSkip},async t=>{
  const values={
    a:{en:'Read quietly.','zh-Hans':'安静地读。','zh-Hant':'安靜地讀。',ja:'確認してください！'}
  };
  const {root,manifest}=await corpusFixture(t,values);
  const report=await lintCopy(lintOptions({root,manifest,frozen:frozenFrom(values)}));
  assert.equal(report.ok,true,'T2/T3 severity must never block');
  assert.equal(report.newErrors.length,0,JSON.stringify(report.newErrors));
  assert.ok(report.warnings.length>=4,'warnings are retained, not dropped: '+JSON.stringify(report.warnings.map(entry=>entry.rule)));
  assert.ok(report.warnings.every(entry=>entry.severity==='warning'));
  assert.ok(report.warnings.every(entry=>entry.itemId&&entry.locale),'warnings map back to their item');
});

test('unchanged documented debt passes but stays separately visible',{skip:realCliSkip},async t=>{
  const values={
    a:{en:'Retry the receipt','zh-Hans':'选择一本书','zh-Hant':'選擇一本書',ja:'本をえらぶ'}
  };
  const {root,manifest}=await corpusFixture(t,values);
  const baseline=baselineOf(values,[['a','en','Leafhour.DevSpeak']]);
  const report=await lintCopy(lintOptions({root,manifest,frozen:frozenFrom(values),baseline}));
  assert.equal(report.ok,true);
  assert.equal(report.newErrors.length,0,JSON.stringify(report.newErrors));
  assert.equal(report.existingDebt.length,1);
  assert.equal(report.existingDebt[0].state,'unreviewed','existing debt is never dressed up as a justified exception');
  assert.equal(report.existingDebt[0].itemId,'a');
  assert.equal(report.appliedExceptions.length,0);
});

test('a changed value or another locale loses its debt binding and fails',{skip:realCliSkip},async t=>{
  const values={
    a:{en:'Retry the receipt','zh-Hans':'选择一本书','zh-Hant':'選擇一本書',ja:'本をえらぶ'}
  };
  const frozen=frozenFrom(values);
  const baseline=baselineOf(values,[['a','en','Leafhour.DevSpeak'],['a','zh-Hant','Leafhour.DevSpeak']]);
  const changed={
    ...values,
    a:{...values.a,en:'Request the receipt again','zh-Hant':'選擇一本書'}
  };
  const {root,manifest}=await corpusFixture(t,changed);
  const report=await lintCopy(lintOptions({root,manifest,frozen,baseline}));
  assert.equal(report.ok,false);
  assert.equal(report.existingDebt.length,0,'a changed value cannot ride an old binding');
  assert.ok(report.newErrors.some(entry=>entry.locale==='en'&&entry.itemId==='a'),'the changed EN value is a new T1');
  assert.ok(report.staleDebt.some(entry=>entry.locale==='zh-Hant'),'an alert-free stale binding must be pruned after review');
});

test('a narrow exception binds exactly one item, locale, rule and value',{skip:realCliSkip},async t=>{
  const values={
    a:{en:'Choose a book','zh-Hans':'查看请求详情','zh-Hant':'選擇一本書',ja:'本をえらぶ'}
  };
  const {root,manifest}=await corpusFixture(t,values);
  const allowances=allowanceOf(values,[['a','zh-Hans','Leafhour.DevSpeak','Privacy page must name the request the reader is about to send; documented in GET-202 review.']]);
  const report=await lintCopy(lintOptions({root,manifest,frozen:frozenFrom(values),allowances}));
  assert.equal(report.ok,true,'one reviewed exception may pass');
  assert.equal(report.appliedExceptions.length,1);
  assert.equal(report.appliedExceptions[0].itemId,'a');
  assert.equal(report.appliedExceptions[0].locale,'zh-Hans');
  assert.ok(report.appliedExceptions[0].reason.length>10);
  assert.ok(report.warnings.concat(report.existingDebt,report.appliedExceptions).length>0,'suppressed evidence is retained');

  const sibling={
    a:{en:'Choose a book','zh-Hans':'查看请求详情','zh-Hant':'查看請求詳情',ja:'本をえらぶ'}
  };
  const other=await corpusFixture(t,sibling);
  const siblingReport=await lintCopy(lintOptions({root:other.root,manifest:other.manifest,frozen:frozenFrom(sibling),allowances}));
  assert.equal(siblingReport.ok,false,'the same wording in another locale stays blocked');
  assert.ok(siblingReport.newErrors.some(entry=>entry.locale==='zh-Hant'));
  assert.equal(siblingReport.appliedExceptions.length,1,'the exception keeps covering only its own binding');
});

test('a stale exception fails the run instead of covering silently',{skip:realCliSkip},async t=>{
  const values={
    a:{en:'Choose a book','zh-Hans':'选择一本书','zh-Hant':'選擇一本書',ja:'本をえらぶ'}
  };
  const {root,manifest}=await corpusFixture(t,values);
  const allowances=allowanceOf(values,[['a','zh-Hans','Leafhour.DevSpeak','A reason that no longer matches any alert.']]);
  const report=await lintCopy(lintOptions({root,manifest,frozen:frozenFrom(values),allowances}));
  assert.equal(report.ok,false);
  assert.equal(report.staleAllowances.length,1);
  assert.equal(report.appliedExceptions.length,0);
});

test('a missing tool fails closed',{skip:false},async t=>{
  const {root,manifest}=await corpusFixture(t,cleanValues);
  const report=await lintCopy({...lintOptions({root,manifest,frozen:frozenFrom(cleanValues)}),valeBin:path.join(root,'no-such-vale')});
  assert.equal(report.ok,false);
  assert.ok(report.problems.some(problem=>/vale/i.test(problem.message)&&/missing|not found|ENOENT/i.test(problem.message)),JSON.stringify(report.problems));
  assert.equal(report.toolStatus.vale.ok,false);
});

test('malformed and empty tool output fails closed',{skip:false},async t=>{
  const {root,manifest}=await corpusFixture(t,cleanValues);
  for(const body of ['this is not json\n','']){
    const fake=path.join(root,'fake-vale-'+Buffer.from(body).toString('hex').slice(0,8));
    await writeFile(fake,'#!/usr/bin/env node\nprocess.stdout.write('+JSON.stringify(body)+');\n');
    await chmod(fake,0o755);
    const report=await lintCopy({...lintOptions({root,manifest,frozen:frozenFrom(cleanValues)}),valeBin:fake});
    assert.equal(report.ok,false,'tool output must be parsed evidence: '+JSON.stringify(body));
    assert.ok(report.problems.some(problem=>/malformed|empty/i.test(problem.message)),JSON.stringify(report.problems));
  }
});

test('an empty corpus and an unsupported locale fail closed',{skip:false},async t=>{
  const {root,manifest}=await corpusFixture(t,cleanValues);
  const empty=path.join(root,'empty-manifest.json');
  await writeFile(empty,JSON.stringify({schemaVersion:1,locales:['en'],files:{},items:[],counts:{}}));
  const emptyReport=await lintCopy({...lintOptions({root,manifest:empty,frozen:frozenFrom(cleanValues)})});
  assert.equal(emptyReport.ok,false);
  assert.ok(emptyReport.problems.some(problem=>/empty/i.test(problem.message)),JSON.stringify(emptyReport.problems));

  const unsupported=path.join(root,'fr-manifest.json');
  const real=JSON.parse(await readFile(manifest,'utf8'));
  await writeFile(unsupported,JSON.stringify({...real,locales:['fr'],files:{fr:{file:'fr.txt',lines:1}},items:real.items.map(entry=>({...entry,locale:'fr',file:'fr.txt'}))}));
  const unsupportedReport=await lintCopy({...lintOptions({root,manifest:unsupported,frozen:frozenFrom(cleanValues)})});
  assert.equal(unsupportedReport.ok,false);
  assert.ok(unsupportedReport.problems.some(problem=>/locale/i.test(problem.message)),JSON.stringify(unsupportedReport.problems));
});

test('a baseline entry must bind a value that existed at the frozen revision',async()=>{
  const values={
    a:{en:'Retry the receipt','zh-Hans':'选择一本书','zh-Hant':'選擇一本書',ja:'本をえらぶ'}
  };
  const frozen=frozenFrom(values);
  const forged={
    schemaVersion:1,frozenCommit:FROZEN,binding:'frozen-source',
    entries:[{itemId:'a',locale:'en',rule:'Leafhour.DevSpeak',valueSha256:sha256('Request the receipt again'),match:'',kind:'existing-debt',state:'unreviewed'}]
  };
  const checked=await validateDebtBindings({baseline:forged,frozen});
  assert.equal(checked.ok,false,'newly worded T1 must not self-whitelist');
  assert.ok(checked.problems.some(problem=>/frozen/i.test(problem.message)),JSON.stringify(checked.problems));
  const honest=await validateDebtBindings({baseline:{...forged,entries:forged.entries.map(entry=>({...entry,valueSha256:sha256(values.a.en)}))},frozen});
  assert.equal(honest.ok,true);
  const wrongRevision=await validateDebtBindings({baseline:{...forged,frozenCommit:'e'.repeat(40),entries:[]},frozen});
  assert.equal(wrongRevision.ok,false,'the baseline must name the frozen revision it binds to');
  assert.ok(wrongRevision.problems.some(problem=>/frozen/i.test(problem.message)));
});

test('the JA textlint config freezes every preset rule at explicit warning severity',()=>{
  const preset={rules:{'rule-one':{},'rule-two':{}}};
  const config={
    rules:{
      prh:{rulePaths:['.textlint/prh.yml']},
      'preset-ja-technical-writing':{'rule-one':{severity:'warning'},'rule-two':{severity:'warning'}}
    }
  };
  assert.deepEqual(checkTextlintConfig({config,preset}).problems,[]);
  const withPrh=rules=>({rules:{prh:{rulePaths:['.textlint/prh.yml']},'preset-ja-technical-writing':rules}});
  const missing=checkTextlintConfig({config:withPrh({'rule-one':{severity:'warning'}}),preset});
  assert.ok(missing.problems.some(problem=>/rule-two/.test(problem.message)),'a missing nested rule must fail, not disappear');
  const unknown=checkTextlintConfig({config:withPrh({'rule-one':{severity:'warning'},'rule-three':{severity:'warning'}}),preset});
  assert.ok(unknown.problems.some(problem=>/rule-three/.test(problem.message)),'an unknown nested rule must fail');
  const wrongSeverity=checkTextlintConfig({config:withPrh({'rule-one':{severity:'warning'},'rule-two':{severity:'error'}}),preset});
  assert.ok(wrongSeverity.problems.some(problem=>/severity/.test(problem.message)),'preset severity must stay explicit warnings');
  const noPrh=checkTextlintConfig({config:{rules:{'preset-ja-technical-writing':{'rule-one':{severity:'warning'},'rule-two':{severity:'warning'}}}},preset});
  assert.ok(noPrh.problems.some(problem=>/prh/.test(problem.message)),'prh T1 rules must stay configured');
});

test('the copy-lint CLI reports warnings on success and fails on new T1',{skip:realCliSkip},async t=>{
  const values={
    a:{en:'Read quietly.','zh-Hans':'安静地读。','zh-Hant':'安靜地讀。',ja:'確認してください！'}
  };
  const {root,manifest}=await corpusFixture(t,values);
  const run=await runCli(root,manifest);
  assert.equal(run.code,0,run.output);
  const report=JSON.parse(await readFile(path.join(root,'build/copy/lint-report.json'),'utf8'));
  assert.ok(report.warnings.length>=4,'a successful warning-only run keeps its warnings');
  assert.equal(report.ok,true);

  const planted={
    a:{en:'Retry the receipt','zh-Hans':'重新提交回执','zh-Hant':'重新提交回執',ja:'リクエストを送る'}
  };
  const fixture=await corpusFixture(t,planted);
  const failing=await runCli(fixture.root,fixture.manifest);
  assert.equal(failing.code,1,failing.output);
  assert.match(failing.output,/T1|error/i);
});

test('changed export bytes with an old manifest fail as inventory, never as documented debt',{skip:realCliSkip},async t=>{
  const values={
    a:{en:'Retry the receipt','zh-Hans':'选择一本书。','zh-Hant':'選擇一本書。',ja:'本をえらぶ。'}
  };
  const {root,manifest}=await corpusFixture(t,values);
  const baseline=baselineOf(values,[['a','en','Leafhour.DevSpeak']]);
  await writeFile(path.join(root,'build/copy/en.txt'),'A newly changed receipt\n');
  const report=await lintCopy(lintOptions({root,manifest,frozen:frozenFrom(values),baseline}));
  assert.equal(report.ok,false,'different bytes must never ride the old binding');
  assert.equal(report.existingDebt.length,0,JSON.stringify(report.existingDebt));
  assert.equal(report.appliedExceptions.length,0);
  assert.ok(report.problems.some(problem=>/hash|content/i.test(problem.message)),JSON.stringify(report.problems));
});

test('a second locale-matching file cannot borrow the first item exception',{skip:realCliSkip},async t=>{
  const values={
    a:{en:'Retry the receipt','zh-Hans':'选择一本书。','zh-Hant':'選擇一本書。',ja:'本をえらぶ。'}
  };
  const {root,manifest}=await corpusFixture(t,values);
  const parsed=JSON.parse(await readFile(manifest,'utf8'));
  await mkdir(path.join(root,'build/copy/second'),{recursive:true});
  await writeFile(path.join(root,'build/copy/second/en.txt'),'A second receipt\n');
  parsed.items.push({id:'b',locale:'en',file:'second/en.txt',startLine:1,endLine:1,sha256:sha256('A second receipt'),protected:null,kind:'catalogue'});
  await writeFile(manifest,JSON.stringify(parsed,null,2)+'\n');
  const allowances=allowanceOf(values,[['a','en','Leafhour.DevSpeak','Toolbar label for the saved receipt record only; never a second file.']]);
  const report=await lintCopy(lintOptions({root,manifest,frozen:frozenFrom(values),allowances}));
  assert.equal(report.ok,false);
  assert.ok(report.newErrors.some(entry=>entry.itemId==='b'&&entry.sourceFile==='second/en.txt'),JSON.stringify(report.newErrors));
  assert.equal(report.appliedExceptions.filter(entry=>entry.itemId==='a').length,1);
  assert.equal(report.appliedExceptions.filter(entry=>entry.itemId==='b').length,0,'file identity must survive alert binding');
});

test('structured but empty tool results fail closed',{skip:false},async t=>{
  const {root,manifest}=await corpusFixture(t,cleanValues);
  const fakeVale=path.join(root,'vale-exit1-empty');
  await writeFile(fakeVale,'#!/usr/bin/env node\nprocess.stdout.write("{}");\nprocess.exitCode=1;\n');
  await chmod(fakeVale,0o755);
  const valeReport=await lintCopy({...lintOptions({root,manifest,frozen:frozenFrom(cleanValues)}),valeBin:fakeVale});
  assert.equal(valeReport.ok,false,'exit 1 with zero alerts is an inconsistent tool result');
  assert.ok(valeReport.problems.some(problem=>/inconsistent/i.test(problem.message)),JSON.stringify(valeReport.problems));

  const fakeTextlint=path.join(root,'textlint-exit1-empty');
  await writeFile(fakeTextlint,'#!/usr/bin/env node\nprocess.stdout.write("[]");\nprocess.exitCode=1;\n');
  await chmod(fakeTextlint,0o755);
  const textlintReport=await lintCopy({...lintOptions({root,manifest,frozen:frozenFrom(cleanValues)}),textlintBin:fakeTextlint});
  assert.equal(textlintReport.ok,false,'exit 1 with no file results on a non-empty corpus fails closed');
  assert.ok(textlintReport.problems.some(problem=>/inconsistent|did not report/i.test(problem.message)),JSON.stringify(textlintReport.problems));
});

test('textlint must report every requested file exactly once with a valid severity',{skip:false},async t=>{
  const values={
    a:{en:'Choose a book.','zh-Hans':'选择一本书。','zh-Hant':'選擇一本書。',ja:'本をえらぶ。'}
  };
  const {root,manifest}=await corpusFixture(t,values);
  const parsed=JSON.parse(await readFile(manifest,'utf8'));
  await mkdir(path.join(root,'build/copy/second'),{recursive:true});
  await writeFile(path.join(root,'build/copy/second/ja.txt'),'本をえらぶ。\n');
  parsed.items.push({id:'b',locale:'ja',file:'second/ja.txt',startLine:1,endLine:1,sha256:sha256('本をえらぶ。'),protected:null,kind:'catalogue'});
  await writeFile(manifest,JSON.stringify(parsed,null,2)+'\n');
  const script='#!/usr/bin/env node\nconst files=process.argv.slice(2).filter(argument=>argument.endsWith(".txt"));\n';
  const fakeMissing=path.join(root,'textlint-missing-file');
  await writeFile(fakeMissing,script+'process.stdout.write(JSON.stringify([{filePath:files[0],messages:[]}]));\n');
  await chmod(fakeMissing,0o755);
  const missingReport=await lintCopy({...lintOptions({root,manifest,frozen:frozenFrom(values)}),textlintBin:fakeMissing});
  assert.equal(missingReport.ok,false);
  assert.ok(missingReport.problems.some(problem=>/did not report/i.test(problem.message)),JSON.stringify(missingReport.problems));

  const fakeDuplicate=path.join(root,'textlint-duplicate-file');
  await writeFile(fakeDuplicate,script+'process.stdout.write(JSON.stringify([{filePath:files[0],messages:[]},{filePath:files[0],messages:[]}]));\n');
  await chmod(fakeDuplicate,0o755);
  const duplicateReport=await lintCopy({...lintOptions({root,manifest,frozen:frozenFrom(values)}),textlintBin:fakeDuplicate});
  assert.equal(duplicateReport.ok,false);
  assert.ok(duplicateReport.problems.some(problem=>/duplicate|already reported/i.test(problem.message)),JSON.stringify(duplicateReport.problems));

  const fakeSeverity=path.join(root,'textlint-bad-severity');
  await writeFile(fakeSeverity,script+'process.stdout.write(JSON.stringify(files.map(file=>({filePath:file,messages:[{ruleId:"prh",severity:7,line:1,range:[0,1],message:"synthetic invalid severity"}]}))));\n');
  await chmod(fakeSeverity,0o755);
  const severityReport=await lintCopy({...lintOptions({root,manifest,frozen:frozenFrom(values)}),textlintBin:fakeSeverity});
  assert.equal(severityReport.ok,false);
  assert.ok(severityReport.problems.some(problem=>/severity/i.test(problem.message)),JSON.stringify(severityReport.problems));
});

test('the JA prh T1 severity cannot be downgraded by configuration',()=>{
  const preset={rules:{'rule-one':{},'rule-two':{}}};
  const presetConfig={'rule-one':{severity:'warning'},'rule-two':{severity:'warning'}};
  for(const severity of ['warning','info','off']){
    const config={rules:{prh:{rulePaths:['.textlint/prh.yml'],severity},'preset-ja-technical-writing':presetConfig}};
    const result=checkTextlintConfig({config,preset});
    assert.ok(result.problems.some(problem=>/prh/.test(problem.message)&&/severity/.test(problem.message)),severity+' must be rejected');
  }
  for(const prh of [{rulePaths:['.textlint/prh.yml']},{rulePaths:['.textlint/prh.yml'],severity:'error'}]){
    const result=checkTextlintConfig({config:{rules:{prh,'preset-ja-technical-writing':presetConfig}},preset});
    assert.deepEqual(result.problems,[],JSON.stringify(prh));
  }
});

test('a downgraded prh configuration fails even when the real JA corpus still has T1',{skip:realCliSkip},async t=>{
  const values={
    a:{en:'Choose a book.','zh-Hans':'选择一本书。','zh-Hant':'選擇一本書。',ja:'リクエストを送る。'}
  };
  const {root,manifest}=await corpusFixture(t,values);
  const originalRules=JSON.parse(await readFile(path.join(REPO_ROOT,'.textlintrc.json'),'utf8')).rules;
  const downgraded={rules:{...originalRules,prh:{rulePaths:[path.join(REPO_ROOT,'.textlint/prh.yml')],severity:'warning'}}};
  const configPath=path.join(root,'downgraded-textlintrc.json');
  await writeFile(configPath,JSON.stringify(downgraded,null,2)+'\n');
  const report=await lintCopy({...lintOptions({root,manifest,frozen:frozenFrom(values)}),textlintConfig:configPath});
  assert.equal(report.ok,false);
  assert.ok(report.problems.some(problem=>/prh/.test(problem.message)&&/severity/.test(problem.message)),JSON.stringify(report.problems));
});

test('only explicitly reviewed static literals join the lint corpus',{skip:realCliSkip},async t=>{
  const values={
    a:{en:'Choose a book.','zh-Hans':'选择一本书。','zh-Hant':'選擇一本書。',ja:'本をえらぶ。'}
  };
  const fixtureRoot=await corpusFixture(t,values,{files:{'app/view.mjs':'label.textContent="Save your receipt";\nnode.textContent="retry the receipt now";\n'},reviews:[]});
  const inventory=fixtureRoot.inventory;
  const reviewed=inventory.candidates.find(entry=>entry.value==='Save your receipt');
  const unknown=inventory.candidates.find(entry=>entry.value==='retry the receipt now');
  await exportCopy({inventory,outDir:path.dirname(fixtureRoot.manifest),reviews:[{candidateId:reviewed.id,locale:'en',valueSha256:reviewed.sha256,by:'agent',sourceSha256:inventory.source.inputs.find(input=>input.file===reviewed.file).sha256,surface:'reader toolbar',trigger:'after an AI translation saves',rationale:'Adjudicated as visible toolbar copy in GET-202 batch A review record.',state:'reviewed'}]});
  const report=await lintCopy(lintOptions({root:fixtureRoot.root,manifest:fixtureRoot.manifest,frozen:frozenFrom(values)}));
  assert.equal(report.ok,false,'the reviewed literal carries a planted T1 and must be linted');
  assert.ok(report.newErrors.some(entry=>entry.itemId===reviewed.id&&entry.rule==='Leafhour.DevSpeak'),JSON.stringify(report.newErrors));
  assert.equal(report.newErrors.some(entry=>entry.itemId===unknown.id),false,'unknown candidates never enter the corpus silently');
  assert.equal(report.alerts.some(entry=>entry.itemId===unknown.id),false);
});

test('lexical aliases cannot map the same physical line twice or borrow its exception',{skip:realCliSkip},async t=>{
  const values={a:{...cleanValues.a,en:'Retry the receipt'}};
  const {root,manifest}=await corpusFixture(t,values);
  const allowances=allowanceOf(values,[['a','en','Leafhour.DevSpeak','Synthetic exact exception for this item only, not any alias item.']]);
  const options=lintOptions({root,manifest,frozen:frozenFrom(values),allowances});
  const positive=await lintCopy(options);
  assert.equal(positive.ok,true,JSON.stringify(positive.problems));
  assert.equal(positive.appliedExceptions.length,1);
  const parsed=JSON.parse(await readFile(manifest,'utf8'));
  parsed.items.push({...parsed.items.find(entry=>entry.locale==='en'),id:'alias-item',file:'./en.txt'});
  await writeFile(manifest,JSON.stringify(parsed));
  const negative=await lintCopy(options);
  assert.equal(negative.ok,false,'alias overlap must fail before applying an exception twice');
  assert.ok(negative.problems.some(entry=>/maps to both/.test(entry.message)),JSON.stringify(negative.problems));
});

function runCli(root,manifest){
  return (async()=>{
    await mkdir(path.join(root,'tools'),{recursive:true});
    const baselinePath=path.join(root,'tools/copy-lint-debt.json');
    const allowancesPath=path.join(root,'tools/copy-lint-allowances.json');
    await writeFile(baselinePath,JSON.stringify({schemaVersion:1,frozenCommit:FROZEN,binding:'frozen-source',entries:[]},null,2)+'\n');
    await writeFile(allowancesPath,JSON.stringify({schemaVersion:1,policy:'fixture: none',entries:[]},null,2)+'\n');
    return new Promise(resolve=>{
      const child=spawn(process.execPath,[
        path.join(REPO_ROOT,'tools/copy-lint.mjs'),'--root',root,'--manifest',manifest,
        '--vale-config',path.join(REPO_ROOT,'.vale.ini'),
        '--textlint-config',path.join(REPO_ROOT,'.textlintrc.json'),
        '--baseline',baselinePath,
        '--allowances',allowancesPath
      ],{
        env:{...process.env,LEAFHOUR_VALE_BIN:tools.valeBin||'',LEAFHOUR_TEXTLINT_BIN:tools.textlintBin||''}
      });
      let output='';
      child.stdout.on('data',chunk=>output+=chunk);
      child.stderr.on('data',chunk=>output+=chunk);
      child.on('close',code=>resolve({code,output}));
    });
  })();
}
