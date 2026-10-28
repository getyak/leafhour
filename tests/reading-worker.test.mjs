import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {createHash,webcrypto} from 'node:crypto';
import {createOfflineBookStore} from '../app/offline-book-store.mjs';

const origin='https://reader.invalid',digest=value=>createHash('sha256').update(value).digest('hex');
const resource=(url,body)=>({url,bytes:Buffer.byteLength(body),sha256:digest(body)});
const bodies={'/offline-reader.html':'<main>public reader</main>','/offline.html':'<main>local shelf</main>','/reader-web/reader-1111111111111111.js':'import "/lazy.mjs";','/lazy.mjs':'export const release=1;'};
const release={version:'1'.repeat(64),readerShell:'/offline-reader.html',offlineShelf:'/offline.html',readerEntries:['/reader-web/reader-1111111111111111.js'],readerPolicy:"default-src 'self'",resources:Object.entries(bodies).map(([url,body])=>resource(url,body))};
function cacheStorage(){const stores=new Map();return {stores,async open(name){if(!stores.has(name))stores.set(name,new Map());const rows=stores.get(name),key=request=>new URL(typeof request==='string'?request:request.url,origin).href;return {async put(request,response){rows.set(key(request),response.clone());},async match(request){return rows.get(key(request))?.clone();},async delete(request){return rows.delete(key(request));},async keys(){return [...rows.keys()].map(url=>new Request(url));}};},async keys(){return [...stores.keys()];},async delete(name){return stores.delete(name);}};}
async function worker({manifest=release,files=bodies,caches=cacheStorage(),clients=[],network=async request=>new Response(files[new URL(request.url||request,origin).pathname]||'missing',{status:files[new URL(request.url||request,origin).pathname]?200:404})}={}){
 const listeners=new Map(),fetches=[],controlled=new Set(clients.filter(client=>client.controlled).map(client=>client.id));let claims=0;
 const self={location:new URL(origin+'/reading-worker.js'),clients:{async matchAll(options={}){return options.includeUncontrolled?clients:clients.filter(client=>controlled.has(client.id));},async claim(){claims++;for(const client of clients)if(new URL(client.url).origin===origin)controlled.add(client.id);}},registration:{},addEventListener(type,handler){listeners.set(type,handler);}};
 const source=(await readFile(new URL('../app/reading-worker.js',import.meta.url),'utf8')).replace('null/* LEAFHOUR_OFFLINE_RELEASE */',JSON.stringify(manifest));
 vm.runInNewContext(source,{self,caches,crypto:webcrypto,URL,Request,Response,Headers,TextEncoder,console,fetch:async(request,options)=>{fetches.push({url:request.url||String(request),options});return network(request,options);}});
 return {caches,fetches,get claims(){return claims;},async install(){let job;listeners.get('install')({waitUntil(promise){job=promise;}});await job;},async activate(){let job;listeners.get('activate')({waitUntil(promise){job=promise;}});await job;},async status(clientId='page',options={}){let reply,job;listeners.get('message')({data:{type:'LEAFHOUR_OFFLINE_STATUS',requestId:'ask',...options},source:{id:clientId,url:clients.find(client=>client.id===clientId)?.url||origin+'/read',postMessage(value){reply=value;}},waitUntil(promise){job=promise;}});await job;return reply;},async fetch(url,{navigate=false,clientId='page',resultingClientId='',method='GET'}={}){let response;listeners.get('fetch')({request:{url:new URL(url,origin).href,method,mode:navigate?'navigate':'cors'},clientId,resultingClientId,respondWith(value){response=Promise.resolve(value);}});return response?await response:undefined;}};
}

test('resource preparation validates all bytes before advertising readiness and corruption revokes it',async()=>{
 const w=await worker();assert.equal((await w.status()).ready,false);await w.install();assert.equal((await w.status()).ready,true);
 const group=[...w.caches.stores.keys()].find(key=>key.includes(release.version));const cache=await w.caches.open(group);await cache.put(origin+'/lazy.mjs',new Response('corrupted'));
 assert.equal((await w.status()).ready,false,'missing or damaged public bytes cannot promise offline reading');
 for(const request of w.fetches){assert.equal(request.options.credentials,'omit');assert.equal(request.options.cache,'no-store');}
});

