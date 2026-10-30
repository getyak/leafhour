import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createLibraryService} from '../server/library-service.mjs';

test('translated iOS note keeps its quotation layer and variant through records and export',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'leafhour-layer-note-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const library=await createLibraryService({dataDir:dir,catalogDir:null}),user={id:'layer-test'};
 const book=await library.importDocument(user,{filename:'source.txt',bytes:Buffer.from('Original passage.')});
 const passage=book.sections[0].paragraphs[0];
 await library.addComment(user,book.bookId,{id:'translation-note',passageId:passage.id,text:'My thought',quote:'译文引句',quoteOrigin:'translation',quoteLanguage:'zh',quoteVariant:'interpretive'});
 const records=await library.records(user,book.bookId),note=records.comments[0];
 assert.equal(note.quoteOrigin,'translation');assert.equal(note.quoteVariant,'interpretive');assert.equal(note.quoteLanguage,'zh');
 const backup=await library.exportLibrary(user);assert.equal(backup.books[0].records.comments[0].quoteVariant,'interpretive');
 const restored=await createLibraryService({dataDir:path.join(dir,'restored'),catalogDir:null});await restored.restoreLibrary(user,backup);
 assert.equal((await restored.records(user,book.bookId)).comments[0].quoteVariant,'interpretive');
});
