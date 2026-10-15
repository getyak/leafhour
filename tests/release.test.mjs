import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,mkdir,readFile,readdir,symlink,rm,stat,chmod} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {validReleasePath,exportRelease,releaseCommit,releaseFiles} from '../tools/release-policy.mjs';
import {fileURLToPath} from 'node:url';

const commit='a'.repeat(40);
async function fixture(t,files){const root=await mkdtemp(path.join(tmpdir(),'release-test-'));t.after(()=>rm(root,{recursive:true,force:true}));await writeFile(path.join(root,'release-files.json'),JSON.stringify(files));return root;}
test('publication rejects private paths, credentials, traversal and private document formats',()=>{
  for(const file of ['local/note.json','content/book.json','_briefs/plan.md','docs/verification/proof.md','docs/superpowers/plan.md','.env','deploy/.env.production','original.pdf','signing.pem','../secret','/etc/passwd','app/../local/book','app\\secret'])assert.equal(validReleasePath(file),false,file);
  for(const file of ['app/reader.js','.github/workflows/ci.yml','.env.example','catalog/alice.txt'])assert.equal(validReleasePath(file),true,file);
});
test('publication copies only approved software files and removes private project links',async t=>{
  const root=await fixture(t,['README.md','app/test.mjs']);await mkdir(path.join(root,'app'));await writeFile(path.join(root,'app/test.mjs'),'export default 1;');await writeFile(path.join(root,'README.md'),'项目主页：[GitHub](https://github.com/getyak/marginalia-reader) · [Notion](https://example.com/private)\n');await mkdir(path.join(root,'local'));await writeFile(path.join(root,'local/private.txt'),'private');
  const dest=path.join(root,'output');await exportRelease(root,dest,{commit});
  assert.deepEqual((await readdir(dest)).sort(),['README.md','app','release-source.json']);
  assert.doesNotMatch(await readFile(path.join(dest,'README.md'),'utf8'),/Notion|private/);assert.deepEqual(JSON.parse(await readFile(path.join(dest,'release-source.json'),'utf8')),{commit});
  assert.equal(await releaseCommit(dest),commit);
  await chmod(path.join(root,'app/test.mjs'),0o755);await exportRelease(root,dest,{commit});
  assert.equal((await stat(path.join(dest,'app/test.mjs'))).mode&0o111,0o111);
});
test('publication fails closed on missing files, symlinks and credential content',async t=>{
  const root=await fixture(t,['app.mjs']);const dest=path.join(root,'output');
  await assert.rejects(exportRelease(root,dest,{commit}),/ENOENT/);
  await writeFile(path.join(root,'private.txt'),'private');await symlink(path.join(root,'private.txt'),path.join(root,'app.mjs'));
  await assert.rejects(exportRelease(root,dest,{commit}),/Symlinks/);await rm(path.join(root,'app.mjs'));
  await writeFile(path.join(root,'app.mjs'),'ghp_'+'A'.repeat(40));await assert.rejects(exportRelease(root,dest,{commit}),/Credential/);
  await assert.rejects(exportRelease(root,dest,{commit:'short'}),/full source commit/);
});
test('hosted source metadata works without Git history and cannot fall back from an invalid ID',async t=>{
  const root=await fixture(t,['app.mjs']),sourceCommit='b'.repeat(40);
  assert.equal(await releaseCommit(root,{sourceCommit}),sourceCommit);
  await writeFile(path.join(root,'release-source.json'),JSON.stringify({commit}));
  assert.equal(await releaseCommit(root,{sourceCommit}),sourceCommit);
  await assert.rejects(releaseCommit(root,{sourceCommit:'invalid'}),/Invalid release source commit/);
});
test('the release snapshot contains local module imports and reader page assets',async()=>{
  const root=fileURLToPath(new URL('..',import.meta.url)),files=await releaseFiles(root),allowed=new Set(files);
  for(const file of files){
    if(!/\.(?:mjs|js|html)$/.test(file))continue;
    const source=await readFile(path.join(root,file),'utf8');
    if(/\.(?:mjs|js)$/.test(file))for(const match of source.matchAll(/\b(?:from\s*|import\s*(?:\(\s*)?)['"](\.{1,2}\/[^'"]+)['"]/g)){
      const dependency=path.posix.normalize(path.posix.join(path.posix.dirname(file),match[1]));
      assert.ok(allowed.has(dependency),file+' imports missing release file '+dependency);
    }
    if(file.startsWith('app/')&&file.endsWith('.html'))for(const match of source.matchAll(/(?:src|href)="(\/[^"#?]+\.(?:mjs|js|css|svg|png|webp|jpg|mp3))"/g)){
      assert.ok(allowed.has('app'+match[1]),file+' references missing release asset '+match[1]);
    }
  }
});
