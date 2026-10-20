import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm,mkdir,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {installVale,RELEASE_ASSETS,RELEASE_VERSION} from '../tools/copy-install-vale.mjs';
import {execFile} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const REPO_ROOT=path.dirname(fileURLToPath(new URL('../package.json',import.meta.url)));

function tarHeader(name,size,mode=0o644){
  const header=Buffer.alloc(512);
  header.write(name,0,100,'utf8');
  header.write('0000'+mode.toString(8).padStart(4,'0')+'\0',100,8,'ascii');
  header.write('0000000\0',108,8,'ascii');
  header.write('0000000\0',116,8,'ascii');
  header.write(size.toString(8).padStart(11,'0')+'\0',124,12,'ascii');
  header.write('00000000000\0',136,12,'ascii');
  header.write('        ',148,8,'ascii');
  header.write('0',156,1,'ascii');
  header.write('ustar\0',257,6,'ascii');
  header.write('00',263,2,'ascii');
  let checksum=0;for(const byte of header)checksum+=byte;
  header.write(checksum.toString(8).padStart(6,'0')+'\0 ',148,8,'ascii');
  return header;
}
function tarArchive(entries){
  const chunks=[];
  for(const entry of entries){
    const data=Buffer.from(entry.data);
    chunks.push(tarHeader(entry.name,data.length,entry.mode||0o644));
    chunks.push(data);
    const padding=(512-(data.length%512))%512;
    if(padding)chunks.push(Buffer.alloc(padding));
  }
  chunks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(chunks));
}
async function tempDir(t){
  const root=await mkdtemp(path.join(tmpdir(),'copy-install-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  return root;
}

test('the pinned release table binds exact upstream assets and checksums',()=>{
  assert.equal(RELEASE_VERSION,'3.24.0');
  assert.deepEqual(Object.keys(RELEASE_ASSETS).sort(),['darwin/arm64','darwin/x64','linux/arm64','linux/x64']);
  for(const asset of Object.values(RELEASE_ASSETS)){
    assert.match(asset.url,/^https:\/\/github\.com\/vale-cli\/vale\/releases\/download\/v3\.24\.0\//);
    assert.match(asset.sha256,/^[a-f0-9]{64}$/);
    assert.ok(asset.file.startsWith('vale_3.24.0_'));
  }
  assert.equal(RELEASE_ASSETS['linux/x64'].sha256,'867534ddb678abca7f214bc4706ead0922bd5252ffe8035fc227013f66c8b214');
  assert.equal(RELEASE_ASSETS['darwin/arm64'].sha256,'87b513f26499f6657c15cf7175ba5b058a7c1ff2bb2d4e07265db2dd43451e44');
});

test('an unsupported platform or architecture fails instead of guessing a build',async t=>{
  const root=await tempDir(t);
  await assert.rejects(installVale({dest:path.join(root,'bin'),platform:'plan9',arch:'x64'}),/platform/i);
  await assert.rejects(installVale({dest:path.join(root,'bin'),platform:'linux',arch:'mips'}),/arch/i);
});

test('a checksum mismatch fails before anything is extracted',async t=>{
  const root=await tempDir(t);
  const archive=tarArchive([{name:'vale',data:'binary',mode:0o755}]);
  const archivePath=path.join(root,'vale.tar.gz');
  await writeFile(archivePath,archive);
  const dest=path.join(root,'bin');
  await assert.rejects(installVale({dest,platform:'linux',arch:'x64',archive:archivePath,sha256:'a'.repeat(64)}),/checksum|sha/i);
  await assert.rejects(readFile(path.join(dest,'vale')),'the destination must stay untouched on mismatch');
});

test('archive entries that try to escape the destination are rejected',async t=>{
  const root=await tempDir(t);
  for(const name of ['../escape','/etc/evil','sub/../../evil']){
    const archive=tarArchive([{name:'vale',data:'binary',mode:0o755},{name,data:'evil'}]);
    const archivePath=path.join(root,'traversal.tar.gz');
    await writeFile(archivePath,archive);
    await assert.rejects(installVale({dest:path.join(root,'bin'),platform:'linux',arch:'x64',archive:archivePath,sha256:createHash('sha256').update(archive).digest('hex')}),/traversal|path/i,name);
  }
});

test('a successful pinned install extracts only the vale executable',async t=>{
  const root=await tempDir(t);
  const archive=tarArchive([
    {name:'LICENSE',data:'license text'},
    {name:'README.md',data:'# upstream readme'},
    {name:'vale',data:'#!/bin/sh\necho fake vale\n',mode:0o755}
  ]);
  const archivePath=path.join(root,'vale.tar.gz');
  await writeFile(archivePath,archive);
  const dest=path.join(root,'bin');
  const result=await installVale({dest,platform:'linux',arch:'x64',archive:archivePath,sha256:createHash('sha256').update(archive).digest('hex')});
  assert.equal(result.file,path.join(dest,'vale'));
  assert.equal(await readFile(path.join(dest,'vale'),'utf8'),'#!/bin/sh\necho fake vale\n');
  assert.equal((await stat(path.join(dest,'vale'))).mode&0o111,0o111,'the extracted executable must be executable');
  await assert.rejects(readFile(path.join(dest,'LICENSE')),'only the executable is extracted');
  await assert.rejects(readFile(path.join(dest,'README.md')),'only the executable is extracted');
});

test('an archive without the vale executable fails closed',async t=>{
  const root=await tempDir(t);
  const archive=tarArchive([{name:'LICENSE',data:'license text'}]);
  const archivePath=path.join(root,'vale.tar.gz');
  await writeFile(archivePath,archive);
  await assert.rejects(installVale({dest:path.join(root,'bin'),platform:'linux',arch:'x64',archive:archivePath,sha256:createHash('sha256').update(archive).digest('hex')}),/vale/i);
});

test('the CLI rejects an unsupported host platform before touching the archive',async t=>{
  const root=await tempDir(t);
  const absent=path.join(root,'absent.tar.gz');
  const dest=path.join(root,'bin');
  const installer=path.join(REPO_ROOT,'tools/copy-install-vale.mjs');
  const code="Object.defineProperty(process,'platform',{value:'win32',configurable:true});"+
    'process.argv=[process.execPath,'+JSON.stringify(installer)+','+JSON.stringify('--dest')+','+JSON.stringify(dest)+','+JSON.stringify('--archive')+','+JSON.stringify(absent)+'];'+
    'await import('+JSON.stringify(installer)+');';
  const result=await new Promise(resolve=>{
    const child=execFile(process.execPath,['--input-type=module','-e',code],{cwd:REPO_ROOT},(error,stdout,stderr)=>resolve({code:error&&typeof error.code==='number'?error.code:0,stdout:String(stdout),stderr:String(stderr)}));
    child.on('exit',()=>{});
  });
  assert.match(result.stderr,/Unsupported platform/i,'an unsupported host must be rejected by the CLI default');
  assert.doesNotMatch(result.stderr,/ENOENT/i,'the rejection must happen before any archive access');
});
