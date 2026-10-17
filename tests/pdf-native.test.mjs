import test from 'node:test';import assert from 'node:assert/strict';
import {PDFDocument,StandardFonts} from 'pdf-lib';
import {inspectNativePdf} from '../server/pdf-native.mjs';
import {makeBook} from '../server/document-import.mjs';
test('native inspection preserves each page and marks empty extraction for recognition instead of dropping it',async()=>{
 const doc=await PDFDocument.create(),font=await doc.embedFont(StandardFonts.Helvetica);doc.addPage().drawText('A readable original page.',{font,size:18});doc.addPage();
 const result=await inspectNativePdf(Buffer.from(await doc.save()));assert.equal(result.pages.length,2);assert.match(result.pages[0].text,/readable original/);assert.equal(result.pages[0].needsRecognition,false);assert.equal(result.pages[1].needsRecognition,true);assert.equal(result.pages[1].page,2);
});
test('real PDF outline boundaries retain original titles and every stable paragraph',()=>{
 const input={bookId:'book',filename:'book.pdf',sourceHash:'a'.repeat(64),extracted:{format:'pdf',review:'extracted_unreviewed',pages:Array.from({length:5},(_,n)=>({page:n+1,text:'Source page '+(n+1)}))}};
 const automatic=makeBook(input),structured=makeBook({...input,extracted:{...input.extracted,outline:[{page:2,title:'Part One'},{page:4,title:'Part Two'}]}});
 assert.equal(structured.source.structure,'pdf_outline');assert.deepEqual(structured.chapters.map(c=>c.title.zh),['卷首','Part One','Part Two']);
 assert.deepEqual(structured.sections.flatMap(s=>s.paragraphs.map(p=>p.id)),automatic.sections.flatMap(s=>s.paragraphs.map(p=>p.id)));
 assert.deepEqual(structured.sections[1].paragraphs.map(p=>p.source.pdfPage),[2,3]);
});
