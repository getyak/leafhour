// Deliberately only an off-device preflight. It always closes its HTTP server.
// Live Safari serving belongs to the later root-coordinated lifecycle runner.
import {readFile,writeFile,realpath} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {parse} from 'acorn';
import {createSafariFixture} from './get273-safari-fixture.mjs';

const root=path.resolve(fileURLToPath(new URL('..',import.meta.url))),args=process.argv.slice(2);
if(args.length!==4||args[0]!=='--source'||!(/^[a-f0-9]{40}$/).test(args[1])||args[2]!=='--artifact'){
 process.stderr.write('Usage: node tools/prepare-get273-safari-fixture.mjs --source <40-char-sha> --artifact <existing-task-artifact>\n');process.exitCode=64;
}else{
 const expected=args[1],artifact=await realpath(args[3]),source=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
 if(source!==expected)throw Error('Source freeze mismatch');
 execFileSync('git',['diff','--exit-code','HEAD','--','app','server','package.json','package-lock.json','release-files.json','tools/build-vercel.mjs','tools/build-reader-web.mjs','tools/build-offline-reading.mjs'],{cwd:root,stdio:'pipe'});
 const templatePath=path.join(root,'.ui-entry/read.html'),template=await readFile(templatePath,'utf8');
 const fixture=await createSafariFixture({buildRoot:path.join(root,'dist'),template,sourceCommit:expected});
 const report={sourceCommit:source,sourceTree:execFileSync('git',['rev-parse','HEAD^{tree}'],{cwd:root,encoding:'utf8'}).trim(),template:'.ui-entry/read.html',provenance:fixture.provenance,assetHashes:fixture.assetHashes,checks:[],nativeAcceptance:'unrun',deviceActions:0,scope:'HTTP and static module preflight only; no browser, Simulator, lease or input'};
 try{
  const base=await fixture.listen(),json=(route,value)=>fetch(base+route,{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify(value)});
  const html=await(await fetch(base+'/read?book=touch-fixture&ui=en')).text();
  if(!html.includes('<script src="/qa/observer.js"></script>')||html.indexOf('/qa/observer.js')>html.indexOf('data-ui-first-paint'))throw Error('Observer not first');
  report.checks.push('parser-blocking observer before first-paint and reader');
  const pending=[...html.matchAll(/<script\b[^>]*src="([^"]+)"/g)].map(m=>m[1]),seen=new Set();
  for(const m of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g))if(m[1].trim())imports(m[1],'/read');
  function imports(code,from){
   const ast=parse(code,{ecmaVersion:'latest',sourceType:'module'});
   const visit=node=>{if(!node||typeof node!=='object')return;
    if(['ImportDeclaration','ExportNamedDeclaration','ExportAllDeclaration','ImportExpression'].includes(node.type)&&node.source){
     if(typeof node.source.value!=='string')throw Error('Nonliteral module import in '+from);
     const url=new URL(node.source.value,new URL(from,base));if(url.origin!==base)throw Error('External module import');pending.push(url.pathname+url.search);
    }
    for(const value of Object.values(node))if(value&&typeof value==='object'){if(Array.isArray(value))value.forEach(visit);else visit(value);}
   };visit(ast);
  }
  while(pending.length){
   const route=pending.shift();if(seen.has(route))continue;seen.add(route);
   const response=await fetch(base+route);if(!response.ok)throw Error('Module unavailable: '+route);
   const bytes=Buffer.from(await response.arrayBuffer()),hash=createHash('sha256').update(bytes).digest('hex');
   if(route==='/qa/observer.js'){if(hash!==fixture.provenance.observerSha256)throw Error('Observer hash mismatch');}
   else if(hash!==fixture.assetHashes[new URL(route,base).pathname])throw Error('Served asset hash mismatch');
   imports(bytes.toString('utf8'),route);
  }
  report.moduleRoutes=[...seen].sort();report.checks.push('served literal module dependency closure and exact hashes');
  for(const route of ['/api/auth/session','/api/library/books/touch-fixture/reading','/api/library/books/touch-fixture/reading-manifest','/api/library/books/touch-fixture/records','/api/library/books/touch-fixture/chat?passageId=fixture-p0'])if(!(await fetch(base+route)).ok)throw Error('Synthetic API unavailable');
  if(!(await json('/api/library/reading-guide',{bookId:'touch-fixture',contentVersion:'fixture-v1',sourceKind:'cloud',locale:'en',action:'view'})).ok)throw Error('Read-only guide view unavailable');
  if((await fetch(base+'/reading-worker.js')).status!==410)throw Error('Worker must remain unavailable');
  report.checks.push('known synthetic reading/reload/chat/view APIs; explicit worker unavailability');
  if(fixture.report().violations.length)throw Error('Unexpected preflight requests');
  for(const action of ['ensure','retry'])if((await json('/api/library/reading-guide',{bookId:'touch-fixture',action})).status!==403)throw Error('Generation was not rejected');
  if((await json('/api/library/books/touch-fixture/chat',{})).status!==403)throw Error('Chat submit was not rejected');
  report.checks.push('generation and submit paths fail closed');report.fixtureReport=fixture.report();report.resources={rssBytes:process.memoryUsage().rss,heapUsedBytes:process.memoryUsage().heapUsed};report.toolHashes={};for(const file of ['tools/get273-safari-fixture.mjs','tools/get273-safari-observer.js','tools/prepare-get273-safari-fixture.mjs'])report.toolHashes[file]=createHash('sha256').update(await readFile(path.join(root,file))).digest('hex');report.result='pass';
 }catch(error){report.result='fail';report.failure=String(error);throw error;}
 finally{await fixture.close();report.serverClosed=true;await writeFile(path.join(artifact,'preflight.json'),JSON.stringify(report,null,2)+'\n');}
 console.log(JSON.stringify({sourceCommit:source,result:report.result,modules:report.moduleRoutes.length,nativeAcceptance:report.nativeAcceptance,deviceActions:0}));
}
