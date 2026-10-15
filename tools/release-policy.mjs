import {readFile,writeFile,mkdir,lstat,mkdtemp,rm,chmod} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

const forbidden=/(^|\/)(?:local|content|_briefs|\.git|node_modules|verification|superpowers)(\/|$)|(?:^|\/)AGENTS\.md$|\.(?:pdf|epub|p12|pem|key)$/i;
const secret=/(?:-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bghp_[A-Za-z0-9]{30,}|\bgithub_pat_[A-Za-z0-9_]{40,}|\bsb_secret_[A-Za-z0-9_-]{24,}|\bsk-[A-Za-z0-9_-]{32,})/;
export function validReleasePath(file){
  return typeof file==='string'&&file.length>0&&!file.includes('\\')&&!file.split('/').some(part=>!part||part==='.'||part==='..')&&!path.isAbsolute(file)&&!forbidden.test(file)&&(!file.split('/').some(part=>part.startsWith('.env'))||['.env.example','.env.hosted.example'].includes(file));
}
export async function releaseFiles(root){
  const files=JSON.parse(await readFile(path.join(root,'release-files.json'),'utf8'));
  if(!Array.isArray(files)||!files.length||new Set(files).size!==files.length||files.some(file=>!validReleasePath(file)))throw Error('Invalid release allowlist');
  return files;
}
export async function releaseCommit(root,{sourceCommit}={}){
  if(sourceCommit!==undefined){if(!/^[a-f0-9]{40}$/.test(sourceCommit))throw Error('Invalid release source commit');return sourceCommit;}
  let commit;
  try{commit=JSON.parse(await readFile(path.join(root,'release-source.json'),'utf8')).commit;}
  catch(error){if(error.code!=='ENOENT')throw error;commit=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();}
  if(!/^[a-f0-9]{40}$/.test(commit||''))throw Error('Invalid release source commit');
  return commit;
}
export async function exportRelease(root,destination,{commit}={}){
  if(!/^[a-f0-9]{40}$/.test(commit||''))throw Error('A full source commit is required');
  const files=await releaseFiles(root);
  await mkdir(destination,{recursive:true});
  for(const file of files){
    let current=root;
    for(const part of file.split('/')){current=path.join(current,part);if((await lstat(current)).isSymbolicLink())throw Error('Symlinks cannot be released: '+file);}
    const sourceStat=await lstat(current);
    if(!sourceStat.isFile())throw Error('Release entry is not a file: '+file);
    let bytes=await readFile(current);
    if(secret.test(bytes.toString('utf8')))throw Error('Credential pattern in release file: '+file);
    if(file==='README.md')bytes=Buffer.from(bytes.toString('utf8').replace(/^项目主页：.*$/m,'项目主页：[GitHub](https://github.com/getyak/marginalia-reader)'));
    const target=path.join(destination,file);await mkdir(path.dirname(target),{recursive:true});
    await writeFile(target,bytes);
    await chmod(target,sourceStat.mode&0o111?0o755:0o644);
  }
  await writeFile(path.join(destination,'release-source.json'),JSON.stringify({commit})+'\n');
  return files;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  const root=process.cwd(),destination=await mkdtemp(path.join(tmpdir(),'reader-release-check-'));
  try{const commit=await releaseCommit(root,{sourceCommit:process.env.VERCEL_GIT_COMMIT_SHA||process.env.GITHUB_SHA});const files=await exportRelease(root,destination,{commit});console.log('Release allowlist checked: '+files.length+' software files; private history and data excluded.');}finally{await rm(destination,{recursive:true,force:true});}
}
