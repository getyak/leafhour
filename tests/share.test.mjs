import test from 'node:test';
import assert from 'node:assert/strict';
const book={bookId:'b',contentVersion:'v1',title:{zh:'一本书',en:'A book'},author:'An Author',chapters:[{id:'c1',number:1},{id:'c2',number:2}],sections:[{chapterId:'c1',number:1,paragraphs:[{id:'p1',original:'A game continues. A new round begins.',source:{printedPage:3},translations:{interpretive:{text:'游戏继续。新的一轮开始。',review:'draft'},literal:{text:'一场游戏继续。一轮新的游戏开始。',review:'draft'}}},{id:'p2',original:'The purpose matters.',translations:{interpretive:{text:'目的很重要。'},literal:{text:'目的有其重要性。'}}}]},{chapterId:'c2',number:2,paragraphs:[{id:'p3',original:'Next chapter.',translations:{interpretive:{text:'下一章。'}}}]}],comments:[{text:'PRIVATE NOTE MUST NEVER BE EXPORTED'}]};
const snapshot={bookId:'b',contentVersion:'v1',chapterId:'c1',parts:[{passageId:'p1',language:'zh',variant:'interpretive',start:0,end:5,text:'游戏继续。'}]};
const model=()=>import('../app/share-model.mjs').catch(()=>({}));

test('Chinese source excerpts keep their selected characters and original authorship',async()=>{
 const {buildShareModel,paragraphSnapshot}=await model(),chinese={...book,sourceLanguage:'zh',source:{structure:'automatic_groups'},sections:[{chapterId:'c1',number:1,paragraphs:[{id:'p1',original:'保留原文，再写自己的问题。',translations:{}}]}]};
 const p=chinese.sections[0].paragraphs[0],snap=paragraphSnapshot(chinese,p,'c1','en');
 const share=buildShareModel(chinese,snap,{language:'en'});
 assert.equal(share.blocks[0].primary.text,'保留原文，再写自己的问题。');assert.equal(share.blocks[0].primary.label,'中文原文');assert.equal(share.blocks[0].secondary,null);
 assert.match(share.location,/^阅读片段 1/);
});

test('a shared excerpt preserves selected words and labels paragraph-level bilingual evidence',async()=>{
 const m=await model();assert.equal(typeof m.buildShareModel,'function','sharing requires a source-bound model');
 const share=m.buildShareModel(book,snapshot,{language:'bilingual',variant:'interpretive'});
 assert.equal(share.blocks[0].primary.text,'游戏继续。');assert.equal(share.blocks[0].secondary.text,book.sections[0].paragraphs[0].original);
 assert.match(share.blocks[0].secondary.label,/整段/);assert.equal(share.after,'新的一轮开始。');assert.equal(share.author,'An Author');
 assert.ok(!JSON.stringify(share).includes('PRIVATE NOTE'));
 const whole={...snapshot,parts:[{...snapshot.parts[0],end:12,text:'游戏继续。新的一轮开始。'}]};
 const aligned=m.buildShareModel(book,whole,{language:'bilingual'});assert.ok(!aligned.blocks[0].secondary.label.includes('整段'));
});

test('a changed source, wrong book or mixed-language range cannot silently become a quote',async()=>{
 const {buildShareModel}=await model();assert.equal(typeof buildShareModel,'function');
 assert.throws(()=>buildShareModel(book,{...snapshot,bookId:'wrong'},{}),/书籍|版本/);
 assert.throws(()=>buildShareModel(book,{...snapshot,parts:[{...snapshot.parts[0],text:'作者没有说过这句话'}]},{}),/原文|摘录/);
 assert.throws(()=>buildShareModel(book,{...snapshot,parts:[...snapshot.parts,{passageId:'p2',language:'en',start:0,end:19,text:'The purpose matters.'}]},{}),/语言/);
 assert.throws(()=>buildShareModel(book,{...snapshot,parts:[{passageId:'p3',language:'zh',variant:'interpretive',start:0,end:4,text:'下一章。'}]},{}),/章节/);
});

test('switching translation cannot fabricate a sentence-level alignment',async()=>{
 const {buildShareModel}=await model();assert.equal(typeof buildShareModel,'function');
 const english={...snapshot,parts:[{passageId:'p1',language:'en',variant:'interpretive',start:0,end:17,text:'A game continues.'}]};
 const share=buildShareModel(book,english,{language:'bilingual',variant:'literal'});
 assert.equal(share.blocks[0].primary.text,'A game continues.');assert.equal(share.blocks[0].secondary.text,book.sections[0].paragraphs[0].translations.literal.text);assert.match(share.blocks[0].secondary.label,/直译.*整段/);
 const changed=buildShareModel(book,snapshot,{language:'zh',variant:'literal'});assert.equal(changed.blocks[0].primary.text,book.sections[0].paragraphs[0].translations.literal.text);assert.match(changed.blocks[0].primary.label,/整段/);
});

