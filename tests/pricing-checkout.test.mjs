import test from 'node:test';
import assert from 'node:assert/strict';
const module=await import('../app/pricing-checkout-flow.mjs').catch(()=>({}));
const flow=options=>{assert.equal(typeof module.createPricingCheckout,'function','Pricing owns checkout without a billing-page detour');return module.createPricingCheckout(options);};
const monthly='reading_monthly_100',yearly='reading_yearly_1200';
function fixture({guest=false,enabled=true,openDelay=null,polls=[]}={}){
 const calls=[],view={user:guest?null:{id:'reader-a'},catalog:{enabled,mode:'live',available:enabled,products:[{key:monthly,available:enabled},{key:yearly,available:enabled}]},subscriptions:[],orders:[]};
 let complete,closeCallback,closeCount=0;
 const client={snapshot:()=>structuredClone({...view,session:{user:view.user}}),refreshSession:async()=>({user:view.user}),loadCatalog:async()=>view.catalog,loadSubscriptions:async()=>view.subscriptions,loadOrders:async()=>({orders:view.orders}),loadAccount:async()=>view.account||{},checkout:async key=>{calls.push(['checkout',key]);const order={id:'local-order',checkoutId:'ch_abc',productKey:key,status:'pending',checkoutUrl:'https://www.creem.io/checkout/prod_example/ch_abc'};view.orders=[order];return {checkoutUrl:order.checkoutUrl,order};},resumeCheckout:async id=>{calls.push(['resume',id]);return {...view.orders[0],checkoutUrl:view.orders[0].checkoutUrl};},recheckOrder:async id=>{calls.push(['recheck',id]);return polls.shift()||{id,status:'pending',paymentVerified:false};}};
 const controller=flow({client,openCheckout:async options=>{calls.push(['embed',options.checkoutUrl]);complete=options.onComplete;closeCallback=options.onClose;if(openDelay)await openDelay;return {close(){closeCount++;closeCallback?.();}};},onSignIn:async()=>{calls.push(['signin']);},navigate:url=>calls.push(['navigate',url]),onChange:state=>calls.push(['state',state.phase]),locale:'zh-Hans',delay:async()=>{},pollAttempts:2});
 return {controller,view,calls,client,complete:detail=>complete(detail),close:()=>closeCallback(),get closeCount(){return closeCount;}};
}

test('an anonymous choice preserves yearly plan through inline sign-in, then opens only that card checkout',async()=>{
 const f=fixture({guest:true});await f.controller.initialize();await f.controller.choose(yearly);
 assert.equal(f.controller.snapshot().selectedPlan,yearly);assert.equal(f.controller.snapshot().phase,'signin');assert.equal(f.calls.some(c=>c[0]==='checkout'),false);
 f.view.user={id:'reader-a'};await f.controller.authenticated();assert.deepEqual(f.calls.filter(c=>c[0]==='checkout'),[['checkout',yearly]]);assert.equal(f.controller.snapshot().phase,'checkout');assert.equal(f.calls.some(c=>c[0]==='navigate'),false);
});

test('unavailable billing never opens sign-in, creates an order or loads the provider',async()=>{
 const f=fixture({guest:true,enabled:false});await f.controller.initialize();await f.controller.choose(yearly);
 assert.equal(f.controller.snapshot().phase,'unavailable');assert.equal(f.calls.some(c=>['signin','checkout','embed'].includes(c[0])),false);
});

test('a browser completion callback cannot grant access before a fresh server-verified payment',async()=>{
 const f=fixture({polls:[{id:'local-order',status:'pending',paymentVerified:false},{id:'local-order',status:'paid',paymentVerified:true}]});await f.controller.initialize();await f.controller.choose(yearly);
 await f.complete({checkoutId:'ch_abc',orderId:'provider-order',redirect:true,redirectUrl:'https://attacker.example'});
 assert.equal(f.closeCount,1);assert.deepEqual(f.calls.filter(c=>c[0]==='recheck'),[['recheck','local-order'],['recheck','local-order']]);assert.deepEqual(f.calls.filter(c=>c[0]==='navigate'),[['navigate','/library?ui=zh-Hans']]);assert.equal(f.controller.snapshot().phase,'done');
});

