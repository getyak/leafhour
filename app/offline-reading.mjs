import {createOfflineBookStore} from './offline-book-store.mjs';
import {assembleBookTransfer} from './book-transfer.mjs';
import {chapterHash} from './offline-book-codec.mjs';

const failure=(code,status=503)=>Object.assign(new Error(code),{code,status});
const response=value=>new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json; charset=utf-8'}});
const networkFailure=error=>error?.name==='TypeError'||error?.name==='NetworkError';
const emptyRecords=()=>({comments:[],questions:[],readingSessions:[],readingMilestones:[],highlights:[],position:null,offline:true});
export async function resolveOfflineReadingContext({store,bookId,session,networkFailed=false,readSession,request=globalThis.fetch,fetcher,isCurrent,onOffline}){
 if(readSession){
  let failed=false;const live=bookId?await readSession({request:async(...args)=>{try{return await request(...args);}catch(error){failed=true;throw error;}}}):null;
  const context=await resolveOfflineReadingContext({store,bookId,session:live,networkFailed:failed});context.verified=live!==null;
  context.transport=bookId?createOfflineReadingTransport({store,bookId,offline:context.offline,enabled:context.enabled,isCurrent,onOffline:onOffline||(()=>globalThis.document?.dispatchEvent(new Event('reader:offline'))),fetcher:(url,options={})=>fetcher(url,{...options,headers:{...options.headers,'X-Reader-Owner':context.owner||'guest'}})}):null;
  let warming=null;
  const canPrefetch=()=>!globalThis.document?.hidden&&!globalThis.navigator?.connection?.saveData&&!/^(slow-)?2g$/.test(globalThis.navigator?.connection?.effectiveType||'');
  const stopPrefetch=()=>{warming?.controller.abort();warming=null;};
  const prefetch=(id,ensure)=>{if(!canPrefetch())return Promise.resolve();if(warming?.id===id)return warming.promise;stopPrefetch();const controller=new AbortController(),task={id,controller};warming=task;task.promise=ensure(id,{signal:controller.signal}).finally(()=>{if(warming===task)warming=null;});return task.promise;};
  context.facade={hidePage:(document,view)=>queueMicrotask(()=>{if(document.body){document.body.replaceChildren();document.body.dataset.ready='false';}document.title='Leafhour';view.marginaliaReader=null;view.marginaliaPaletteAdapter=null;}),owner:context.owner,chapterError:error=>error?.code==='offline_missing'?'offline.chapterMissing':'reader.b1.chapterFailed',canPrefetch,prefetch,prefetchNext:(book,chapterId,ensure)=>{const next=book?.chapters[book.chapters.findIndex(c=>c.id===chapterId)+1];if(next&&ensure)void prefetch(next.id,ensure).catch(()=>{});},isOffline:()=>context.transport?.isOffline()||false,mount:options=>mountOfflineReadingControls({...options,transport:context.transport}),refresh:chapterId=>context.transport?.refresh(chapterId),watch:onChanged=>{const view=globalThis.window;if(!view||!bookId)return;globalThis.document?.addEventListener('visibilitychange',()=>{if(globalThis.document.hidden)stopPrefetch();});view.addEventListener('pagehide',stopPrefetch);view.addEventListener('storage',stopPrefetch);view.addEventListener('offline',()=>context.transport?.setOffline());view.addEventListener('storage',()=>{if(context.enabled&&store.owner()!==(context.owner||'guest'))onChanged();});}};return context;
 }
 if(session){let enabled=false;try{await store.adopt(session.user?.id||'guest');enabled=!!store.capture();}catch{}return {session,owner:session.user?.id||null,offline:false,enabled};}
 if(networkFailed&&store.owner()){
  try{await (store.metadata?store.metadata(bookId):store.book(bookId));const owner=store.owner();return {owner:owner==='guest'?null:owner,offline:true,enabled:true,session:{user:null,offline:true,offlineOwner:owner==='guest'?null:owner}};}catch{}
 }
 return {session:null,owner:null,offline:false,enabled:false};
}
export function createOfflineReadingTransport({store,bookId,fetcher=globalThis.fetch,offline=false,enabled=true,isCurrent=()=>true,onOffline=()=>{},storage=null}){
 let disconnected=offline,token=enabled?store.capture():null,lastBook=null,cacheUsable=enabled;
 const base='/api/library/books/'+encodeURIComponent(bookId),guard=()=>{if(!isCurrent()||token&&!store.current(token))throw failure('cache_stale',409);};
 const cache=async(fn,fallback=null)=>{try{guard();const value=await fn();guard();return value;}catch(error){if(error.code==='cache_stale')throw error;return fallback;}};
 const markOffline=()=>{if(!disconnected){disconnected=true;onOffline();}};
 const request=async(url,options)=>{
  guard();if(options?.signal?.aborted)throw options.signal.reason||new DOMException('Cancelled','AbortError');const r=await fetcher(url,options);guard();if(options?.signal?.aborted)throw options.signal.reason||new DOMException('Cancelled','AbortError');
  const address=new URL(url,'https://reading.invalid'),contentRoute=address.pathname===base+'/reading'||address.pathname===base+'/reading-manifest'||address.pathname.startsWith(base+'/chapters/');
  if([401,403,404].includes(r.status)&&enabled&&contentRoute){enabled=false;token=null;try{await store.clear();}catch{}}
  if(r.ok&&r.headers.get('X-Reader-Book-Transfer')==='parts'){
   const manifest=await r.json(),book=await assembleBookTransfer(manifest,async(offset,snapshot)=>{const part=new URL(url,'https://reading.invalid');part.searchParams.set('offset',offset);part.searchParams.set('snapshot',snapshot);const next=await request(part.pathname+part.search,options);if(!next.ok)throw failure('chapter_unavailable',next.status);return next.json();});guard();return response(book);
  }
  return r;
 };
 const savedBook=async chapterId=>{guard();if(!enabled||!cacheUsable)throw failure('offline_missing');const value=await store.book(bookId,{token,...(chapterId?{chapterId}:{})});guard();lastBook=value;return value;};
 const invalidate=async()=>{cacheUsable=false;try{await store.remove(bookId);}catch{try{await store.clear();}catch{}enabled=false;token=null;}globalThis.document?.dispatchEvent(new Event('reader:offline-cache'));};
 const save=async book=>{let stored=false;if(enabled){stored=(await cache(()=>store.saveBook(book,{token})))!==null;if(!stored)await invalidate();}lastBook=book;return stored;};
 const fetchChapter=async(id,book,options={},required=false)=>{
  const hash=book.readingCache?.chapters?.[id];
  if(enabled&&cacheUsable){const hit=await cache(()=>store.chapter(bookId,id,{hash,token}));if(hit)return hit;}
  if(disconnected)throw failure('offline_missing');
  const r=await request(base+'/chapters/'+encodeURIComponent(id)+'?contentVersion='+encodeURIComponent(book.contentVersion),options);
  if(!r.ok)throw failure('chapter_unavailable',r.status);const value=await r.json();guard();
  if(enabled&&cacheUsable){try{await store.saveChapter(bookId,value,{token});guard();}catch(error){if(required||!['cache_quota','cache_unavailable'].includes(error.code))throw error;}}
  return value;
 };
 function selected(book,url){const passage=url.searchParams.get('passageId');return book.sections.find(s=>s.paragraphs.some(p=>p.id===passage))?.chapterId||(book.chapters.some(c=>c.id===url.searchParams.get('chapterId'))?url.searchParams.get('chapterId'):null)||book.readingStart?.chapterId||book.chapters[0]?.id;}
 const hydrate=(book,chapter)=>({...book,sections:book.sections.map(s=>s.chapterId===chapter.chapterId?chapter.sections.find(row=>row.number===s.number)||s:s),reading:{...book.reading,partial:true,loadedChapters:[...new Set([...(book.reading?.loadedChapters||[]),chapter.chapterId])]}});
 const metadataOf=()=>store.metadata?store.metadata(bookId,{token}):store.book(bookId,{token});
 const tagged=(book,r)=>{const tag=r.headers.get('etag');if(/^(?:W\/)?"[a-f0-9]{64}"$/.test(tag||''))book.readingCache={...book.readingCache,manifestTag:tag};return book;};
 async function readOpening(url,options){
  if(disconnected){
   const meta=await metadataOf(),requested=selected(meta,url),available=meta.reading?.availableChapters||meta.reading?.loadedChapters||meta.sections.filter(s=>s.paragraphs.every(p=>!p.unloaded&&typeof p.original==='string')).map(s=>s.chapterId),id=available.includes(requested)?requested:available[0];
   if(!id)throw failure('offline_missing');const book=await savedBook(id);if(id!==requested)book.reading.offlineFallback={requestedChapterId:requested,chapterId:id,passageId:book.sections.find(s=>s.chapterId===id)?.paragraphs[0]?.id};return response(book);
  }
  const existing=enabled&&cacheUsable?await cache(metadataOf):null;
  if(!existing){const r=await request(url.pathname+url.search,options);if(r.ok){const value=await r.clone().json();await save(value);}return r;}
  const tag=existing.readingCache?.manifestTag,headers={...options.headers,...(/^(?:W\/)?"[a-f0-9]{64}"$/.test(tag||'')?{'If-None-Match':tag}:{})};
  const r=await request(base+'/reading-manifest',{...options,headers});if(!r.ok&&r.status!==304)return r;
  const metadata=r.status===304?existing:tagged(await r.json(),r);guard();const stored=r.status===304||await save(metadata);
  const id=selected(metadata,url);let book=stored?await cache(()=>store.book(bookId,{token,chapterId:id}),metadata):metadata;
  if(!(book.reading?.loadedChapters||[]).includes(id))book=hydrate(book,await fetchChapter(id,metadata,options));
  lastBook=book;return response(book);
 }

 async function fetchReading(url,options={}){
  guard();const target=new URL(url,'https://reading.invalid'),method=String(options.method||'GET').toUpperCase();
  if(disconnected&&method!=='GET')throw failure('offline_write');
  const action=target.pathname.startsWith(base+'/')?target.pathname.slice(base.length+1):null;
  try{
   if(method==='GET'&&action==='reading')return await readOpening(target,options);
   if(method==='GET'&&action?.startsWith('chapters/')){
    const book=lastBook||await savedBook(),value=await fetchChapter(decodeURIComponent(action.slice(9)),book,options);return response(value);
   }
   if(disconnected){
    if(method==='GET'&&target.pathname===base){const book=await savedBook();if(book.sections.some(section=>section.paragraphs.some(p=>p.unloaded||typeof p.original!=='string')))throw failure('offline_missing');delete book.reading;delete book.readingCache;return response(book);}
    if(method==='GET'&&action==='records'){const records=emptyRecords();try{records.position=JSON.parse(storage?.getItem('marginalia-focus-position-v1|'+(store.owner()||'guest')+'|'+bookId)||'null');}catch{}return response(records);}
    throw failure('offline_unavailable');
   }
   const result=await request(url,options);
   if(method==='POST'&&action==='translate'&&result.ok&&enabled){
    try{
     const passage=await result.clone().json(),book=await savedBook(),section=book.sections.find(row=>row.paragraphs.some(p=>p.id===passage.id));
     if(!section||!book.reading?.loadedChapters?.includes(section.chapterId)&&book.reading?.partial)throw failure('offline_missing');
     const paragraph=section.paragraphs.find(p=>p.id===passage.id);if(passage.original!==undefined&&passage.original!==paragraph.original)throw failure('cache_stale',409);
     paragraph.translations=passage.translations;book.reading={...book.reading,hasTranslations:true};
     const chapter={bookId,contentVersion:book.contentVersion,chapterId:section.chapterId,sections:book.sections.filter(row=>row.chapterId===section.chapterId)};
     const hash=await chapterHash(chapter);guard();book.readingCache={...book.readingCache,snapshotId:'local:'+crypto.randomUUID(),chapters:{...book.readingCache.chapters,[section.chapterId]:hash}};
     await store.saveBook(book,{token});guard();lastBook=book;globalThis.document?.dispatchEvent(new Event('reader:offline-cache'));
    }catch(error){
     if(error.code==='cache_stale')throw error;
     // A confirmed server save must not leave an older device edition marked ready.
     await invalidate();
    }
   }
   return result;
  }catch(error){
   if(enabled&&method==='GET'&&!options.signal?.aborted&&networkFailure(error)&&(action==='reading'||action?.startsWith('chapters/'))){markOffline();if(action==='reading')return readOpening(target,options);return response(await store.chapter(bookId,decodeURIComponent(action.slice(9)),{token}));}
   throw error;
  }
 }
 async function download({signal,onProgress=()=>{}}={}){
  if(disconnected||!enabled)throw failure('offline_unavailable');
  for(let attempt=0;attempt<3;attempt++){
   const r=await request(base+'/reading-manifest',{signal});if(!r.ok)throw failure('offline_unavailable',r.status);
   const book=tagged(await r.json(),r);guard();try{await store.saveBook(book,{pin:true,token});cacheUsable=true;}catch(error){await invalidate();throw error;}await store.pin(bookId,true);
   let completed=0;
   for(const chapter of book.chapters){if(signal?.aborted)throw signal.reason||new DOMException('Cancelled','AbortError');await fetchChapter(chapter.id,book,{signal},true);guard();onProgress({loaded:++completed,total:book.chapters.length});}
   const check=await request(base+'/reading-manifest',{signal});if(!check.ok)throw failure('offline_unavailable',check.status);const current=tagged(await check.json(),check);guard();
   if(JSON.stringify(current.readingCache?.chapters)===JSON.stringify(book.readingCache?.chapters)){await store.saveBook(current,{pin:true,token});lastBook=await store.book(bookId,{token});const result=await store.status(bookId);if(!result.complete||result.loaded!==book.chapters.length)throw failure('offline_incomplete');return result;}
  }
  throw failure('cache_stale',409);
 }
 return {fetch:fetchReading,download,isOffline:()=>disconnected,setOffline:markOffline,hasScope:()=>enabled&&!!token&&store.current(token),refresh:async chapterId=>{if(disconnected||!enabled)return;const r=await request(base+'/reading-manifest',{});if(r.ok){const book=tagged(await r.json(),r);await save(book);if(chapterId)await fetchChapter(chapterId,book,{},true);}},store};
}

