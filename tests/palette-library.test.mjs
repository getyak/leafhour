import test from 'node:test';
import assert from 'node:assert/strict';
import {createPaletteLibrary,normalizePaletteQuery,matchPaletteBooks,PALETTE_RESULT_LIMIT} from '../app/palette-library.mjs';

const headers=value=>({get:name=>value?.[name]??null});
const json=(body,extra={})=>({ok:true,status:200,headers:headers(extra.headers),json:async()=>body});
const deferred=()=>{let resolve,reject;const promise=new Promise((res,no)=>{resolve=res;reject=no;});return {promise,resolve,reject};};
const book=(id,title,extra={})=>({bookId:id,title:{zh:title,en:title},author:'作者',visibility:'public',...extra});

function harness({owner='reader-one',handler}={}){
  const calls=[];let current=owner;
  const request=async(url,options={})=>{calls.push({url,options});return handler?handler(url,options,()=>current):json(url==='/api/auth/session'?{user:current?{id:current}:null}:{books:[]});};
  return {calls,getOwner:()=>current,setOwner:value=>{current=value;},library:createPaletteLibrary({request,getOwner:()=>current})};
}

test('the palette library calls the exact /api/library endpoint directly with the captured owner',async()=>{
  const f=harness({handler:async url=>url==='/api/auth/session'?json({user:{id:'reader-one'}}):json({books:[book('one','一本书')]})});
  await f.library.load();
  assert.deepEqual(f.calls.map(call=>call.url),['/api/auth/session','/api/library'],'session bootstrap then the exact library endpoint; no readerFetch remap');
  const libraryCall=f.calls[1];
  assert.equal(libraryCall.options.cache,'no-store');
  assert.equal(libraryCall.options.headers['X-Reader-Owner'],'reader-one');
  assert.equal(f.library.view().phase,'ready');
  assert.equal(f.library.view().books.length,1);
});

test('a late return from a previous owner can never expose private names',async()=>{
  const slow=deferred();
  const f=harness({handler:async url=>{if(url==='/api/auth/session')return json({user:{id:'reader-one'}});await slow.promise;return json({books:[book('private-one','私人的书',{visibility:'private'})]});}});
  const loading=f.library.load();
  f.setOwner('reader-two');slow.resolve();
  await loading;
  assert.deepEqual(f.library.view().books,[],'no late owner response is adopted');
  assert.equal(f.library.view().phase,'idle');
});

test('X-Reader-Session-Changed invalidates and clears results immediately',async()=>{
  let flip=false;
  const f=harness({handler:async url=>{if(url==='/api/auth/session')return json({user:{id:'reader-one'}});if(!flip){flip=true;return json({books:[book('one','一本书')]});}return json({error:'changed'},{headers:{'X-Reader-Session-Changed':'1'}});}});
  await f.library.load();assert.equal(f.library.view().books.length,1);
  await f.library.load();
  assert.deepEqual(f.library.view().books,[],'session change clears private results');
});

test('sign-out clears private results and a late response after it is dropped',async()=>{
  const slow=deferred();let flip=false;
  const f=harness({handler:async url=>{if(url==='/api/auth/session')return json({user:f.getOwner()?{id:'reader-one'}:null});if(!flip){flip=true;return json({books:[book('one','一本书',{visibility:'private'})]});}await slow.promise;return json({books:[book('stale','旧账户的书',{visibility:'private'})]});}});
  await f.library.load();assert.equal(f.library.view().books.length,1);
  f.setOwner(null);const second=f.library.load();f.library.invalidate();slow.resolve();await second;
  assert.deepEqual(f.library.view().books,[],'sign-out clears results and late returns stay dropped');
});

test('late private results are rechecked against the current session before adoption',async()=>{
  const slow=deferred();
  const f=harness({handler:async(url,options)=>{if(url==='/api/auth/session')return json({user:{id:'reader-one'}});await slow.promise;return json({books:[book('private-one','私人的书',{visibility:'private'})]});}});
  const loading=f.library.load();slow.resolve();await loading;
  assert.equal(f.calls.filter(call=>call.url==='/api/auth/session').length,2,'private adoption rechecks the session first');
  assert.equal(f.library.view().books.length,1);
});

