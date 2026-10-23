import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const pages=await import('../app/commerce-pages.mjs').catch(()=>({}));
const billing=await import('../app/billing.mjs').catch(()=>({}));
const helper=name=>{assert.equal(typeof billing[name],'function',name+' is exported');return billing[name];};
const response=(data,status=200)=>({ok:status<400,status,json:async()=>data});
const session=id=>({user:id?{id,email:id+'@example.test'}:null});
const liveCatalog={enabled:true,mode:'live',available:true,products:[{key:'reading_monthly_100',available:true}]};

test('public pricing and policy pages have four canonical localized paths and truthful point prices',()=>{
 assert.equal(typeof pages.commercePage,'function');
 for(const [locale,slug] of [['en','en'],['zh-Hans','zh-hans'],['zh-Hant','zh-hant'],['ja','ja']])for(const kind of ['pricing','terms','refunds']){
  const html=pages.commercePage({kind,locale,billingEnabled:false});
  assert.match(html,new RegExp('lang="'+locale+'"'));
  assert.ok(html.includes('https://leafhour.com/'+slug+'/'+kind));
  assert.ok(html.includes('/'+slug+'/pricing'));
  assert.ok(html.includes('mailto:support@leafhour.com'));
  assert.match(html,/name="viewport"/);
  assert.doesNotMatch(html,/noindex|local-owner|Most popular/);
 }
 const en=pages.commercePage({kind:'pricing',locale:'en',billingEnabled:false});
 for(const text of ['US$0','US$5','US$50','100 reading points','1,200 reading points','10 trial points','1 point','4 points','automatically renews','automatic companion','Self-hosting','Reading and export stay free'])assert.ok(en.includes(text),text);
 assert.match(en,/Payments are not open/);
 const terms=pages.commercePage({kind:'terms',locale:'en'});assert.match(terms,/private uploads/i);assert.match(terms,/copyright/i);assert.match(terms,/AI.*draft/i);
 const refunds=pages.commercePage({kind:'refunds',locale:'en'});assert.match(refunds,/14 days/);assert.match(refunds,/unused purchased points/);assert.match(refunds,/Creem/);assert.match(refunds,/statutory rights/);
 assert.throws(()=>pages.commercePage({kind:'../../x',locale:'en'}));
});

test('readiness distinguishes disabled, sandbox and live rather than pretending test checkout is money',()=>{
 const availability=helper('catalogAvailability');
 assert.equal(availability({enabled:false,mode:'live',available:true}),'disabled');
 assert.equal(availability({...liveCatalog,mode:'test'}),'test');
 assert.equal(availability({enabled:true,mode:'live',available:false}),'unavailable');
 assert.equal(availability(liveCatalog),'live');
 for(const value of [null,{},[],{enabled:'false'}])assert.equal(availability(value),'unknown');
});

test('account render escapes real records and shows holds separately from consumption without invented rows',()=>{
 const render=helper('renderBillingAccount');
 const empty=render({locale:'en',session:session('A'),catalog:{enabled:false},account:{availableUnits:10000000,reservedUnits:4000000,grantedUnits:10000000,consumedUnits:0,trialGranted:true},entries:[],orders:[],entriesStatus:'ready',ordersStatus:'ready'});
 assert.match(empty,/10<\/strong>/);assert.match(empty,/4<\/strong>/);assert.match(empty,/Reserved/);assert.match(empty,/No point entries yet/);assert.match(empty,/No orders yet/);assert.match(empty,/Payments are not open/);
 const html=render({locale:'en',session:session('A'),catalog:{...liveCatalog,mode:'test'},account:{availableUnits:0},entries:[{id:'<script>',kind:'hold',units:4000000,action:'reading_conversation',createdAt:'2026-10-21T00:00:00Z'}],orders:[{id:'<img src=x onerror=alert(1)>',amount:500,currency:'USD',status:'pending',units:100000000,receiptUrl:'javascript:alert(1)'}]});
 assert.doesNotMatch(html,/<script>|<img src=x|javascript:/);assert.match(html,/&lt;script&gt;/);assert.match(html,/Processing/);assert.match(html,/<caption/);assert.match(html,/scope="col"/);
 assert.doesNotMatch(html,/data-billing-action="checkout"/);assert.match(html,/href="\/en\/pricing"/);
});

test('operator render keeps currencies separate and treats missing supplier usage as unknown',()=>{
 const html=helper('renderBillingAdmin')({locale:'en',summary:{accounts:2,orders:1,paidOrders:1,paidUsers:1,salesByCurrency:{USD:500,EUR:700},refundsByCurrency:{USD:0},grantedUnits:100000000,consumedUnits:4000000,reservedUnits:0,calls:3,knownCostMicrousd:10000,unknownCostCalls:2},from:'2026-10-20T16:00:00.000Z',to:'2026-10-21T16:00:00.000Z'});
 assert.match(html,/USD/);assert.match(html,/EUR/);assert.match(html,/2 calls with unknown/);assert.match(html,/Known supplier cost/);assert.doesNotMatch(html,/profit|margin/i);assert.match(html,/Asia\/Shanghai/);assert.match(html,/half-open/);
});

test('account switch during a protected read drops the response and clears prior private state',async()=>{
 const create=helper('createBillingClient');let current='A',resolveAccount;const requests=[];
 const client=create({fetcher:async(path,init)=>{requests.push({path,init});if(path==='/api/auth/session')return response(session(current));if(path==='/api/billing/catalog')return response({enabled:true,mode:'live',available:true});if(path==='/api/billing/account')return new Promise(resolve=>resolveAccount=resolve);return response({entries:[],orders:[]});}});
 await client.refreshSession();const pending=client.loadAccount();await new Promise(resolve=>setImmediate(resolve));current='B';resolveAccount(response({availableUnits:9000000}));
 await assert.rejects(pending,{code:'BILLING_ACCOUNT_CHANGED'});assert.equal(client.snapshot().account,null);assert.equal(client.snapshot().session.user.id,'B');
 assert.equal(requests.find(row=>row.path==='/api/billing/account').init.headers['X-Reader-Owner'],'A');
});