let singleton;
export const deviceBookStore=()=>{if(!singleton){let storage=null,indexedDB=null;try{storage=globalThis.localStorage;}catch{}try{indexedDB=globalThis.indexedDB;}catch{}singleton=createOfflineBookStore({storage,indexedDB});}return singleton;};
export async function prepareOfflineResources({explicit=false}={}){
 if(!globalThis.navigator?.serviceWorker)return false;
 try{
  const connection=navigator.connection,limited=!explicit&&(connection?.saveData||/^(slow-)?2g$/.test(connection?.effectiveType||'')),registration=limited?await navigator.serviceWorker.getRegistration('/'):await navigator.serviceWorker.register('/reading-worker.js',{scope:'/',updateViaCache:'none'});if(!registration)return false;await Promise.race([navigator.serviceWorker.ready,new Promise((_,reject)=>setTimeout(()=>reject(failure('offline_unavailable')),30000))]);
  const worker=navigator.serviceWorker.controller||registration.active;if(!worker)return false;
  return await new Promise(resolve=>{const channel=new MessageChannel(),requestId=crypto.randomUUID(),timer=setTimeout(()=>{channel.port1.close();resolve(false);},explicit?60000:6000);channel.port1.onmessage=event=>{if(event.data?.requestId===requestId){clearTimeout(timer);channel.port1.close();resolve(event.data.ready===true);}};worker.postMessage({type:'LEAFHOUR_OFFLINE_STATUS',requestId,repair:explicit===true,readerEntry:[...document.scripts].map(script=>{try{return new URL(script.src).pathname;}catch{return '';}}).find(path=>/^\/reader-web\/reader-[a-f0-9]{16}\.js$/.test(path)),claimUncontrolled:!navigator.serviceWorker.controller},[channel.port2]);});
 }catch{return false;}
}

