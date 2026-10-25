import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {readingBook} from './reading-fixtures.mjs';

const feature=await import('../app/document-export.mjs').catch(()=>null);
test('book downloads preserve selected chapter, layers and provenance without private records',()=>{
 assert.ok(feature,'Book document export is available');
 const book=structuredClone(readingBook);book.title.zh='阅读 / 閱讀 / 読書';book.source={...book.source,url:'https://example.org/source',copyright:'© Fixture author'};
 book.sections[0].paragraphs[0].translations={literal:{text:'直译',status:'draft'},interpretive:{text:'意译',status:'reviewed'}};
 book.records={comments:[{text:'PRIVATE NOTE'}]};
 const doc=feature.bookExportDocument(book,{chapterId:'ch01',layers:['original','literal'],labels:{original:'Original',literal:'Literal',missing:'Not translated'}});
 const md=feature.documentMarkdown(doc);
 for(const text of ['Read this first.','直译','draft','Not translated','© Fixture author','https://example.org/source','p1','edition-1'])assert.ok(md.includes(text),text);
 for(const text of ['PRIVATE NOTE','意译','Continue from here.'])assert.ok(!md.includes(text),text);
 assert.ok(!/[\\/:*?"<>|\u0000-\u001f]/u.test(feature.documentFilename(doc.title,'markdown')));
 assert.match(feature.documentFilename(doc.title,'markdown'),/\.md$/);
});
test('partial or unknown chapter content cannot masquerade as a complete export',()=>{
 assert.ok(feature);const book=structuredClone(readingBook);book.sections[0].paragraphs[0]={id:'p1',unloaded:true};
 assert.throws(()=>feature.bookExportDocument(book),/content|complete/i);
 assert.throws(()=>feature.bookExportDocument(readingBook,{chapterId:'unknown'}),/chapter/i);
 assert.throws(()=>feature.bookExportDocument(readingBook,{layers:[]}),/layer/i);
});
test('chapter exports keep the catalog source edition, abridgement scope, credits and complete copyright notices',()=>{
 const book=structuredClone(readingBook);book.source={...book.source,edition:'Source edition 1910',scopeNote:'This edition omits illustrations.',credits:'Prepared by the source editors',license:'Licence retained in notices.'};book.licenseNotices='Full original copyright terms.\nSecond licence paragraph.';
 const document=feature.bookExportDocument(book,{chapterId:'ch01'}),text=feature.documentMarkdown(document);
 for(const value of ['Source edition 1910','This edition omits illustrations.','Prepared by the source editors','Full original copyright terms.','Second licence paragraph.'])assert.ok(text.includes(value),value);
});
test('actual PDF bytes keep four-language text searchable across pages, and cancellation yields no file',async()=>{
 const pdf=await import('../app/document-pdf.mjs').catch(()=>null);assert.ok(pdf,'Local PDF generator is available');
 const text='English café — 中文简体，繁體閱讀。日本語の読書。';
 const doc={title:'Unicode reading',blocks:[{kind:'heading',text:'Local PDF'},...Array.from({length:70},(_,i)=>({kind:'paragraph',text:i+' '+text}))]};
 const readAsset=async file=>new Uint8Array(await readFile(new URL('../app/'+file,import.meta.url)));
 const bytes=await pdf.documentPdf(doc,{readAsset});assert.equal(Buffer.from(bytes).subarray(0,5).toString(),'%PDF-');
 const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs');const task=getDocument({data:bytes,useSystemFonts:false,disableFontFace:true});
 const document=await task.promise;try{assert.ok(document.numPages>1);let output='';for(let n=1;n<=document.numPages;n++)output+=(await (await document.getPage(n)).getTextContent()).items.map(i=>i.str).join('');for(const expected of ['English','café','中文简体','繁體閱讀','日本語の読書'])assert.ok(output.includes(expected),expected);}finally{await task.destroy();}
 let checks=0;await assert.rejects(pdf.documentPdf(doc,{readAsset,assertCurrent:()=>{if(++checks>2)throw Error('cancelled');}}),/cancelled/);
});
