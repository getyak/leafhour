import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createPortal} from '../server/portal.mjs';
import {createHostedAuth} from '../deploy/hosted-auth.mjs';
import {authFixture} from './auth-fixture.mjs';
import {readingBook,readingRecords} from './reading-fixtures.mjs';
import {safeAuthReturn} from '../server/auth-policy.mjs';
import * as returns from '../app/reader-return.mjs';

const sender={id:'gift-http-sender',email:'sender@fixture.invalid',kind:'email'},receiver={id:'gift-http-receiver',email:'receiver@fixture.invalid',kind:'email'};
async function setup(t){
  const users=[sender,receiver],fixture=authFixture({onProvider:({url,body,options})=>{
    const user=url.pathname.endsWith('/token')?users.find(user=>user.email===body.email):url.pathname.endsWith('/user')?users.find(user=>options.headers.Authorization==='Bearer access-'+user.id):null;
    if(user){const visible={...user,email_confirmed_at:'2026-10-15T00:00:00Z',user_metadata:{full_name:user.id},app_metadata:{provider:'email'}};return Response.json(url.pathname.endsWith('/user')?visible:{user:visible,access_token:'access-'+user.id,refresh_token:'refresh-'+user.id,expires_in:3600});}
  }}),dataDir=await mkdtemp(path.join(tmpdir(),'reader-personal-http-'));
  const auth=createHostedAuth({...fixture,store:fixture.store()}),portal=await createPortal({dataDir,catalogDir:null,publicOrigin:fixture.env.READER_PUBLIC_ORIGIN,allowLocal:false,dataStore:fixture.store(),authService:auth,translator:null,chatGenerator:null});
  const server=createServer(async(req,res)=>{
    const send=(status,body,type='application/json')=>{res.statusCode=status;res.setHeader('Content-Type',type+'; charset=utf-8');res.end(type==='application/json'?JSON.stringify(body):body);};
    try{if(!await portal.handle({req,res,url:new URL(req.url,fixture.env.READER_PUBLIC_ORIGIN),send}))send(404,{error:'missing'});}catch(error){send(error.status||500,{error:error.message});}
  });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});await rm(dataDir,{recursive:true,force:true});});
  const base='http://127.0.0.1:'+server.address().port;
  const post=(route,body={},identity=null,owner=identity?.user.id)=>fetch(base+route,{method:'POST',headers:{Origin:fixture.env.READER_PUBLIC_ORIGIN,'Content-Type':'application/json',...(identity?{Cookie:identity.cookie}:{}),...(owner?{'X-Reader-Owner':owner}:{})},body:JSON.stringify(body)});
  const get=(route,identity=null)=>fetch(base+route,{headers:identity?{Cookie:identity.cookie,'X-Reader-Owner':identity.user.id}:{}});
  const login=async user=>{const response=await post('/api/auth/password',{email:user.email,password:'fixture-password'});assert.equal(response.status,200);return {user,cookie:response.headers.get('set-cookie').split(';')[0]};};
  return {portal,fixture,post,get,base,a:await login(sender),b:await login(receiver)};
}
async function seed(library,user,id='reading-test'){
  const book=structuredClone(readingBook);book.bookId=id;book.visibility='private';book.sections[0].paragraphs[0].translations={literal:{text:'Literal draft.',status:'draft',variant:'literal',origin:'ai'},interpretive:{text:'Interpretive draft.',status:'draft',variant:'interpretive',origin:'ai'}};
  await library.restoreLibrary(user,{kind:'marginalia-library',schemaVersion:1,books:[{book,records:{...readingRecords(),bookId:id}}]});return book;
}

test('HTTP highlights save through the account store and refuse guests, stale owners and other accounts',async t=>{
  const {post,get,portal,a,b}=await setup(t),book=await seed(portal.library,sender),route='/api/library/books/'+book.bookId+'/highlights';
  const input={id:'highlight-1',bookId:book.bookId,contentVersion:book.contentVersion,chapterId:'ch01',parts:[{passageId:'p1',language:'en',variant:'interpretive',start:5,end:9,text:'this'}]};
  assert.equal((await post(route,input)).status,401);
  assert.equal((await post(route,input,b,sender.id)).status,409);
  assert.equal((await post(route,input,b)).status,404);
  const response=await post(route,input,a);assert.equal(response.status,201);assert.equal((await response.json()).parts[0].text,'this');
  assert.equal((await (await get('/api/library/books/'+book.bookId+'/records',a)).json()).highlights.length,1);
  assert.equal((await post(route+'/highlight-1/remove',{},b)).status,404);
  const removed=await post(route+'/highlight-1/remove',{},a);assert.equal(removed.status,200);assert.ok((await removed.json()).deletedAt);
});

