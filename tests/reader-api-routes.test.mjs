import test from 'node:test';
import assert from 'node:assert/strict';

test('reader actions retain canonical gift URLs and the authenticated owner header',async t=>{
  const previous={fetch:globalThis.fetch,location:globalThis.location,window:globalThis.window,document:globalThis.document},calls=[];
  t.after(()=>{for(const [key,value]of Object.entries(previous)){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}});
  globalThis.location={search:'?book=current-book',origin:'https://reader.example.invalid',replace:()=>{}};
  globalThis.window={addEventListener:()=>{}};globalThis.document={addEventListener:()=>{},hidden:false};
  globalThis.fetch=async(url,options={})=>{calls.push({url,options});return new Response(JSON.stringify(url==='/api/auth/session'?{user:{id:'fixture-owner'}}:{ok:true}),{headers:{'Content-Type':'application/json'}});};
  const {readerFetch}=await import('../app/reader-api.mjs');
  await readerFetch('/api/introduction',{method:'POST',body:'{"contentVersion":"v1"}'});
  await readerFetch('/api/library/books/current-book/gifts');
  await readerFetch('/api/book-gifts/'+'A'.repeat(43)+'/revoke',{method:'POST',body:'{}'});
  assert.deepEqual(calls.slice(1).map(c=>c.url),['/api/library/books/current-book/introduction','/api/library/books/current-book/gifts','/api/book-gifts/'+'A'.repeat(43)+'/revoke']);
  for(const call of calls.slice(1))assert.equal(call.options.headers['X-Reader-Owner'],'fixture-owner');
  let replaced;
  globalThis.location.replace=url=>replaced=url;globalThis.fetch=async()=>new Response('{}',{status:409,headers:{'X-Reader-Session-Changed':'1'}});
  await assert.rejects(readerFetch('/api/library/books/current-book/gifts'),/账户已切换/);assert.equal(replaced,'/library');
});
