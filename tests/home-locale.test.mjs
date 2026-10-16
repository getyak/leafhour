import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {portalDocument} from '../server/portal-document.mjs';
import {createReaderServer} from '../server/server.mjs';

const ids=html=>[...html.matchAll(/\bid="([^"]+)"/g)].map(match=>match[1]);
const styles=html=>[...html.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map(match=>match[1]);
const scripts=html=>[...html.matchAll(/<script type="module" src="([^"]+)"/g)].map(match=>match[1]);
test('English rendering preserves the authored home structure and only localizes its presentation',async()=>{
  const source=await readFile(new URL('../app/home.html',import.meta.url),'utf8'),english=portalDocument(source,'/en');
  assert.match(english,/<html lang="en">/);
  assert.deepEqual(ids(english),ids(source));assert.deepEqual(styles(english),styles(source));assert.deepEqual(scripts(english),scripts(source));
  assert.match(english,/<link rel="canonical" href="https:\/\/leafhour.com\/en">/);
  assert.match(english,/href="\/" lang="zh-Hans" hreflang="zh-Hans">中文<\/a>/);
  assert.match(english,/id="auth-dialog"/);assert.match(english,/id="featured-books"/);assert.match(english,/class="sunlight-overlay"/);
  assert.doesNotMatch(english,/留一点时间，读进一本书。|正在载入书架|回到你的书房/);
  assert.match(english,/your own/i);assert.match(english,/Chinese/);
  const graph=JSON.parse(english.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1])['@graph'];
  const page=graph.find(node=>node['@type']==='WebPage');assert.equal(page.url,'https://leafhour.com/en');assert.equal(page.inLanguage,'en');
  assert.equal(portalDocument(source,'/'),source);
  const privatePage=portalDocument(source,'/library');assert.match(privatePage,/<html lang="zh-Hans">/);assert.doesNotMatch(privatePage,/application\/ld\+json/);
});

test('the English HTTP homepage mounts the same controls and sections as the Chinese homepage',async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'leafhour-home-locale-'));
  const server=await createReaderServer({recordsPath:path.join(dir,'records.json'),sendCode:null,translator:null,chatGenerator:null});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));await rm(dir,{recursive:true,force:true});});
  const base='http://127.0.0.1:'+server.address().port,home=await(await fetch(base+'/')).text(),response=await fetch(base+'/en'),english=await response.text();assert.equal(response.status,200);
  assert.deepEqual(ids(english),ids(home));assert.deepEqual(styles(english),styles(home));assert.deepEqual(scripts(english),scripts(home));
  assert.match(english,/id="how"/);assert.match(english,/id="daily"/);assert.match(english,/id="books"/);assert.match(english,/id="ownership"/);assert.match(english,/id="questions"/);
  assert.match(english,/href="\/library"/);assert.match(english,/href="\/read\?book=gutenberg-alice"/);
  assert.match(english,/href="#how"/);assert.doesNotMatch(english,/href="\/#how"/,'English in-page navigation must not switch back to Chinese');
  assert.doesNotMatch(english,/class="discovery-page"/);
});
