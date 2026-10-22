import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {transform} from 'esbuild';

const file = name => readFile(new URL('../'+name, import.meta.url), 'utf8');
const luminance = hex => {
  const channels = hex.replace('#','').match(/../g).map(x=>parseInt(x,16)/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4);
  return channels[0]*.2126+channels[1]*.7152+channels[2]*.0722;
};
const contrast = (a,b) => {const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);};

test('both authored palettes keep prose, supporting labels and primary actions readable', async () => {
  const css=await file('app/leafhour-surfaces.css');
  for(const prefix of ['light','dark']){
    const value=key=>{const match=css.match(new RegExp('--lh-'+prefix+'-'+key+':\\s*(#[a-fA-F0-9]{6})'));assert.ok(match,`${prefix} ${key}`);return match[1];};
    for(const surface of ['paper','panel','surface']){
      assert.ok(contrast(value('ink'),value(surface))>=7,`${prefix}: prose on ${surface}`);
      assert.ok(contrast(value('muted'),value(surface))>=4.5,`${prefix}: supporting text on ${surface}`);
    }
    assert.ok(contrast(value('action-text'),value('accent'))>=4.5,`${prefix}: primary action`);
    assert.ok(contrast(value('accent'),value('surface'))>=3,`${prefix}: active control`);
  }
});

test('the new home skin is valid CSS and ships after legacy surface styles without changing reader themes',async()=>{
  const css=await file('app/leafhour-surfaces.css');
  const result=await transform(css,{loader:'css',logLevel:'silent'});
  assert.equal(result.warnings.length,0);
  const home=await file('app/home.html'),reader=await file('app/index.html');
  assert.ok(home.indexOf('/leafhour-surfaces.css')>home.indexOf('/library-data.css'));
  assert.ok(!reader.includes('leafhour-surfaces.css'));
  const release=JSON.parse(await file('release-files.json'));
  assert.ok(release.includes('app/leafhour-surfaces.css'));
  assert.match(await file('server/portal.mjs'),/files\['\/leafhour-surfaces\.css'\]/);
});
