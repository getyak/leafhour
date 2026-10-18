import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm,chmod,symlink,link,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readPrivateHostJson,validateHostOrigin,callDailyMcp} from '../tools/lib/daily-reading-host.mjs';
const token='synthetic-daily-private-token',entry=fileURLToPath(new URL('./daily-reading-host-fixture.mjs',import.meta.url));
async function fixture(t){const dir=await mkdtemp(path.join(await realpath(tmpdir()),'daily-host-'));t.after(()=>rm(dir,{recursive:true,force:true}));return dir;}
test('host files require absolute private regular paths without aliases or hard links',async t=>{
 const dir=await fixture(t),file=path.join(dir,'config.json');await writeFile(file,JSON.stringify({token}),{mode:0o600});assert.deepEqual(await readPrivateHostJson(file),{token});
 await chmod(file,0o644);await assert.rejects(readPrivateHostJson(file),{code:'private-file'});await chmod(file,0o600);
 await symlink(dir,path.join(dir,'alias'));await assert.rejects(readPrivateHostJson(path.join(dir,'alias','config.json')),{code:'private-file'});
 await link(file,path.join(dir,'copy.json'));await assert.rejects(readPrivateHostJson(file),{code:'private-file'});await assert.rejects(readPrivateHostJson('relative.json'),{code:'private-file'});
});
test('host files and origins fail closed with fixed errors that never echo input',async t=>{
 const dir=await fixture(t),file=path.join(dir,'config.json');await writeFile(file,'invalid-'+token,{mode:0o600});await assert.rejects(readPrivateHostJson(file),e=>e.code==='private-json'&&!e.message.includes(token));
 await writeFile(file,'x'.repeat(17000));await assert.rejects(readPrivateHostJson(file),{code:'private-file'});
 for(const value of ['http://leafhour.com','https://user:secret@leafhour.com','https://leafhour.com/api','https://leafhour.com?token=secret','https://leafhour.com#token'])assert.throws(()=>validateHostOrigin(value),e=>e.code==='host-config'&&!e.message.includes('secret'));
 assert.equal(validateHostOrigin('https://leafhour.com'),'https://leafhour.com');assert.equal(validateHostOrigin('http://localhost:8330'),'http://localhost:8330');
});
test('official SDK bridge calls only daily tools, injects token into child env and closes the actual child',async t=>{
 const prior=process.env.OPENAI_API_KEY;process.env.OPENAI_API_KEY='synthetic-parent-only-key';t.after(()=>{if(prior===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=prior;});
 let pid;const result=await callDailyMcp({config:{serviceUrl:'https://leafhour.com',token},toolName:'reader_daily_claim',args:{bookId:'synthetic'},serverEntry:entry,onChild:id=>{pid=id;}});
 assert.equal(result.status,'quiet');assert.equal(result.tokenPresent,true);assert.equal(result.unrelatedKeyPresent,false);assert.ok(pid);assert.throws(()=>process.kill(pid,0),e=>e.code==='ESRCH');
 await assert.rejects(callDailyMcp({config:{serviceUrl:'https://leafhour.com',token},toolName:'reader_get_notes',args:{},serverEntry:entry}),{code:'host-tool'});
});
test('tool errors, private-token echoes and oversized replies are masked and always close the child',async()=>{
 for(const mode of ['error','echo','oversize']){
  let pid;await assert.rejects(callDailyMcp({config:{serviceUrl:'https://leafhour.com',token},toolName:'reader_daily_claim',args:{bookId:'synthetic',mode},serverEntry:entry,onChild:id=>{pid=id;}}),e=>e.code==='host-response'&&!e.message.includes(token));
  assert.throws(()=>process.kill(pid,0),e=>e.code==='ESRCH');
 }
});
