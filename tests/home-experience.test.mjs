import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {portalDocument} from '../server/portal-document.mjs';
import {homeDocument} from '../app/home-locale.mjs';
const source=await readFile(new URL('../app/home.html',import.meta.url),'utf8');
test('private library strips optional product-demo scripts and styles',()=>{
 const html=portalDocument(source,'/library');
 assert.doesNotMatch(html,/(?:src|href)="\/home-experience\.(?:mjs|css)"/);
 assert.match(html,/<div id="home-view" hidden>/);
});
test('all public locales offer keyboard-native demo controls and honest iOS access',()=>{
 for(const locale of ['en','zh-Hans','zh-Hant','ja']){
  const html=homeDocument(source,locale);
  assert.match(html,/id="product-stage"/);
  assert.equal([...html.matchAll(/data-demo-mode="(?:read|translate|ask)"/g)].length,3);
  assert.ok(html.includes('href="/'+({en:'en','zh-Hans':'zh-hans','zh-Hant':'zh-hant',ja:'ja'}[locale])+'/beta#ios"'));
  assert.doesNotMatch(html,/https:\/\/(?:apps\.apple\.com|testflight\.apple\.com)/);
  assert.match(html,/data-demo-panel="ask" hidden/);
 }
});

test('changing demo mode exposes one panel and leaves invalid input unchanged',async()=>{
 const {selectDemoMode}=await import('../app/home-experience.mjs');
 const panels=['read','translate','ask'].map(mode=>({dataset:{demoPanel:mode},hidden:mode!=='read'}));
 const buttons=['read','translate','ask'].map(mode=>({dataset:{demoMode:mode},attributes:{},setAttribute(key,value){this.attributes[key]=value;}}));
 const root={dataset:{},querySelectorAll:selector=>selector==='[data-demo-panel]'?panels:buttons};
 assert.equal(selectDemoMode(root,'ask'),true);
 assert.deepEqual(panels.map(panel=>panel.hidden),[true,true,false]);
 assert.deepEqual(buttons.map(button=>button.attributes['aria-pressed']),['false','false','true']);
 assert.equal(selectDemoMode(root,'<script>'),false);assert.equal(root.dataset.mode,'ask');
 assert.equal(selectDemoMode(root,'read'),true);assert.deepEqual(panels.map(panel=>panel.hidden),[false,true,true]);
});

test('a hidden homepage never queries or initializes browser APIs',async()=>{
 const {mountHomeExperience}=await import('../app/home-experience.mjs');
 const root={hidden:true,querySelector(){return null;}};
 assert.equal(typeof mountHomeExperience(root),'function');
});

test('public delivery keeps marketing independent while the private entry retains its application',()=>{
 const home=portalDocument(source,'/en'),library=portalDocument(source,'/library');
 assert.doesNotMatch(home,/src="\/(?:portal\.js|public-page\.mjs|palette-bootstrap\.mjs|reading-arrival\.mjs)"/);
 assert.match(home,/href="\/home-public\.css"/);assert.match(home,/src="\/home-public\.mjs"/);
 assert.doesNotMatch(home,/<div id="library-view"/);
 assert.match(library,/src="\/portal\.js"/);assert.doesNotMatch(library,/src="\/home-public\.mjs"/);
 const marketing=library.slice(library.indexOf('<div id="home-view"'),library.indexOf('<div id="library-view"'));
 for(const img of marketing.matchAll(/<img\b[^>]*>/g))assert.match(img[0],/loading="lazy"/);
});

test('stopping and replaying voice cannot let an old callback clear the new preview',async()=>{
 const {mountHomeExperience}=await import('../app/home-experience.mjs');
 const node=()=>Object.assign(new EventTarget(),{dataset:{},attributes:{},setAttribute(key,value){this.attributes[key]=value;}});
 const root=node(),stage=node(),voice=node(),label={textContent:''},status={textContent:'Voice preview',dataset:{unavailable:'Unavailable'}};
 voice.dataset={playLabel:'Play',stopLabel:'Stop'};voice.querySelector=()=>label;
 const buttons=['read','translate','ask'].map(mode=>Object.assign(node(),{dataset:{demoMode:mode}}));const back=node();
 const demo={querySelectorAll:()=>buttons,querySelector:()=>back};
 const nodes={'#product-stage':stage,'.web-reader-demo':demo,'[data-voice-preview]':voice,'[data-voice-status]':status};root.querySelector=s=>nodes[s];root.contains=()=>true;
 const doc=new EventTarget();doc.hidden=false;root.ownerDocument=doc;
 const win=new EventTarget(),media=new EventTarget(),spoken=[];let canceled=0;media.matches=true;
 Object.assign(win,{matchMedia:()=>media,navigator:{connection:{saveData:true}},SpeechSynthesisUtterance:class{constructor(text){this.text=text;}},speechSynthesis:{speak(value){spoken.push(value);},cancel(){canceled++;spoken.at(-1).onerror?.({error:'canceled'});}}});
 const dispose=mountHomeExperience(root,win);
 voice.dispatchEvent(new Event('click'));const oldError=spoken[0].onerror;
 assert.equal(voice.attributes['aria-pressed'],'true');
 voice.dispatchEvent(new Event('click'));assert.equal(canceled,1);assert.equal(status.textContent,'Voice preview');
 voice.dispatchEvent(new Event('click'));oldError({error:'network'});
 assert.equal(voice.attributes['aria-pressed'],'true');assert.equal(label.textContent,'Stop');
 doc.hidden=true;doc.dispatchEvent(new Event('visibilitychange'));assert.equal(canceled,2);assert.equal(voice.attributes['aria-pressed'],'false');
 dispose();
});

test('public CJK fallback also covers translations revealed by the sample controls',async()=>{
 const {sampleInterpretations}=await import('../app/home-sample.mjs');
 const css=await readFile(new URL('../app/home-public.css',import.meta.url),'utf8');
 const ranges=[...css.matchAll(/unicode-range:([^}]+)/g)].flatMap(match=>match[1].split(',').map(value=>value.trim().replace(/^U\+/i,'').split('-').map(hex=>parseInt(hex,16))));
 for(const sample of sampleInterpretations)for(const char of sample.text){
  if(!/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(char))continue;
  const point=char.codePointAt(0);
  assert.ok(ranges.some(([start,end=start])=>point>=start&&point<=end),sample.code+' loses actual sample glyph '+char);
 }
});
