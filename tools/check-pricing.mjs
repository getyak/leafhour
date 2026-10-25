import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import {DEEPSEEK_PRICING} from '../server/provider-pricing.mjs';
import {assertPricingWindow} from '../server/pricing-reference.mjs';
const read=name=>readFile(new URL('../harness/'+name,import.meta.url),'utf8').then(JSON.parse);
export async function checkPublishedPricing({now=Date.now(),minimumRemainingMs=86400000,verifySources=false,fetcher=fetch}={}){
 const legacy=await read('pricing.json'),evidence=await read('pricing-verification.json');
 const max=7*86400000,observed=Date.parse(evidence.observedAt);
 if(evidence.schemaVersion!==1||evidence.model!=='deepseek-flash'||evidence.modelVersion!==legacy.modelVersion||!Number.isFinite(observed)||observed>now||observed<Date.parse(legacy.checkedAt))throw Error('Pricing verification receipt is invalid');
 for(const price of [legacy,DEEPSEEK_PRICING])assertPricingWindow(price,now,{minimumRemainingMs,maximumValidityMs:max});
 if(legacy.model!=='deepseek-flash'||legacy.currency!=='CNY'||legacy.inputMissPerMillion!==2||legacy.outputPerMillion!==8||Date.parse(legacy.validUntil)>Date.parse(DEEPSEEK_PRICING.harnessToolsFreeUntil))throw Error('Legacy price or tool-fee boundary needs review');
 const expected={CNY:'https://api-docs.deepseek.com/zh-cn/quick_start/pricing/',USD:'https://api-docs.deepseek.com/quick_start/pricing/'};
 if(legacy.source!==expected.CNY||DEEPSEEK_PRICING.source!==expected.USD||evidence.sources?.length!==2)throw Error('Pricing source is invalid');
 for(const [currency,source] of Object.entries(expected)){
  const receipt=evidence.sources.find(row=>row.currency===currency);
  if(receipt?.source!==source||!/^[a-f0-9]{64}$/.test(receipt.sha256)||!Number.isSafeInteger(receipt.bytes)||receipt.bytes<100)throw Error('Pricing source receipt is missing');
  if(verifySources){const response=await fetcher(source,{signal:AbortSignal.timeout(30000),redirect:'error'});if(!response.ok)throw Error('Official pricing source is unavailable');const bytes=Buffer.from(await response.arrayBuffer());if(bytes.length!==receipt.bytes||createHash('sha256').update(bytes).digest('hex')!==receipt.sha256)throw Error('Official source changed; inspect current rates and record a new verification receipt');}
 }
 const rates=evidence.verifiedRates;
 if(rates?.CNY?.peakInputMiss!==legacy.inputMissPerMillion||rates?.CNY?.peakOutput!==legacy.outputPerMillion)throw Error('CNY pricing verification mismatch');
 for(const [period,key] of [['peak','peak'],['offpeak','offpeak']])for(const [field,suffix]of [['inputPerMillion','InputMiss'],['cacheReadPerMillion','CacheRead'],['outputPerMillion','Output']])if(DEEPSEEK_PRICING[period][field]!==rates?.USD?.[key+suffix])throw Error('USD pricing verification mismatch');
 for(const key of ['searchPerThousand','fetchPerThousand'])if(DEEPSEEK_PRICING[key]!==rates?.USD?.[key])throw Error('Tool pricing verification mismatch');
 return {model:legacy.model,observedAt:evidence.observedAt,references:[legacy,DEEPSEEK_PRICING].map(p=>({version:p.version,currency:p.currency,checkedAt:p.checkedAt,validUntil:p.validUntil})),minimumReleaseRemainingHours:minimumRemainingMs/3600000,sourceCheck:verifySources?'matched':'recorded-receipt'};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)console.log(JSON.stringify(await checkPublishedPricing({verifySources:process.argv.includes('--sources')}),null,2));
