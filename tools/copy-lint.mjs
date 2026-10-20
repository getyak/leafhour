// GET-202 copy lint: run the real pinned Vale and textlint CLIs over the
// exported copy corpus and classify every raw alert with exact evidence.
//
// Exit contract (CLI): 1 for new unexcepted T1 alerts, tool/config/inventory
// failures, stale debt or stale allowances; 0 for warning-only runs or runs
// whose T1 alerts are exactly the frozen documented debt / narrow reviewed
// exceptions. Warnings and existing debt are always retained and reported —
// a successful run never hides them.
//
// This tool is read-only: it can never regenerate tools/copy-lint-debt.json or
// tools/copy-lint-allowances.json. The debt baseline is bound to values that
// existed at the frozen source revision (git object reads), so newly worded T1
// cannot whitelist itself; maintenance is manual pruning after review.
import {readFile,writeFile,access} from 'node:fs/promises';
import {accessSync,constants as fsConstants} from 'node:fs';
import {execFile,execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {sha256,parseCatalogue,FROZEN_SOURCE_COMMIT,UI_LOCALES} from '../scripts/copy-inventory.mjs';

const TOOL_BY_LOCALE=Object.freeze({en:'vale','zh-Hans':'vale','zh-Hant':'vale',ja:'textlint'});
const HEX64=/^[a-f0-9]{64}$/;

function problem(code,message){return {code,message};}

export function resolveLintTools({root,env=process.env}={}){
  const base=path.resolve(root||'.');
  const missing=[];
  const candidates={
    vale:[env.LEAFHOUR_VALE_BIN,path.join(base,'tools/copy-tooling/vale-bin/vale'),path.join(base,'node_modules/.bin/vale')].filter(Boolean),
    textlint:[env.LEAFHOUR_TEXTLINT_BIN,path.join(base,'tools/copy-tooling/node_modules/.bin/textlint'),path.join(base,'node_modules/.bin/textlint')].filter(Boolean)
  };
  const resolved={};
  for(const [tool,paths] of Object.entries(candidates)){
    const found=paths.find(candidate=>{
      try{accessSync(candidate,fsConstants.X_OK);return true;}catch{return false;}
    });
    resolved[tool+'Bin']=found||paths[0]||null;
    if(!found)missing.push(tool);
  }
  return {...resolved,missing};
}

export function checkTextlintConfig({config,preset}){
  const problems=[];
  const rules=config&&config.rules;
  if(!rules||typeof rules!=='object')return {problems:[problem('config','textlint config has no rules section')]};
  const prh=rules.prh;
  if(!prh||typeof prh!=='object'||!Array.isArray(prh.rulePaths)||prh.rulePaths.length===0){
    problems.push(problem('config','textlint config must keep prh T1 rules configured with rulePaths'));
  }else if(prh.severity!==undefined&&prh.severity!=='error'){
    problems.push(problem('config','prh T1 severity must stay error, found '+JSON.stringify(prh.severity)+'; a downgrade would silently unblock JA T1'));
  }
  const presetConfig=rules['preset-ja-technical-writing'];
  const presetRules=preset&&preset.rules;
  if(!presetConfig||typeof presetConfig!=='object'){
    problems.push(problem('config','textlint config must configure the ja-technical-writing preset'));
    return {problems};
  }
  if(!presetRules||typeof presetRules!=='object'){
    problems.push(problem('config','the installed ja-technical-writing preset exposes no rules; refusing to guess'));
    return {problems};
  }
  for(const name of Object.keys(presetRules)){
    const entry=presetConfig[name];
    if(!entry||typeof entry!=='object'){
      problems.push(problem('config','preset rule '+name+' is not configured; unconfigured preset rules default to error severity'));
      continue;
    }
    if(entry.severity!=='warning'){
      problems.push(problem('config','preset rule '+name+' must carry an explicit warning severity (parent preset severity does not propagate)'));
    }
  }
  for(const name of Object.keys(presetConfig)){
    if(!(name in presetRules))problems.push(problem('config','unknown preset rule '+name+' would silently disappear'));
  }
  return {problems};
}

function loadPresetFrom(textlintBin){
  try{
    const nodeModulesDir=path.dirname(path.dirname(textlintBin));
    const requireFromTool=createRequire(textlintBin);
    const loaded=requireFromTool(path.join(nodeModulesDir,'textlint-rule-preset-ja-technical-writing'));
    const preset=loaded&&loaded.default?loaded.default:loaded;
    return preset&&preset.rules?{preset,problems:[]}:{preset:null,problems:[problem('config','the installed ja-technical-writing preset exposes no rules')]};
  }catch(error){
    return {preset:null,problems:[problem('config','the ja-technical-writing preset could not be loaded next to the textlint binary: '+error.message)]};
  }
}

async function readManifest(manifest){
  const problems=[];
  let value=manifest,manifestDir=null;
  if(typeof manifest==='string'){
    manifestDir=path.dirname(path.resolve(manifest));
    try{value=JSON.parse(await readFile(manifest,'utf8'));}
    catch(error){return {problems:[problem('inventory','manifest could not be read: '+error.message)]};}
  }else{
    manifestDir=path.resolve('.');
  }
  if(!value||typeof value!=='object')return {problems:[problem('inventory','manifest must be a JSON object')]};
  const items=Array.isArray(value.items)?value.items:[];
  if(items.length===0)problems.push(problem('inventory','manifest covers an empty corpus; a lint run over no copy proves nothing'));
  const locales=new Set();
  for(const item of items){
    if(!item||typeof item.id!=='string'||!item.id)problems.push(problem('inventory','manifest item without a stable id'));
    if(!TOOL_BY_LOCALE[item.locale]){
      problems.push(problem('inventory','unsupported locale in manifest: '+String(item&&item.locale)));
      continue;
    }
    locales.add(item.locale);
    if(!Number.isInteger(item.startLine)||!Number.isInteger(item.endLine)||item.startLine<1||item.endLine<item.startLine){
      problems.push(problem('inventory','manifest item '+item.id+' has an invalid line range'));
    }
    if(!HEX64.test(String(item.sha256)))problems.push(problem('inventory','manifest item '+item.id+' has no value hash'));
    if(typeof item.file!=='string'||!item.file)problems.push(problem('inventory','manifest item '+item.id+' names no export file'));
  }
  for(const locale of UI_LOCALES)if(!locales.has(locale))problems.push(problem('inventory','manifest is missing the '+locale+' corpus'));
  return {manifest:value,manifestDir,problems};
}

async function verifyLineMap({manifest,manifestDir}){
  const problems=[];
  const byFile=new Map();
  for(const item of manifest.items){
    if(!item.file)continue;
    const key=item.locale+'|'+path.resolve(manifestDir,item.file);
    if(!byFile.has(key))byFile.set(key,[]);
    byFile.get(key).push(item);
  }
  for(const [key,items] of byFile){
    const file=path.resolve(manifestDir,items[0].file);
    let text;
    try{text=await readFile(file,'utf8');}
    catch(error){problems.push(problem('inventory','export file for '+key+' is unreadable: '+error.message));continue;}
    const fileLines=text.endsWith('\n')?text.split('\n').slice(0,-1):text.split('\n');
    const lineCount=fileLines.length;
    const covered=new Array(lineCount+1).fill(null);
    for(const item of items){
      if(item.startLine>lineCount||item.endLine>lineCount){
        problems.push(problem('inventory','manifest line range for '+item.id+' exceeds '+key));
        continue;
      }
      for(let line=item.startLine;line<=item.endLine;line++){
        if(covered[line]){problems.push(problem('inventory','line '+line+' of '+key+' maps to both '+covered[line]+' and '+item.id));continue;}
        covered[line]=item.id;
      }
      // Recompute the exact emitted bytes for this item and compare them with
      // the manifest declaration. Trim is deliberately never applied: multiline
      // values and trailing empty lines are part of the value identity.
      const actual=fileLines.slice(item.startLine-1,item.endLine).join('\n');
      const actualHash=sha256(actual);
      if(actualHash!==item.sha256){
        problems.push(problem('inventory','content hash mismatch for '+item.id+' / '+key+' at lines '+item.startLine+'-'+item.endLine+': manifest declares '+item.sha256+' but the actual bytes hash to '+actualHash+'; refusing to treat changed bytes as documented debt'));
      }
    }
    for(let line=1;line<=lineCount;line++)if(!covered[line])problems.push(problem('inventory','line '+line+' of '+key+' maps to no inventory item'));
  }
  return {problems,contentVerified:problems.length===0};
}

function runTool({bin,args,cwd}){
  return new Promise(resolve=>{
    execFile(bin,args,{cwd,maxBuffer:64*1024*1024},(error,stdout,stderr)=>{
      if(error&&typeof error.code==='number')resolve({exit:error.code,stdout:String(stdout),stderr:String(stderr),spawnError:null});
      else if(error)resolve({exit:null,stdout:String(stdout||''),stderr:String(stderr||''),spawnError:error});
      else resolve({exit:0,stdout:String(stdout),stderr:String(stderr),spawnError:null});
    });
  });
}

async function toolVersion(bin){
  const result=await runTool({bin,args:['--version'],cwd:path.dirname(bin)});
  return (result.stdout||result.stderr).trim().split('\n')[0]||'unknown';
}

function bindAlert({alert,tool,manifest,manifestDir}){
  const resolvedFile=path.resolve(manifestDir,alert.file);
  const item=manifest.items.find(entry=>entry.locale===alert.locale&&path.resolve(manifestDir,entry.file)===resolvedFile&&entry.startLine<=alert.line&&alert.line<=entry.endLine);
  if(!item)return null;
  return {
    tool,rule:alert.rule,severity:alert.severity,match:alert.match,message:alert.message,
    line:alert.line,itemId:item.id,locale:item.locale,itemValueSha256:item.sha256,itemKind:item.kind||'catalogue',
    sourceFile:item.file,alertFile:alert.file,sourceLines:[item.startLine,item.endLine]
  };
}

function bindingKey(entry){
  return entry.itemId+'|'+entry.locale+'|'+entry.rule;
}

function validateEntry(entry,index,kind){
  const problems=[];
  const where=kind+' entry #'+index;
  if(!entry||typeof entry!=='object')return [problem('binding',where+' is not an object')];
  if(typeof entry.itemId!=='string'||!entry.itemId)problems.push(problem('binding',where+' has no item id'));
  if(!UI_LOCALES.includes(entry.locale))problems.push(problem('binding',where+' has an unsupported locale'));
  if(typeof entry.rule!=='string'||!entry.rule)problems.push(problem('binding',where+' has no rule'));
  if(!HEX64.test(String(entry.valueSha256)))problems.push(problem('binding',where+' has no value hash'));
  return problems;
}

export async function validateDebtBindings({baseline,frozen}){
  const problems=[];
  const entries=baseline&&Array.isArray(baseline.entries)?baseline.entries:[];
  if(baseline&&baseline.frozenCommit!==FROZEN_SOURCE_COMMIT){
    problems.push(problem('frozen','the debt baseline must bind the frozen source revision '+FROZEN_SOURCE_COMMIT+', not '+String(baseline.frozenCommit)));
  }
  const seen=new Set();
  for(const [index,entry] of entries.entries()){
    problems.push(...validateEntry(entry,index,'debt'));
    if(entry&&entry.kind!=='existing-debt')problems.push(problem('binding','debt entry #'+index+' must stay labelled existing-debt, not a justified exception'));
    if(entry&&entry.state!=='unreviewed')problems.push(problem('binding','debt entry #'+index+' must stay explicitly unreviewed until individually reviewed'));
    const key=entry?bindingKey(entry):'';
    if(seen.has(key))problems.push(problem('binding','duplicate debt binding '+key));
    seen.add(key);
    const frozenValue=frozen&&frozen.catalogues&&frozen.catalogues[entry&&entry.locale]&&frozen.catalogues[entry.locale][entry&&entry.itemId];
    if(typeof frozenValue!=='string'){
      problems.push(problem('frozen','debt entry '+(entry&&entry.itemId)+' / '+(entry&&entry.locale)+' has no value at the frozen source revision '+FROZEN_SOURCE_COMMIT));
      continue;
    }
    if(sha256(frozenValue)!==entry.valueSha256){
      problems.push(problem('frozen','debt entry '+(entry&&entry.itemId)+' / '+(entry&&entry.locale)+' does not bind the value that existed at the frozen source revision '+FROZEN_SOURCE_COMMIT+'; newly worded T1 cannot whitelist itself'));
    }
  }
  return {ok:problems.length===0,problems,entries};
}

function validateAllowances({allowances}){
  const problems=[];
  const entries=allowances&&Array.isArray(allowances.entries)?allowances.entries:[];
  const seen=new Set();
  for(const [index,entry] of entries.entries()){
    problems.push(...validateEntry(entry,index,'allowance'));
    if(entry&&entry.kind!=='justified-exception')problems.push(problem('binding','allowance entry #'+index+' must stay labelled justified-exception'));
    if(typeof (entry&&entry.reason)!=='string'||entry.reason.trim().length<8){
      problems.push(problem('binding','allowance entry #'+index+' needs a concrete reason, not a placeholder'));
    }
    const key=entry?bindingKey(entry):'';
    if(seen.has(key))problems.push(problem('binding','duplicate allowance binding '+key));
    seen.add(key);
  }
  return {problems,entries};
}

async function frozenCataloguesFromGit({root}){
  const catalogues={};
  const problems=[];
  for(const locale of UI_LOCALES){
    const file='app/ui-catalogs/'+locale+'.mjs';
    try{
      const source=execFileSync('git',['show',FROZEN_SOURCE_COMMIT+':'+file],{cwd:root,encoding:'utf8',maxBuffer:32*1024*1024});
      catalogues[locale]=Object.fromEntries(parseCatalogue(source,file).map(entry=>[entry.key,entry.value]));
    }catch(error){
      problems.push(problem('frozen','frozen source revision '+FROZEN_SOURCE_COMMIT+' could not be read for '+locale+' via git object reads: '+error.message));
    }
  }
  return {catalogues,problems};
}

async function loadJson(file,label){
  try{return {value:JSON.parse(await readFile(file,'utf8')),problems:[]};}
  catch(error){return {value:null,problems:[problem('inventory',label+' could not be read: '+error.message)]};}
}

export async function lintCopy({
  root,manifest,valeBin,textlintBin,baseline,allowances,frozen,
  valeConfig,textlintConfig
}={}){
  const problems=[];
  const base=path.resolve(root||'.');
  const resolvedManifest=await readManifest(manifest||path.join(base,'build/copy/manifest.json'));
  problems.push(...resolvedManifest.problems);
  const manifestValue=resolvedManifest.manifest;
  const manifestDir=resolvedManifest.manifestDir||base;
  let contentVerified=true;
  if(manifestValue){
    const lineCheck=await verifyLineMap({manifest:manifestValue,manifestDir});
    problems.push(...lineCheck.problems);
    contentVerified=lineCheck.contentVerified;
  }

  let baselineValue=baseline,allowancesValue=allowances;
  if(typeof baseline==='string'||baseline===undefined){
    const loaded=await loadJson(baseline||path.join(base,'tools/copy-lint-debt.json'),'debt baseline');
    problems.push(...loaded.problems);baselineValue=loaded.value;
  }
  if(typeof allowances==='string'||allowances===undefined){
    const loaded=await loadJson(allowances||path.join(base,'tools/copy-lint-allowances.json'),'allowance file');
    problems.push(...loaded.problems);allowancesValue=loaded.value;
  }

  let frozenValue=frozen;
  const needsFrozen=baselineValue&&Array.isArray(baselineValue.entries)&&baselineValue.entries.length>0;
  if(needsFrozen&&!frozenValue){
    const fromGit=await frozenCataloguesFromGit({root:base});
    problems.push(...fromGit.problems);
    frozenValue=fromGit;
  }
  const debtCheck=await validateDebtBindings({baseline:baselineValue,frozen:frozenValue});
  problems.push(...debtCheck.problems);
  const allowanceCheck=validateAllowances({allowances:allowancesValue});
  problems.push(...allowanceCheck.problems);

  const toolStatus={vale:{bin:valeBin||null,ok:true},textlint:{bin:textlintBin||null,ok:true}};
  for(const [tool,bin] of [['vale',valeBin],['textlint',textlintBin]]){
    if(!bin){problems.push(problem('tool',tool+' tool is missing; no bin path resolved'));toolStatus[tool].ok=false;continue;}
    try{await access(bin,fsConstants.X_OK);}
    catch{problems.push(problem('tool',tool+' tool missing or not executable: '+bin));toolStatus[tool].ok=false;}
  }
  const configPath=valeConfig||path.join(base,'.vale.ini');
  try{await access(configPath);}catch{problems.push(problem('config','vale config missing: '+configPath));}

  const textlintConfigPath=textlintConfig||path.join(base,'.textlintrc.json');
  let textlintConfigValue=null;
  try{
    textlintConfigValue=JSON.parse(await readFile(textlintConfigPath,'utf8'));
  }catch(error){
    problems.push(problem('config','textlint config missing or unreadable: '+textlintConfigPath+' ('+error.message+')'));
  }
  if(textlintConfigValue&&textlintBin){
    const {preset,problems:presetProblems}=loadPresetFrom(textlintBin);
    problems.push(...presetProblems);
    if(preset)problems.push(...checkTextlintConfig({config:textlintConfigValue,preset}).problems);
  }

  const alerts=[];
  const filesByTool={vale:[],textlint:[]};
  if(manifestValue){
    for(const item of manifestValue.items){
      const tool=TOOL_BY_LOCALE[item.locale];
      if(tool&&!filesByTool[tool].includes(item.file))filesByTool[tool].push(item.file);
    }
  }

  const raw={vale:[],textlint:[]};
  if(toolStatus.vale.ok!==false&&filesByTool.vale.length){
    const files=filesByTool.vale.map(file=>path.resolve(manifestDir,file));
    const result=await runTool({bin:valeBin,args:['--config',configPath,'--output=JSON',...files],cwd:base});
    toolStatus.vale.exit=result.exit;toolStatus.vale.version=await toolVersion(valeBin);
    if(result.spawnError){problems.push(problem('tool','vale tool could not run: '+result.spawnError.message));toolStatus.vale.ok=false;}
    else if(result.exit!==0&&result.exit!==1){problems.push(problem('tool','vale tool failed with unexpected exit '+result.exit+': '+result.stderr.trim().slice(0,200)));toolStatus.vale.ok=false;}
    else{
      if(!result.stdout.trim())problems.push(problem('tool','empty vale output for a non-empty corpus'));
      else{
        let parsed;
        try{parsed=JSON.parse(result.stdout);}catch{parsed=null;}
        if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))problems.push(problem('tool','malformed vale output; expected a JSON object of alerts per file'));
        else{
          let errorAlerts=0;
          for(const [file,entries] of Object.entries(parsed)){
            const resolved=path.resolve(file);
            if(!files.includes(resolved)){problems.push(problem('tool','vale reported alerts for an unrequested file: '+file));continue;}
            if(!Array.isArray(entries)){problems.push(problem('tool','malformed vale output for '+file));continue;}
            for(const entry of entries){
              if(!entry||typeof entry.Check!=='string'||!Number.isInteger(entry.Line)||entry.Line<1||!['error','warning','suggestion'].includes(entry.Severity)){
                problems.push(problem('tool','malformed vale alert in '+file+'; severity must be error/warning/suggestion and line an integer >= 1'));
                continue;
              }
              if(entry.Severity==='error')errorAlerts++;
              raw.vale.push(entry);
              const alert={tool:'vale',rule:entry.Check,severity:entry.Severity==='error'?'error':'warning',line:entry.Line,match:String(entry.Match??''),message:String(entry.Message??''),file:resolved,locale:path.basename(file).replace(/\.txt$/,'')};
              const bound=bindAlert({alert,tool:'vale',manifest:manifestValue,manifestDir});
              if(!bound)problems.push(problem('inventory','vale alert on '+file+':'+alert.line+' maps to no inventory item'));
              else alerts.push(bound);
            }
          }
          if(result.exit===1&&errorAlerts===0)problems.push(problem('tool','inconsistent vale result: exit 1 without any error alert for a non-empty corpus'));
          if(result.exit===0&&errorAlerts>0)problems.push(problem('tool','inconsistent vale result: exit 0 with '+errorAlerts+' error alert(s)'));
        }
      }
    }
  }
  if(toolStatus.textlint.ok!==false&&filesByTool.textlint.length){
    const files=filesByTool.textlint.map(file=>path.resolve(manifestDir,file));
    const result=await runTool({bin:textlintBin,args:['--config',textlintConfigPath,'--format','json',...files],cwd:base});
    toolStatus.textlint.exit=result.exit;toolStatus.textlint.version=await toolVersion(textlintBin);
    if(result.spawnError){problems.push(problem('tool','textlint tool could not run: '+result.spawnError.message));toolStatus.textlint.ok=false;}
    else if(result.exit!==0&&result.exit!==1){problems.push(problem('tool','textlint tool failed with unexpected exit '+result.exit+': '+result.stderr.trim().slice(0,200)));toolStatus.textlint.ok=false;}
    else{
      if(!result.stdout.trim())problems.push(problem('tool','empty textlint output for a non-empty corpus'));
      else{
        let parsed;
        try{parsed=JSON.parse(result.stdout);}catch{parsed=null;}
        if(!Array.isArray(parsed))problems.push(problem('tool','malformed textlint output; expected a JSON array of files'));
        else{
          const reported=new Set();
          let errorMessages=0;
          for(const fileResult of parsed){
            const resolved=path.resolve(fileResult&&fileResult.filePath?fileResult.filePath:'');
            if(!files.includes(resolved)){problems.push(problem('tool','textlint reported results for an unrequested file: '+String(fileResult&&fileResult.filePath)));continue;}
            if(reported.has(resolved)){problems.push(problem('tool','textlint reported '+resolved+' twice (already reported); results must be unique per requested file'));continue;}
            reported.add(resolved);
            const text=await readFile(resolved,'utf8');
            if(!Array.isArray(fileResult.messages)){problems.push(problem('tool','malformed textlint output for '+resolved));continue;}
            for(const message of fileResult.messages){
              if(!message||typeof message.ruleId!=='string'||!Number.isInteger(message.severity)||![0,1,2].includes(message.severity)||!Number.isInteger(message.line)||message.line<1){
                problems.push(problem('tool','malformed textlint alert in '+resolved+'; severity must be 0/1/2 and line an integer >= 1'));
                continue;
              }
              if(message.severity===2)errorMessages++;
              raw.textlint.push(message);
              const range=message.fix&&Array.isArray(message.fix.range)?message.fix.range:message.range;
              const match=Array.isArray(range)?text.slice(range[0],range[1]):'';
              const alert={tool:'textlint',rule:message.ruleId,severity:message.severity===2?'error':message.severity===1?'warning':'info',line:message.line,match,message:String(message.message||''),file:resolved,locale:path.basename(resolved).replace(/\.txt$/,'')};
              const bound=bindAlert({alert,tool:'textlint',manifest:manifestValue,manifestDir});
              if(!bound)problems.push(problem('inventory','textlint alert on '+resolved+':'+alert.line+' maps to no inventory item'));
              else alerts.push(bound);
            }
          }
          for(const file of files)if(!reported.has(file))problems.push(problem('tool','textlint did not report the requested file '+file+'; every requested file needs exactly one structured result'));
          if(result.exit===1&&errorMessages===0)problems.push(problem('tool','inconsistent textlint result: exit 1 without any error-severity message'));
          if(result.exit===0&&errorMessages>0)problems.push(problem('tool','inconsistent textlint result: exit 0 with '+errorMessages+' error-severity message(s)'));
        }
      }
    }
  }

  const existingDebt=[],appliedExceptions=[],warnings=[],newErrors=[];
  const usedDebt=new Set(),usedAllowances=new Set();
  for(const alert of alerts){
    const key=alert.itemId+'|'+alert.locale+'|'+alert.rule;
    if(alert.severity!=='error'){
      warnings.push(alert);
      continue;
    }
    if(!contentVerified){
      newErrors.push(alert);
      continue;
    }
    const debt=(debtCheck.entries||[]).find(entry=>bindingKey(entry)===key&&entry.valueSha256===alert.itemValueSha256);
    if(debt){
      usedDebt.add(debt);
      existingDebt.push({...alert,kind:'existing-debt',state:debt.state,valueSha256:debt.valueSha256});
      continue;
    }
    const allowance=(allowanceCheck.entries||[]).find(entry=>bindingKey(entry)===key&&entry.valueSha256===alert.itemValueSha256);
    if(allowance){
      usedAllowances.add(allowance);
      appliedExceptions.push({...alert,kind:'justified-exception',state:allowance.state,reason:allowance.reason,valueSha256:allowance.valueSha256});
      continue;
    }
    newErrors.push(alert);
  }
  const staleDebt=contentVerified?(debtCheck.entries||[]).filter(entry=>!usedDebt.has(entry)):[];
  const staleAllowances=contentVerified?(allowanceCheck.entries||[]).filter(entry=>!usedAllowances.has(entry)):[];
  for(const entry of staleDebt)problems.push(problem('binding','stale debt entry '+bindingKey(entry)+' no longer binds a current T1 alert; review and prune it manually'));
  for(const entry of staleAllowances)problems.push(problem('binding','stale allowance '+bindingKey(entry)+' matches no current alert; review and prune it manually'));

  const counts={
    alerts:alerts.length,
    rawAlerts:raw.vale.length+raw.textlint.length,
    newErrors:newErrors.length,
    warnings:warnings.length,
    existingDebt:existingDebt.length,
    appliedExceptions:appliedExceptions.length,
    staleDebt:staleDebt.length,
    staleAllowances:staleAllowances.length,
    problems:problems.length
  };
  const ok=problems.length===0&&newErrors.length===0;
  return {
    ok,problems,toolStatus,raw,alerts,
    existingDebt,appliedExceptions,warnings,newErrors,staleDebt,staleAllowances,
    counts
  };
}

