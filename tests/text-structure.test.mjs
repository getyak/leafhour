import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {extractDocument,makeBook,digest} from '../server/document-import.mjs';
import {createLibraryService} from '../server/library-service.mjs';

async function book(text,filename='reading.txt'){
 const bytes=Buffer.from(text),extracted=await extractDocument({filename,bytes});
 return makeBook({bookId:'synthetic',filename,sourceHash:digest(bytes),extracted});
}
const titles=b=>b.chapters.map(c=>c.title.zh);
const originals=b=>b.sections.flatMap(s=>s.paragraphs.map(p=>p.original));

test('TXT recognizes real Chinese chapters without blank lines and keeps front matter, volumes and tail',async()=>{
 const text='书名\r\n作者\r\n第一卷 起点\r\n第一章 相遇\r\n　　第一段。\r\n第二段。\r\n第２章 归途\r\n最后的正文。\r\n尾声\r\n尾声正文。';
 const b=await book(text);
 assert.deepEqual(titles(b),['卷首','第一卷 起点','第一章 相遇','第２章 归途','尾声']);
 assert.equal(b.source.structure,'text_headings');
 assert.equal(originals(b).join('\n').replace(/\s/g,''),text.replace(/\s/g,''));
 assert.deepEqual(originals(await book(text)),originals(b));
 assert.equal(b.sections[3].paragraphs[0].original,'第２章 归途');
});
test('TXT uses body headings instead of duplicated front TOC entries without dropping the TOC',async()=>{
 const text='目录\n第一章 起点\n第二章 后来\n\n第一章 起点\n正文第一段。\n第二章 后来\n正文最后一段。';
 const b=await book(text);
 assert.deepEqual(titles(b),['卷首','第一章 起点','第二章 后来']);
 assert.match(b.sections[0].paragraphs.map(p=>p.original).join('\n'),/第二章 后来/);
 assert.equal(originals(b).join('\n').replace(/\s/g,''),text.replace(/\s/g,''));
});
test('TXT supports English chapter labels and rejects sentences, page leaders and bare numbered prose',async()=>{
 const b=await book('CONTENTS\nChapter I .... 12\nChapter II .... 30\n\nChapter One: Arrival\nA body line.\n\nCHAPTER II\nAnother body.\n\nPart 3 — Return\nLast body.\n\nEpilogue\nThe end.');
 assert.deepEqual(titles(b),['卷首','Chapter One: Arrival','CHAPTER II','Part 3 — Return','Epilogue']);
 const plain=await book('第一章介绍了这些问题。\nChapter one discusses the problem.\n1. First ordinary list entry\n\nNormal paragraph.');
 assert.equal(plain.source.structure,'automatic_groups');assert.equal(plain.chapters.length,1);
});
test('Markdown uses ATX and Setext headings while preserving lists, tables, fences and source syntax',async()=>{
 const text='# Title\n\nIntro.\n\n## First ##\n- one\n\n- two\n\n| A | B |\n| - | - |\n| c | d |\n\n```md\n# Fake\n\n## Still code\n```\n\n    # Indented code\n\n<!--\n# Hidden\n-->\n\nSecond\n------\nLast **body**.';
 const b=await book(text,'reading.md');
 assert.deepEqual(titles(b),['Title','First','Second']);assert.equal(b.source.structure,'markdown_headings');
 const all=originals(b).join('\n\n');assert.match(all,/```md\n# Fake\n\n## Still code\n```/);assert.match(all,/- one\n\n- two/);assert.match(all,/    # Indented code/);assert.match(all,/Last \*\*body\*\*\./);
 assert.equal(all.replace(/\s/g,''),text.replace(/\s/g,''));
});
test('Markdown long extension reaches the same importer and keeps canonical format',async()=>{
 const b=await book('# Start\n\nText\n\n## Next\n\nEnd','reading.markdown');assert.equal(b.source.format,'md');assert.deepEqual(titles(b),['Start','Next']);
});
test('source evidence uses exact text offsets for late repeated passages; original bytes survive import',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'leafhour-structure-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const library=await createLibraryService({dataDir:dir,catalogDir:null}),user={id:'synthetic-owner'};
 const text='第一章 早晨\r\n相同的一句。\r\n\r\n'+('早晨的正文。\r\n\r\n'.repeat(6000))+'第二章 夜晚\r\n相同的一句。\r\n\r\n夜晚结束。',bytes=Buffer.from(text);
 const b=await library.importDocument(user,{filename:'offset.txt',bytes});
 assert.deepEqual(titles(b),['第一章 早晨','第二章 夜晚']);
 const p=b.sections.at(-1).paragraphs.find(p=>p.original.includes('相同的一句'));
 const evidence=await library.sourceEvidence(user,b.bookId,{passageId:p.id});assert.match(evidence.sourceText,/第二章 夜晚/);assert.match(evidence.sourceText,/夜晚结束/);
 assert.deepEqual((await library.getOriginal(user,b.bookId)).bytes,bytes);
 assert.equal((await library.importDocument(user,{filename:'again.txt',bytes})).bookId,b.bookId);
});

