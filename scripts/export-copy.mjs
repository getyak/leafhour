// GET-202 deterministic copy export.
//
// Writes per-locale plain text (one catalogue item per line; multiline values
// keep every line) plus a manifest that maps every emitted line range to its
// stable item id, locale and value SHA256. The export is the lint corpus: it
// carries reader-facing values exactly as the catalogue stores them, so a
// protected quote or pathname can never be normalised away. Declared value
// hashes are re-checked against the actual bytes before anything is written,
// and only explicitly adjudicated static literals (docs/copy/copy-reviewed.json)
// may join the corpus — unknown candidates never enter it silently.
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {collectCopy,inventoryCsv,candidatesCsv,classifyProtectedValue,sha256,COPY_SCHEMA_VERSION,UI_LOCALES} from './copy-inventory.mjs';
import {loadCopyLedger} from './copy-ledger.mjs';

const REVIEWABLE_KINDS=new Set(['js-dom-literal','js-attribute','js-cjk-literal','html-attribute','html-text']);
const SOURCE_PROTECTION=new Set(['path','url','quotation']);

export function validateReviewedLiterals({inventory,reviews}={}){
  if(!Array.isArray(reviews))throw Error('Reviewed literal decisions must be a list');
  for(const candidate of inventory.candidates||[])candidate.review={state:'unknown',classification:'unknown',surface:'unknown',trigger:'unknown',decision:'unknown'};
  inventory.counts.reviewedStaticItems=0;
  inventory.counts.candidatesUnreviewed=(inventory.candidates||[]).length;
  const byId=new Map((inventory&&inventory.candidates||[]).map(entry=>[entry.id,entry]));
  const seen=new Set(),items=[];
  for(const [index,review] of reviews.entries()){
    const where='review decision #'+index;
    if(!review||typeof review!=='object')throw Error(where+' is not an object');
    if(typeof review.candidateId!=='string'||!review.candidateId)throw Error(where+' has no candidate id');
    const candidate=byId.get(review.candidateId);
    if(!candidate)throw Error(where+' references an unknown candidate: '+review.candidateId);
    if(seen.has(review.candidateId))throw Error(where+' duplicates the review decision for '+review.candidateId);
    seen.add(review.candidateId);
    if(!REVIEWABLE_KINDS.has(candidate.kind))throw Error(where+' names a non-UI candidate kind: '+candidate.kind);
    if(typeof candidate.value!=='string'||sha256(candidate.value)!==candidate.sha256)throw Error(where+' has a candidate value hash mismatch: refusing to export unverified bytes');
    const protection=classifyProtectedValue(candidate.value);
    const sourceReasons=(candidate.protectionReason||'').split('+').filter(reason=>SOURCE_PROTECTION.has(reason));
    if(sourceReasons.length>0)throw Error(where+' targets protected source material ('+sourceReasons.join('+')+'); quotes, paths, URLs and author text cannot become reviewed UI copy');
    if(protection.protected&&protection.reasons.some(reason=>SOURCE_PROTECTION.has(reason)))throw Error(where+' targets protected source material');
    if(typeof review.valueSha256!=='string'||review.valueSha256!==candidate.sha256)throw Error(where+' is stale: the value hash does not match the current candidate value for '+review.candidateId);
    if(!UI_LOCALES.includes(review.locale))throw Error(where+' has an unsupported locale: '+String(review.locale));
    if(review.by!=='agent')throw Error(where+' needs explicit by: agent attribution; no human review is inferred');
    if(!/^[a-f0-9]{64}$/.test(review.sourceSha256||'')||review.sourceSha256!==inventory.source.inputs.find(input=>input.file===candidate.file)?.sha256)throw Error(where+' has stale or missing source context; reopen the candidate as unknown');
    if(typeof review.surface!=='string'||!review.surface.trim())throw Error(where+' needs an explicit surface');
    if(typeof review.trigger!=='string'||!review.trigger.trim())throw Error(where+' needs an explicit trigger');
    if(typeof review.rationale!=='string'||review.rationale.trim().length<12)throw Error(where+' needs a concrete review rationale');
    if(review.state!=='reviewed')throw Error(where+' must declare state "reviewed"; unknown or partial decisions stay out of the corpus');
    items.push({
      id:candidate.id,locale:review.locale,kind:'static-literal',
      value:candidate.value,sha256:candidate.sha256,
      protected:candidate.protected?candidate.protectionReason:null,
      review:{by:'agent',surface:review.surface.trim(),trigger:review.trigger.trim(),rationale:review.rationale.trim(),sourceSha256:review.sourceSha256,state:'reviewed'}
    });
  }
  for(const item of items)byId.get(item.id).review={...item.review,classification:'checked-no-A-F-finding',decision:'preserve'};
  inventory.counts.reviewedStaticItems=items.length;
  inventory.counts.candidatesUnreviewed=inventory.candidates.length-items.length;
  return items;
}