test('failed digest preparation cannot leave a partial release available',async()=>{
 const w=await worker({files:{...bodies,'/lazy.mjs':'different release'}});await assert.rejects(w.install(),/digest|integrity/i);assert.equal((await w.status()).ready,false);
});

test('offline navigation only restores public reader and shelf while APIs and private routes remain untouched',async()=>{
 let offline=false;const w=await worker({network:async request=>{if(offline)throw TypeError('offline');const url=new URL(request.url||request,origin);return new Response(bodies[url.pathname]||'<main>personalized live document</main>',{headers:{'Set-Cookie':'not-a-cache-input=1'}});}});await w.install();
 const online=await w.fetch('/read?book=public',{navigate:true});assert.match(await online.text(),/personalized/);offline=true;
 for(const route of ['/read?book=public','/_ui/read?book=public','/en/read?book=public','/zh-hans/read','/zh-hant/read','/ja/read'])assert.equal(await (await w.fetch(route,{navigate:true})).text(),bodies['/offline-reader.html']);
 assert.equal(await (await w.fetch('/offline',{navigate:true})).text(),bodies['/offline.html']);
 for(const route of ['/api/library/books/private','/auth','/gift/token','/billing','/book-gift'])assert.equal(await w.fetch(route,{navigate:!route.startsWith('/api/')}),undefined,route+' is outside offline fallbacks');
 assert.equal(await w.fetch('/api/book',{method:'POST'}),undefined);
 for(const rows of w.caches.stores.values())for(const response of rows.values()){assert.doesNotMatch(await response.clone().text(),/personalized live document|not-a-cache-input/);assert.equal(response.headers.get('Set-Cookie'),null,'public cached resources retain no cookie headers');}
});

test('an old page keeps its pinned modules and a new unprepared release cannot borrow old raw modules',async()=>{
 let navigation=false;const w=await worker({network:async request=>{const pathname=new URL(request.url||request,origin).pathname;if(navigation&&pathname==='/read')return new Response('<script type="module" src="/reader-web/reader-2222222222222222.js"></script>');return new Response(bodies[pathname]||'new resource');}});await w.install();
 assert.equal(await (await w.fetch('/lazy.mjs',{clientId:'old'})).text(),bodies['/lazy.mjs']);navigation=true;await w.fetch('/read',{navigate:true,resultingClientId:'new'});
 assert.equal((await w.status('new')).ready,false,'a newer network document is not paired with the older offline resource group');
 const cacheNames=await w.caches.keys();assert.ok(cacheNames.some(name=>name.includes(release.version)),'old release stays available for the old page');
 assert.equal(await (await w.fetch('/lazy.mjs',{clientId:'old'})).text(),bodies['/lazy.mjs']);
});

test('natural activation preserves live client releases and removes abandoned resource groups and pins',async()=>{
 const caches=cacheStorage(),old=await worker({caches,network:async request=>new Response(new URL(request.url||request,origin).pathname==='/read'?'<script type="module" src="/reader-web/reader-1111111111111111.js"></script>':bodies[new URL(request.url||request,origin).pathname])});await old.install();await old.fetch('/read',{navigate:true,resultingClientId:'old-live'});await old.fetch('/read',{navigate:true,resultingClientId:'closed-page'});
 const orphanVersion='3'.repeat(64),orphan=await worker({caches,manifest:{...release,version:orphanVersion}});await orphan.install();
 const currentVersion='2'.repeat(64),current=await worker({caches,manifest:{...release,version:currentVersion},clients:[{id:'old-live',url:origin+'/read?book=example'}]});await current.install();await current.activate();
 const names=await caches.keys();assert.ok(names.some(name=>name.includes(release.version)),'old live page retains its complete matching resources');assert.ok(names.some(name=>name.includes(currentVersion)),'active release remains available');assert.ok(!names.some(name=>name.includes(orphanVersion)),'an unused old group does not consume book storage forever');
 const pins=await caches.open('leafhour-reading-client-pins-v1');assert.equal(await pins.match(origin+'/__leafhour-offline__/client/closed-page'),undefined,'closed page pins are removed after live references are counted');assert.ok(await pins.match(origin+'/__leafhour-offline__/client/old-live'));
 assert.equal((await current.status('old-live')).version,release.version);assert.equal((await current.status('old-live')).ready,true);
});

