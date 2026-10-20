// GET-195 external annotation MCP batch: the actual installed SDK over stdio
// exercises reader_get_annotations / reader_add_annotation with strict schemas,
// scope isolation and narrow receipts, plus the exact external HTTP actions.
// Fake model only; no live data, credentials, OAuth or remote transport claims.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {createReaderServer} from '../server/server.mjs';

const owner={id:'external-mcp-owner'},other={id:'external-mcp-other'};
const hash=value=>createHash('sha256').update(value).digest('hex');
const size=value=>Buffer.byteLength(JSON.stringify(value));
const LONG='开头😀\u0001"\\尾'.repeat(1500);
async function fixture(t){
  const dir=await mkdtemp(path.join(os.tmpdir(),'annotation-mcp-'));
  const calls={model:0};
  const server=await createReaderServer({bookPath:path.join(dir,'absent.json'),recordsPath:path.join(dir,'records.json'),sendCode:null,translator:null,chatGenerator:null,companionGenerator:null,speechProvider:null,dialogueGenerator:null,guideGenerator:null,paddleProvider:null,env:{},annotationGenerator:async()=>{calls.model++;return {kind:'annotation',text:LONG};}});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const library=server.portal.library;
  const book=await library.importDocument(owner,{filename:'external.txt',bytes:Buffer.from('An external agent may explain these selected words.\n\nA second paragraph stays unread.')});
  const p=book.sections[0].paragraphs[0];
  const quote={kind:'leafhour-reading-quote',schemaVersion:1,bookId:book.bookId,contentVersion:book.contentVersion,chapterId:book.sections[0].chapterId,parts:[{passageId:p.id,layer:'original',start:0,end:24,text:p.original.slice(0,24)}]};
  // One site thread with a long AI body and a private user follow-up.
  await server.portal.chat.annotations.explain(owner,book.bookId,{id:'seed-1',threadId:'thread-1',quote});
  await server.portal.chat.annotations.explain(owner,book.bookId,{id:'seed-2',threadId:'thread-1',quote,text:'PRIVATE USER SENTINEL'});
  const seedAiId='ai-'+hash('seed-1').slice(0,32);
  const tokens={};
  const grantIds={};
  for(const [name,scopes]of [['read',['annotations']],['write',['annotation:write']],['both',['annotations','annotation:write']],['content',['content']]]){
    const grant=await library.createGrant(owner,{bookId:book.bookId,scopes});
    tokens[name]=grant.token;grantIds[name]=grant.id;
  }
  const otherBook=await library.importDocument(other,{filename:'other.txt',bytes:Buffer.from('Another owner source.')});
  const otherGrant=await library.createGrant(other,{bookId:otherBook.bookId,scopes:['annotations','annotation:write']});
  tokens.other=otherGrant.token;grantIds.other=otherGrant.id;
  const clients=[];
  const base='http://127.0.0.1:'+server.address().port;
  const connect=async token=>{
    const client=new Client({name:'annotation-mcp-test',version:'1.0.0'});
    clients.push(client);
    await client.connect(new StdioClientTransport({command:process.execPath,args:[path.resolve('server/mcp.mjs')],env:{PATH:process.env.PATH,READER_SERVICE_URL:base,READER_AGENT_TOKEN:token},stderr:'pipe'}));
    return client;
  };
  t.after(async()=>{for(const client of clients)await client.close().catch(()=>{});await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});});
  const put={bookId:book.bookId,threadId:'thread-1',messageId:'ext-1',quote,body:'外部 Agent 的解释 EXTERNAL'};
  return {dir,server,base,library,book,quote,put,tokens,grantIds,connect,calls,seedAiId};
}
async function tool(client,name,args){
  const result=await client.callTool({name,arguments:args});
  assert.ok(!result.isError,result.content?.[0]?.text);
  assert.ok(size(result)<=98304,'MCP tool envelope exceeds byte bound');
  assert.ok(size(result.structuredContent)<=24576,'canonical data exceeds byte bound');
  assert.deepEqual(JSON.parse(result.content[0].text),result.structuredContent,'text and structuredContent stay in sync');
  return result.structuredContent;
}
async function denied(run,label='access unexpectedly succeeded'){
  try{const result=await run();assert.equal(result.isError,true,label);assert.ok(!JSON.stringify(result).includes('PRIVATE USER SENTINEL'));assert.ok(!JSON.stringify(result).includes('UNAUTHORIZED'));}
  catch(error){if(error.code==='ERR_ASSERTION')throw error;assert.ok(!JSON.stringify(error).includes('PRIVATE USER SENTINEL'));}
}

