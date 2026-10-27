// Maintained decisions are evidence, never lint allowances or human approval.
// Fail closed to unknown when wording, locale, evidence or source context drifts.
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {sha256,UI_LOCALES} from './copy-inventory.mjs';

const unknown=()=>({state:'unknown',classification:'unknown',surface:'unknown',trigger:'unknown',decision:'unknown'});
const unreviewed=()=>({...unknown(),state:'unreviewed'});
const concrete=value=>typeof value==='string'&&value.trim().length>0;
const evidencePath=value=>typeof value==='string'&&/^docs\/verification\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_.-]+\.json$/.test(value);
const decisions=new Set(['preserve','rewrite','delete','move']);

function evidenceAt(reference,evidence){
  if(!reference||!evidencePath(reference.file)||!Number.isSafeInteger(reference.index)||reference.index<0)return null;
  const entry=evidence[reference.file]?.[reference.index];
  return entry&&sha256(JSON.stringify(entry))===reference.recordSha256?entry:null;
}

export function applyCopyLedger({inventory,ledger,evidence={}}){
  if(!ledger||ledger.schemaVersion!==1||!Array.isArray(ledger.catalogueReviews)||!Array.isArray(ledger.structuralDecisions))throw Error('Invalid copy ledger schema');
  const items=new Map(inventory.items.map(item=>[item.id,item]));
  const inputs=new Map(inventory.source.inputs.map(input=>[input.file,input.sha256]));
  const frequency=new Map();
  for(const row of ledger.catalogueReviews){
    const identity=JSON.stringify([row.key,row.locale]);
    frequency.set(identity,(frequency.get(identity)||0)+1);
  }
  for(const item of inventory.items){
    item.review=unreviewed();
    delete item.localeReviews;
  }
  const reopened=[];
  for(const [index,row] of ledger.catalogueReviews.entries()){
    const reasons=[],item=items.get(row.key),value=item?.values[row.locale],review=row.review;
    if(item&&!item.localeReviews)item.localeReviews=Object.fromEntries(UI_LOCALES.map(locale=>[locale,unknown()]));
    if(!item||!UI_LOCALES.includes(row.locale)||!value)reasons.push('unknown key or locale');
    if(frequency.get(JSON.stringify([row.key,row.locale]))!==1)reasons.push('duplicate key/locale decision');
    if(!value||value.file!==row.file||value.sha256!==row.valueSha256||sha256(value.value)!==row.valueSha256)reasons.push('catalogue source or value changed');
    const record=evidenceAt(row.evidence,evidence);
    if(!record||record.key!==row.key||record.locale!==row.locale||record.file!==row.file||typeof record.after!=='string'||sha256(record.after)!==row.valueSha256)reasons.push('stale or cross-key/locale historical evidence');
    if(!review||review.by!=='agent'||!concrete(review.surface)||!concrete(review.trigger)||!concrete(review.rationale)||review.rationale.trim().length<12||!decisions.has(review.decision)||!Array.isArray(review.classifications)||review.classifications.length===0||review.classifications.some(value=>!['A','B','C','D','E','F'].includes(value)))reasons.push('incomplete agent adjudication');
    const context=row.context,files=context?.files;
    if(!item||!context||context.consumersSha256!==sha256(JSON.stringify(item.consumers)))reasons.push('consumer locations changed');
    if(!Array.isArray(files)||files.length===0||new Set(files.map(entry=>entry.file)).size!==files.length||files.some(entry=>!inputs.has(entry.file)||inputs.get(entry.file)!==entry.sha256)||item?.consumers.some(consumer=>!files?.some(entry=>entry.file===consumer.file)))reasons.push('source context changed or incomplete');
    if(reasons.length){
      reopened.push({index,key:row.key,locale:row.locale,state:'unknown',reasons});
      continue;
    }
    item.localeReviews[row.locale]={state:'reviewed',...review,evidence:row.evidence,context:row.context,valueSha256:row.valueSha256,file:row.file};
  }
  for(const item of inventory.items){
    if(!item.localeReviews)continue;
    const rows=UI_LOCALES.map(locale=>item.localeReviews[locale]);
    if(rows.every(row=>row.state==='reviewed')&&item.missingLocales.length===0&&item.duplicates.length===0){
      const sameContext=rows.every(row=>JSON.stringify(row.context)===JSON.stringify(rows[0].context)&&row.surface===rows[0].surface&&row.trigger===rows[0].trigger);
      if(sameContext)item.review={state:'reviewed',by:'agent',classification:[...new Set(rows.flatMap(row=>row.classifications))].sort().join('+'),surface:rows[0].surface,trigger:rows[0].trigger,decision:'preserve',scope:'delivered wording and bound source context; no human-language or current-browser acceptance'};
    }
  }
  const structuralDecisions=ledger.structuralDecisions.map(row=>({
    ...row,historicalEvidence:evidenceAt(row.evidence,evidence)&&!evidenceAt(row.evidence,evidence).locale?'verified':'unknown',
    currentState:'unknown',currentReason:'Historical GET-218 decision retained separately; this batch does not re-run its interaction or visual acceptance.'
  }));
  const reviewedItems=inventory.items.filter(item=>item.review.state==='reviewed').length;
  inventory.counts={...inventory.counts,catalogueKeys:inventory.items.length,localeValues:inventory.items.reduce((n,item)=>n+Object.keys(item.values).length,0),reviewedItems,unreviewedItems:inventory.items.length-reviewedItems,reviewedLocaleValues:inventory.items.reduce((n,item)=>n+Object.values(item.localeReviews||{}).filter(row=>row.state==='reviewed').length,0)};
  inventory.counts.unreviewedLocaleValues=inventory.counts.localeValues-inventory.counts.reviewedLocaleValues;
  inventory.auditLedger={schemaVersion:1,by:'agent',humanReviewed:false,reopened,structuralDecisions};
  return inventory;
}

export async function loadCopyLedger({root,inventory}){
  const file='docs/copy/copy-ledger.json';
  const text=await readFile(path.join(root,file),'utf8');
  const ledger=JSON.parse(text),evidence={};
  for(const reference of [...(ledger.catalogueReviews||[]),...(ledger.structuralDecisions||[])].map(row=>row.evidence)){
    if(!reference||!evidencePath(reference.file)||Object.hasOwn(evidence,reference.file))continue;
    try{evidence[reference.file]=JSON.parse(await readFile(path.join(root,reference.file),'utf8'));}
    catch{evidence[reference.file]=null;}
  }
  applyCopyLedger({inventory,ledger,evidence});
  inventory.auditLedger.registry={file,sha256:sha256(text)};
  return inventory;
}
