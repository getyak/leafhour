import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {loadPeopleSeeds} from '../server/people-sources.mjs';
import {validatePersonRecord,PERSON_LOCALES} from '../app/person-model.mjs';
const root=new URL('../',import.meta.url);
test('three researched public cases have genuine authored locale content and continuous lifetimes',async()=>{
 const seeds=await loadPeopleSeeds({});assert.deepEqual(seeds.map(p=>p.id).sort(),['james-p-carse','mary-shelley','virginia-woolf']);
 for(const person of seeds){validatePersonRecord(person,{publicBookIds:['gutenberg-au-room-of-ones-own','gutenberg-frankenstein']});for(const value of [person.names,person.intro,...person.events.flatMap(e=>[e.title,e.body]),...person.works.flatMap(w=>[w.title,w.summary]),...person.contexts.map(c=>c.body)])for(const locale of PERSON_LOCALES)assert.ok(value[locale]?.trim(),person.id+' '+locale);assert.equal(person.events[0].date.value,person.birth.value);assert.equal(person.events.at(-1).date.value,person.death.value);assert.ok(person.events.every(e=>e.date.value<=person.death.value),'posthumous events outside lifetime');}
 const woolf=seeds.find(p=>p.id==='virginia-woolf'),shelley=seeds.find(p=>p.id==='mary-shelley');assert.ok(woolf.events.length>=14);assert.ok(shelley.events.length>=14);assert.ok(woolf.works.length>=6);assert.ok(shelley.works.length>=6);
});
test('local excerpts match current public catalogue and external 1831 intro stays external',async()=>{
 const seeds=await loadPeopleSeeds({});for(const [id,file]of [['virginia-woolf','room-of-ones-own'],['mary-shelley','frankenstein']]){const book=JSON.parse(await readFile(new URL('catalog/world/'+file+'.json',root),'utf8')),text=book.chapters.flatMap(c=>c.paragraphs).join('\n\n');for(const excerpt of seeds.find(p=>p.id===id).excerpts){if(excerpt.sourceId.endsWith('-local'))assert.ok(text.includes(excerpt.text));if(excerpt.sourceId==='shelley-1831'){assert.ok(excerpt.locator.includes('PG42324'));assert.ok(!excerpt.locator.includes('passageId='));assert.ok(!text.includes(excerpt.text));}}}
 const carse=seeds.find(p=>p.id==='james-p-carse');assert.deepEqual(carse.excerpts,[]);assert.equal(carse.works[0].bookId,null);assert.equal(carse.portrait,null);
});
test('source fingerprints and portrait licence records bind actual local assets',async()=>{
 const seeds=await loadPeopleSeeds({});const licenses=JSON.parse(await readFile(new URL('app/assets/people/licenses.json',root),'utf8'));
 for(const person of seeds){for(const source of person.sources)assert.equal(source.digest,createHash('sha256').update(source.excerpt).digest('hex'));if(person.portrait){const license=licenses.assets.find(a=>a.personId===person.id);assert.equal(person.portrait.url,'/assets/people/'+license.file);const bytes=await readFile(new URL('app/assets/people/'+license.file,root));assert.equal(createHash('sha256').update(bytes).digest('hex'),license.sha256);assert.ok(license.licenseEvidence.includes('public domain'));assert.equal(person.portrait.sourceId,license.sourceId);}}
});
test('false exact quotation cannot pass schema merely by citing an existing source',async()=>{const [record]=await loadPeopleSeeds({});record.excerpts[0].text+=' fabricated tail';assert.throws(()=>validatePersonRecord(record,{publicBookIds:['gutenberg-au-room-of-ones-own','gutenberg-frankenstein']}),/exactly match/);});
test('Shelley date claims keep the inspected date column and marriage sentence in bounded proof',async()=>{
 const p=(await loadPeopleSeeds()).find(p=>p.id==='mary-shelley'),sources=new Map(p.sources.map(s=>[s.id,s]));assert.match(sources.get('shelley-chilterns').excerpt,/At the end of 1816[\s\S]*he and Mary were married/);for(const [claim,date]of [['s-stepfamily','1801'],['s-travel','1814'],['claim-shelley-valperga','1823']]){const c=p.claims.find(c=>c.id===claim);assert.ok(c.sourceIds.some(id=>sources.get(id).excerpt.includes(date)));}for(const s of p.sources)if(!/public domain/i.test(s.license))assert.ok(s.excerpt.split(/\s+/).length<=25,s.id+' must keep a bounded extract');
});
test('each non-public-domain source keeps at most 25 quoted words in total',async()=>{
 const seeds=await loadPeopleSeeds(),totals=new Map();for(const p of seeds)for(const s of p.sources){if(/public domain|CC0/i.test(s.license))continue;const key=new URL(s.url).href;totals.set(key,(totals.get(key)||0)+s.excerpt.trim().split(/\s+/).length);assert.ok(s.license.includes('Selected short evidence excerpts only'));}for(const [url,n]of totals)assert.ok(n<=25,url+' '+n);
 const woolf=seeds.find(p=>p.id==='virginia-woolf'),mary=seeds.find(p=>p.id==='mary-shelley');assert.equal(woolf.claims.find(c=>c.id==='w-war').status,'uncertain');assert.equal(mary.claims.find(c=>c.id==='s-stepfamily').status,'uncertain');
});
test('all twelve newly authored quotation translations remain drafts with explicit editorial attribution',async()=>{
 const seeds=await loadPeopleSeeds();let count=0;for(const p of seeds)for(const e of p.excerpts)for(const translation of Object.values(e.translations)){count++;assert.equal(translation.status,'draft');assert.equal(translation.attribution,'Leafhour editorial translation; not independently reviewed');}assert.equal(count,12);
});
