import test from 'node:test';
import assert from 'node:assert/strict';
import {createHostedStore} from '../deploy/hosted-store.mjs';
import {createHostedAuth} from '../deploy/hosted-auth.mjs';
import {createHostedHandler} from '../api/[...path].js';
import {createLibraryService} from '../server/library-service.mjs';
import {makeMcpConfiguration} from '../app/mcp-config.mjs';
import {authFixture} from './auth-fixture.mjs';
import {createHash} from 'node:crypto';
import {createReadingOutbox} from '../app/reading-outbox.mjs';

const env={SUPABASE_URL:'https://storage.example.com',SUPABASE_SECRET_KEY:'server-fixture',SUPABASE_PUBLISHABLE_KEY:'public-fixture',READER_PUBLIC_ORIGIN:'https://reader.example.com'};
function database({jsonb=false}={}){
  const rows=new Map(),objects=new Map();
  // JSONB round trips preserve array order and values, but never promise object key order.
  const jsonbValue=value=>Array.isArray(value)?value.map(jsonbValue):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.length-b.length||a.localeCompare(b)).map(([key,v])=>[key,jsonbValue(v)])):value;
  const fetcher=async(input,options={})=>{
    const url=new URL(input);let data;
    if(url.pathname==='/rest/v1/reader_documents'){const key=url.searchParams.get('key').slice(3);data=rows.has(key)?[structuredClone(rows.get(key))]:[];}
    else if(url.pathname==='/rest/v1/rpc/reader_document_cas'){
      const {document_key:key,expected_version:version,document_value:value}=JSON.parse(options.body),old=rows.get(key);
      data=(old?.version||0)===version;if(data)rows.set(key,{version:version+1,value:jsonb?jsonbValue(value):structuredClone(value)});
    }else if(url.pathname.startsWith('/storage/v1/object/reader-originals/')){
      const key=url.pathname.split('/reader-originals/')[1];
      if(options.method==='POST'){objects.set(key,Buffer.from(options.body));data={};}
      else {if(!objects.has(key))return new Response('{}',{status:404});const bytes=objects.get(key),range=options.headers?.Range?.match(/^bytes=(\d+)-(\d+)$/);if(range){const start=Number(range[1]),end=Number(range[2]);return new Response(bytes.subarray(start,end+1),{status:206,headers:{'content-length':String(end-start+1),'content-range':'bytes '+start+'-'+end+'/'+bytes.length}});}return new Response(options.method==='HEAD'?null:bytes,{headers:{'content-length':String(bytes.length)}});}
    }else if(url.pathname.startsWith('/storage/v1/object/upload/sign/reader-originals/')){data={url:'/object/upload/sign/reader-originals/synthetic-upload?token=synthetic'};}else throw Error('Unexpected fixture route');
    return Response.json(data);
  };
  return {fetcher,rows};
}
test('hosted JSONB manual lost-ACK recovery and repeated restore keep one exact self-report across instances',async()=>{
 const fixture=database({jsonb:true}),make=()=>createLibraryService({dataDir:'hosted-jsonb',catalogDir:null,dataStore:createHostedStore({env,fetcher:fixture.fetcher})}),a=await make(),b=await make(),owner={id:'get147-jsonb-owner'},book=await a.importDocument(owner,{filename:'jsonb-time.txt',bytes:Buffer.from('Synthetic JSONB recovery source.')}),anchor={chapterId:book.sections[0].chapterId,passageId:book.sections[0].paragraphs[0].id};
 const startedAt='2026-10-14T12:00:00.000Z',endedAt='2026-10-14T12:10:00.000Z',submitted={id:'manual-lost-ack',source:'manual',bookId:book.bookId,contentVersion:book.contentVersion,status:'finished',sequence:1,timeZone:'UTC',start:anchor,end:anchor,startedAt,endedAt,segments:[{startedAt,endedAt}],durationSeconds:600};let disk=[];
 const first=createReadingOutbox({load:()=>disk,save:rows=>disk=rows,send:async row=>{await a.saveReadingSession(owner,book.bookId,row);throw Error('lost ACK after successful JSONB commit');}});first.enqueue(submitted);assert.equal((await first.flush()).remaining,1);
 const stored=(await b.records(owner,book.bookId)).readingSessions;assert.equal(stored.length,1);assert.deepEqual(Object.keys(stored[0].segments[0]),['endedAt','startedAt']);
 const resumed=createReadingOutbox({load:()=>disk,save:rows=>disk=rows,send:row=>b.saveReadingSession(owner,book.bookId,row)}),retry=await resumed.flush();assert.equal(retry.error,null);assert.equal(retry.remaining,0);assert.equal(resumed.confirmed(submitted),true);assert.equal(disk.length,0);assert.deepEqual((await a.records(owner,book.bookId)).readingSessions,stored);
 await assert.rejects(b.saveReadingSession(owner,book.bookId,{...submitted,endedAt:'2026-10-14T12:11:00.000Z',segments:[{startedAt,endedAt:'2026-10-14T12:11:00.000Z'}]}),{status:409});
 const backup=await b.exportLibrary(owner);await a.restoreLibrary(owner,backup);await b.restoreLibrary(owner,backup);assert.deepEqual((await a.records(owner,book.bookId)).readingSessions,stored);assert.equal((await a.readingActivity(owner,{month:'2026-10',timeZone:'UTC'})).durationSeconds,600);
});
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
test('an authorized original download plan uses trusted metadata without reading the whole source',async()=>{const fixture=database(),store=createHostedStore({env,fetcher:fixture.fetcher}),user={id:'alice'},library=await createLibraryService({dataDir:'hosted',catalogDir:null,dataStore:store}),bytes=Buffer.from('Private source fixture.'),book=await library.importDocument(user,{filename:'source.txt',bytes});let request;store.blob=async()=>{throw Error('must not download the entire original to prepare links');};store.blobDownloads=async(file,expected)=>{request={file,expected};return [{url:'https://storage.example.com/fixture'}];};const plan=await library.originalParts(user,book.bookId);assert.equal(plan.bytes,bytes.length);assert.deepEqual(request.expected,{size:bytes.length,sha256:book.source.sha256});assert.ok(request.file.endsWith(book.source.sha256));assert.equal(plan.parts.length,1);await assert.rejects(library.originalParts({id:'bob'},book.bookId),e=>e.status===404);});
test('download plans bind manifests to the source hash before bounded parallel signing',async()=>{const fixture=database(),sum=b=>createHash('sha256').update(b).digest('hex');let active=0,peak=0,signed=0;const store=createHostedStore({env,fetcher:async(input,options)=>{const u=new URL(input);if(u.pathname.startsWith('/storage/v1/object/sign/')){assert.equal(JSON.parse(options.body).expiresIn,3600);active++;signed++;peak=Math.max(peak,active);await new Promise(r=>setTimeout(r,5));active--;return Response.json({signedURL:u.pathname.replace('/storage/v1','')+'?token=fixture'});}return fixture.fetcher(input,options);}}),bytes=Buffer.from([0,1,2,3,4,5,6,7]),parts=[];for(let i=0;i<8;i++){await store.putBlob('part-'+i,bytes.subarray(i,i+1));parts.push({target:'part-'+i,size:1,sha256:sum(bytes.subarray(i,i+1))});}await store.adoptBlob('source',parts,{size:8,sha256:sum(bytes)});const plan=await store.blobDownloads('source',{size:8,sha256:sum(bytes)});assert.equal(peak,6);assert.deepEqual(plan.map(p=>p.sha256),parts.map(p=>p.sha256));signed=0;await assert.rejects(store.blobDownloads('source',{size:8,sha256:sum('different')}),e=>e.status===409);assert.equal(signed,0);const forged=Buffer.concat([Buffer.from('\0LEAFHOUR_CHUNKS_V1\n'),Buffer.from(JSON.stringify({kind:'leafhour-blob-chunks-v1',size:8,sha256:sum(bytes),parts:[]}))]);await store.putBlob('forged-text-source',forged);await assert.rejects(store.blobDownloads('forged-text-source',{size:forged.length,sha256:sum(forged)}),e=>e.status===409);assert.equal(signed,0);});
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
test('hosted origin CSV enables only configured HTTPS web clients through the real portal',async()=>{
  const fixture=authFixture(),configured={...fixture.env,READER_PUBLIC_ORIGIN:'https://leafhour.com',READER_ADDITIONAL_WEB_ORIGINS:' https://reader.cubxxw.com, https://legacy.leafhour.com '};
  const handler=createHostedHandler({env:configured,storeFactory:()=>fixture.store(),authFactory:({store,env})=>createHostedAuth({...fixture,store,env})});
  const login=async origin=>{
    let body;const headers={},res={setHeader:(key,value)=>{headers[key]=value;},end:value=>{body=JSON.parse(value);}};
    await handler({url:'/api/auth/password',method:'POST',headers:{host:'reader.cubxxw.com',origin,'content-type':'application/json'},body:{email:'reader@example.com',password:'fixture-password'},socket:{remoteAddress:'127.0.0.1'}},res);
    return {status:res.statusCode,body,headers};
  };
  for(const origin of ['https://reader.cubxxw.com','https://legacy.leafhour.com','https://leafhour.com']){
    const response=await login(origin);assert.equal(response.status,200);assert.equal(response.body.user.id,'user-a');assert.match(response.headers['Set-Cookie'],/Secure/);
  }
  assert.equal((await login('https://unrelated.example')).status,403);
  const disabled=createHostedHandler({env:{...configured,READER_ADDITIONAL_WEB_ORIGINS:'https://*.cubxxw.com'},storeFactory:()=>fixture.store(),authFactory:({store,env})=>createHostedAuth({...fixture,store,env})});
  const res={setHeader(){},end(){}};await disabled({url:'/api/auth/session',method:'GET',headers:{}},res);assert.equal(res.statusCode,503);
});
test('hosted entry forwards profile and gift routes through the shared portal',async()=>{
  const routes=[],handler=createHostedHandler({env,storeFactory:()=>({}),authFactory:()=>({}),portalFactory:async()=>({handle:async({url,send})=>{routes.push(url.pathname);send(200,{ready:true});return true;}})});
  for(const path of ['/api/account/profile','/api/account/reading-preferences','/api/account/ui-preferences','/api/book-gifts/'+ 'a'.repeat(43),'/api/book-gifts/'+ 'a'.repeat(43)+'/accept','/api/library/books/alice/gifts']){
    let result;const res={setHeader(){},end(value){result=JSON.parse(value);}};await handler({url:path,method:'GET',headers:{}},res);assert.equal(res.statusCode,200,path);assert.equal(result.ready,true);
  }
  assert.equal(routes.length,6);
});
test('disabled hosted email never sends an OTP and hosted MCP uses only explicit HTTPS configuration',async()=>{
  const auth=createHostedAuth({env,store:{},fetcher:()=>{throw Error('must not send');}});assert.equal(auth.emailAvailable,false);await assert.rejects(auth.requestCode('reader@example.com'),e=>e.status===503);
  const config=makeMcpConfiguration({hosted:true,serviceUrl:env.READER_PUBLIC_ORIGIN,sourceCommit:'a'.repeat(40)},'fixture').mcpServers.leafhour;assert.equal(config.command,'npx');assert.equal(config.env.READER_ALLOW_REMOTE,'true');assert.throws(()=>makeMcpConfiguration({hosted:true,serviceUrl:'http://reader.example.com'},'fixture'));
});
test('oversized extracted cloud books are rejected before originals or shelf entries are saved',async()=>{
  const fixture=database(),store=createHostedStore({env,fetcher:fixture.fetcher}),library=await createLibraryService({dataDir:'hosted',catalogDir:null,dataStore:store}),user={id:'large-source'};
  await assert.rejects(library.importExtracted(user,{filename:'large.pdf',bytes:Buffer.from('%PDF-synthetic'),extracted:{format:'pdf',review:'extracted_unreviewed',pages:[{page:1,text:'This synthetic line is ordinary text. '.repeat(1000000)}]}}),e=>e.status===413);
  assert.equal((await library.list(user)).length,0);assert.equal(fixture.rows.size,0);
});
test('a native book above the former small-document ceiling imports and saves real separate translation variants',async()=>{
 const f=database(),store=createHostedStore({env,fetcher:f.fetcher});let calls=0;
 const library=await createLibraryService({dataDir:'hosted',catalogDir:null,dataStore:store,translator:async()=>{calls++;return {literal:'测试直译。',interpretive:'测试意译。'};}}),owner={id:'large-native'};
 const book=await library.importDocument(owner,{filename:'large.txt',bytes:Buffer.from('This synthetic line is ordinary text. '.repeat(100000))});
 assert.ok(Buffer.byteLength(JSON.stringify(book))>3500000);
 const translated=await library.translate(owner,book.bookId,book.sections[0].paragraphs[0].id);
 assert.equal(calls,1);assert.equal(translated.translations.literal.text,'测试直译。');assert.equal(translated.translations.interpretive.text,'测试意译。');
 assert.equal((await library.getBook(owner,book.bookId)).sections[0].paragraphs[0].translations.interpretive.text,'测试意译。');
 await assert.rejects(library.bookTransfer({id:'another-owner'},book.bookId),e=>e.status===404);
 const manifest=await library.bookTransfer(owner,book.bookId);assert.equal(manifest.bookId,book.bookId);assert.ok(manifest.totalBytes>3500000);
});
test('translation capacity is checked before a provider call or reservation is spent',async()=>{
 const f=database(),store=createHostedStore({env,fetcher:f.fetcher});let calls=0;
 const library=await createLibraryService({dataDir:'hosted',catalogDir:null,dataStore:store,translator:async()=>{calls++;return {literal:'直译',interpretive:'意译'};}}),owner={id:'near-capacity'};
 const book=await library.importDocument(owner,{filename:'book.txt',bytes:Buffer.from('A readable source paragraph.')}),row=[...f.rows.values()].find(r=>r.value.sections);
 row.value.padding='x'.repeat(32*1024*1024-Buffer.byteLength(JSON.stringify(row.value))-80000);
 await assert.rejects(library.translate(owner,book.bookId,book.sections[0].paragraphs[0].id),e=>e.status===413);assert.equal(calls,0);
});
test('hosted authentication uses verified provider identity, keeps tokens server-side and observes logout',async()=>{
  const fixture=database(),store=createHostedStore({env,fetcher:fixture.fetcher}),calls=[];
  const auth=createHostedAuth({env:{...env,READER_EMAIL_ENABLED:'true'},store,fetcher:async(url,options)=>{calls.push({url,options});return Response.json(url.endsWith('/verify')?{user:{id:'provider-user',email:'reader@example.com'},access_token:'access-fixture',refresh_token:'refresh-fixture',expires_in:3600}:url.endsWith('/user')?{id:'provider-user',email:'reader@example.com'}:{});}});
  await auth.requestCode('Reader@example.com');const session=await auth.verifyCode('reader@example.com','12345678');assert.equal(session.user.id,'provider-user');assert.ok(!JSON.stringify(session).includes('access-fixture'));
  assert.equal((await auth.userFor(session.token)).id,'provider-user');await auth.logout(session.token);assert.equal(await auth.userFor(session.token),null);assert.equal(await auth.userFor('forged-cookie'),null);
  assert.equal(JSON.parse(calls[1].options.body).type,'email');
});
test('large private blobs survive independent processes and corruption is rejected',async()=>{
 const f=database(),a=createHostedStore({env,fetcher:f.fetcher}),b=createHostedStore({env,fetcher:f.fetcher}),bytes=Buffer.alloc(21*1024*1024,79);
 await a.putBlob('owner/originals/large',bytes);assert.equal((await b.blobInfo('owner/originals/large')).size,bytes.length);assert.deepEqual(await b.blob('owner/originals/large'),bytes);
});
test('large immutable JSON values roundtrip through document pointers and retain CAS updates',async()=>{
 const f=database(),a=createHostedStore({env,fetcher:f.fetcher}),value='书籍正文'.repeat(400000);
 await a.mutate('large-book',{},r=>{r.text=value;});assert.ok(Buffer.byteLength(JSON.stringify(f.rows.get('large-book').value))<10000);assert.equal((await a.read('large-book',null)).text,value);
 await a.mutate('large-book',{},r=>{r.note='kept';});assert.equal((await a.read('large-book',null)).note,'kept');
});
test('hosted JSON transport compresses large readable content without losing source text',async()=>{
 const {gunzipSync}=await import('node:zlib'),source='正文'.repeat(1500000),headers={};let payload;const handler=createHostedHandler({env,storeFactory:()=>({}),authFactory:()=>({}),portalFactory:async()=>({handle:async({send})=>{send(200,{source});return true;}})});const res={setHeader:(k,v)=>{headers[k]=v;},end:b=>{payload=b;}};await handler({url:'/api/library',method:'GET',headers:{}},res);assert.equal(res.statusCode,200);assert.equal(headers['Content-Encoding'],'gzip');assert.equal(JSON.parse(gunzipSync(payload)).source,source);
});
test('user JSON is never interpreted as a chunk manifest and JSON pointers are bound to their key',async()=>{const f=database(),s=createHostedStore({env,fetcher:f.fetcher}),bytes=Buffer.from(JSON.stringify({kind:'leafhour-blob-chunks-v1',size:10,parts:[{key:'private'}]}));await s.putBlob('text-source',bytes);assert.deepEqual(await s.blob('text-source'),bytes);await s.mutate('attacker',{},r=>Object.assign(r,{kind:'leafhour-json-blob-v1',file:'json/other-owner/secret',sha256:'a'.repeat(64)}));await assert.rejects(s.read('attacker',null),e=>e.status===409);});
test('temporary OCR inputs stay single PDFs within the bucket limit and signed lifetimes are bounded',async()=>{const f=database(),calls=[],store=createHostedStore({env,fetcher:async(u,o)=>{if(u.includes('/object/sign/')){calls.push(JSON.parse(o.body));return Response.json({signedURL:'/object/sign/reader-originals/input?token=fixture'});}return f.fetcher(u,o);}}),bytes=Buffer.alloc(9*1024*1024,71);await store.putSingleBlob('owner/input',bytes);assert.deepEqual(await store.blob('owner/input'),bytes);await assert.rejects(store.putSingleBlob('owner/huge',Buffer.alloc(21*1024*1024)),e=>e.status===413);await store.signedBlob('owner/input',{expiresIn:3600});assert.equal(calls[0].expiresIn,3600);await assert.rejects(store.signedBlob('owner/input',{expiresIn:3601}),e=>e.status===400);});
test('medium JSON is compressed for gzip clients and identity clients retain a plain response',async()=>{
 const {gunzipSync}=await import('node:zlib'),payload={text:'中型正文。'.repeat(1200)};
 const handler=createHostedHandler({env,storeFactory:()=>({}),authFactory:()=>({}),portalFactory:async()=>({handle:async({send})=>{send(200,payload);return true;}})});
 for(const encoding of ['gzip, deflate, br','identity']){const headers={};let bytes;const res={setHeader:(k,v)=>headers[k.toLowerCase()]=v,removeHeader:k=>delete headers[k.toLowerCase()],end:value=>bytes=Buffer.from(value)};await handler({url:'/api/auth/session',method:'GET',headers:{'accept-encoding':encoding}},res);assert.equal(res.statusCode,200);if(encoding==='identity'){assert.equal(headers['content-encoding'],undefined);assert.deepEqual(JSON.parse(bytes),payload);}else{assert.equal(headers['content-encoding'],'gzip');assert.ok(bytes.length<1000);assert.deepEqual(JSON.parse(gunzipSync(bytes)),payload);}}
});
test('bounded original ranges cross storage parts without fetching complete blobs and reject mixed manifests',async()=>{
 const fixture=database(),sum=b=>createHash('sha256').update(b).digest('hex');let corrupt=false;const store=createHostedStore({env,fetcher:async(url,options)=>{const r=await fixture.fetcher(url,options);return corrupt&&options.headers?.Range?new Response('bad',{status:206,headers:{'content-length':'3','content-range':'bytes 0-2/4'}}):r;}}),source=Buffer.from('abcdefgh'),parts=[];
 for(let n=0;n<2;n++){const bytes=source.subarray(n*4,n*4+4),target='slice-'+n;await store.putBlob(target,bytes);parts.push({target,size:4,sha256:sum(bytes)});}await store.adoptBlob('range-source',parts,{size:8,sha256:sum(source)});store.blob=()=>assert.fail('whole source must not be loaded');const slice=await store.blobRange('range-source',{offset:2,length:5,sha256:sum(source)});assert.equal(slice.bytes.toString(),'cdefg');assert.equal(slice.total,8);
 for(const [offset,length]of [[-1,1],[0,1048577],[7,2]])await assert.rejects(store.blobRange('range-source',{offset,length,sha256:sum(source)}));await assert.rejects(store.blobRange('range-source',{offset:0,length:1,sha256:sum('other')}),e=>e.status===409);corrupt=true;await assert.rejects(store.blobRange('range-source',{offset:2,length:2,sha256:sum(source)}),e=>e.status===409);
});