test('HTTP personal edits preserve immutable sources, reject stale owners and versions, and safely confirm retries',async t=>{
  const {post,get,portal,a,b}=await setup(t),book=await seed(portal.library,sender),base='/api/library/books/'+book.bookId;
  const input={id:'edit-note',passageId:'p1',contentVersion:book.contentVersion,text:'My <img src=x> exact words.',quote:'Keep the source.',quoteLanguage:'en',quoteOrigin:'original'};
  const created=await (await post(base+'/comments',input,a)).json();assert.equal(created.revision,0);
  const route=base+'/comments/'+input.id+'/edit',edit={contentVersion:book.contentVersion,text:' My revised <script>words</script>. ',baseRevision:0,editId:'http-edit-one'};
  assert.equal((await post(route,edit)).status,401);
  assert.equal((await post(route,edit,b,sender.id)).status,409);
  assert.equal((await post(route,edit,b)).status,404);
  assert.equal((await post(route,{...edit,quote:'Forged source.'},a)).status,400);
  assert.equal((await post(base+'/comments/%ZZ/edit',edit,a)).status,400);
  const response=await post(route,edit,a);assert.equal(response.status,200);const saved=await response.json();
  for(const key of ['id','passageId','bookId','contentVersion','createdAt','origin','quote','quoteOrigin'])assert.equal(saved[key],created[key],key);
  assert.equal(saved.text,edit.text);assert.equal(saved.revision,1);
  assert.deepEqual(await (await post(route,edit,a)).json(),saved);
  assert.equal((await post(route,{...edit,text:'A stale overwrite.',editId:'another'},a)).status,409);
  assert.deepEqual((await (await get(base+'/records',a)).json()).comments[0],saved);
  assert.equal((await get('/personal-records.mjs')).status,200);
});

test('gift return paths accept only one exact token path and reject redirect material',()=>{
  const token='A'.repeat(43),target='/gift/'+token;assert.equal(typeof returns.safeGiftReturn,'function');assert.equal(returns.safeGiftReturn(target),target);assert.equal(safeAuthReturn(target),target);
  for(const value of [target+'?next=https://evil.invalid',target+'#fragment',target+'/',target+'/..','/gift/'+'A'.repeat(42),'/gift/'+'A'.repeat(44),'//evil.invalid/gift/'+token,'https://evil.invalid/gift/'+token,'/gift/%41'+token.slice(1),'/gift/../'+token,'/gift/\\'+token]){assert.equal(returns.safeGiftReturn(value),null);assert.equal(safeAuthReturn(value),null);}
});

test('HTTP profiles persist presentation fields and fence a stale account before saving',async t=>{
  const {post,get,a,b}=await setup(t);
  assert.equal((await post('/api/account/profile',{displayName:'No guest'})).status,401);
  const saved=await post('/api/account/profile',{displayName:'读书的人'},a);assert.equal(saved.status,200);assert.deepEqual(await saved.json(),{displayName:'读书的人',avatarUrl:null});
  const session=await (await get('/api/auth/session',a)).json();assert.equal(session.user.id,sender.id);assert.equal(session.user.displayName,'读书的人');assert.ok(!JSON.stringify(session).includes('access-'));
  const stale=await post('/api/account/profile',{displayName:'Wrong account'},b,sender.id);assert.equal(stale.status,409);assert.equal(stale.headers.get('X-Reader-Session-Changed'),'1');
  assert.equal((await (await get('/api/auth/session',b)).json()).user.displayName,receiver.id);
  assert.equal((await post('/api/account/profile',{displayName:'Name',ownerId:receiver.id},a)).status,400);
});

test('HTTP shelf order, trash and restoration share one revision while keeping reader links and notes',async t=>{
  const {portal,post,get,a,b}=await setup(t),first=await seed(portal.library,sender),second=await seed(portal.library,sender,'another-book');
  await portal.library.addComment(sender,first.bookId,{id:'keep-note',passageId:'p1',text:'Keep my note after removing the cover.'});
  const initial=await (await get('/api/library',a)).json();assert.equal(initial.shelfRevision,0);
  const arranged=await post('/api/library/order',{bookIds:[second.bookId,first.bookId],baseRevision:0},a);assert.equal(arranged.status,200);assert.equal((await arranged.json()).revision,1);
  assert.equal((await post('/api/library/books/'+first.bookId+'/archive',{baseRevision:0},a)).status,409);
  assert.equal((await post('/api/library/order',{bookIds:[],baseRevision:0},b,sender.id)).status,409);
  const removed=await post('/api/library/books/'+first.bookId+'/archive',{baseRevision:1},a);assert.equal(removed.status,200);assert.equal((await removed.json()).revision,2);
  const trash=await (await get('/api/library/trash',a)).json();assert.equal(trash.revision,2);assert.equal(trash.books[0].bookId,first.bookId);
  assert.deepEqual((await (await get('/api/library',a)).json()).books.map(book=>book.bookId),[second.bookId]);
  assert.equal((await get('/api/library/books/'+first.bookId,a)).status,200);assert.equal((await get('/api/library/books/'+first.bookId,b)).status,404);
  const restored=await post('/api/library/books/'+first.bookId+'/restore',{baseRevision:2},a);assert.equal(restored.status,200);assert.equal((await restored.json()).revision,3);
  assert.deepEqual((await (await get('/api/library',a)).json()).books.map(book=>book.bookId),[second.bookId,first.bookId]);
  assert.equal((await (await get('/api/library/books/'+first.bookId+'/records',a)).json()).comments[0].id,'keep-note');
});

