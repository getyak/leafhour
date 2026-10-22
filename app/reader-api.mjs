import {adoptUiOwner,getUiLocale} from './ui-locale.mjs';
import {assembleBookTransfer} from './book-transfer.mjs';
export const selectedBookId=new URLSearchParams(location.search).get('book');
export const readerSession=selectedBookId?await fetch('/api/auth/session').then(r=>r.json()).catch(()=>({user:null})):null;
// This document leaves on identity change; every account consumer shares
// the same captured ID instead of reinterpreting a mutable session object.
export const readerOwner=readerSession?.user?.id||null;
let sessionCurrent=true;
document.addEventListener('reader:session-changed',()=>{sessionCurrent=false;});
void adoptUiOwner(readerOwner);
export function readerApiUrl(url){
  // Explicit library, gift, account and auth routes keep their original scope.
  if(!selectedBookId||!url.startsWith('/api/')||['/api/library/','/api/book-gifts/','/api/account/','/api/auth/','/api/billing/'].some(prefix=>url.startsWith(prefix)))return url;
  const action=url.slice('/api/'.length);return '/api/library/books/'+encodeURIComponent(selectedBookId)+(action==='book'?'':'/'+action);
}
export const readerStorageKey=name=>name+(selectedBookId?'|'+(readerOwner||'guest')+'|'+selectedBookId:'');
const leaveChangedSession=()=>{sessionCurrent=false;document.dispatchEvent(new Event('reader:session-changed'));location.replace('/library');};
async function checkedFetch(url,options){
  const response=await fetch(url,options);
  if(response.headers.get('X-Reader-Session-Changed')==='1'){leaveChangedSession();throw Error('账户已切换，请重新进入书房。');}
  return response;
}
export async function readerFetch(url,options={}){
  const target=readerApiUrl(url);
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
  const response=await checkedFetch(target,{...fetchOptions,headers:{...(options.headers||{}),...(url==='/api/book'?{'X-Reader-Book-Transfer':'1'}:{}),...(selectedBookId?{'X-Reader-Owner':readerOwner||'guest'}:{})}});
  if(response.ok&&response.headers.get('X-Reader-Book-Transfer')==='parts'){const manifest=await response.json(),book=await assembleBookTransfer(manifest,async(offset,snapshot)=>{const partUrl=new URL(url,location.origin);partUrl.searchParams.set('offset',offset);partUrl.searchParams.set('snapshot',snapshot);const r=await readerFetch(url==='/api/book'?'/api/content-part?offset='+offset+'&snapshot='+snapshot:partUrl.pathname+partUrl.search);if(!r.ok)throw Error('正文已更新或传输中断，请重新载入。');return r.json();});return new Response(JSON.stringify(book),{headers:{'Content-Type':'application/json'}});}return response;
}
if(selectedBookId){const checkIdentity=async()=>{if(document.hidden)return;try{const current=await fetch('/api/auth/session').then(r=>r.json());if((current.user?.id||null)!==readerOwner)leaveChangedSession();else void adoptUiOwner(readerOwner);}catch{}};window.addEventListener('focus',checkIdentity);window.addEventListener('pageshow',checkIdentity);document.addEventListener('visibilitychange',checkIdentity);}
