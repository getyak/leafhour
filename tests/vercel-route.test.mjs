import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import { routeOf } from '../api/[...path].js';

test('hosted function inclusion fits the platform configuration limit',async()=>{
 const config=JSON.parse(await readFile(new URL('../vercel.json',import.meta.url),'utf8'));
 // Vercel rejects this configuration before starting the build (maxLength 256).
 for(const [name,settings]of Object.entries(config.functions||{})){
  if(settings.includeFiles!==undefined)assert.ok(typeof settings.includeFiles==='string'&&settings.includeFiles.length<=256,`${name} includeFiles exceeds the 256-character platform limit`);
 }
});

test('Vercel route uses catch-all query when available', () => {
  assert.equal(routeOf({ query: { path: ['records', 'export'] }, url: '/api/ignored' }), '/api/records/export');
});

test('Vercel route falls back to the request URL', () => {
  assert.equal(routeOf({ query: {}, url: '/api/book?source=reader' }), '/api/book');
});

test('gift and local-preview rewrites resolve the letter page with Vercel clean URLs',async()=>{
  const config=JSON.parse(await readFile(new URL('../vercel.json',import.meta.url),'utf8'));
  for(const source of ['/gift/:token','/gift-preview']){
  const gift=config.rewrites.find(rule=>rule.source===source);assert.ok(gift,'Gift links and preview need an explicit hosted page');
  const destination=new URL(gift.destination,'https://reader.example.com').pathname;
  // Vercel removes HTML suffixes before rewrite destinations are resolved.
  // https://vercel.com/docs/project-configuration/vercel-json#rewrites
  assert.equal(config.cleanUrls,true);assert.equal(path.extname(destination),'','A clean-URL rewrite must omit .html');
  const page=await readFile(new URL('../app'+destination+'.html',import.meta.url),'utf8');
  for(const marker of ['src="/book-gift.mjs"','id="gift-open"','id="gift-error"'])assert.ok(page.includes(marker),'Rewrite must resolve the gift letter page');
  }
  const preview=config.headers.find(rule=>rule.source==='/gift-preview');
  assert.equal(preview.headers.find(header=>header.key==='Content-Security-Policy').value,"frame-ancestors 'self'");
});
test('hosted function outlives the conversation lease with room for cleanup and durable save',async()=>{
 const config=JSON.parse(await readFile(new URL('../vercel.json',import.meta.url),'utf8'));
 assert.ok(config.functions['api/*.js'].maxDuration>=120,'90 second conversation lease requires cleanup and save time');
});

test('public OAuth discovery paths route to the remote MCP metadata handler',async()=>{
 const config=JSON.parse(await readFile(new URL('../vercel.json',import.meta.url),'utf8'));
 for(const [source,route]of [['/.well-known/oauth-protected-resource','mcp/metadata'],['/.well-known/oauth-protected-resource/api/mcp','mcp/metadata'],['/.well-known/oauth-authorization-server','mcp/authorization-server']]){
  const rewrite=config.rewrites.find(row=>row.source===source);assert.ok(rewrite,'Missing OAuth discovery rewrite: '+source);
  assert.equal(rewrite.destination,'/api/service?path='+route);
  assert.equal(routeOf({query:{path:route},url:source}),'/api/'+route);
 }
});
