import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const execute=promisify(execFile),script=new URL('../tools/smoke-release.mjs',import.meta.url).href;
// Run the actual production smoke entry. Network is synthetic and stops at
// the next page check, so no deployed data, credentials or model are involved.
for(const [endpoint,label] of [['ui-preferences','UI preference'],['preference-memory','preference memory']])
for(const [name,status,cache,expected,continues] of [
 ['authentication boundary',401,'private, no-store','after-ui-boundary',true],
 ['missing hosted route',404,'private, no-store',`Anonymous ${label} access did not require authentication`,false],
 ['cacheable private response',401,'public, max-age=600',`${label[0].toUpperCase()+label.slice(1)} response must not be cached`,false],
 ['misleading cache directive',401,'public, max-age=600, x-no-store',`${label[0].toUpperCase()+label.slice(1)} response must not be cached`,false],
 ['case-insensitive cache directive',401,'private, NO-STORE','after-ui-boundary',true]
])test('production smoke detects the '+label+' '+name,async()=>{
 const source=`let called=false,continued=false;
 globalThis.fetch=async input=>{const url=new URL(input);if(url.origin!=='https://smoke.synthetic.invalid')throw Error('unexpected network origin');if(url.pathname===${JSON.stringify('/api/account/'+endpoint)}){called=true;return new Response('{}',{status:${status},headers:{'Cache-Control':${JSON.stringify(cache)}}});}if(['/api/account/ui-preferences','/api/account/preference-memory'].includes(url.pathname))return new Response('{}',{status:401,headers:{'Cache-Control':'private, no-store'}});if(url.pathname==='/api/library/books/gutenberg-alice/companion')return new Response('{}',{status:401});if(url.pathname==='/api/mcp/consent-script')return new Response("form.addEventListener('submit',()=>{});",{headers:{'Content-Type':'text/javascript'}});if(url.pathname==='/'){continued=true;throw Error('after-ui-boundary');}return new Response('export {};',{headers:{'Content-Type':'application/javascript'}});};
 try{await import(${JSON.stringify(script)});throw Error('unexpected full completion');}catch(error){console.log(JSON.stringify({error:error.message,called,continued}));}`;
 const {stdout}=await execute(process.execPath,['--input-type=module','-e',source],{env:{PATH:process.env.PATH,READER_URL:'https://smoke.synthetic.invalid'},timeout:10000,maxBuffer:1024*1024});
 const result=JSON.parse(stdout.trim());assert.equal(result.called,true,'the real smoke script must probe the deployed account API');assert.equal(result.error,expected);assert.equal(result.continued,continues);
});

for(const [name,status,type,body,expected,continues] of [
 ['working JavaScript',200,'text/javascript',"form.addEventListener('submit',()=>{});",'after-mcp-boundary',true],
 ['missing route',404,'application/json','{}','MCP consent script is unavailable or invalid',false],
 ['redirect before handler',308,'text/plain','Redirecting','MCP consent script is unavailable or invalid',false],
 ['HTML fallback',200,'text/html',"form.addEventListener('submit',()=>{});",'MCP consent script is unavailable or invalid',false],
 ['wrong JavaScript body',200,'text/javascript','export {};','MCP consent script is unavailable or invalid',false]
])test('production smoke detects MCP consent '+name,async()=>{
 const source=`let called=false,continued=false;
 globalThis.fetch=async(input,options)=>{const url=new URL(input);if(url.origin!=='https://smoke.synthetic.invalid')throw Error('unexpected network origin');if(url.pathname==='/api/mcp/consent-script'){called=true;if(options.redirect!=='manual')throw Error('redirect was not checked');return new Response(${JSON.stringify(body)},{status:${status},headers:{'Content-Type':${JSON.stringify(type)}}});}if(['/api/account/ui-preferences','/api/account/preference-memory'].includes(url.pathname))return new Response('{}',{status:401,headers:{'Cache-Control':'private, no-store'}});if(url.pathname==='/api/library/books/gutenberg-alice/companion')return new Response('{}',{status:401});if(url.pathname==='/'){continued=true;throw Error('after-mcp-boundary');}return new Response('export {};',{headers:{'Content-Type':'application/javascript'}});};
 try{await import(${JSON.stringify(script)});throw Error('unexpected full completion');}catch(error){console.log(JSON.stringify({error:error.message,called,continued}));}`;
 const {stdout}=await execute(process.execPath,['--input-type=module','-e',source],{env:{PATH:process.env.PATH,READER_URL:'https://smoke.synthetic.invalid'},timeout:10000,maxBuffer:1024*1024});
 const result=JSON.parse(stdout.trim());assert.equal(result.called,true,'the actual smoke script must check the hosted consent asset');assert.equal(result.error,expected);assert.equal(result.continued,continues);
});
