import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';

const root=new URL('..',import.meta.url),sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const catalog=JSON.parse(await readFile(new URL('catalog/manifest.json',root),'utf8'));
const people=JSON.parse(await readFile(new URL('catalog/people/manifest.json',root),'utf8'));

for(const [kind,entries,prefix] of [['book originals',catalog,'catalog/'],['people seeds',people.people,'catalog/people/']])test('Windows checkout preserves the original hashed '+kind+' bytes',()=>{
 for(const entry of entries){
  const file=prefix+entry.file,original=execFileSync('git',['show','HEAD:'+file],{cwd:root,maxBuffer:16*1024*1024});
  // Git's real worktree filter exercises CRLF conversion without touching the
  // working tree, index, config, source text, or any user's runtime data.
  const windows=execFileSync('git',['-c','core.autocrlf=true','cat-file','--filters','--path='+file,'HEAD:'+file],{cwd:root,maxBuffer:16*1024*1024});
  assert.equal(sha(windows),sha(original),'Windows checkout changed hashed source bytes: '+file);
  if(entry.sha256)assert.equal(sha(windows),entry.sha256,'The manifest must still verify '+file);
 }
});
