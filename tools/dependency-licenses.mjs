// Deterministic dependency-license evidence derived from package-lock.json.
//
// The report records what the lockfile declares, nothing more: it is evidence
// for review, not legal proof, and it never infers compatibility from names.
// SPDX expressions are copied verbatim so AND (conjunctive) and OR (disjunctive)
// choices are never silently rewritten or split into alternatives.
//
//   node tools/dependency-licenses.mjs            regenerate docs/dependency-licenses.json
//   node tools/dependency-licenses.mjs --check    reject stale/missing/unknown/unreviewed evidence
//
// A failing check is never fixed by regeneration alone: unreviewed expressions
// require a visible edit to docs/dependency-licenses-reviewed.json, and every
// regeneration prints the user-visible change summary it wrote.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

export const REPORT_FILE='docs/dependency-licenses.json';
export const REVIEW_FILE='docs/dependency-licenses-reviewed.json';

const placeholder=/^(?:unknown|unlicensed|none|noassertion|see\s+license\s+in\b.*|license\s+ref\s+in\b.*)$/i;
const customRef=/^(?:licenseref|documentref)-/i;
const identifier=/^[A-Za-z0-9.+-]+$/;

export function packageNameFromPath(lockPath){
  const marker='node_modules/';
  const index=lockPath.lastIndexOf(marker);
  return index<0?lockPath:lockPath.slice(index+marker.length);
}

export function sanitizeResolved(value){
  if(typeof value!=='string'||!value.trim())return null;
  try{
    const url=new URL(value.trim());
    url.username='';url.password='';url.search='';url.hash='';
    return url.toString();
  }catch{return null;}
}

export function classifyProvenance(resolved){
  if(!resolved)return 'unresolved';
  if(/^git(?:\+|$)|^(?:github|gitlab|bitbucket):/i.test(resolved))return 'git';
  if(/^https?:\/\//i.test(resolved))return /^https?:\/\/registry\.npmjs\.org\//i.test(resolved)?'npm-registry':'hosted-tarball';
  return 'other';
}

// Validate an SPDX expression without rewriting it. Returns {ok} or
// {ok:false,reason:'missing'|'unknown'|'syntax'}.
export function validateExpression(expression){
  if(typeof expression!=='string'||!expression.trim())return {ok:false,reason:'missing'};
  const value=expression.trim();
  if(value!==expression||placeholder.test(value)||customRef.test(value))return {ok:false,reason:'unknown'};
  const tokens=value.match(/\(|\)|[^\s()]+/g);
  if(!tokens||tokens.join(' ').replace(/\s+\)/g,')').replace(/\(\s+/g,'(')!==value.replace(/\s+\)/g,')').replace(/\(\s+/g,'('))return {ok:false,reason:'syntax'};
  let position=0;
  const peek=()=>tokens[position];
  const isOperator=token=>token==='AND'||token==='OR';
  function parseExpression(){
    if(!parseConjunction())return false;
    while(peek()==='OR'){position++;if(!parseConjunction())return false;}
    return true;
  }
  function parseConjunction(){
    if(!parseFactor())return false;
    while(peek()==='AND'){position++;if(!parseFactor())return false;}
    return true;
  }
  function parseFactor(){
    const token=peek();
    if(token===undefined)return false;
    if(token==='('){
      position++;
      if(!parseExpression())return false;
      if(peek()!==')')return false;
      position++;
      return true;
    }
    if(token===')'||isOperator(token))return false;
    if(!identifier.test(token))return false;
    position++;
    if(peek()==='WITH'){
      position++;
      const exception=tokens[position];
      if(exception===undefined||!identifier.test(exception)||isOperator(exception))return false;
      position++;
    }
    return true;
  }
  return parseExpression()&&position===tokens.length?{ok:true}:{ok:false,reason:'syntax'};
}

// Platform constraints are copied exactly as declared (npm uses arrays, but some
// lock entries declare plain strings); both are preserved verbatim.
function asDeclared(value){
  if(Array.isArray(value))return [...value];
  if(typeof value==='string')return value;
  return null;
}

export function buildInventory(lock,{lockfileSha256}={}){
  if(!lock||typeof lock!=='object'||!lock.packages||typeof lock.packages!=='object')throw Error('package-lock.json has no packages map');
  if(typeof lockfileSha256!=='string'||!/^[a-f0-9]{64}$/.test(lockfileSha256))throw Error('A lockfile SHA256 is required');
  const problems=[],packages=[];
  const licenseExpressions={};
  const classification={production:0,dev:0,optional:0,devOptional:0};
  const provenance={'npm-registry':0,'hosted-tarball':0,'git':0,'other':0,'unresolved':0};
  let platformGated=0;
  for(const [lockPath,entry] of Object.entries(lock.packages)){
    if(lockPath==='')continue;
    const declared=entry&&typeof entry==='object'?entry:{};
    const license=typeof declared.license==='string'?declared.license:null;
    const validation=validateExpression(license);
    if(validation.reason==='missing')problems.push({code:'missing',message:'Missing license metadata for '+lockPath});
    else if(!validation.ok)problems.push({code:'unknown',message:'Unknown license expression '+JSON.stringify(license)+' for '+lockPath});
    if(license)licenseExpressions[license]=(licenseExpressions[license]||0)+1;
    const dev=declared.dev===true,optional=declared.optional===true;
    if(dev&&optional)classification.devOptional++;else if(dev)classification.dev++;else if(optional)classification.optional++;else classification.production++;
    if(declared.os!==undefined||declared.cpu!==undefined)platformGated++;
    const resolved=sanitizeResolved(declared.resolved);
    const kind=classifyProvenance(resolved);
    provenance[kind]++;
    const record={name:packageNameFromPath(lockPath),version:typeof declared.version==='string'?declared.version:null,license,dev,optional};
    if(declared.os!==undefined)record.os=asDeclared(declared.os);
    if(declared.cpu!==undefined)record.cpu=asDeclared(declared.cpu);
    record.provenance=kind;
    record.resolved=resolved;
    record.integrity=typeof declared.integrity==='string'?declared.integrity:null;
    record.path=lockPath;
    packages.push(record);
  }
  packages.sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:(a.version<b.version?-1:a.version>b.version?1:(a.path<b.path?-1:a.path>b.path?1:0)));
  const rootEntry=lock.packages['']&&typeof lock.packages['']==='object'?lock.packages['']:{};
  const root={name:typeof rootEntry.name==='string'?rootEntry.name:(typeof lock.name==='string'?lock.name:null),version:typeof rootEntry.version==='string'?rootEntry.version:(typeof lock.version==='string'?lock.version:null),license:typeof rootEntry.license==='string'?rootEntry.license:null};
  if(!root.license)problems.push({code:'missing',message:'Missing root package license metadata in package-lock.json'});
  const sortedExpressions={};
  for(const key of Object.keys(licenseExpressions).sort())sortedExpressions[key]=licenseExpressions[key];
  const report={
    schemaVersion:1,
    kind:'leafhour-dependency-license-inventory',
    lockfile:{path:'package-lock.json',sha256:lockfileSha256,lockfileVersion:typeof lock.lockfileVersion==='number'?lock.lockfileVersion:null,name:typeof lock.name==='string'?lock.name:null,version:typeof lock.version==='string'?lock.version:null},
    root,
    summary:{packageCount:packages.length,licenseExpressions:sortedExpressions,classification,platformGated,provenance},
    packages,
  };
  return {report,problems};
}

