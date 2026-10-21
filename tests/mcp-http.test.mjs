import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createHash,randomBytes} from 'node:crypto';
import {createHostedHandler} from '../api/[...path].js';
import {createPortal} from '../server/portal.mjs';
import {createHostedAuth} from '../deploy/hosted-auth.mjs';
import {authFixture} from './auth-fixture.mjs';
import {readingBook,readingRecords} from './reading-fixtures.mjs';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {safeAuthReturn,safeMcpReturn,authEntryReturn} from '../app/auth-return.mjs';

async function fixture(t){
 const f=authFixture(),origin=f.env.READER_PUBLIC_ORIGIN,store=f.store(),auth=createHostedAuth({...f,store}),portal=await createPortal({dataDir:'hosted-mcp-fixture',publicOrigin:origin,dataStore:store,authService:auth,catalogDir:null,allowLocal:false,translator:null,chatGenerator:null,companionGenerator:null,introductionGenerator:null,speechProvider:null,dialogueGenerator:null,guideGenerator:null,paddleProvider:null,env:f.env});
 const own={id:f.user.id},other={id:'synthetic-other'},book=structuredClone(readingBook);book.sections[0].paragraphs[0].translations={literal:{text:'Synthetic literal',status:'reviewed',origin:'ai',sourceVersion:book.contentVersion},interpretive:{text:'Synthetic interpretation',status:'draft',origin:'ai',sourceVersion:book.contentVersion}};
 for(const user of [own,other]){const b=structuredClone(book);if(user===other)b.sections[0].paragraphs[0].original='FOREIGN_PRIVATE_TEXT';await portal.library.restoreLibrary(user,{kind:'marginalia-library',schemaVersion:1,books:[{book:b,records:readingRecords()}]});}
 const handler=createHostedHandler({portalFactory:async()=>portal,storeFactory:()=>store,authFactory:()=>auth,env:f.env}),server=createServer(handler);await new Promise(r=>server.listen(0,'127.0.0.1',r));
 t.after(async()=>{await portal.chat.close();await new Promise(r=>{server.close(r);server.closeAllConnections();});});
 const base='http://127.0.0.1:'+server.address().port;
 const call=(p,options={})=>fetch(base+p,{...options,redirect:'manual'}),post=(p,input,headers={})=>call(p,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(input)});
 const login=await post('/api/auth/password',{email:'reader@example.com',password:'synthetic-password'},{Origin:origin});assert.equal(login.status,200);
 const cookie=login.headers.get('set-cookie').split(';')[0];
 async function authorize(){
  const r=await post('/api/mcp/oauth/register',{client_name:'Synthetic MCP host',redirect_uris:['https://client.example/callback'],token_endpoint_auth_method:'none',grant_types:['authorization_code'],response_types:['code']});assert.equal(r.status,201);const client=await r.json(),verifier=randomBytes(32).toString('base64url'),query=new URLSearchParams({client_id:client.client_id,redirect_uri:client.redirect_uris[0],response_type:'code',scope:'content',resource:origin+'/api/mcp',state:'state',code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256'});
  const start=await call('/api/mcp/oauth/authorize?'+query);assert.equal(start.status,303);const continuation=new URL(start.headers.get('location')),page=await call(continuation.pathname+continuation.search,{headers:{Cookie:cookie}});assert.equal(page.status,200);const html=await page.text(),csrf=html.match(/name="csrf" value="([^"]+)"/)[1],request=continuation.searchParams.get('request');
  const consent=await post('/api/mcp/oauth/consent',{request,csrf,bookId:book.bookId,allow:true},{Origin:origin,Cookie:cookie});assert.equal(consent.status,200);const callback=new URL((await consent.json()).location),form=new URLSearchParams({grant_type:'authorization_code',client_id:client.client_id,redirect_uri:client.redirect_uris[0],resource:origin+'/api/mcp',code:callback.searchParams.get('code'),code_verifier:verifier}),exchanged=await call('/api/mcp/oauth/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:form});assert.equal(exchanged.status,200);return {token:(await exchanged.json()).access_token,client,request,html};
 }
 return {...f,portal,base,call,post,cookie,authorize,origin,own,other};
}
test('strict auth returns retain only a bounded MCP consent request',()=>{const target='/api/mcp/oauth/authorize?request='+'a'.repeat(43);assert.equal(safeAuthReturn(target),target);assert.equal(authEntryReturn(new URLSearchParams({next:target})),target);for(const path of ['/api/mcp','/api/mcp/oauth/token',target+'&request='+'b'.repeat(43),target+'&resource=https://evil.example',target+'#x','https://evil.example'+target])assert.equal(safeMcpReturn(path),null);});
test('real hosted HTTP flow discovers, logs in, consents, lists and calls read-only MCP tools',async t=>{
 const f=await fixture(t),metadata=await f.call('/api/mcp/metadata');assert.equal(metadata.status,200);assert.equal((await metadata.json()).resource,f.origin+'/api/mcp');
 const anonymous=await f.post('/api/mcp',{jsonrpc:'2.0',id:1,method:'tools/list'});assert.equal(anonymous.status,401);assert.match(anonymous.headers.get('www-authenticate'),/oauth-protected-resource\/api\/mcp/);
 const {token,html}=await f.authorize();assert.ok(!html.includes('FOREIGN_PRIVATE_TEXT'));assert.ok(!html.includes('refresh-fixture'));assert.match(html,/frame|Connect one book/);
 const transport=new StreamableHTTPClientTransport(new URL(f.base+'/api/mcp'),{requestInit:{headers:{Authorization:'Bearer '+token}}}),client=new Client({name:'integration-fixture',version:'1'});t.after(()=>client.close());await client.connect(transport);
 const {tools}=await client.listTools();assert.equal(tools.length,5);for(const tool of tools){assert.equal(tool.annotations.readOnlyHint,true);assert.deepEqual(tool._meta.securitySchemes,[{type:'oauth2',scopes:['content']}]);}
 const connection=(await client.callTool({name:'reader_get_connection',arguments:{}})).structuredContent;assert.equal(connection.bookId,readingBook.bookId);
 const manifest=await client.callTool({name:'reader_get_manifest',arguments:{bookId:connection.bookId}});assert.ok(!manifest.isError,manifest.content[0].text);assert.equal(manifest.structuredContent.contentVersion,readingBook.contentVersion);
 const chapter=await client.callTool({name:'reader_get_chapter',arguments:{bookId:connection.bookId,chapterId:'ch01'}});assert.ok(!chapter.isError,chapter.content[0].text);assert.equal(chapter.structuredContent.passages[0].original,'Read this first.');assert.equal(chapter.structuredContent.passages[0].translationStatus.literal,'reviewed');assert.equal(chapter.structuredContent.passages[0].translationStatus.interpretive,'draft');assert.ok(!JSON.stringify(chapter).includes('FOREIGN_PRIVATE_TEXT'));
 const foreign=await client.callTool({name:'reader_get_manifest',arguments:{bookId:'foreign-book'}});assert.equal(foreign.isError,true);
 const escalated=await client.callTool({name:'reader_get_manifest',arguments:{bookId:connection.bookId,ownerId:f.other.id}});assert.equal(escalated.isError,true);
 const grants=await f.portal.library.grants(f.own);await f.portal.library.revokeGrant(f.own,grants[0].id);
 const revoked=await f.post('/api/mcp',{jsonrpc:'2.0',id:2,method:'tools/list'},{Authorization:'Bearer '+token});assert.equal(revoked.status,401);
 assert.equal((await f.portal.library.records(f.own,readingBook.bookId)).position,null);assert.equal((await f.portal.library.records(f.own,readingBook.bookId)).readingSessions.length,0);
});
test('login continuation, CSRF, malicious origins and token passthrough fail safely',async t=>{
 const f=await fixture(t),flow=await f.authorize(),path='/api/mcp/oauth/authorize?request='+flow.request;
 const login=await f.call(path);assert.equal(login.status,303);assert.equal(new URL(login.headers.get('location')).pathname,'/library');assert.equal(new URL(login.headers.get('location')).searchParams.get('next'),path);
 const bad=await f.post('/api/mcp/oauth/consent',{request:flow.request,csrf:'bad',bookId:readingBook.bookId,allow:true},{Origin:f.origin,Cookie:f.cookie});assert.equal(bad.status,403);
 const origin=await f.post('/api/mcp',{jsonrpc:'2.0',id:1,method:'tools/list'},{Origin:'https://evil.example',Authorization:'Bearer '+flow.token});assert.equal(origin.status,403);
 const manual=await f.portal.library.createGrant(f.own,{bookId:readingBook.bookId,scopes:['content','notes']});const passthrough=await f.post('/api/mcp',{jsonrpc:'2.0',id:1,method:'tools/list'},{Authorization:'Bearer '+manual.token});assert.equal(passthrough.status,401);
 const revoked=await f.call('/api/mcp/oauth/revoke',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({token:flow.token,client_id:flow.client.client_id})});assert.equal(revoked.status,200);assert.equal((await f.post('/api/mcp',{},{Authorization:'Bearer '+flow.token})).status,401);
});
