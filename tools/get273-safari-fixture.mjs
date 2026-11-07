// Off-device fixture preparation only. No Simulator, input bridge, real auth,
// domain server, provider, proxy, or general-purpose inspection endpoint.
import http from 'node:http';
import {readFile,realpath} from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {readerDocument} from '../server/ui-first-paint.mjs';
import {contentSecurityPolicy} from '../server/content-security.mjs';
import {chapterHash} from '../app/offline-book-codec.mjs';
import {appearanceDefaults,normalizeAppearance} from '../app/reading-preferences.mjs';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const owner='synthetic-touch-owner',bookId='touch-fixture',version='fixture-v1';
const own=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).every(key=>keys.includes(key));
const fail=code=>{throw Object.assign(Error(code),{fixtureCode:code});};
export async function syntheticSafariBook(){
 const original='The 🌱 grows slowly. A second sentence remains.',translation='幼苗慢慢长大。第二句话仍在。';
 const paragraphs=Array.from({length:10},(_,i)=>({id:'fixture-p'+i,kind:'body',original:i===0?original:i===1?'Literal **user Markdown** stays literal. Another sentence.':original.repeat(6),translations:{literal:{text:translation,status:'draft'},interpretive:{text:translation,status:'draft'}},annotationIds:[],termIds:[]}));
 const book={bookId,contentVersion:version,visibility:'private',title:{en:'Synthetic selection fixture',zh:'合成选区夹具'},author:'Test fixture',sourceLanguage:'en',targetLanguage:'zh',source:{format:'txt'},chapters:[{id:'fixture-c',number:1,title:{en:'Test chapter',zh:'测试章节'},sectionNumbers:[1]}],sections:[{number:1,chapterId:'fixture-c',paragraphs}],annotations:[],glossary:[]};
 book.readingCache={schemaVersion:1,snapshotId:'fixture-snapshot',chapters:{'fixture-c':await chapterHash({bookId,contentVersion:version,chapterId:'fixture-c',sections:book.sections})}};
 book.reading={loadedChapters:['fixture-c']};return book;
}
const mime=file=>({'.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp','.woff2':'font/woff2','.woff':'font/woff','.ttf':'font/ttf','.otf':'font/otf','.ogg':'audio/ogg','.mp3':'audio/mpeg'}[path.extname(file)]);

