import test from 'node:test';import assert from 'node:assert/strict';
import {PDFDocument,PDFName,PDFString,StandardFonts} from 'pdf-lib';
import {inspectNativePdf,nativePdfOutline} from '../server/pdf-native.mjs';
import {extractDocument,makeBook,digest} from '../server/document-import.mjs';

async function outlinedPdf(rows){
 const doc=await PDFDocument.create(),font=await doc.embedFont(StandardFonts.Helvetica),pages=[];
 for(let n=0;n<5;n++){const page=doc.addPage();page.drawText('Source page '+(n+1)+' has an original readable paragraph.',{font,size:18});pages.push(page);}
 const root=doc.context.obj({Type:'Outlines'}),rootRef=doc.context.register(root);
 const nodes=rows.map(row=>doc.context.obj({Title:PDFString.of(row.title),Parent:rootRef,Dest:row.named?PDFString.of(row.named):doc.context.obj([row.integer??pages[row.page-1].ref,PDFName.of('Fit')])})),refs=nodes.map(node=>doc.context.register(node));
 for(let i=0;i<nodes.length;i++){if(i>0)nodes[i].set(PDFName.of('Prev'),refs[i-1]);if(i+1<nodes.length)nodes[i].set(PDFName.of('Next'),refs[i+1]);}
 root.set(PDFName.of('First'),refs[0]);root.set(PDFName.of('Last'),refs.at(-1));root.set(PDFName.of('Count'),doc.context.obj(rows.length));doc.catalog.set(PDFName.of('Outlines'),rootRef);
 doc.catalog.set(PDFName.of('Dests'),doc.context.obj({namedChapter:doc.context.obj([pages[3].ref,PDFName.of('Fit')])}));
 return Buffer.from(await doc.save());
}

test('real PDF integer, page-reference and named bookmarks resolve in source page order without duplicate cuts',async()=>{
 const bytes=await outlinedPdf([{page:2,title:'Part One'},{page:5,title:'Tail'},{integer:0,title:'Opening'},{page:3,title:'Part Two'},{page:3,title:'Duplicate'},{named:'namedChapter',title:'Named Part'}]);
 assert.deepEqual(await nativePdfOutline(bytes),[{page:1,title:'Opening'},{page:2,title:'Part One'},{page:3,title:'Part Two'},{page:4,title:'Named Part'},{page:5,title:'Tail'}]);
});

test('a single valid PDF bookmark is retained and direct import shares native outline navigation',async()=>{
 const bytes=await outlinedPdf([{integer:1,title:'Only Source Chapter'}]),expected=[{page:2,title:'Only Source Chapter'}];
 assert.deepEqual(await nativePdfOutline(bytes),expected);
 const extracted=await extractDocument({filename:'single-outline.pdf',bytes});assert.deepEqual(extracted.outline,expected);
 const input={bookId:'single-outline',filename:'single-outline.pdf',sourceHash:digest(bytes),extracted},structured=makeBook(input),plain=makeBook({...input,extracted:{...extracted,outline:[]}});
 assert.equal(structured.source.structure,'pdf_outline');assert.deepEqual(structured.chapters.map(c=>c.title.zh),['卷首','Only Source Chapter']);
 assert.deepEqual(structured.sections.flatMap(s=>s.paragraphs.map(p=>[p.id,p.original,p.source.pdfPage])),plain.sections.flatMap(s=>s.paragraphs.map(p=>[p.id,p.original,p.source.pdfPage])));
});

test('unresolvable optional PDF bookmarks do not hide later valid source chapters or readable pages',async()=>{
 const bytes=await outlinedPdf([{named:'missingDestination',title:'Unresolvable'},{page:2,title:'First valid chapter'},{integer:100,title:'Outside source pages'},{page:4,title:'Later valid chapter'}]);
 const expected=[{page:2,title:'First valid chapter'},{page:4,title:'Later valid chapter'}];assert.deepEqual(await nativePdfOutline(bytes),expected);
 const extracted=await extractDocument({filename:'optional-outline.pdf',bytes});assert.equal(extracted.pages.length,5);assert.deepEqual(extracted.outline,expected);assert.match(extracted.pages[4].text,/Source page 5/);
 const invalid=await outlinedPdf([{named:'missingDestination',title:'Unresolvable'}]),fallback=await extractDocument({filename:'invalid-outline.pdf',bytes:invalid});assert.equal(fallback.pages.length,5);assert.deepEqual(fallback.outline,[]);
});
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

test('bookmarks on blank PDF pages coalesce at the next readable paragraph without empty chapters',()=>{
 const b=makeBook({bookId:'blank-outline',filename:'blank.pdf',sourceHash:'b'.repeat(64),extracted:{format:'pdf',review:'extracted_unreviewed',pages:[{page:1,text:'Opening source.'},{page:2,text:''},{page:3,text:'Final source.'}],outline:[{page:2,title:'Blank divider'},{page:3,title:'Final chapter'}]}});
 assert.ok(b.sections.every(s=>s.paragraphs.length>0));assert.equal(b.sections.flatMap(s=>s.paragraphs).length,2);
});
