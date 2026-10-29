import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fixture} from './annotation-dom-fixture.mjs';
import {customNewsreader} from '../tools/lib/platform-font-observer.mjs';

const source=await readFile(new URL('../tools/platform-typography.mjs',import.meta.url),'utf8');
const html=await readFile(new URL('../app/home.html',import.meta.url),'utf8');
const start=source.indexOf('  await session.installFontHold();'),end=source.indexOf('  for(const [route,locale]',start);
assert.ok(start>=0&&end>start);
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;

// Execute the real acceptance sequence against the authored homepage and an
// explicit root-document replacement. Font usage is the controlled CDP edge;
// neither a copied homepage nor a local browser/SDK is needed for this contract.
async function observe({retireRootFont=true,withholdCurrent=true}={}){
 const {document}=fixture(html);document.readyState='complete';document.fonts={ready:Promise.resolve(true)};document.documentElement.lang='en';
 const location={pathname:'/en',href:'http://localhost:1234/en'},events=[],probes=[],receipt={};let holding=false;
 const session={paused:new Set(),async installFontHold(){holding=true;events.push('hold installed');},async navigateProduct(url){events.push('navigate '+new URL(url).pathname);location.pathname='/en';location.href='http://localhost:1234/en';if(holding){if(withholdCurrent)this.paused.add('live-font');if(url.endsWith('/')&&retireRootFont){this.paused.clear();events.push('root font retired');}}},async until(check,label){assert.ok(await check(),label);},async fonts(selector,label,options){assert.ok(document.querySelector(selector),'A real authored text node must exist for '+label);probes.push({selector,label,holding,options});return {label,fonts:[holding?{isCustomFont:false,glyphCount:5,familyName:'Georgia'}:{isCustomFont:true,glyphCount:5,familyName:'Newsreader'}]};},async capture(name){events.push('capture '+name);},async releaseFontHold(){assert.ok(this.paused.size,'A live held font must remain until the fallback probe finishes');holding=false;this.paused.clear();events.push('hold released');}};
 const cdp={evaluate:async expression=>new Function('document','location','return ('+expression+');')(document,location)};
 const run=new AsyncFunction('session','origin','cdp','args','bindAndroidProductViewport','delay','assert','customNewsreader','receipt','let viewport={};'+source.slice(start,end)+';return viewport;');
 await run(session,'http://localhost:1234',cdp,{mode:'desktop'},()=>assert.fail('desktop must retain its native viewport'),async()=>{},assert,customNewsreader,receipt);
 return {events,probes,receipt};
}

test('the cold-font probe keeps a current authored-document hold independently of automatic root entry',async()=>{
 const result=await observe();assert.deepEqual(result.events.filter(row=>row.startsWith('navigate ')),['navigate /en','navigate /']);assert.ok(result.events.indexOf('capture home-controlled-font-delay')<result.events.indexOf('hold released'));assert.ok(result.events.indexOf('hold released')<result.events.indexOf('navigate /'));assert.equal(result.receipt.rootEntry.pathname,'/en');
});

test('the homepage acceptance probes the real serif headline rather than the removed hero-line wrapper',async()=>{
 const result=await observe({retireRootFont:false}),headline=result.probes.find(row=>row.label.includes('headline'));
 assert.equal(headline.selector,'#home-view .hero-copy h1');assert.equal(headline.holding,false);assert.ok(result.probes.some(row=>row.selector==='#home-view .sample-original'&&row.holding&&row.options?.awaitFonts===false));
});

test('a cold-font run without a live current-document hold still fails closed',async()=>{
 await assert.rejects(observe({withholdCurrent:false}),/font-paused authored homepage/);
});