test('successful online navigation remains online when client-pin storage fails',async()=>{
 let failPins=false;const caches=cacheStorage(),open=caches.open.bind(caches);caches.open=async name=>{if(failPins&&name==='leafhour-reading-client-pins-v1')throw Error('storage unavailable');return open(name);};
 const w=await worker({caches,network:async request=>new Response(new URL(request.url||request,origin).pathname==='/read'?'<main>live new page</main>':bodies[new URL(request.url||request,origin).pathname])});await w.install();failPins=true;
 const response=await w.fetch('/read',{navigate:true,resultingClientId:'online-page'});assert.equal(await response.text(),'<main>live new page</main>','only a real fetch rejection permits the offline navigation shell');assert.equal((await w.status('online-page')).ready,false);
});

test('a fully prepared next release pins new pages and survives worker restart without mixing raw modules',async()=>{
 const caches=cacheStorage(),newEntry='/reader-web/reader-2222222222222222.js',newFiles={...bodies,'/lazy.mjs':'export const release=2;',[newEntry]:'import "/added.mjs";','/added.mjs':'export const nextRelease=true;'},next={...release,version:'2'.repeat(64),readerEntries:[newEntry],resources:Object.entries(newFiles).map(([url,body])=>resource(url,body))};
 const old=await worker({caches,network:async request=>new Response(new URL(request.url||request,origin).pathname==='/read'?`<script type="module" src="${newEntry}"></script>`:bodies[new URL(request.url||request,origin).pathname])});await old.install();const installing=await worker({caches,manifest:next,files:newFiles});await installing.install();
 await old.fetch('/read',{navigate:true,resultingClientId:'new-page'});assert.equal((await old.status('new-page')).version,next.version);assert.equal((await old.status('new-page')).ready,true);assert.equal(await (await old.fetch('/lazy.mjs',{clientId:'new-page'})).text(),newFiles['/lazy.mjs']);
 const restarted=await worker({caches,network:async()=>{throw TypeError('offline');}});assert.equal(await (await restarted.fetch('/added.mjs',{clientId:'new-page'})).text(),newFiles['/added.mjs'],'a unique lazy module is the first request after restart');assert.equal(await (await restarted.fetch(newEntry,{clientId:'new-page'})).text(),newFiles[newEntry]);assert.equal(await (await restarted.fetch('/lazy.mjs',{clientId:'old-page'})).text(),bodies['/lazy.mjs']);
});

test('first-client claim requires a verified matching entry and fences other unknown pages before takeover',async()=>{
 const caches=cacheStorage(),clients=[{id:'first',url:origin+'/read'},{id:'older-unknown',url:origin+'/read?book=old'},{id:'known',url:origin+'/read?book=known'},{id:'foreign',url:'https://other.invalid/read'}];
 const pins=await caches.open('leafhour-reading-client-pins-v1');await pins.put(origin+'/__leafhour-offline__/client/known',new Response(release.version));let readingNetwork=false;
 const w=await worker({caches,clients,network:async request=>new Response(readingNetwork?'network own graph':bodies[new URL(request.url||request,origin).pathname])});await w.install();await w.activate();assert.equal(w.claims,0,'activation never forces control');
 const reply=await w.status('first',{readerEntry:release.readerEntries[0],claimUncontrolled:true});assert.equal(reply.ready,true);assert.equal(w.claims,1);assert.equal((await pins.match(origin+'/__leafhour-offline__/client/first')).status,200);assert.equal(await (await pins.match(origin+'/__leafhour-offline__/client/older-unknown')).text(),'network');assert.equal(await (await pins.match(origin+'/__leafhour-offline__/client/known')).text(),release.version);assert.equal(await pins.match(origin+'/__leafhour-offline__/client/foreign'),undefined);
 readingNetwork=true;assert.equal((await w.status('older-unknown')).ready,false);assert.equal(await (await w.fetch('/lazy.mjs',{clientId:'older-unknown'})).text(),'network own graph');
 const restarted=await worker({caches});assert.equal((await restarted.status('older-unknown')).ready,false,'unknown-page fence survives a stopped worker');assert.equal((await restarted.status('first')).ready,true);assert.equal((await restarted.status('late-unknown')).ready,false,'a page opened during or after claim cannot inherit an unverified graph');
});