test('HTTP shelf revision never acknowledges cards read before a concurrent removal',async t=>{
  const {portal,get,a}=await setup(t),book=await seed(portal.library,sender),originalList=portal.library.list,originalState=portal.library.shelfState;
  let listing=false,changed=false,release;const mutationFinished=new Promise(resolve=>{release=resolve;});
  portal.library.list=async user=>{
    listing=true;const rows=await originalList(user);
    if(!changed){changed=true;await portal.library.archiveBook(user,book.bookId,{baseRevision:0});release();}
    return rows;
  };
  portal.library.shelfState=async user=>{if(listing)await mutationFinished;return originalState(user);};
  const response=await get('/api/library',a);assert.equal(response.status,200);const view=await response.json();
  assert.equal(view.shelfRevision,1);assert.deepEqual(view.books,[]);
});

test('HTTP private gift creation, verified download, isolated acceptance and revocation preserve recipient records',async t=>{
  const {portal,post,get,a,b}=await setup(t),book=await seed(portal.library,sender);await portal.library.addComment(sender,book.bookId,{id:'private-note',passageId:'p1',text:'SENDER PRIVATE NOTE'});
  await post('/api/account/profile',{displayName:'寄书的人'},a);
  const created=await post('/api/library/books/'+book.bookId+'/gifts',{message:'读到这里，想起了你。',recipient:'另一位读者',includeTranslations:true},a);assert.equal(created.status,201);
  const gift=await created.json();assert.match(gift.token,/^[A-Za-z0-9_-]{43}$/);assert.equal(gift.shareUrl,'/gift/'+gift.token);
  const route='/api/book-gifts/'+gift.token,metadata=await get(route);assert.equal(metadata.status,200);const letter=await metadata.json();assert.equal(letter.sender,'寄书的人');assert.equal(letter.readUrl,undefined);assert.ok(!JSON.stringify(letter).includes('SENDER PRIVATE NOTE'));
  const page=await get(gift.shareUrl);assert.equal(page.status,200);assert.match(page.headers.get('content-type'),/text\/html/);assert.match(await page.text(),/book-gift\.mjs/);
  for(const asset of ['/book-gift.mjs','/book-gift.css','/library-profile.mjs','/reading-schedule.mjs','/shelf-order.mjs'])assert.equal((await get(asset)).status,200,asset);
  for(const target of ['/gift/short','/api/book-gifts/short','/api/book-gifts/'+'Z'.repeat(43)])assert.equal((await get(target)).status,404);
  const download=await get(route+'/download');assert.equal(download.status,200);assert.match(download.headers.get('content-disposition'),/^attachment/);const packageData=await download.json();assert.deepEqual(packageData.books[0].records.comments,[]);assert.equal(packageData.books[0].book.sections[0].paragraphs[0].translations.literal.text,'Literal draft.');
  const part=await get(route+'/download-part?offset=0');assert.equal(part.status,200);const chunk=await part.json();assert.equal(chunk.kind,'marginalia-book-gift-part');assert.equal(JSON.parse(Buffer.from(chunk.data,'base64').toString()).books[0].book.bookId,book.bookId);
  const listed=await get('/api/library/books/'+book.bookId+'/gifts',a);assert.equal(listed.status,200);assert.equal((await listed.json()).gifts[0].token,gift.token);
  assert.equal((await post(route+'/accept')).status,401);const stale=await post(route+'/accept',{},b,sender.id);assert.equal(stale.status,409);assert.deepEqual((await (await get('/api/library',b)).json()).books,[]);
  const accepted=await post(route+'/accept',{},b);assert.equal(accepted.status,200);assert.equal((await accepted.json()).bookId,book.bookId);
  await post('/api/library/books/'+book.bookId+'/comments',{id:'receiver-note',passageId:'p1',text:'RECEIVER OWN NOTE'},b);
  const again=await post(route+'/accept',{},b);assert.equal(again.status,200);assert.equal((await again.json()).alreadyOwned,true);
  assert.deepEqual((await (await get('/api/library/books/'+book.bookId+'/records',b)).json()).comments.map(note=>note.text),['RECEIVER OWN NOTE']);
  assert.equal((await post(route+'/revoke',{},b)).status,404);assert.equal((await post(route+'/revoke',{},a,receiver.id)).status,409);assert.equal((await post(route+'/revoke',{},a)).status,200);
  for(const suffix of ['', '/download','/download-part?offset=0'])assert.equal((await get(route+suffix)).status,404);
  assert.equal((await get('/api/library/books/'+book.bookId,b)).status,200);
});

