import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createReaderServer} from '../server/server.mjs';
import {createHash} from 'node:crypto';

test('optional deferred upload returns a small owner-bound receipt and exposes a resumable job through existing HTTP routes',async t=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'leafhour-document-http-')),user={id:'synthetic-document-http',kind:'email'};
 const server=await createReaderServer({bookPath:path.join(dir,'absent.json'),recordsPath:path.join(dir,'records.json'),portalDataDir:path.join(dir,'portal'),allowLocal:false,env:{},authService:{userFor:async()=>user},chatGenerator:null,companionGenerator:null,introductionGenerator:null,paddleProvider:null});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(async()=>{await server.portal.ingestionRunner.close();await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});});const base='http://127.0.0.1:'+server.address().port,headers={Origin:base,'Content-Type':'application/json','X-Reader-Owner':user.id};
 const response=await fetch(base+'/api/library/upload',{method:'POST',headers,body:JSON.stringify({filename:'notes.txt',base64:Buffer.from('A synthetic original paragraph.').toString('base64'),defer:true})}),text=await response.text(),receipt=JSON.parse(text);assert.equal(response.status,202);assert.ok(text.length<2000);assert.equal(receipt.kind,'document');assert.equal(receipt.sections,undefined);assert.match(receipt.id,/^[a-f0-9-]{36}$/);
 const list=await (await fetch(base+'/api/library/ingestion',{headers})).json();assert.equal(list.jobs[0].id,receipt.id);const foreign=await fetch(base+'/api/library/ingestion/'+receipt.id,{headers:{...headers,'X-Reader-Owner':'different-owner'}});assert.equal(foreign.status,409);assert.doesNotMatch(await foreign.text(),/synthetic original paragraph/);
 const source=Buffer.from('Another synthetic original.'),post=async(route,body)=>fetch(base+route,{method:'POST',headers,body:JSON.stringify(body)}),start=await post('/api/library/pdf-upload/start',{filename:'chunk.txt',bytes:source.length,sha256:createHash('sha256').update(source).digest('hex'),mode:'document',consent:false});assert.equal(start.status,201);const upload=await start.json();assert.equal((await post('/api/library/pdf-upload/'+upload.id+'/part',{index:0,base64:source.toString('base64')})).status,200);const complete=await post('/api/library/pdf-upload/'+upload.id+'/complete',{});assert.equal(complete.status,200);const chunkJob=await complete.json();assert.equal(chunkJob.kind,'document');assert.equal(chunkJob.sections,undefined);
});