test('TXT accepts spaced and bracketed chapter markers; supplementary Unicode survives context boundaries',async()=>{
 const text='【第 一 章 起点】\n'+('文'.repeat(4999))+'🐿️尾文\n第 二 章 终点\n结束。';
 const b=await book(text);assert.deepEqual(titles(b),['【第 一 章 起点】','第 二 章 终点']);
 const ps=originals(b);assert.ok(ps.every(p=>p.isWellFormed()));assert.equal(ps.join('').replace(/\s/g,''),text.replace(/\s/g,''));
});
test('Markdown initial thematic break and HTML blocks cannot swallow or invent headings',async()=>{
 const b=await book('---\n\n# Actual\n\n<custom>\n# Inside HTML\n</custom>\n\n## End\n\nDone','reading.md');
 assert.deepEqual(titles(b),['卷首','Actual','End']);
});

test('Markdown ignores all raw HTML block forms and retains complete multiline Setext titles',async()=>{
 for(const [open,close] of [['<?php','?>'],['<![CDATA[',']]>'],['<!DOCTYPE','>']]){
   const b=await book('# Real\n\n'+open+'\n# Fake\n'+close+'\n\n## End\nText','reading.md');assert.deepEqual(titles(b),['Real','End']);
 }
 assert.deepEqual(titles(await book('First line\nsecond line\n-----------\n\nBody','reading.md')),['First line second line']);
});
test('TXT running prose that mentions a chapter without final punctuation stays body text',async()=>{
 const b=await book('Chapter 2 shows how to read this book\n\nChapter One discusses the problem\n\n第一章介绍了这些问题');assert.equal(b.source.structure,'automatic_groups');
});

test('TXT written English numbering and terminal numbering punctuation match native chapter forms',async()=>{
 const b=await book('CHAPTER I.\nBody.\n\nBOOK THE FIRST\nBody.\n\nChapter Thirty\nBody.\n\nPart Forty-Two\nLast.');assert.deepEqual(titles(b),['CHAPTER I.','BOOK THE FIRST','Chapter Thirty','Part Forty-Two']);
});

test('Markdown container boundaries and quoted HTML attributes match CommonMark top-level headings',async()=>{
 for(const body of ['<custom data-x=">">\n# Fake\n</custom>','- item\n\n  # Nested','> quotation\nContinuation\n---']){
   const b=await book('# Real\n\n'+body+'\n\n## End\nText','reading.md');assert.deepEqual(titles(b),['Real','End']);
 }
});

test('very long Markdown headings keep their full original and bounded directory labels',async()=>{
 const text='# '+ '长'.repeat(1000)+'\n\n正文。',b=await book(text,'long.md');assert.ok(b.chapters[0].title.zh.length<=120);assert.equal(originals(b).join('\n\n'),text);
});
