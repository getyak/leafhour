import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createReaderServer} from '../server/server.mjs';
import {providerMeterContext} from '../server/provider-metering.mjs';

test('dedicated guide HTTP authenticates and caches without a normal chat or quote',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'leafhour-guide-http-'));let calls=0,chatCalls=0;
 const server=await createReaderServer({recordsPath:path.join(dir,'records.json'),env:{READER_BILLING_ENABLED:'true',CREEM_MODE:'test'},sendCode:null,translator:null,chatGenerator:async()=>{chatCalls++;throw Error('guide must not use ordinary chat');},companionGenerator:null,readingGuideGenerator:async()=>{calls++;assert.equal(providerMeterContext().funding,'sponsored');assert.equal(providerMeterContext().feature,'reading-guide');return {opening:'A fixture discusses games.',method:'Compare the definitions in the opening.',readingQuestion:'What makes a game end?',model:'isolated-fixture'};}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});});
 const base='http://127.0.0.1:'+server.address().port,session=await server.portal.auth.localSession();
 const book=await server.portal.library.importDocument(session.user,{filename:'Games.txt',bytes:Buffer.from('Finite games end.')}),url=base+'/api/library/reading-guide';
 const headers={Cookie:'marginalia_session='+session.token,'X-Reader-Owner':session.user.id,'Content-Type':'application/json',Origin:base};
 const body=JSON.stringify({bookId:book.bookId,contentVersion:book.contentVersion,sourceKind:'cloud',locale:'en'});
 assert.equal((await fetch(url,{method:'POST',headers:{...headers,'X-Reader-Owner':'other'},body})).status,409);
 assert.equal((await fetch(url,{method:'POST',headers:{...headers,Origin:'https://outside.invalid'},body})).status,403);
 const response=await fetch(url,{method:'POST',headers,body});assert.equal(response.status,200);assert.match(response.headers.get('cache-control'),/no-store/);
 assert.equal((await response.json()).guide.sourceKind,'cloud');assert.equal((await fetch(url,{method:'POST',headers,body})).status,200);
 assert.equal(calls,1);assert.equal(chatCalls,0);assert.equal((await server.portal.chat.view(session.user,book.bookId)).turns.length,0);
 const unknown=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json',Origin:base},body});assert.equal(unknown.status,401);
});

test('HTTP read-only status never generates; concurrent ensure shares the original request',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'get407-http-'));let release,started,calls=0;const began=new Promise(r=>started=r);
 const server=await createReaderServer({recordsPath:path.join(dir,'records.json'),env:{},translator:null,sendCode:null,chatGenerator:null,companionGenerator:null,readingGuideGenerator:async()=>{calls++;started();return new Promise(r=>release=r);}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});});
 const base='http://127.0.0.1:'+server.address().port,session=await server.portal.auth.localSession(),book=await server.portal.library.importDocument(session.user,{filename:'Opening.txt',bytes:Buffer.from('A bounded original opening.')});
 const headers={Cookie:'marginalia_session='+session.token,'X-Reader-Owner':session.user.id,'Content-Type':'application/json',Origin:base},target={bookId:book.bookId,contentVersion:book.contentVersion,sourceKind:'cloud',locale:'en'},call=async action=>{const response=await fetch(base+'/api/library/reading-guide',{method:'POST',headers,body:JSON.stringify({...target,action})});assert.equal(response.status,200);return response.json();};
 assert.equal((await call('view')).state,'missing');assert.equal(calls,0);const pending=call('ensure');await began;assert.equal((await call('ensure')).state,'preparing');assert.equal((await call('view')).state,'preparing');assert.equal(calls,1);
 release({opening:'Fixed welcome.',method:'Read the opening.',readingQuestion:'What do you notice?',model:'isolated'});assert.equal((await pending).state,'ready');assert.equal((await call('view')).state,'ready');assert.equal(calls,1);
});
