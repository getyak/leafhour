import {adoptUiOwner,getUiLocale,readUiSession,t} from './ui-locale.mjs';
import {assembleBookTransfer} from './book-transfer.mjs';
import {deviceBookStore,resolveOfflineReadingContext} from './offline-reading.mjs';
export const selectedBookId=new URLSearchParams(location.search).get('book');
const offlineContext=await resolveOfflineReadingContext({store:deviceBookStore(),bookId:selectedBookId,readSession:readUiSession,request:fetch,fetcher:checkedFetch,isCurrent:()=>sessionCurrent});
export const readerSession=offlineContext.session;
// This document leaves on identity change; every account consumer shares
// the same captured ID instead of reinterpreting a mutable session object.
export const readerOwner=offlineContext.owner;
let sessionCurrent=true;
export const readerObservability={operationId:crypto.randomUUID(),requestFailed(){},dispose(){},syncOwner(){this.dispose();this.operationId=crypto.randomUUID();}};
document.addEventListener('reader:session-changed',()=>{void deviceBookStore().clear().catch(()=>{});sessionCurrent=false;readerObservability.syncOwner();readerOffline.hidePage(document,window);});
void adoptUiOwner(readerOwner,{verified:offlineContext.verified});
const offlineTransport=offlineContext.transport;
export const readerOffline=offlineContext.facade;
if(selectedBookId)readerOffline.watch(()=>leaveChangedSession());
export function readerApiUrl(url){
  // Explicit library, gift, account and auth routes keep their original scope.
  if(!selectedBookId||!url.startsWith('/api/')||['/api/library/','/api/book-gifts/','/api/account/','/api/auth/','/api/billing/'].some(prefix=>url.startsWith(prefix)))return url;
  const action=url.slice('/api/'.length);return '/api/library/books/'+encodeURIComponent(selectedBookId)+(action==='book'?'':'/'+action);
}
export const readerStorageKey=name=>name+(selectedBookId?'|'+(readerOwner||'guest')+'|'+selectedBookId:'');
const leaveChangedSession=()=>{void deviceBookStore().clear().catch(()=>{});sessionCurrent=false;document.dispatchEvent(new Event('reader:session-changed'));location.replace('/library');};
async function checkedFetch(url,options){
  let response;try{response=await fetch(url,options);}catch(error){readerObservability.requestFailed({error});throw error;}
  if(response.headers.get('X-Reader-Session-Changed')==='1'){leaveChangedSession();throw Error('账户已切换，请重新进入书房。');}
  if(!response.ok)readerObservability.requestFailed({status:response.status});
  return response;
}
export async function readerFetch(url,options={}){
  const target=readerApiUrl(url);

  if(readerOffline.isOffline()&&String(options.method||'GET').toUpperCase()!=='GET')throw Object.assign(Error(t('offline.needsNetwork')),{code:'offline_write',status:503});
  if(readerSession?.billing?.enabled===true&&String(options.method||'GET').toUpperCase()==='POST'&&/^\/api\/library\/books\/[^/]+\/(?:translate|chat|annotations\/explain)$/.test(target.split(/[?#]/,1)[0])){
    const isCurrent=()=>sessionCurrent&&!options.signal?.aborted;
    const guard=()=>{if(!isCurrent())throw options.signal?.aborted?(options.signal.reason||new DOMException('Request aborted','AbortError')):Error('账户已切换，请重新进入书房。');};
    guard();let data;try{data=JSON.parse(options.body);}catch{throw Error('阅读点数请求格式不正确。');}
    const {prepareCreditRequest}=await import('./credit-client.mjs');
    const prepared=await prepareCreditRequest({url:target,data,session:readerSession,owner:readerOwner,isCurrent,fetcher:checkedFetch,locale:getUiLocale()});
    guard();options={...options,body:JSON.stringify(prepared)};
  }
  if(options.signal?.aborted)throw options.signal.reason||new DOMException('Request aborted','AbortError');
  const {onDispatch,...fetchOptions}=options;onDispatch?.();
  const response=await (offlineTransport&&!target.startsWith('/api/auth/')?offlineTransport.fetch:checkedFetch)(target,{...fetchOptions,headers:{...(options.headers||{}),'X-Leafhour-Operation':readerObservability.operationId,...(url==='/api/book'?{'X-Reader-Book-Transfer':'1'}:{}),...(selectedBookId?{'X-Reader-Owner':readerOwner||'guest'}:{})}});
  if(response.ok&&response.headers.get('X-Reader-Book-Transfer')==='parts'){const manifest=await response.json(),book=await assembleBookTransfer(manifest,async(offset,snapshot)=>{const partUrl=new URL(url,location.origin);partUrl.searchParams.set('offset',offset);partUrl.searchParams.set('snapshot',snapshot);const r=await readerFetch(url==='/api/book'?'/api/content-part?offset='+offset+'&snapshot='+snapshot:partUrl.pathname+partUrl.search);if(!r.ok)throw Error('正文已更新或传输中断，请重新载入。');return r.json();});return new Response(JSON.stringify(book),{headers:{'Content-Type':'application/json'}});}return response;
}
let identityCheck=null;
// A restored page must confirm the captured account before resuming its sound.
// Share the in-flight check with focus/pageshow instead of issuing duplicates.
export function confirmReaderIdentity(){
  if(!sessionCurrent||document.hidden)return Promise.resolve(false);
  if(!selectedBookId)return Promise.resolve(true);
  if(!identityCheck)identityCheck=(async()=>{try{
    const response=await fetch('/api/auth/session');if(!response.ok)return false;
    const current=await response.json();
    if((current.user?.id||null)!==readerOwner){leaveChangedSession();return false;}
    if(readerOffline.isOffline()){location.reload();return false;}
    void adoptUiOwner(readerOwner);return sessionCurrent;
  }catch{return false;}})().finally(()=>{identityCheck=null;});
  return identityCheck;
}
if(selectedBookId){window.addEventListener('online',confirmReaderIdentity);window.addEventListener('focus',confirmReaderIdentity);window.addEventListener('pageshow',confirmReaderIdentity);document.addEventListener('visibilitychange',confirmReaderIdentity);}
