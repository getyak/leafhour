import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,realpath,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {parseBatchArgs,runBatch} from '../tools/lib/translation-batch.mjs';
import {main} from '../tools/translation-batch.mjs';

const origin='https://fixture.invalid',session='private-session';
const source=()=>({bookId:'b',contentVersion:'v',chapters:[{id:'c',kind:'body'}],sections:[{chapterId:'c',paragraphs:['p1','p2','p3'].map(id=>({id,original:'Source '+id+'.',translations:{}}))}]});
const saved=(id)=>({id,original:'Source '+id+'.',translations:{literal:{text:'Literal',sourceVersion:'v',status:'draft'},interpretive:{text:'Interpretive',sourceVersion:'v',status:'draft'}}});
async function setup(t,{enabled=true,units=1_000_000,quotePatch={},book=source()}={}){
 const dir=await mkdtemp(path.join(await realpath(tmpdir()),'batch-billing-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const calls=[],log=[];
 const fetchImpl=async(url,options={})=>{
  const route=new URL(url).pathname,body=options.body?JSON.parse(options.body):null;calls.push({route,body,headers:options.headers});
  if(route==='/api/auth/session')return Response.json({user:{id:'owner'},billing:{enabled}});
  assert.equal(options.headers['X-Reader-Owner'],'owner');
  if(route==='/api/billing/quotes'){
   assert.equal(body.action,'translation');assert.equal(body.bookId,'b');assert.equal(body.input.contentVersion,'v');
   return Response.json({id:'quote-'+body.input.passageId,ownerId:'owner',action:'translation',units,expiresAt:'2099-01-01T00:00:00Z',scope:{bookId:'b',passageId:body.input.passageId,contentVersion:'v',requestId:body.input.id},...quotePatch});
  }
  if(route.endsWith('/translate'))return Response.json(saved(body.passageId));
  assert.equal(route,'/api/library/books/b');return Response.json(book);
 };
 return {calls,log,fetchImpl,file:path.join(dir,'cp.json'),run:options=>runBatch({origin,bookId:'b',session,execute:true,maxRequests:3,checkpointFile:path.join(dir,'cp.json'),fetchImpl,log:line=>log.push(line),...options})};
}
test('CLI accepts an explicit integer point bound only alongside bounded execution',()=>{
 const base=['--origin',origin,'--book','b','--execute','--max-requests','20'];
 assert.equal(parseBatchArgs([...base,'--max-points','2']).maxPoints,2);
 assert.equal(parseBatchArgs([...base,'--max-points','0']).maxPoints,0);
 for(const value of ['-1','1.5','NaN','Infinity','9007199255',''])assert.throws(()=>parseBatchArgs([...base,'--max-points',value]),{code:'usage'});
 assert.throws(()=>parseBatchArgs(['--origin',origin,'--book','b','--max-points','3']),{code:'usage'});
});
test('paid execution without max-points stops before quotes or generation',async t=>{
 const f=await setup(t);await assert.rejects(f.run(),error=>error.code==='usage'&&error.message.includes('--max-points'));
 assert.equal(f.calls.filter(c=>c.body).length,0);
});
test('real per-passage quotes bind request IDs and reserve only within the explicit point limit',async t=>{
 const f=await setup(t),summary=await f.run({maxPoints:2});
 const quotes=f.calls.filter(c=>c.route==='/api/billing/quotes'),posts=f.calls.filter(c=>c.route.endsWith('/translate'));
 assert.equal(quotes.length,3);assert.equal(posts.length,2);assert.equal(summary.requests,2);assert.equal(summary.stopped,'points-limit');
 assert.deepEqual(summary.billing,{enabled:true,maxPoints:2,reservedUnits:2_000_000,quotedUnits:3_000_000});
 for(let i=0;i<posts.length;i++){
  assert.equal(posts[i].body.id,quotes[i].body.input.id);assert.equal(posts[i].body.billing.quoteId,'quote-p'+(i+1));assert.equal(posts[i].body.billing.idempotencyKey,posts[i].body.id);
 }
 assert.notEqual(posts[0].body.id,posts[1].body.id);assert.ok(f.log.some(line=>line.includes('points')));
 assert.doesNotMatch(await readFile(f.file,'utf8'),/private-session|Source|Literal|Interpretive/);
});
test('server quote units determine cost and zero budget never dispatches generation',async t=>{
 for(const [maxPoints,units] of [[0,1_000_000],[1,2_000_000]]){
  const f=await setup(t,{units}),summary=await f.run({maxPoints});assert.equal(summary.stopped,'points-limit');assert.equal(summary.requests,0);assert.equal(summary.billing.reservedUnits,0);assert.equal(f.calls.filter(c=>c.route.endsWith('/translate')).length,0);
 }
});
test('foreign or malformed quotes fail closed before a generation request',async t=>{
 for(const quotePatch of [{ownerId:'other'},{action:'conversation'},{units:-1},{units:1.5},{expiresAt:'2000-01-01'},{scope:{bookId:'foreign'}},{id:''}]){
  const f=await setup(t,{quotePatch});await assert.rejects(f.run({maxPoints:2}),{code:'invalid-quote'});assert.equal(f.calls.filter(c=>c.route.endsWith('/translate')).length,0);
 }
});
test('cached dual translations require no point authorization or quote',async t=>{
 const book=source();book.sections[0].paragraphs=book.sections[0].paragraphs.map(p=>({...p,...saved(p.id)}));
 const f=await setup(t,{book}),summary=await f.run();assert.equal(summary.requests,0);assert.equal(summary.remaining,0);assert.equal(f.calls.filter(c=>c.body).length,0);
});
test('billing-disabled execution preserves existing free transport without billing fields',async t=>{
 const f=await setup(t,{enabled:false}),summary=await f.run({maxRequests:1});const posts=f.calls.filter(c=>c.route.endsWith('/translate'));
 assert.equal(summary.requests,1);assert.equal(posts.length,1);assert.deepEqual(posts[0].body,{passageId:'p1',contentVersion:'v'});assert.equal(f.calls.filter(c=>c.route==='/api/billing/quotes').length,0);
});
test('dry-run never creates paid quotes and CLI explains the explicit points requirement',async t=>{
 const f=await setup(t),summary=await f.run({execute:false,maxRequests:null});assert.equal(summary.requests,0);assert.equal(f.calls.filter(c=>c.body).length,0);
 t.mock.method(globalThis,'fetch',f.fetchImpl);const output=[];
 const status=await main({argv:['--origin',origin,'--book','b','--checkpoint',f.file,'--execute','--max-requests','2'],env:{LEAFHOUR_SESSION:session},write:x=>output.push(x),writeError:x=>output.push(x)});
 assert.equal(status,2);assert.ok(output.join('\n').includes('--max-points'));assert.doesNotMatch(output.join('\n'),/private-session|Source/);
});
test('CLI reports a normal point-budget stop and cancellation after quoting cannot dispatch',async t=>{
 const f=await setup(t),output=[];t.mock.method(globalThis,'fetch',f.fetchImpl);
 const status=await main({argv:['--origin',origin,'--book','b','--checkpoint',f.file,'--execute','--max-requests','3','--max-points','1'],env:{LEAFHOUR_SESSION:session},write:x=>output.push(x),writeError:x=>output.push(x)});
 assert.equal(status,0);assert.ok(output.join('\n').includes('点数预算 1'));assert.ok(output.join('\n').includes('未提交生成'));assert.equal(f.calls.filter(c=>c.route.endsWith('/translate')).length,1);
 const other=await setup(t),controller=new AbortController(),summary=await other.run({maxPoints:1,signal:controller.signal,log:()=>controller.abort()});
 assert.equal(summary.stopped,'aborted');assert.equal(summary.requests,0);assert.equal(summary.billing.reservedUnits,0);
});
