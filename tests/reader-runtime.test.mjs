import test from 'node:test';
import assert from 'node:assert/strict';
import {copyFile,mkdir,mkdtemp,readFile,rm,stat,symlink,writeFile} from 'node:fs/promises';
import {spawn,spawnSync} from 'node:child_process';
import {once} from 'node:events';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath,pathToFileURL} from 'node:url';

const runtime=await import('../tools/build-reader-runtime.mjs').catch(error=>{
  if(error.code==='ERR_MODULE_NOT_FOUND')return {};
  throw error;
});
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const checker=await import('../tools/check-reader-runtime.mjs').catch(error=>{
  if(error.code==='ERR_MODULE_NOT_FOUND')return {};
  throw error;
});
const nodeSha='fde6a4bf8d0562f7751d1a2d6cb9b417c4cfe107bbcb0aa3e9a24e125e348f48';
const licenseSha='c738ae413cf561f174e34f6961f8ca458aae2369a73640dda6234c629b98bcc4';
const linuxX64=process.platform==='linux'&&process.arch==='x64';

test('the isolated hosted runtime initializes its actual SDK, profile, plugins and native bindings without a model request',{timeout:90000},async t=>{
  assert.equal(typeof runtime.buildReaderRuntime,'function','The hosted Harness runtime builder is missing');
  const directory=await mkdtemp(path.join(tmpdir(),'reader-runtime-test-')),outputDir=path.join(directory,'runtime');
  t.after(()=>rm(directory,{recursive:true,force:true}));
  const built=await runtime.buildReaderRuntime({root,outputDir});
  assert.equal(built.initialized,true);
  assert.ok(built.bytes<200*1024*1024,'The reading runtime must remain below the hosted function size budget');
  for(const forbidden of ['app','api','catalog','.env'])await assert.rejects(stat(path.join(outputDir,forbidden)),error=>error.code==='ENOENT');
  const profile=JSON.parse(await readFile(path.join(outputDir,'node_modules/@deepseek-ai/dsh-sdk-minimal/package.json'),'utf8'));
  assert.equal(profile.name,'@deepseek-ai/dsh-sdk-minimal');
  assert.ok((await stat(path.join(outputDir,'node_modules/@deepseek-ai/dsh-sdk-minimal/cordis.patch.yml'))).isFile());
  assert.equal(typeof checker.checkReaderRuntime,'function','The standalone runtime initialization check is missing');
  const checked=await checker.checkReaderRuntime(outputDir);
  assert.equal(checked.initialized,true);assert.equal(checked.closed,true);assert.equal(checked.reaped,true);assert.equal(checked.modelRequests,0);
  const fileSizes=await Promise.all(built.files.map(async file=>(await stat(path.join(outputDir,file))).size));
  assert.equal(built.bytes,fileSizes.reduce((total,size)=>total+size,0),'The manifest must count every packaged runtime file');
  if(linuxX64){
    assert.equal(checked.nodeVersion,'22.23.3');
    assert.equal(built.node.version,'22.23.3');assert.equal(built.node.sha256,nodeSha);assert.equal(built.node.licenseSha256,licenseSha);
    const binary=await readFile(path.join(outputDir,'bin/node')),license=await readFile(path.join(outputDir,'bin/NODE-LICENSE'));
    assert.equal(createHash('sha256').update(binary).digest('hex'),nodeSha);assert.equal(createHash('sha256').update(license).digest('hex'),licenseSha);
    assert.equal(built.node.bytes,binary.length);assert.equal(built.node.licenseBytes,license.length);
    assert.ok(built.bytes>binary.length+license.length,'The runtime size must include its Node executable and license');
    for(const file of ['bin/node','bin/NODE-LICENSE','bin/dsh-launch.mjs'])assert.ok(built.files.includes(file),file);
    assert.equal((await stat(path.join(outputDir,'bin/node'))).mode&0o777,0o755);
  }else{
    assert.equal(built.node,undefined);await assert.rejects(stat(path.join(outputDir,'bin')),error=>error.code==='ENOENT');
  }
});

