import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir,mkdtemp,rm,writeFile,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {checkPublicBuild} from '../tools/check-public-build.mjs';
import {releaseFiles} from '../tools/release-policy.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const fontDir=path.join(root,'app/fonts/newsreader');
const manifest=JSON.parse(await readFile(path.join(fontDir,'manifest.json'),'utf8'));
const productPages=['home.html','index.html','book-gift.html','en/mcp.html','en/privacy.html','zh-hans/mcp.html','zh-hans/privacy.html','zh-hant/mcp.html','zh-hant/privacy.html','ja/mcp.html','ja/privacy.html'];

test('the self-hosted Newsreader faces keep their reviewed bytes, license and metrics',async()=>{
  assert.equal(manifest.license,'OFL-1.1');
  assert.equal(manifest.sourceCommit,'8b0a1d0f5983c89bc2b93f1b5fb55f9e252744b5');
  assert.match(manifest.sourceRepository,/^https:\/\/github\.com\/google\/fonts$/);
  assert.match(manifest.designerRepository,/^https:\/\/github\.com\/productiontype\/Newsreader$/);
  const seen=new Set();
  for(const entry of manifest.fonts){
    assert.ok(['newsreader-var.woff2','newsreader-italic-var.woff2'].includes(entry.file),'unexpected font in manifest: '+entry.file);
    seen.add(entry.file);
    assert.equal(entry.format,'woff2');
    assert.equal(entry.cjkGlyphs,false,'Newsreader must stay Latin-only so Chinese falls through to Songti/Noto Serif CJK');
    assert.equal(entry.unitsPerEm,2000);
    assert.deepEqual([entry.axes.wght[0],entry.axes.wght[2]],[200,800]);
    assert.deepEqual([entry.axes.opsz[0],entry.axes.opsz[2]],[6,72]);
    const bytes=await readFile(path.join(fontDir,entry.file));
    assert.equal(bytes.length,entry.bytes,entry.file+' byte size drifted from the reviewed build');
    assert.equal(createHash('sha256').update(bytes).digest('hex'),entry.sha256,entry.file+' content drifted from the reviewed build');
    assert.equal(bytes.subarray(0,4).toString('latin1'),'wOF2',entry.file+' must stay WOFF2');
  }
  assert.deepEqual([...seen].sort(),['newsreader-italic-var.woff2','newsreader-var.woff2']);
  const upright=manifest.fonts.find(entry=>entry.file==='newsreader-var.woff2');
  assert.equal(upright.apostropheAdvance,455,'the U+2019 apostrophe must keep its narrow 455/2000 advance');
  const license=await readFile(path.join(fontDir,'OFL.txt'),'utf8');
  assert.match(license,/SIL Open Font License, Version 1\.1/);
  assert.match(license,/Copyright 2020 The Newsreader Project Authors/);
  const readme=await readFile(path.join(fontDir,'README.md'),'utf8');
  for(const expected of ['OFL-1.1','8b0a1d0f5983c89bc2b93f1b5fb55f9e252744b5','productiontype/Newsreader','fontTools'])assert.ok(readme.includes(expected),'font attribution README misses '+expected);
});