async function main(argv){
  const options={root:'.',manifest:null,baseline:null,allowances:null,report:null,valeConfig:null,textlintConfig:null};
  for(let i=0;i<argv.length;i++){
    const argument=argv[i];
    if(argument==='--root')options.root=argv[++i];
    else if(argument==='--manifest')options.manifest=argv[++i];
    else if(argument==='--baseline')options.baseline=argv[++i];
    else if(argument==='--allowances')options.allowances=argv[++i];
    else if(argument==='--report')options.report=argv[++i];
    else if(argument==='--vale-config')options.valeConfig=argv[++i];
    else if(argument==='--textlint-config')options.textlintConfig=argv[++i];
    else throw Error('Unknown argument: '+argument+' (this tool never regenerates baseline or allowances)');
  }
  const base=path.resolve(options.root);
  const manifestPath=options.manifest?path.resolve(options.manifest):path.join(base,'build/copy/manifest.json');
  const tools=resolveLintTools({root:base});
  const report=await lintCopy({
    root:base,manifest:manifestPath,
    valeBin:tools.valeBin,textlintBin:tools.textlintBin,
    valeConfig:options.valeConfig?path.resolve(options.valeConfig):undefined,
    textlintConfig:options.textlintConfig?path.resolve(options.textlintConfig):undefined,
    baseline:options.baseline?path.resolve(options.baseline):undefined,
    allowances:options.allowances?path.resolve(options.allowances):undefined
  });
  const reportPath=options.report?path.resolve(options.report):path.join(path.dirname(manifestPath),'lint-report.json');
  await writeFile(reportPath,JSON.stringify(report,null,2)+'\n');
  console.log('copy-lint: raw alerts '+report.counts.rawAlerts+' (vale '+report.raw.vale.length+', textlint '+report.raw.textlint.length+'); T1 new errors '+report.counts.newErrors+', documented debt '+report.counts.existingDebt+', justified exceptions '+report.counts.appliedExceptions+', warnings retained '+report.counts.warnings+', stale bindings '+report.counts.staleDebt+'/'+report.counts.staleAllowances+'.');
  for(const [tool,status] of Object.entries(report.toolStatus))console.log('tool '+tool+': '+(status.ok===false?'FAILED':'ok')+' '+(status.version||'')+' exit '+String(status.exit));
  for(const warning of report.warnings.slice(0,20))console.log('warning retained: '+warning.locale+' '+warning.itemId+' '+warning.rule+' "'+warning.match+'"');
  for(const error of report.newErrors.slice(0,20))console.log('T1 error: '+error.locale+' '+error.itemId+' '+error.rule+' "'+error.match+'" ('+error.sourceFile+':'+error.line+')');
  for(const entry of report.existingDebt.slice(0,10))console.log('existing debt (unreviewed): '+entry.locale+' '+entry.itemId+' '+entry.rule+' "'+entry.match+'"');
  for(const issue of report.problems)console.log('problem ['+issue.code+']: '+issue.message);
  console.log(report.ok?'copy-lint: PASS (warnings and documented debt stay visible above)':'copy-lint: FAIL (new T1 or tool/config/inventory problems)');
  process.exitCode=report.ok?0:1;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  await main(process.argv.slice(2));
}
