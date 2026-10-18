import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm,mkdir,cp,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {checkPublicBuild} from '../tools/check-public-build.mjs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createReaderServer} from '../server/server.mjs';
import {ensureShareCjkFonts,shareFonts,shareFontFallbacks,buildShareModel,paragraphSnapshot} from '../app/share-model.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const fontDir=path.join(root,'app/fonts/noto-serif-sc');
const manifest=JSON.parse(await readFile(path.join(fontDir,'manifest.json'),'utf8'));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');

test('CJK binary bytes and declared actual cmap ranges match the independently reviewed bundle pin',async()=>{
  assert.equal(hash(manifest.fonts.map(font=>font.file+' '+font.sha256+' '+font.unicodeRange).join('\n')),'2e2ebd6fdb630a1188431bedebf2d90de4b5e50e8f5db440d46e40220f589fd6');
  assert.equal(manifest.upstreamCssSha256,'8d3f0a860f044b99dab93ca4b5b356c22ff82da17ba09658d17426936d1f49b8');
  let bytes=0;const characters=new Set();
  for(const font of manifest.fonts){
    const file=await readFile(path.join(fontDir,font.file));assert.equal(file.subarray(0,4).toString(),'wOF2');assert.equal(hash(file),font.sha256);assert.equal(file.length,font.bytes);assert.ok(file.length<=110000);bytes+=file.length;
    for(const range of font.unicodeRange.split(', ')){const values=range.slice(2).split('-').map(v=>parseInt(v,16)),a=values[0],b=values.at(-1);assert.ok(a>=0x2e80,'Latin and proportional Latin punctuation must not select the CJK face');for(let c=a;c<=b;c++)characters.add(c);}
  }
  assert.equal(bytes,5891588);assert.equal(characters.size,12834);
  for(const character of '读过之后，留一点自己的理解。简体中文繁體中文日本語愛麗絲夢遊仙境')assert.ok(characters.has(character.codePointAt(0)),character+' must have an audited real cmap glyph');
  assert.match(await readFile(path.join(fontDir,'OFL.txt'),'utf8'),/SIL OPEN FONT LICENSE/);
  const css=await readFile(path.join(fontDir,'font-faces.css'),'utf8');assert.doesNotMatch(css,/https?:\/\//);assert.equal((css.match(/@font-face/g)||[]).length,88);
});

test('an autocrlf checkout preserves every structured original and its stable source hash',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'leafhour-structured-byte-check-'));
  try{
    const sources=JSON.parse(await readFile(path.join(root,'catalog/manifest.json'),'utf8')).filter(entry=>entry.format==='structured').map(entry=>'catalog/'+entry.file);
    assert.ok(sources.length>0);const fixture=path.join(dir,'fixture'),output=path.join(dir,'checkout');await mkdir(fixture,{recursive:true});await mkdir(output);
    await cp(path.join(root,'.gitattributes'),path.join(fixture,'.gitattributes'));
    for(const file of sources){await mkdir(path.dirname(path.join(fixture,file)),{recursive:true});await cp(path.join(root,file),path.join(fixture,file));}
    execFileSync('git',['init','--quiet',fixture]);execFileSync('git',['-c','core.autocrlf=false','add','--','.gitattributes',...sources],{cwd:fixture});
    execFileSync('git',['-c','core.autocrlf=true','checkout-index','--prefix='+output+path.sep,'--',...sources],{cwd:fixture});
    for(const file of sources)assert.equal(hash(await readFile(path.join(output,file))),hash(await readFile(path.join(root,file))),file);
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('CJK font routes serve the reviewed bytes and same-origin stylesheet without provider configuration',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'leafhour-cjk-http-'));
  const server=await createReaderServer({bookPath:path.join(dir,'missing.json'),recordsPath:path.join(dir,'records.json'),portalDataDir:path.join(dir,'portal'),allowLocal:false,env:{},sendCode:null,translator:null,speechProvider:null,dialogueGenerator:null,guideGenerator:null,chatGenerator:null,companionGenerator:null,introductionGenerator:null,giftQuoteGenerator:null,paddleProvider:null});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
  try{
    for(const font of manifest.fonts){const response=await fetch(base+'/fonts/noto-serif-sc/'+font.file);assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'font/woff2');assert.equal(hash(Buffer.from(await response.arrayBuffer())),font.sha256);assert.match(response.headers.get('content-security-policy'),/default-src 'self'/);}
    const css=await fetch(base+'/fonts/noto-serif-sc/font-faces.css');assert.equal(css.status,200);assert.match(css.headers.get('content-type'),/^text\/css/);assert.equal(await css.text(),await readFile(path.join(fontDir,'font-faces.css'),'utf8'));
    assert.equal((await fetch(base+'/fonts/noto-serif-sc/not-a-bundled-file.woff2')).status,404);
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await rm(dir,{recursive:true,force:true});}
});