test('checkout uses one captured owner intent and cannot redirect after an account change',async()=>{
 const create=helper('createBillingClient');let current='A',resolveCheckout;const bodies=[];
 const client=create({intentFactory:()=> 'isolated-intent',fetcher:async(path,init)=>{if(path==='/api/auth/session')return response(session(current));if(path==='/api/billing/subscriptions')return response({subscriptions:[]});if(path==='/api/billing/checkouts'){bodies.push(JSON.parse(init.body));assert.equal(init.headers['X-Reader-Owner'],'A');return new Promise(resolve=>resolveCheckout=resolve);}return response({enabled:true,mode:'live',available:true});}});
 await client.refreshSession();await client.loadCatalog();await client.loadSubscriptions();const pending=client.checkout();await new Promise(resolve=>setImmediate(resolve));current='B';resolveCheckout(response({checkoutUrl:'https://checkout.creem.io/test',order:{id:'order-A'}}));
 await assert.rejects(pending,{code:'BILLING_ACCOUNT_CHANGED'});assert.deepEqual(bodies,[{productKey:'reading_monthly_100',intentKey:'isolated-intent'}]);assert.equal(client.snapshot().returnOrder,null);
});

test('order polling is owner guarded and checkout links only accept trusted HTTPS Creem hosts',async()=>{
 const safe=helper('safeCheckoutUrl');assert.equal(safe('https://checkout.creem.io/a'),'https://checkout.creem.io/a');assert.equal(safe('https://test-checkout.creem.io/a'),'https://test-checkout.creem.io/a');
 for(const url of ['javascript:alert(1)','https://creem.io.evil.test/a','http://creem.io/a','https://user:pass@creem.io/a'])assert.equal(safe(url),null,url);
 const create=helper('createBillingClient');let current='A';const client=create({fetcher:async path=>path==='/api/auth/session'?response(session(current)):response({id:'A-order',status:'paid',units:100000000})});await client.refreshSession();current=null;await assert.rejects(client.pollOrder('A-order'),{code:'BILLING_ACCOUNT_CHANGED'});assert.equal(client.snapshot().returnOrder,null);
});

test('private shell is noindex and keyboard responsive styles do not hide real empty states',async()=>{
 const html=await readFile(new URL('../app/billing.html',import.meta.url),'utf8');const css=await readFile(new URL('../app/billing.css',import.meta.url),'utf8');
 assert.match(html,/noindex/);assert.match(html,/id="main"/);assert.match(html,/billing.mjs/);assert.match(html,/auth-dialog/);assert.match(css,/:focus-visible/);assert.match(css,/@media/);assert.match(css,/overflow-x:\s*auto/);
});

test('real ledger entry types and separate trial, purchase and review balances remain visible',()=>{
 const render=helper('renderBillingAccount');
 const html=render({locale:'en',session:session('A'),catalog:{...liveCatalog,mode:'test'},account:{availableUnits:13000000,reservedUnits:4000000,sources:[{source:'trial',availableUnits:1000000,reservedUnits:0},{source:'purchase',availableUnits:10000000,reservedUnits:4000000},{source:'review',availableUnits:2000000,reservedUnits:0}]},entries:[{id:'hold-real',type:'hold',units:-4000000},{id:'trial-real',type:'grant',source:'trial',units:10000000}]});
 for(const text of ['Trial points','Purchased points','Review points','Processing · reserved','Trial grant'])assert.ok(html.includes(text),text);
});

test('operator funding and feature tables show real grouped calls, missing costs and source consumption',()=>{
 const html=helper('renderBillingAdmin')({locale:'en',summary:{callsByFunding:{sponsor:{calls:2,knownCostMicrousd:50,unknownCostCalls:1}},callsByFeature:{annotation:{calls:1,knownCostMicrousd:0,unknownCostCalls:1}},grantedUnitsBySource:{trial:10000000,purchase:100000000,review:100000000},consumedUnitsBySource:{trial:4000000,purchase:0,review:0},operationCounts:{failed:1,released:1,settled:1},paymentFeesStatus:'unknown',reviewOrders:1,trialGrants:1}});
 for(const text of ['Calls by funding','Calls by feature','Sponsored','Review points','Payment fees: Not reported','Failed','Settled'])assert.ok(html.includes(text),text);
 assert.ok(html.includes('0.000050'));
 assert.doesNotMatch(html,/profit|margin/i);
});

test('parallel account and statement reads for the same identity do not create a false account switch',async()=>{
 const create=helper('createBillingClient');const client=create({fetcher:async path=>path==='/api/auth/session'?response(session('A')):path==='/api/billing/account'?response({availableUnits:1000000}):response({entries:[],nextCursor:null})});await client.refreshSession();await Promise.all([client.loadAccount(),client.loadEntries()]);assert.equal(client.snapshot().account.availableUnits,1000000);
});

test('Shanghai report dates are real calendar dates with exclusive next-midnight boundaries',()=>{
 const range=helper('billingDateRange');assert.deepEqual(range('2026-10-20','2026-10-21'),{from:'2026-10-19T16:00:00.000Z',to:'2026-10-20T16:00:00.000Z'});for(const values of [['2026-02-30','2026-03-02'],['2026-10-21','2026-10-20']])assert.throws(()=>range(...values));
});

test('reservation entry shows its real held units when the immutable ledger balance delta is zero',()=>{
 const html=helper('renderBillingAccount')({locale:'en',session:session('A'),catalog:{enabled:false},account:{availableUnits:0},entries:[{id:'real-hold',type:'hold',units:0,reservedUnits:4000000}],orders:[]});assert.match(html,/<td>4<\/td><td>Processing · reserved<\/td>/);
});

