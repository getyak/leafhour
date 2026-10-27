import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {collectCopy} from '../scripts/copy-inventory.mjs';
import {exportCopy} from '../scripts/export-copy.mjs';

const module=await import('../scripts/copy-ledger.mjs').catch(()=>({}));
const hash=value=>createHash('sha256').update(value).digest('hex');
const locales=['en','zh-Hans','zh-Hant','ja'];
const evidenceFile='docs/verification/get-218/copy-decisions.json';
function fixture(){
  const evidence=locales.map(locale=>({file:'app/ui-catalogs/'+locale+'.mjs',key:'a',locale,after:'Same',surface:'reader',trigger:'open details',handling:'rewrite',rationale:'Preserve the original and review boundaries.'}));
  const consumers=[{file:'app/view.mjs',line:1,column:1}];
  const inventory={locales,items:['a','b'].map(id=>({id,values:Object.fromEntries(locales.map(locale=>[locale,{file:'app/ui-catalogs/'+locale+'.mjs',value:'Same',sha256:hash('Same')}])),consumers:structuredClone(consumers),missingLocales:[],duplicates:[],review:{state:'unreviewed',classification:'unknown',surface:'unknown',trigger:'unknown',decision:'unknown'}})),source:{inputs:[{file:'app/view.mjs',sha256:hash('show details')}]},counts:{catalogueKeys:2,localeValues:8,reviewedItems:0,unreviewedItems:2}};
  const ledger={schemaVersion:1,catalogueReviews:evidence.map((entry,index)=>({key:'a',locale:entry.locale,file:entry.file,valueSha256:hash('Same'),context:{consumersSha256:hash(JSON.stringify(consumers)),files:[{file:'app/view.mjs',sha256:hash('show details')}]},evidence:{file:evidenceFile,index,recordSha256:hash(JSON.stringify(entry))},review:{by:'agent',surface:'reader',trigger:'open details',classifications:['A','E'],decision:'preserve',rationale:'Retain the source and review facts for explicit details.'}})),structuralDecisions:[]};
  return {inventory,ledger,evidence:{[evidenceFile]:evidence}};
}
function apply(f){assert.equal(typeof module.applyCopyLedger,'function','source-bound ledger implementation is required');return module.applyCopyLedger(f);}
test('all four exact locale decisions review only their own key; denominator is current inventory',()=>{
  const f=fixture();apply(f);
  assert.equal(f.inventory.counts.reviewedItems,1);
  assert.equal(f.inventory.counts.unreviewedItems,1);
  assert.equal(f.inventory.counts.reviewedLocaleValues,4);
  assert.equal(f.inventory.items[0].review.by,'agent');
  assert.equal(f.inventory.items[1].review.state,'unreviewed');
  assert.equal(f.inventory.items[1].review.classification,'unknown');
  f.inventory.items.push({...structuredClone(f.inventory.items[1]),id:'new-key'});
  apply(f);
  assert.equal(f.inventory.counts.catalogueKeys,3);
  assert.equal(f.inventory.counts.unreviewedItems,2,'new keys never inherit a fixed denominator');
});
for(const [name,change] of [
  ['changed value even with an old declared hash',f=>{f.inventory.items[0].values.en.value='Changed';}],
  ['cross-key equal value',f=>{f.ledger.catalogueReviews[0].key='b';}],
  ['cross-locale equal value',f=>{f.ledger.catalogueReviews[0].locale='ja';}],
  ['wrong source catalogue',f=>{f.ledger.catalogueReviews[0].file='app/ui-catalogs/ja.mjs';}],
  ['stale evidence record',f=>{f.evidence[evidenceFile][0].trigger='something else';}],
  ['deleted evidence reference',f=>{delete f.evidence[evidenceFile];}],
  ['consumer position changed',f=>{f.inventory.items[0].consumers[0].line=2;}],
  ['consumer list expanded',f=>{f.inventory.items[0].consumers.push({file:'app/other.mjs',line:1,column:1});}],
  ['same copy but changed behavior source',f=>{f.inventory.source.inputs[0].sha256=hash('show on selection');}],
  ['missing context file',f=>{f.inventory.source.inputs=[];}],
  ['empty context binding',f=>{f.ledger.catalogueReviews[0].context.files=[];}],
  ['missing agent attribution',f=>{delete f.ledger.catalogueReviews[0].review.by;}],
  ['missing trigger rationale',f=>{f.ledger.catalogueReviews[0].review.rationale='';}],
])test(name+' reopens unknown and never grants a whole-key review',()=>{
  const f=fixture();change(f);apply(f);
  assert.equal(f.inventory.items[0].review.state,'unreviewed');
  assert.equal(f.inventory.items[0].review.classification,'unknown');
  assert.ok(f.inventory.auditLedger.reopened.length>0);
});
test('duplicate locale records invalidate both instead of accepting whichever is last',()=>{
  const f=fixture();f.ledger.catalogueReviews.push(structuredClone(f.ledger.catalogueReviews[0]));apply(f);
  assert.equal(f.inventory.items[0].localeReviews.en.state,'unknown');
  assert.equal(f.inventory.counts.reviewedItems,0);
});
test('missing one language stays partial with every remaining locale state visible',()=>{
  const f=fixture();f.ledger.catalogueReviews.pop();apply(f);
  assert.equal(f.inventory.counts.reviewedLocaleValues,3);
  assert.equal(f.inventory.counts.reviewedItems,0);
  assert.equal(f.inventory.items[0].localeReviews.ja.state,'unknown');
});
test('structural decisions keep historical evidence separate from current unknown and never count as catalogue',()=>{
  const f=fixture();const decision={file:'app/view.mjs',key:'removed routine shell',after:null,handling:'delete',surface:'chapter',trigger:'ordinary reading',rationale:'Heading already identifies the page.'};
  f.evidence[evidenceFile].push(decision);
  f.ledger.structuralDecisions.push({id:'get218-structure-4',evidence:{file:evidenceFile,index:4,recordSha256:hash(JSON.stringify(decision))},by:'agent',surface:decision.surface,trigger:decision.trigger,rationale:decision.rationale});
  apply(f);
  assert.equal(f.inventory.auditLedger.structuralDecisions[0].historicalEvidence,'verified');
  assert.equal(f.inventory.auditLedger.structuralDecisions[0].currentState,'unknown');
  assert.equal(f.inventory.counts.reviewedItems,1);
  f.evidence[evidenceFile][4].rationale='Changed evidence';apply(f);
  assert.equal(f.inventory.auditLedger.structuralDecisions[0].historicalEvidence,'unknown');
});

