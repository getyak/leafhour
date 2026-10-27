import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createReaderServer} from '../server/server.mjs';
test('real public person route loads with owned tools while unauthorized writes and foreign origins fail',async t=>{
 const directory=await mkdtemp(path.join(tmpdir(),'leafhour-people-integration-'));
 const app=await createReaderServer({bookPath:path.join(directory,'absent.json'),recordsPath:path.join(directory,'records.json'),portalDataDir:path.join(directory,'portal'),translator:null,chatGenerator:null,companionGenerator:null,introductionGenerator:null,speechProvider:null,paddleProvider:null,env:{}});
 await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+app.address().port;
 t.after(async()=>{app.closeAllConnections();await new Promise(r=>app.close(r));await app.portal.chat.close();await rm(directory,{recursive:true,force:true});});
 const page=await fetch(base+'/people/virginia-woolf');assert.equal(page.status,200);assert.match(await page.text(),/people-content/);
 const list=await fetch(base+'/api/people');assert.equal(list.status,200);assert.ok((await list.json()).people.some(p=>p.id==='virginia-woolf'));
 const data=await fetch(base+'/api/people/virginia-woolf');assert.equal(data.status,200);assert.equal((await data.json()).originalName,'Virginia Woolf');
 const stale=await fetch(base+'/api/people',{headers:{'X-Reader-Owner':'another-account'}});assert.equal(stale.status,409);assert.equal(stale.headers.get('X-Reader-Session-Changed'),'1');
 const anonymous=await fetch(base+'/api/people/virginia-woolf/update',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({requestId:'no',expectedRevision:1,patch:{intro:{en:'Forged'}}})});assert.equal(anonymous.status,401);
 const foreign=await fetch(base+'/api/people/virginia-woolf/update',{method:'POST',headers:{Origin:'https://foreign.example','Content-Type':'application/json'},body:'{}'});assert.equal(foreign.status,403);
 for(const file of ['person-model.mjs','paper-companion.mjs','reader-style-ready.mjs','reader-loading.mjs','person-return-controller.mjs','reader-companion-loader.mjs','person-entry.css'])assert.equal((await fetch(base+'/'+file)).status,200,file);
});