test('an unrelated checkout callback is ignored and a pending payment stays on the pricing page',async()=>{
 const f=fixture();await f.controller.initialize();await f.controller.choose(monthly);await f.complete({checkoutId:'ch_foreign'});assert.equal(f.closeCount,0);assert.equal(f.calls.some(c=>c[0]==='recheck'),false);
 await f.complete({checkoutId:'ch_abc'});assert.equal(f.controller.snapshot().phase,'pending');assert.equal(f.calls.some(c=>c[0]==='navigate'),false);
 await f.controller.choose(monthly);assert.deepEqual(f.calls.filter(c=>c[0]==='checkout'),[['checkout',monthly]]);assert.deepEqual(f.calls.filter(c=>c[0]==='resume'),[['resume','local-order']]);
});

test('switching identity while the provider loads closes the stale frame and prevents late navigation',async()=>{
 let release;const wait=new Promise(resolve=>release=resolve),f=fixture({openDelay:wait});await f.controller.initialize();const opening=f.controller.choose(yearly);
 while(!f.calls.some(c=>c[0]==='embed'))await new Promise(resolve=>setImmediate(resolve));f.view.user={id:'reader-b'};await f.controller.identityChanged();release();await opening;
 assert.equal(f.closeCount,1);await f.complete({checkoutId:'ch_abc'});assert.equal(f.calls.some(c=>c[0]==='navigate'),false);assert.equal(f.controller.snapshot().selectedPlan,null);
});

test('multiple plan clicks during checkout cannot start a second order',async()=>{
 let release;const wait=new Promise(resolve=>release=resolve),f=fixture({openDelay:wait});await f.controller.initialize();const first=f.controller.choose(monthly);
 while(!f.calls.some(c=>c[0]==='embed'))await new Promise(resolve=>setImmediate(resolve));await f.controller.choose(yearly);release();await first;
 assert.deepEqual(f.calls.filter(c=>c[0]==='checkout'),[['checkout',monthly]]);
 f.controller.dispose();assert.equal(f.closeCount,1);
});

test('a paid status without verified payment and a mismatched local order never complete checkout',async()=>{
 const f=fixture({polls:[{id:'local-order',status:'paid',paymentVerified:false},{id:'another-order',status:'paid',paymentVerified:true}]});await f.controller.initialize();await f.controller.choose(yearly);await f.complete({checkoutId:'ch_abc'});
 assert.equal(f.calls.some(c=>c[0]==='navigate'),false);assert.notEqual(f.controller.snapshot().phase,'done');
});

import {createBillingClient,renderBillingAccount,catalogAvailability} from '../app/billing.mjs';
function realClientFixture({pauseCheckout=false}={}){
 const requests=[],session={user:{id:'reader-a'}},catalog={enabled:true,mode:'live',available:true,products:[{key:monthly,available:true},{key:yearly,available:true}]};let release;
 const fetcher=async(path,options={})=>{
  requests.push([path,options]);let data;
  if(path==='/api/auth/session')data=session;
  else if(path==='/api/billing/catalog')data=catalog;
  else if(path==='/api/billing/subscriptions')data={subscriptions:[]};
  else if(path.startsWith('/api/billing/orders'))data={orders:[]};
  else if(path==='/api/billing/checkouts'){
   const productKey=JSON.parse(options.body).productKey;
   if(pauseCheckout)await new Promise(resolve=>release=resolve);
   data={checkoutUrl:'https://www.creem.io/checkout/prod_test/ch_test',order:{id:'local-order',checkoutId:'ch_test',productKey,status:'pending'}};
  }else throw Error(path);
  return {ok:true,status:200,json:async()=>data};
 };
 const client=createBillingClient({fetcher,intentFactory:()=> 'intent'});client.adoptSession(session);
 return {client,requests,release:()=>release()};
}

test('the shared billing client accepts the verified yearly catalog and preserves its product identity',async()=>{
 const f=realClientFixture();await f.client.loadCatalog();await f.client.loadSubscriptions();await f.client.loadOrders();
 assert.equal(catalogAvailability(f.client.snapshot().catalog,yearly),'live');
 const result=await f.client.checkout(yearly);assert.equal(result.order.productKey,yearly);assert.equal(JSON.parse(f.requests.find(r=>r[0]==='/api/billing/checkouts')[1].body).productKey,yearly);
});

