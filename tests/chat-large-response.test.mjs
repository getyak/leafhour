import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createReaderServer} from '../server/server.mjs';

test('large conversation history streams valid JSON instead of exceeding the buffered response envelope',async t=>{
 const directory=await mkdtemp(path.join(tmpdir(),'leafhour-large-chat-'));
 const summary='A'.repeat(1500000),question='🙂'.repeat(300000);
 const server=await createReaderServer({recordsPath:path.join(directory,'records.json'),portalDataDir:path.join(directory,'portal'),env:{},translator:null,sendCode:null,chatGenerator:async()=>({kind:'conversation',summary})});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(async()=>{await server.portal.chat.close();await new Promise(resolve=>server.close(resolve));await rm(directory,{recursive:true,force:true});});
 const base='http://127.0.0.1:'+server.address().port,session=await server.portal.auth.localSession();
 const headers={Cookie:'marginalia_session='+session.token,'X-Reader-Owner':session.user.id,'Content-Type':'application/json',Origin:base};
 for(let index=0;index<2;index++){
  const response=await fetch(base+'/api/library/chat',{method:'POST',headers,body:JSON.stringify({id:'large-'+index,text:question,passageId:'conversation',contentVersion:'library-chat-v1'})});
  assert.equal(response.status,200);assert.equal((await response.json()).answer.summary,summary);
 }
 for(const suffix of ['', '/export']){
  const response=await fetch(base+'/api/library/chat'+suffix,{headers});assert.equal(response.status,200);
  assert.equal(response.headers.get('transfer-encoding'),'chunked');assert.equal(response.headers.get('content-length'),null);
  const text=await response.text();assert.ok(Buffer.byteLength(text)>4.5*1024*1024);
  const history=JSON.parse(text);assert.equal(history.turns.length,2);assert.equal(history.turns[0].text,question);assert.equal(history.turns[1].answer.summary,summary);
 }
});