test('first-client claim rejects unknown entries and damaged groups without claiming other clients',async()=>{
 const w=await worker({clients:[{id:'first',url:origin+'/read'}]});await w.install();
 for(const readerEntry of ['/reader-web/reader-9999999999999999.js','/reader-web/reader-1111111111111111.js?other=1',null]){assert.equal((await w.status('first',{readerEntry,claimUncontrolled:true})).ready,false);assert.equal(w.claims,0);}
 const cache=await w.caches.open('leafhour-reading-static-v1:'+release.version);await cache.put(origin+'/lazy.mjs',new Response('damaged'));assert.equal((await w.status('first',{readerEntry:release.readerEntries[0],claimUncontrolled:true})).ready,false);assert.equal(w.claims,0);
});

test('first-client claim fails closed when another unknown page cannot be durably fenced',async()=>{
 const caches=cacheStorage(),open=caches.open.bind(caches);caches.open=async name=>{const cache=await open(name);if(name!=='leafhour-reading-client-pins-v1')return cache;const put=cache.put;return {...cache,async put(request,response){if(String(request).endsWith('/older-unknown'))throw Error('pin storage unavailable');return put(request,response);}};};
 const w=await worker({caches,clients:[{id:'first',url:origin+'/read'},{id:'older-unknown',url:origin+'/read?book=old'}]});await w.install();for(let attempt=0;attempt<2;attempt++){assert.equal((await w.status('first',{readerEntry:release.readerEntries[0],claimUncontrolled:true})).ready,false);assert.equal(w.claims,0,'an earlier failed pin in worker memory is not proof of durable isolation');}
});

test('an online offline-shelf navigation uses the verified shell paired with its worker release',async()=>{
 const w=await worker({network:async request=>new Response(new URL(request.url||request,origin).pathname==='/offline'?'<main>new deployment shelf markup</main>':bodies[new URL(request.url||request,origin).pathname])});await w.install();
 assert.equal(await (await w.fetch('/offline',{navigate:true,resultingClientId:'shelf-page'})).text(),bodies['/offline.html']);assert.equal((await w.status('shelf-page')).version,release.version);assert.equal((await w.status('shelf-page')).ready,true);
});

test('library navigation stays live online and uses only the verified local shelf on network failure',async()=>{
 let offline=false,roomOpened=false;const privateHtml='<main>private live reading room</main>',w=await worker({network:async request=>{if(offline)throw TypeError('offline');const pathname=new URL(request.url||request,origin).pathname;if(['/library','/_ui/library','/library.html'].includes(pathname))return new Response(privateHtml,{headers:{'Content-Type':'text/html','Set-Cookie':'private-room=1','Cache-Control':'private, no-store'}});if(roomOpened&&pathname==='/lazy.mjs')return new Response('new deployment module');return new Response(bodies[pathname]);}});await w.install();roomOpened=true;
 for(const [index,route]of ['/library','/_ui/library','/library.html'].entries()){
  const response=await w.fetch(route,{navigate:true,resultingClientId:'online-room-'+index});assert.equal(await response.text(),privateHtml);assert.equal(response.headers.get('Set-Cookie'),'private-room=1');assert.equal(response.headers.get('Cache-Control'),'private, no-store');assert.equal((await w.status('online-room-'+index)).ready,false,'online room loads its own current module graph');assert.equal(await (await w.fetch('/lazy.mjs',{clientId:'online-room-'+index})).text(),'new deployment module');
 }
 offline=true;
 for(const [index,route]of ['/library','/_ui/library','/library.html'].entries()){
  const response=await w.fetch(route,{navigate:true,resultingClientId:'offline-room-'+index});assert.equal(await response.text(),bodies['/offline.html']);assert.equal(response.headers.get('Cache-Control'),'no-store');assert.equal((await w.status('offline-room-'+index)).version,release.version);assert.equal((await w.status('offline-room-'+index)).ready,true);
 }
 assert.equal(await w.fetch('/api/library/books',{navigate:false}),undefined,'the book API is never handled by the offline shell');
 for(const rows of w.caches.stores.values())for(const response of rows.values()){assert.doesNotMatch(await response.clone().text(),/private live reading room|private-room/);assert.equal(response.headers.get('Set-Cookie'),null);}
});

