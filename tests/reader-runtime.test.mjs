import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,rm,stat,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath,pathToFileURL} from 'node:url';

const runtime=await import('../tools/build-reader-runtime.mjs').catch(error=>{
  if(error.code==='ERR_MODULE_NOT_FOUND')return {};
  throw error;
});
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');

test('the isolated hosted runtime initializes its actual SDK, profile, plugins and native bindings without a model request',{timeout:90000},async t=>{
  assert.equal(typeof runtime.buildReaderRuntime,'function','The hosted Harness runtime builder is missing');
  const directory=await mkdtemp(path.join(tmpdir(),'reader-runtime-test-')),outputDir=path.join(directory,'runtime');
  t.after(()=>rm(directory,{recursive:true,force:true}));
  const built=await runtime.buildReaderRuntime({root,outputDir});
  assert.equal(built.initialized,true);
  assert.ok(built.bytes<100*1024*1024,'The reading runtime must remain below the hosted function size budget');
  for(const forbidden of ['app','api','catalog','.env'])await assert.rejects(stat(path.join(outputDir,forbidden)),error=>error.code==='ENOENT');
  const profile=JSON.parse(await readFile(path.join(outputDir,'node_modules/@deepseek-ai/dsh-sdk-minimal/package.json'),'utf8'));
  assert.equal(profile.name,'@deepseek-ai/dsh-sdk-minimal');
  assert.ok((await stat(path.join(outputDir,'node_modules/@deepseek-ai/dsh-sdk-minimal/cordis.patch.yml'))).isFile());
  const {DeepSeekHarness}=await import(pathToFileURL(path.join(outputDir,'node_modules/@deepseek-ai/dsh-sdk-client/lib/index.js')));
  const home=path.join(directory,'independent-home');
  const patch=path.join(directory,'independent.patch.json');
  await writeFile(patch,JSON.stringify(['persistent-bash','persistent-pwsh','tool-working-directory','llm-retry','session-title'].map(id=>({id,disabled:true}))));
  const harness=new DeepSeekHarness({profile:'sdk-minimal',patches:[patch],dshHome:home,processCwd:directory,cwd:directory,env:{PATH:process.env.PATH,DEEPSEEK_API_KEY:'offline-runtime-fixture'},initializeTimeoutMs:15000});
  try{await harness.start();}finally{await harness.close();}
});

test('rebuilding removes stale runtime files while keeping files beside the generated directory',{timeout:90000},async t=>{
  assert.equal(typeof runtime.buildReaderRuntime,'function','The hosted Harness runtime builder is missing');
  const directory=await mkdtemp(path.join(tmpdir(),'reader-runtime-rebuild-')),outputDir=path.join(directory,'runtime');
  t.after(()=>rm(directory,{recursive:true,force:true}));
  await writeFile(path.join(directory,'keep.txt'),'preserved');
  await mkdir(outputDir);
  await runtime.buildReaderRuntime({root,outputDir,verify:false});
  await writeFile(path.join(outputDir,'obsolete.txt'),'stale');
  await runtime.buildReaderRuntime({root,outputDir,verify:false});
  await assert.rejects(stat(path.join(outputDir,'obsolete.txt')),error=>error.code==='ENOENT');
  assert.equal(await readFile(path.join(directory,'keep.txt'),'utf8'),'preserved');
});

test('a mistaken non-runtime output directory is refused without deleting its contents',{timeout:90000},async t=>{
  const directory=await mkdtemp(path.join(tmpdir(),'reader-runtime-protected-')),outputDir=path.join(directory,'personal-files');
  t.after(()=>rm(directory,{recursive:true,force:true}));
  await mkdir(outputDir);await writeFile(path.join(outputDir,'keep.txt'),'preserved');
  await assert.rejects(runtime.buildReaderRuntime({root,outputDir,verify:false}),/generated runtime/i);
  assert.equal(await readFile(path.join(outputDir,'keep.txt'),'utf8'),'preserved');
  await writeFile(path.join(outputDir,'manifest.json'),JSON.stringify({kind:'some-other-artifact'}));
  await assert.rejects(runtime.buildReaderRuntime({root,outputDir,verify:false}),/generated runtime/i);
  assert.equal(await readFile(path.join(outputDir,'keep.txt'),'utf8'),'preserved');
});