test('actual SDK 1.32.1 stdio annotation tools enforce strict schemas, scopes and narrow receipts',{timeout:30000},async t=>{
  const f=await fixture(t);
  const installed=JSON.parse(await readFile(path.resolve('node_modules/@modelcontextprotocol/sdk/package.json'),'utf8')).version;
  assert.equal(installed,'1.32.1','this batch exercises the installed SDK unchanged');
  const both=await f.connect(f.tokens.both),readOnly=await f.connect(f.tokens.read),writeOnly=await f.connect(f.tokens.write),contentOnly=await f.connect(f.tokens.content);
  const tools=await both.listTools();
  const get=tools.tools.find(row=>row.name==='reader_get_annotations'),add=tools.tools.find(row=>row.name==='reader_add_annotation');
  assert.ok(get&&add,'both external annotation tools are registered');
  assert.equal(get.annotations.readOnlyHint,true);
  assert.equal(add.annotations.readOnlyHint,false);
  assert.equal(add.annotations.destructiveHint,false);
  assert.equal(add.annotations.idempotentHint,true);
  assert.equal(add.annotations.openWorldHint,false);
  assert.ok(tools.tools.every(row=>!/grant|delete|backup|share/.test(row.name)));
  // Bounded AI-only read: complete long Unicode body, no user words.
  const first=await tool(both,'reader_get_annotations',{bookId:f.book.bookId,limit:20});
  assert.equal(first.bookId,f.book.bookId);
  assert.ok(!JSON.stringify(first).includes('PRIVATE USER SENTINEL'));
  assert.ok(first.items.every(item=>item.provenance==='ai'&&item.attribution&&item.anchor.context==='stored selected-text context, not a source citation'));
  const bodies=new Map();let args={bookId:f.book.bookId,limit:1},steps=0;
  do{
    const page=await tool(both,'reader_get_annotations',args);
    assert.ok(!JSON.stringify(page).includes('PRIVATE USER SENTINEL'));
    for(const item of page.items){if(!bodies.has(item.messageId))bodies.set(item.messageId,'');bodies.set(item.messageId,bodies.get(item.messageId)+item.body);}
    args=page.nextCursor?{bookId:f.book.bookId,...page.nextCursor}:null;
    assert.ok(++steps<200);
  }while(args);
  assert.equal(bodies.get(f.seedAiId),LONG,'the long AI body reconstructs exactly through strict continuation');
  const single=await tool(both,'reader_get_annotations',{bookId:f.book.bookId});
  assert.equal(single.items.length,1,'limit defaults to one');
  await denied(()=>both.callTool({name:'reader_get_annotations',arguments:{bookId:f.book.bookId,snapshot:'f'.repeat(64)}}),'a stale snapshot must be refused');
  // The external write stores one AI message and answers with a narrow receipt.
  const modelsBefore=f.calls.model;
  const receipt=await tool(writeOnly,'reader_add_annotation',f.put);
  assert.deepEqual(Object.keys(receipt).sort(),['createdAt','messageId','status','threadId']);
  assert.equal(receipt.status,'stored');
  assert.ok(Number.isFinite(Date.parse(receipt.createdAt)));
  assert.ok(!JSON.stringify(receipt).includes('PRIVATE USER SENTINEL')&&!JSON.stringify(receipt).includes('EXTERNAL'),'the receipt carries no words at all');
  assert.deepEqual(await tool(writeOnly,'reader_add_annotation',f.put),receipt,'an exact retry repeats the receipt');
  assert.equal(f.calls.model,modelsBefore,'an external write never invokes a model');
  const reread=await tool(both,'reader_get_annotations',{bookId:f.book.bookId,threadId:'thread-1',messageId:'ext-1'});
  assert.equal(reread.items[0].body,'外部 Agent 的解释 EXTERNAL');
  assert.deepEqual(reread.items[0].attribution,{source:'external-agent',label:'External Agent'});
  // Scope isolation: reads and writes are separately granted.
  await denied(()=>readOnly.callTool({name:'reader_add_annotation',arguments:f.put}),'the read scope must not write');
  await denied(()=>writeOnly.callTool({name:'reader_get_annotations',arguments:{bookId:f.book.bookId}}),'the write scope must not read');
  await denied(()=>contentOnly.callTool({name:'reader_get_annotations',arguments:{bookId:f.book.bookId}}),'content is not an annotation scope');
  await denied(()=>contentOnly.callTool({name:'reader_add_annotation',arguments:f.put}));
  await denied(()=>both.callTool({name:'reader_add_annotation',arguments:{...f.put,bookId:'ungranted-book'}}),'a foreign book stays refused');
  // Strict schemas and the exact ReaderQuote shape, including translationStatus.
  await denied(()=>both.callTool({name:'reader_add_annotation',arguments:{...f.put,ownerId:owner.id}}),'unknown write fields are refused');
  await denied(()=>both.callTool({name:'reader_add_annotation',arguments:{...f.put,origin:'user'}}),'external callers cannot set attribution');
  await denied(()=>both.callTool({name:'reader_add_annotation',arguments:{...f.put,quote:{...f.quote,extra:true}}}));
  await denied(()=>both.callTool({name:'reader_add_annotation',arguments:{...f.put,quote:{...f.quote,parts:[{...f.quote.parts[0],translationStatus:'draft'}]}}}),'translationStatus does not belong on an original part');
  await denied(()=>both.callTool({name:'reader_add_annotation',arguments:{...f.put,body:'x'.repeat(12001)}}),'an oversized body is refused');
  await denied(()=>both.callTool({name:'reader_add_annotation',arguments:{...f.put,quote:{...f.quote,parts:Array.from({length:9},()=>f.quote.parts[0])}}}));
  await denied(()=>both.callTool({name:'reader_get_annotations',arguments:{bookId:f.book.bookId,offset:0}}),'unknown read parameters are refused');
  await denied(()=>both.callTool({name:'reader_get_annotations',arguments:{bookId:f.book.bookId,charOffset:1}}),'an incomplete cursor is refused');
  // Revocation is enforced on the next call without leaking words.
  await f.library.revokeGrant(owner,f.grantIds.both);
  await denied(()=>both.callTool({name:'reader_get_annotations',arguments:{bookId:f.book.bookId}}));
  await denied(()=>both.callTool({name:'reader_add_annotation',arguments:{...f.put,messageId:'ext-2'}}));
  assert.equal(f.calls.model,modelsBefore);
});

