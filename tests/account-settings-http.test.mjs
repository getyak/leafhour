import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createReaderServer} from '../server/server.mjs';
import {createServer} from 'node:http';
import {createHostedHandler} from '../api/[...path].js';
import {createPortal} from '../server/portal.mjs';
import {createHostedAuth} from '../deploy/hosted-auth.mjs';
import {authFixture} from './auth-fixture.mjs';
import {exportAccountData,exportBrowserRecords} from '../app/account-export.mjs';

test('production catch-all admits account exports and MCP management while preserving owner and path guards',async t=>{
 const fixture=authFixture(),store=fixture.store(),auth=createHostedAuth({...fixture,store});
 const portal=await createPortal({dataDir:'hosted-account-settings-fixture',publicOrigin:fixture.env.READER_PUBLIC_ORIGIN,dataStore:store,authService:auth,catalogDir:null,allowLocal:false,hostedMcp:true,translator:null,chatGenerator:null,companionGenerator:null,introductionGenerator:null,speechProvider:null,dialogueGenerator:null,guideGenerator:null,paddleProvider:null,env:fixture.env});
 const handler=createHostedHandler({env:fixture.env,storeFactory:()=>store,authFactory:()=>auth,portalFactory:async()=>portal});
 const server=createServer((req,res)=>{req.query=Object.fromEntries(new URL(req.url,'http://fixture.invalid').searchParams);void handler(req,res);});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
 t.after(async()=>{await portal.chat.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
 const headers={Origin:fixture.env.READER_PUBLIC_ORIGIN,'Content-Type':'application/json'};
 const call=(path,{body,owner=fixture.user.id,signedIn=true,catchAll=true}={})=>fetch(base+(catchAll?'/api/service?path='+encodeURIComponent(path.slice('/api/'.length)):path),{headers:{...headers,...(signedIn&&cookie?{Cookie:cookie,'X-Reader-Owner':owner}:{})},...(body===undefined?{}:{method:'POST',body:JSON.stringify(body)})});
 let cookie='';const login=await call('/api/auth/password',{body:{email:fixture.user.email,password:'synthetic-password'},signedIn:false});assert.equal(login.status,200);cookie=login.headers.get('set-cookie').split(';')[0];
 const id='00000000-0000-4000-8000-000000000001',connector='/api/account/mcp-connectors/'+id;
 for(const path of ['/api/account/settings/export','/api/account/export','/api/account/export/manifest','/api/account/mcp-server','/api/account/mcp-connectors']){
  for(const catchAll of [true,false]){const response=await call(path,{catchAll});assert.equal(response.status,200,path);assert.match(response.headers.get('cache-control'),/no-store/);await response.json();}
  assert.equal((await call(path,{signedIn:false})).status,401,path);assert.equal((await call(path,{owner:'different-owner'})).status,409,path);
 }
 assert.equal((await call('/api/account/mcp-connectors',{body:{name:'Invalid fixture',url:'http://127.0.0.1/mcp'}})).status,400);
 for(const [action,body,status]of [['tools',undefined,404],['call',{name:'fixture',arguments:{},confirm:true},404],['remove',{},200]]){
  const path=connector+'/'+action,response=await call(path,{body});assert.equal(response.status,status,path);const value=await response.json();if(status===404)assert.equal(value.error,'连接已移除');else assert.equal(value.removed,true);
  assert.equal((await call(path,{body,signedIn:false})).status,401,path);assert.equal((await call(path,{body,owner:'different-owner'})).status,409,path);
 }
 for(const path of ['/api/account/settings/export/notes','/api/account/export/manifest/','/api/account/export-extra','/api/account/mcp-server/','/api/account/mcp-connectors/not-an-id/tools',connector+'/unknown',connector+'/call/extra'])assert.equal((await call(path)).status,404,path);
});

test('browser export only includes the captured owner’s reading and conversation data',()=>{
 const entries=new Map([['marginalia:chat-draft:alice:book','my unsent question'],['marginalia:chat-draft:bob:book','other account'],['marginalia-reading-ending-drafts-v1|alice|book|draft|one','my note'],['marginalia-focus-position-v1|alice-other|book','other position'],['marginalia-api-key|alice|provider','secret configuration']]);
 const storage={length:entries.size,key:index=>[...entries.keys()][index],getItem:key=>entries.get(key)};
 entries.set('marginalia-annotation-pending-v1|'+JSON.stringify(['alice','book','v1']),'my unconfirmed annotation');entries.set('marginalia-annotation-pending-v1|'+JSON.stringify(['bob','book','v1']),'other annotation');entries.set('marginalia-reading-ending-context-v1|alice|book','my ending context');storage.length=entries.size;
 const output=exportBrowserRecords({storage,owner:'alice'});assert.equal(output.entries.length,4);assert.doesNotMatch(JSON.stringify(output),/other account|other position|secret configuration|other annotation/);
});

test('account settings exports persist the real profile service and export only the authenticated owner over HTTP',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'account-settings-http-'));
 const server=await createReaderServer({bookPath:path.join(dir,'absent.json'),recordsPath:path.join(dir,'records.json'),sendCode:null,translator:null,chatGenerator:null,companionGenerator:null,speechProvider:null,dialogueGenerator:null,guideGenerator:null,paddleProvider:null,env:{}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
 t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await rm(dir,{recursive:true,force:true});});
 const session=await server.portal.auth.localSession(),headers={Cookie:'marginalia_session='+session.token,'X-Reader-Owner':session.user.id,Origin:base,'Content-Type':'application/json'};
 const api=async(url,body)=>{const response=await fetch(base+url,{headers,...(body===undefined?{}:{method:'POST',body:JSON.stringify(body)})});const result=await response.json();if(!response.ok)throw Object.assign(Error(result.error),{status:response.status});return result;};
 await api('/api/account/profile',{displayName:'Account export test'});
 assert.equal((await api('/api/account/profile')).displayName,'Account export test');assert.equal((await api('/api/auth/session')).user.displayName,'Account export test');
 const book=await server.portal.library.importDocument(session.user,{filename:'export-test.txt',bytes:Buffer.from('A test original for exact export.\n\nA second paragraph.')});
 await server.portal.library.addComment(session.user,book.bookId,{id:'export-note',passageId:book.sections[0].paragraphs[0].id,text:'A private test comment'});
 const settings=await api('/api/account/settings/export');assert.equal(settings.profile.displayName,'Account export test');assert.equal(settings.kind,'leafhour-settings');
 const exported=await exportAccountData({api,includeOriginals:true});assert.equal(exported.kind,'leafhour-personal-data');const entry=exported.library.books.find(row=>row.book.bookId===book.bookId);assert.equal(entry.records.comments[0].text,'A private test comment');assert.equal(Buffer.concat(exported.originals[0].base64Parts.map(value=>Buffer.from(value,'base64'))).toString(),'A test original for exact export.\n\nA second paragraph.');assert.ok(exported.account.libraryChat);assert.ok(exported.account.notebookWorkspace);
 assert.ok(!JSON.stringify(exported).includes(session.token));
 // Personal-data export must work beyond the legacy 100-book backup limit.
 for(let index=0;index<100;index++)await server.portal.library.importDocument(session.user,{filename:'more-'+index+'.txt',bytes:Buffer.from('Distinct original number '+index+'.')});
 assert.equal((await fetch(base+'/api/library/export/manifest',{headers})).status,413);
 const totalBooks=exported.library.books.length+100;
 assert.equal((await api('/api/account/export/manifest')).books.length,totalBooks);
 const large=await exportAccountData({api});assert.equal(large.library.books.length,totalBooks);assert.equal(large.library.kind,'leafhour-account-library');
 for(const url of ['/api/account/profile','/api/account/settings/export','/api/account/export','/api/account/export/manifest','/api/account/mcp-connectors','/api/account/mcp-server']){
  assert.equal((await fetch(base+url)).status,401,url);
  assert.equal((await fetch(base+url,{headers:{...headers,'X-Reader-Owner':'someone-else'}})).status,409,url);
 }
 let valid=true;await assert.rejects(exportAccountData({api:async(...args)=>{const result=await api(...args);valid=false;return result;},assertCurrent:()=>{if(!valid)throw Error('account changed');}}),/account changed/);
});
