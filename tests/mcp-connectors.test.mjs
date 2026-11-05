import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createServer} from 'node:http';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {StreamableHTTPServerTransport} from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {z} from 'zod';
import {connectorURL,publicMcpFetch,createMcpConnectors,openMcpConnection} from '../server/mcp-connectors.mjs';
import {createIngestionStorage} from '../server/ingestion-storage.mjs';

test('external MCP refuses credentials in URLs and private DNS before any TLS connection',async()=>{
 for(const url of ['http://example.com/mcp','https://u:p@example.com/mcp','https://example.com/mcp?token=x','https://example.com/mcp#x','https://example.com:8443/mcp'])assert.throws(()=>connectorURL(url));
 for(const address of ['127.0.0.1','10.0.0.1','169.254.169.254','::1','::ffff:127.0.0.1','2001:db8::1'])await assert.rejects(publicMcpFetch('https://fixture.example/mcp',{resolve:async()=>[{address,family:address.includes(':')?6:4}]})('https://fixture.example/mcp'),error=>error.status===403);
 await assert.rejects(publicMcpFetch('https://fixture.example/mcp')('https://other.example/mcp'),error=>error.status===403);
});

test('official MCP client performs authenticated initialize, tools/list, explicit call, persisted reconnect and removal',async t=>{
 const dataDir=await mkdtemp(path.join(tmpdir(),'leafhour-connectors-')),store=createIngestionStorage({dataDir:path.join(dataDir,'store')}),owner={id:'owner-a'},other={id:'owner-b'};
 const privateToken='test-only-connector-bearer';let calls=0;
 const server=createServer(async(req,res)=>{
  if(req.headers.authorization!=='Bearer '+privateToken){res.writeHead(401);res.end();return;}
  if(req.method!=='POST'){res.writeHead(405);res.end();return;}
  const mcp=new McpServer({name:'Integration test',version:'1'});
  mcp.registerTool('length',{inputSchema:{text:z.string()},annotations:{readOnlyHint:true}},async({text})=>{calls++;return {content:[{type:'text',text:String(text.length)}]};});
  const transport=new StreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true});res.once('close',()=>void mcp.close());await mcp.connect(transport);await transport.handleRequest(req,res);
 });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await rm(dataDir,{recursive:true,force:true});});
 const connect=options=>openMcpConnection({...options,fetchImpl:(_url,init)=>fetch('http://127.0.0.1:'+server.address().port+'/mcp',init)});
 const make=()=>createMcpConnectors({dataDir,store,env:{},connect}),service=make();
 const saved=await service.add(owner,{name:'Test service',url:'https://fixture.example/mcp',token:privateToken});
 assert.equal(saved.tools[0].name,'length');assert.equal(saved.authenticated,true);assert.equal(calls,0);
 assert.doesNotMatch(JSON.stringify(await store.read('mcp-connectors/'+(await import('node:crypto')).createHash('sha256').update(owner.id).digest('hex'),{})),new RegExp(privateToken));
 assert.equal((await readFile(path.join(dataDir,'credential-key'))).length,32);
 assert.equal((await make().tools(owner,saved.id)).tools[0].name,'length');
 await assert.rejects(service.call(owner,saved.id,{name:'length',arguments:{text:'hello'}}));assert.equal(calls,0);
 const result=await service.call(owner,saved.id,{name:'length',arguments:{text:'hello'},confirm:true});assert.equal(result.content[0].text,'5');assert.equal(calls,1);
 assert.deepEqual(await service.list(other),[]);await assert.rejects(service.tools(other,saved.id),error=>error.status===404);
 await service.remove(owner,saved.id);await assert.rejects(service.tools(owner,saved.id),error=>error.status===404);assert.equal(calls,1);
});

test('disconnect fences a write still waiting on discovery and does not conceal a dispatched result',async()=>{
 const rows=new Map(),store={read:async(key,fallback)=>structuredClone(rows.get(key)||fallback),mutate:async(key,fallback,work)=>{const row=structuredClone(rows.get(key)||fallback);const result=await work(row);rows.set(key,row);return result;}};
 let release,entered,block=false,calls=0,dispatchRelease,dispatchEntered;
 const listingStarted=new Promise(resolve=>entered=resolve),dispatched=new Promise(resolve=>dispatchEntered=resolve);
 const client={close:async()=>{},listTools:async()=>{if(block){entered();await new Promise(resolve=>release=resolve);}return {tools:[{name:'write',inputSchema:{type:'object'}}]};},callTool:async()=>{calls++;dispatchEntered();await new Promise(resolve=>dispatchRelease=resolve);return {content:[{type:'text',text:'saved'}]};}};
 const service=createMcpConnectors({store,dataDir:'/unused',env:{},connect:async()=>client}),owner={id:'a'};
 const first=await service.add(owner,{name:'service',url:'https://example.com/mcp'});block=true;
 const pending=service.call(owner,first.id,{name:'write',arguments:{},confirm:true});await listingStarted;await service.remove(owner,first.id);release();await assert.rejects(pending,error=>error.status===404);assert.equal(calls,0);
 block=false;const second=await service.add(owner,{name:'service',url:'https://example.com/mcp'});
 const sent=service.call(owner,second.id,{name:'write',arguments:{},confirm:true});await dispatched;await service.remove(owner,second.id);dispatchRelease();assert.equal((await sent).content[0].text,'saved');assert.equal(calls,1);
});

test('shared CAS fences a stale hosted instance and removal reports an already registered dispatch',async()=>{
 const rows=new Map();let reads=0,pauseRead=false,readEntered,readRelease,pausePermit=false,permitEntered,permitRelease,calls=0;
 const readStarted=new Promise(resolve=>readEntered=resolve),permitStarted=new Promise(resolve=>permitEntered=resolve);
 const store={read:async(key,fallback)=>{const snapshot=structuredClone(rows.get(key)||fallback);if(pauseRead&&++reads===3){readEntered();await new Promise(resolve=>readRelease=resolve);}return snapshot;},mutate:async(key,fallback,work)=>{const row=structuredClone(rows.get(key)||fallback),result=await work(row);rows.set(key,row);if(pausePermit&&row.calls?.length){pausePermit=false;permitEntered();await new Promise(resolve=>permitRelease=resolve);}return result;}};
 const connect=async()=>({close:async()=>{},listTools:async()=>({tools:[{name:'write',inputSchema:{type:'object'}}]}),callTool:async()=>{calls++;return {content:[{type:'text',text:'saved'}]};}});
 const make=()=>createMcpConnectors({store,dataDir:'/unused',env:{},connect}),a=make(),b=make(),owner={id:'owner'};
 const first=await a.add(owner,{name:'service',url:'https://example.com/mcp'});pauseRead=true;reads=0;
 const stale=a.call(owner,first.id,{name:'write',arguments:{},confirm:true});await readStarted;
 assert.equal((await b.remove(owner,first.id)).pendingCalls,0);readRelease();await assert.rejects(stale,error=>error.status===404);assert.equal(calls,0);
 pauseRead=false;const second=await a.add(owner,{name:'service',url:'https://example.com/mcp'});pausePermit=true;
 const registered=a.call(owner,second.id,{name:'write',arguments:{},confirm:true});await permitStarted;
 assert.equal((await b.remove(owner,second.id)).pendingCalls,1);permitRelease();assert.equal((await registered).content[0].text,'saved');assert.equal(calls,1);
});
