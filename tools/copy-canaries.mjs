// GET-202 real-CLI canaries for the copy guardrails.
//
// Every case builds a tiny fixture corpus and runs the actual pinned Vale and
// textlint binaries through tools/copy-lint.mjs for semantic cases. Tool-failure
// cases deliberately inject missing executables or malformed subprocess output.
// The planted negatives must fail, the warning-only run must succeed while
// keeping its warnings, and a narrow justified exception must not cover a
// changed value. This is what proves the upstream rules are really wired up:
// an empty or mis-scoped rule cannot look healthy here.
import {mkdtemp,writeFile,mkdir,readFile,rm,chmod} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {execFile} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {collectCopy,sha256} from '../scripts/copy-inventory.mjs';
import {exportCopy} from '../scripts/export-copy.mjs';
import {lintCopy,resolveLintTools} from './copy-lint.mjs';

const REPO_ROOT=path.dirname(fileURLToPath(new URL('../package.json',import.meta.url)));
const FROZEN='43187d0ecaa63aa6575700677744c7cf4b3d099e';
const LOCALES=['en','zh-Hans','zh-Hant','ja'];

function versionOf(bin){
  return new Promise(resolve=>{
    execFile(bin,['--version'],(error,stdout,stderr)=>resolve(String(stdout||stderr||'').trim().split('\n')[0]||'unknown'));
  });
}

async function fixture(values){
  const root=await mkdtemp(path.join(tmpdir(),'copy-canary-'));
  for(const locale of LOCALES){
    const rows=Object.entries(values).map(([id,byLocale])=>[id,byLocale[locale]]);
    await mkdir(path.join(root,'app/ui-catalogs'),{recursive:true});
    await writeFile(path.join(root,'app/ui-catalogs',locale+'.mjs'),'// canary fixture\nexport default Object.freeze({\n'+rows.map(([id,value])=>'  '+JSON.stringify(id)+': '+JSON.stringify(value)+',').join('\n')+'\n});\n');
  }
  const inventory=await collectCopy({root});
  const outDir=path.join(root,'build/copy');
  const exported=await exportCopy({inventory,outDir});
  return {root,inventory,exported,manifest:path.join(outDir,'manifest.json')};
}

function optionsFor({root,manifest,frozen,baseline,allowances,valeBin,textlintBin,valeConfig,textlintConfig}){
  return {
    root,manifest,frozen,
    baseline:baseline||{schemaVersion:1,frozenCommit:FROZEN,binding:'frozen-source',entries:[]},
    allowances:allowances||{schemaVersion:1,policy:'canary: none',entries:[]},
    valeBin,textlintBin,
    valeConfig:valeConfig||path.join(REPO_ROOT,'.vale.ini'),
    textlintConfig:textlintConfig||path.join(REPO_ROOT,'.textlintrc.json')
  };
}

const cases=[];
async function canary(name,expect,run){
  const result=await run();
  const failures=expect(result.report,result).filter(entry=>entry!=='');
  cases.push({name,pass:failures.length===0,failures,...(result.extra||{}),counts:result.report&&result.report.counts,toolStatus:result.report&&result.report.toolStatus,newErrors:result.report&&result.report.newErrors.map(entry=>({locale:entry.locale,itemId:entry.itemId,rule:entry.rule,match:entry.match})),warnings:(result.report&&result.report.warnings||[]).map(entry=>({locale:entry.locale,rule:entry.rule,match:entry.match})),appliedExceptions:(result.report&&result.report.appliedExceptions||[]).map(entry=>({locale:entry.locale,itemId:entry.itemId,rule:entry.rule,reason:entry.reason}))});
}

function runDirect(bin,args){
  return new Promise(resolve=>{
    execFile(bin,args,(error,stdout,stderr)=>resolve({exit:error&&typeof error.code==='number'?error.code:0,stdout:String(stdout),stderr:String(stderr)}));
  });
}

const tools=resolveLintTools({root:REPO_ROOT});
if(tools.missing.length>0){
  console.error('copy-canaries: FAIL — real lint CLIs are required (missing: '+tools.missing.join(', ')+'). Set LEAFHOUR_VALE_BIN / LEAFHOUR_TEXTLINT_BIN or install the pinned tools.');
  process.exit(1);
}

await canary('en-t1-blocked',report=>[
  report.ok===false?'':'a planted EN T1 must fail',
  report.newErrors.some(entry=>entry.locale==='en'&&entry.rule==='Leafhour.DevSpeak')?'':'the EN DevSpeak alert must be a new T1 error',
  report.toolStatus.vale.exit===1?'':'the raw Vale CLI must exit 1 on T1'
],async()=>{
  const built=await fixture({a:{en:'Retry the receipt','zh-Hans':'选择一本书','zh-Hant':'選擇一本書',ja:'本をえらぶ。'}});
  return {report:await lintCopy(optionsFor({root:built.root,manifest:built.manifest,valeBin:tools.valeBin,textlintBin:tools.textlintBin}))};
});