test('the shared typography module declares local swap-faced fonts and the ordered alias',async()=>{
  const css=await readFile(path.join(root,'app/typography.css'),'utf8');
  assert.doesNotMatch(css,/https?:\/\//,'the typography module must not pull any external font');
  assert.equal((css.match(/@font-face/g)||[]).length,2,'exactly one upright and one italic face');
  for(const block of css.match(/@font-face\s*{[^}]*}/g)){
    assert.match(block,/font-display:\s*swap/);
    assert.match(block,/font-weight:\s*200 800/);
    assert.match(block,/url\("\/fonts\/newsreader\/newsreader-(?:italic-)?var\.woff2"\) format\("woff2"\)/);
    assert.doesNotMatch(block,/url\((?!["']?\/fonts\/newsreader\/)/,'faces must load from the self-hosted path only');
  }
  const italic=css.match(/@font-face\s*{[^}]*font-style:\s*italic[^}]*}/);
  assert.ok(italic,'the italic face must be declared');
  for(const stack of ['--font-serif','--font-latin']){
    const line=new RegExp(stack+':\\s*([^;]+);').exec(css);
    assert.ok(line,stack+' is missing');
    const value=line[1];
    const ordered=['"Leafhour Serif"','"Iowan Old Style"','Georgia','"Songti SC"','"Noto Serif CJK SC"'].map(name=>value.indexOf(name));
    assert.ok(ordered.every(index=>index>=0),stack+' must keep Leafhour Serif → Iowan/Georgia → Songti/Noto Serif CJK: '+value);
    assert.deepEqual([...ordered].sort((a,b)=>a-b),ordered,stack+' must place Latin fonts before any CJK font so apostrophes never fall through: '+value);
  }
  const cjk=/--font-cjk-serif:\s*([^;]+);/.exec(css);
  assert.ok(cjk&&/Songti SC/.test(cjk[1])&&/Noto Serif CJK SC/.test(cjk[1]),'Chinese glyphs must keep Songti / Noto Serif CJK');
});

test('every product page loads the shared typography module and only the first screen preloads the upright face',async()=>{
  const upright='/fonts/newsreader/newsreader-var.woff2';
  for(const page of productPages){
    const html=await readFile(path.join(root,'app',page),'utf8');
    assert.ok(html.includes('<link rel="stylesheet" href="/typography.css">'),page+' misses the shared typography module');
    assert.doesNotMatch(html,/fonts\.(?:googleapis|gstatic)\.com|use\.typekit\.net|fonts\.adobe\.com/,page+' must not request external fonts');
    const preloads=[...html.matchAll(/<link rel="preload" href="([^"]+)" as="font" type="font\/woff2" crossorigin>/g)].map(match=>match[1]);
    for(const href of preloads)assert.equal(href,upright,page+' may preload only the upright first-screen face');
    if(['home.html','index.html'].includes(page))assert.deepEqual(preloads,[upright],page+' must preload exactly the upright face');
    else assert.deepEqual(preloads,[],page+' stays lazy outside the first-screen entry pages');
    assert.doesNotMatch(html,/newsreader-italic-var\.woff2"[^>]*rel="preload"|rel="preload"[^>]*newsreader-italic/,page+' must not preload italic');
  }
});

test('functional type keeps a 12px floor and em/token tracking across product CSS',async()=>{
  // Documented decorative exceptions: reproduced cover art (cover-inner,
  // binding-), mailed-paper marks (envelope-*, letter-mark, colophon), the
  // hero desk-scene mock (open-book, margin-note, page-running, scene-*),
  // brand wordmark microtype (brand-name small) and ornamental glyphs.
  const decorative=/cover-inner|cover-ornament|binding-|envelope-|gift-colophon|letter-mark|scene-caption|scene-index|note-bottom|margin-note|open-book|page-running|brand-name|print-lines|ornament|book-info-cover/;
  const selectorBefore=(text,pos)=>{const brace=text.lastIndexOf('{',pos);if(brace<0)return '';const start=Math.max(text.lastIndexOf('}',brace-1),text.lastIndexOf('{',brace-1));return text.slice(start+1,brace);};
  for(const file of await readdir(path.join(root,'app'))){
    if(!file.endsWith('.css')||['evals.css','source-review.css'].includes(file))continue;
    const text=await readFile(path.join(root,'app',file),'utf8');
    for(const match of text.matchAll(/font-size:\s*([\d.]+)px/g)){
      if(Number(match[1])>=12)continue;
      assert.ok(decorative.test(selectorBefore(text,match.index)),`${file}: functional text dropped below 12px (${match[0]} in ${selectorBefore(text,match.index)})`);
    }
    for(const match of text.matchAll(/font:(?:[a-z]+\s+)*(?:\d+\s+)?([\d.]+)px/g)){
      if(Number(match[1])>=12)continue;
      assert.ok(decorative.test(selectorBefore(text,match.index)),`${file}: functional shorthand text dropped below 12px (${match[0]})`);
    }
    assert.doesNotMatch(text,/letter-spacing:\s*[-\d.]+px/,'tracking must stay em/token based, never px: '+file);
  }
});

test('authored title, path and sample text stays byte-for-byte, including Alice’s apostrophe',async()=>{
  const home=await readFile(path.join(root,'app/home.html'),'utf8');
  assert.ok(home.includes('“一本书如果没有图画，也没有对话，那有什么用呢？”爱丽丝想。'),'the reading sample must not be reworded');
  const locale=await readFile(path.join(root,'app/home-locale.mjs'),'utf8');
  for(const sample of ['Alice’s Adventures in Wonderland · Reading example','Open Alice’s Adventures in Wonderland']){
    assert.ok(locale.includes(sample),'authored label changed: '+sample);
    assert.ok(!locale.includes(sample.replace('\u2019',"'")),'the apostrophe character itself must never be rewritten');
  }
  const excerpt=await readFile(path.join(root,'app/arrival-catalog.mjs'),'utf8');
  assert.ok(excerpt.includes('Shebek’s private'),'authored source excerpt changed');
});

test('the release allowlist and public build policy carry the fonts and shared stylesheet',async()=>{
  const allowed=await releaseFiles(root);
  for(const file of ['app/typography.css','app/fonts/newsreader/newsreader-var.woff2','app/fonts/newsreader/newsreader-italic-var.woff2','app/fonts/newsreader/OFL.txt','app/fonts/newsreader/manifest.json','app/fonts/newsreader/README.md'])assert.ok(allowed.includes(file),'release allowlist misses '+file);
  const dist=await mkdtemp(path.join(tmpdir(),'leafhour-typography-dist-'));
  try{
    await writeFile(path.join(dist,'index.html'),'<!doctype html>');
    const fonts=path.join(dist,'fonts/newsreader');
    const {mkdir}=await import('node:fs/promises');
    await mkdir(fonts,{recursive:true});
    for(const file of ['manifest.json','OFL.txt','newsreader-var.woff2','newsreader-italic-var.woff2']){
      await writeFile(path.join(fonts,file),await readFile(path.join(fontDir,file)));
    }
    const checked=await checkPublicBuild(dist);
    assert.ok(checked.files>0);
    const tamper=await readFile(path.join(fonts,'newsreader-var.woff2'));
    tamper[100]^=0xff;
    await writeFile(path.join(fonts,'newsreader-var.woff2'),tamper);
    await assert.rejects(checkPublicBuild(dist),/字体校验不一致/);
    await writeFile(path.join(fonts,'newsreader-var.woff2'),await readFile(path.join(fontDir,'newsreader-var.woff2')));
    await writeFile(path.join(fonts,'substitute.woff2'),Buffer.alloc(2048));
    await assert.rejects(checkPublicBuild(dist),/未登记的字体文件/);
    await rm(path.join(fonts,'substitute.woff2'));
    const tamperedManifest={...manifest,license:'MIT'};
    await writeFile(path.join(fonts,'manifest.json'),JSON.stringify(tamperedManifest));
    await assert.rejects(checkPublicBuild(dist),/字体许可/);
    await writeFile(path.join(fonts,'manifest.json'),JSON.stringify(manifest));
    await writeFile(path.join(fonts,'newsreader-italic-var.woff2'),Buffer.alloc(210*1024,1));
    await assert.rejects(checkPublicBuild(dist),/未登记的大文件|字体校验不一致/);
  }finally{await rm(dist,{recursive:true,force:true});}
});

test('the font size exemption rejects joint manifest/file substitution and duplicate face entries',async()=>{
  const dist=await mkdtemp(path.join(tmpdir(),'leafhour-font-trust-'));
  try{
    const fonts=path.join(dist,'fonts/newsreader');
    const {mkdir}=await import('node:fs/promises');await mkdir(fonts,{recursive:true});
    await writeFile(path.join(fonts,'OFL.txt'),await readFile(path.join(fontDir,'OFL.txt')));
    const forged=structuredClone(manifest);
    for(const entry of forged.fonts){
      const payload=Buffer.alloc(220*1024,65);payload.write('wOF2');
      entry.bytes=payload.length;entry.sha256=createHash('sha256').update(payload).digest('hex');
      await writeFile(path.join(fonts,entry.file),payload);
    }
    await writeFile(path.join(fonts,'manifest.json'),JSON.stringify(forged));
    await assert.rejects(checkPublicBuild(dist),/未匹配已审阅/,'editing both content and its manifest cannot grant a new large-file exemption');
    for(const entry of manifest.fonts)await writeFile(path.join(fonts,entry.file),await readFile(path.join(fontDir,entry.file)));
    await rm(path.join(fonts,'newsreader-italic-var.woff2'));
    await writeFile(path.join(fonts,'manifest.json'),JSON.stringify({...manifest,fonts:[manifest.fonts[0],manifest.fonts[0]]}));
    await assert.rejects(checkPublicBuild(dist),/不允许的字体资源/,'each approved face appears exactly once');
  }finally{await rm(dist,{recursive:true,force:true});}
});
