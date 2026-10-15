import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,rm,stat,symlink,writeFile} from 'node:fs/promises';
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

test('an explicitly allowed Vercel dependency-only cache can be rebuilt without a restored manifest',{timeout:90000},async t=>{
  const directory=await mkdtemp(path.join(tmpdir(),'reader-runtime-partial-cache-')),outputDir=path.join(directory,'runtime');
  t.after(()=>rm(directory,{recursive:true,force:true}));
  await mkdir(path.join(outputDir,'node_modules'),{recursive:true});
  await writeFile(path.join(outputDir,'node_modules','obsolete-cache.txt'),'old dependency');
  await assert.rejects(runtime.buildReaderRuntime({root,outputDir,verify:false}),/generated runtime/i);
  const built=await runtime.buildReaderRuntime({root,outputDir,verify:false,allowDependencyCache:true});
  assert.equal(built.kind,'marginalia-reader-runtime');
  assert.equal(JSON.parse(await readFile(path.join(outputDir,'manifest.json'),'utf8')).kind,'marginalia-reader-runtime');
  await assert.rejects(stat(path.join(outputDir,'node_modules','obsolete-cache.txt')),error=>error.code==='ENOENT');
  assert.ok((await stat(path.join(outputDir,'node_modules/@deepseek-ai/dsh-sdk-client/lib/index.js'))).isFile());
});

test('dependency-cache recovery still refuses extra files, fake manifests, files and symbolic links',{timeout:90000},async t=>{
  const directory=await mkdtemp(path.join(tmpdir(),'reader-runtime-bad-cache-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  const target=path.join(directory,'outside');await mkdir(target);await writeFile(path.join(target,'keep.txt'),'preserved');
  for(const kind of ['extra-file','fake-manifest','file-as-modules','linked-modules','linked-output']){
    const outputDir=path.join(directory,kind);
    if(kind==='linked-output'){
      const cache=path.join(directory,'outside-cache');
      await mkdir(path.join(cache,'node_modules'),{recursive:true});await writeFile(path.join(cache,'node_modules','keep.txt'),'preserved');await symlink(cache,outputDir,'dir');
    }else{
      await mkdir(outputDir);
      if(kind==='file-as-modules')await writeFile(path.join(outputDir,'node_modules'),'preserved');
      else if(kind==='linked-modules')await symlink(target,path.join(outputDir,'node_modules'),'dir');
      else{
        await mkdir(path.join(outputDir,'node_modules'));
        await writeFile(path.join(outputDir,kind==='fake-manifest'?'manifest.json':'keep.txt'),kind==='fake-manifest'?JSON.stringify({kind:'some-other-artifact'}):'preserved');
      }
    }
    await assert.rejects(runtime.buildReaderRuntime({root,outputDir,verify:false,allowDependencyCache:true}),/generated runtime/i,kind);
    assert.equal(await readFile(path.join(target,'keep.txt'),'utf8'),'preserved');
    if(kind==='file-as-modules')assert.equal(await readFile(path.join(outputDir,'node_modules'),'utf8'),'preserved');
    if(kind==='extra-file')assert.equal(await readFile(path.join(outputDir,'keep.txt'),'utf8'),'preserved');
    if(kind==='fake-manifest')assert.equal(JSON.parse(await readFile(path.join(outputDir,'manifest.json'),'utf8')).kind,'some-other-artifact');
    if(kind==='linked-output')assert.equal(await readFile(path.join(directory,'outside-cache','node_modules','keep.txt'),'utf8'),'preserved');
  }
});
