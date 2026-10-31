import test from 'node:test';
import assert from 'node:assert/strict';
import {zipSync,strToU8} from 'fflate';
import {extractDocument,makeBook,digest} from '../server/document-import.mjs';
import {createLibraryService} from '../server/library-service.mjs';
import {validateLibraryBackup} from '../app/library-backup.mjs';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

// Real ZIP/XML inputs: sorting filenames, dropping fragments, executing markup or
// trusting archive size claims must change the observable imported book.
const xhtml=body=>'<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>Source</title></head><body>'+body+'</body></html>';
function archive({nav=true,body,extra={},packageText}={}){
 const files={mimetype:'application/epub+zip','META-INF/container.xml':'<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="OPS/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
 'OPS/package.opf':packageText||'<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="uid">urn:test</dc:identifier><dc:title>Synthetic Reading</dc:title><dc:creator>Test Author</dc:creator><dc:language>en</dc:language></metadata><manifest><item id="second" href="a.xhtml" media-type="application/xhtml+xml"/><item id="first" href="z.xhtml" media-type="application/xhtml+xml"/><item id="aside" href="aside.xhtml" media-type="application/xhtml+xml"/>'+(nav?'<item id="nav" href="nav.xhtml" properties="nav" media-type="application/xhtml+xml"/>':'')+'</manifest><spine><itemref idref="first"/><itemref idref="second"/><itemref idref="aside" linear="no"/></spine></package>',
 'OPS/z.xhtml':xhtml(body||'<h1 id="one">Chapter One</h1><p id="p1">First &amp; real paragraph.</p><h2 id="two">Chapter Two</h2><p>Second part.</p>'),
 'OPS/a.xhtml':xhtml('<h1 id="three">Chapter Three</h1><p>Last paragraph.</p>'),
 'OPS/aside.xhtml':xhtml('<p>Not in linear reading order.</p>'),
 ...(nav?{'OPS/nav.xhtml':xhtml('<nav xmlns:epub="http://www.idpf.org/2007/ops" epub:type="toc"><ol><li><a href="z.xhtml#one">One</a></li><li><a href="z.xhtml#two">Two</a></li><li><a href="a.xhtml#three">Three</a></li></ol></nav>')}:{}),...extra};
 return Buffer.from(zipSync(Object.fromEntries(Object.entries(files).map(([name,text])=>[name,strToU8(text)])),{level:0}));
}
async function book(bytes=archive()){const extracted=await extractDocument({filename:'reading.epub',bytes});return makeBook({bookId:'private-test',filename:'reading.epub',sourceHash:digest(bytes),extracted});}

test('a large bounded EPUB keeps more than 1200 real chapters and source publication metadata',async()=>{
 const extra={},items=[],refs=[];for(let i=0;i<1301;i++){extra['OPS/part-'+i+'.xhtml']=xhtml('<h1>Chapter '+i+'</h1><p>Original paragraph '+i+'</p>');items.push('<item id="p'+i+'" href="part-'+i+'.xhtml" media-type="application/xhtml+xml"/>');refs.push('<itemref idref="p'+i+'"/>');}
 const packageText='<package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>A long synthetic book</dc:title><dc:date>2001-02-03</dc:date></metadata><manifest>'+items.join('')+'</manifest><spine>'+refs.join('')+'</spine></package>',b=await book(archive({nav:false,extra,packageText}));
 assert.equal(b.chapters.length,1301);assert.equal(b.sections.at(-1).paragraphs.at(-1).original,'Original paragraph 1300');assert.equal(b.source.publicationDate,'2001-02-03');
});

