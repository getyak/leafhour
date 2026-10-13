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
