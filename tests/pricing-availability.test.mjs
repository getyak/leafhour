import test from 'node:test';
import assert from 'node:assert/strict';
import {mountPricingCheckout} from '../app/pricing-checkout.mjs';
import {commercePage} from '../app/commerce-pages.mjs';

const plans=['reading_monthly_100','reading_yearly_1200'];
function dom(locale='en'){
 class Node extends EventTarget{
  constructor(text=''){super();this.textContent=text;this.dataset={};this.attrs={};}
  setAttribute(key,value){this.attrs[key]=value;}
  replaceChildren(...nodes){this.textContent=nodes.map(node=>node.textContent).join('');}
 }
 const status=new Node(),buttons=plans.map((key,i)=>Object.assign(new Node(['Subscribe monthly','Subscribe yearly'][i]),{dataset:{pricingSubscribe:key}}));
 const document=Object.assign(new EventTarget(),{documentElement:{lang:locale},hidden:false,getElementById:id=>id==='pricing-status'?status:null,querySelectorAll:()=>buttons,createTextNode:text=>new Node(text)});
 const window=Object.assign(new EventTarget(),{location:{search:'',pathname:'/en/pricing',assign(){throw Error('must not navigate');}}});
 return {document,window,status,buttons};
}
function requests(t,catalog){
 t.mock.method(globalThis,'fetch',async path=>({ok:true,status:200,json:async()=>path==='/api/auth/session'?{user:null}:catalog}));
}

test('static paid controls stay disabled and describe their availability before scripts load',()=>{
 for(const locale of ['en','zh-Hans','zh-Hant','ja']){
  const html=commercePage({kind:'pricing',locale});
  for(const match of html.matchAll(/<button[^>]*data-pricing-subscribe[^>]*>/g)){
   assert.match(match[0],/\bdisabled\b/);
   assert.match(match[0],/aria-describedby="pricing-status"/);
  }
 }
});

test('disabled production billing labels both paid actions as unavailable',async t=>{
 requests(t,{enabled:false,mode:'test',products:plans.map(key=>({key,available:false}))});
 const f=dom(),mounted=await mountPricingCheckout(f);t.after(()=>mounted.dispose());
 assert.match(f.status.textContent,/not open/);
 for(const button of f.buttons){assert.equal(button.disabled,true);assert.equal(button.textContent,'Not available yet');}
});

test('an unavailable offer is labelled independently and an available plan keeps its action',async t=>{
 requests(t,{enabled:true,mode:'live',products:[{key:plans[0],available:true},{key:plans[1],available:false}]});
 const f=dom(),mounted=await mountPricingCheckout(f);t.after(()=>mounted.dispose());
 assert.equal(f.buttons[0].disabled,false);assert.equal(f.buttons[0].textContent,'Subscribe monthly');
 assert.equal(f.buttons[1].disabled,true);assert.equal(f.buttons[1].textContent,'Not available yet');
});

test('catalog loading announces progress while payment controls remain disabled',async t=>{
 let release;const pending=new Promise(resolve=>release=resolve);
 t.mock.method(globalThis,'fetch',async path=>{if(path==='/api/billing/catalog')await pending;return {ok:true,status:200,json:async()=>path==='/api/auth/session'?{user:null}:{enabled:false,products:[]}};});
 const f=dom(),mounting=mountPricingCheckout(f);
 try{assert.equal(f.status.textContent,'Checking subscription availability…');assert.ok(f.buttons.every(button=>button.disabled));}
 finally{release();const mounted=await mounting;mounted.dispose();}
});


test('all supported languages explain that subscriptions are unavailable',async t=>{
 requests(t,{enabled:false,mode:'test',products:[]});
 for(const [locale,label] of [['zh-Hans','暂未开放'],['zh-Hant','暫未開放'],['ja','現在利用できません']]){
  const f=dom(locale),mounted=await mountPricingCheckout(f);
  try{assert.ok(f.buttons.every(button=>button.disabled&&button.textContent===label));assert.ok(f.status.textContent);assert.doesNotMatch(f.status.textContent,/Test checkout/);}
  finally{mounted.dispose();}
 }
});

test('a fresh available catalog restores the original plan actions',async t=>{
 const catalog={enabled:false,mode:'test',products:[]};requests(t,catalog);
 const f=dom(),mounted=await mountPricingCheckout(f);t.after(()=>mounted.dispose());
 Object.assign(catalog,{enabled:true,mode:'live',products:plans.map(key=>({key,available:true}))});
 await mounted.controller.identityChanged();
 assert.deepEqual(f.buttons.map(button=>button.textContent),['Subscribe monthly','Subscribe yearly']);
 assert.ok(f.buttons.every(button=>!button.disabled));assert.equal(f.status.textContent,'');
});
