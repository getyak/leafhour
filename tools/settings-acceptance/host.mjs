import {createServer} from 'node:http';
import {createHash,randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFile,writeFile,mkdir,realpath,lstat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const panels=['account','reading-habits','daily-reading','appearance','data','about'];
const states=['default','hover','focus-visible','active','disabled','error','empty','loading'];
const csp="default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data: blob:; connect-src 'none'; worker-src 'none'; frame-src 'none'; frame-ancestors 'none'; object-src 'none'; form-action 'none'; base-uri 'none'; sandbox allow-scripts allow-same-origin allow-downloads";
export function makeCoverage(sourceCommit){
 const screenshots=[];
 for(const browser of ['Safari','Chrome','Firefox'])for(const panel of panels)for(const locale of ['en','zh-Hans','ja'])for(const theme of ['paper','night'])for(const width of [1440,390])screenshots.push({browser,panel,locale,theme,width,height:width===1440?900:844,firstBatch:['appearance','daily-reading','data'].includes(panel),status:'pending',evidence:null});
 return {schemaVersion:1,sourceCommit,screenshots,humanStudy:{participants:2,seconds:5,status:'pending',evidence:null},controls:['switch','segmented','listbox','time-picker','dropzone','button','sidebar','slider','profile-file'].map(control=>({control,states:states.map(state=>({state,status:'pending',evidence:null,notApplicableReason:null}))})),dropzone:['drag-over','validating','invalid','valid'].map(state=>({state,status:'pending',evidence:null})),checks:['geometry','overflow','CJK-orphans','token-inventory','keyboard-focus','saved-and-error-feedback','reference-comparison','adapted-rubric','pixel-diff','guest','synthetic-empty','synthetic-populated','actual-account','production'].map(check=>({check,status:'pending',evidence:null}))};
}

export function fixtureResponse(request,assets,host){
 const headers={'Cache-Control':'no-store','Content-Security-Policy':csp,'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Cross-Origin-Resource-Policy':'same-origin','Permissions-Policy':'camera=(), microphone=(), geolocation=()'};
 const fail=status=>({status,headers,bytes:Buffer.from('Fixture request refused')});
 const h=request.headers||{};
 const cookieAllowed=!h.cookie||/^leafhour\.ui\.hint\.v1=1\.(system|en|zh-Hans|zh-Hant|ja|-)\.(en|zh-Hans|zh-Hant|ja)$/.test(h.cookie);
 if(h.host!==host||!cookieAllowed||h.authorization||h.origin&&h.origin!=='http://'+host||h['sec-fetch-site']&&!['same-origin','none'].includes(h['sec-fetch-site']))return fail(403);
 if(!['GET','HEAD'].includes(request.method))return fail(405);
 if(typeof request.url!=='string'||!request.url.startsWith('/')||request.url.startsWith('//')||/[\\%#]/.test(request.url))return fail(404);
 const [pathname,query]=request.url.split('?');
 if(query!==undefined){if(pathname!=='/')return fail(404);const params=new URLSearchParams(query);const choices={panel:panels,locale:['en','zh-Hans','ja'],ui:['system','en','zh-Hans','zh-Hant','ja'],theme:['paper','night'],identity:['synthetic-a','synthetic-b','guest']};for(const [key,value]of params)if(!choices[key]?.includes(value)||params.getAll(key).length!==1)return fail(400);}
 const item=assets.get(pathname);if(!item)return fail(404);
 return {status:200,headers:{...headers,'Content-Type':item.type},bytes:request.method==='HEAD'?Buffer.alloc(0):item.bytes};
}

// A scoped esbuild build, not a hosted deployment or a rewritten release.json.
// Product JS/CSS/markup bytes come from the named Git object, never old dist.
export async function prepareFixture(outputDir,{sourceCommit}={}){
 const commit=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
 if(sourceCommit!==commit||!/^[a-f0-9]{40}$/.test(commit))throw Error('Expected the exact current source commit');
 outputDir=path.resolve(outputDir);if(outputDir.startsWith(root+path.sep)||outputDir===root)throw Error('Use an external task artifact directory');
 await mkdir(outputDir);const site=path.join(outputDir,'site');await mkdir(site);
 const tracked=file=>execFileSync('git',['show',commit+':'+file],{cwd:root,maxBuffer:20*1024*1024});
 const allowed=new Set(JSON.parse(tracked('release-files.json').toString())),inputs=new Map(),outputs=[];
 const addInput=(file,bytes)=>{inputs.set(file,{path:file,sha256:sha(bytes)});return bytes;};
 const {build}=await import('esbuild');
 const fixtureDir=path.join(root,'tools/settings-acceptance');
 const nodeModules=await realpath(path.join(root,'node_modules'));
 const result=await build({absWorkingDir:root,entryPoints:['tools/settings-acceptance/browser.mjs'],outdir:site,entryNames:'fixture',chunkNames:'chunks/[name]-[hash]',bundle:true,splitting:true,platform:'browser',format:'esm',target:'es2022',write:false,metafile:true,logLevel:'silent',plugins:[{name:'frozen-settings-source',setup(builder){builder.onLoad({filter:/\.(mjs|js|json)$/},async args=>{
  const file=path.resolve(args.path),relative=path.relative(root,file).replaceAll('\\','/');let bytes;
  if(relative.startsWith('app/')){if(!allowed.has(relative))throw Error('Nonpublic product input: '+relative);bytes=tracked(relative);}
  else if(file.startsWith(fixtureDir+path.sep)){if((await lstat(file)).isSymbolicLink())throw Error('Fixture source symlink');bytes=await readFile(file);}
  else{const actual=await realpath(file);if(!actual.startsWith(nodeModules+path.sep))throw Error('Unexpected build input');bytes=await readFile(actual);}
  addInput(relative,bytes);return {contents:bytes,loader:file.endsWith('.json')?'json':'js',resolveDir:path.dirname(file)};
 });}}]});
 const addOutput=async(name,bytes,type)=>{const file=path.join(site,name);await mkdir(path.dirname(file),{recursive:true});await writeFile(file,bytes);outputs.push({url:'/'+name,path:name,type,sha256:sha(bytes),bytes:bytes.length});};
 for(const file of result.outputFiles)await addOutput(path.relative(site,file.path).replaceAll('\\','/'),file.contents,'text/javascript; charset=utf-8');
 const home=addInput('app/home.html',tracked('app/home.html')).toString();
 const css=[...home.matchAll(/<link rel="stylesheet" href="(\/[^"?]+\.css)"/g)].map(m=>m[1]);
 const copied=new Set();
 async function asset(url){
  if(copied.has(url))return;copied.add(url);const rel='app'+url;
  if(!allowed.has(rel)||!/^\/[A-Za-z0-9_./-]+\.(css|woff2|woff|svg|webp|png|jpg)$/.test(url)||url.split('/').includes('..'))throw Error('Unsafe fixture asset: '+url);
  const types={css:'text/css; charset=utf-8',svg:'image/svg+xml',woff2:'font/woff2',woff:'font/woff',webp:'image/webp',png:'image/png',jpg:'image/jpeg'};
  const bytes=addInput(rel,tracked(rel)),type=types[path.extname(url).slice(1)];
  await addOutput(url.slice(1),bytes,type);
  if(url.endsWith('.css'))for(const match of bytes.toString().matchAll(/url\(\s*['"]?([^'"\s)]+)['"]?\s*\)/g)){
   if(match[1].startsWith('data:'))continue;
   const resolved=new URL(match[1],'https://fixture.invalid'+url);
   if(resolved.origin!=='https://fixture.invalid'||resolved.search||resolved.hash)throw Error('External CSS asset');await asset(resolved.pathname);
  }
 }
 for(const url of [...css,'/icons.svg'])await asset(url);
 const header=home.match(/<header\b[\s\S]*?<\/header>/)?.[0];
 if(!header||!header.includes('library-sidebar'))throw Error('Settings shell markup changed');
 const markup=`<!doctype html><html lang="en" data-source-commit="${commit}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>GET-201 synthetic settings fixture</title>${css.map(url=>`<link rel="stylesheet" href="${url}">`).join('')}</head><body class="library-page" data-view="library">${header}<main id="main"><div id="library-view"><button id="library-menu" type="button">Synthetic navigation</button><p>Known synthetic fixture · no real account</p></div></main><dialog id="library-nav-dialog" class="library-nav-dialog"></dialog><dialog id="library-settings-dialog" class="library-settings-dialog" aria-labelledby="settings-title"></dialog><script type="module" src="/fixture.js"></script></body></html>`;
 await addOutput('index.html',Buffer.from(markup),'text/html; charset=utf-8');
 addInput('package-lock.json',tracked('package-lock.json'));
 addInput('tools/settings-acceptance/host.mjs',await readFile(fileURLToPath(import.meta.url)));
 const manifest={schemaVersion:1,kind:'get201-synthetic-component-build',sourceCommit:commit,fixtureId:randomUUID(),inputs:[...inputs.values()].sort((a,b)=>a.path.localeCompare(b.path)),outputs,esbuild:result.metafile,productionAcceptance:false};
 await writeFile(path.join(outputDir,'provenance.json'),JSON.stringify(manifest,null,2)+'\n');
 await writeFile(path.join(outputDir,'coverage.json'),JSON.stringify(makeCoverage(commit),null,2)+'\n');
 return {outputDir,sourceCommit:commit,outputs:outputs.length,inputs:inputs.size,productionAcceptance:false};
}

export async function loadFixture(outputDir){
 const manifest=JSON.parse(await readFile(path.join(outputDir,'provenance.json'),'utf8')),assets=new Map();
 if(manifest.kind!=='get201-synthetic-component-build')throw Error('Wrong artifact kind');
 for(const row of manifest.outputs){if(row.path.split('/').some(p=>!p||p==='.'||p==='..')||path.isAbsolute(row.path)||row.path.includes('\\')||row.url!=='/'+row.path)throw Error('Invalid artifact path');const file=path.join(outputDir,'site',row.path);if((await lstat(file)).isSymbolicLink())throw Error('Artifact symlink');const bytes=await readFile(file);if(sha(bytes)!==row.sha256||bytes.length!==row.bytes)throw Error('Artifact integrity failure');assets.set(row.url,{bytes,type:row.type});}
 assets.set('/',assets.get('/index.html'));return {manifest,assets};
}
export async function serveFixture(outputDir){
 const {assets,manifest}=await loadFixture(outputDir);
 const server=createServer((request,response)=>{const result=fixtureResponse(request,assets,'127.0.0.1:'+server.address().port);response.writeHead(result.status,result.headers);response.end(result.bytes);});
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 return {server,url:'http://127.0.0.1:'+server.address().port+'/',sourceCommit:manifest.sourceCommit};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 const [command,outputDir,sourceCommit]=process.argv.slice(2);
 if(command==='prepare'&&outputDir&&sourceCommit)console.log(JSON.stringify(await prepareFixture(outputDir,{sourceCommit})));
 else if(command==='serve'&&outputDir){const result=await serveFixture(outputDir);console.log(JSON.stringify({url:result.url,sourceCommit:result.sourceCommit}));for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>result.server.close());}
 else throw Error('Usage: node tools/settings-acceptance/host.mjs prepare <new-artifact-child> <full-HEAD> | serve <artifact-child>');
}