await canary('zh-t1-blocked',report=>[
  report.ok===false?'':'a planted ZH T1 must fail',
  report.newErrors.some(entry=>entry.locale==='zh-Hans'&&entry.rule==='Leafhour.DevSpeak')?'':'the zh-Hans DevSpeak alert must be a new T1 error',
  report.newErrors.some(entry=>entry.locale==='zh-Hant'&&entry.rule==='Leafhour.DevSpeak')?'':'the zh-Hant DevSpeak alert must be a new T1 error'
],async()=>{
  const built=await fixture({a:{en:'Choose a book.','zh-Hans':'重新提交回执','zh-Hant':'重新提交回執',ja:'本をえらぶ。'}});
  return {report:await lintCopy(optionsFor({root:built.root,manifest:built.manifest,valeBin:tools.valeBin,textlintBin:tools.textlintBin}))};
});

await canary('ja-prh-t1-blocked',report=>[
  report.ok===false?'':'a planted JA T1 must fail',
  report.newErrors.some(entry=>entry.locale==='ja'&&entry.rule==='prh')?'':'the prh alert must be a new T1 error',
  report.toolStatus.textlint.exit===1?'':'the raw textlint CLI must exit 1 on prh T1'
],async()=>{
  const built=await fixture({a:{en:'Choose a book.','zh-Hans':'选择一本书。','zh-Hant':'選擇一本書。',ja:'リクエストを送る。'}});
  return {report:await lintCopy(optionsFor({root:built.root,manifest:built.manifest,valeBin:tools.valeBin,textlintBin:tools.textlintBin}))};
});

await canary('warning-only-passes',report=>[
  report.ok===true?'':'warning-only copy must not fail the lint',
  report.newErrors.length===0?'':'no T1 may appear in warning-only copy',
  report.warnings.length>=4?'':'warnings must be retained on a successful run'
],async()=>{
  const built=await fixture({a:{en:'Read quietly.','zh-Hans':'安静地读。','zh-Hant':'安靜地讀。',ja:'確認してください！'}});
  return {report:await lintCopy(optionsFor({root:built.root,manifest:built.manifest,valeBin:tools.valeBin,textlintBin:tools.textlintBin}))};
});

await canary('clean-passes',report=>[
  report.ok===true?'':'clean copy must pass',
  report.counts.alerts===0?'':'clean copy must produce no alerts at all'
],async()=>{
  const built=await fixture({a:{en:'Choose a book.','zh-Hans':'选择一本书。','zh-Hant':'選擇一本書。',ja:'本をえらぶ。'}});
  return {report:await lintCopy(optionsFor({root:built.root,manifest:built.manifest,valeBin:tools.valeBin,textlintBin:tools.textlintBin}))};
});

await canary('narrow-justified-exception-passes',report=>[
  report.ok===true?'':'one reviewed, exactly bound exception must pass',
  report.appliedExceptions.length===1?'':'the exception must be recorded as applied evidence',
  report.appliedExceptions[0]&&report.appliedExceptions[0].reason.length>10?'':'the applied exception keeps its concrete reason'
],async()=>{
  const values={a:{en:'Choose a book','zh-Hans':'查看请求详情','zh-Hant':'選擇一本書',ja:'本をえらぶ'}};
  const built=await fixture(values);
  const allowances={schemaVersion:1,policy:'canary',entries:[{itemId:'a',locale:'zh-Hans',rule:'Leafhour.DevSpeak',valueSha256:sha256(values.a['zh-Hans']),reason:'Privacy page must name the request the reader is about to send; reviewed in GET-202 batch A.',kind:'justified-exception',state:'reviewed'}]};
  return {report:await lintCopy(optionsFor({root:built.root,manifest:built.manifest,allowances,valeBin:tools.valeBin,textlintBin:tools.textlintBin}))};
});
await canary('changed-value-negative',report=>[
  report.ok===false?'':'a changed value must lose its exception and fail',
  report.newErrors.some(entry=>entry.locale==='zh-Hans')?'':'the changed value must surface as a new T1 error',
  report.staleAllowances.length===1?'':'the old exception must be visibly stale, not silently ignored'
],async()=>{
  const original={a:{en:'Choose a book','zh-Hans':'查看请求详情','zh-Hant':'選擇一本書',ja:'本をえらぶ'}};
  const changed={a:{...original.a,'zh-Hans':'查看請求詳情'}};
  const built=await fixture(changed);
  const allowances={schemaVersion:1,policy:'canary',entries:[{itemId:'a',locale:'zh-Hans',rule:'Leafhour.DevSpeak',valueSha256:sha256(original.a['zh-Hans']),reason:'Binding reviewed against the original wording only; a changed value must re-open review.',kind:'justified-exception',state:'reviewed'}]};
  return {report:await lintCopy(optionsFor({root:built.root,manifest:built.manifest,allowances,valeBin:tools.valeBin,textlintBin:tools.textlintBin}))};
});

