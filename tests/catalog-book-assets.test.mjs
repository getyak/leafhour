import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,copyFile,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {checkPublicBuild} from '../tools/check-public-build.mjs';

const registry=await import('../server/catalog-book-assets.mjs').catch(error=>{
  if(error.code==='ERR_MODULE_NOT_FOUND')return null;
  throw error;
});
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const largeFile='pg-2009-diagram.jpg';
const smallFile='pg-40097-fig-1.png';

async function fixture(t){
  const root=await mkdtemp(path.join(tmpdir(),'leafhour-book-assets-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  await mkdir(path.join(root,'book-assets'));
  return root;
}

test('the ten original book illustrations have immutable source receipts matching shipped bytes',async()=>{
  assert.ok(registry,'The fixed book illustration registry is missing');
  const assets=registry.catalogBookAssets;
  assert.equal(assets.length,10);
  assert.equal(new Set(assets.map(asset=>asset.url)).size,10);
  for(const asset of assets){
    assert.match(asset.file,/^book-assets\/pg-(38427|40097|40868|8438|2009)-[^/]+\.(png|jpg)$/);
    assert.equal(asset.url,'/'+asset.file);
    assert.equal(asset.mime,asset.file.endsWith('.png')?'image/png':'image/jpeg');
    assert.equal(asset.license,'Public domain in the USA; source notices retained with the book');
    assert.ok(asset.creator.trim());
    assert.match(asset.sourceUrl,/^https:\/\/www\.gutenberg\.org\/cache\/epub\/\d+\/images\//);
    assert.match(asset.sourcePage,/^https:\/\/www\.gutenberg\.org\/cache\/epub\/\d+\/pg\d+-images\.html$/);
    const bytes=await readFile(new URL('../app/'+asset.file,import.meta.url));
    assert.equal(bytes.length,asset.bytes,asset.file);
    assert.equal(sha(bytes),asset.sha256,asset.file);
  }
  assert.throws(()=>{assets[0].sha256='f'.repeat(64);},TypeError);
  assert.throws(()=>{assets.push({...assets[0],file:'book-assets/unknown.jpg'});},TypeError);
});

test('the exact original Darwin diagram passes the 200 KiB limit only at its approved path',async t=>{
  const root=await fixture(t);
  await copyFile(new URL('../app/book-assets/'+largeFile,import.meta.url),path.join(root,'book-assets',largeFile));
  const result=await checkPublicBuild(root);
  assert.equal(result.largeAssets,1);
  await copyFile(new URL('../app/book-assets/'+largeFile,import.meta.url),path.join(root,'renamed.jpg'));
  await assert.rejects(checkPublicBuild(root),/未登记的大文件/);
});

test('same-size changes to both large and small registered illustrations are rejected',async t=>{
  for(const name of [largeFile,smallFile]){
    const root=await fixture(t);
    const bytes=await readFile(new URL('../app/book-assets/'+name,import.meta.url));
    bytes[Math.floor(bytes.length/2)]^=1;
    await writeFile(path.join(root,'book-assets',name),bytes);
    await assert.rejects(checkPublicBuild(root),/book illustration.*integrity|图版.*校验/i);
  }
});

test('truncated registered illustrations are rejected before granting any size exception',async t=>{
  const root=await fixture(t);
  const bytes=await readFile(new URL('../app/book-assets/'+smallFile,import.meta.url));
  await writeFile(path.join(root,'book-assets',smallFile),bytes.subarray(0,bytes.length-1));
  await assert.rejects(checkPublicBuild(root),/book illustration.*integrity|图版.*校验/i);
});

test('unknown tiny images cannot be authorized by book JSON or a mutable build manifest',async t=>{
  const root=await fixture(t),bytes=Buffer.from('unreviewed tiny image');
  await writeFile(path.join(root,'book-assets','unknown.png'),bytes);
  await writeFile(path.join(root,'catalog.json'),JSON.stringify({assets:[{file:'book-assets/unknown.png',bytes:bytes.length,sha256:sha(bytes)}]}));
  await assert.rejects(checkPublicBuild(root),/unregistered book illustration|未登记的图版/i);
});

test('renaming a reviewed small image does not add it to the approved book resource set',async t=>{
  const root=await fixture(t);
  await copyFile(new URL('../app/book-assets/'+smallFile,import.meta.url),path.join(root,'book-assets','renamed.png'));
  await assert.rejects(checkPublicBuild(root),/unregistered book illustration|未登记的图版/i);
});

test('minimal builds do not require the optional book-assets directory',async t=>{
  const root=await mkdtemp(path.join(tmpdir(),'leafhour-minimal-public-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  await writeFile(path.join(root,'index.html'),'<p>Minimal fixture</p>');
  assert.equal((await checkPublicBuild(root)).largeAssets,0);
});

test('the resource README is allowed while global file and font and recording limits still apply',async t=>{
  const root=await fixture(t);
  await writeFile(path.join(root,'book-assets','README.md'),'Original book illustration source receipts.');
  await checkPublicBuild(root);
  await writeFile(path.join(root,'arbitrary.jpg'),Buffer.alloc(200*1024+1));
  await assert.rejects(checkPublicBuild(root),/未登记的大文件/);
  await rm(path.join(root,'arbitrary.jpg'));
  await writeFile(path.join(root,'unreviewed.woff2'),'wOF2');
  await assert.rejects(checkPublicBuild(root),/未登记的字体文件/);
  await rm(path.join(root,'unreviewed.woff2'));
  await mkdir(path.join(root,'assets','atmospheres'),{recursive:true});
  await writeFile(path.join(root,'assets','atmospheres','wind.mp3'),'small unregistered recording');
  await assert.rejects(checkPublicBuild(root),/未登记的录音/);
});