export function renderReport(report){
  return JSON.stringify(report,null,2)+'\n';
}

export async function readReview(root){
  let text;
  try{text=await readFile(path.join(root,REVIEW_FILE),'utf8');}
  catch(error){if(error.code==='ENOENT')throw Error('Missing expression review record: '+REVIEW_FILE+' (review new SPDX expressions and add them there; regeneration never adds them)');throw error;}
  let data;
  try{data=JSON.parse(text);}catch{throw Error('Invalid expression review record: '+REVIEW_FILE);}
  if(!data||typeof data!=='object'||data.schemaVersion!==1||!data.expressions||typeof data.expressions!=='object'||Array.isArray(data.expressions))throw Error('Invalid expression review record: '+REVIEW_FILE);
  for(const [expression,entry] of Object.entries(data.expressions)){
    if(!validateExpression(expression).ok)throw Error('Expression review record holds an invalid expression: '+expression);
    if(!entry||typeof entry!=='object'||entry.status!=='reviewed'||typeof entry.note!=='string'||!entry.note.trim())throw Error('Expression review record needs a reviewed status and note for: '+expression);
  }
  return data.expressions;
}

function summarize(previous,next){
  const before=previous&&Array.isArray(previous.packages)?previous.packages:[];
  const after=next.packages;
  const beforeByPath=new Map(before.map(record=>[record.path,record]));
  const afterByPath=new Map(after.map(record=>[record.path,record]));
  const added=after.filter(record=>!beforeByPath.has(record.path)).map(record=>record.name+'@'+record.version);
  const removed=before.filter(record=>!afterByPath.has(record.path)).map(record=>record.name+'@'+record.version);
  const changed=[];
  for(const record of after){
    const old=beforeByPath.get(record.path);
    if(old&&JSON.stringify(old)!==JSON.stringify(record))changed.push(record.name+'@'+record.version);
  }
  const lockfileChanged=!previous||!previous.lockfile||previous.lockfile.sha256!==next.lockfile.sha256;
  return {lockfileChanged,lockfileSha256Before:previous&&previous.lockfile?previous.lockfile.sha256:null,lockfileSha256After:next.lockfile.sha256,added,removed,changed};
}