test('the standalone reused auth dialog constrains its brand mark and aliases its local palette',async()=>{
 const css=await readFile(new URL('../app/billing.css',import.meta.url),'utf8');assert.match(css,/\.billing-page \.auth-brand\s*>\s*svg\s*\{[^}]*width:\s*29px/);assert.match(css,/--auth-paper:\s*var\(--bill-paper\)/);
});

test('order statements show actual refunds and do not claim an unverified paid status granted points',()=>{
 const render=helper('renderBillingAccount');const html=render({locale:'en',session:session('A'),catalog:{enabled:false},account:{availableUnits:0},orders:[{id:'unverified',status:'paid',paymentVerified:false,amount:500,currency:'USD',units:100000000,refundedAmount:200}]});assert.match(html,/USD\s2\.00/);assert.doesNotMatch(html,/Payment verified\. Points have been granted\./);
});

test('monthly and annual policies disclose full charges, upfront points, renewal and cancellation in all four locales',()=>{
 const expected={en:['US$5 / month','100 reading points','US$50 / year','1,200 reading points together, not in monthly instalments','automatically renews monthly or yearly','customer portal','no expiry','not unlimited'], 'zh-Hans':['US$5 / 月','100 阅读点','US$50 / 年','一次发放 1,200 阅读点，不按月分批到账','每月或每年自动续费','客户门户','不过期','并非无限'], 'zh-Hant':['US$5 / 月','100 閱讀點','US$50 / 年','一次發放 1,200 閱讀點，不按月分批入帳','每月或每年自動續費','客戶入口','不過期','並非無限'],ja:['US$5 / 月','100 読書ポイント','US$50 / 年','1,200 読書ポイントをまとめて付与し、月ごとに分割しません','毎月または毎年自動更新','カスタマーポータル','有効期限なし','無制限ではありません']};
 for(const [locale,phrases] of Object.entries(expected)){
  const html=pages.commercePage({locale}),terms=pages.commercePage({locale,kind:'terms'}),refunds=pages.commercePage({locale,kind:'refunds'});
  for(const phrase of phrases){assert.ok(html.includes(phrase),locale+' pricing: '+phrase);assert.ok(terms.includes(phrase),locale+' terms: '+phrase);}
  assert.doesNotMatch(html,/data-product-key="reading_100"/);assert.match(html,/data-product-key="reading_monthly_100"/);assert.match(html,/data-product-key="reading_yearly_1200"/);
  for(const kind of ['pricing','terms','refunds'])assert.doesNotMatch(pages.commercePage({locale,kind}),/one-time top-up|one-time US\$5|一次性充值|一次性儲值|1 回限りの追加購入|no automatic renewal|無自動續費|无自动续费/i);
  assert.ok(refunds.includes(phrases[5]),locale+' refunds cancellation');
  for(const proportion of ['100','1,200','×','÷'])assert.ok(refunds.includes(proportion),locale+' proportional unused-point refund: '+proportion);
 }
});

test('account statements link to plan selection and retain the balance and subscription management',()=>{
 const catalog={enabled:true,mode:'live',available:true,products:[{key:'reading_100',available:true},{key:'reading_monthly_100',available:false},{key:'reading_yearly_1200',available:true}]};
 assert.equal(helper('catalogAvailability')(catalog,'reading_100'),'unavailable');assert.equal(helper('catalogAvailability')(catalog,'reading_monthly_100'),'unavailable');assert.equal(helper('catalogAvailability')(catalog,'reading_yearly_1200'),'live');
 const base={locale:'en',session:session('A'),catalog,account:{availableUnits:107000000,trialGranted:true},subscriptions:[]};
 const html=helper('renderBillingAccount')(base);
 assert.doesNotMatch(html,/data-billing-action="checkout"/);assert.match(html,/href="\/en\/pricing"/);assert.match(html,/107<\/strong>/);
 const active=helper('renderBillingAccount')({...base,catalog:{...catalog,products:catalog.products.map(p=>({...p,available:true}))},subscriptions:[{id:'sub_A',status:'active',periodStart:'2026-10-21T00:00:00Z',periodEnd:'2026-11-21T00:00:00Z',nextTransactionDate:'2026-11-21T00:00:00Z'}]});
 for(const text of ['107</strong>','Active','Next payment','Manage / cancel renewal','data-subscription-id="sub_A"'])assert.ok(active.includes(text),text);
 assert.doesNotMatch(active,/data-billing-action="checkout"/);assert.match(active,/href="\/en\/pricing"/);
});

test('billing automatically admits the once-only trial without blocking purchased points on campaign exhaustion',async()=>{
 const calls=[];let granted=false;const client=helper('createBillingClient')({fetcher:async(path,init)=>{calls.push(path);if(path==='/api/auth/session')return response(session('A'));if(path==='/api/billing/account')return response({availableUnits:100000000,trialGranted:granted});if(path==='/api/billing/trial'){granted=true;return response({availableUnits:110000000,trialGranted:true});}return response({});}});
 await client.refreshSession();await client.loadAccount();await client.ensureTrial();await client.ensureTrial();
 assert.equal(calls.filter(path=>path==='/api/billing/trial').length,1);assert.equal(client.snapshot().account.availableUnits,110000000);
 const exhausted=helper('createBillingClient')({fetcher:async path=>path==='/api/auth/session'?response(session('A')):path==='/api/billing/account'?response({availableUnits:100000000,trialGranted:false}):response({error:{code:'trial_budget_exhausted'}},503)});
 await exhausted.refreshSession();await exhausted.loadAccount();await exhausted.ensureTrial();assert.equal(exhausted.snapshot().account.availableUnits,100000000);assert.equal(exhausted.snapshot().trialIssue,'trial_budget_exhausted');
});