test('the shared client blocks another plan while a checkout request is in flight',async()=>{
 const f=realClientFixture({pauseCheckout:true});await f.client.loadCatalog();await f.client.loadSubscriptions();await f.client.loadOrders();const first=f.client.checkout(monthly);
 await assert.rejects(f.client.checkout(yearly),{code:'BILLING_SUBSCRIPTION_EXISTS'});f.release();await first;assert.equal(f.requests.filter(r=>r[0]==='/api/billing/checkouts').length,1);
});

test('the account keeps financial history but links plan selection back to pricing',()=>{
 const html=renderBillingAccount({locale:'en',session:{user:{id:'reader-a'}},catalog:{enabled:false},account:{availableUnits:0},entries:[],orders:[],subscriptions:[]});
 assert.match(html,/href="\/en\/pricing"/);assert.doesNotMatch(html,/data-billing-action="checkout"/);
});

const embedModule=await import('../app/checkout-embed.mjs').catch(()=>({}));
test('embedding rejects a non-provider URL before any external script is loaded',async()=>{
 assert.equal(typeof embedModule.createCheckoutEmbed,'function');let loads=0;
 const open=embedModule.createCheckoutEmbed({loadSdk:async()=>{loads++;return {};}});
 await assert.rejects(open({checkoutUrl:'https://evil.example/checkout'}),{code:'BILLING_INVALID_CHECKOUT'});assert.equal(loads,0);
});

test('the provider cannot redirect the merchant, and a stale identity cannot open an iframe',async()=>{
 assert.equal(typeof embedModule.createCheckoutEmbed,'function');let options,closed=0,allow=true,release;
 const sdk={openCheckout:config=>{options=config;return {close(){closed++;}};},close(){closed++;}};
 const open=embedModule.createCheckoutEmbed({loadSdk:async()=>sdk});let observed;
 const handle=await open({checkoutUrl:'https://www.creem.io/checkout/prod_test/ch_test',locale:'zh-Hans',onComplete:detail=>{observed=detail;handle.close();}});
 await options.onComplete({checkoutId:'ch_test',redirect:true,redirectUrl:'https://evil.example'});assert.deepEqual(observed,{checkoutId:'ch_test'});assert.equal(closed,1);handle.close();assert.equal(closed,1);
 const waiting=embedModule.createCheckoutEmbed({loadSdk:()=>new Promise(resolve=>release=()=>resolve(sdk))});const pending=waiting({checkoutUrl:'https://www.creem.io/checkout/prod_test/ch_test',isCurrent:()=>allow});allow=false;release();await assert.rejects(pending,{code:'BILLING_ACCOUNT_CHANGED'});
});

test('a frozen account cannot open another checkout even when its catalog remains available',async()=>{
 const f=fixture();f.view.account={frozen:true};await f.controller.initialize();await f.controller.choose(yearly);assert.equal(f.controller.snapshot().errorCode,'frozen_account');assert.equal(f.calls.some(c=>c[0]==='checkout'||c[0]==='embed'),false);
});

for(const stage of ['subscriptions','account','checkout','reconcile'])test('a real protected '+stage+' response that discovers a new account clears the checkout rather than hanging',async()=>{
 let actor='reader-a',armed=false,complete;const navigations=[],opened=[];
 const order={id:'local-order',checkoutId:'ch_test',productKey:yearly,status:'pending',checkoutUrl:'https://www.creem.io/checkout/prod_test/ch_test'};
 const client=createBillingClient({intentFactory:()=> 'intent',fetcher:async(path)=>{
  let data;
  if(path==='/api/auth/session')data={user:{id:actor}};
  else if(path==='/api/billing/catalog')data={enabled:true,mode:'live',products:[{key:yearly,available:true}]};
  else if(path==='/api/billing/subscriptions'){if(armed&&stage==='subscriptions')actor='reader-b';data={subscriptions:[]};}
  else if(path==='/api/billing/account'){if(armed&&stage==='account')actor='reader-b';data={availableUnits:0};}
  else if(path.startsWith('/api/billing/orders?'))data={orders:[]};
  else if(path==='/api/billing/checkouts'){if(stage==='checkout')actor='reader-b';data={checkoutUrl:order.checkoutUrl,order};}
  else if(path.includes('/orders/local-order')){if(stage==='reconcile')actor='reader-b';data={...order,status:'paid',paymentVerified:true};}
  else throw Error(path);
  return {ok:true,status:200,json:async()=>data};
 }});
 const controller=flow({client,openCheckout:async o=>{opened.push(o);complete=o.onComplete;return {close(){}};},navigate:url=>navigations.push(url),delay:async()=>{}});
 await controller.initialize();armed=true;await controller.choose(yearly);if(stage==='reconcile')await complete({checkoutId:'ch_test'});
 assert.equal(client.snapshot().session.user.id,'reader-b');assert.equal(controller.snapshot().phase,'error');assert.equal(controller.snapshot().errorCode,'BILLING_ACCOUNT_CHANGED');assert.equal(controller.snapshot().selectedPlan,null);assert.equal(navigations.length,0);if(stage!=='reconcile')assert.equal(opened.length,0);
});

