import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {commerceCopy} from '../app/commerce-pages.mjs';

const root=path.resolve(import.meta.dirname,'..');
test('static commerce output contains every localized policy and safe private shell',async t=>{
  const source=await readFile(path.join(root,'tools/build-vercel.mjs'),'utf8');
  assert.match(source,/export async function buildCommercePages/,'The hosted build must expose the real commerce packaging step');
  const {buildCommercePages}=await import('../tools/build-vercel.mjs');
  const outputDir=await mkdtemp(path.join(tmpdir(),'leafhour-billing-build-'));t.after(()=>rm(outputDir,{recursive:true,force:true}));
  await buildCommercePages({appDir:path.join(root,'app'),outputDir});
  for(const [locale,slug]of [['en','en'],['zh-Hans','zh-hans'],['zh-Hant','zh-hant'],['ja','ja']]){
    for(const kind of ['pricing','terms','refunds']){
      const flat=await readFile(path.join(outputDir,slug,kind+'.html'),'utf8');
      assert.match(flat,new RegExp('<html lang="'+locale+'"'));
      assert.ok(flat.includes('href="https://leafhour.com/'+slug+'/'+kind+'"'));
      assert.equal(flat,await readFile(path.join(outputDir,slug,kind,'index.html'),'utf8'));
      assert.match(flat,/src="\/billing.mjs"/);
      if(kind==='pricing')assert.ok(flat.includes(commerceCopy(locale).disabled),'Static pages must default to unavailable until the live catalog is checked');
    }
  }
  for(const kind of ['pricing','terms','refunds'])assert.equal(await readFile(path.join(outputDir,kind+'.html'),'utf8'),await readFile(path.join(outputDir,'en',kind+'.html'),'utf8'));
  const shell=await readFile(path.join(outputDir,'billing.html'),'utf8');
  assert.equal(shell,await readFile(path.join(outputDir,'admin/billing.html'),'utf8'));
  assert.match(shell,/name="robots" content="noindex,nofollow"/);
  assert.match(shell,/id="billing-content" aria-busy="true"/);
});

test('all authored privacy notices explain billing metadata and link to local policies',async()=>{
  const labels={en:'payment-card', 'zh-hans':'银行卡', 'zh-hant':'銀行卡',ja:'カード'};
  for(const slug of ['en','zh-hans','zh-hant','ja']){
    const html=await readFile(path.join(root,'app',slug,'privacy.html'),'utf8');
    assert.match(html,/Creem/,'Billing processor must be named in '+slug);
    assert.ok(html.includes(labels[slug]),'Payment-card storage boundary must be explained in '+slug);
    assert.match(html,/2026(?: 年)?(?:\s+10\s+月\s+21|[-/]10[-/]21)|October 21, 2026/,'Privacy date must reflect this update');
    for(const kind of ['pricing','terms','refunds'])assert.ok(html.includes('href="/'+slug+'/'+kind+'"'),'Missing '+slug+' '+kind+' link');
  }
});