async function launcherFixture(t){
  const directory=await mkdtemp(path.join(tmpdir(),'reader-launch-test-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  const bin=path.join(directory,'bin'),cli=path.join(directory,'node_modules/@deepseek-ai/dsh/lib');
  await mkdir(bin,{recursive:true});await mkdir(cli,{recursive:true});
  await copyFile(path.join(root,'harness/hosted-launch.mjs'),path.join(bin,'dsh-launch.mjs'));
  await symlink(process.execPath,path.join(bin,'node'));
  return {directory,cli:path.join(cli,'bin.js'),launch:pathToFileURL(path.join(bin,'dsh-launch.mjs')).href};
}

function launchCode(launch,{platform='linux',arch='x64',execve=true,environmentFile}={}){
  return `Object.defineProperty(process,'platform',{value:${JSON.stringify(platform)}});Object.defineProperty(process,'arch',{value:${JSON.stringify(arch)}});process.argv.splice(1,0,${JSON.stringify(fileURLToPath(launch))});${execve?'':'process.execve=undefined;'}${environmentFile?`(await import('node:fs')).writeFileSync(${JSON.stringify(environmentFile)},JSON.stringify(process.env));`:''}await import(${JSON.stringify(launch)});`;
}

test('the hosted launcher replaces its PID and preserves arguments, environment and stdin EOF',{skip:typeof process.execve!=='function',timeout:15000},async t=>{
  const fixture=await launcherFixture(t);
  await writeFile(fixture.cli,"let input='';process.stdin.setEncoding('utf8');process.stdin.on('data',chunk=>input+=chunk);process.stdin.on('end',()=>console.log(JSON.stringify({pid:process.pid,args:process.argv.slice(2),input,env:process.env})));\n");
  const environmentFile=path.join(fixture.directory,'environment.json');
  const result=spawnSync(process.execPath,['--input-type=module','-e',launchCode(fixture.launch,{environmentFile}),'--','--profile','sdk-minimal','--patch','fixture path.json'],{env:{READER_SHIM_FIXTURE:'authorized'},input:'bounded fixture',encoding:'utf8',timeout:10000});
  assert.equal(result.status,0,result.stderr);const value=JSON.parse(result.stdout);
  assert.equal(value.pid,result.pid,'Replacing the process must keep the SDK-owned PID');
  assert.deepEqual(value.args,['--profile','sdk-minimal','--patch','fixture path.json']);assert.equal(value.input,'bounded fixture');
  // Native startup can add process-local values such as encoding and io_uring
  // hints. Compare the controlled child environment before and after execve.
  assert.equal(value.env.READER_SHIM_FIXTURE,'authorized');
  assert.deepEqual(value.env,JSON.parse(await readFile(environmentFile,'utf8')));
});

test('the hosted launcher keeps the process directly cancellable by its SDK owner',{skip:typeof process.execve!=='function',timeout:15000},async t=>{
  const fixture=await launcherFixture(t);
  await writeFile(fixture.cli,"console.log(process.pid);setInterval(()=>{},1000);\n");
  const child=spawn(process.execPath,['--input-type=module','-e',launchCode(fixture.launch)],{env:{},stdio:['pipe','pipe','pipe']});
  t.after(()=>{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');});
  const exited=once(child,'exit'),[ready]=await once(child.stdout,'data');
  assert.equal(Number(ready.toString().trim()),child.pid);
  child.kill('SIGTERM');assert.deepEqual(await exited,[null,'SIGTERM']);
  assert.throws(()=>process.kill(child.pid,0),error=>error.code==='ESRCH');
});

test('the hosted launcher fails closed on unsupported platforms or missing execve',{timeout:15000},async t=>{
  const fixture=await launcherFixture(t);await writeFile(fixture.cli,"console.log('must not run');\n");
  for(const options of [{platform:'win32'},{arch:'arm64'},{execve:false}]){
    const result=spawnSync(process.execPath,['--input-type=module','-e',launchCode(fixture.launch,options)],{env:{},encoding:'utf8',timeout:5000});
    assert.notEqual(result.status,0);assert.equal(result.stdout,'');assert.match(result.stderr,/hosted.*(?:linux|execve)/i);
  }
});

test('untrusted hosted Node package contents are rejected before replacing a previous runtime',{timeout:15000},async t=>{
  const directory=await mkdtemp(path.join(tmpdir(),'reader-node-integrity-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  const packageDir=path.join(directory,'node_modules/node-linux-x64'),outputDir=path.join(directory,'runtime');
  await mkdir(path.join(packageDir,'bin'),{recursive:true});await mkdir(outputDir);
  await writeFile(path.join(directory,'package.json'),'{}');
  await writeFile(path.join(outputDir,'manifest.json'),JSON.stringify({kind:'marginalia-reader-runtime'}));
  await writeFile(path.join(outputDir,'keep.txt'),'previous runtime');
  await writeFile(path.join(packageDir,'bin/node'),'untrusted binary');await writeFile(path.join(packageDir,'LICENSE'),'untrusted license');
  const builder=pathToFileURL(path.join(root,'tools/build-reader-runtime.mjs')).href;
  for(const version of ['22.22.0','22.23.3']){
    await writeFile(path.join(packageDir,'package.json'),JSON.stringify({name:'node-linux-x64',version}));
    const code=`Object.defineProperty(process,'platform',{value:'linux'});Object.defineProperty(process,'arch',{value:'x64'});const {buildReaderRuntime}=await import(${JSON.stringify(builder)});await buildReaderRuntime({root:${JSON.stringify(directory)},outputDir:${JSON.stringify(outputDir)},verify:false});`;
    const result=spawnSync(process.execPath,['--input-type=module','-e',code],{env:{PATH:process.env.PATH},encoding:'utf8',timeout:5000});
    assert.notEqual(result.status,0);assert.match(result.stderr,version==='22.23.3'?/hosted Node.*integrity/i:/hosted Node.*version/i);
    assert.equal(await readFile(path.join(outputDir,'keep.txt'),'utf8'),'previous runtime');
  }
});

test('a modified Node license is rejected even when the executable matches the pinned official binary',{skip:!linuxX64,timeout:15000},async t=>{
  const directory=await mkdtemp(path.join(tmpdir(),'reader-node-license-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  const require=createRequire(path.join(root,'package.json')),installed=path.dirname(require.resolve('node-linux-x64/package.json'));
  const packageDir=path.join(directory,'node_modules/node-linux-x64');await mkdir(path.join(packageDir,'bin'),{recursive:true});
  await writeFile(path.join(directory,'package.json'),'{}');await copyFile(path.join(installed,'package.json'),path.join(packageDir,'package.json'));
  await copyFile(path.join(installed,'bin/node'),path.join(packageDir,'bin/node'));await writeFile(path.join(packageDir,'LICENSE'),'incomplete license');
  await assert.rejects(runtime.buildReaderRuntime({root:directory,outputDir:path.join(directory,'runtime'),verify:false}),/hosted Node.*license.*integrity/i);
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
