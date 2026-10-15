import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {checkPublicBuild} from '../tools/check-public-build.mjs';

async function fixture(t){
  const root=await mkdtemp(path.join(tmpdir(),'reader-public-build-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const assets=path.join(root,'assets/atmospheres');await mkdir(assets,{recursive:true});
  const bytes=Buffer.alloc(210*1024,23),entry={file:'forest.jpg',bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
  await writeFile(path.join(assets,'forest.jpg'),bytes);await writeFile(path.join(assets,'manifest.json'),JSON.stringify([entry]));
  return {root,assets,entry};
}
test('a public build accepts a registered large theme asset only when its size and digest match',async t=>{
  const {root,assets}=await fixture(t);await checkPublicBuild(root);
  await writeFile(path.join(assets,'forest.jpg'),Buffer.alloc(210*1024,24));
  await assert.rejects(checkPublicBuild(root),/校验不一致/);
});
test('a public build rejects an unregistered large file, including inside the theme directory',async t=>{
  const {root,assets}=await fixture(t);await writeFile(path.join(assets,'private-book.json'),Buffer.alloc(210*1024));
  await assert.rejects(checkPublicBuild(root),/未登记的大文件/);
});
test('a manifest cannot authorize an arbitrary private file as a public theme asset',async t=>{
  const {root,assets,entry}=await fixture(t);
  await writeFile(path.join(assets,'manifest.json'),JSON.stringify([{...entry,file:'private-book.json'}]));
  await assert.rejects(checkPublicBuild(root),/不允许的氛围资源/);
});
test('private content directories remain forbidden even when every file is small',async t=>{
  for(const name of ['content','local','_briefs']){
    const root=await mkdtemp(path.join(tmpdir(),'reader-private-dir-'));t.after(()=>rm(root,{recursive:true,force:true}));
    await mkdir(path.join(root,name));await writeFile(path.join(root,name,'note.json'),'{}');
    await assert.rejects(checkPublicBuild(root),/私人内容目录/);
  }
});
