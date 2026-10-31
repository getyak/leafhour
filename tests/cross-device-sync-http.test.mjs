import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createReaderServer} from '../server/server.mjs';

test('account shelf HTTP is owner scoped and two independent reading streams union their intervals',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'leafhour-cross-device-http-')),owner={id:'00000000-0000-4000-8000-000000000911',email:'synthetic@example.test'},token='a'.repeat(43);
 const server=await createReaderServer({portalDataDir:path.join(dir,'portal'),recordsPath:path.join(dir,'records.json'),bookPath:path.join(dir,'absent.json'),sendCode:null,translator:null,env:{},authService:{userFor:async value=>value===token?owner:null}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await rm(dir,{recursive:true,force:true});});
 const base='http://127.0.0.1:'+server.address().port,headers={Origin:base,Cookie:'marginalia_session='+token,'X-Reader-Owner':owner.id,'Content-Type':'application/json'};
 const book=await server.portal.library.importDocument(owner,{filename:'synthetic.txt',bytes:Buffer.from('An isolated cross-device original.')}),anchor={chapterId:book.chapters[0].id,passageId:book.sections[0].paragraphs[0].id},bookPath='/api/library/books/'+book.bookId;
 assert.equal((await fetch(base+'/api/library?view=account')).status,401);
 assert.equal((await fetch(base+'/api/library?view=account',{headers:{...headers,'X-Reader-Owner':'another-owner'}})).status,409);
 let response=await fetch(base+'/api/library?view=account',{headers}),snapshot=await response.json();assert.equal(response.status,200);assert.equal(snapshot.kind,'leafhour-account-shelf-v1');assert.equal(snapshot.user.id,owner.id);
 response=await fetch(base+'/api/library/pins',{method:'POST',headers,body:JSON.stringify({bookIds:[book.bookId],pinned:true,baseRevision:snapshot.shelfRevision})});assert.equal(response.status,200);assert.deepEqual((await response.json()).pinned,[book.bookId]);
 const start=Date.now()-180000,stamp=offset=>new Date(start+offset*1000).toISOString();
 for(const [id,a,b]of [['synthetic-web-reading',0,60],['synthetic-ios-reading',30,90]]){
  const input={id,bookId:book.bookId,contentVersion:book.contentVersion,source:'reader_estimate',sequence:1,status:'finished',startedAt:stamp(a),endedAt:stamp(b),timeZone:'UTC',start:anchor,end:anchor,segments:[{startedAt:stamp(a),endedAt:stamp(b)}]};
  response=await fetch(base+bookPath+'/reading-sessions',{method:'POST',headers,body:JSON.stringify(input)});assert.equal(response.status,201);const saved=await response.json();assert.equal(saved.id,id);assert.equal(saved.durationSeconds,60);
  response=await fetch(base+bookPath+'/reading-sessions',{method:'POST',headers,body:JSON.stringify(input)});assert.equal(response.status,201);assert.equal((await response.json()).id,id);
 }
 response=await fetch(base+'/api/library/reading-summary?month='+stamp(0).slice(0,7)+'&timeZone=UTC',{headers});assert.equal(response.status,200);assert.equal((await response.json()).allTime.durationSeconds,90);
 snapshot=await(await fetch(base+'/api/library?view=account',{headers})).json();const row=snapshot.books.find(item=>item.bookId===book.bookId);assert.equal(row.lastReadAt,stamp(90));assert.equal(row.pinned,true);assert.equal(row.readingStateReady,true);
});
