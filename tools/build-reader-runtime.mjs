import {copyFile,mkdir,mkdtemp,readFile,readdir,rename,rm,stat,writeFile,chmod} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {nodeFileTrace} from '@vercel/nft';

const project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const disabled=['persistent-bash','persistent-pwsh','tool-working-directory','llm-retry','session-title'];
const inDirectory=(directory,file)=>file===directory||file.startsWith(directory+path.sep);
const privateFile=file=>/(^|[\\/])\.env(?:$|\.)/.test(file);

async function assertGeneratedOutput(directory){
  let entries;
  try{entries=await readdir(directory);}catch(error){if(error.code==='ENOENT')return;throw error;}
  if(!entries.length)return;
  let manifest;
  try{manifest=JSON.parse(await readFile(path.join(directory,'manifest.json'),'utf8'));}catch{}
  if(manifest?.kind!=='marginalia-reader-runtime')throw Error('Refusing to replace a non-empty directory that is not a generated runtime: '+directory);
}

async function filesBelow(directory){
  const files=[];
  for(const entry of await readdir(directory,{withFileTypes:true})){
    const file=path.join(directory,entry.name);
    if(entry.isDirectory())files.push(...await filesBelow(file));
    else if(entry.isFile())files.push(file);
    else throw Error('The hosted runtime cannot contain symbolic links: '+file);
  }
  return files;
}

function nativePackages(){
  let suffix=process.platform+'-'+process.arch;
  if(process.platform==='linux')suffix+='-'+(process.report.getReport().header.glibcVersionRuntime?'gnu':'musl');
  else if(process.platform==='win32')suffix+='-msvc';
  const packages=['node-addon-require-builtin-'+suffix];
  if(['darwin','linux'].includes(process.platform))packages.push('@deepseek-ai/node-addon-system-'+process.platform+'-'+process.arch);
  return packages;
}

// Initialize the real subprocess and reader plugin, but never create a session
// prompt. No provider key or network request is needed to verify packaging.
async function initialize(outputDir){
  const run=await mkdtemp(path.join(tmpdir(),'reader-runtime-check-'));
  let harness;
  try{
    await writeFile(path.join(run,'input.json'),JSON.stringify({kind:'explain',runId:'offline-runtime-check',bookId:'fixture',contentVersion:'v1',passageId:'p1',text:'Fixture question',passages:[{id:'p1',original:'Fixture source.'}],expiresAt:Date.now()+60000}));
    const patch=[...disabled.map(id=>({id,disabled:true})),{id:'sandbox-policy',name:'@deepseek-ai/dsh-sandbox-policy',config:{mode:'read-only',workspaceRoot:run}},{id:'tools',name:'@deepseek-ai/dsh-tools',config:{mode:'native'}},{insert:[{id:'reader-runtime',name:path.join(outputDir,'harness/reader-plugin.mjs'),inject:['tools','llm'],config:{runDir:run,maxRequests:4,maxToolCalls:8,maxTokens:1024,maxCostCny:.1,pricing:{validUntil:'2099-01-01',inputMissPerMillion:2,outputPerMillion:8}}}]}];
    const patchPath=path.join(run,'reader.patch.json');await writeFile(patchPath,JSON.stringify(patch));
    const {DeepSeekHarness}=await import(pathToFileURL(path.join(outputDir,'node_modules/@deepseek-ai/dsh-sdk-client/lib/index.js')));
    harness=new DeepSeekHarness({profile:'sdk-minimal',patches:[patchPath],dshHome:path.join(run,'home'),processCwd:run,cwd:run,env:{PATH:process.env.PATH,DEEPSEEK_API_KEY:'offline-runtime-check',DSH_SYSTEM_PROMPT:'Use only the reader fixture.'},provider:'deepseek-official',model:'deepseek-flash',reasoningEffort:'off',initializeTimeoutMs:15000,requestTimeoutMs:15000});
    await harness.start();
  }finally{
    try{await harness?.close();}finally{await rm(run,{recursive:true,force:true});}
  }
}

