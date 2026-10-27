import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,mkdir,readFile,readdir,rm} from 'node:fs/promises';
import {execFileSync,spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {collectCopy,inventoryCsv,candidatesCsv,COPY_SCHEMA_VERSION,UI_LOCALES} from '../scripts/copy-inventory.mjs';
import {exportCopy} from '../scripts/export-copy.mjs';

const REPO_ROOT=path.dirname(fileURLToPath(new URL('../package.json',import.meta.url)));

async function fixture(t,files){
  const root=await mkdtemp(path.join(tmpdir(),'copy-inventory-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  for(const [file,content] of Object.entries(files)){
    const target=path.join(root,file);
    await mkdir(path.dirname(target),{recursive:true});
    await writeFile(target,content);
  }
  return root;
}
function catalogueModule(entries){
  const body=entries.map(([key,value])=>'  '+JSON.stringify(key)+': '+JSON.stringify(value)+',').join('\n');
  return '// fixture catalogue\nexport default Object.freeze({\n'+body+'\n});\n';
}
const four=(over={})=>({
  'app/ui-catalogs/en.mjs':catalogueModule([['a','Alpha'],['b','Beta']]),
  'app/ui-catalogs/zh-Hans.mjs':catalogueModule([['a','阿尔法'],['b','贝塔']]),
  'app/ui-catalogs/zh-Hant.mjs':catalogueModule([['a','阿爾法'],['b','貝塔']]),
  'app/ui-catalogs/ja.mjs':catalogueModule([['a','アルファ'],['b','ベータ']]),
  ...over
});

test('four-locale key mismatch is reported as unresolved parity, never guessed away',async t=>{
  const root=await fixture(t,four({'app/ui-catalogs/ja.mjs':catalogueModule([['a','アルファ']])}));
  const inventory=await collectCopy({root});
  assert.equal(inventory.schemaVersion,COPY_SCHEMA_VERSION);
  assert.deepEqual(inventory.locales,UI_LOCALES);
  assert.equal(inventory.parity.ok,false);
  assert.deepEqual(inventory.parity.missing,{b:['ja']});
  const item=inventory.items.find(entry=>entry.id==='b');
  assert.deepEqual(item.missingLocales,['ja']);
  assert.deepEqual(Object.keys(item.values).sort(),['en','zh-Hans','zh-Hant']);
  assert.equal(inventory.counts.itemsWithMissingLocales,1);
  assert.equal(item.review.state,'unreviewed');
  assert.equal(item.review.classification,'unknown');
  assert.equal(item.review.surface,'unknown');
  assert.equal(item.review.trigger,'unknown');
  await assert.rejects(exportCopy({inventory,outDir:path.join(root,'out')}),/parity/i);
});

test('computed and concatenated catalogue references stay unresolved evidence with their literal fragments',async t=>{
  const root=await fixture(t,four({'app/lookup.mjs':[
    'const strings={};',
    'function pick(key){return strings[key+".ready"];}',
    'function tpl(key){return strings[`reader.${key}.title`];}',
    'function concat(prefix){return strings[prefix+".status"];}',
  ].join('\n')}));
  const inventory=await collectCopy({root});
  assert.ok(inventory.dynamicReferences.length>=3,'computed lookups must be recorded');
  const fragmentEvidence=inventory.dynamicReferences.map(entry=>entry.fragments).flat();
  assert.ok(fragmentEvidence.includes('.ready'),'a dynamic prefix keeps its literal fragment as evidence');
  assert.ok(fragmentEvidence.includes('.status'));
  assert.ok(fragmentEvidence.includes('.title'));
  for(const entry of inventory.dynamicReferences){
    assert.equal(entry.unresolved,true);
    assert.equal(entry.file,'app/lookup.mjs');
    assert.ok(entry.line>=1&&entry.expression.length>0);
  }
  assert.ok(inventory.counts.dynamicConsumers>=3);
  assert.equal(inventory.items.find(entry=>entry.id==='a').review.state,'unreviewed','no human decision is inferred');
});

test('DOM literal candidates on different lines stay distinct rows with source references',async t=>{
  const root=await fixture(t,four({'app/view.mjs':[
    'const label=document.createElement("span");',
    'label.textContent="文字一";',
    'node.textContent="文字二";',
  ].join('\n')}));
  const inventory=await collectCopy({root});
  const candidates=inventory.candidates.filter(entry=>entry.file==='app/view.mjs');
  assert.equal(candidates.length,2);
  assert.deepEqual(candidates.map(entry=>entry.line),[2,3]);
  assert.equal(new Set(candidates.map(entry=>entry.id)).size,2,'candidate ids must stay stable and distinct');
  assert.deepEqual(candidates.map(entry=>entry.value),['文字一','文字二']);
  for(const entry of candidates){
    assert.equal(entry.kind,'js-dom-literal');
    assert.equal(entry.property,'textContent');
    assert.equal(entry.review.state,'unknown');
    assert.equal(entry.review.classification,'unknown');
  }
});

test('aria, title, placeholder and alt HTML attributes are exact candidates',async t=>{
  const root=await fixture(t,four({'app/page.html':[
    '<!doctype html><html><body>',
    '<img src="/x.png" alt="封面">',
    '<button title="更多"></button>',
    '<input placeholder="搜索">',
    '<span aria-label="关闭"></span>',
    '</body></html>'
  ].join('\n')}));
  const inventory=await collectCopy({root});
  const candidates=inventory.candidates.filter(entry=>entry.file==='app/page.html');
  assert.deepEqual(candidates.map(entry=>entry.property).sort(),['alt','aria-label','placeholder','title']);
  assert.deepEqual(candidates.map(entry=>entry.value).sort(),['关闭','封面','搜索','更多']);
  for(const entry of candidates){
    assert.equal(entry.kind,'html-attribute');
    assert.equal(entry.sha256.length,64);
  }
});

test('multiline, HTML-like and protected source text survive extraction byte-exact and stay labelled',async t=>{
  const value='第一章\n<b>引文</b> "/books/样本.pdf"\nhttps://leafhour.com/help';
  const root=await fixture(t,four({'app/render.mjs':'node.textContent='+JSON.stringify(value)+';\n'}));
  const inventory=await collectCopy({root});
  const candidate=inventory.candidates.find(entry=>entry.file==='app/render.mjs');
  assert.equal(candidate.value,value,'extraction must not lose words or rewrite HTML-like text');
  assert.equal(candidate.protected,true);
  assert.ok(candidate.protectionReason,'protected source carries its reason as evidence');
  const urlCandidate=inventory.candidates.find(entry=>entry.value==='https://leafhour.com/help')||candidate;
  assert.ok(urlCandidate.protectionReason.includes('url')||candidate.protectionReason.includes('url'));
  assert.ok(inventory.counts.candidatesProtected>=1);
});

test('duplicate catalogue ids are recorded at every source location, never overwritten',async t=>{
  const source='// duplicate fixture\nexport default Object.freeze({\n  "x": "first",\n  "x": "second",\n});\n';
  const root=await fixture(t,four({'app/ui-catalogs/en.mjs':source}));
  const inventory=await collectCopy({root});
  const item=inventory.items.find(entry=>entry.id==='x');
  assert.deepEqual(item.duplicates.map(entry=>entry.line),[3,4],'both source rows must survive');
  assert.deepEqual(item.duplicates.map(entry=>entry.value),['first','second']);
  assert.equal(inventory.counts.duplicateKeys,1);
  await assert.rejects(exportCopy({inventory,outDir:path.join(root,'out')}),/duplicate/i);
});

test('an empty corpus is an explicit state, not a silent success',async t=>{
  const root=await fixture(t,{});
  const inventory=await collectCopy({root});
  assert.equal(inventory.corpus,'empty');
  assert.equal(inventory.counts.catalogueKeys,0);
  assert.equal(inventory.items.length,0);
  await assert.rejects(exportCopy({inventory,outDir:path.join(root,'out')}),/empty/i);
});

test('source references and review state stay evidence-bound for every item',async t=>{
  const root=await fixture(t,four({'app/use.mjs':"ui.text(node,'a');\nconst label='外部文字';\n"}));
  const inventory=await collectCopy({root});
  const a=inventory.items.find(entry=>entry.id==='a');
  const b=inventory.items.find(entry=>entry.id==='b');
  assert.deepEqual(a.consumers.map(entry=>[entry.file,entry.line]),[['app/use.mjs',1]]);
  assert.deepEqual(b.consumers,[],'a missing static reference is not proof of unused copy');
  assert.equal(b.review.state,'unreviewed');
  for(const item of inventory.items){
    assert.ok(item.hints.every(hint=>typeof hint.confidence==='string'&&hint.evidence.length>0),'hints carry confidence and source evidence');
    assert.equal(item.review.decision,'unknown');
  }
  const literal=inventory.candidates.find(entry=>entry.value==='外部文字');
  assert.equal(literal.review.state,'unknown');
  assert.equal(literal.review.trigger,'unknown');
});

test('inventory CSV quoting keeps columns aligned for commas, quotes and newlines',async t=>{
  const tricky='say "hi", now\nnext line';
  const root=await fixture(t,four({'app/ui-catalogs/en.mjs':catalogueModule([['a','Alpha'],['b',tricky]])}));
  const inventory=await collectCopy({root});
  const csv=inventoryCsv(inventory);
  const rows=csv.trimEnd().split('\n');
  assert.ok(csv.startsWith('id,kind,file,line,surface,trigger,classification,decision,review,'));
  assert.ok(rows.some(row=>row.includes('"say ""hi"", now')));
  const parsed=parseCsv(csv);
  const row=parsed.find(entry=>entry[0]==='b');
  assert.equal(row[9],tricky,'the quoted cell keeps the exact value');
});

test('CSV preserves edge whitespace as quoted data without whitespace errors in source diffs',async t=>{
  const root=await fixture(t,four({
    'app/ui-catalogs/ja.mjs':catalogueModule([['a','前の '],['b',' 後の ']]),
    'app/edge.mjs':'node.textContent="保留空格 ";\n'
  }));
  const inventory=await collectCopy({root});
  const catalogue=inventoryCsv(inventory),candidates=candidatesCsv(inventory);
  for(const csv of [catalogue,candidates])assert.doesNotMatch(csv,/[ \t]+$/m,'padding belongs inside quoted cells');
  const rows=parseCsv(catalogue);
  assert.equal(rows.find(row=>row[0]==='a')[12],'前の ');
  assert.equal(rows.find(row=>row[0]==='b')[12],' 後の ');
  assert.ok(parseCsv(candidates).some(row=>row.at(-1)==='保留空格 '));
});

test('export writes deterministic per-locale text plus a complete line-to-item map',async t=>{
  const multiline='第一行\n第二行';
  const root=await fixture(t,four({'app/ui-catalogs/zh-Hans.mjs':catalogueModule([['a','阿尔法'],['b',multiline]]),'app/extra.mjs':'node.textContent="额外文字";\n'}));
  const inventory=await collectCopy({root});
  const outDir=path.join(root,'out');
  const first=await exportCopy({inventory,outDir});
  for(const locale of UI_LOCALES){
    const text=await readFile(path.join(outDir,locale+'.txt'),'utf8');
    assert.ok(text.length>0,'exports must never be an empty corpus');
    assert.ok(text.endsWith('\n'));
  }
  const zh=await readFile(path.join(outDir,'zh-Hans.txt'),'utf8');
  assert.equal(zh,'阿尔法\n'+multiline+'\n','values are preserved exactly, words never lost');
  const manifest=JSON.parse(await readFile(path.join(outDir,'manifest.json'),'utf8'));
  assert.deepEqual(manifest.locales,UI_LOCALES);
  for(const locale of UI_LOCALES){
    const covered=new Map();
    for(const entry of manifest.items.filter(candidate=>candidate.locale===locale)){
      assert.equal(entry.sha256.length,64);
      for(let line=entry.startLine;line<=entry.endLine;line++){
        assert.equal(covered.has(line),false,'every emitted line maps to exactly one item');
        covered.set(line,entry);
      }
    }
    const text=await readFile(path.join(outDir,locale+'.txt'),'utf8');
    assert.equal(covered.size,text.split('\n').length-1,'the map covers every emitted line');
  }
  const zhEntries=manifest.items.filter(entry=>entry.locale==='zh-Hans');
  assert.equal(zhEntries.find(entry=>entry.id==='b').startLine,2,'multiline text maps back to its own item');
  assert.deepEqual(first.counts,manifest.counts);
  const second=await exportCopy({inventory,outDir});
  assert.equal(second.manifestText===first.manifestText,true,'two runs must be byte-identical');
  for(const locale of UI_LOCALES){
    assert.equal((await readFile(path.join(outDir,locale+'.txt'),'utf8'))===first.files[locale],true);
  }
  const candidatesText=candidatesCsv(inventory);
  assert.ok(candidatesText.includes('candidate:app/extra.mjs'));
});

test('the current repository inventory is four-locale complete and keeps unresolved counts honest',async t=>{
  const inventory=await collectCopy({root:REPO_ROOT});
  assert.equal(inventory.corpus,'populated');
  assert.ok(inventory.counts.catalogueKeys>0);
  assert.equal(inventory.parity.ok,true,'frozen source keeps four-language key parity');
  assert.deepEqual(inventory.parity.missing,{});
  assert.equal(inventory.counts.itemsComplete,inventory.counts.catalogueKeys);
  assert.equal(inventory.counts.reviewedItems,0,'nothing has been individually reviewed in batch A');
  assert.equal(inventory.counts.unreviewedItems,inventory.counts.catalogueKeys);
  assert.equal(inventory.counts.candidatesUnreviewed,inventory.counts.candidates);
  assert.ok(inventory.counts.dynamicConsumers>0,'computed references must be listed as unresolved evidence');
  assert.equal(new Set(inventory.candidates.map(entry=>entry.id)).size,inventory.candidates.length,'every discovered candidate keeps its own stable identity');
  for(const item of inventory.items){
    assert.deepEqual(Object.keys(item.values).sort(),[...UI_LOCALES].sort());
    assert.equal(item.review.classification,'unknown');
    assert.equal(item.review.state,'unreviewed');
  }
});

test('same-line HTML nodes keep distinct stable identities without merging',async t=>{
  const root=await fixture(t,four({'app/index.html':'<button aria-label="Close" title="More">Read</button><span>Next</span>\n'}));
  const inventory=await collectCopy({root});
  const candidates=inventory.candidates.filter(entry=>entry.file==='app/index.html');
  assert.deepEqual(candidates.map(entry=>entry.value),['Close','More','Read','Next'],'every attribute and text node survives separately');
  assert.equal(new Set(candidates.map(entry=>entry.id)).size,4,'distinct nodes must never share an identity');
  assert.equal(new Set(candidates.map(entry=>entry.column)).size,candidates.map(entry=>entry.column).length,'each node keeps its real column');
  assert.deepEqual(candidates.map(entry=>entry.line),[1,1,1,1]);
  for(const entry of candidates)assert.equal(entry.id,'candidate:app/index.html:'+entry.line+':'+entry.column);
  const twice=await collectCopy({root});
  assert.deepEqual(twice.candidates,candidates,'discovery is deterministic and never re-merges nodes');
});

test('plain UI labels stay reviewable while keys, paths, URLs and quotes stay protected source',async t=>{
  const root=await fixture(t,four({'app/labels.mjs':["label.textContent=\"Close\";","label.title=\"ui.accountLocale.reading\";","label.alt=\"/books/样本.pdf\";","label.placeholder=\"https://leafhour.com/help\";","node.textContent=\"「存在与虚无，第一卷序言很长很长」\";"].join('\n')}));
  const inventory=await collectCopy({root});
  const byValue=new Map(inventory.candidates.map(entry=>[entry.value,entry]));
  assert.equal(byValue.get('Close').protected,false,'a one-word UI label is copy, not protected source');
  assert.match(byValue.get('ui.accountLocale.reading').protectionReason,/identifier/);
  assert.match(byValue.get('/books/样本.pdf').protectionReason,/path/);
  assert.match(byValue.get('https://leafhour.com/help').protectionReason,/url/);
  assert.match(byValue.get('「存在与虚无，第一卷序言很长很长」').protectionReason,/quotation/);
});

test('the generated inventory binds input bytes, not the current commit',async t=>{
  const root=await fixture(t,four({'app/index.html':'<button aria-label="Close" title="More">Read</button><span>Next</span>\n'}));
  const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  git('init');git('add','app');git('-c','user.name=Synthetic worker','-c','user.email=worker@example.invalid','commit','-m','synthetic initial');
  const first=await collectCopy({root});
  git('-c','user.name=Synthetic worker','-c','user.email=worker@example.invalid','commit','--allow-empty','-m','metadata only');
  const second=await collectCopy({root});
  assert.equal(JSON.stringify(first),JSON.stringify(second),'an unrelated commit must never change the generated inventory');
  assert.equal(first.source.binding,'input-sha256');
  assert.equal(first.source.commit,undefined,'tracked artifacts never embed the execution commit');
  assert.ok(first.source.inputs.some(entry=>entry.file==='app/ui-catalogs/en.mjs'&&/^[a-f0-9]{64}$/.test(entry.sha256)));
  assert.match(first.source.inputDigest,/^[a-f0-9]{64}$/);
  await writeFile(path.join(root,'app/ui-catalogs/en.mjs'),catalogueModule([['a','Alpha changed'],['b','Beta']]));
  const third=await collectCopy({root});
  assert.notEqual(third.source.inputDigest,first.source.inputDigest,'a real input edit must change the source identity');
  assert.notEqual(third.items.find(entry=>entry.id==='a').values.en.sha256,first.items.find(entry=>entry.id==='a').values.en.sha256);
});

test('export appends only explicitly reviewed static literals to their own locale corpus',async t=>{
  const root=await fixture(t,four({'app/view.mjs':["label.textContent=\"Save your receipt\";","node.textContent=\"retry the receipt now\";"].join('\n'),'app/page.html':'<a href="/books/样本.pdf">样本.pdf</a>\n'}));
  const inventory=await collectCopy({root});
  const reviewed=inventory.candidates.find(entry=>entry.value==='Save your receipt');
  const unknown=inventory.candidates.find(entry=>entry.value==='retry the receipt now');
  const protectedPath=inventory.candidates.find(entry=>entry.value==='样本.pdf');
  assert.ok(reviewed&&unknown&&protectedPath);
  const reviews=[{candidateId:reviewed.id,locale:'en',valueSha256:reviewed.sha256,by:'agent',sourceSha256:inventory.source.inputs.find(input=>input.file===reviewed.file).sha256,surface:'reader toolbar',trigger:'after an AI translation saves',rationale:'Adjudicated as visible toolbar copy in GET-202 batch A review record.',state:'reviewed'}];
  const outDir=path.join(root,'out');
  const result=await exportCopy({inventory,outDir,reviews});
  const en=await readFile(path.join(outDir,'en.txt'),'utf8');
  assert.ok(en.endsWith('Save your receipt\n'),'the adjudicated literal is appended to its locale corpus');
  assert.ok(!en.includes('retry the receipt now'));
  for(const locale of ['zh-Hans','zh-Hant','ja'])assert.ok(!(await readFile(path.join(outDir,locale+'.txt'),'utf8')).includes('Save your receipt'));
  const manifest=JSON.parse(result.manifestText);
  const staticItem=manifest.items.find(entry=>entry.id===reviewed.id);
  assert.equal(staticItem.kind,'static-literal');
  assert.equal(staticItem.locale,'en');
  assert.equal(staticItem.sha256,reviewed.sha256);
  assert.equal(manifest.counts.reviewedStaticItems,1);
  assert.equal(inventory.candidates.find(entry=>entry.id===unknown.id).review.state,'unknown','unknown candidates never become reviewed rows');
  assert.equal(inventory.candidates.find(entry=>entry.id===protectedPath.id).review.state,'unknown');
});

test('stale, unknown, duplicate and incomplete review decisions fail closed',async t=>{
  const root=await fixture(t,four({'app/view.mjs':["label.textContent=\"Save your receipt\";","node.textContent=\"Retry again\";"].join('\n'),'app/page.html':'<a href="/books/样本.pdf">样本.pdf</a>\n'}));
  const inventory=await collectCopy({root});
  const reviewed=inventory.candidates.find(entry=>entry.value==='Save your receipt');
  const protectedPath=inventory.candidates.find(entry=>entry.value==='样本.pdf');
  const valid=()=>({candidateId:reviewed.id,locale:'en',valueSha256:reviewed.sha256,by:'agent',sourceSha256:inventory.source.inputs.find(input=>input.file===reviewed.file).sha256,surface:'reader toolbar',trigger:'after save',rationale:'Adjudicated as visible toolbar copy in the batch A review record.',state:'reviewed'});
  const outDir=path.join(root,'out');
  await assert.rejects(exportCopy({inventory,outDir,reviews:[{...valid(),candidateId:'candidate:app/nope.html:1:1'}]}),/unknown|candidate/i);
  await assert.rejects(exportCopy({inventory,outDir,reviews:[{...valid(),valueSha256:'a'.repeat(64)}]}),/hash|stale/i);
  await assert.rejects(exportCopy({inventory,outDir,reviews:[valid(),valid()]}),/duplicate/i);
  await assert.rejects(exportCopy({inventory,outDir,reviews:[{...valid(),rationale:''}]}),/rationale/i);
  await assert.rejects(exportCopy({inventory,outDir,reviews:[{...valid(),locale:'fr'}]}),/locale/i);
  await assert.rejects(exportCopy({inventory,outDir,reviews:[{...valid(),candidateId:protectedPath.id,valueSha256:protectedPath.sha256}]}),/protected/i);
  await assert.rejects(exportCopy({inventory,outDir,reviews:[{...valid(),state:'unknown'}]}),/state|reviewed/i);
});

test('export refuses an inventory whose declared value hash is wrong',async t=>{
  const root=await fixture(t,four());
  const inventory=await collectCopy({root});
  inventory.items.find(entry=>entry.id==='a').values.en.sha256='a'.repeat(64);
  await assert.rejects(exportCopy({inventory,outDir:path.join(root,'out')}),/hash/i);
});

test('HTML attribute coordinates locate quoted values even when attribute names repeat them',async t=>{
  for(const quote of ['"',"'"]){
    const html='<span title='+quote+'title'+quote+' aria-label='+quote+'aria'+quote+'>Text</span>\n';
    const root=await fixture(t,four({'app/page.html':html}));
    const inventory=await collectCopy({root});
    for(const value of ['title','aria']){
      const candidate=inventory.candidates.find(entry=>entry.value===value);
      assert.equal(candidate.kind,'html-attribute');
      assert.equal(candidate.column,html.indexOf(quote+value+quote)+2,'coordinates must start after the opening quote');
      assert.equal(candidate.line,1);
    }
  }
});

test('reviewed static bytes are verified before any export write',async t=>{
  const root=await fixture(t,four({'app/view.mjs':'label.textContent="Save the receipt";\n'}));
  const inventory=await collectCopy({root});
  const candidate=inventory.candidates.find(entry=>entry.value==='Save the receipt');
  const reviews=[{candidateId:candidate.id,locale:'en',valueSha256:candidate.sha256,by:'agent',sourceSha256:inventory.source.inputs.find(input=>input.file===candidate.file).sha256,surface:'reader toolbar',trigger:'after save',rationale:'Synthetic explicit adjudication of this visible toolbar label.',state:'reviewed'}];
  await exportCopy({inventory,outDir:path.join(root,'valid'),reviews});
  candidate.value='New changed receipt';
  const outDir=path.join(root,'rejected');
  await assert.rejects(exportCopy({inventory,outDir,reviews}),/hash/i);
  await assert.rejects(readdir(outDir),{code:'ENOENT'},'validation precedes directory creation');
});

test('static admission names the agent and reopens when the surrounding UI source changes',async t=>{
  const root=await fixture(t,four({'app/view.mjs':'label.textContent="Read";\n'}));
  const inventory=await collectCopy({root});
  const candidate=inventory.candidates.find(entry=>entry.value==='Read');
  const review={candidateId:candidate.id,locale:'en',valueSha256:candidate.sha256,by:'agent',sourceSha256:inventory.source.inputs.find(input=>input.file===candidate.file).sha256,surface:'reader button',trigger:'open the book',rationale:'Source inspection confirms this is visible navigation copy.',state:'reviewed'};
  await exportCopy({inventory,outDir:path.join(root,'valid-agent'),reviews:[review]});
  await assert.rejects(exportCopy({inventory,outDir:path.join(root,'no-agent'),reviews:[{...review,by:undefined}]}),/attribution|agent|by/i);
  await writeFile(path.join(root,'app/view.mjs'),'label.textContent="Read";\nlabel.hidden=true;\n');
  const changed=await collectCopy({root});
  await assert.rejects(exportCopy({inventory:changed,outDir:path.join(root,'stale-context'),reviews:[review]}),/source|context|stale/i);
  assert.equal(changed.candidates.find(entry=>entry.id===candidate.id).review.state,'unknown');
});

test('CLI requires an existing explicit review registry, including the default empty registry',async t=>{
  const root=await fixture(t,four({'docs/copy/copy-reviewed.json':JSON.stringify({reviews:[]}),'docs/copy/copy-ledger.json':JSON.stringify({schemaVersion:1,catalogueReviews:[],structuralDecisions:[]})}));
  const run=(out,...args)=>spawnSync(process.execPath,[path.join(REPO_ROOT,'scripts/export-copy.mjs'),'--root',root,'--out',out,...args],{encoding:'utf8',env:{PATH:process.env.PATH,HOME:process.env.HOME}});
  assert.equal(run('valid-default').status,0,'an explicitly empty default registry is valid');
  assert.equal(run('valid-explicit','--reviews',path.join(root,'docs/copy/copy-reviewed.json')).status,0);
  for(const [out,args] of [['missing-explicit',['--reviews',path.join(root,'absent.json')]],['missing-argument',['--reviews']]]){
    const result=run(out,...args);
    assert.equal(result.status,1,result.stdout+result.stderr);
    await assert.rejects(readdir(path.join(root,out)),{code:'ENOENT'});
  }
  await rm(path.join(root,'docs/copy/copy-reviewed.json'));
  const missingDefault=run('missing-default');
  assert.equal(missingDefault.status,1,missingDefault.stdout+missingDefault.stderr);
  await assert.rejects(readdir(path.join(root,'missing-default')),{code:'ENOENT'});
});

function parseCsv(text){
  const rows=[];let row=[],cell='',quoted=false;
  for(let i=0;i<text.length;i++){
    const ch=text[i];
    if(quoted){
      if(ch==='"'&&text[i+1]==='"'){cell+='"';i++;}
      else if(ch==='"'){quoted=false;}
      else cell+=ch;
    }else if(ch==='"'){quoted=true;}
    else if(ch===','){row.push(cell);cell='';}
    else if(ch==='\n'){row.push(cell);rows.push(row);row=[];cell='';}
    else cell+=ch;
  }
  if(cell.length||row.length){row.push(cell);rows.push(row);}
  return rows;
}
