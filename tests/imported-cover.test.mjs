import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {PDFDocument,StandardFonts,rgb} from 'pdf-lib';
import {createLibraryService} from '../server/library-service.mjs';
import {zipSync,strToU8} from 'fflate';
import {createCanvas,loadImage} from '@napi-rs/canvas';

function epub({legacy=false,bad=false,missing=false}={}){
 const canvas=createCanvas(300,450);canvas.getContext('2d').fillRect(0,0,300,450);
 const files={mimetype:'application/epub+zip','META-INF/container.xml':'<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OPS/book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
 'OPS/book.opf':'<package xmlns="http://www.idpf.org/2007/opf"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Original Cover</dc:title>'+(legacy?'<meta name="cover" content="art"/>':'')+'</metadata><manifest><item id="text" href="text.xhtml" media-type="application/xhtml+xml"/><item id="art" href="art.png" media-type="image/png"'+(!legacy&&!missing?' properties="cover-image"':'')+'/></manifest><spine><itemref idref="text"/></spine></package>',
 'OPS/text.xhtml':'<html xmlns="http://www.w3.org/1999/xhtml"><body><p>Exact original words survive the cover extraction.</p></body></html>',
 'OPS/art.png':bad?Buffer.from('<svg onload="alert(1)"/>'):canvas.toBuffer('image/png')};
 return Buffer.from(zipSync(Object.fromEntries(Object.entries(files).map(([key,value])=>[key,typeof value==='string'?strToU8(value):value])),{level:0}));
}
async function setup(t){const dir=await mkdtemp(path.join(os.tmpdir(),'leafhour-cover-'));t.after(()=>rm(dir,{recursive:true,force:true}));return createLibraryService({dataDir:dir,catalogDir:null});}
test('TXT gets one generated cover shared by concurrent requests, copies and service restarts within its account',async t=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'leafhour-ai-cover-'));t.after(()=>rm(dir,{recursive:true,force:true}));let calls=0;
 const generator=async book=>{calls++;assert.equal(book.title.zh,'剑来');assert.equal(book.sections,undefined);return {bytes:epubImage(),model:'test-model',prompt:'metadata only'};};
 const library=await createLibraryService({dataDir:dir,catalogDir:null,coverGenerator:generator}),owner={id:'ai-owner'},bytes=Buffer.from('陈平安走在山间。');
 const book=await library.importDocument(owner,{filename:'剑来.txt',bytes});
 await assert.rejects(library.getCover({id:'other'},book.bookId),{status:404});assert.equal(calls,0);
 const [first,second]=await Promise.all([library.getCover(owner,book.bookId),library.getCover(owner,book.bookId)]);assert.deepEqual(first.bytes,second.bytes);assert.equal(calls,1);
 const restarted=await createLibraryService({dataDir:dir,catalogDir:null,coverGenerator:async()=>{throw Error('must stay cached');}});
 assert.deepEqual((await restarted.getCover(owner,book.bookId)).bytes,first.bytes);assert.deepEqual((await library.getOriginal(owner,book.bookId)).bytes,bytes);
 const copy=await library.importDocument(owner,{filename:'剑来.txt',bytes,duplicatePolicy:'new',operationId:'23b49f4b-b3b9-4d6a-a001-a44569e13cdd'});assert.deepEqual((await library.getCover(owner,copy.bookId)).bytes,first.bytes);assert.equal(calls,1);
 assert.match((await library.list(owner))[0].coverImage,/\/cover\?v=/);
});
function epubImage(){const canvas=createCanvas(300,450);return canvas.toBuffer('image/webp');}
test('source cover wins and a missing EPUB cover can generate without losing the original',async t=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'leafhour-ai-epub-'));t.after(()=>rm(dir,{recursive:true,force:true}));let calls=0;
 const library=await createLibraryService({dataDir:dir,catalogDir:null,coverGenerator:async()=>{calls++;return {bytes:epubImage(),model:'test',prompt:'test'};}}),owner={id:'epub-ai'};
 const original=await library.importDocument(owner,{filename:'with.epub',bytes:epub()});await library.getCover(owner,original.bookId);assert.equal(calls,0);
 const missing=await library.importDocument(owner,{filename:'missing.epub',bytes:epub({missing:true})});assert.ok((await library.getCover(owner,missing.bookId)).bytes.length);assert.equal(calls,1);
});
test('cross-instance lease prevents duplicate generation and errors cool down without harming reading',async t=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'leafhour-ai-lease-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 let calls=0,release,started;const ready=new Promise(r=>started=r),blocked=new Promise(r=>release=r);
 const generator=async()=>{calls++;started();await blocked;return {bytes:epubImage(),model:'test',prompt:'test'};};
 const a=await createLibraryService({dataDir:dir,catalogDir:null,coverGenerator:generator}),b=await createLibraryService({dataDir:dir,catalogDir:null,coverGenerator:generator}),owner={id:'lease-owner'};
 const book=await a.importDocument(owner,{filename:'lease.txt',bytes:Buffer.from('Private words.')});
 const first=a.getCover(owner,book.bookId);await ready;await assert.rejects(b.getCover(owner,book.bookId),{status:503});release();await first;assert.equal(calls,1);
 const failed=await a.importDocument(owner,{filename:'failed.txt',bytes:Buffer.from('Reading must continue.')});
 const broken=await createLibraryService({dataDir:dir,catalogDir:null,coverGenerator:async()=>{calls++;throw Error('sensitive provider response');}});
 await assert.rejects(broken.getCover(owner,failed.bookId),error=>error.status===502&&!error.message.includes('sensitive'));const count=calls;
 await assert.rejects(broken.getCover(owner,failed.bookId),{status:503});assert.equal(calls,count);assert.match((await broken.getBook(owner,failed.bookId)).sections[0].paragraphs[0].original,/Reading/);
});
for(const legacy of [false,true])test('EPUB '+(legacy?'2':'3')+' embedded cover remains private, cached and separate from the original',async t=>{
 const library=await setup(t),user={id:'cover-owner'},bytes=epub({legacy}),book=await library.importDocument(user,{filename:'source.epub',bytes});
 assert.equal(typeof library.getCover,'function');const cover=await library.getCover(user,book.bookId),image=await loadImage(cover.bytes);
 assert.equal(cover.mimeType,'image/webp');assert.equal(image.width,300);assert.equal(image.height,450);
 assert.deepEqual((await library.getCover(user,book.bookId)).bytes,cover.bytes);
 await assert.rejects(library.getCover({id:'other'},book.bookId),{status:404});await assert.rejects(library.getCover(null,book.bookId),{status:401});
 assert.deepEqual((await library.getOriginal(user,book.bookId)).bytes,bytes);assert.match((await library.getBook(user,book.bookId)).sections[0].paragraphs[0].original,/Exact original/);
});
test('existing PDF originals render a bounded first-page cover without reimport',async t=>{
 const library=await setup(t),user={id:'pdf-owner'},pdf=await PDFDocument.create(),page=pdf.addPage([400,600]);page.drawRectangle({x:0,y:0,width:400,height:600,color:rgb(.2,.4,.3)});page.drawText('The Original Cover and Its Source Book',{x:25,y:500,size:24,font:await pdf.embedFont(StandardFonts.Helvetica)});
 const bytes=Buffer.from(await pdf.save()),book=await library.importDocument(user,{filename:'source.pdf',bytes});assert.equal(typeof library.getCover,'function');const result=await library.getCover(user,book.bookId),image=await loadImage(result.bytes);assert.ok(image.width<=640&&image.height<=960);assert.equal(result.mimeType,'image/webp');assert.deepEqual((await library.getOriginal(user,book.bookId)).bytes,bytes);
});
test('missing or non-raster EPUB artwork fails without replacing the imported text',async t=>{
 const library=await setup(t),user={id:'cover-fallback'};assert.equal(typeof library.getCover,'function');for(const options of [{missing:true},{bad:true}]){const book=await library.importDocument(user,{filename:'no-cover.epub',bytes:epub(options)});await assert.rejects(library.getCover(user,book.bookId),error=>[404,422].includes(error.status));assert.match((await library.getBook(user,book.bookId)).sections[0].paragraphs[0].original,/Exact original/);}
});

test('cached private artwork is authorized from metadata without loading a full book or translations',async()=>{
 const {authFixture}=await import('./auth-fixture.mjs'),store=authFixture().store(),read=store.read.bind(store),blobs=new Map();let metadataOnly=false;
 store.putBlob=async(file,bytes)=>{blobs.set(file,Buffer.from(bytes));};store.blob=async file=>blobs.get(file);store.blobInfo=async file=>blobs.has(file)?{size:blobs.get(file).length}:null;
 store.read=async(file,fallback)=>{if(metadataOnly&&/\/(?:books|translations)\//.test(file))throw Error('A thumbnail must not load book content');return read(file,fallback);};
 const library=await createLibraryService({dataDir:'/synthetic-cover-cache',catalogDir:null,dataStore:store}),user={id:'cache-owner'},book=await library.importDocument(user,{filename:'original.epub',bytes:epub()});
 metadataOnly=true;const first=await library.getCover(user,book.bookId),cached=await library.getCover(user,book.bookId);assert.deepEqual(cached.bytes,first.bytes);
 await assert.rejects(library.getCover({id:'other'},book.bookId),{status:404});
});