test('automatic trial and subscription reads discard a response when the signed-in account changes',async()=>{
 for(const operation of ['ensureTrial','loadSubscriptions']){
  let current='A',resolvePrivate;const client=helper('createBillingClient')({fetcher:async path=>{if(path==='/api/auth/session')return response(session(current));if(path==='/api/billing/account')return response({trialGranted:false});return new Promise(resolve=>resolvePrivate=resolve);}});
  await client.refreshSession();await client.loadAccount();const pending=client[operation]();await new Promise(resolve=>setImmediate(resolve));current='B';resolvePrivate(response(operation==='ensureTrial'?{trialGranted:true,availableUnits:10000000}:{subscriptions:[{id:'sub_A',status:'active'}]}));
  await assert.rejects(pending,{code:'BILLING_ACCOUNT_CHANGED'});assert.equal(client.snapshot().account,null);assert.equal(client.snapshot().subscriptions,null);
 }
});

test('checkout intents are scoped to the selected product and active or pending plans cannot be purchased twice',async()=>{
 let serial=0;const bodies=[];const client=helper('createBillingClient')({intentFactory:()=> 'intent-'+(++serial),fetcher:async(path,init)=>{if(path==='/api/auth/session')return response(session('A'));if(path==='/api/billing/catalog')return response(liveCatalog);if(path==='/api/billing/subscriptions')return response({subscriptions:[]});if(path.startsWith('/api/billing/orders'))return response({orders:[]});bodies.push(JSON.parse(init.body));return response({checkoutUrl:'https://checkout.creem.io/'+serial,order:{id:'order-'+serial,productKey:JSON.parse(init.body).productKey,status:'pending'}});}});
 await client.refreshSession();await client.loadCatalog();await client.loadSubscriptions();
 await Promise.all([client.checkout(),client.checkout('reading_monthly_100')]);await assert.rejects(client.checkout('reading_100'),{code:'BILLING_INVALID_PRODUCT'});
 assert.deepEqual(bodies,[{productKey:'reading_monthly_100',intentKey:'intent-1'}]);
 const active=helper('createBillingClient')({fetcher:async path=>path==='/api/auth/session'?response(session('A')):response({subscriptions:[{id:'sub_A',status:'active'}]})});await active.refreshSession();await active.loadSubscriptions();await assert.rejects(active.checkout('reading_monthly_100'),{code:'BILLING_SUBSCRIPTION_EXISTS'});
});

test('portal uses only the owner-bound subscription ID and rejects unsafe URLs and stale identity',async()=>{
 let current='A',portalUrl='https://www.creem.io/my-orders/login/session',body;const client=helper('createBillingClient')({fetcher:async(path,init)=>{if(path==='/api/auth/session')return response(session(current));body=JSON.parse(init.body);return response({portalUrl});}});
 await client.refreshSession();assert.equal((await client.portal('sub_A')).portalUrl,portalUrl);assert.deepEqual(body,{subscriptionId:'sub_A'});
 portalUrl='https://evil.test/portal';await assert.rejects(client.portal('sub_A'),{code:'BILLING_INVALID_PORTAL'});
 current='B';await assert.rejects(client.portal('sub_A'),{code:'BILLING_ACCOUNT_CHANGED'});
});

test('unknown or incomplete monthly readiness cannot accidentally expose subscription checkout',()=>{
 const availability=helper('catalogAvailability');assert.equal(availability({enabled:true,available:true,mode:'live'},'reading_monthly_100'),'unavailable');
 assert.equal(availability({enabled:true,available:false,mode:'live',products:[{key:'reading_100',available:true},{key:'reading_monthly_100',available:false}]},'reading_100'),'unavailable');
 for(const products of [{},[null]])assert.equal(availability({enabled:true,available:true,mode:'live',products}),'unavailable');
});

test('an unfinished monthly order or scheduled cancellation blocks another subscription while a canceled plan can be replaced',async()=>{
 for(const status of ['active','scheduled_cancel','paused','unpaid','expired']){
  const html=helper('renderBillingAccount')({locale:'en',session:session('A'),catalog:{enabled:true,available:true,mode:'live',products:[{key:'reading_monthly_100',available:true}]},account:{availableUnits:100000000},subscriptions:[{subscriptionId:'sub_A',status,currentPeriodEnd:'2026-11-21T00:00:00Z'}]});
  assert.doesNotMatch(html,/data-billing-action="checkout"/);assert.match(html,/href="\/en\/pricing"/);assert.match(html,/100<\/strong>/);assert.match(html,/Current period ends/);assert.match(html,/Points already delivered remain/);assert.match(html,/data-billing-action="portal" data-subscription-id="sub_A"/);
  let checkoutCalls=0;const client=helper('createBillingClient')({fetcher:async path=>{if(path==='/api/auth/session')return response(session('A'));if(path==='/api/billing/subscriptions')return response({subscriptions:[{id:'sub_A',status}]});checkoutCalls++;return response({checkoutUrl:'https://checkout.creem.io/blocked'});}});
  await client.refreshSession();await client.loadSubscriptions();await assert.rejects(client.checkout('reading_monthly_100'),{code:'BILLING_SUBSCRIPTION_EXISTS'});assert.equal(checkoutCalls,0,status+' must not create a checkout');
 }
 let checkoutCalls=0,orderStatus='creating',subStatus='canceled';const client=helper('createBillingClient')({intentFactory:()=> 'monthly-new',fetcher:async(path)=>{if(path==='/api/auth/session')return response(session('A'));if(path==='/api/billing/catalog')return response(liveCatalog);if(path==='/api/billing/subscriptions')return response({subscriptions:[{id:'sub_A',status:subStatus}]});if(path.startsWith('/api/billing/orders'))return response({orders:[{id:'pending_monthly',productKey:'reading_monthly_100',status:orderStatus}]});checkoutCalls++;return response({checkoutUrl:'https://checkout.creem.io/new'});}});
 await client.refreshSession();await client.loadCatalog();await client.loadSubscriptions();await client.loadOrders();await assert.rejects(client.checkout('reading_monthly_100'),{code:'BILLING_SUBSCRIPTION_EXISTS'});assert.equal(checkoutCalls,0);
 orderStatus='cancelled';await client.loadOrders();await client.checkout('reading_monthly_100');assert.equal(checkoutCalls,1);
});