test('library HTTP rejection remains a rejection and never selects the saved shelf',async()=>{
 const w=await worker({network:async request=>new URL(request.url||request,origin).pathname==='/library'?new Response('<main>access denied</main>',{status:403}):new Response(bodies[new URL(request.url||request,origin).pathname])});await w.install();const response=await w.fetch('/library',{navigate:true,resultingClientId:'denied-room'});assert.equal(response.status,403);assert.equal(await response.text(),'<main>access denied</main>');assert.equal((await w.status('denied-room')).ready,false);
});

test('installation bounds concurrent public fetches and settles started work before discarding a failed group',async()=>{
 const files={...bodies};for(let i=0;i<12;i++)files['/extra-'+i+'.mjs']='export const marker='+i+';';const manifest={...release,resources:Object.entries(files).map(([url,body])=>resource(url,body))};
 let active=0,maximum=0;const network=async request=>{active++;maximum=Math.max(maximum,active);try{await new Promise(resolve=>setTimeout(resolve,3));return new Response(files[new URL(request.url||request,origin).pathname]);}finally{active--;}};
 const w=await worker({files,manifest,network});await w.install();assert.ok(maximum>1,'public resource preparation should not wait one full roundtrip per file');assert.ok(maximum<=6,'preparation must not flood the connection');assert.equal((await w.status()).ready,true);
 const caches=cacheStorage(),remove=caches.delete.bind(caches),discardedWhileActive=[];caches.delete=async name=>{discardedWhileActive.push(active);return remove(name);};
 const failing=await worker({caches,files,manifest,network:async request=>{if(new URL(request.url||request,origin).pathname==='/offline-reader.html')throw Error('fixture transport failure');return network(request);}});await assert.rejects(failing.install(),/fixture transport failure/);assert.deepEqual(discardedWhileActive,[0],'started fetches settle before the failed cache is deleted');assert.equal((await failing.status()).ready,false);
});

test('offline shelf removes displayed book names when another page revokes the local account scope',async()=>{
 let owner='account-a';const {nodes,handlers}=await shelf({owner:()=>owner,list:async()=>[{bookId:'saved',title:'Private saved title',loaded:1,total:2,complete:false}]});
 assert.equal(nodes.get('offline-books').children.length,1);owner=null;assert.equal(typeof handlers.get('storage'),'function');handlers.get('storage')();assert.equal(nodes.get('offline-books').children.length,0,'old account book names leave the visible shelf immediately');
});

