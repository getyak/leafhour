import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import { routeOf } from '../api/[...path].js';

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

test('hosted file inclusion fits the deployment schema and preserves required source and PDF assets',async()=>{
 const {minimatch}=await import('minimatch');
 const config=JSON.parse(await readFile(new URL('../vercel.json',import.meta.url),'utf8'));
 const pattern=config.functions['api/*.js'].includeFiles;
 assert.ok(pattern.length<=256,'Vercel rejects includeFiles longer than 256 characters before running the build');
 for(const file of ['catalog/people/manifest.json','server/observability.mjs','deploy/hosted-store.mjs','app/observability-bridge.mjs','harness/person-generator.mjs','skills/leafhour-author-portrait/SKILL.md','.reader-runtime/manifest.json','node_modules/pdfjs-dist/wasm/openjpeg.wasm','node_modules/pdfjs-dist/cmaps/78-EUC-H.bcmap','node_modules/pdfjs-dist/standard_fonts/FoxitSans.pfb','node_modules/@napi-rs/canvas/index.js','node_modules/@napi-rs/canvas-linux-x64-gnu/skia.linux-x64-gnu.node'])assert.equal(minimatch(file,pattern,{dot:true}),true,'Required packaged file '+file);
 for(const file of ['local/private-book.json','.env','node_modules/pdfjs-dist/unrelated.js'])assert.equal(minimatch(file,pattern,{dot:true}),false,'Unrelated private or unneeded file '+file);
});
