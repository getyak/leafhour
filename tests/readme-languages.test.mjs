import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

// The repository front matter mirrors the public website languages. A feature
// change must reach every README variant, or the translations drift apart.
const readmes={
  en:'README.md',
  'zh-CN':'README.zh-CN.md',
  'zh-Hant':'README.zh-Hant.md',
  ja:'README.ja.md'
};
const navs={
  en:'**English** | [简体中文](README.zh-CN.md) | [繁體中文](README.zh-Hant.md) | [日本語](README.ja.md)',
  'zh-CN':'[English](README.md) | **简体中文** | [繁體中文](README.zh-Hant.md) | [日本語](README.ja.md)',
  'zh-Hant':'[English](README.md) | [简体中文](README.zh-CN.md) | **繁體中文** | [日本語](README.ja.md)',
  ja:'[English](README.md) | [简体中文](README.zh-CN.md) | [繁體中文](README.zh-Hant.md) | **日本語**'
};

test('every README variant links the others and marks its own language',async()=>{
  for(const [locale,file]of Object.entries(readmes)){
    const text=await readFile(new URL('../'+file,import.meta.url),'utf8');
    assert.ok(text.includes(navs[locale]),file+' must carry the shared language navigation');
    assert.ok(text.includes('https://leafhour.com'),file+' must link the website');
    assert.ok(text.includes('https://github.com/getyak/leafhour'),file+' must link the repository');
  }
  for(const [locale,file]of Object.entries(Object.fromEntries(Object.keys(readmes).map(l=>[l,l==='en'?'SECURITY.md':'SECURITY.'+l+'.md'])))){
    const security=await readFile(new URL('../'+file,import.meta.url),'utf8');
    assert.ok(security.includes('SUPABASE_SECRET_KEY'),file+' must keep the credential warning');
  }
});

test('the README variants describe the same supported formats and sections',async()=>{
  const headings={},formats={};
  for(const [locale,file]of Object.entries(readmes)){
    const text=await readFile(new URL('../'+file,import.meta.url),'utf8');
    // Upload pipeline lists PDF, EPUB, TXT and Markdown in one run per language.
    const pipeline=text.split('\n').find(line=>/PDF/.test(line)&&/Markdown/.test(line)&&/→/.test(line))||'';
    for(const token of ['PDF','EPUB','TXT','Markdown'])assert.ok(pipeline.includes(token),file+' upload pipeline must list '+token+': '+pipeline);
    const extraction=text.split('\n').find(line=>/PDF/.test(line)&&/OCR/i.test(line))||'';
    assert.ok(extraction.includes('EPUB'),file+' extraction notes must cover EPUB: '+extraction);
    headings[locale]=[...text.matchAll(/^#{2,3} .+$/gm)].map(match=>match[0].match(/^#+/)[0].length);
    formats[locale]=[...text.matchAll(/PDF|EPUB|TXT|Markdown/g)].length;
  }
  const reference=headings.en;
  for(const [locale,sections]of Object.entries(headings))assert.deepEqual(sections,reference,locale+' README must keep the same section structure');
  for(const [locale,count]of Object.entries(formats))assert.ok(count>=4,locale+' README must mention each supported format');
});
