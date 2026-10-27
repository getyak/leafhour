import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {commerceCopy,commercePage} from '../app/commerce-pages.mjs';

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
      if(kind==='pricing'){
        assert.ok(flat.includes(commerceCopy(locale).disabled),'Static pages must default to unavailable until the live catalog is checked');
        assert.match(flat,/data-product-key="reading_monthly_100"/);assert.match(flat,/data-product-key="reading_yearly_1200"/);assert.doesNotMatch(flat,/data-product-key="reading_100"/);
        assert.match(flat,/class="plan-benefits"/);assert.match(flat,/<details class="pricing-details">/);
      }
    }
  }
  for(const kind of ['pricing','terms','refunds'])assert.equal(await readFile(path.join(outputDir,kind+'.html'),'utf8'),await readFile(path.join(outputDir,'en',kind+'.html'),'utf8'));
  const shell=await readFile(path.join(outputDir,'billing.html'),'utf8');
  assert.equal(shell,await readFile(path.join(outputDir,'admin/billing.html'),'utf8'));
  assert.match(shell,/name="robots" content="noindex,nofollow"/);
  assert.match(shell,/id="billing-content" aria-busy="true"/);
});

test('every pricing locale offers free reading and direct monthly or yearly checkout',()=>{
  for(const locale of ['en','zh-Hans','zh-Hant','ja']){
    const html=commercePage({kind:'pricing',locale});
    const header=html.match(/<header[\s\S]*?<\/header>/)[0];
    assert.match(header,new RegExp('id="account-button" href="/library\\?ui='+locale+'"'),'The header returns readers to their books');
    const plans=[...html.matchAll(/<section class="point-pack[^\"]*"[^>]*>[\s\S]*?<\/section>/g)].map(match=>match[0]);
    assert.equal(plans.length,3,'Readers must see exactly three comparable plans in '+locale);
    assert.match(plans[0],new RegExp('href="/library\\?ui='+locale+'"'),'Free reading keeps the interface language');
    assert.doesNotMatch(plans.join(''),/href="\/billing/,'Plan actions must not send readers through a billing middle page');
    assert.deepEqual([...html.matchAll(/<button type="button" class="primary" data-pricing-subscribe="([^"]+)"/g)].map(match=>match[1]),['reading_monthly_100','reading_yearly_1200']);
    assert.match(plans[1],/data-billing-period="month" data-price-usd="5" data-reading-points="100"/);
    assert.match(plans[2],/data-billing-period="year" data-price-usd="50" data-reading-points="1200"/);
    assert.match(plans[1],/US\$5/);assert.match(plans[2],/US\$50/);assert.match(plans[2],/1,200/);
    assert.equal([...html.matchAll(/id="pricing-status"/g)].length,1,'Payment status is announced once');
    assert.match(html,/id="pricing-status"[^>]*aria-live="polite"/);
    assert.doesNotMatch(html,/<table/,'Usage detail stays out of the plan comparison');
    assert.doesNotMatch(plans.join(''),/4\.17/,'The yearly charge must remain the visible price');
    for(const kind of ['terms','refunds']){
      const policy=commercePage({kind,locale});
      assert.match(policy,/1,200|1200/,'Annual points must be covered by '+kind+' in '+locale);
    }
  }
});

test('all authored privacy notices explain billing metadata and link to local policies',async()=>{
  const labels={en:'payment-card', 'zh-hans':'银行卡', 'zh-hant':'銀行卡',ja:'カード'};
  for(const slug of ['en','zh-hans','zh-hant','ja']){
    const html=await readFile(path.join(root,'app',slug,'privacy.html'),'utf8');
    assert.match(html,/Creem/,'Billing processor must be named in '+slug);
    assert.ok(html.includes(labels[slug]),'Payment-card storage boundary must be explained in '+slug);
    assert.match(html,/2026(?: 年)?(?:\s+10\s+月\s+28|[-/]10[-/]28)|October 28, 2026/,'Privacy date must reflect this update');
    for(const kind of ['pricing','terms','refunds'])assert.ok(html.includes('href="/'+slug+'/'+kind+'"'),'Missing '+slug+' '+kind+' link');
  }
});
