import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const directory=new URL('../apps/ios/Leafhour/Assets.xcassets/AppIcon.appiconset/',import.meta.url);
test('the distribution icon is a real opaque 1024px RGB PNG referenced by the asset catalog',()=>{
  const catalog=JSON.parse(readFileSync(new URL('Contents.json',directory),'utf8'));
  const image=catalog.images.find(x=>x.idiom==='universal' && x.platform==='ios' && x.size==='1024x1024');
  assert.ok(image?.filename);
  const bytes=readFileSync(new URL(image.filename,directory));
  assert.equal(bytes.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
  assert.equal(bytes.toString('ascii',12,16),'IHDR');
  assert.equal(bytes.readUInt32BE(16),1024);assert.equal(bytes.readUInt32BE(20),1024);
  assert.equal(bytes[24],8);assert.equal(bytes[25],2,'RGB without an alpha channel is required');
});
test('the checked-in Xcode project compiles the actual icon asset catalog',()=>{
  const project=readFileSync(new URL('../apps/ios/Leafhour.xcodeproj/project.pbxproj',import.meta.url),'utf8');
  assert.ok(/Assets\.xcassets in Resources/.test(project),'asset catalog must be in the Resources phase');
  assert.ok(/ASSETCATALOG_COMPILER_APPICON_NAME = AppIcon/.test(project));
});
