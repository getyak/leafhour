import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {bookCoverLabels as labels} from '../app/book-cover-labels.mjs';
const locales=['en','zh-Hans','zh-Hant','ja'];
test('cover identities cover exactly the public editions in all four interface languages',async()=>{
 const catalog=JSON.parse(await fs.readFile(new URL('../catalog/manifest.json',import.meta.url),'utf8'));
 assert.deepEqual(Object.keys(labels).sort(),catalog.map(b=>b.id).sort());
 for(const [id,entry]of Object.entries(labels)){
  assert.deepEqual(Object.keys(entry).sort(),[...locales].sort(),id);
  for(const locale of locales){const row=entry[locale];assert.equal(typeof row.title,'string');assert.ok(row.title.trim(),id+' title '+locale);assert.equal(typeof row.author,'string');assert.ok(row.author.trim(),id+' author '+locale);if(row.subtitle!==undefined)assert.equal(typeof row.subtitle,'string');}
 }
});
test('separate volumes retain distinct cover identities in every language',()=>{
 for(const prefix of ['gutenberg-dream-red-chamber-','gutenberg-essays-montaigne-','gutenberg-world-will-idea-']){
  for(const locale of locales){
   const values=[1,2,3].map(n=>labels[prefix+n][locale]);
   assert.equal(new Set(values.map(row=>row.title+' '+row.subtitle)).size,3,prefix+' '+locale);
   values.forEach((row,i)=>assert.ok((row.title+' '+row.subtitle).includes(String(i+1)),prefix+' volume '+(i+1)+' '+locale));
  }
 }
});
test('localized labels preserve Chinese source language and actual bundled reading scope',()=>{
 for(const id of ['gutenberg-analects-zh','gutenberg-mencius-zh','gutenberg-zhuangzi-zh','gutenberg-art-of-war-zh','gutenberg-tao-te-ching-zh','gutenberg-dream-red-chamber-1','gutenberg-dream-red-chamber-2','gutenberg-dream-red-chamber-3']){
  assert.match(labels[id].ja.subtitle,/中国語/,id+' does not promise Japanese text');
  assert.match(labels[id].en.subtitle,/Chinese/i,id+' English display describes source text');
 }
 assert.match(labels['gutenberg-walden'].en.subtitle,/Civil Disobedience/);
 assert.match(labels['gutenberg-walden'].ja.subtitle,/市民の不服従/);
 const rubaiyat=labels['gutenberg-rubaiyat'];
 assert.match(rubaiyat.en.subtitle,/first and fifth/i);
 assert.match(rubaiyat['zh-Hans'].subtitle,/第\s*1.*第\s*5/);
 assert.match(rubaiyat['zh-Hant'].subtitle,/第\s*1.*第\s*5/);
 assert.match(rubaiyat.ja.subtitle,/初版.*第\s*5/);
 assert.match(rubaiyat.en.author,/FitzGerald/);
});