test('login cannot restore a selected plan after initialization discovers another account',async()=>{
 let actor=null,switchDuringLoad=false,checkouts=0,opened=0;
 const client=createBillingClient({intentFactory:()=> 'intent',fetcher:async path=>{
  let data;
  if(path==='/api/auth/session')data={user:actor?{id:actor}:null};
  else if(path==='/api/billing/catalog')data={enabled:true,mode:'live',products:[{key:yearly,available:true}]};
  else if(path==='/api/billing/subscriptions'){if(switchDuringLoad){actor='reader-b';switchDuringLoad=false;}data={subscriptions:[]};}
  else if(path.startsWith('/api/billing/orders'))data={orders:[]};
  else if(path==='/api/billing/account')data={availableUnits:0};
  else if(path==='/api/billing/checkouts'){checkouts++;data={checkoutUrl:'https://www.creem.io/checkout/prod_test/ch_test',order:{id:'local-order',checkoutId:'ch_test',productKey:yearly}};}
  else throw Error(path);
  return {ok:true,status:200,json:async()=>data};
 }});
 const controller=flow({client,openCheckout:async()=>{opened++;return {close(){}};}});await controller.initialize();await controller.choose(yearly);assert.equal(controller.snapshot().phase,'signin');
 actor='reader-a';switchDuringLoad=true;await controller.authenticated();assert.equal(client.snapshot().session.user.id,'reader-b');assert.equal(checkouts,0);assert.equal(opened,0);assert.equal(controller.snapshot().selectedPlan,null);assert.equal(controller.snapshot().errorCode,'BILLING_ACCOUNT_CHANGED');
});

test('a pending annual order can resume directly from account history without another purchase',async()=>{
 const f=fixture({polls:[{id:'local-order',status:'paid',paymentVerified:true}]});await f.controller.initialize();f.view.orders=[{id:'local-order',checkoutId:'ch_abc',productKey:yearly,status:'pending',checkoutUrl:'https://www.creem.io/checkout/prod_example/ch_abc'}];
 assert.equal(typeof f.controller.resumeOrder,'function');await f.controller.resumeOrder('local-order');assert.equal(f.calls.some(c=>c[0]==='checkout'),false);assert.deepEqual(f.calls.filter(c=>c[0]==='resume'),[['resume','local-order']]);await f.complete({checkoutId:'ch_abc'});assert.equal(f.controller.snapshot().phase,'done');
});

test('a temporary server confirmation failure stays pending without asking for another payment',async()=>{
 const f=fixture();f.client.recheckOrder=async()=>{throw Object.assign(new Error('payment_amount_unverified'),{code:'payment_amount_unverified',status:409});};await f.controller.initialize();await f.controller.choose(yearly);await f.complete({checkoutId:'ch_abc'});assert.equal(f.controller.snapshot().phase,'pending');assert.equal(f.controller.snapshot().orderId,'local-order');assert.equal(f.calls.some(c=>c[0]==='navigate'),false);assert.equal(f.calls.filter(c=>c[0]==='checkout').length,1);
});

test('return-page confirmation preserves its local order for a later explicit retry',async()=>{
 const f=fixture();f.client.recheckOrder=async()=>{throw Object.assign(new Error('unavailable'),{status:503});};await f.controller.initialize();await f.controller.checkOrder('local-order');assert.equal(f.controller.snapshot().phase,'pending');assert.equal(f.controller.snapshot().orderId,'local-order');assert.equal(f.calls.some(c=>c[0]==='checkout'),false);
});
