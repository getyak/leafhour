import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import path from 'node:path';import {createReaderServer} from '../server/server.mjs';
test('audio HTTP requires an owner, rejects stale identity and serves private exact audio bytes',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'reader-audio-http-')),bytes=Buffer.from([255,251,144,0,1,2,3,4]);
 const server=await createReaderServer({recordsPath:path.join(dir,'records.json'),translator:null,sendCode:null,speechProvider:{available:true,model:'test-model',synthesize:async()=>({bytes,mimeType:'audio/mpeg'})},dialogueGenerator:null});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(async()=>{await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});});
 const base='http://127.0.0.1:'+server.address().port,session=await server.portal.auth.localSession(),headers={Cookie:'marginalia_session='+session.token,'X-Reader-Owner':session.user.id,Origin:base,'Content-Type':'application/json'},book=await server.portal.library.getBook(session.user,'gutenberg-alice'),p=book.sections[0].paragraphs[0],root=base+'/api/library/books/'+book.bookId+'/audio/',input={chapterId:book.sections[0].chapterId,contentVersion:book.contentVersion,language:'en',parts:[{passageId:p.id,start:0,end:8}],idempotencyKey:'http-one'};
 const post=(action,h=headers)=>fetch(root+action,{method:'POST',headers:h,body:JSON.stringify(input)});
 assert.equal((await post('sessions',{'Content-Type':'application/json',Origin:base})).status,401);
 assert.equal((await post('sessions',{...headers,Origin:'https://other.example'})).status,403);
 assert.equal((await post('sessions',{...headers,'X-Reader-Owner':'another'})).status,409);
 const response=await post('sessions');assert.equal(response.status,202);let s=await response.json();for(let i=0;i<30&&s.status==='generating';i++){await new Promise(r=>setTimeout(r,15));s=await(await fetch(root+'sessions/'+s.id,{headers})).json();}assert.equal(s.status,'ready');
 const clip=await fetch(root+'clips/'+s.clips[0].id,{headers});assert.match(clip.headers.get('content-type'),/audio\/mpeg/);assert.deepEqual(Buffer.from(await clip.arrayBuffer()),bytes);assert.match(clip.headers.get('cache-control'),/private/);
 assert.equal((await fetch(root+'clips/'+s.clips[0].id)).status,401);
 const textBackup=await(await fetch(root+'export?audio=0',{headers})).json();assert.deepEqual(textBackup.audio,[]);assert.equal(textBackup.sessions.length,1);
 const capabilities=await(await fetch(root+'capabilities')).json();assert.equal(capabilities.speechAvailable,true);assert.ok(!JSON.stringify(capabilities).includes('API_KEY'));
});
