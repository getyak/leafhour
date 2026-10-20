// Controlled same-book browser/storage benchmark. Uses private fixture data and
// loopback-only isolated storage; it never calls an OCR or language provider.
// Publication replay reuses prior verified source text, not a new OCR result.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import http from 'node:http';
const [sourceRoot,fixturePath,label,portText]=process.argv.slice(2),port=Number(portText||8396);
if(!sourceRoot||!fixturePath||!label)throw Error('source root, private fixture and run label required');
const fixture=JSON.parse(await readFile(fixturePath,'utf8')),book=JSON.parse(await readFile(fixture.bookFile,'utf8'));
if(typeof fixture.email!=='string'||!fixture.ownerId||!book.bookId)throw Error('Designated account fixture required');
const {createReaderServer}=await import(pathToFileURL(path.join(sourceRoot,'server/server.mjs')));
const {readingView,readingChapter}=await import(pathToFileURL(path.join(sourceRoot,'server/reading-view.mjs')));
const rows=new Map(),blobs=new Map(),layouts=new Map(),events=[],targets=new Map(),requests=[],locks=new Map();
const clone=v=>structuredClone(v),sum=b=>createHash('sha256').update(b).digest('hex');
const store={
 read:async(k,f)=>{const value=clone(rows.get(k)??f);events.push({kind:'read',key:k,bytes:Buffer.byteLength(JSON.stringify(value))});return value;},
 mutate:async(k,f,fn)=>{const prior=locks.get(k)||Promise.resolve(),work=prior.catch(()=>{}).then(async()=>{const value=clone(rows.get(k)??f),result=await fn(value);rows.set(k,clone(value));events.push({kind:'write',key:k,bytes:Buffer.byteLength(JSON.stringify(value))});return result;});locks.set(k,work);try{return await work;}finally{if(locks.get(k)===work)locks.delete(k);}},
 putBlob:async(k,b)=>{blobs.set(k,Buffer.from(b));events.push({kind:'blobWrite',key:k,bytes:b.length});return {parts:[{target:k,size:b.length,sha256:sum(b)}]};},
 adoptBlob:async(k,parts,meta)=>{layouts.set(k,{parts,meta});events.push({kind:'adopt',key:k,bytes:0});},
 blob:async k=>{if(layouts.has(k)){const l=layouts.get(k),parts=await Promise.all(l.parts.map(p=>store.blob(p.target)));return Buffer.concat(parts);}const b=blobs.get(k);if(!b)throw Object.assign(Error('Missing benchmark blob'),{status:404});events.push({kind:'blobRead',key:k,bytes:b.length});return Buffer.from(b);},
 blobInfo:async k=>layouts.has(k)?{size:layouts.get(k).meta.size}:blobs.has(k)?{size:blobs.get(k).length}:null,
 uploadedBlobInfo:async k=>blobs.has(k)?{size:blobs.get(k).length}:null,
 uploadedBlob:async k=>store.blob(k),
 signedUpload:async k=>{const token=randomUUID();targets.set(token,k);return {url:'http://127.0.0.1:'+port+'/__bench-storage/object/'+token,method:'PUT',headers:{'Content-Type':'application/octet-stream'}};}
};
const user={id:fixture.ownerId,email:fixture.email,kind:'email'},dataRoot=path.join(path.dirname(fixturePath),'local-'+label);
await mkdir(dataRoot,{recursive:true,mode:0o700});
const server=await createReaderServer({recordsPath:path.join(dataRoot,'legacy-records.json'),portalDataDir:path.join(dataRoot,'portal'),dataStore:store,authService:{userFor:async()=>user,capabilities:async()=>({password:false,providers:{}})},allowLocal:false,translator:null,chatGenerator:null,companionGenerator:null,introductionGenerator:null,speechProvider:null,dialogueGenerator:null,guideGenerator:null,paddleProvider:null,env:{}});
const library=server.portal.library;
const records={kind:'marginalia-personal-records',schemaVersion:3,bookId:book.bookId,contentVersion:book.contentVersion,comments:[],questions:[],highlights:[],readingSessions:[],readingMilestones:[],position:null};
await library.restoreLibrary(user,{kind:'marginalia-library',schemaVersion:1,books:[{book,records}]});
await new Promise(resolve=>server.listen(port,'127.0.0.1',resolve));
server.prependListener('request',req=>{if(req.method==='POST'&&req.url.includes('/pdf-upload/'))requests.push({url:req.url,bytes:Number(req.headers['content-length']||0),at:Date.now()});});
const handleStorage=async(req,res)=>{
 res.setHeader('Access-Control-Allow-Origin','http://127.0.0.1:'+port);res.setHeader('Access-Control-Allow-Methods','PUT,POST,GET,OPTIONS');res.setHeader('Access-Control-Allow-Headers','Content-Type');
 if(req.method==='OPTIONS'){res.statusCode=204;res.end();return;}
 if(req.url==='/metrics'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({applicationRequests:requests.length,applicationRequestBytes:requests.reduce((n,r)=>n+r.bytes,0),binaryPutBytes:events.filter(e=>e.kind==='directPut').reduce((n,r)=>n+r.bytes,0),blobWrites:events.filter(e=>e.kind==='blobWrite').reduce((n,r)=>n+r.bytes,0),blobReads:events.filter(e=>e.kind==='blobRead').reduce((n,r)=>n+r.bytes,0)}));return;}
 if(req.url==='/reset'&&req.method==='POST'){events.length=0;requests.length=0;res.end('{}');return;}
 if(req.url==='/publish'&&req.method==='POST'){
  try{
   await server.portal.ingestionRunner.close();
   const [key,job]=[...rows.entries()].find(([key,row])=>key.startsWith('ingestion/')&&row?.sourceHash===book.source.sha256&&Array.isArray(row.batches))||[];
   if(!job)throw Error('No completed original upload to replay');
   const all=book.sections.flatMap(s=>s.paragraphs);
   for(let i=0;i<job.batches.length;i++){
    const batch=job.batches[i],normalized=Array.from({length:batch.count},(_,n)=>{const page=batch.start+n,blocks=all.filter(p=>p.source.pdfPage===page).map(p=>({id:p.id,text:p.original,type:p.source.type||'text',bbox:p.source.bbox||null}));return {page,blocks,text:blocks.map(p=>p.text).join('\n\n'),blank:!blocks.length};});
    await store.putBlob(key+'/result-'+(batch.storageKey??String(i)),Buffer.from(JSON.stringify({normalized})));
   }
   await store.mutate(key,{},row=>{row.state='running';row.lease=null;for(const b of row.batches)b.state='done';});events.length=0;
   const {createBookIngestion}=await import(pathToFileURL(path.join(sourceRoot,'server/book-ingestion.mjs'))),svc=createBookIngestion({store,library,provider:null});
   const start=performance.now(),done=await svc.advance(user,job.id),receipt={done:done.state==='done',elapsedMs:Math.round(performance.now()-start),sourceReadBytes:events.filter(e=>e.kind==='blobRead'&&(e.key.startsWith('pdf-upload/')||e.key.endsWith('/source'))).reduce((n,e)=>n+e.bytes,0),originalWriteBytes:events.filter(e=>e.kind==='blobWrite'&&e.key.includes('/originals/')).reduce((n,e)=>n+e.bytes,0)};
   const original=await library.getOriginal(user,done.bookId);receipt.originalBytes=original.bytes.length;receipt.hashMatches=original.sha256===book.source.sha256&&sum(original.bytes)===book.source.sha256;
   await writeFile(path.join(path.dirname(fixturePath),label+'-publication.json'),JSON.stringify(receipt,null,2));res.setHeader('Content-Type','application/json');res.end(JSON.stringify(receipt));
  }catch(error){res.statusCode=500;res.end(JSON.stringify({error:error.message}));}return;
 }
 const token=req.url?.split('/').at(-1),key=targets.get(token);
 if(req.method!=='PUT'||!key||blobs.has(key)){res.statusCode=403;res.end();return;}
 const chunks=[];let size=0;for await(const b of req){size+=b.length;if(size>2*1024*1024){res.statusCode=413;res.end();return;}chunks.push(b);}blobs.set(key,Buffer.concat(chunks));events.push({kind:'directPut',key,bytes:size});targets.delete(token);res.end('{}');
};
const originalHandlers=server.listeners('request');server.removeAllListeners('request');server.on('request',(req,res)=>{if(req.url.startsWith('/__bench-storage/')){req.url=req.url.slice('/__bench-storage'.length);void handleStorage(req,res);}else for(const handler of originalHandlers)handler(req,res);});
const transport=http.createServer(handleStorage);
await new Promise(resolve=>transport.listen(port+10,'127.0.0.1',resolve));
const report={label,sourceCommit:process.env.LEAFHOUR_BENCH_SOURCE_COMMIT||null,fixture:{sourceHash:book.source.sha256,chapters:book.chapters.length,paragraphs:book.sections.reduce((n,s)=>n+s.paragraphs.length,0)},reads:[]};
const selected=[book.chapters[0],book.chapters[Math.floor(book.chapters.length/2)],book.chapters.at(-1)];
for(const chapter of selected){
 for(let n=0;n<3;n++){
  events.length=0;const start=performance.now(),route='/api/library/books/'+book.bookId+'/chapters/'+chapter.id+'?contentVersion='+book.contentVersion;
  const r=await fetch('http://127.0.0.1:'+port+route,{headers:{'X-Reader-Owner':user.id}}),text=await r.text();if(!r.ok)throw Error('Reading failed '+r.status+' '+text);
  const payload=JSON.parse(text),expected=readingChapter(book,chapter.id,book.contentVersion);
  if(JSON.stringify(payload)!==JSON.stringify(expected))throw Error('Chapter payload drift');
  const reads=events.filter(e=>e.kind==='read');report.reads.push({chapter:chapter.id,run:n+1,elapsedMs:Math.round((performance.now()-start)*100)/100,responseBytes:Buffer.byteLength(text),storeReadBytes:reads.reduce((v,e)=>v+e.bytes,0),fullBookReads:reads.filter(e=>e.key.includes('/books/')).length,readCount:reads.length});
 }
}
await writeFile(path.join(path.dirname(fixturePath),label+'-storage.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify({ready:true,port,label,chapterSamples:report.reads.map(r=>({chapter:r.chapter,elapsedMs:r.elapsedMs,storeReadBytes:r.storeReadBytes,fullBookReads:r.fullBookReads}))}));
process.on('SIGTERM',()=>{server.close();transport.close();});process.on('SIGINT',()=>{server.close();transport.close();});
