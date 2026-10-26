import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('cold reader HTML carries a text-column skeleton and an immediate exit before any module runs',async()=>{
 const html=await readFile(new URL('../app/index.html',import.meta.url),'utf8');
 const loading=html.slice(html.indexOf('<div id="loading"'),html.indexOf('<div id="load-error"'));
 assert.match(loading,/class="reading-skeleton" aria-hidden="true"/);
 assert.match(loading,/class="skeleton-title"/);
 assert.match(loading,/class="skeleton-lines"/);
 assert.match(loading,/<a href="\/library"/);
 assert.ok(!loading.includes('data-reading-arrival'),'the reader never mounts the illustration and quote replacement');
});

test('the reader loader keeps the skeleton stable through slow loads, retries, locale changes and disposal',async()=>{
 const {mountReaderLoading}=await import('../app/reader-loading.mjs');
 const {requestUiRoute,t}=await import('../app/ui-locale.mjs');
 await requestUiRoute('en');
 const retry=new EventTarget(),status={},jobs=new Map();let serial=0,reloads=0;
 const root={hidden:false,ownerDocument:{defaultView:{location:{reload(){reloads++;}}}},querySelector:s=>s==='[role="status"]'?status:retry};
 const loader=mountReaderLoading(root,{schedule:fn=>{jobs.set(++serial,fn);return serial;},cancel:id=>jobs.delete(id)});
 try{
  const first=loader.start(),late=jobs.get(serial),second=loader.start();
  late();assert.equal(retry.hidden,true,'a previous load cannot reveal the new retry');
  assert.equal(loader.finish(first),false);assert.equal(root.hidden,false);
  const slow=jobs.get(serial);slow();assert.equal(retry.hidden,false);
  const original=status.textContent;slow();assert.equal(status.textContent,original,'slow status never grows or cycles');
  retry.dispatchEvent(new Event('click'));assert.equal(reloads,1);
  await requestUiRoute('ja');assert.equal(status.textContent,t('reader.shell.loading'));assert.equal(retry.hidden,false);
  assert.equal(loader.finish(second),true);assert.equal(root.hidden,true);assert.equal(jobs.size,0);
  slow();assert.equal(retry.hidden,true);assert.equal(loader.finish(second),false);
  loader.start();const afterDispose=jobs.get(serial);loader.dispose();afterDispose();
  assert.equal(jobs.size,0);retry.dispatchEvent(new Event('click'));assert.equal(reloads,1);
  assert.equal(loader.start(),null);assert.equal(loader.finish(second),false);
 }finally{loader.dispose();await requestUiRoute('en');}
});