test('OAuth success and cancellation carry the exact gift path back through the fixed origin',async t=>{
  const {post,get,fixture}=await setup(t),next='/gift/'+'A'.repeat(43);
  for(const cancelled of [false,true]){
    const start=await post('/api/auth/oauth',{provider:'google',next});assert.equal(start.status,200);const cookie=start.headers.get('set-cookie').split(';')[0];
    const response=await fetch((await get('/api/auth/session')).url.replace('/api/auth/session','')+'/api/auth/callback?'+(cancelled?'error=access_denied':'code=fixture-code'),{headers:{Cookie:cookie},redirect:'manual'});
    assert.equal(response.status,303);const destination=new URL(response.headers.get('location'));assert.equal(destination.origin,fixture.env.READER_PUBLIC_ORIGIN);
    if(cancelled){assert.equal(destination.pathname,'/library');assert.equal(destination.searchParams.get('next'),next);}else assert.equal(destination.pathname,next);
  }
});

test('large reading HTTP views retain private anchors while chapter reads enforce owner and edition',async t=>{
 const {get,portal,a,b}=await setup(t),book=structuredClone(readingBook);book.bookId='private-reading-view';book.visibility='private';
 for(let n=0;n<12;n++)book.sections[0].paragraphs.push({id:'large-'+n,original:'甲'.repeat(10000),translations:{},annotationIds:[],termIds:[]});
 await portal.library.restoreLibrary(sender,{kind:'marginalia-library',schemaVersion:1,books:[{book,records:{...readingRecords(),bookId:book.bookId}}]});const before=await portal.library.getBook(sender,book.bookId),base='/api/library/books/'+book.bookId;
 const response=await get(base+'/reading?passageId=p3',a);assert.equal(response.status,200);const view=await response.json();assert.deepEqual(view.reading.loadedChapters,['ch02']);assert.deepEqual(view.sections[0].paragraphs[0],{id:'p1',unloaded:true});assert.equal(view.sections[1].paragraphs[0].original,'Continue from here.');assert.equal(view.sections.flatMap(s=>s.paragraphs).length,16);
 assert.equal((await get(base+'/reading')).status,404);assert.equal((await get(base+'/reading',b)).status,404);const route=base+'/chapters/ch01?contentVersion=edition-1';assert.equal((await get(route)).status,404);assert.equal((await get(route,b)).status,404);assert.equal((await get(base+'/chapters/ch01?contentVersion=old',a)).status,409);assert.equal((await get(base+'/chapters/missing?contentVersion=edition-1',a)).status,404);const chapter=await (await get(route,a)).json();assert.equal(chapter.sections[0].paragraphs.at(-1).original.length,10000);assert.deepEqual(await portal.library.getBook(sender,book.bookId),before);
});
test('oversized reading views and later chapters retain snapshot-checked chunk transfer',async t=>{
 const {assembleBookTransfer}=await import('../app/book-transfer.mjs');const {get,portal,a}=await setup(t),book=structuredClone(readingBook);book.bookId='private-large-chapter';book.visibility='private';
 for(let i=0;i<315;i++)book.sections[0].paragraphs.push({id:'wide-'+i,original:'x'.repeat(10000),translations:{},annotationIds:[],termIds:[]});
 await portal.library.restoreLibrary(sender,{kind:'marginalia-library',schemaVersion:1,books:[{book,records:{...readingRecords(),bookId:book.bookId}}]});
 for(const action of ['/reading?chapterId=ch01','/chapters/ch01?contentVersion=edition-1']){
  const route='/api/library/books/'+book.bookId+action,response=await get(route,a);assert.equal(response.status,200);assert.equal(response.headers.get('X-Reader-Book-Transfer'),'parts');const manifest=await response.json();const value=await assembleBookTransfer(manifest,async(offset,snapshot)=>{const part=await get(route+'&offset='+offset+'&snapshot='+snapshot,a);assert.equal(part.status,200);return part.json();});assert.equal(value.sections[0].paragraphs.at(-1).original.length,10000);assert.equal((await get(route+'&offset=0&snapshot=old',a)).status,409);
 }
});