test('EPUB imports spine order, navigation fragment boundaries, metadata and stable source anchors',async()=>{
 const bytes=archive(),b=await book(bytes),ps=b.sections.flatMap(s=>s.paragraphs);
 assert.equal(b.source.format,'epub');assert.equal(b.source.sha256,digest(bytes));assert.equal(b.source.review,'extracted_unreviewed');
 assert.equal(b.title.zh,'Synthetic Reading');assert.equal(b.author,'Test Author');assert.deepEqual(b.chapters.map(c=>c.title.zh),['One','Two','Three']);
 assert.deepEqual(b.sections.map(s=>s.paragraphs.map(p=>p.original)),[['Chapter One','First & real paragraph.'],['Chapter Two','Second part.'],['Chapter Three','Last paragraph.']]);
 assert.equal(ps[1].source.href,'OPS/z.xhtml');assert.equal(ps[1].source.elementId,'p1');assert.equal(ps[1].source.pdfPage,null);assert.equal(ps[1].source.printedPage,null);
 assert.deepEqual(ps.map(p=>p.id),(await book(bytes)).sections.flatMap(s=>s.paragraphs.map(p=>p.id)));
});
test('missing EPUB navigation uses labelled spine chapters, no fabricated page labels',async()=>{
 const b=await book(archive({nav:false}));assert.equal(b.source.structure,'epub_spine');assert.equal(b.chapters.length,2);assert.match(b.chapters[0].title.zh,/Chapter One/);assert.ok(b.sections.flatMap(s=>s.paragraphs).every(p=>p.source.pdfPage===null));
});
test('EPUB keeps safe text without scripts, remote markup, footnote backlinks or hidden styles',async()=>{
 const b=await book(archive({body:'<h1 id="one">A</h1><p id="p1">Safe<br/>line &lt;script&gt;</p><script>steal()</script><style>secret{}</style><iframe src="https://invalid.example"/><p hidden="hidden">hidden</p><h2 id="two">B</h2><p>End.</p>'}));
 const text=b.sections.flatMap(s=>s.paragraphs.map(p=>p.original)).join(' ');assert.match(text,/Safe/);assert.match(text,/<script>/);assert.doesNotMatch(text,/steal|secret|hidden|invalid/);
});
test('EPUB rejects external package href, traversal archive entry, entities, encryption and corrupted XML',async()=>{
 const candidates=[archive({extra:{'../escape':'bad'}}),archive({extra:{'META-INF/encryption.xml':'<encryption/>'}}),archive({extra:{'META-INF/container.xml':'<!DOCTYPE x [<!ENTITY x SYSTEM "file:///etc/passwd">]><container>&x;</container>'}}),archive({extra:{'OPS/z.xhtml':'<html><body><p>broken</body></html>'}}),archive({extra:{'OPS/package.opf':'<package xmlns="http://www.idpf.org/2007/opf"><manifest><item id="x" href="https://invalid.example/a.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="x"/></spine></package>'}})];
 for(const bytes of candidates)await assert.rejects(book(bytes),e=>e.status>=400&&/EPUB|路径|XML|加密|外部|实体/.test(e.message));
});
test('EPUB detects ZIP CRC corruption rather than storing damaged original as readable',async()=>{
 const bytes=archive(),needle=Buffer.from('First &amp; real paragraph.'),i=bytes.indexOf(needle);assert.ok(i>0);bytes[i]^=1;await assert.rejects(book(bytes),/校验|ZIP|EPUB/);
});
test('EPUB original bytes survive duplicate upload and remain owner scoped',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'leafhour-epub-'));try{const library=await createLibraryService({dataDir:dir,catalogDir:null}),user={id:'one'},bytes=archive(),a=await library.importDocument(user,{filename:'reading.epub',bytes}),b=await library.importDocument(user,{filename:'again.epub',bytes});assert.equal(a.bookId,b.bookId);assert.equal((await library.list(user)).length,1);assert.deepEqual((await library.getOriginal(user,a.bookId)).bytes,bytes);await assert.rejects(library.getOriginal({id:'two'},a.bookId),e=>e.status===404);}finally{await rm(dir,{recursive:true,force:true});}
});

test('EPUB proofreading evidence is escaped source XHTML from the verified private original',async()=>{const dir=await mkdtemp(path.join(os.tmpdir(),'leafhour-epub-evidence-'));try{const library=await createLibraryService({dataDir:dir,catalogDir:null}),user={id:'evidence'},b=await library.importDocument(user,{filename:'proof.epub',bytes:archive()}),p=b.sections[0].paragraphs[1];assert.equal(typeof library.sourceEvidence,'function');const evidence=await library.sourceEvidence(user,b.bookId,{passageId:p.id});assert.equal(evidence.sha256,b.source.sha256);assert.equal(evidence.href,'OPS/z.xhtml');assert.match(evidence.sourceXML,/<p id="p1"/);assert.match(evidence.sourceXML,/First &amp; real paragraph/);await assert.rejects(library.sourceEvidence({id:'other'},b.bookId,{passageId:p.id}),{status:404});}finally{await rm(dir,{recursive:true,force:true});}});

test('numeric EPUB element IDs cannot collide with generated ordinals; comments and clean restore target the exact paragraph',async t=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'leafhour-epub-identities-'));t.after(()=>rm(dir,{recursive:true,force:true}));const user={id:'identity-owner'},library=await createLibraryService({dataDir:dir,catalogDir:null}),bytes=archive({nav:false,body:'<p>First</p><p id="0">Second</p><p id="2">Third</p><p>Fourth</p>'}),b=await library.importDocument(user,{filename:'numeric.epub',bytes}),ps=b.sections.flatMap(s=>s.paragraphs),ids=ps.map(p=>p.id);
 assert.equal(new Set(ids).size,ids.length);assert.deepEqual((await book(bytes)).sections.flatMap(s=>s.paragraphs.map(p=>p.id)),ids);
 await library.addComment(user,b.bookId,{id:'second-only',passageId:ps[1].id,text:'This belongs to Second'});const backup=await library.exportLibrary(user);assert.doesNotThrow(()=>validateLibraryBackup(backup));const fresh=await createLibraryService({dataDir:path.join(dir,'clean'),catalogDir:null});await fresh.restoreLibrary(user,backup);await fresh.restoreOriginal(user,b.bookId,bytes);const restored=await fresh.getBook(user,b.bookId),note=(await fresh.records(user,b.bookId)).comments[0];assert.equal(note.passageId,ps[1].id);assert.equal(restored.sections.flatMap(s=>s.paragraphs).find(p=>p.id===note.passageId).original,'Second');assert.deepEqual((await fresh.getOriginal(user,b.bookId)).bytes,bytes);
});
