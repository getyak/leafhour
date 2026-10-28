import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {portalDocument} from '../server/portal-document.mjs';

const root=path.resolve(import.meta.dirname,'..');
const locales=[['en','en'],['zh-Hans','zh-hans'],['zh-Hant','zh-hant'],['ja','ja']];
function assertNavigation(html,locale,slug,kind){
 const header=html.match(/<header\b[\s\S]*?<\/header>/)?.[0]||'';
 assert.match(header,/<nav class="home-navigation"/,'Support documents use the current public navigation before JavaScript');
 for(const href of ['/'+slug+'#how',locale==='en'?'/mcp':'/'+slug+'/mcp','/'+slug+'/pricing','https://github.com/getyak/leafhour','/library?ui='+locale])assert.ok(header.includes('href="'+href+'"'),href);
 assert.ok(header.indexOf('class="brand"')<header.indexOf('data-palette-open'),'Brand precedes the search action');
 assert.doesNotMatch(header,/home-languages/,'Language options belong to the shared menu');
 assert.equal((html.match(/id="home-menu"/g)||[]).length,1);
 assert.equal((html.match(/data-palette-open/g)||[]).length,1,'Search has one visible owner');
 assert.match(html,/src="\/public-page.mjs"/);
 assert.match(html,/href="\/home-navigation.css"/);
 const menu=html.match(/<dialog\b[^>]*id="home-menu"[\s\S]*?<\/dialog>/)?.[0]||'';
 for(const [,languageSlug]of locales)assert.ok(menu.includes('href="'+(languageSlug==='en'?'/':'/'+languageSlug+'/')+kind+'"'),languageSlug+' document language');
}

test('public document renderer gives every support locale the current navigation before JavaScript',async()=>{
 for(const [locale,slug]of locales)for(const kind of ['privacy','mcp']){
  const source=await readFile(path.join(root,'app',slug,kind+'.html'),'utf8');
  assertNavigation(portalDocument(source,'/'+slug+'/'+kind),locale,slug,kind);
 }
});

test('every support route serves the current localized public navigation on first paint',async t=>{
 const {createReaderServer}=await import('../server/server.mjs');
 const dir=await mkdtemp(path.join(tmpdir(),'leafhour-support-navigation-'));
 const server=await createReaderServer({recordsPath:path.join(dir,'records.json'),env:{},translator:null,sendCode:null});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await rm(dir,{recursive:true,force:true});});
 const base='http://127.0.0.1:'+server.address().port;
 for(const [locale,slug]of locales)for(const kind of ['privacy','mcp']){
  const response=await fetch(base+'/'+slug+'/'+kind);assert.equal(response.status,200);
  const html=await response.text();assertNavigation(html,locale,slug,kind);
  const source=await readFile(path.join(root,'app',slug,kind+'.html'),'utf8');
  assert.equal(html.match(/<main\b[\s\S]*?<\/main>/)?.[0],source.match(/<main\b[\s\S]*?<\/main>/)?.[0],'Authored content remains intact');
  if(locale==='en')assert.equal(await (await fetch(base+'/'+kind+'?ui=en')).text(),html,'Unprefixed aliases use the same shell');
 }
 const script=await fetch(base+'/public-page.mjs');assert.equal(script.status,200);assert.match(script.headers.get('content-type'),/javascript/);
});

test('hosted support output and aliases use the same navigation as the local server',async t=>{
 const {buildSupportPages}=await import('../tools/build-vercel.mjs');
 assert.equal(typeof buildSupportPages,'function');
 const outputDir=await mkdtemp(path.join(tmpdir(),'leafhour-support-build-'));t.after(()=>rm(outputDir,{recursive:true,force:true}));
 await buildSupportPages({appDir:path.join(root,'app'),outputDir});
 for(const [locale,slug]of locales)for(const kind of ['privacy','mcp']){
  const html=await readFile(path.join(outputDir,slug,kind+'.html'),'utf8');assertNavigation(html,locale,slug,kind);
  if(locale==='en')assert.equal(await readFile(path.join(outputDir,kind+'.html'),'utf8'),html);
 }
});
