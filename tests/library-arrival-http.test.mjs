import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createPortal} from '../server/portal.mjs';
test('arrival HTTP is authenticated, owner-bound, private, and independent of full books',async t=>{
 const dataDir=await mkdtemp(path.join(tmpdir(),'leafhour-arrival-http-')),a={id:'arrival-http-a'},b={id:'arrival-http-b'};
 const portal=await createPortal({dataDir,catalogDir:null,env:{},translator:null,chatGenerator:null,companionGenerator:null,authService:{userFor:async token=>token==='a'?a:token==='b'?b:null}});
 const book=await portal.library.importDocument(a,{filename:'fixture.txt',bytes:Buffer.from('Isolated source.')});
 const server=createServer(async(req,res)=>{const send=(status,body)=>{res.statusCode=status;res.setHeader('Content-Type','application/json');res.end(JSON.stringify(body));};try{await portal.handle({req,res,url:new URL(req.url,'http://fixture.invalid'),send});}catch(error){send(error.status||500,{error:error.message});}});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));await rm(dataDir,{recursive:true,force:true});});const base='http://127.0.0.1:'+server.address().port,route='/api/library/arrival?timeZone=Asia%2FSingapore';
 assert.equal((await fetch(base+route)).status,401);
 assert.equal((await fetch(base+route,{headers:{Cookie:'marginalia_session=a','X-Reader-Owner':b.id}})).status,409);
 const first=await fetch(base+'/api/library?view=books',{headers:{Cookie:'marginalia_session=a','X-Reader-Owner':a.id}});assert.equal(first.status,200);const rows=(await first.json()).books;assert.equal(rows[0].bookId,book.bookId);assert.equal(rows[0].personalizationPending,true);
 const response=await fetch(base+route,{headers:{Cookie:'marginalia_session=b','X-Reader-Owner':b.id}});assert.equal(response.status,200);assert.match(response.headers.get('Cache-Control'),/no-store/);const result=await response.json();assert.equal(result.lastRead,null);assert.deepEqual(result.yesterday.books,[]);
});
