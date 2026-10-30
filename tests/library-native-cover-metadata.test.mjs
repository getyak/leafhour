import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createLibraryService} from '../server/library-service.mjs';
import {textPdf} from './pdf-fixture.mjs';

test('shelf provides authenticated original-file cover URL without external lookup',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'leafhour-cover-metadata-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const library=await createLibraryService({dataDir:dir,catalogDir:null}),owner={id:'cover-test'};
 const book=await library.importDocument(owner,{filename:'book.pdf',bytes:textPdf()});
 const shelf=await library.list(owner);
 assert.match(shelf.find(row=>row.bookId===book.bookId).coverImage,new RegExp('^/api/library/books/'+book.bookId+'/cover\\?v=[a-f0-9]{64}$'));
});