export async function analyze(root){
  let lockBytes;
  try{lockBytes=await readFile(path.join(root,'package-lock.json'));}
  catch(error){if(error.code==='ENOENT')throw Error('Missing package-lock.json');throw error;}
  let lock;
  try{lock=JSON.parse(lockBytes.toString('utf8'));}catch{throw Error('package-lock.json is not valid JSON');}
  const lockfileSha256=createHash('sha256').update(lockBytes).digest('hex');
  const review=await readReview(root);
  const {report,problems}=buildInventory(lock,{lockfileSha256});
  const unreviewed=new Map();
  for(const record of report.packages){
    if(record.license&&validateExpression(record.license).ok&&!Object.hasOwn(review,record.license)){
      if(!unreviewed.has(record.license))unreviewed.set(record.license,[]);
      if(unreviewed.get(record.license).length<3)unreviewed.get(record.license).push(record.name+'@'+record.version);
    }
  }
  for(const [expression,examples] of unreviewed)problems.push({code:'unreviewed',message:'New unreviewed license expression '+JSON.stringify(expression)+' ('+examples.join(', ')+'); review it and add it to '+REVIEW_FILE});
  const rendered=renderReport(report);
  let currentText=null;
  try{currentText=await readFile(path.join(root,REPORT_FILE),'utf8');}
  catch(error){if(error.code!=='ENOENT')throw error;}
  let previous=null;
  if(currentText!==null){try{previous=JSON.parse(currentText);}catch{previous=null;}}
  const diff=summarize(previous,report);
  if(currentText!==rendered)problems.push({code:'stale',message:(currentText===null?'Missing report '+REPORT_FILE:'Stale report '+REPORT_FILE+(diff.lockfileChanged?' (package-lock.json sha256 changed from '+String(diff.lockfileSha256Before)+' to '+diff.lockfileSha256After+')':''))+'; regenerate and review the visible diff',diff});
  return {lockfileSha256,report,rendered,currentText,diff,problems};
}

export async function checkEvidence(root){
  const analysis=await analyze(root);
  return {...analysis,ok:analysis.problems.length===0};
}

export class EvidenceFailure extends Error{
  constructor(problems){
    super('Dependency license evidence is not valid: '+problems.map(problem=>problem.code).join(', '));
    this.name='EvidenceFailure';
    this.problems=problems;
  }
}

export async function generateEvidence(root){
  const analysis=await analyze(root);
  // Stale is exactly what regeneration fixes (with a user-visible diff);
  // missing/unknown/unreviewed evidence still refuses to generate.
  const fatal=analysis.problems.filter(problem=>problem.code!=='stale');
  if(fatal.length)throw new EvidenceFailure(fatal);
  let written=false;
  if(analysis.currentText!==analysis.rendered){
    await mkdir(path.join(root,path.dirname(REPORT_FILE)),{recursive:true});
    await writeFile(path.join(root,REPORT_FILE),analysis.rendered);
    written=true;
  }
  return {written,diff:analysis.diff,report:analysis.report};
}

function formatDiff(diff){
  const parts=[];
  if(diff.lockfileChanged)parts.push('lockfile sha256 '+String(diff.lockfileSha256Before)+' -> '+diff.lockfileSha256After);
  for(const [label,items] of [['added',diff.added],['removed',diff.removed],['changed',diff.changed]]){
    if(!items.length)continue;
    parts.push(items.length+' '+label+(items.length>10?' ('+items.slice(0,10).join(', ')+', ...)':' ('+items.join(', ')+')'));
  }
  return parts.length?parts.join('; '):'no record changes';
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  const root=process.cwd();
  const check=process.argv.includes('--check');
  try{
    if(check){
      const result=await checkEvidence(root);
      if(!result.ok){
        console.error('Dependency license evidence check failed with '+result.problems.length+' problem(s):');
        for(const problem of result.problems)console.error(' - ['+problem.code+'] '+problem.message);
        process.exitCode=1;
      }else{
        console.log('Dependency license evidence current: '+result.report.summary.packageCount+' third-party packages, '+Object.keys(result.report.summary.licenseExpressions).length+' reviewed expressions, bound to package-lock.json sha256 '+result.lockfileSha256+'.');
      }
    }else{
      const result=await generateEvidence(root);
      const summary=result.report.summary;
      console.log('Dependency license evidence '+(result.written?'written to '+REPORT_FILE+' ('+formatDiff(result.diff)+')':'unchanged at '+REPORT_FILE)+'; '+summary.packageCount+' third-party packages, '+Object.keys(summary.licenseExpressions).length+' reviewed expressions.');
    }
  }catch(error){
    if(error instanceof EvidenceFailure){
      console.error('Dependency license evidence refused to generate with '+error.problems.length+' problem(s):');
      for(const problem of error.problems)console.error(' - ['+problem.code+'] '+problem.message);
    }else console.error(String(error&&error.message||error));
    process.exitCode=1;
  }
}