async function shelf(store,{locale='en'}={}){
 const handlers=new Map(),node=()=>({textContent:'',children:[],disabled:false,events:new Map(),append(...values){this.children.push(...values);},replaceChildren(...values){this.children=values;},addEventListener(type,handler){this.events.set(type,handler);},trigger(type){return this.events.get(type)?.();}}),nodes=new Map(['label','title','description','online','status','books','clear','clear-help'].map(key=>['offline-'+key,node()]));
 const source=(await readFile(new URL('../app/offline-shelf.mjs',import.meta.url),'utf8')).replace(/^import[^\n]+\n/,'');const document={documentElement:{},getElementById:id=>nodes.get(id),createElement:()=>node()};
 await vm.runInNewContext('(async()=>{'+source+'})()',{document,window:{addEventListener(type,handler){handlers.set(type,handler);}},navigator:{language:locale},location:{href:origin+'/offline?ui='+encodeURIComponent(locale)},URL,createOfflineBookStore:()=>store});return {nodes,handlers,document};
}
async function savedShelfStore(){
 const values=new Map([['note-drafts|account-a','keep my draft']]),storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key)},rows={books:new Map(),chapters:new Map()};
 const backend={gate:null,fail:false,async run(_mode,operation){if(this.gate)await this.gate;if(this.fail)throw Error('persistent deletion failed');return operation({get:async(store,key)=>structuredClone(rows[store].get(key)),all:async store=>[...rows[store].values()].map(value=>structuredClone(value)),keys:async(store,index,key)=>[...rows[store]].filter(([,row])=>!index||row[index]===key).map(([id])=>id),put:async(store,row)=>rows[store].set(row.key,structuredClone(row)),delete:async(store,key)=>rows[store].delete(key)});}};
 const store=createOfflineBookStore({storage,backend}),sections=[{chapterId:'one',number:1,paragraphs:[{id:'p-one',original:'Saved source passage',translations:{}}]}],chapter={bookId:'private',contentVersion:'v1',chapterId:'one',sections},stable=JSON.stringify(chapter,(_key,value)=>value&&typeof value==='object'&&!Array.isArray(value)?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a<b?-1:a>b?1:0)):value);
 await store.adopt('account-a');await store.saveBook({bookId:'private',title:'Private saved title',contentVersion:'v1',chapters:[{id:'one',title:'One'}],sections,readingCache:{schemaVersion:1,snapshotId:'snapshot-v1',chapters:{one:digest(stable)}}});return {store,storage,backend,rows};
}

for(const [locale,label,working,done]of [
 ['en','Remove books from this device','Removing saved books…','Books removed from this device.'],
 ['zh-Hans','清除本机书籍','正在清除本机书籍…','已清除本机书籍。'],
 ['zh-Hant','清除本機書籍','正在清除本機書籍…','已清除本機書籍。'],
 ['ja','この端末から本を削除','保存した本を削除しています…','この端末から本を削除しました。']
])test('shelf clear revokes actual local scope and titles before deletion finishes ['+locale+']',async()=>{
 const {store,storage,backend,rows}=await savedShelfStore(),{nodes}=await shelf(store,{locale}),button=nodes.get('offline-clear');assert.equal(button.disabled,false);assert.equal(button.textContent,label);assert.equal(nodes.get('offline-books').children.length,1);
 let finish;backend.gate=new Promise(resolve=>{finish=resolve;});const clearing=button.trigger('click');assert.equal(store.owner(),null,'the real store revokes access synchronously');assert.equal(nodes.get('offline-books').children.length,0,'titles are removed before deletion finishes');assert.equal(button.disabled,true);assert.equal(nodes.get('offline-status').textContent,working);finish();await clearing;
 assert.equal(nodes.get('offline-status').textContent,done);assert.equal(rows.books.size,0);assert.equal(rows.chapters.size,0);assert.equal(storage.getItem('note-drafts|account-a'),'keep my draft');assert.equal(createOfflineBookStore({storage,backend}).owner(),null);
});

test('failed shelf deletion keeps titles inaccessible and reports remaining files truthfully',async()=>{
 const {store,storage,backend,rows}=await savedShelfStore(),{nodes,handlers}=await shelf(store);backend.fail=true;await nodes.get('offline-clear').trigger('click');assert.equal(store.owner(),null);assert.equal(nodes.get('offline-books').children.length,0);assert.equal(nodes.get('offline-clear').disabled,true);assert.equal(rows.books.size,1,'failed physical deletion must not be reported as removed');assert.equal(nodes.get('offline-status').textContent,'Local reading is closed, but some book files could not be removed.');handlers.get('pageshow')();assert.equal(nodes.get('offline-status').textContent,'Local reading is closed, but some book files could not be removed.');assert.equal(storage.getItem('note-drafts|account-a'),'keep my draft');assert.equal(createOfflineBookStore({storage,backend}).owner(),null);
});
