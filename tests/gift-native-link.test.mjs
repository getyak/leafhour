import test from 'node:test';
import assert from 'node:assert/strict';

const token='a'.repeat(43);
test('only a valid gift token becomes an app import intent',async()=>{
  const module=await import('../app/gift-native-link.mjs').catch(()=>null);
  assert.ok(module,'native gift import link builder is implemented');
  assert.equal(module.nativeGiftImportURL(token),'leafhour://gift/'+token);
  for(const invalid of ['short','a'.repeat(44),'../private','a'.repeat(42)+'%','https://evil.invalid',null])assert.equal(module.nativeGiftImportURL(invalid),null);
});
