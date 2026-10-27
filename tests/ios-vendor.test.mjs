import test from 'node:test';
import assert from 'node:assert/strict';
import {cp,mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {verifyIOSVendor} from '../tools/verify-ios-vendor.mjs';
const source=new URL('../apps/ios/Vendor/ZIPFoundation/',import.meta.url);
test('native dependency matches its independently pinned upstream source',async()=>{await verifyIOSVendor(source);});
test('native dependency rejects forged source and jointly altered provenance',async()=>{
  const root=await mkdtemp(path.join(process.env.LEAFHOUR_TEST_ROOT||tmpdir(),'ios-vendor-'));
  try {
    await cp(source,root,{recursive:true});
    const file=path.join(root,'Sources/ZIPFoundation/Archive.swift');
    await writeFile(file,(await readFile(file,'utf8'))+'\n// altered\n');
    await assert.rejects(()=>verifyIOSVendor(root));
    const manifest=JSON.parse(await readFile(path.join(root,'UPSTREAM.json'),'utf8'));
    manifest.files=[];await writeFile(path.join(root,'UPSTREAM.json'),JSON.stringify(manifest));
    await assert.rejects(()=>verifyIOSVendor(root));
  } finally {await rm(root,{recursive:true,force:true});}
});
