import test from 'node:test';
import assert from 'node:assert/strict';
import {bookTransfer} from '../server/book-transfer.mjs';

const book={bookId:'synthetic-local-book',contentVersion:'synthetic-v1',text:'a'.repeat(1100000)},manifest=bookTransfer(book);
async function fixture(t,{abortFirst=false}={}){
 const previous={fetch:globalThis.fetch,location:globalThis.location,window:globalThis.window,document:globalThis.document};
 t.after(()=>{for(const [key,value]of Object.entries(previous)){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}});
 const controller=new AbortController(),calls=[];
 globalThis.location={search:'',origin:'https://reader.example.invalid',replace:()=>{}};
 globalThis.window={addEventListener:()=>{}};globalThis.document=Object.assign(new EventTarget(),{hidden:false});
 globalThis.fetch=async(url,options={})=>{
  if(String(url).startsWith('/api/content-part?')){
   options.signal?.throwIfAborted();calls.push({url,options});
   const address=new URL(url,location.origin),part=bookTransfer(book,Number(address.searchParams.get('offset')),address.searchParams.get('snapshot'));
   if(abortFirst&&calls.length===1)controller.abort();
   return Response.json(part);
  }
  if(url==='/api/book')return Response.json(manifest,{headers:{'X-Reader-Book-Transfer':'parts'}});
  return Response.json({revision:0,updatedAt:null,uiLocale:null});
 };
 const {readerFetch}=await import('../app/reader-api.mjs?transfer='+abortFirst);
 return {readerFetch,controller,calls};
}

test('local multipart book reads preserve the original signal on every part',async t=>{
 const f=await fixture(t);const response=await f.readerFetch('/api/book',{signal:f.controller.signal});
 assert.deepEqual(await response.json(),book);assert.equal(f.calls.length,2);
 for(const call of f.calls)assert.equal(call.options.signal,f.controller.signal);
});

test('cancelling a local multipart book read stops before requesting another content part',async t=>{
 const f=await fixture(t,{abortFirst:true});
 await assert.rejects(f.readerFetch('/api/book',{signal:f.controller.signal}),{name:'AbortError'});
 assert.equal(f.calls.length,1);
});
