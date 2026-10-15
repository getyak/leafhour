import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createReaderServer} from '../server/server.mjs';
test('the bookshelf fetches only the requested paragraph and private previews remain account scoped',async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'reader-room-preview-'));
  const server=await createReaderServer({recordsPath:path.join(dir,'records.json'),translator:null,sendCode:null});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));await rm(dir,{recursive:true,force:true});});
  const base='http://127.0.0.1:'+server.address().port;
  const response=await fetch(base+'/api/library/books/gutenberg-alice/preview');assert.equal(response.status,200);
  const preview=await response.json();assert.equal(typeof preview.passageId,'string');assert.equal(typeof preview.original,'string');assert.equal(preview.sections,undefined);assert.equal(preview.translationStatus.interpretive,'draft');assert.ok(JSON.stringify(preview).length<20000);
  const selected=await fetch(base+'/api/library/books/gutenberg-alice/preview?passageId=missing');assert.equal(selected.status,404);
  const session=await server.portal.auth.localSession(),privateBook=await server.portal.library.importDocument(session.user,{filename:'private.txt',bytes:Buffer.from('Private paragraph.\n\nAnother paragraph.')});
  assert.equal((await fetch(base+'/api/library/books/'+privateBook.bookId+'/preview')).status,404);
  const own=await fetch(base+'/api/library/books/'+privateBook.bookId+'/preview',{headers:{Cookie:'marginalia_session='+session.token,'X-Reader-Owner':session.user.id}});assert.equal(own.status,200);assert.equal((await own.json()).original,'Private paragraph.');
});