export async function createSafariFixture({buildRoot,template,sourceCommit}){
 if(!/^[a-f0-9]{40}$/.test(sourceCommit||''))fail('provenance');
 const releaseBytes=await readFile(path.join(buildRoot,'release.json')),release=JSON.parse(releaseBytes);
 if(release.sourceCommit!==sourceCommit)fail('provenance');
 const manifestBytes=await readFile(path.join(buildRoot,'offline-resources.json')),manifest=JSON.parse(manifestBytes),assets=new Map(),root=await realpath(buildRoot);
 for(const item of manifest.resources||[]){
  if(!mime(item.url)||!/^\/[A-Za-z0-9_./-]+$/.test(item.url)||item.url.split('/').includes('..')||item.url==='/reading-worker.js')continue;
  const file=await realpath(path.join(root,item.url.slice(1)));if(!file.startsWith(root+path.sep))fail('asset-path');
  const bytes=await readFile(file);if(bytes.length!==item.bytes||sha(bytes)!==item.sha256)fail('asset-hash');assets.set(item.url,{bytes,type:mime(item.url)});
 }
 const book=await syntheticSafariBook(),paragraphs=new Map(book.sections[0].paragraphs.map(p=>[p.id,p])),runId=randomUUID();
 const events=[],violations=[],documents=new Map();let base,position=null,revision=0;
 const violation=code=>{if(violations.length<100)violations.push({code});};
 const report=()=>structuredClone({schemaVersion:1,runId,sourceCommit,fixtureBookId:bookId,nativeAcceptance:'unrun',capabilities:{serviceWorker:'intentionally-unavailable'},events,violations,limitations:['Client observations are not OS-input attestation.','selectionchange.isTrusted alone does not establish native input.','No device, input, storage, credentials or provider inspection.','Offline service-worker operation is not under test.']});
 const config={run:runId,bookId,contentVersion:version,paragraphs:[...paragraphs.values()].map(p=>({id:p.id,original:p.original,literal:p.translations.literal.text,interpretive:p.translations.interpretive.text}))};
 const rawObserver=await readFile(new URL('./get273-safari-observer.js',import.meta.url),'utf8');
 const observer=rawObserver.replace('/*GET273_CONFIG*/null',JSON.stringify(config).replaceAll('<','\\u003c'));
 const html=readerDocument(template,{locale:'en',source:'browser',preference:null}).replace(/<head\b[^>]*>/i,match=>match+'<script src="/qa/observer.js"></script>');
 if(!html.includes('/qa/observer.js')||html.indexOf('/qa/observer.js')>html.indexOf('data-ui-first-paint'))fail('observer-order');
 const cleanQuery=(url,allowed={})=>{for(const [key,value]of url.searchParams){const rule=allowed[key];if(!rule||!rule(value)||url.searchParams.getAll(key).length!==1)fail('query');}};
 // Exact retry edges already present in the frozen reader module graph.
 const staticRetry=new Set(['/reader-account.mjs','/command-palette.mjs','/reader-audio.js','/ui-catalogs/zh-Hans.mjs','/ui-catalogs/zh-Hant.mjs','/ui-catalogs/ja.mjs']);
 const selectionPart=part=>{
  if(!own(part,['passageId','layer','variant','start','end','text'])||Object.keys(part).length!==6||typeof part.passageId!=='string'||!['original','translation'].includes(part.layer)||!['literal','interpretive'].includes(part.variant)||typeof part.text!=='string')return false;
  const p=paragraphs.get(part.passageId),source=part.layer==='original'?p?.original:part.layer==='translation'&&['literal','interpretive'].includes(part.variant)?p?.translations[part.variant].text:null;
  const boundary=n=>!(source?.charCodeAt(n-1)>=0xD800&&source.charCodeAt(n-1)<=0xDBFF&&source.charCodeAt(n)>=0xDC00&&source.charCodeAt(n)<=0xDFFF);
  return typeof source==='string'&&Number.isInteger(part.start)&&Number.isInteger(part.end)&&part.start>=0&&part.end>part.start&&part.end<=source.length&&boundary(part.start)&&boundary(part.end)&&source.slice(part.start,part.end)===part.text;
 };
 function collect(value){
  if(!own(value,['run','documentId','seq','t','trusted','kind','collapsed','parts','event','passageId','pointerType','touches'])||value.run!==runId||!/^[a-f0-9]{32}$/.test(value.documentId||'')||!Number.isInteger(value.seq)||value.seq<0||value.seq>10000||!Number.isFinite(value.t)||value.t<0||value.t>3600000||typeof value.trusted!=='boolean')fail('observation-schema');
  const seen=documents.get(value.documentId)||new Set();if(seen.has(value.seq)||events.length>=2000||documents.size>=8&&!documents.has(value.documentId))fail('observation-bound');
  if(value.kind==='observer-ready'){if(value.seq!==0||Object.keys(value).length!==6)fail('observation-schema');}
  else if(!seen.has(0))fail('observer-not-ready');
  else if(value.kind==='selection'||value.kind==='app-selection'){
   if(Object.keys(value).length!==8||typeof value.collapsed!=='boolean'||!Array.isArray(value.parts)||value.parts.length>10||!value.parts.every(selectionPart)||value.collapsed!==!value.parts.length)fail('selection-schema');
  }else if(value.kind==='input'){
   if(!['pointerdown','pointerup','pointercancel','touchstart','touchmove','touchend','touchcancel'].includes(value.event)||!paragraphs.has(value.passageId)||!['touch','mouse','pen','unknown'].includes(value.pointerType)||!Number.isInteger(value.touches)||value.touches<0||value.touches>5||Object.keys(value).length!==10)fail('input-schema');
  }else if(value.kind!=='reader-ready'||Object.keys(value).length!==6)fail('observation-schema');
  seen.add(value.seq);documents.set(value.documentId,seen);events.push(structuredClone(value));
 }
 async function jsonBody(req){
  if(req.headers['content-type']?.split(';')[0]!=='application/json')fail('content-type');let length=0,chunks=[];
  for await(const chunk of req){length+=chunk.length;if(length>16384)fail('body-bound');chunks.push(chunk);}
  try{return JSON.parse(Buffer.concat(chunks).toString());}catch{fail('json');}
 }
 function exactPayload(value,keys){if(!own(value,keys))fail('payload');return value;}
 const prefix='/api/library/books/'+bookId;
 async function api(req,url){
  const id=value=>paragraphs.has(value),versionOf=value=>value===version;
  const readQueries={passageId:id,chapterId:v=>v==='fixture-c',contentVersion:versionOf};
  if(req.method==='GET'){
   const route=url.pathname;
   if([prefix+'/reading',prefix+'/reading-manifest'].includes(route)){cleanQuery(url,readQueries);return book;}
   if(route===prefix+'/records'){cleanQuery(url);return {bookId,contentVersion:version,comments:[],questions:[],highlights:[],position};}
   if(route===prefix+'/chat'){cleanQuery(url,{passageId:id});return {bookId,available:true,contentVersion:version,scope:{mode:'book',revision:0},context:{passageId:url.searchParams.get('passageId')||'fixture-p0',original:paragraphs.get(url.searchParams.get('passageId')||'fixture-p0').original},turns:[]};}
   if(route===prefix+'/annotations'){cleanQuery(url,{passageId:id});return {annotations:[],highlights:[]};}
   cleanQuery(url);
   const values=new Map([
    ['/api/auth/session',{user:{id:owner,email:'fixture@example.invalid'}}],['/api/account/ui-preferences',{revision:0,updatedAt:null,uiLocale:null}],['/api/account/observability',{enabled:false}],
    ['/api/library/books',{books:[{bookId,title:book.title,contentVersion:version}]}],['/api/library/ingestion',{tasks:[],jobs:[]}],
    [prefix+'/companion',{enabled:false,revision:1,contentVersion:version}],[prefix+'/experiences',{available:false,experiences:[]}],[prefix+'/original/info',{available:false}],[prefix+'/audio/capabilities',{available:false}],[prefix+'/audio/preferences',{enabled:false}]
   ]);if(values.has(route))return values.get(route);fail('api-not-allowed');
  }
  if(req.method!=='POST')fail('method');cleanQuery(url);
  const value=await jsonBody(req);
  if(url.pathname==='/api/library/reading-guide'){
   exactPayload(value,['bookId','contentVersion','sourceKind','locale','action']);if(value.bookId!==bookId||value.contentVersion!==version||value.action!=='view'||!['en','zh-Hans','zh-Hant','ja'].includes(value.locale)||value.sourceKind!=='cloud')fail('generation-denied');return {state:'unknown'};
  }
  if(url.pathname==='/api/auth/session/activity'){exactPayload(value,['client']);if(value.client!=='web')fail('payload');return {ok:true};}
  if(url.pathname==='/api/library/daily-reading/presence'){exactPayload(value,['tabId','active','sequence']);if(!/^[a-f0-9-]{36}$/.test(value.tabId||'')||typeof value.active!=='boolean'||!Number.isInteger(value.sequence)||value.sequence<1)fail('payload');return {ok:true};}
  if(url.pathname===prefix+'/progress'){
   exactPayload(value,[...Object.keys(appearanceDefaults),'mode','variant','chapterId','passageId','offset','withinParagraph','contentVersion','baseRevision','observedAt','chapterLabel']);
   if(!['en','zh','parallel'].includes(value.mode)||!['literal','interpretive'].includes(value.variant))fail('progress');
   if(value.chapterId!=='fixture-c'||!id(value.passageId)||value.contentVersion!==version||value.baseRevision!==revision||!Number.isFinite(value.offset)||Math.abs(value.offset)>4000||value.withinParagraph!==undefined&&(!Number.isFinite(value.withinParagraph)||value.withinParagraph<0||value.withinParagraph>1)||value.observedAt!==undefined&&!/^\d{4}-\d\d-\d\dT[\d:.]+Z$/.test(value.observedAt)||value.chapterLabel!==undefined&&(typeof value.chapterLabel!=='string'||value.chapterLabel.length>160))fail('progress');
   const appearance=normalizeAppearance(value);for(const key of Object.keys(appearanceDefaults))if(Object.hasOwn(value,key)&&JSON.stringify(value[key])!==JSON.stringify(appearance[key]))fail('appearance');
   position={...appearance,mode:value.mode,variant:value.variant,chapterId:'fixture-c',passageId:value.passageId,offset:value.offset,...(value.withinParagraph===undefined?{}:{withinParagraph:value.withinParagraph}),contentVersion:version,...(value.observedAt?{observedAt:value.observedAt}:{}),revision:++revision,updatedAt:new Date().toISOString()};return position;
  }
  fail('api-not-allowed');
 }
 const server=http.createServer(async(req,res)=>{
  const send=(status,value,type='application/json')=>{res.writeHead(status,{'Content-Type':type+'; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':contentSecurityPolicy('/read',{}).replace("img-src 'self' data: https: blob:","img-src 'self' data: blob:")+"; form-action 'none'; frame-src 'none'"});res.end(type==='application/json'?JSON.stringify(value):value);};
  try{
   if(req.headers.host!==new URL(base).host||req.headers.origin&&req.headers.origin!==base||req.method==='POST'&&req.headers.origin!==base||req.headers['sec-fetch-site']==='cross-site')fail('transport');
   if(req.headers['x-reader-owner']&&req.headers['x-reader-owner']!==owner)fail('owner');
   if(!req.url.startsWith('/')||req.url.startsWith('//')||req.url.includes('%')||req.url.includes('\\'))fail('path');
   const url=new URL(req.url,base);
   if(url.pathname.startsWith('/api/'))return send(200,await api(req,url));
   cleanQuery(url,url.pathname==='/read'?{book:v=>v===bookId,ui:v=>v==='en'}:assets.has(url.pathname)&&staticRetry.has(url.pathname)?{retry:v=>v==='1'}:{});
   if(req.method==='POST'&&url.pathname==='/qa/events'){collect(await jsonBody(req));res.writeHead(204,{'Cache-Control':'no-store'});return res.end();}
   if(req.method!=='GET')fail('method');
   if(url.pathname==='/read')return send(200,html,'text/html');
   if(url.pathname==='/qa/observer.js')return send(200,observer,'text/javascript');
   if(url.pathname==='/qa/evidence')return send(200,report());
   if(url.pathname==='/qa/health')return send(200,{fixtureBookId:bookId,runId,sourceCommit,nativeAcceptance:'unrun'});
   if(url.pathname==='/favicon.ico'){res.writeHead(204);return res.end();}
   if(url.pathname==='/reading-worker.js')return send(410,{error:'fixture-service-worker-unavailable'});
   const asset=assets.get(url.pathname);if(asset)return send(200,asset.bytes,asset.type);
   fail('not-allowed');
  }catch(error){const code=error.fixtureCode||'fixture-internal';violation(code);if(!res.headersSent)send(403,{error:code});else res.end();}
 });
 server.requestTimeout=5000;server.headersTimeout=5000;
 return {server,book,runId,report,provenance:{sourceCommit,releaseSha256:sha(releaseBytes),manifestSha256:sha(manifestBytes),templateSha256:sha(template),servedHtmlSha256:sha(html),observerSha256:sha(observer)},assetHashes:Object.fromEntries([...assets].map(([url,v])=>[url,sha(v.bytes)])),
  async listen(){if(base)throw Error('already-listening');await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});base='http://127.0.0.1:'+server.address().port;return base;},
  async close(){server.closeAllConnections();if(server.listening)await new Promise(resolve=>server.close(resolve));}
 };
}
