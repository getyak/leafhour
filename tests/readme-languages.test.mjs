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

test('the READMEs and the MCP guides document the same adapter tools',async()=>{
  const toolsOf=text=>[...new Set([...text.matchAll(/reader_(?:get|add)_[a-z_]+|reader_search/g)].map(match=>match[0]))].sort();
  const guideOf=locale=>({'en':'app/en/mcp.html','zh-CN':'app/zh-hans/mcp.html','zh-Hant':'app/zh-hant/mcp.html',ja:'app/ja/mcp.html'})[locale];
  const readmeTools={},guideTools={};
  for(const [locale,file]of Object.entries(readmes)){
    readmeTools[locale]=toolsOf(await readFile(new URL('../'+file,import.meta.url),'utf8'));
    guideTools[locale]=toolsOf(await readFile(new URL('../'+guideOf(locale),import.meta.url),'utf8'));
    assert.deepEqual(guideTools[locale],readmeTools[locale],locale+' MCP guide must document the same tools as its README');
  }
  for(const [locale,tools]of Object.entries(readmeTools))assert.deepEqual(tools,readmeTools.en,locale+' README tool list drifted from English');
  for(const [locale,tools]of Object.entries(guideTools))assert.deepEqual(tools,guideTools.en,locale+' MCP guide tool list drifted from English');
  assert.ok(readmeTools.en.includes('reader_get_manifest'),'the documented tools must cover the manifest reader');
});