export async function exportCopy({inventory,outDir,reviews=[]}={}){
  if(!inventory||typeof inventory!=='object')throw Error('exportCopy requires an inventory');
  if(!outDir)throw Error('exportCopy requires an explicit out directory');
  if(inventory.corpus==='empty'||inventory.counts.catalogueKeys===0)throw Error('Refusing to export an empty corpus');
  if(inventory.counts.duplicateKeys>0)throw Error('Refusing to export duplicate ids; duplicate rows must be resolved by review first');
  if(!inventory.parity.ok)throw Error('Refusing to export four-locale parity gaps: '+JSON.stringify(inventory.parity.missing));
  for(const item of inventory.items){
    for(const locale of UI_LOCALES){
      const value=item.values[locale];
      if(!value)throw Error('Refusing to export missing '+locale+' value for '+item.id);
      if(sha256(value.value)!==value.sha256)throw Error('Inventory value hash mismatch for '+item.id+' / '+locale+': refusing to export unverified bytes');
    }
  }
  const staticItems=validateReviewedLiterals({inventory,reviews});
  const files={},manifestItems=[],exportedLines={};
  for(const locale of UI_LOCALES){
    const lines=[];
    for(const item of inventory.items){
      const value=item.values[locale];
      const valueLines=value.value.split('\n');
      const protection=classifyProtectedValue(value.value);
      const startLine=lines.length+1;
      lines.push(...valueLines);
      manifestItems.push({
        id:item.id,locale,file:locale+'.txt',kind:'catalogue',startLine,endLine:lines.length,
        sha256:value.sha256,protected:protection.protected?protection.reasons.join('+'):null
      });
    }
    for(const item of staticItems.filter(entry=>entry.locale===locale)){
      const valueLines=item.value.split('\n');
      const startLine=lines.length+1;
      lines.push(...valueLines);
      manifestItems.push({
        id:item.id,locale,file:locale+'.txt',kind:'static-literal',startLine,endLine:lines.length,
        sha256:item.sha256,protected:item.protected,review:item.review
      });
    }
    files[locale]=lines.join('\n')+'\n';
    exportedLines[locale]=lines.length;
  }
  const counts={...inventory.counts,exportedLines,reviewedStaticItems:staticItems.length};
  const manifest={
    schemaVersion:COPY_SCHEMA_VERSION,
    source:inventory.source,
    frozenBase:inventory.source.frozenBase,
    locales:[...UI_LOCALES],
    files:Object.fromEntries(UI_LOCALES.map(locale=>[locale,{file:locale+'.txt',lines:exportedLines[locale]}])),
    items:manifestItems,
    counts
  };
  const manifestText=JSON.stringify(manifest,null,2)+'\n';
  await mkdir(outDir,{recursive:true});
  for(const locale of UI_LOCALES)await writeFile(path.join(outDir,locale+'.txt'),files[locale]);
  await writeFile(path.join(outDir,'manifest.json'),manifestText);
  return {files,manifestText,counts,staticItems};
}

function executionCommit(root){
  try{
    const commit=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();
    return /^[a-f0-9]{40}$/.test(commit)?commit:null;
  }catch{return null;}
}

async function main(argv){
  const options={root:'.',out:'build/copy',reviews:null};
  for(let i=0;i<argv.length;i++){
    const argument=argv[i];
    if(argument==='--root')options.root=argv[++i];
    else if(argument==='--out')options.out=argv[++i];
    else if(argument==='--reviews'){
      const value=argv[++i];
      if(!value||value.startsWith('--'))throw Error('--reviews requires a file path');
      options.reviews=value;
    }
    else throw Error('Unknown argument: '+argument);
  }
  const root=path.resolve(options.root);
  const inventory=await collectCopy({root});
  await loadCopyLedger({root,inventory});
  const reviewsPath=options.reviews?path.resolve(options.reviews):path.join(root,'docs/copy/copy-reviewed.json');
  let reviews=[];
  try{
    const parsed=JSON.parse(await readFile(reviewsPath,'utf8'));
    if(!parsed||!Array.isArray(parsed.reviews))throw Error('review file must carry a reviews list');
    reviews=parsed.reviews;
  }catch(error){
    throw Error('Reviewed literal decisions could not be read from '+reviewsPath+': '+error.message);
  }
  const result=await exportCopy({inventory,outDir:path.resolve(root,options.out),reviews});
  await mkdir(path.join(root,'docs/copy'),{recursive:true});
  await writeFile(path.join(root,'docs/copy/copy-inventory.json'),JSON.stringify(inventory,null,2)+'\n');
  await writeFile(path.join(root,'docs/copy/copy-inventory.csv'),inventoryCsv(inventory));
  await writeFile(path.join(root,'docs/copy/copy-candidates.csv'),candidatesCsv(inventory));
  // Untracked execution receipt: the reproducible artifacts bind input bytes,
  // so volatile run metadata (the executing commit) never touches them.
  await writeFile(path.join(root,options.out,'export-receipt.json'),JSON.stringify({
    kind:'copy-export-execution-receipt',
    trackedArtifactsBind:'input-sha256',
    inputDigest:inventory.source.inputDigest,
    executingCommit:executionCommit(root),
    note:'Untracked run metadata only. The checked-in inventory binds scanned file bytes and never claims to represent any commit.'
  },null,2)+'\n');
  console.log('Copy inventory: '+inventory.counts.catalogueKeys+' catalogue keys ('+inventory.counts.reviewedItems+' agent-reviewed / '+inventory.counts.unreviewedItems+' unreviewed), '+inventory.counts.localeValues+' locale values, '+inventory.counts.candidatesUnreviewed+' unreviewed literal candidates ('+inventory.counts.candidatesProtected+' protected source), '+inventory.counts.dynamicConsumers+' unresolved dynamic references.');
  console.log('Copy export: '+UI_LOCALES.map(locale=>locale+'='+result.counts.exportedLines[locale]+' lines').join(', ')+' in '+options.out+'/; '+result.counts.reviewedStaticItems+' explicitly reviewed static literal(s); manifest maps every line to its item.');
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  await main(process.argv.slice(2));
}
