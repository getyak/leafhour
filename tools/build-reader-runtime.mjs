import {copyFile,lstat,mkdir,readFile,readdir,rename,rm,stat,writeFile,chmod} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {nodeFileTrace} from '@vercel/nft';
import {checkReaderRuntime} from './check-reader-runtime.mjs';

const project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const disabled=['persistent-bash','persistent-pwsh','tool-working-directory','llm-retry','session-title'];
const inDirectory=(directory,file)=>file===directory||file.startsWith(directory+path.sep);
const privateFile=file=>/(^|[\\/])\.env(?:$|\.)/.test(file);
const hostedNodeVersion='22.23.3';
const hostedNodeSha256='fde6a4bf8d0562f7751d1a2d6cb9b417c4cfe107bbcb0aa3e9a24e125e348f48';
const hostedNodeLicenseSha256='c738ae413cf561f174e34f6961f8ca458aae2369a73640dda6234c629b98bcc4';

async function assertGeneratedOutput(directory,{allowDependencyCache=false}={}){
  const refuse=()=>{throw Error('Refusing to replace a non-empty directory that is not a generated runtime: '+directory);};
  let info;
  try{info=await lstat(directory);}catch(error){if(error.code==='ENOENT')return;throw error;}
  if(!info.isDirectory()||info.isSymbolicLink())refuse();
  const entries=await readdir(directory,{withFileTypes:true});
  if(!entries.length)return;
  let manifest;
  try{manifest=JSON.parse(await readFile(path.join(directory,'manifest.json'),'utf8'));}catch{}
  if(manifest?.kind==='marginalia-reader-runtime')return;
  // Vercel may restore nested dependencies without the generated manifest.
  // This exception is explicit and accepts only a plain dependency directory.
  if(allowDependencyCache===true&&entries.length===1&&entries[0].name==='node_modules'&&entries[0].isDirectory()&&!entries[0].isSymbolicLink())return;
  refuse();
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

async function digest(file){
  const hash=createHash('sha256');for await(const chunk of createReadStream(file))hash.update(chunk);return hash.digest('hex');
}

async function pinnedHostedNode(require){
  if(process.platform!=='linux'||process.arch!=='x64')return null;
  const manifestFile=require.resolve('node-linux-x64/package.json'),directory=path.dirname(manifestFile);
  const manifest=JSON.parse(await readFile(manifestFile,'utf8'));
  if(manifest.version!==hostedNodeVersion)throw Error('The hosted Node version must be '+hostedNodeVersion+'.');
  const executable=path.join(directory,'bin/node'),license=path.join(directory,'LICENSE');
  if(await digest(executable)!==hostedNodeSha256)throw Error('The hosted Node executable integrity check failed.');
  if(await digest(license)!==hostedNodeLicenseSha256)throw Error('The hosted Node license integrity check failed.');
  return {executable,license,metadata:{version:hostedNodeVersion,sha256:hostedNodeSha256,bytes:(await stat(executable)).size,licenseSha256:hostedNodeLicenseSha256,licenseBytes:(await stat(license)).size}};
}

export async function buildReaderRuntime({root=project,outputDir=path.join(root,'.reader-runtime'),verify=true,allowDependencyCache=false}={}){
  root=path.resolve(root);outputDir=path.resolve(outputDir);
  const modules=path.join(root,'node_modules');
  if(inDirectory(outputDir,root)||inDirectory(modules,outputDir))throw Error('The runtime output must be a separate generated directory');
  await assertGeneratedOutput(outputDir,{allowDependencyCache});
  const require=createRequire(path.join(root,'package.json'));
  const node=await pinnedHostedNode(require);
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
    const packageJson=JSON.stringify({private:true,type:'module'})+'\n';
    await writeFile(path.join(staging,'package.json'),packageJson);files.add('package.json');bytes+=Buffer.byteLength(packageJson);
    if(node){
      await mkdir(path.join(staging,'bin'));
      for(const [source,file,mode] of [[node.executable,'bin/node',0o755],[node.license,'bin/NODE-LICENSE',0o644],[path.join(root,'harness/hosted-launch.mjs'),'bin/dsh-launch.mjs',0o755]]){
        await copyFile(source,path.join(staging,file));await chmod(path.join(staging,file),mode);files.add(file);bytes+=(await stat(source)).size;
      }
    }
    if(bytes>=200*1024*1024)throw Error('The reading runtime exceeds its 200 MiB hosted size budget.');
    if(verify)await checkReaderRuntime(staging);
    const manifest={kind:'marginalia-reader-runtime',schemaVersion:1,platform:process.platform,arch:process.arch,nodeMajor:Number(process.versions.node.split('.')[0]),...(node?{node:node.metadata}:{}),files:[...files].sort(),plugins:plugins.map(({id,name})=>({id,name})),bytes,initialized:!!verify};
    await writeFile(path.join(staging,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
    await assertGeneratedOutput(outputDir,{allowDependencyCache});
    await rm(outputDir,{recursive:true,force:true});await rename(staging,outputDir);
    return {outputDir,...manifest};
  }catch(error){await rm(staging,{recursive:true,force:true});throw error;}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  const runtime=await buildReaderRuntime({allowDependencyCache:process.env.VERCEL==='1'});
  console.log('Built and initialized the isolated reading runtime: '+runtime.files.length+' files, '+(runtime.bytes/1024/1024).toFixed(1)+' MB; no model requests.');
}
