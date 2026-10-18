import {readdir,readFile,lstat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

const approvedAssets=new Set(['forest.jpg','rain.jpg','hearth.jpg','sea.jpg','wind.mp3','birds.mp3','rain.mp3','fire.mp3','waves.mp3']);
// GET-167: the self-hosted Newsreader faces may exceed the generic large-file
// limit only while every byte matches these independently reviewed assets.
// A changed distribution manifest cannot authorize a new large-file exemption.
const approvedFonts=new Map([
  ['newsreader-var.woff2',{bytes:214960,sha256:'52f54c34206c51e23e2907bfda4f04fb11ac6ba7f75f8021b2d0075b091d1308'}],
  ['newsreader-italic-var.woff2',{bytes:239360,sha256:'8920f06c4c116e91721a2cbbbb195d1ab6997a657cb3313dab5c99b6b202d899'}],
]);
const fontLicense='OFL-1.1';
const approvedCjkBundle='2e2ebd6fdb630a1188431bedebf2d90de4b5e50e8f5db440d46e40220f589fd6';
const approvedCjkLicense='5e0da210fb04058a8c0087985d2d456b931c2579811a49655721d3cf0c36b6d6';
const privateDirectories=new Set(['content','local','_briefs']);
const limit=200*1024;
const digest=/^[a-f0-9]{64}$/;
function publicSource(value){
  try{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password;}catch{return false;}
}

export async function checkPublicBuild(directory){
  const root=path.resolve(directory),assetRoot=path.join(root,'assets/atmospheres'),manifestPath=path.join(assetRoot,'manifest.json');
  let entries=[];
  try{
    const info=await lstat(manifestPath);if(!info.isFile())throw Error('氛围资源清单必须是普通文件');
    entries=JSON.parse(await readFile(manifestPath,'utf8'));
  }catch(error){if(error.code!=='ENOENT')throw error;}
  if(!Array.isArray(entries))throw Error('氛围资源清单格式不正确');
  const fontRoot=path.join(root,'fonts/newsreader'),fontManifestPath=path.join(fontRoot,'manifest.json');
  const registeredFonts=new Set(),listedFontNames=new Set();
  let fontManifest=null;
  try{
    const info=await lstat(fontManifestPath);if(!info.isFile())throw Error('字体清单必须是普通文件');
    fontManifest=JSON.parse(await readFile(fontManifestPath,'utf8'));
  }catch(error){if(error.code!=='ENOENT')throw error;}
  if(fontManifest){
    if(fontManifest.license!==fontLicense)throw Error('字体许可须为已审阅的 '+fontLicense);
    if(!publicSource(fontManifest.sourceRepository)||!publicSource(fontManifest.designerRepository)||!/^[a-f0-9]{40}$/.test(fontManifest.sourceCommit||''))throw Error('字体来源缺少 HTTPS 仓库、设计师主页或来源提交');
    if(!Array.isArray(fontManifest.fonts)||fontManifest.fonts.length!==approvedFonts.size)throw Error('字体清单格式不正确');
    for(const entry of fontManifest.fonts){
      if(!entry||!approvedFonts.has(entry.file)||listedFontNames.has(entry.file)||entry.format!=='woff2')throw Error('不允许的字体资源');
      if(!Number.isSafeInteger(entry.bytes)||entry.bytes<=0||!digest.test(entry.sha256||''))throw Error('字体清单格式不正确');
      const approved=approvedFonts.get(entry.file);
      if(entry.bytes!==approved.bytes||entry.sha256!==approved.sha256)throw Error('字体未匹配已审阅资源：'+entry.file);
      const file=path.join(fontRoot,entry.file),info=await lstat(file);
      if(!info.isFile())throw Error('字体必须是普通文件：'+entry.file);
      if(info.size!==approved.bytes)throw Error('字体校验不一致：'+entry.file);
      const bytes=await readFile(file);
      if(bytes.length!==entry.bytes||createHash('sha256').update(bytes).digest('hex')!==entry.sha256)throw Error('字体校验不一致：'+entry.file);
      if(!/^wOF2/.test(bytes.subarray(0,4).toString('latin1')))throw Error('字体必须是未改动的 WOFF2：'+entry.file);
      registeredFonts.add(file);
      listedFontNames.add(entry.file);
    }
    let licenseText;try{licenseText=await readFile(path.join(fontRoot,'OFL.txt'),'utf8');}catch{throw Error('字体许可文件缺失');}
    if(!licenseText.includes('SIL Open Font License'))throw Error('字体许可文件不正确');
  }
  const cjkRoot=path.join(root,'fonts/noto-serif-sc');let cjkManifest=null;
  try{const info=await lstat(path.join(cjkRoot,'manifest.json'));if(!info.isFile())throw Error('CJK font manifest must be a regular file');cjkManifest=JSON.parse(await readFile(path.join(cjkRoot,'manifest.json'),'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
  if(cjkManifest){
    if(cjkManifest.license!==fontLicense||cjkManifest.upstreamCssSha256!=='8d3f0a860f044b99dab93ca4b5b356c22ff82da17ba09658d17426936d1f49b8'||cjkManifest.licenseSha256!==approvedCjkLicense)throw Error('CJK font provenance is not approved');
    const fonts=cjkManifest.fonts;
    if(!Array.isArray(fonts)||fonts.length!==88||new Set(fonts.map(font=>font?.file)).size!==88||fonts.some(font=>!font||!/^noto-serif-sc-\d{3}\.woff2$/.test(font.file)||font.format!=='woff2'||!Number.isSafeInteger(font.bytes)||font.bytes<=0||!digest.test(font.sha256||'')||typeof font.unicodeRange!=='string'))throw Error('Invalid CJK font manifest');
    const pin=createHash('sha256').update(fonts.map(font=>font.file+' '+font.sha256+' '+font.unicodeRange).join('\n')).digest('hex');
    if(pin!==approvedCjkBundle)throw Error('CJK fonts do not match the independently approved bundle');
    for(const font of fonts){const file=path.join(cjkRoot,font.file),info=await lstat(file);if(!info.isFile()||info.size!==font.bytes)throw Error('CJK font must be the approved regular file: '+font.file);const bytes=await readFile(file);if(createHash('sha256').update(bytes).digest('hex')!==font.sha256||bytes.subarray(0,4).toString()!=='wOF2')throw Error('CJK font bytes do not match: '+font.file);registeredFonts.add(file);}
    const license=await readFile(path.join(cjkRoot,'OFL.txt'));if(createHash('sha256').update(license).digest('hex')!==approvedCjkLicense)throw Error('CJK font license does not match');
  }
  const registered=new Map();
  for(const entry of entries){
    if(!entry||!approvedAssets.has(entry.file)||registered.has(entry.file))throw Error('不允许的氛围资源');
    if(!Number.isSafeInteger(entry.bytes)||entry.bytes<=0||!/^[a-f0-9]{64}$/.test(entry.sha256))throw Error('氛围资源清单格式不正确');
    if(entry.file.endsWith('.mp3')){
      if(entry.license!=='CC0-1.0')throw Error('录音许可须为已审阅的逐文件 CC0-1.0：'+entry.file);
      if(typeof entry.creator!=='string'||!entry.creator.trim()||!publicSource(entry.source)||!publicSource(entry.sourcePage)||!digest.test(entry.sourceSha256||''))throw Error('录音来源缺少作者、HTTPS 原始资源/作品页面或来源哈希：'+entry.file);
    }
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
        if(path.dirname(file)===assetRoot&&entry.name.endsWith('.mp3')&&!registered.has(file))throw Error('公开构建包含未登记的录音：'+relative);
        if(entry.name.endsWith('.woff2')&&!registeredFonts.has(file))throw Error('公开构建包含未登记的字体文件：'+relative);
        if(info.size>limit){const software=/^reader-web\/reader-([a-f0-9]{16})\.js$/.exec(relative);if(software&&info.size<=320*1024&&createHash('sha256').update(await readFile(file)).digest('hex').startsWith(software[1]))continue;if(!registered.has(file)&&!registeredFonts.has(file))throw Error('公开构建包含未登记的大文件：'+relative);largeAssets++;}
      }
    }
  }
  await walk(root);return {files,largeAssets};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  const result=await checkPublicBuild(process.argv[2]||'dist');
  console.log(`Public build checked: ${result.files} files, ${result.largeAssets} registered media assets; no private content directories.`);
}