test('the external annotation HTTP actions accept only their exact method, params and scopes',{timeout:30000},async t=>{
  const f=await fixture(t);
  const headers=token=>({Authorization:'Bearer '+token,'Content-Type':'application/json'});
  const readUrl=query=>f.base+'/api/agent/annotations'+(query||'');
  const get=(query,token)=>fetch(readUrl(query),{headers:headers(token)});
  assert.equal((await get('?bookId='+f.book.bookId+'&__proto__=ignored&__proto__=duplicate',f.tokens.read)).status,400);
  const post=(body,token)=>fetch(f.base+'/api/agent/annotation',{method:'POST',headers:headers(token),body:JSON.stringify(body)});
  // Unknown, duplicate and malformed query parameters are rejected outright.
  for(const query of ['?bookId='+f.book.bookId+'&junk=1','?bookId='+f.book.bookId+'&limit=1&limit=2','?bookId='+f.book.bookId+'&charOffset=x','?bookId='+f.book.bookId+'&charOffset=-1','?bookId='+f.book.bookId+'&limit=21','?bookId='+f.book.bookId+'&charOffset=1','?bookId='+f.book.bookId+'&messageId=ext-1']){
    const response=await get(query,f.tokens.read);
    assert.equal(response.status,400,query+' => '+await response.text());
  }
  // Wrong methods fail with 405 on an otherwise valid grant identity.
  assert.equal((await fetch(readUrl('?bookId='+f.book.bookId),{method:'POST',headers:headers(f.tokens.read),body:JSON.stringify({})})).status,405);
  assert.equal((await fetch(f.base+'/api/agent/annotation?bookId='+f.book.bookId,{method:'GET',headers:headers(f.tokens.write)})).status,405);
  // Each action runs on its own scope, never content/notes and never another owner.
  assert.equal((await get('?bookId='+f.book.bookId,f.tokens.write)).status,403);
  assert.equal((await get('?bookId='+f.book.bookId,f.tokens.content)).status,403);
  assert.equal((await get('?bookId='+f.book.bookId,f.tokens.other)).status,403,'another owner and book stay closed');
  assert.equal((await post(f.put,f.tokens.read)).status,403);
  assert.equal((await post(f.put,f.tokens.content)).status,403);
  // Attribution, provenance, timestamps and runtime fields cannot be supplied.
  for(const patch of [{owner:owner.id},{origin:'user'},{provenance:{source:'site-agent'}},{createdAt:'2026-01-01T00:00:00.000Z'},{sourceRefs:[]},{runtime:{}},{locale:'en'}]){
    const response=await post({...f.put,...patch},f.tokens.write);
    assert.equal(response.status,400,JSON.stringify(patch));
  }
  // Narrow idempotent receipt, exact retry, no model.
  const modelsBefore=f.calls.model;
  const first=await post(f.put,f.tokens.write);
  assert.equal(first.status,200);
  assert.equal(first.headers.get('cache-control'),'private, no-store');
  const receipt=await first.json();
  assert.deepEqual(Object.keys(receipt).sort(),['createdAt','messageId','status','threadId']);
  assert.ok(!JSON.stringify(receipt).includes('PRIVATE USER SENTINEL'));
  assert.deepEqual(await (await post(f.put,f.tokens.write)).json(),receipt);
  assert.equal(f.calls.model,modelsBefore);
  // GET returns the bounded AI projection, never the owner's Web view.
  const page=await (await get('?bookId='+f.book.bookId+'&limit=20',f.tokens.read)).json();
  assert.ok(Array.isArray(page.items));
  assert.equal(page.requests,undefined);
  assert.equal(page.available,undefined);
  assert.ok(page.items.every(item=>item.provenance==='ai'));
  assert.ok(!JSON.stringify(page).includes('PRIVATE USER SENTINEL'));
  // Revoked and malformed identities stay refused.
  await f.library.revokeGrant(owner,f.grantIds.write);
  assert.equal((await post({...f.put,messageId:'ext-9'},f.tokens.write)).status,403);
  assert.equal((await get('?bookId='+f.book.bookId,f.tokens.read)).status,200);
});

