import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {contentSecurityPolicy} from '../server/content-security.mjs';
import {createUiEntryHandler} from '../api/ui-entry.js';

const env={READER_PUBLIC_ORIGIN:'https://reader.example',SUPABASE_URL:'https://private-storage.example/'};
const directive=(policy,name)=>policy.split(';').map(part=>part.trim()).find(part=>part.startsWith(name+' '));
test('upload surfaces allow exactly the configured private storage origin without relaxing scripts or other pages',()=>{
 for(const surface of ['/','/library','/read','/_ui/library','/_ui/read']){const policy=contentSecurityPolicy(surface,env);assert.equal(directive(policy,'connect-src'),"connect-src 'self' https://private-storage.example");assert.equal(directive(policy,'script-src'),directive(contentSecurityPolicy(surface,{}),'script-src'));assert.ok(!policy.includes('https:;'));}
 for(const surface of ['/privacy','/billing','/api/library/upload'])assert.equal(directive(contentSecurityPolicy(surface,env),'connect-src'),"connect-src 'self'");
});
test('missing or unsafe storage configuration keeps the same-origin connection policy',()=>{
 for(const value of [undefined,'http://storage.example','https://user:password@storage.example','https://*.example','https://storage.example/path','https://storage.example?token=fixture','https://storage.example/#fragment','https://storage.example/; connect-src *'])assert.equal(directive(contentSecurityPolicy('/library',{SUPABASE_URL:value}),'connect-src'),"connect-src 'self'");
});
test('the actual hosted UI handler binds its CSP to its injected deployment environment',async t=>{
 const handler=createUiEntryHandler({env,storeFactory:()=>({}),authFactory:()=>({userFor:async()=>null}),preferencesFactory:()=>({get:async()=>null}),readTemplate:async()=>'<html lang="en"><head></head><body>Test</body></html>'});const server=createServer((req,res)=>handler(req,res));await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));const base='http://127.0.0.1:'+server.address().port;
 for(const route of ['/library?ui=en','/read?ui=en']){const response=await fetch(base+route);assert.equal(response.status,200);assert.equal(directive(response.headers.get('content-security-policy'),'connect-src'),"connect-src 'self' https://private-storage.example");await response.text();}
});
