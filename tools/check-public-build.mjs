import {readdir,readFile,lstat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

const approvedAssets=new Set(['forest.jpg','rain.jpg','hearth.jpg','sea.jpg','wind.mp3','birds.mp3','rain.mp3','fire.mp3','waves.mp3']);
const privateDirectories=new Set(['content','local','_briefs']);
const limit=200*1024;

export async function checkPublicBuild(directory){
  const root=path.resolve(directory),assetRoot=path.join(root,'assets/atmospheres'),manifestPath=path.join(assetRoot,'manifest.json');
  let entries=[];
  try{
    const info=await lstat(manifestPath);if(!info.isFile())throw Error('氛围资源清单必须是普通文件');
    entries=JSON.parse(await readFile(manifestPath,'utf8'));
  }catch(error){if(error.code!=='ENOENT')throw error;}
  if(!Array.isArray(entries))throw Error('氛围资源清单格式不正确');
  const registered=new Map();
  for(const entry of entries){
    if(!entry||!approvedAssets.has(entry.file)||registered.has(entry.file))throw Error('不允许的氛围资源');
    if(!Number.isSafeInteger(entry.bytes)||entry.bytes<=0||!/^[a-f0-9]{64}$/.test(entry.sha256))throw Error('氛围资源清单格式不正确');
    const file=path.join(assetRoot,entry.file),info=await lstat(file);
    if(!info.isFile())throw Error('氛围资源必须是普通文件：'+entry.file);
    const bytes=await readFile(file);
    if(bytes.length!==entry.bytes||createHash('sha256').update(bytes).digest('hex')!==entry.sha256)throw Error('氛围资源校验不一致：'+entry.file);
    registered.set(file,entry);
  }
  let files=0,largeAssets=0;
  async function walk(current){
    for(const entry of await readdir(current,{withFileTypes:true})){
      const file=path.join(current,entry.name),relative=path.relative(root,file);
      if(entry.isSymbolicLink())throw Error('公开构建不能包含符号链接：'+relative);
      if(entry.isDirectory()){
        if(privateDirectories.has(entry.name))throw Error('公开构建包含私人内容目录：'+relative);
        await walk(file);
      }else{
        files++;const info=await lstat(file);
        if(info.size>limit){if(!registered.has(file))throw Error('公开构建包含未登记的大文件：'+relative);largeAssets++;}
      }
    }
  }
  await walk(root);return {files,largeAssets};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  const result=await checkPublicBuild(process.argv[2]||'dist');
  console.log(`Public build checked: ${result.files} files, ${result.largeAssets} registered media assets; no private content directories.`);
}
