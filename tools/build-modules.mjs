import {build} from 'esbuild';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {mkdir,cp,readFile,writeFile,rm,readdir,lstat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {buildVercel} from './build-vercel.mjs';
import {releaseCommit} from './release-policy.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
async function files(dir,base=dir){const result=[];for(const entry of await readdir(dir,{withFileTypes:true})){const file=path.join(dir,entry.name);if((await lstat(file)).isSymbolicLink())throw Error('Release symlink forbidden');if(entry.isDirectory())result.push(...await files(file,base));else result.push({path:path.relative(base,file).replaceAll('\\','/'),sha256:createHash('sha256').update(await readFile(file)).digest('hex')});}return result.sort((a,b)=>a.path.localeCompare(b.path));}
async function moduleInputs(entry){const result=await build({absWorkingDir:root,entryPoints:[entry],bundle:true,platform:'node',format:'esm',target:'node22',packages:'external',metafile:true,write:false,logLevel:'silent'});const inputs=[];for(const file of Object.keys(result.metafile.inputs).sort()){if(file.startsWith('<'))continue;const bytes=await readFile(path.resolve(root,file));inputs.push({path:file.replaceAll('\\','/'),sha256:createHash('sha256').update(bytes).digest('hex')});}return {entry,files:inputs,digest:createHash('sha256').update(JSON.stringify(inputs)).digest('hex')};}
export async function buildModules({outputDir=path.join(root,'build','modules')}={}){
 const output=path.resolve(outputDir),web=path.join(output,'web'),publicDir=path.join(web,'public'),templates=path.join(web,'templates');await mkdir(output,{recursive:true});
 await buildVercel({outputDir:publicDir,uiTemplateDir:templates});
 await cp(path.join(root,'app','home.html'),path.join(templates,'home.html'));await rm(path.join(publicDir,'home.html'),{force:true});
 const sourceCommit=await releaseCommit(root,{sourceCommit:process.env.LEAFHOUR_SOURCE_COMMIT||process.env.GITHUB_SHA});
 const publicFiles=await files(publicDir);if(publicFiles.some(file=>/(^|\/)(?:\.env[^/]*|server|harness|secrets|local|node_modules)(\/|$)/.test(file.path)))throw Error('Private path in Web artifact');
 const manifest={schemaVersion:1,sourceCommit,protocol:1,modules:{web:{publicRoot:'web/public',templates:'web/templates',files:publicFiles},api:await moduleInputs('apps/api/server.mjs'),agent:await moduleInputs('apps/agent/server.mjs')},dependencyLockSha256:createHash('sha256').update(await readFile(path.join(root,'package-lock.json'))).digest('hex'),runtime:{node:process.version,platform:process.platform,arch:process.arch},migrations:['202611050001_execution_deliveries']};
 await writeFile(path.join(output,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');return {outputDir:output,sourceCommit,publicFiles:publicFiles.length};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){const index=process.argv.indexOf('--out');console.log(JSON.stringify(await buildModules({...(index<0?{}:{outputDir:process.argv[index+1]})})));}
