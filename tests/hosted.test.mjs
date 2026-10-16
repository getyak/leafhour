import test from 'node:test';
import assert from 'node:assert/strict';
import {createHostedStore} from '../deploy/hosted-store.mjs';
import {createHostedAuth} from '../deploy/hosted-auth.mjs';
import {createHostedHandler} from '../api/[...path].js';
import {createLibraryService} from '../server/library-service.mjs';
import {makeMcpConfiguration} from '../app/mcp-config.mjs';

const env={SUPABASE_URL:'https://storage.example.com',SUPABASE_SECRET_KEY:'server-fixture',SUPABASE_PUBLISHABLE_KEY:'public-fixture',READER_PUBLIC_ORIGIN:'https://reader.example.com'};
function database(){
  const rows=new Map(),objects=new Map();
  const fetcher=async(input,options={})=>{
    const url=new URL(input);let data;
    if(url.pathname==='/rest/v1/reader_documents'){const key=url.searchParams.get('key').slice(3);data=rows.has(key)?[structuredClone(rows.get(key))]:[];}
    else if(url.pathname==='/rest/v1/rpc/reader_document_cas'){
      const {document_key:key,expected_version:version,document_value:value}=JSON.parse(options.body),old=rows.get(key);
      data=(old?.version||0)===version;if(data)rows.set(key,{version:version+1,value:structuredClone(value)});
    }else if(url.pathname.startsWith('/storage/v1/object/reader-originals/')){
      const key=url.pathname.split('/reader-originals/')[1];
      if(options.method==='POST'){objects.set(key,Buffer.from(options.body));data={};}
      else {if(!objects.has(key))return new Response('{}',{status:404});const bytes=objects.get(key);return new Response(options.method==='HEAD'?null:bytes,{headers:{'content-length':String(bytes.length)}});}
    }else throw Error('Unexpected fixture route');
    return Response.json(data);
  };
  return {fetcher,rows};
}
test('database compare-and-swap preserves simultaneous notes across independent server instances',async()=>{
  const fixture=database(),a=createHostedStore({env,fetcher:fixture.fetcher}),b=createHostedStore({env,fetcher:fixture.fetcher});
  await Promise.all([a.mutate('records',{notes:[]},r=>r.notes.push('first')),b.mutate('records',{notes:[]},r=>r.notes.push('second'))]);
  assert.deepEqual((await a.read('records',null)).notes,['first','second']);assert.equal(fixture.rows.get('records').version,2);
});
test('hosted library persists originals and records without a writable local directory, with owner isolation',async()=>{
  const fixture=database(),store=createHostedStore({env,fetcher:fixture.fetcher}),user={id:'alice'},other={id:'bob'};
  const a=await createLibraryService({dataDir:'hosted',catalogDir:null,dataStore:store}),bytes=Buffer.from('A privately uploaded original.');
  const book=await a.importDocument(user,{filename:'private.txt',bytes}),passage=book.sections[0].paragraphs[0];await a.addComment(user,book.bookId,{id:'note',passageId:passage.id,text:'My own note'});
  const b=await createLibraryService({dataDir:'hosted',catalogDir:null,dataStore:createHostedStore({env,fetcher:fixture.fetcher})});
  assert.deepEqual((await b.getOriginal(user,book.bookId)).bytes,bytes);assert.equal((await b.records(user,book.bookId)).comments[0].text,'My own note');
  assert.equal((await b.list(other)).length,0);await assert.rejects(b.getBook(other,book.bookId),e=>e.status===404);await assert.rejects(b.getBook(null,book.bookId),e=>e.status===404);
});
test('public function refuses every legacy private-book route before creating a service',async()=>{
  let created=0;const handler=createHostedHandler({env,storeFactory:()=>{created++;throw Error('must not read private data');}});
  for(const url of ['/api/book','/api/records','/api/experiences','/api/progress']){let body;const res={setHeader(){},end(value){body=JSON.parse(value);}};await handler({url,method:'GET',headers:{}},res);assert.equal(res.statusCode,404);assert.ok(body.error);}
  assert.equal(created,0);
});
test('hosting adapter selects shared portal with durable store and no local owner entry',async()=>{
  const store={},auth={},calls=[];const handler=createHostedHandler({env,storeFactory:()=>store,authFactory:()=>auth,portalFactory:async options=>{calls.push(options);return {handle:async({send})=>{send(200,{ready:true});return true;}};}});
  let result;const res={setHeader(){},end(value){result=JSON.parse(value);}};
  await handler({url:'/api/library',method:'GET',headers:{}},res);assert.equal(result.ready,true);assert.equal(calls[0].dataStore,store);assert.equal(calls[0].authService,auth);assert.equal(calls[0].allowLocal,false);assert.equal(calls[0].hostedMcp,true);
});
test('hosted entry forwards profile and gift routes through the shared portal',async()=>{
  const routes=[],handler=createHostedHandler({env,storeFactory:()=>({}),authFactory:()=>({}),portalFactory:async()=>({handle:async({url,send})=>{routes.push(url.pathname);send(200,{ready:true});return true;}})});
  for(const path of ['/api/account/profile','/api/book-gifts/'+ 'a'.repeat(43),'/api/book-gifts/'+ 'a'.repeat(43)+'/accept','/api/library/books/alice/gifts']){
    let result;const res={setHeader(){},end(value){result=JSON.parse(value);}};await handler({url:path,method:'GET',headers:{}},res);assert.equal(res.statusCode,200,path);assert.equal(result.ready,true);
  }
  assert.equal(routes.length,4);
});
test('disabled hosted email never sends an OTP and hosted MCP uses only explicit HTTPS configuration',async()=>{
  const auth=createHostedAuth({env,store:{},fetcher:()=>{throw Error('must not send');}});assert.equal(auth.emailAvailable,false);await assert.rejects(auth.requestCode('reader@example.com'),e=>e.status===503);
  const config=makeMcpConfiguration({hosted:true,serviceUrl:env.READER_PUBLIC_ORIGIN},'fixture').mcpServers.leafhour;assert.equal(config.command,'npx');assert.equal(config.env.READER_ALLOW_REMOTE,'true');assert.throws(()=>makeMcpConfiguration({hosted:true,serviceUrl:'http://reader.example.com'},'fixture'));
});
test('oversized extracted cloud books are rejected before originals or shelf entries are saved',async()=>{
  const fixture=database(),store=createHostedStore({env,fetcher:fixture.fetcher}),library=await createLibraryService({dataDir:'hosted',catalogDir:null,dataStore:store}),user={id:'large-source'};
  await assert.rejects(library.importDocument(user,{filename:'large.txt',bytes:Buffer.from('This synthetic line is ordinary text.\n\n'.repeat(100000))}),e=>e.status===413);
  assert.equal((await library.list(user)).length,0);assert.equal(fixture.rows.size,0);
});
test('hosted authentication uses verified provider identity, keeps tokens server-side and observes logout',async()=>{
  const fixture=database(),store=createHostedStore({env,fetcher:fixture.fetcher}),calls=[];
  const auth=createHostedAuth({env:{...env,READER_EMAIL_ENABLED:'true'},store,fetcher:async(url,options)=>{calls.push({url,options});return Response.json(url.endsWith('/verify')?{user:{id:'provider-user',email:'reader@example.com'},access_token:'access-fixture',refresh_token:'refresh-fixture',expires_in:3600}:url.endsWith('/user')?{id:'provider-user',email:'reader@example.com'}:{});}});
  await auth.requestCode('Reader@example.com');const session=await auth.verifyCode('reader@example.com','12345678');assert.equal(session.user.id,'provider-user');assert.ok(!JSON.stringify(session).includes('access-fixture'));
  assert.equal((await auth.userFor(session.token)).id,'provider-user');await auth.logout(session.token);assert.equal(await auth.userFor(session.token),null);assert.equal(await auth.userFor('forged-cookie'),null);
  assert.equal(JSON.parse(calls[1].options.body).type,'email');
});
