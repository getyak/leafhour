export const selectedBookId=new URLSearchParams(location.search).get('book');
export const readerSession=selectedBookId?await fetch('/api/auth/session').then(r=>r.json()).catch(()=>({user:null})):null;
export function readerApiUrl(url){
  if(!selectedBookId||!url.startsWith('/api/'))return url;
  const action=url.slice('/api/'.length);return '/api/library/books/'+encodeURIComponent(selectedBookId)+(action==='book'?'':'/'+action);
}
export const readerStorageKey=name=>name+(selectedBookId?'|'+(readerSession?.user?.id||'guest')+'|'+selectedBookId:'');
export async function readerFetch(url,options={}){
  const response=await fetch(readerApiUrl(url),{...options,headers:{...(options.headers||{}),...(selectedBookId?{'X-Reader-Owner':readerSession?.user?.id||'guest'}:{})}});
  if(response.headers.get('X-Reader-Session-Changed')==='1'){location.replace('/library');throw Error('账户已切换，请重新进入书房。');}return response;
}
if(selectedBookId){const checkIdentity=async()=>{if(document.hidden)return;try{const current=await fetch('/api/auth/session').then(r=>r.json());if((current.user?.id||'guest')!==(readerSession?.user?.id||'guest'))location.replace('/library');}catch{}};window.addEventListener('focus',checkIdentity);document.addEventListener('visibilitychange',checkIdentity);}
