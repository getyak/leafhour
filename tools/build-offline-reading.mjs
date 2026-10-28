import {readFile,writeFile,lstat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {parse} from 'acorn';
import {releaseFiles} from './release-policy.mjs';
import {contentSecurityPolicy} from '../server/content-security.mjs';

const origin='https://leafhour.invalid',hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const publicExtension=/\.(?:m?js|css|svg|woff2|png|jpe?g|webp)$/i;
const generatedReader=/^reader-web\/(?:reader-([a-f0-9]{16})\.js|style-([a-f0-9]{16})\.css)$/;

// Only literal module edges and literal stylesheet/image references are read.
// A file being present in dist is never enough to authorize it for caching.
function references(source,url){
 const values=[];
 if(/\.m?js$/.test(url)){
  const visit=node=>{
   if(!node||typeof node!=='object')return;
   if(['ImportDeclaration','ExportNamedDeclaration','ExportAllDeclaration'].includes(node.type)&&node.source)values.push(node.source.value);
   if(node.type==='ImportExpression'&&typeof node.source?.value==='string')values.push(node.source.value);
   if(node.type==='Literal'&&typeof node.value==='string'&&/^(?:\/|\.\/|\.\.\/)[^\s?#]*\.(?:css|svg|png|jpe?g|webp)$/.test(node.value))values.push(node.value);
   for(const value of Object.values(node))if(Array.isArray(value))value.forEach(visit);else if(value&&typeof value==='object')visit(value);
  };
  visit(parse(source,{ecmaVersion:'latest',sourceType:'module'}));
 }else if(/\.css$/.test(url)){
  for(const match of source.matchAll(/url\(\s*["']?([^\s"'()]+)["']?\s*\)/g))values.push(match[1]);
  for(const match of source.matchAll(/@import\s*["']([^"']+)["']/g))values.push(match[1]);
 }else if(/\.html$/.test(url)){
  for(const match of source.matchAll(/<(?:script|link)\b[^>]*\b(?:src|href)=["']([^"']+)["'][^>]*>/g))values.push(match[1]);
 }
 return values.filter(value=>typeof value==='string').map(value=>new URL(value,new URL(url,origin))).filter(value=>value.origin===origin&&publicExtension.test(value.pathname)).map(value=>value.pathname);
}

export async function buildOfflineReading({root,outputDir,readerHtml,readerFiles=[]}){
 const allowed=new Set(await releaseFiles(root));
 for(const file of ['app/reading-worker.js','app/offline.html','app/offline-shelf.mjs'])if(!allowed.has(file))throw Error('Non-public offline resource: '+file);
 const generated=new Set(readerFiles);
 for(const file of generated){
  const match=generatedReader.exec(file);if(!match&&file!=='reader-quiet.css')throw Error('Unexpected generated reader resource: '+file);
  if(match&&!hash(await readFile(path.join(outputDir,file))).startsWith(match[1]||match[2]))throw Error('Reader resource digest does not match filename: '+file);
 }
 // This shell is authored at build time, before cookies or account state exist.
 // The online first-paint handoff must not retry itself when the network is absent.
 const shell=readerHtml.replace(/<script\b(?![^>]*\btype=["']module["'])[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<html\b/,'<html data-leafhour-offline-shell');
 await writeFile(path.join(outputDir,'offline-reader.html'),shell);
 const queue=['/offline-reader.html','/offline.html','/offline-shelf.mjs','/ui-locale.mjs',...['en','zh-Hans','zh-Hant','ja'].map(locale=>'/ui-catalogs/'+locale+'.mjs'),...readerFiles.map(file=>'/'+file)],seen=new Set(),resources=[];
 while(queue.length){
  const url=queue.shift();if(seen.has(url))continue;seen.add(url);
  const relative=url.slice(1);
  if(url!=='/offline-reader.html'&&!generated.has(relative)&&!allowed.has('app/'+relative))throw Error('Non-public offline resource: '+url);
  if(url.includes('..')||url.startsWith('/api/')||(!publicExtension.test(url)&&!['/offline-reader.html','/offline.html'].includes(url)))throw Error('Unsafe offline resource: '+url);
  const file=path.join(outputDir,relative),info=await lstat(file);if(!info.isFile()||info.isSymbolicLink())throw Error('Offline resource must be a regular file: '+url);
  const bytes=await readFile(file);resources.push({url,bytes:bytes.length,sha256:hash(bytes)});
  if(/\.(?:m?js|css|html)$/.test(url))queue.push(...references(bytes.toString('utf8'),url));
 }
 resources.sort((a,b)=>a.url.localeCompare(b.url,'en'));
 const template=await readFile(path.join(root,'app/reading-worker.js'),'utf8');
 const descriptor={readerShell:'/offline-reader.html',offlineShelf:'/offline.html',readerEntries:readerFiles.filter(file=>/^reader-web\/reader-/.test(file)).map(file=>'/'+file),readerPolicy:contentSecurityPolicy('/read'),resources};
 const version=hash(JSON.stringify(descriptor)+'\n'+template),manifest={version,...descriptor};
 if(!template.includes('null/* LEAFHOUR_OFFLINE_RELEASE */'))throw Error('Offline worker release marker is missing');
 await writeFile(path.join(outputDir,'offline-resources.json'),JSON.stringify(manifest)+'\n');
 await writeFile(path.join(outputDir,'reading-worker.js'),template.replace('null/* LEAFHOUR_OFFLINE_RELEASE */',JSON.stringify(manifest)));
 return {version,resources:resources.length,bytes:resources.reduce((sum,entry)=>sum+entry.bytes,0),files:['offline-reader.html','offline-resources.json','reading-worker.js']};
}
