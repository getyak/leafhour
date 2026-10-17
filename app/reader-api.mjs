import {assembleBookTransfer} from './book-transfer.mjs';
export const selectedBookId=new URLSearchParams(location.search).get('book');
export const readerSession=selectedBookId?await fetch('/api/auth/session').then(r=>r.json()).catch(()=>({user:null})):null;
export function readerApiUrl(url){
  if(!selectedBookId||!url.startsWith('/api/'))return url;
  const action=url.slice('/api/'.length);return '/api/library/books/'+encodeURIComponent(selectedBookId)+(action==='book'?'':'/'+action);
}
export const readerStorageKey=name=>name+(selectedBookId?'|'+(readerSession?.user?.id||'guest')+'|'+selectedBookId:'');
export async function readerFetch(url,options={}){
  const response=await fetch(readerApiUrl(url),{...options,headers:{...(options.headers||{}),...(url==='/api/book'?{'X-Reader-Book-Transfer':'1'}:{}),...(selectedBookId?{'X-Reader-Owner':readerSession?.user?.id||'guest'}:{})}});
  if(response.headers.get('X-Reader-Session-Changed')==='1'){location.replace('/library');throw Error('账户已切换，请重新进入书房。');}
  if(response.ok&&response.headers.get('X-Reader-Book-Transfer')==='parts'){const manifest=await response.json(),book=await assembleBookTransfer(manifest,async(offset,snapshot)=>{const partUrl=new URL(url,location.origin);partUrl.searchParams.set('offset',offset);partUrl.searchParams.set('snapshot',snapshot);const r=await readerFetch(url==='/api/book'?'/api/content-part?offset='+offset+'&snapshot='+snapshot:partUrl.pathname+partUrl.search);if(!r.ok)throw Error('正文已更新或传输中断，请重新载入。');return r.json();});return new Response(JSON.stringify(book),{headers:{'Content-Type':'application/json'}});}return response;
}
if(selectedBookId){const checkIdentity=async()=>{if(document.hidden)return;try{const current=await fetch('/api/auth/session').then(r=>r.json());if((current.user?.id||'guest')!==(readerSession?.user?.id||'guest'))location.replace('/library');}catch{}};window.addEventListener('focus',checkIdentity);document.addEventListener('visibilitychange',checkIdentity);}
