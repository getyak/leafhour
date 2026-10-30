import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createReaderServer} from '../server/server.mjs';

test('shared reader route authenticates, rejects stale versions and saves only one real library passage',async t=>{
 const dir=await mkdtemp(path.join(await realpath(tmpdir()),'reading-translation-http-')),codes=new Map(),calls=[];
 const server=await createReaderServer({bookPath:path.join(dir,'absent.json'),recordsPath:path.join(dir,'records.json'),sendCode:async(email,code)=>codes.set(email,code),translator:async context=>{calls.push(context);return {literal:'Fixture literal',interpretive:'Fixture interpretive',model:'fixture'};},chatGenerator:null,companionGenerator:null,speechProvider:null,dialogueGenerator:null,guideGenerator:null,paddleProvider:null,env:{}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(async()=>{await new Promise(resolve=>server.close(resolve));await rm(dir,{recursive:true,force:true});});
 const origin='http://127.0.0.1:'+server.address().port,email='automatic-reader@example.test';await server.portal.auth.requestCode(email);const session=await server.portal.auth.verifyCode(email,codes.get(email));
 const moduleResponse=await fetch(origin+'/reader-auto-translation.mjs');assert.equal(moduleResponse.status,200);assert.match(moduleResponse.headers.get('content-type'),/javascript/);
 const book=await server.portal.library.importDocument(session.user,{filename:'automatic.txt',bytes:Buffer.from('The first source paragraph.\n\nThe second source paragraph.')}),body={chapterId:book.chapters[0].id,contentVersion:book.contentVersion,phase:'current'};
 const post=(input=body,token=session.token)=>fetch(origin+'/api/library/books/'+book.bookId+'/reading-translation',{method:'POST',headers:{'Content-Type':'application/json',Origin:origin,...(token?{Cookie:'marginalia_session='+token}:{})},body:JSON.stringify(input)});
 assert.equal((await post(body,null)).status,401);assert.equal((await post({...body,contentVersion:'stale'})).status,409);assert.equal(calls.length,0);
 const response=await post(),receipt=await response.json();assert.equal(response.status,200);assert.equal(receipt.done,false);assert.equal(receipt.passage.id,book.sections[0].paragraphs[0].id);assert.equal(calls.length,1);
 const reread=await server.portal.library.getBook(session.user,book.bookId);assert.equal(reread.sections[0].paragraphs[0].translations.literal.text,'Fixture literal');assert.deepEqual(reread.sections[0].paragraphs[1].translations,{});
 assert.equal((await post({...body,phase:'next'})).status,200);assert.equal(calls.length,1);
});
