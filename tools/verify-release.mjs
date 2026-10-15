import {readFile,readdir,lstat} from 'node:fs/promises';
import path from 'node:path';
import {releaseFiles} from './release-policy.mjs';

const root=process.cwd(),app=path.join(root,'app'),dist=path.join(root,'dist');
async function list(dir,prefix=''){
  const result=[];for(const item of await readdir(dir,{withFileTypes:true})){const file=prefix+item.name;if(item.isSymbolicLink())throw Error('Unexpected symlink: '+file);if(item.isDirectory())result.push(...await list(path.join(dir,item.name),file+'/'));else result.push(file);}return result;
}
const allowed=new Set([...(await releaseFiles(root)).filter(file=>file.startsWith('app/')).map(file=>file.slice(4)),'read.html','library.html','evals/index.html','404.html','release.json']);
for(const file of await list(dist)){
  if(!allowed.has(file))throw Error('Unexpected public build file: '+file);
  if((await lstat(path.join(dist,file))).size>2_000_000)throw Error('Unexpected public asset size: '+file);
}
const release=JSON.parse(await readFile(path.join(dist,'release.json'),'utf8'));
if(!/^[a-f0-9]{40}$/.test(release.sourceCommit))throw Error('Missing source provenance');
for(const file of ['index.html','library.html','read.html','portal.js','library-workspace.mjs','library-workspace.css','reading-flow.mjs','reading-load.mjs'])await lstat(path.join(dist,file));
console.log('Public build checked: expected assets and source provenance only.');
