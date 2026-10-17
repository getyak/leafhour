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