test('the maintained GET-218 ledger binds exactly its delivered 92 values, with dynamic denominators and separate structural evidence',async()=>{
  const root=fileURLToPath(new URL('../',import.meta.url));
  const inventory=await collectCopy({root});
  await module.loadCopyLedger({root,inventory});
  const ledger=JSON.parse(await readFile(path.join(root,'docs/copy/copy-ledger.json'),'utf8'));
  assert.equal(ledger.catalogueReviews.length,92);
  assert.equal(new Set(ledger.catalogueReviews.map(row=>row.key)).size,23);
  assert.equal(inventory.counts.reviewedLocaleValues+inventory.auditLedger.reopened.length,92,'drift is explicit rather than silently re-attested');
  assert.equal(inventory.counts.unreviewedItems,inventory.items.length-inventory.counts.reviewedItems);
  assert.equal(inventory.auditLedger.structuralDecisions.length,19);
  assert.ok(inventory.auditLedger.structuralDecisions.every(row=>row.currentState==='unknown'));
  assert.equal(inventory.auditLedger.humanReviewed,false);
});

test('an admitted static UI T1 reaches the real pinned Vale; a clean control passes',{skip:!process.env.LEAFHOUR_VALE_BIN&&'explicit pinned Vale path required'},async t=>{
  const root=await mkdtemp(path.join(tmpdir(),'copy-ledger-static-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const repo=fileURLToPath(new URL('../',import.meta.url));
  const version=spawnSync(process.env.LEAFHOUR_VALE_BIN,['--version'],{encoding:'utf8'});
  assert.equal(version.status,0);assert.match(version.stdout,/3\.24\.0/);
  await mkdir(path.join(root,'app/ui-catalogs'),{recursive:true});
  for(const locale of locales)await writeFile(path.join(root,'app/ui-catalogs',locale+'.mjs'),'export default Object.freeze({"a":"Read"});\n');
  for(const [value,exit] of [['Read a book',0],['Retry the receipt',1]]){
    await writeFile(path.join(root,'app/view.mjs'),'label.textContent='+JSON.stringify(value)+';\n');
    const inventory=await collectCopy({root}),candidate=inventory.candidates[0];
    const review={candidateId:candidate.id,locale:'en',by:'agent',valueSha256:candidate.sha256,sourceSha256:inventory.source.inputs.find(input=>input.file===candidate.file).sha256,surface:'synthetic navigation button',trigger:'open the fixture',rationale:'Synthetic explicit visible label admission tests the real lint seam.',state:'reviewed'};
    const outDir=path.join(root,exit?'t1':'clean');await exportCopy({inventory,outDir,reviews:[review]});
    const manifest=JSON.parse(await readFile(path.join(outDir,'manifest.json'),'utf8'));
    const entry=manifest.items.find(item=>item.id===candidate.id);
    assert.equal(entry.kind,'static-literal');assert.equal(entry.review.by,'agent');
    const result=spawnSync(process.env.LEAFHOUR_VALE_BIN,['--config',path.join(repo,'.vale.ini'),'--output','JSON',path.join(outDir,'en.txt')],{encoding:'utf8'});
    assert.equal(result.status,exit,result.stdout+result.stderr);
    const alerts=Object.values(JSON.parse(result.stdout)).flat();
    if(exit)assert.ok(alerts.some(alert=>alert.Check==='Leafhour.DevSpeak'&&alert.Line===entry.startLine&&alert.Severity==='error'));
    else assert.equal(alerts.length,0);
  }
});