test('Canvas requests only actual unique CJK card characters, including new characters on subsequent previews',async()=>{
  const calls=[],fonts={load:async(...args)=>{calls.push(args);return [{}];}};
  assert.deepEqual(await ensureShareCjkFonts(fonts,'Alice’s 中文中文'),{needed:true,failed:false});
  assert.deepEqual(calls,[['normal 48px "Leafhour CJK"','中文']]);
  await ensureShareCjkFonts(fonts,'日本語');assert.equal(calls[1][1],'日本語');
  await ensureShareCjkFonts(fonts,'English only');assert.equal(calls.length,2);
  assert.equal((await ensureShareCjkFonts({load:async()=>{throw Error('offline');}},'中文')).failed,true);
  assert.equal((await ensureShareCjkFonts({load:async()=>[]},'中文')).failed,true);
  assert.equal((await ensureShareCjkFonts(undefined,'中文')).failed,true);
  const book={bookId:'fixture',contentVersion:'fixture',sourceLanguage:'zh',title:{zh:'中文书'},chapters:[{id:'c',number:1}],sections:[{chapterId:'c',number:1,paragraphs:[{id:'p',original:'中文原文',translations:{},source:{}}]}]};
  const model=buildShareModel(book,paragraphSnapshot(book,book.sections[0].paragraphs[0],'c','en'),{language:'en'});assert.equal(model.blocks[0].primary.language,'en');
  for(const stack of [shareFonts.en,shareFontFallbacks.en]){assert.ok(stack.includes('"Leafhour CJK"'));assert.ok(stack.indexOf('Georgia')<stack.indexOf('"Leafhour CJK"'));}
});

test('public build accepts only the exact CJK bundle and rejects jointly forged metadata, bytes and unknown faces',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'leafhour-cjk-public-policy-'));
  try{const fonts=path.join(dir,'fonts/noto-serif-sc');await mkdir(path.dirname(fonts),{recursive:true});await cp(fontDir,fonts,{recursive:true});await checkPublicBuild(dir);
    const target=manifest.fonts[0],bytes=await readFile(path.join(fonts,target.file));bytes[100]^=255;await writeFile(path.join(fonts,target.file),bytes);await assert.rejects(checkPublicBuild(dir),/CJK font bytes/);
    const forged=structuredClone(manifest);forged.fonts[0].sha256=hash(bytes);await writeFile(path.join(fonts,'manifest.json'),JSON.stringify(forged));await assert.rejects(checkPublicBuild(dir),/independently approved/);
    await writeFile(path.join(fonts,'manifest.json'),JSON.stringify(manifest));await writeFile(path.join(fonts,target.file),await readFile(path.join(fontDir,target.file)));
    await writeFile(path.join(fonts,'unknown.woff2'),Buffer.from('wOF2 unknown'));await assert.rejects(checkPublicBuild(dir),/未登记的字体文件/);
  }finally{await rm(dir,{recursive:true,force:true});}
});