await canary('protected-quote-path-unchanged',report=>[
  report.ok===false?'':'the planted T1 beside a protected path/quote must still be reported',
  report.newErrors.some(entry=>entry.itemId==='a'&&entry.locale==='en'&&entry.rule==='Leafhour.DevSpeak')?'':'the alert must map back to its own multiline item'
],async()=>{
  const value='Save the receipt for "/books/样本.epub".\nThe quote stays:「存在与虚无」';
  const built=await fixture({a:{en:value,'zh-Hans':'选择一本书。','zh-Hant':'選擇一本書。',ja:'本をえらぶ。'}});
  const enText=await readFile(path.join(built.root,'build/copy/en.txt'),'utf8');
  const manifest=JSON.parse(await readFile(built.manifest,'utf8'));
  const item=manifest.items.find(entry=>entry.id==='a'&&entry.locale==='en');
  if(enText!==value+'\n'){
    throw Error('protected quote/path text changed during export');
  }
  if(!item||item.startLine!==1||item.endLine!==2||!item.protected){
    throw Error('protected multiline item lost its binding or protection label');
  }
  return {report:await lintCopy(optionsFor({root:built.root,manifest:built.manifest,valeBin:tools.valeBin,textlintBin:tools.textlintBin}))};
});

await canary('ja-prh-severity-downgrade-blocked',(report,result)=>[
  report.ok===false?'':'a downgraded prh severity must fail the lint',
  report.problems.some(problem=>/prh/.test(problem.message)&&/severity/.test(problem.message))?'':'the prh severity downgrade must be named in the problems',
  result.extra&&result.extra.downgradeCliExit===0?'':'the real textlint CLI must show that the downgraded config hides the planted JA T1'
],async()=>{
  const values={a:{en:'Choose a book.','zh-Hans':'选择一本书。','zh-Hant':'選擇一本書。',ja:'リクエストを送る。'}};
  const built=await fixture(values);
  const originalRules=JSON.parse(await readFile(path.join(REPO_ROOT,'.textlintrc.json'),'utf8')).rules;
  const downgraded={rules:{...originalRules,prh:{rulePaths:[path.join(REPO_ROOT,'.textlint/prh.yml')],severity:'warning'}}};
  const configPath=path.join(built.root,'downgraded-textlintrc.json');
  await writeFile(configPath,JSON.stringify(downgraded,null,2)+'\n');
  const report=await lintCopy(optionsFor({root:built.root,manifest:built.manifest,textlintConfig:configPath,valeBin:tools.valeBin,textlintBin:tools.textlintBin}));
  const raw=await runDirect(tools.textlintBin,['--config',configPath,'--format','json',path.join(built.root,'build/copy/ja.txt')]);
  return {report,extra:{downgradeCliExit:raw.exit}};
});

await canary('missing-tool-fails-closed',report=>[
  report.ok===false?'':'a missing tool must never look like a passing lint',
  report.problems.some(problem=>/missing/i.test(problem.message))?'':'the missing tool must be named in the problems'
],async()=>{
  const built=await fixture({a:{en:'Choose a book.','zh-Hans':'选择一本书。','zh-Hant':'選擇一本書。',ja:'本をえらぶ。'}});
  return {report:await lintCopy(optionsFor({root:built.root,manifest:built.manifest,valeBin:path.join(REPO_ROOT,'no-such-vale'),textlintBin:tools.textlintBin}))};
});

await canary('malformed-tool-output-fails-closed',report=>[
  report.ok===false?'':'malformed tool output must fail closed',
  report.problems.some(problem=>/malformed|empty/i.test(problem.message))?'':'the malformed result must be reported'
],async()=>{
  const built=await fixture({a:{en:'Choose a book.','zh-Hans':'选择一本书。','zh-Hant':'選擇一本書。',ja:'本をえらぶ。'}});
  const fake=path.join(built.root,'fake-vale');
  await writeFile(fake,'#!/usr/bin/env node\nprocess.stdout.write("not json");\n');
  await chmod(fake,0o755);
  return {report:await lintCopy(optionsFor({root:built.root,manifest:built.manifest,valeBin:fake,textlintBin:tools.textlintBin}))};
});

const rules=new Set();
for(const entry of cases)for(const list of [entry.newErrors||[],entry.warnings||[],entry.appliedExceptions||[]])for(const alert of list)if(alert.rule)rules.add(alert.rule);
const receipt={
  mode:'GET-202 real pinned CLI canaries; not rendered product acceptance',
  tools:{vale:await versionOf(tools.valeBin),textlint:await versionOf(tools.textlintBin),valeBin:tools.valeBin,textlintBin:tools.textlintBin},
  coverage:{cases:cases.length,rulesExercised:[...rules].sort()},
  cases,
  pass:cases.every(entry=>entry.pass)
};
console.log(JSON.stringify(receipt,null,2));
process.exitCode=receipt.pass?0:1;
