import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createLibraryService} from '../server/library-service.mjs';

test('explicit keep, replace and new preserve source and independent records across reopen and retries',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'leafhour-copy-'));
 try {
  let library=await createLibraryService({dataDir:dir,catalogDir:null});const user={id:'copy-owner'},input={filename:'original.txt',bytes:Buffer.from('Original source.\n\nSecond paragraph.')};
  const first=await library.importDocument(user,input);
  await library.addComment(user,first.bookId,{id:'note-1',passageId:first.sections[0].paragraphs[0].id,text:'Original personal note'});
  const keep=await library.importDocument(user,{...input,duplicatePolicy:'keep'});assert.equal(keep.bookId,first.bookId);
  const replace=await library.importDocument(user,{...input,duplicatePolicy:'replace'});assert.equal(replace.bookId,first.bookId);
  assert.equal((await library.records(user,first.bookId)).comments.length,1);
  const operationId=randomUUID(),copy=await library.importDocument(user,{...input,duplicatePolicy:'new',operationId});assert.notEqual(copy.bookId,first.bookId);assert.equal(copy.source.sha256,first.source.sha256);assert.equal((await library.records(user,copy.bookId)).comments.length,0);
  library=await createLibraryService({dataDir:dir,catalogDir:null});
  assert.equal((await library.importDocument(user,{...input,duplicatePolicy:'new',operationId})).bookId,copy.bookId);
  assert.equal((await library.list(user)).length,2);
  const restored=await createLibraryService({dataDir:path.join(dir,'restored'),catalogDir:null});
  await restored.restoreLibrary(user,await library.exportLibrary(user));
  assert.equal((await restored.list(user)).length,2);
  assert.equal((await restored.records(user,first.bookId)).comments.length,1);
  assert.equal((await restored.records(user,copy.bookId)).comments.length,0);
  assert.equal((await library.findDuplicate({id:'another-owner'},{sha256:first.source.sha256})),null);
  assert.equal((await library.getOriginal(user,copy.bookId)).bytes.toString(),input.bytes.toString());
  await assert.rejects(library.importDocument(user,{...input,duplicatePolicy:'new'}));
  await assert.rejects(library.importDocument(user,{...input,bytes:Buffer.from('Different source'),duplicatePolicy:'new',operationId}),{status:409});
 }finally{await rm(dir,{recursive:true,force:true});}
});