test('wrapping preserves Unicode and long words without losing selected characters',async()=>{
 const {wrapText}=await model();assert.equal(typeof wrapText,'function');
 const measure=text=>[...text].length*10;
 for(const value of ['😀游戏一直继续，直到彼此愿意。','A verylongunbreakableword continues.','a\n\nb','é 游戏']){
  const lines=wrapText(value,measure,65);assert.equal(lines.join(''),value.replaceAll('\n',''));for(const line of lines)assert.ok(measure(line)<=65||[...line].length<=1);assert.ok(lines.every(x=>x.isWellFormed()));
 }
});

test('share preferences are bounded and long layouts extend rather than clipping the quote',async()=>{
 const {normaliseShareOptions,layoutShareCard}=await model();assert.equal(typeof normaliseShareOptions,'function');assert.equal(typeof layoutShareCard,'function');
 const opts=normaliseShareOptions({theme:'url(secret)',ratio:'wrong',size:999,above:'invalid',source:false});assert.equal(opts.theme,'paper');assert.equal(opts.ratio,'portrait');assert.ok(opts.size<=56);assert.equal(opts.above,'fade');assert.equal(opts.source,false);
 const share={title:'一本书',author:'A',location:'§1',before:'上文',after:'下文',blocks:[{primary:{text:'游戏继续。'.repeat(200),language:'zh',label:'意译'},secondary:null}]};
 const layout=layoutShareCard(share,normaliseShareOptions({above:'hide',below:'hide'}),text=>[...text].length*45);
 assert.ok(layout.height>1350);assert.equal(layout.quoteCharacters,share.blocks[0].primary.text.length);assert.equal(layout.items.filter(i=>i.kind==='context').length,0);assert.ok(layout.items.every(i=>i.y+i.height<=layout.height));
});

test('share assets are served locally while private library and harness files remain inaccessible',async t=>{
 const {mkdtemp,writeFile,rm}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const path=await import('node:path');const {createReaderServer}=await import('../server/server.mjs');
 const dir=await mkdtemp(path.join(tmpdir(),'share-http-'));await writeFile(path.join(dir,'book.json'),JSON.stringify(book));
 const server=await createReaderServer({bookPath:path.join(dir,'book.json'),recordsPath:path.join(dir,'records.json')});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(async()=>{await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});});
 const root='http://127.0.0.1:'+server.address().port;
 for(const file of ['share.js','share-model.mjs','share.css']){const r=await fetch(root+'/'+file);assert.equal(r.status,200,file+' must be locally available');assert.ok((await r.text()).length>100);}
 assert.equal((await fetch(root+'/harness/generator.mjs')).status,404);assert.equal((await fetch(root+'/local/finite-infinite-games/book.json')).status,404);
});

test('paragraph-alignment labels have drawable coordinates in exported images',async()=>{
 const {buildShareModel,layoutShareCard}=await model();
 for(const language of ['en','bilingual']){
  const share=buildShareModel(book,snapshot,{language});const layout=layoutShareCard(share,{language},text=>[...text].length*12);
  const labels=layout.items.filter(i=>i.kind==='label');assert.ok(labels.some(i=>i.lines.join('').includes('整段')));
  for(const label of labels)for(const [i]of label.lines.entries())assert.ok(Number.isFinite(label.y+i*label.lineHeight),'alignment label must paint rather than silently using NaN');
 }
});

test('Chinese closing punctuation stays with a preceding character rather than starting a line',async()=>{
 const {wrapText}=await model();const lines=wrapText('游戏继续，读下去。',s=>[...s].length*10,40);
 assert.equal(lines.join(''),'游戏继续，读下去。');assert.ok(lines.every(line=>!line||!/[，。！？；：）】]/u.test(line[0])));assert.ok(lines.every(line=>[...line].length<=4));
});

test('changing a whole-paragraph translation uses neighboring context, never a tail from old offsets',async()=>{
 const {buildShareModel}=await model();const full={...snapshot,parts:[{...snapshot.parts[0],end:12,text:'游戏继续。新的一轮开始。'}]};
 const changed=buildShareModel(book,full,{language:'zh',variant:'literal'});
 assert.equal(changed.blocks[0].primary.text,'一场游戏继续。一轮新的游戏开始。');assert.equal(changed.before,'');assert.equal(changed.after,'目的有其重要性。');
});
