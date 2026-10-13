import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {createReaderServer} from '../server/server.mjs';

test('configuration metadata connects the official MCP client to a localhost IPv6 service',async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'marginalia-mcp-localhost-'));
  const server=await createReaderServer({recordsPath:path.join(dir,'records.json'),translator:null,sendCode:null});await new Promise(r=>server.listen(0,'localhost',r));t.after(async()=>{await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});});
  const {library,auth}=server.portal,session=await auth.localSession(),book=await library.importDocument(session.user,{filename:'localhost.txt',bytes:Buffer.from('This source is read through the reachable loopback configuration.')}),grant=await library.createGrant(session.user,{bookId:book.bookId,scopes:['content']});
  const setup=await (await fetch('http://localhost:'+server.address().port+'/api/library/mcp-setup',{headers:{Cookie:'marginalia_session='+session.token}})).json();
  const client=new Client({name:'localhost-configuration-verification',version:'1.0.0'});t.after(()=>client.close());await client.connect(new StdioClientTransport({command:setup.command,args:setup.args,env:{PATH:process.env.PATH,READER_SERVICE_URL:setup.serviceUrl,READER_AGENT_TOKEN:grant.token},stderr:'pipe'}));
  const result=await client.callTool({name:'reader_get_context',arguments:{bookId:book.bookId}});assert.ok(!result.isError);assert.match(result.content[0].text,/reachable loopback configuration/);
});

test('official MCP client handshakes, reads authorized sources, refuses notes and observes revocation',async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'marginalia-mcp-'));
  const server=await createReaderServer({recordsPath:path.join(dir,'records.json'),translator:null});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(async()=>{await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});});
  const {library}=server.portal,user={id:'mcp-test'};
  const book=await library.importDocument(user,{filename:'agent.txt',bytes:Buffer.from('An agent may read this passage.\n\nIts access can be revoked.')});
  const grant=await library.createGrant(user,{bookId:book.bookId,scopes:['content']});
  const transport=new StdioClientTransport({command:process.execPath,args:[path.resolve('server/mcp.mjs')],env:{PATH:process.env.PATH,READER_SERVICE_URL:'http://127.0.0.1:'+server.address().port,READER_AGENT_TOKEN:grant.token},stderr:'pipe'});
  const client=new Client({name:'marginalia-verification',version:'1.0.0'});t.after(()=>client.close());
  await client.connect(transport);
  const tools=await client.listTools();assert.ok(tools.tools.some(t=>t.name==='reader_get_context'));
  const result=await client.callTool({name:'reader_get_context',arguments:{bookId:book.bookId}});assert.ok(!result.isError);assert.match(result.content[0].text,/An agent may read/);
  const denied=await client.callTool({name:'reader_get_notes',arguments:{bookId:book.bookId}});assert.equal(denied.isError,true);
  const resource=await client.readResource({uri:`reader://books/${book.bookId}/manifest`});assert.match(resource.contents[0].text,/agent/);
  await library.revokeGrant(user,grant.id);
  const revoked=await client.callTool({name:'reader_get_context',arguments:{bookId:book.bookId}});assert.equal(revoked.isError,true);
});