test('guest catalog results stay available without login and states stay distinct',async()=>{
  const f=harness({owner:null,handler:async url=>url==='/api/auth/session'?json({user:null}):json({books:[book('alice','Alice')]} )});
  await f.library.load();
  assert.equal(f.library.view().phase,'ready');
  assert.equal(f.library.view().books[0].bookId,'alice');
  const failing=harness({handler:async url=>{if(url==='/api/auth/session')return json({user:null});throw Object.assign(Error('offline'),{status:0});}});
  const loading=failing.library.load();assert.equal(failing.library.view().phase,'loading');
  await loading;assert.equal(failing.library.view().phase,'error');
  const empty=harness({handler:async url=>url==='/api/auth/session'?json({user:null}):json({books:[]})});
  await empty.library.load();assert.equal(empty.library.view().phase,'ready');
  assert.equal(empty.library.view().books.length,0,'empty is not an error');
});

test('palette queries stay bounded, fast and never persist private names',()=>{
  assert.equal(normalizePaletteQuery('  a\u0000b  '),'');
  assert.equal(normalizePaletteQuery('字'.repeat(200)).length,80);
  const books=Array.from({length:50},(_,i)=>book('b'+i,i%2?'Alice in Wonderland':'爱丽丝梦游仙境'));
  const results=matchPaletteBooks(books,'alice');
  assert.ok(results.length>0&&results.length<=PALETTE_RESULT_LIMIT,'matching is bounded');
  assert.ok(matchPaletteBooks(books,'爱丽').every(item=>item.title.zh.includes('爱丽')));
  assert.deepEqual(matchPaletteBooks(books,''),[],'an empty query invents no results');
  const library=createPaletteLibrary({request:async()=>json({books:[]}),getOwner:()=>null});
  assert.equal(typeof library.search==='function',true);
  assert.deepEqual(library.search('alice'),[]);
});

// ---- repair batch: owner boundary fences in search/view/load/adoption ----
test('an owner transition clears private results synchronously, including cached search and view',()=>{
  const calls=[];let owner='owner-a',subscribers=[];
  const request=async url=>{calls.push(url);return url==='/api/auth/session'?json({user:{id:'owner-a'}}):json({books:[book('mine','Owner A private',{visibility:'private'})]});};
  const library=createPaletteLibrary({request,getOwner:()=>owner,subscribe:fn=>{subscribers.push(fn);return ()=>{subscribers=subscribers.filter(x=>x!==fn);};}});
  return library.load().then(()=>{
    assert.equal(library.view().books.length,1);
    assert.equal(library.search('Owner').length,1);
    owner='owner-b';
    for(const fn of subscribers)fn();
    assert.deepEqual(library.view().books,[],'view clears synchronously on the owner transition');
    assert.deepEqual(library.search('Owner'),[],'cached search is fenced by owner, not only request settlement');
    assert.equal(library.view().phase,'idle');
  });
});

test('load and adoption are owner-fenced so a late owner-A return can never repopulate',async()=>{
  let owner='owner-a';let release;const gate=new Promise(r=>release=r);
  const request=async url=>{if(url==='/api/auth/session')return json({user:{id:'owner-a'}});await gate;return json({books:[book('mine','Owner A private',{visibility:'private'})]});};
  const library=createPaletteLibrary({request,getOwner:()=>owner});
  const loading=library.load();owner='owner-b';release();await loading;
  assert.deepEqual(library.view().books,[]);
  assert.deepEqual(library.search('Owner'),[]);
});

test('HTTP failures are errors, never ready-empty, and retry reuses one bounded request path',async()=>{
  let attempt=0;const calls=[];
  const request=async url=>{calls.push(url);if(url==='/api/auth/session')return json({user:null});attempt++;if(attempt===1)return {ok:false,status:503,headers:headers({}),json:async()=>({error:'服务暂不可用'})};return json({books:[book('alice','Alice')]});};
  const library=createPaletteLibrary({request,getOwner:()=>null});
  await library.load();
  assert.equal(library.view().phase,'error','an HTTP 503 must not present as ready empty');
  assert.deepEqual(library.view().books,[]);
  await library.load();
  assert.equal(library.view().phase,'ready');
  assert.equal(library.view().books.length,1);
  assert.deepEqual(calls.filter(url=>url==='/api/library').length,2,'each load is exactly one library request');
});

test('session bootstrap failures are errors and preserve the no-late-adoption fences',async()=>{
  const request=async url=>url==='/api/auth/session'?{ok:false,status:503,headers:headers({}),json:async()=>({error:'no session'})}:json({books:[book('mine','Private',{visibility:'private'})]});
  const library=createPaletteLibrary({request,getOwner:()=>null});
  await library.load();
  assert.equal(library.view().phase,'error');
  assert.deepEqual(library.view().books,[]);
});