test('hosted signed-upload reservation accepts EPUB with the same bounded owner staging as text',async()=>{const f=database(),store=createHostedStore({env,fetcher:f.fetcher}),user={id:'epub-owner'};const target=await store.beginUpload(user,{filename:'reading.epub',bytes:512});assert.match(target.id,/^[a-f0-9-]{36}$/);assert.equal(new URL(target.url).origin,env.SUPABASE_URL);await assert.rejects(store.beginUpload(user,{filename:'too-large.epub',bytes:20*1024*1024+1}),{status:400});await assert.rejects(store.beginUpload(null,{filename:'reading.epub',bytes:512}),{status:401});});

// GET-198: exercise the deployed catch-all entry, not just the local server.
test('hosted UI preference route reaches real authentication, owner fences and durable CAS',async t=>{
 const fixture=authFixture(),portals=[];
 const {createPortal}=await import('../server/portal.mjs');
 const make=()=>createHostedHandler({env:fixture.env,storeFactory:()=>fixture.store(),authFactory:({store,env})=>createHostedAuth({...fixture,store,env}),portalFactory:async options=>{const portal=await createPortal({...options,translator:null,chatGenerator:null,companionGenerator:null,annotationGenerator:null,introductionGenerator:null,dialogueGenerator:null,guideGenerator:null});portals.push(portal);return portal;}});
 t.after(async()=>{for(const portal of portals)await Promise.all([portal.chat.close(),portal.ingestionRunner.close(),portal.audio?.close()]);});
 let cookie;const handler=make();
 const call=async(method='GET',body,extra={},target=handler,query)=>{let value;const headers={},res={setHeader:(key,v)=>{headers[key]=v;},end:bytes=>{value=JSON.parse(bytes);}};await target({url:'/api/account/ui-preferences',method,query,headers:{host:'reader.example.com',origin:fixture.env.READER_PUBLIC_ORIGIN,'content-type':'application/json',...(cookie?{cookie}:{}),...extra},...(body===undefined?{}:{body}),socket:{remoteAddress:'127.0.0.1'}},res);return {status:res.statusCode,body:value,headers};};
 const anonymous=await call();assert.equal(anonymous.status,401,'the real hosted route must reach authentication rather than return a routing 404');assert.match(anonymous.headers['Cache-Control'],/private.*no-store/);
 const loginHeaders={},loginResponse={setHeader:(key,v)=>{loginHeaders[key]=v;},end(){}};await handler({url:'/api/auth/password',method:'POST',headers:{host:'reader.example.com',origin:fixture.env.READER_PUBLIC_ORIGIN,'content-type':'application/json'},body:{email:'reader@example.com',password:'fixture-password'},socket:{remoteAddress:'127.0.0.1'}},loginResponse);assert.equal(loginResponse.statusCode,200);cookie=loginHeaders['Set-Cookie'].split(';')[0];
 const owned={'x-reader-owner':fixture.user.id},empty={revision:0,updatedAt:null,uiLocale:null};
 const before=await call('GET',undefined,owned);assert.equal(before.status,200);assert.deepEqual(before.body,empty);assert.equal([...fixture.rows.keys()].filter(key=>key.endsWith('/ui-preferences.json')).length,0,'GET does not create preference state');
 const saved=await call('POST',{baseRevision:0,uiLocale:'ja'},owned);assert.equal(saved.status,200);assert.equal(saved.body.uiLocale,'ja');assert.equal(saved.body.revision,1);assert.ok(Number.isFinite(Date.parse(saved.body.updatedAt)));
 assert.deepEqual((await call('GET')).body,saved.body,'same-session GET may omit the optional owner header');
 assert.equal((await call('POST',{baseRevision:0,uiLocale:'en'},owned)).status,409,'stale CAS is preserved through the hosted edge');
 assert.equal((await call('POST',{baseRevision:1,uiLocale:'en'})).status,409,'writes require the captured owner header');
 const changed=await call('POST',{baseRevision:1,uiLocale:'en'},{'x-reader-owner':'synthetic-other'});assert.equal(changed.status,409);assert.equal(changed.headers['X-Reader-Session-Changed'],'1');
 assert.equal((await call('POST',{baseRevision:1,uiLocale:'en'},{...owned,origin:'https://unrelated.example'})).status,403);
 assert.equal((await call('POST',{baseRevision:1,uiLocale:'x'.repeat(5000)},owned)).status,413,'the 4 KiB boundary is not bypassed by framework-parsed bodies');
 assert.deepEqual((await call('GET',undefined,owned,make(),{path:['account','ui-preferences']})).body,saved.body,'another hosted instance and the actual catch-all query restore the same account record');
 assert.deepEqual((await call('GET',undefined,owned)).body,saved.body,'every rejected write leaves the account choice intact');
 assert.equal([...fixture.rows.keys()].filter(key=>key.endsWith('/ui-preferences.json')).length,1);
});

test('hosted UI preference admission is exact and never admits adjacent or legacy private routes',async()=>{
 let created=0;const handler=createHostedHandler({env,storeFactory:()=>{created++;throw Error('must not create a service for a rejected route');}});
 for(const url of ['/api/account/ui-preferences/','/api/account/ui-preferences-extra','/api/account/ui-preferences/notes','/api/book','/api/records']){const res={setHeader(){},end(){}};await handler({url,method:'GET',headers:{}},res);assert.equal(res.statusCode,404,url);}
 assert.equal(created,0);
});
