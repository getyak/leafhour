import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {mountExperienceMetrics} from '../app/evals.js';
import {requestUiRoute,t} from '../app/ui-locale.mjs';
import english from '../app/ui-catalogs/en.mjs';
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
class Element{
 constructor(){this.children=[];this.attrs={};this.textContent='';this.replacements=0;}
 append(...n){this.children.push(...n);}setAttribute(k,v){this.attrs[k]=v;}getAttribute(k){return this.attrs[k];}removeAttribute(k){delete this.attrs[k];}querySelectorAll(){return all(this).slice(1).filter(n=>Object.keys(n.attrs).some(k=>k.startsWith('data-ui')));}
}
const all=n=>[n,...n.children.flatMap(all)];
function fixture(){const nodes=new Map(),root=new Element(),el=id=>{if(!nodes.has(id)){const n=new Element();nodes.set(id,n);root.append(n);}return nodes.get(id);},doc={documentElement:root,createElement:()=>new Element(),getElementById:el};el('status').setAttribute('data-ui','evals.loading');let calls=0,jsonCalls=0;const pending=deferred(),ui=mountExperienceMetrics({document:doc,request(url){calls++;assert.equal(url,'/api/experience-metrics');return pending.promise;}});return {el,doc,ui,pending,calls:()=>calls,jsonCalls:()=>jsonCalls,response(m){return {ok:true,async json(){jsonCalls++;return m;}};}};}
const metrics=()=>({uniqueSessions:7,sampleState:'insufficient',fragmentCoverage:{rate:.5,numerator:3,denominator:6},latency:{xray:{p95Ms:null,samples:0}},constraints:{quiet:{rate:1}},behavior:Object.fromEntries(['xrayContinue','stanceChoice','stanceSource','share','observationCopy','echoReread','immediateExit'].map((k,i)=>[k,{rate:i===0?null:.5,numerator:1,denominator:2,sampleState:i===1?'insufficient':'sufficient',targetReached:i===2?null:i===3?true:false}])),chatControl:{available:false}});
test('actual metrics language commits keep pending request, completed rows and metric values without refetching',async()=>{
 await requestUiRoute('en');const f=fixture();try{await Promise.resolve();for(const code of ['ja','zh-Hant','zh-Hans','en']){await requestUiRoute(code);assert.equal(f.calls(),1);assert.equal(f.jsonCalls(),0);assert.equal(f.el('technical').children.length,0);assert.equal(f.el('status').textContent,t('evals.loading'));assert.equal(f.el('status').getAttribute('lang'),code);}
 f.pending.resolve(f.response(metrics()));await f.ui.ready;const technical=all(f.el('technical')),behavior=all(f.el('behavior')),definitions=all(f.el('definitions')),values=f.el('technical').children.map(n=>n.children[1].textContent);assert.deepEqual(values,['50.0%',t('evals.waitClicks'),'100.0%']);
 for(const code of ['ja','zh-Hant','zh-Hans','en']){await requestUiRoute(code);assert.equal(f.calls(),1);assert.equal(f.jsonCalls(),1);assert.deepEqual(all(f.el('technical')),technical);assert.deepEqual(all(f.el('behavior')),behavior);assert.deepEqual(all(f.el('definitions')),definitions);assert.equal(f.el('technical').children[0].children[0].children.length,2);assert.equal(f.el('technical').children[0].children[0].children[0].textContent,t('evals.coverage.title'));assert.equal(f.el('technical').children[0].children[0].children[1].textContent,t('evals.coverage.detail',{numerator:3,denominator:6}));assert.equal(f.el('technical').children[0].children[1].textContent,'50.0%');assert.equal(f.el('evals-chat').href,"/read?study=chat");}
 }finally{f.ui.dispose();}
});
test('actual metrics late success and failures respect disposal and current effective language',async()=>{
 for(const mode of ['disposed','failed']){await requestUiRoute('en');const f=fixture();if(mode==='disposed')f.ui.dispose();await requestUiRoute('ja');if(mode==='disposed')f.pending.resolve(f.response(metrics()));else f.pending.reject(Error('UNTRUSTED failure'));await f.ui.ready;assert.equal(f.el('technical').children.length,0);assert.equal(f.calls(),1);if(mode==='failed')assert.equal(f.el('status').textContent,t('evals.failed'));f.ui.dispose();}await requestUiRoute('en');
});
test('canonical metrics shell is English and every explicit owned UI marker exists',async()=>{
 const html=await readFile(new URL('../app/evals.html',import.meta.url),'utf8');assert.match(html,/<html lang="en"/);assert.ok(!/[\p{Script=Han}]/u.test(html));for(const [,id]of html.matchAll(/data-ui="([^"]+)"/g))assert.equal(typeof english[id],'string',id);
});
