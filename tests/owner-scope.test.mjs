import test from 'node:test';import assert from 'node:assert/strict';
import {createOwnerScope,readOwnerResponse} from '../app/owner-scope.mjs';
test('late results from the previous account cannot be rendered after signing out and back in',async()=>{
  const scope=createOwnerScope('alice'),ticket=scope.capture();let release;
  const pending=scope.run(ticket,()=>new Promise(resolve=>release=()=>resolve('old private data')));
  scope.adopt('guest');scope.adopt('alice');release();await assert.rejects(pending,e=>e.status===409);
  assert.equal(await scope.run(scope.capture(),async()=> 'current data'),'current data');
});
test('a delayed identity error cannot clear the new account',async()=>{
  const scope=createOwnerScope('alice'),ticket=scope.capture();let release,cleared=0;
  const pending=readOwnerResponse(scope,ticket,()=>new Promise(resolve=>release=resolve),()=>{cleared++;scope.adopt('guest');});
  scope.adopt('bob');release(new Response(JSON.stringify({error:'old session'}),{status:409,headers:{'X-Reader-Session-Changed':'1'}}));
  await assert.rejects(pending,e=>e.status===409);assert.equal(cleared,0);assert.equal(scope.capture().owner,'bob');
});
test('a current identity error still clears the invalid account',async()=>{
  const scope=createOwnerScope('alice');let cleared=0;
  await assert.rejects(readOwnerResponse(scope,scope.capture(),async()=>new Response('{}',{status:409,headers:{'X-Reader-Session-Changed':'1'}}),()=>{cleared++;scope.adopt('guest');}));
  assert.equal(cleared,1);assert.equal(scope.capture().owner,'guest');
});
test('a batch belonging to the previous owner is stopped before the next write',async()=>{
  const scope=createOwnerScope('alice'),ticket=scope.capture();scope.adopt('bob');let writes=0;
  await assert.rejects(scope.run(ticket,async()=>{writes++;return 'saved';}),e=>e.status===409);assert.equal(writes,0);
});
test('authentication limits keep their server-provided retry time in the client error',async()=>{
  const scope=createOwnerScope();
  await assert.rejects(readOwnerResponse(scope,scope.capture(),async()=>Response.json({error:'Limited',retryAfter:120},{status:429}),()=>{}),e=>e.status===429&&e.retryAfter===120);
});
test('non-JSON upstream errors retain status and only safe transient failures are classified retryable',async()=>{
 for(const status of [200,403,503]){const scope=createOwnerScope('alice');await assert.rejects(readOwnerResponse(scope,scope.capture(),async()=>new Response('<html>gateway</html>',{status}),()=>{}),e=>e.status===status&&e.retryable===(status===200||status===503));}
});
test('JSON null error bodies preserve HTTP status without a TypeError or unsafe message coercion',async()=>{
 for(const status of [403,503]){const scope=createOwnerScope('alice');await assert.rejects(readOwnerResponse(scope,scope.capture(),async()=>Response.json(null,{status}),()=>{}),e=>e.status===status&&e.message==='暂时无法完成');}
 const scope=createOwnerScope('alice');await assert.rejects(readOwnerResponse(scope,scope.capture(),async()=>Response.json({error:{sensitive:'untrusted object'}},{status:503}),()=>{}),e=>e.status===503&&e.message==='暂时无法完成');
});

// GET-179 owner fences: an input->owner-switch interleaving cancels the pending
// search commit and fences the stale response before anything can render.
test('an owner switch fences stale search responses and clears the previous owner query without pushing or backing',async()=>{
  const {createLibraryViewHistory}=await import('../app/library-view-state.mjs');
  const listeners=new Map(),entries=[{search:'?q=alice-private',state:null}];let index=0;
  const win={
    location:{pathname:'/library',get search(){return entries[index].search;}},
    history:{
      get state(){return entries[index].state;},
      pushState(state,title,url){entries.splice(index+1);entries.push({search:url.includes('?')?url.slice(url.indexOf('?')):'',state});index++;},
      replaceState(state,title,url){entries[index]={search:url.includes('?')?url.slice(url.indexOf('?')):'',state};},
      back(){if(index===0)throw Error('cannot go back');index--;for(const fn of listeners.get('popstate')||[])fn({state:entries[index].state});}
    },
    addEventListener(type,fn){listeners.set(type,[...(listeners.get(type)||[]),fn]);},
    removeEventListener(){}
  };
  const pending=new Map();let next=0;
  const timers={setTimeout(fn){const id=++next;pending.set(id,fn);return id;},clearTimeout(id){pending.delete(id);}};
  const scope=createOwnerScope('alice'),ticket=scope.capture();
  let release;const stale=scope.run(ticket,()=>new Promise(resolve=>release=()=>resolve('alice private rows')));
  const adapter=createLibraryViewHistory({window:win,timers,onChange:()=>{}});
  adapter.hydrate();
  adapter.setQuery('alice more');
  assert.equal(pending.size,1);
  scope.adopt('bob');
  adapter.adoptOwner();
  release();await assert.rejects(stale,e=>e.status===409);
  assert.equal(pending.size,0,'the owner switch cancels the pending search timer');
  assert.ok(!win.location.search.includes('q='),'the previous owner query never returns to the URL');
  assert.equal(entries.length,1,'clearing an owner never pushes or backs into unrelated entries');
  assert.equal(typeof adapter.snapshot().view,'object');
});


test('owner responses preserve only validated terminal billing receipts for safe new attempts',async()=>{
 const scope=createOwnerScope('alice');
 for(const status of ['not_started','released','cancelled','reversed']){
  await assert.rejects(readOwnerResponse(scope,scope.capture(),async()=>Response.json({error:'Quote expired',billingOperation:{id:'operation-1',status,private:'ignored'}},{status:409}),()=>{}),error=>{
   assert.deepEqual(error.billingOperation,{id:'operation-1',status});return true;
  });
 }
 for(const billingOperation of [{id:'operation-1',status:'running'},{status:'not_started'},'not_started']){
  await assert.rejects(readOwnerResponse(scope,scope.capture(),async()=>Response.json({error:'Unknown',billingOperation},{status:503}),()=>{}),error=>!error.billingOperation);
 }
});