test('the bounded read rejects unknown parameters and dangling cursors',{timeout:30000},async t=>{
  const f=await fixture(t);
  const client=await f.connect(f.tokens.read);
  const seen=new Set();let args={bookId:f.book.bookId,limit:20},steps=0;
  do{
    const page=await tool(client,'reader_get_annotations',args);
    for(const item of page.items)seen.add(item.messageId);
    args=page.nextCursor?{bookId:f.book.bookId,...page.nextCursor}:null;
    assert.ok(++steps<200);
  }while(args);
  assert.equal(seen.size,2,'both AI messages stay reachable through strict continuation');
  const page=await tool(client,'reader_get_annotations',{bookId:f.book.bookId,limit:20});
  await denied(()=>client.callTool({name:'reader_get_annotations',arguments:{bookId:f.book.bookId,threadId:'thread-1',messageId:f.seedAiId,charOffset:1,snapshot:page.snapshot,limit:20,duplicate:1}}),'unknown cursor parameters are refused');
  await denied(()=>client.callTool({name:'reader_get_annotations',arguments:{bookId:f.book.bookId,threadId:'missing',messageId:'missing',charOffset:0,limit:1,snapshot:page.snapshot}}),'dangling thread identities are refused');
  await denied(()=>client.callTool({name:'reader_get_annotations',arguments:{bookId:f.book.bookId,threadId:'thread-1',messageId:f.seedAiId,charOffset:999999,snapshot:page.snapshot}}),'out-of-range offsets are refused');
});