export async function buildReaderRuntime({root=project,outputDir=path.join(root,'.reader-runtime'),verify=true}={}){
  root=path.resolve(root);outputDir=path.resolve(outputDir);
  const modules=path.join(root,'node_modules');
  if(inDirectory(outputDir,root)||inDirectory(modules,outputDir))throw Error('The runtime output must be a separate generated directory');
  await assertGeneratedOutput(outputDir);
  const require=createRequire(path.join(root,'package.json'));
  const profileManifest=require.resolve('@deepseek-ai/dsh-sdk-minimal/package.json');
  const profileDir=path.dirname(profileManifest),profilePatch=path.join(profileDir,'cordis.patch.yml');
  const yaml=await readFile(profilePatch,'utf8');
  // The locked profile's YAML has !!js expressions. Extract plugin names as
  // data rather than evaluating those expressions in the build process.
  const excluded=new Set([...disabled,process.platform==='win32'?'terminal-bash':'terminal-pwsh']);
  const plugins=[...yaml.matchAll(/- id: ([^\n]+)\n\s+name: '([^']+)'/g)].filter(([,id])=>!excluded.has(id.trim())).map(([,id,name])=>({id:id.trim(),name,entry:require.resolve(name)}));
  if(!plugins.length)throw Error('The installed sdk-minimal profile has no recognizable plugins');
  const readerPlugin=path.join(root,'harness/reader-plugin.mjs');
  const entries=[require.resolve('@deepseek-ai/dsh/lib/bin.js'),require.resolve('@deepseek-ai/dsh-sdk-client'),readerPlugin,...plugins.map(plugin=>plugin.entry)];
  const allowed=file=>!privateFile(file)&&(inDirectory(modules,file)||file===readerPlugin||file===path.join(root,'package.json'));
  const trace=await nodeFileTrace(entries,{base:root,processCwd:root,ignore:relative=>!allowed(path.resolve(root,relative)),readFile:async file=>{
    if(!allowed(file))return null;
    try{return await readFile(file);}catch(error){if(['ENOENT','EISDIR'].includes(error.code))return null;throw error;}
  }});
  const files=new Set([...trace.fileList].filter(file=>file.startsWith('node_modules/')||file==='harness/reader-plugin.mjs'));
  files.add(path.relative(root,profileManifest));files.add(path.relative(root,profilePatch));
  // These loaders derive package names at runtime, so NFT cannot discover the
  // platform-specific native bindings from their JavaScript imports alone.
  for(const name of nativePackages()){
    const directory=path.join(modules,...name.split('/'));
    try{for(const file of await filesBelow(directory))files.add(path.relative(root,file));}
    catch(error){if(error.code==='ENOENT')throw Error('Install dependencies on the deployment platform; missing native package '+name);throw error;}
  }
  const staging=outputDir+'.'+randomUUID()+'.pending';
  let bytes=0;
  try{
    await mkdir(staging,{recursive:true});
    for(const file of [...files].sort()){
      const source=path.resolve(root,file);
      if(!allowed(source)||!inDirectory(root,source))throw Error('Runtime dependency is outside the package allowlist: '+file);
      const info=await stat(source);if(!info.isFile())continue;
      const target=path.join(staging,file);await mkdir(path.dirname(target),{recursive:true});await copyFile(source,target);await chmod(target,info.mode&0o111?0o755:0o644);bytes+=info.size;
    }
    await writeFile(path.join(staging,'package.json'),JSON.stringify({private:true,type:'module'})+'\n');
    if(verify)await initialize(staging);
    const manifest={kind:'marginalia-reader-runtime',schemaVersion:1,platform:process.platform,arch:process.arch,nodeMajor:Number(process.versions.node.split('.')[0]),files:[...files].sort(),plugins:plugins.map(({id,name})=>({id,name})),bytes,initialized:!!verify};
    await writeFile(path.join(staging,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
    await assertGeneratedOutput(outputDir);
    await rm(outputDir,{recursive:true,force:true});await rename(staging,outputDir);
    return {outputDir,...manifest};
  }catch(error){await rm(staging,{recursive:true,force:true});throw error;}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  const runtime=await buildReaderRuntime();
  console.log('Built and initialized the isolated reading runtime: '+runtime.files.length+' files, '+(runtime.bytes/1024/1024).toFixed(1)+' MB; no model requests.');
}
