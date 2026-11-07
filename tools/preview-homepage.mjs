// Local production-build audit surface. No library API, auth or account data.
// Build first: npm run build:vercel; node tools/preview-homepage.mjs
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {gzipSync} from 'node:zlib';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {contentSecurityPolicy} from '../server/content-security.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../dist');
const types={'.html':'text/html','.css':'text/css','.mjs':'text/javascript','.js':'text/javascript','.json':'application/json','.svg':'image/svg+xml','.webp':'image/webp','.woff2':'font/woff2','.png':'image/png','.txt':'text/plain'};
const server=http.createServer(async(req,res)=>{
 const url=new URL(req.url,'http://127.0.0.1:8347');
 try{
  if(!['GET','HEAD'].includes(req.method)||url.pathname.startsWith('/api/'))throw Error('Not served');
  let name=decodeURIComponent(url.pathname);
  if(name==='/')name='/en/index.html';
  else if(['/en','/zh-hans','/zh-hant','/ja'].includes(name))name+='/index.html';
  const file=path.resolve(root,'.'+name);
  if(!file.startsWith(root+path.sep))throw Error('Outside build');
  let bytes=await readFile(file);const type=types[path.extname(file)]||'application/octet-stream';
  res.setHeader('Content-Type',type);res.setHeader('Content-Security-Policy',contentSecurityPolicy(url.pathname,{}));res.setHeader('Vary','Accept-Encoding');
  if(/(?:text\/|json|svg)/.test(type)&&/\bgzip\b/.test(req.headers['accept-encoding']||'')){bytes=gzipSync(bytes);res.setHeader('Content-Encoding','gzip');}
  res.setHeader('Content-Length',bytes.length);res.end(req.method==='HEAD'?undefined:bytes);
 }catch{res.writeHead(404,{'Content-Type':'text/plain'});res.end('Not served by the public build preview.');}
});
server.listen(8347,'127.0.0.1',()=>console.log('Public build preview: http://127.0.0.1:8347/zh-hans (gzip, no private APIs)'));
