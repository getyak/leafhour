import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import path from 'node:path';

const root=new URL('..',import.meta.url),sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const catalog=JSON.parse(await readFile(new URL('catalog/manifest.json',root),'utf8'));
const readingMetadata=JSON.parse(await readFile(new URL('catalog/reading-metadata.json',root),'utf8'));
const people=JSON.parse(await readFile(new URL('catalog/people/manifest.json',root),'utf8'));

for(const [kind,entries,prefix] of [['book originals',catalog,'catalog/'],['people seeds',people.people,'catalog/people/']])test('Windows checkout preserves the original hashed '+kind+' bytes',async t=>{
 // Hosted builds receive source files without .git. Exercise Git's actual
 // filter in an owned repository using those files and their real rules.
 const fixture=await mkdtemp(path.join(tmpdir(),'leafhour-checkout-bytes-'));
 t.after(()=>rm(fixture,{recursive:true,force:true}));
 const emptyConfig=path.join(fixture,'empty-config'),emptyAttributes=path.join(fixture,'empty-attributes');
 await writeFile(emptyConfig,'');await writeFile(emptyAttributes,'');
 await writeFile(path.join(fixture,'.gitattributes'),await readFile(new URL('.gitattributes',root)));
 const gitEnvironment=Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.toUpperCase().startsWith('GIT_')));
 Object.assign(gitEnvironment,{GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:emptyConfig,GIT_ATTR_NOSYSTEM:'1'});
 const git=args=>execFileSync('git',['-c','core.attributesFile='+emptyAttributes,'-c','core.autocrlf=false',...args],{cwd:fixture,env:gitEnvironment,stdio:['ignore','pipe','pipe'],maxBuffer:16*1024*1024,timeout:10000});
 git(['init','--quiet']);
 for(const entry of entries){
  const file=prefix+entry.file,original=await readFile(new URL(file,root));
  const expected=prefix==='catalog/'?readingMetadata[entry.id]?.contentVersion:entry.sha256;
  assert.match(expected||'',/^[a-f0-9]{64}$/,'Missing audited source hash: '+file);
  assert.equal(sha(original),expected,'The source snapshot must still verify '+file);
  const source=path.join(fixture,'source-bytes');await writeFile(source,original);
  const object=git(['hash-object','-w','--no-filters',source]).toString('utf8').trim();
  const windows=git(['-c','core.autocrlf=true','cat-file','--filters','--path='+file,object]);
  assert.equal(sha(windows),expected,'Windows checkout changed hashed source bytes: '+file);
 }
});