export function mountOfflineReadingControls({document,transport,getBook,t,subscribe=()=>()=>{}}){
 const host=document.querySelector('.book-info-actions');if(!host||!transport||document.getElementById('offline-reading-controls'))return;
 const node=(tag,id)=>{const n=document.createElement(tag);if(id)n.id=id;return n;};
 const root=node('section','offline-reading-controls'),save=node('button','offline-reading-save'),cancel=node('button','offline-reading-cancel'),remove=node('button','offline-reading-remove'),shelf=node('a','offline-reading-shelf'),status=node('p','offline-reading-status'),help=node('p','offline-reading-help'),badge=node('p','offline-reading-badge');
 for(const b of [save,cancel,remove])b.type='button';shelf.href='/offline';status.setAttribute('role','status');badge.setAttribute('role','status');badge.className='offline-reading-badge';root.className='offline-reading-controls';save.setAttribute('aria-describedby','offline-reading-help');root.append(save,cancel,remove,shelf,status,help);host.after(root);document.getElementById('book-page')?.prepend(badge);
 if(!document.getElementById('offline-reading-style')){const link=node('link','offline-reading-style');link.rel='stylesheet';link.href='/offline-reading.css';document.head.append(link);}
 let pending=null,notice=null,params=null,disposed=false,resources=false;
 function paint(){if(disposed)return;help.textContent=t('offline.deviceScope');save.textContent=t('offline.save');cancel.textContent=t('offline.cancel');remove.textContent=t('offline.remove');shelf.textContent=t('offline.shelf');status.textContent=notice?t('offline.'+notice,params):'';badge.classList.toggle('is-fallback',!!getBook()?.reading?.offlineFallback);badge.textContent=t(getBook()?.reading?.offlineFallback?'offline.resumeMissing':'offline.reading');badge.hidden=!transport.isOffline();save.disabled=!!pending||transport.isOffline()||!transport.hasScope();cancel.hidden=!pending;remove.disabled=!!pending;}
 async function refresh(){if(disposed)return;try{const value=await transport.store.status(getBook().bookId);if(disposed||pending)return;remove.hidden=!value.loaded;notice=value.complete&&resources?'ready':value.loaded?'range':null;params={loaded:value.loaded,total:value.total};}catch{remove.hidden=true;notice=null;params=null;}paint();}
 save.addEventListener('click',async()=>{
  if(pending||transport.isOffline())return;const operation=new AbortController();pending=operation;notice='preparing';params=null;paint();
  try{resources=await prepareOfflineResources({explicit:true});if(pending!==operation)return;if(operation.signal.aborted)throw operation.signal.reason;await transport.download({signal:operation.signal,onProgress:value=>{if(pending!==operation)return;notice='range';params=value;paint();}});if(pending!==operation)return;notice=resources?'ready':'resourcesPending';params=null;}
  catch(error){if(pending!==operation)return;notice=operation.signal.aborted?'cancelled':error.code==='cache_quota'?'space':error.code==='cache_stale'?'changed':'failed';}
  finally{if(pending===operation)pending=null;paint();}
 });
 cancel.addEventListener('click',()=>{pending?.abort();pending=null;notice='cancelled';params=null;paint();});remove.addEventListener('click',async()=>{try{await transport.store.remove(getBook().bookId);notice='removed';remove.hidden=true;}catch{notice='failed';}paint();});
 const onChange=()=>{if(!transport.hasScope()){pending?.abort();root.remove();badge.remove();disposed=true;}else paint();};
 const off=subscribe(paint);document.defaultView?.addEventListener('offline',paint);document.defaultView?.addEventListener('storage',onChange);document.addEventListener('reader:offline',paint);document.addEventListener('reader:offline-cache',refresh);
 document.addEventListener('reader:session-changed',()=>{pending?.abort();disposed=true;root.remove();badge.remove();off();},{once:true});
 paint();void refresh();void prepareOfflineResources().then(value=>{resources=value;return refresh();});
 return {refresh,dispose(){disposed=true;pending?.abort();off();root.remove();badge.remove();}};
}
