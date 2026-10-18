import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,stat,readFile,writeFile,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {realpathSync} from 'node:fs';
const testTmpdir=()=>realpathSync(tmpdir());
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createReaderServer} from '../server/server.mjs';
import {digest} from '../server/document-import.mjs';

const cli=fileURLToPath(new URL('../tools/translation-batch.mjs',import.meta.url));
const runCli=(args,{cwd,env})=>new Promise(resolve=>{
  const child=spawn(process.execPath,[cli,...args],{cwd,env:{PATH:process.env.PATH,...env},stdio:['ignore','pipe','pipe']});
  let out='',err='';
  child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
  child.stdout.on('data',chunk=>{out+=chunk;});child.stderr.on('data',chunk=>{err+=chunk;});
  child.once('close',code=>resolve({code,out,err}));
});
async function start(t){
  const dir=await mkdtemp(path.join(testTmpdir(),'translation-batch-cli-'));
  const codes=new Map(),calls=[];
  const provider=async context=>{calls.push(context.passageId);return {literal:'合成直译 '+context.passageId,interpretive:'合成意译 '+context.passageId,model:'synthetic'};};
  const server=await createReaderServer({bookPath:path.join(dir,'absent.json'),recordsPath:path.join(dir,'records.json'),sendCode:async(email,code)=>{codes.set(email,code);},translator:provider,chatGenerator:null,companionGenerator:null,speechProvider:null,dialogueGenerator:null,guideGenerator:null,paddleProvider:null,env:{}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const cwd=path.join(dir,'work');await mkdir(cwd);
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));await rm(dir,{recursive:true,force:true});});
  const base='http://127.0.0.1:'+server.address().port;
  const email='cli-reader@example.test';await server.portal.auth.requestCode(email);
  const session=await server.portal.auth.verifyCode(email,codes.get(email));
  const book=await server.portal.library.importDocument(session.user,{filename:'batch.txt',bytes:Buffer.from('One source paragraph.\n\nTwo source paragraph.\n\nThree source paragraph.')});
  const ids=book.sections[0].paragraphs.map(p=>p.id);
  return {dir,cwd,base,session,book,ids,calls};
}

test('the CLI is dry-run by default, needs the session from the environment and writes nothing',async t=>{
  const f=await start(t);
  const args=['--origin',f.base,'--book',f.book.bookId];
  const missing=await runCli(args,{cwd:f.cwd,env:{}});
  assert.equal(missing.code,2);
  assert.match(missing.err,/LEAFHOUR_SESSION/);
  const dry=await runCli(args,{cwd:f.cwd,env:{LEAFHOUR_SESSION:f.session.token}});
  assert.equal(dry.code,0,dry.err);
  assert.match(dry.out,/演练/);
  assert.match(dry.out,new RegExp(f.ids[0]));
  assert.deepEqual(f.calls,[],'a dry run never generates');
  await assert.rejects(stat(path.join(f.cwd,'local')),e=>e.code==='ENOENT','a dry run writes no checkpoint');
  assert.ok(!dry.out.includes(f.session.token)&&!dry.err.includes(f.session.token),'the session token is never echoed');
});

test('--execute demands an explicit --max-requests in 1..20 and never accepts password or token flags',async t=>{
  const f=await start(t),env={LEAFHOUR_SESSION:f.session.token},base=['--origin',f.base,'--book',f.book.bookId];
  for(const args of [
    [...base,'--execute'],
    [...base,'--execute','--max-requests','0'],
    [...base,'--execute','--max-requests','21'],
    [...base,'--execute','--max-requests','3.5'],
    [...base,'--execute','--max-requests','abc'],
    [...base,'--max-requests','5'],
    [...base,'--session','token'],
    [...base,'--password','secret'],
    [...base,'--token','token'],
    ['--book',f.book.bookId],
    ['--origin','http://leafhour.example/reader','--book',f.book.bookId,'--execute','--max-requests','1']
  ]){
    const result=await runCli(args,{cwd:f.cwd,env});
    assert.equal(result.code,2,args.join(' '));
    assert.deepEqual(f.calls,[],'refused invocations generate nothing');
  }
  await assert.rejects(stat(path.join(f.cwd,'local')),e=>e.code==='ENOENT');
});

test('a real CLI execution is bounded, keeps the session out of every output and resumes through the default checkpoint',async t=>{
  const f=await start(t),env={LEAFHOUR_SESSION:f.session.token},base=['--origin',f.base,'--book',f.book.bookId];
  const checkpoint=path.join(f.dir,'checkpoint','batch.json');
  const first=await runCli([...base,'--execute','--max-requests','2','--checkpoint',checkpoint],{cwd:f.cwd,env});
  assert.equal(first.code,0,first.err);
  assert.deepEqual(f.calls,f.ids.slice(0,2),'the CLI translates serially in source order within its bound');
  assert.ok(!first.out.includes(f.session.token)&&!first.err.includes(f.session.token));
  const raw=await readFile(checkpoint,'utf8');
  assert.ok(!raw.includes(f.session.token)&&!raw.includes('One source paragraph.')&&!raw.includes('合成直译'),'checkpoints stay non-secret');
  // The same checkpoint resumes and completes the remaining paragraphs.
  const second=await runCli([...base,'--execute','--max-requests','20','--checkpoint',checkpoint],{cwd:f.cwd,env});
  assert.equal(second.code,0,second.err);
  assert.deepEqual(f.calls,f.ids,'resume completes the remaining paragraphs without duplicating generation');
  const stored=JSON.parse(await readFile(checkpoint,'utf8'));
  assert.deepEqual(Object.keys(stored.entries).sort(),[...f.ids].sort());
  assert.ok(Object.values(stored.entries).every(entry=>entry.state==='saved'));
  // A later invocation without --checkpoint uses the private default path.
  const third=await runCli([...base,'--execute','--max-requests','1'],{cwd:f.cwd,env});
  assert.equal(third.code,0,third.err);
  assert.deepEqual(f.calls,f.ids,'nothing eligible remains, so nothing is regenerated');
  assert.equal((await stat(path.join(f.cwd,'local','translation-batches'))).mode&0o777,0o700);
  assert.ok(JSON.parse(await readFile(path.join(f.cwd,'local','translation-batches',f.book.bookId+'.json'),'utf8')).entries);
});

test('--help documents the dry-run default and the execution bound without touching any service',async()=>{
  const result=await runCli(['--help'],{cwd:process.cwd(),env:{}});
  assert.equal(result.code,0);
  assert.match(result.out,/dry-run|演练/);
  assert.match(result.out,/--execute/);
  assert.match(result.out,/--max-requests/);
  assert.match(result.out,/LEAFHOUR_SESSION/);
});