test('portal links reject checkout hosts, custom ports and paths outside the supplier portal',()=>{
 const safe=helper('safePortalUrl');assert.equal(safe('https://creem.io/my-orders/login/session'),'https://creem.io/my-orders/login/session');
 for(const url of ['https://checkout.creem.io/my-orders/login/session','https://creem.io:444/my-orders/login/session','https://creem.io/checkout/session','https://user@creem.io/my-orders/login/session','http://creem.io/my-orders/login/session','https://www.creem.io.evil.test/my-orders/login/session'])assert.equal(safe(url),null,url);
});

test('two automatic trial callers share admission and cannot grant before a private account is loaded',async()=>{
 let count=0,resolveTrial;const client=helper('createBillingClient')({fetcher:async path=>{if(path==='/api/auth/session')return response(session('A'));if(path==='/api/billing/account')return response({trialGranted:false});count++;return new Promise(resolve=>resolveTrial=resolve);}});
 await client.refreshSession();await client.ensureTrial();assert.equal(count,0);await client.loadAccount();const first=client.ensureTrial(),second=client.ensureTrial();await new Promise(resolve=>setImmediate(resolve));assert.equal(count,1);resolveTrial(response({trialGranted:true,availableUnits:10000000}));await Promise.all([first,second]);assert.equal(client.snapshot().account.availableUnits,10000000);
});

test('interrupted checkout can be resumed from its owner-bound order after remount without creating a second checkout',async()=>{
 const calls=[];const order={id:'order_pending',productKey:'reading_monthly_100',status:'pending',checkoutUrl:'https://checkout.creem.io/saved'};
 const client=helper('createBillingClient')({fetcher:async(path,init)=>{calls.push({path,owner:init.headers['X-Reader-Owner']});return path==='/api/auth/session'?response(session('A')):path==='/api/billing/subscriptions'?response({subscriptions:[]}):path.startsWith('/api/billing/orders?')?response({orders:[order]}):response(order);}});
 await client.refreshSession();await client.loadOrders();const html=helper('renderBillingAccount')({locale:'en',session:session('A'),catalog:{enabled:false},account:{},orders:client.snapshot().orders,subscriptions:[]});
 assert.match(html,/Continue checkout/);assert.match(html,/Check payment/);assert.match(html,/data-order-id="order_pending"/);
 assert.equal((await client.resumeCheckout('order_pending')).checkoutUrl,order.checkoutUrl);
 assert.ok(calls.some(c=>c.path==='/api/billing/orders/order_pending?reconcile=1'&&c.owner==='A'));assert.ok(calls.every(c=>c.path!=='/api/billing/checkouts'));
});

test('server-confirmed checkout expiration releases only that intent and requires another explicit purchase',async()=>{
 let serial=0,status='pending';const bodies=[];const order=()=>({id:'order_monthly',productKey:'reading_monthly_100',status});
 const client=helper('createBillingClient')({intentFactory:()=> 'expiry-intent-'+(++serial),fetcher:async(path,init)=>{
  if(path==='/api/auth/session')return response(session('A'));if(path==='/api/billing/catalog')return response(liveCatalog);if(path==='/api/billing/subscriptions')return response({subscriptions:[]});if(path==='/api/billing/account')return response({availableUnits:100000000,trialGranted:true});
  if(path.startsWith('/api/billing/orders?'))return response({orders:[order()]});if(path.startsWith('/api/billing/orders/'))return response(order());
  bodies.push(JSON.parse(init.body));return response({checkoutUrl:'https://checkout.creem.io/monthly',order:order()});
 }});
 await client.refreshSession();await client.loadCatalog();await client.loadSubscriptions();await client.checkout('reading_monthly_100');status='processing';await client.recheckOrder('order_monthly');await assert.rejects(client.checkout('reading_monthly_100'),{code:'BILLING_SUBSCRIPTION_EXISTS'});
 status='expired';await client.recheckOrder('order_monthly');assert.equal(bodies.length,1);assert.deepEqual(client.snapshot().pendingProducts,[]);await client.checkout('reading_monthly_100');
 assert.deepEqual(bodies.map(body=>body.intentKey),['expiry-intent-1','expiry-intent-2']);
});

test('checkout_expired errors clear an old intent without retrying or weakening an active subscription lock',async()=>{
 let serial=0;const bodies=[];const client=helper('createBillingClient')({intentFactory:()=> 'intent-'+(++serial),fetcher:async(path,init)=>{
  if(path==='/api/auth/session')return response(session('A'));if(path==='/api/billing/catalog')return response(liveCatalog);if(path==='/api/billing/subscriptions')return response({subscriptions:[]});bodies.push(JSON.parse(init.body));return response({error:{code:'checkout_expired'}},409);
 }});await client.refreshSession();await client.loadCatalog();await client.loadSubscriptions();await assert.rejects(client.checkout(),{code:'checkout_expired'});assert.equal(bodies.length,1);await assert.rejects(client.checkout(),{code:'checkout_expired'});assert.deepEqual(bodies.map(body=>body.intentKey),['intent-1','intent-2']);
});

test('stale checkout reconciliation can neither return a resume URL nor unlock a new account plan',async()=>{
 let current='A',resolveOrder;const client=helper('createBillingClient')({fetcher:async path=>path==='/api/auth/session'?response(session(current)):new Promise(resolve=>resolveOrder=resolve)});
 await client.refreshSession();const pending=client.resumeCheckout('order_A');await new Promise(resolve=>setImmediate(resolve));current='B';resolveOrder(response({id:'order_A',productKey:'reading_monthly_100',status:'expired',checkoutUrl:'https://checkout.creem.io/A'}));await assert.rejects(pending,{code:'BILLING_ACCOUNT_CHANGED'});assert.equal(client.snapshot().returnOrder,null);assert.equal(client.snapshot().subscriptions,null);
});

