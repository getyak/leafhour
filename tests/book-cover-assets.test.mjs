import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {loadImage} from '@napi-rs/canvas';
import {bookCoverArtwork} from '../app/book-cover-artwork.mjs';
const root=new URL('../',import.meta.url);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
test('every current public edition has one distinct checked-in cover and both responsive sizes',async()=>{
 const catalog=JSON.parse(await fs.readFile(new URL('catalog/manifest.json',root),'utf8'));
 const manifest=JSON.parse(await fs.readFile(new URL('catalog/book-cover-artwork.json',root),'utf8'));
 assert.equal(manifest.complete,true,'Development-only partial exports cannot pass release coverage');
 assert.equal(manifest.expected,64);
 const ids=catalog.map(b=>b.id).sort();
 assert.equal(ids.length,64);
 assert.deepEqual(Object.keys(bookCoverArtwork).sort(),ids);
 assert.deepEqual(manifest.entries.map(b=>b.id).sort(),ids);
 const originals=new Set();
 for(const entry of manifest.entries){
  const map=bookCoverArtwork[entry.id];
  assert.match(map.ink,/^#[a-f0-9]{6}$/i);
  assert.match(map.paper,/^#[a-f0-9]{6}$/i);
  assert.equal(entry.variants.length,2);
  originals.add(entry.originalSha256);
  for(const asset of entry.variants){
   assert.ok([320,640].includes(asset.width));
   assert.equal(asset.height,asset.width*1.5);
   const url=new URL(asset.url,'https://leafhour.com');
   assert.equal(url.origin,'https://leafhour.com');
   assert.match(asset.url,/^\/book-covers\/[a-z0-9-]+-(320|640)\.webp\?v=[a-f0-9]{12}$/);
   const bytes=await fs.readFile(new URL('app'+url.pathname,root));
   assert.equal(bytes.subarray(0,4).toString(),'RIFF');
   assert.equal(bytes.subarray(8,12).toString(),'WEBP');
   assert.equal(sha(bytes),asset.sha256);
   assert.equal(url.searchParams.get('v'),asset.sha256.slice(0,12));
   assert.equal(bytes.length,asset.bytes);
   assert.ok(bytes.length<=(asset.width===320?100000:260000),entry.id+' responsive byte budget');
   const image=await loadImage(bytes);assert.equal(image.width,asset.width);assert.equal(image.height,asset.height);
   assert.ok(map.srcSet.includes(asset.url+' '+asset.width+'w'));
   if(asset.width===640)assert.equal(map.src,asset.url);
  }
 }
 assert.equal(originals.size,64,'Each edition receives distinct source artwork, including companion volumes');
});
test('cover metadata contains no account-specific paths and release includes every cover dependency',async()=>{
 const release=new Set(JSON.parse(await fs.readFile(new URL('release-files.json',root),'utf8')));
 for(const file of ['app/book-cover-artwork.mjs','app/book-cover-labels.mjs','app/book-cover-ui.mjs','app/book-binding.css','catalog/book-cover-artwork.json'])assert.ok(release.has(file),'release dependency '+file);
 for(const entry of Object.values(bookCoverArtwork)){
  assert.ok(!/https?:|owner|account|token|signature/i.test(entry.src));
  for(const candidate of entry.srcSet.split(',').map(s=>s.trim().split(' ')[0]))assert.ok(release.has('app'+new URL(candidate,'https://leafhour.com').pathname));
 }
});