test('admin monthly, one-time and active subscription totals come from real summary values in every locale',()=>{
 const labels={en:['Monthly paid orders','One-time paid orders','Active subscriptions'],'zh-Hans':['月付实付订单','一次性实付订单','生效订阅'],'zh-Hant':['月付實付訂單','一次性實付訂單','生效訂閱'],ja:['月額の支払済み注文','1 回限りの支払済み注文','有効な定期契約']};
 for(const [locale,phrases] of Object.entries(labels)){
  const html=helper('renderBillingAdmin')({locale,summary:{monthlyPaidOrders:7,oneTimePaidOrders:0,activeSubscriptions:3}});
  for(const [index,value] of [7,0,3].entries())assert.ok(html.includes(phrases[index]+'</span><strong>'+value+'</strong>'),locale+': '+phrases[index]);
  const missing=helper('renderBillingAdmin')({locale,summary:{}});assert.ok(missing.includes(phrases[0]+'</span><strong>—</strong>'));
 }
});

test('a later expired order cannot clear the intent of a newer checkout',async()=>{
 let serial=0;const client=helper('createBillingClient')({intentFactory:()=> 'intent-'+(++serial),fetcher:async(path)=>{
  if(path==='/api/auth/session')return response(session('A'));if(path==='/api/billing/catalog')return response(liveCatalog);if(path==='/api/billing/subscriptions')return response({subscriptions:[]});if(path.startsWith('/api/billing/orders/'))return response({id:'old_order',productKey:'reading_monthly_100',status:'expired'});return response({checkoutUrl:'https://checkout.creem.io/current',order:{id:'current_order',productKey:'reading_monthly_100',status:'pending'}});
 }});await client.refreshSession();await client.loadCatalog();await client.loadSubscriptions();await client.checkout('reading_monthly_100');await client.pollOrder('old_order');assert.deepEqual(client.snapshot().pendingProducts,['reading_monthly_100']);await assert.rejects(client.checkout('reading_monthly_100'),{code:'BILLING_SUBSCRIPTION_EXISTS'});
});

test('account changes between reconciliation reloads cannot return the former account checkout URL',async()=>{
 let client,switched=false,current='A';const requests=[];
 client=helper('createBillingClient')({onChange:state=>{if(state.account&&!switched){switched=true;current='B';client.adoptSession(session('B'));}},fetcher:async(path,init)=>{
  requests.push({path,owner:init.headers['X-Reader-Owner']});if(path==='/api/auth/session')return response(session(current));if(path==='/api/billing/account')return response({availableUnits:100000000});if(path==='/api/billing/subscriptions')return response({subscriptions:[]});if(path.startsWith('/api/billing/orders?'))return response({orders:[]});return response({id:'order_A',productKey:'reading_monthly_100',status:'pending',checkoutUrl:'https://checkout.creem.io/A'});
 }});await client.refreshSession();await assert.rejects(client.resumeCheckout('order_A'),{code:'BILLING_ACCOUNT_CHANGED'});assert.equal(client.snapshot().session.user.id,'B');assert.ok(!requests.some(request=>request.path.startsWith('/api/billing/orders?')&&request.owner==='B'));
});


test('public pricing and policies share discoverable Agent, pricing and GitHub navigation with a native mobile menu',()=>{
 for(const [locale,slug]of [['en','en'],['zh-Hans','zh-hans'],['zh-Hant','zh-hant'],['ja','ja']])for(const kind of ['pricing','terms','refunds']){
  const html=pages.commercePage({kind,locale}),header=html.match(/<header[^>]*>[\s\S]*?<\/header>/)[0];
  assert.ok(header.includes('href="'+(locale==='en'?'/mcp':'/'+slug+'/mcp')+'"'));
  assert.ok(header.includes('href="/'+slug+'/pricing"'));
  assert.match(header,/aria-label="GitHub"/);assert.match(header,/<svg/);
  const accountName=header.match(/id="account-button"[^>]*aria-label="([^"]+)"/)[1];
  const compactLabel=header.match(/class="commerce-account-compact"[^>]*>([^<]+)<\/span>/)[1];
  assert.equal(accountName,({en:'My reading room','zh-Hans':'我的书房','zh-Hant':'我的書房',ja:'自分の書斎'})[locale]);
  assert.ok(accountName.toLocaleLowerCase().includes(compactLabel.toLocaleLowerCase()),'The compact visible reading-room label remains in its accessible name');
  assert.ok(header.includes('id="account-button" href="/library?ui='+locale+'"'));assert.doesNotMatch(header,/href="\/billing/);
  assert.match(html,/<dialog[^>]*id="home-menu"/);assert.match(header,/id="home-menu-trigger"/);
  assert.ok(html.includes('href="/'+slug+'/'+kind+'" lang="'+locale+'"'));
 }
});


test('three comparable plans keep free reading and interface languages separate from Chinese generation',()=>{
 const expected={en:['Read your own books','Notes and full export','Four interface languages','AI book questions and passage explanations','Literal and interpretive Chinese translations','English, Simplified Chinese, Traditional Chinese and Japanese','new translations currently target Chinese'], 'zh-Hans':['阅读自己的书','笔记与完整导出','4 种界面语言','阅读提问与选文解释','中文直译与意译','英语、简体中文、繁体中文和日语','目前新译文仅生成中文'], 'zh-Hant':['閱讀自己的書','筆記與完整匯出','4 種介面語言','閱讀提問與選文解釋','中文直譯與意譯','英語、簡體中文、繁體中文和日語','目前新譯文僅生成中文'],ja:['自分の本を読む','ノートと全件エクスポート','4 つの表示言語','本への質問と選択した文章の解説','中国語の直訳と意訳','英語、簡体字中国語、繁体字中国語、日本語','新しい翻訳は現在、中国語のみ']};
 for(const [locale,phrases] of Object.entries(expected)){
  const html=pages.commercePage({locale});for(const phrase of phrases)assert.ok(html.includes(phrase),locale+': '+phrase);
  const cards=[...html.matchAll(/<section class="point-pack[^\"]*"[^>]*>[\s\S]*?<\/section>/g)].map(match=>match[0]);
  assert.equal(cards.length,3);assert.deepEqual(cards.map(card=>card.match(/data-pricing-plan="([^"]+)"/)[1]),['free','reading_monthly_100','reading_yearly_1200']);
  assert.deepEqual([...html.matchAll(/data-pricing-subscribe="([^"]+)"/g)].map(match=>match[1]),['reading_monthly_100','reading_yearly_1200']);
  assert.match(cards[0],/US\$0/);assert.ok(cards[0].includes('href="/library?ui='+locale+'"'));assert.doesNotMatch(cards.join(''),/href="\/billing/);
  assert.match(cards[1],/US\$5/);assert.match(cards[1],/data-billing-period="month" data-price-usd="5" data-reading-points="100"/);
  assert.match(cards[2],/US\$50/);assert.match(cards[2],/1,200/);assert.match(cards[2],/data-billing-period="year" data-price-usd="50" data-reading-points="1200"/);
  assert.match(html,/<details class="pricing-details">/);assert.doesNotMatch(html,/<table/);
 }
});

test('retired one-time orders remain readable but cannot resume checkout',async()=>{
 const retired={id:'legacy_pending',productKey:'reading_100',status:'pending',checkoutUrl:'https://checkout.creem.io/retired'};
 const paid={...retired,id:'legacy_paid',status:'paid',paymentVerified:true,units:100000000,amount:500,currency:'USD',receiptUrl:'https://creem.io/receipt/legacy'};
 const client=helper('createBillingClient')({fetcher:async path=>path==='/api/auth/session'?response(session('A')):path==='/api/billing/subscriptions'?response({subscriptions:[]}):path.startsWith('/api/billing/orders?')?response({orders:[retired,paid]}):path==='/api/billing/account'?response({availableUnits:100000000}):response(retired)});
 await client.refreshSession();await assert.rejects(client.resumeCheckout(retired.id),{code:'BILLING_INVALID_PRODUCT'});
 assert.equal(client.snapshot().returnOrder.id,retired.id);
 const html=helper('renderBillingAccount')({locale:'en',session:session('A'),catalog:liveCatalog,account:{availableUnits:100000000},orders:[retired,paid],subscriptions:[]});
 assert.doesNotMatch(html,/data-billing-action="resume" data-order-id="legacy_pending"/);assert.match(html,/data-billing-action="recheck" data-order-id="legacy_pending"/);
 assert.match(html,/legacy_paid/);assert.match(html,/href="https:\/\/creem.io\/receipt\/legacy"/);assert.match(html,/100<\/strong>/);
});

test('default monthly checkout requires a current subscription read',async()=>{
 const requests=[];const client=helper('createBillingClient')({fetcher:async path=>{requests.push(path);return path==='/api/auth/session'?response(session('A')):response({});}});
 await client.refreshSession();await assert.rejects(client.checkout(),{code:'BILLING_SUBSCRIPTION_EXISTS'});assert.deepEqual(requests,['/api/auth/session']);
});

test('signed-in billing keeps unrequested histories and payment availability unknown in every locale',()=>{
 const client=helper('createBillingClient')();client.adoptSession(session('A'));
 for(const locale of ['en','zh-Hans','zh-Hant','ja']){
  const c=helper('billingLabels')(locale),html=helper('renderBillingAccount')({locale,...client.snapshot()});
  for(const text of [c.emptyEntries,c.emptyOrders,c.disabled])assert.ok(!html.includes(text),locale+': no unsupported empty or closed claim');
  for(const key of ['entriesUnknown','ordersUnknown','paymentUnknown','trialUnknown'])assert.ok(html.includes(c[key]),locale+': '+key);
  assert.match(html,/<strong>—<\/strong>/);assert.ok(html.includes(c.subscriptionUnknown));
  assert.doesNotMatch(html,/data-billing-action="(?:trial|checkout)"/);
 }
});

test('only a successful history read can establish an empty collection',async()=>{
 const client=helper('createBillingClient')({fetcher:async path=>path==='/api/auth/session'?response(session('A')):response({entries:[],orders:[],nextCursor:null})});
 await client.refreshSession();await client.loadEntries();
 let html=helper('renderBillingAccount')(client.snapshot());
 assert.match(html,/No point entries yet\./);assert.doesNotMatch(html,/No orders yet\./);
 await client.loadOrders();html=helper('renderBillingAccount')(client.snapshot());
 assert.match(html,/No point entries yet\./);assert.match(html,/No orders yet\./);
 client.adoptSession(session('B'));html=helper('renderBillingAccount')(client.snapshot());
 assert.doesNotMatch(html,/No point entries yet\.|No orders yet\./);
 assert.equal(client.snapshot().entriesStatus,'idle');assert.equal(client.snapshot().ordersStatus,'idle');
});

test('failed and malformed history reads cannot establish empty collections',async()=>{
 for(const kind of ['entries','orders'])for(const data of [null,{}, {[kind]:null},{[kind]:{}},{[kind]:[null]},{[kind]:['invalid']}]){
  const client=helper('createBillingClient')({fetcher:async path=>path==='/api/auth/session'?response(session('A')):response(data)});
  await client.refreshSession();await assert.rejects(client[kind==='entries'?'loadEntries':'loadOrders'](),{code:'BILLING_INVALID_RESPONSE'});
  assert.equal(client.snapshot()[kind+'Status'],'error');
  assert.doesNotMatch(helper('renderBillingAccount')(client.snapshot()),/No point entries yet\.|No orders yet\./);
 }
 const failed=helper('createBillingClient')({fetcher:async path=>path==='/api/auth/session'?response(session('A')):response({error:{code:'billing_store_unavailable'}},503)});
 await failed.refreshSession();await assert.rejects(failed.loadEntries(),{code:'billing_store_unavailable'});
 assert.doesNotMatch(helper('renderBillingAccount')(failed.snapshot()),/No point entries yet\.|No orders yet\./);
});

test('a failed later history page preserves successful records and cursor while unrelated success remains usable',async()=>{
 let failMore=true;const first={id:'entry-first',type:'grant',units:1000000},second={id:'entry-second',type:'consume',units:1000000};
 const client=helper('createBillingClient')({fetcher:async path=>{
  if(path==='/api/auth/session')return response(session('A'));
  if(path.startsWith('/api/billing/orders?'))return response({orders:[],nextCursor:null});
  if(path.includes('cursor='))return failMore?response({error:{code:'billing_store_unavailable'}},503):response({entries:[first,second],nextCursor:null});
  return response({entries:[first],nextCursor:'next-page'});
 }});
 await client.refreshSession();await client.loadEntries();await client.loadOrders();
 await assert.rejects(client.loadEntries({more:true}),{code:'billing_store_unavailable'});
 assert.deepEqual(client.snapshot().entries,[first]);assert.equal(client.snapshot().entriesCursor,'next-page');
 let html=helper('renderBillingAccount')(client.snapshot());assert.match(html,/entry-first/);assert.match(html,/No orders yet\./);assert.doesNotMatch(html,/No point entries yet\./);
 assert.ok(html.includes(helper('billingLabels')('en').recordsUnverified));
 failMore=false;await client.loadEntries({more:true});assert.deepEqual(client.snapshot().entries,[first,second]);assert.equal(client.snapshot().entriesStatus,'ready');
 html=helper('renderBillingAccount')(client.snapshot());assert.ok(!html.includes(helper('billingLabels')('en').recordsUnverified));
 client.adoptSession(session('B'));assert.deepEqual(client.snapshot().entries,[]);assert.equal(client.snapshot().entriesCursor,null);assert.equal(client.snapshot().entriesStatus,'idle');
});

test('a failed refresh of a previously empty history no longer asserts a current empty state',async()=>{
 let fail=false;const client=helper('createBillingClient')({fetcher:async path=>path==='/api/auth/session'?response(session('A')):fail?response({},503):response({entries:[]})});
 await client.refreshSession();await client.loadEntries();assert.match(helper('renderBillingAccount')(client.snapshot()),/No point entries yet\./);
 fail=true;await assert.rejects(client.loadEntries());assert.doesNotMatch(helper('renderBillingAccount')(client.snapshot()),/No point entries yet\./);
});

test('an identity change during a history read clears both records and their completion state',async()=>{
 let current='A',resolveEntries;const client=helper('createBillingClient')({fetcher:async path=>path==='/api/auth/session'?response(session(current)):new Promise(resolve=>resolveEntries=resolve)});
 await client.refreshSession();const pending=client.loadEntries();await new Promise(resolve=>setImmediate(resolve));current='B';resolveEntries(response({entries:[{id:'private-A'}]}));
 await assert.rejects(pending,{code:'BILLING_ACCOUNT_CHANGED'});assert.deepEqual(client.snapshot().entries,[]);assert.equal(client.snapshot().entriesStatus,'idle');
 assert.doesNotMatch(helper('renderBillingAccount')(client.snapshot()),/private-A|No point entries yet\./);
});

test('catalog failures and malformed responses remain unknown and cannot create a checkout',async()=>{
 let catalog=liveCatalog,fail=false;const requests=[];
 const client=helper('createBillingClient')({fetcher:async path=>{requests.push(path);if(path==='/api/auth/session')return response(session('A'));if(path==='/api/billing/subscriptions')return response({subscriptions:[]});if(path==='/api/billing/catalog')return response(catalog,fail?503:200);return response({checkoutUrl:'https://checkout.creem.io/should-not-open'});}});
 await client.refreshSession();await client.loadSubscriptions();await client.loadCatalog();
 for(const invalid of [null,{},[],{enabled:'false'}]){
  catalog=invalid;await assert.rejects(client.loadCatalog(),{code:'BILLING_INVALID_RESPONSE'});
  await assert.rejects(client.checkout(),{code:'BILLING_CATALOG_UNKNOWN'});
  assert.doesNotMatch(helper('renderBillingAccount')(client.snapshot()),/Payments are not open\./);
 }
 catalog=liveCatalog;await client.loadCatalog();fail=true;await assert.rejects(client.loadCatalog());
 assert.equal(client.snapshot().catalog,null);await assert.rejects(client.checkout(),{code:'BILLING_CATALOG_UNKNOWN'});
 assert.ok(!requests.includes('/api/billing/checkouts'));
 fail=false;catalog={enabled:false};await client.loadCatalog();assert.match(helper('renderBillingAccount')(client.snapshot()),/Payments are not open\./);
});

test('trial actions require a loaded account with an explicit trial state',async()=>{
 const requests=[];const client=helper('createBillingClient')({fetcher:async path=>{requests.push(path);return path==='/api/auth/session'?response(session('A')):response({availableUnits:1000000});}});
 await client.refreshSession();await assert.rejects(client.claimTrial(),{code:'BILLING_ACCOUNT_UNKNOWN'});await client.ensureTrial();
 await client.loadAccount();await client.ensureTrial();await assert.rejects(client.claimTrial(),{code:'BILLING_ACCOUNT_UNKNOWN'});
 assert.ok(!requests.includes('/api/billing/trial'));assert.doesNotMatch(helper('renderBillingAccount')(client.snapshot()),/data-billing-action="trial"/);
});
