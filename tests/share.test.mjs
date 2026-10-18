import test from 'node:test';
import {readFile} from 'node:fs/promises';
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

// GET-190: canvas sharing presents emphasis from full immutable source
// ranges. Canonical model text and offsets stay exact; only the drawn runs
// omit syntax markers and use a real italic face.
const emBook={bookId:'em',contentVersion:'v1',title:{zh:'一本书',en:'A book'},author:'An Author',visibility:'public',source:{format:'txt'},chapters:[{id:'c1',number:1}],sections:[{chapterId:'c1',number:1,paragraphs:[{id:'p1',original:'She said _never_ leave.',translations:{interpretive:{text:'她说 _never_ 离开。'},literal:{text:'她说 _never_ 离开。'}}}]}]};
const emText=emBook.sections[0].paragraphs[0].original;

test('a selected original slice keeps canonical raw text while drawing runs from full-source ranges',async()=>{
 const {buildShareModel,layoutShareCard,emphasisDisplayRuns}=await model();assert.equal(typeof buildShareModel,'function');
 const snapshot={bookId:'em',contentVersion:'v1',chapterId:'c1',parts:[{passageId:'p1',language:'en',variant:'interpretive',start:9,end:14,text:emText.slice(9,14)}]};
 const share=buildShareModel(emBook,snapshot,{language:'en'});
 assert.equal(share.blocks[0].primary.text,'_neve','the saved model text is the exact immutable slice');
 assert.deepEqual(share.blocks[0].primary.emphasis,[{start:1,end:5,open:true,close:false}]);
 assert.equal(share.blocks[0].sourceStart,9);assert.equal(share.blocks[0].sourceEnd,14);
 assert.ok(JSON.stringify(share).includes('_neve'),'markers are never silently stripped from model fields');
 const display=emphasisDisplayRuns(share.blocks[0].primary.text,share.blocks[0].primary.emphasis);
 assert.equal(display.map(r=>r.text).join(''),'neve');
 assert.deepEqual(display.filter(r=>r.italic).map(r=>r.text),['neve']);
 const layout=layoutShareCard(share,{language:'en',size:48,theme:'paper'},text=>[...text].length*12);
 const quote=layout.items.find(i=>i.kind==='quote');
 assert.equal(quote.runs.map(line=>line.map(r=>r.text).join('')).join(''),'neve');
 assert.equal(quote.lines.join(''),'neve','the drawn card omits only the syntax markers');
 assert.ok(quote.runs.flat().some(r=>r.italic));
});

test('whole-paragraph counterparts format their own full source ranges and translations stay literal',async()=>{
 const {buildShareModel,layoutShareCard}=await model();
 const snapshot={bookId:'em',contentVersion:'v1',chapterId:'c1',parts:[{passageId:'p1',language:'zh',variant:'interpretive',start:0,end:2,text:'她说'}]};
 const share=buildShareModel(emBook,snapshot,{language:'en'});
 const counterpart=share.blocks[0].primary;
 assert.equal(counterpart.text,emText);
 assert.deepEqual(counterpart.emphasis,[{start:10,end:15,open:true,close:true}]);
 const layout=layoutShareCard(share,{language:'en',size:48,theme:'paper'},text=>[...text].length*12);
 const quote=layout.items.find(i=>i.kind==='quote');
 assert.equal(quote.runs.map(line=>line.map(r=>r.text).join('')).join(''),'She said never leave.');
 assert.deepEqual(quote.runs.flat().filter(r=>r.italic).map(r=>r.text),['never']);
 const translation=buildShareModel(emBook,{...snapshot,parts:[{...snapshot.parts[0],language:'zh'}]},{language:'zh'});
 assert.equal(translation.blocks[0].primary.emphasis,undefined,'translation display never interprets underscores');
 assert.equal(translation.blocks[0].primary.text,'她说');
});

test('emphasis display runs cover the visible slice exactly once without splitting surrogate pairs',async()=>{
 const {emphasisDisplayRuns,emphasisSourceRuns,sliceEmphasisRanges,sourceEmphasisRanges}=await model();
 const text='😀 said _never_ 😀',ranges=sourceEmphasisRanges(text);
 assert.deepEqual(ranges,[{start:9,end:14}]);
 for(const [start,end] of [[0,text.length],[7,16],[8,16],[10,14]]){
  const slice=text.slice(start,end),runs=emphasisSourceRuns(slice,sliceEmphasisRanges(ranges,start,end));
  assert.equal(runs.map(r=>r.text).join(''),slice);
  assert.ok(runs.every(r=>r.text.isWellFormed()));
  assert.equal(runs.filter(r=>!r.marker).map(r=>r.text).join(''),emphasisDisplayRuns(slice,sliceEmphasisRanges(ranges,start,end)).map(r=>r.text).join(''));
 }
});

// Parent repair round: synthetic measure-contract and presentation cases.
// Independent local Canvas diagnostics found no earlier catalog counterexample; these
// pin the wrapping contract itself (exact-candidate measurement, hard breaks,
// clean word/space boundaries), not observed catalog output.
test('wrapping measures each exact candidate string in the style it draws',async()=>{
 const {wrapEmphasisRuns}=await model();
 const measure=t=>t.replaceAll('fi','@').length*3;
 assert.deepEqual(wrapEmphasisRuns([{text:'fifi',italic:false}],measure,4).map(line=>line.map(r=>r.text)),[['fi'],['fi']],'candidate strings are measured whole, never summed per grapheme');
 assert.deepEqual(wrapEmphasisRuns([{text:'fifi',italic:true}],measure,4).map(line=>line.map(r=>r.text)),[['fi'],['fi']]);
 assert.deepEqual(wrapEmphasisRuns([{text:'fi',italic:false},{text:'fi',italic:true}],measure,3).map(line=>line.map(r=>[r.text,r.italic])),[[['fi',false]],[['fi',true]]],'each piece is measured in the style it draws');
});

test('explicit newline hard breaks survive emphasized presentation wrapping',async()=>{
 const {wrapEmphasisRuns,emphasisDisplayRuns,sourceEmphasisRanges,sliceEmphasisRanges}=await model();
 const text='First _line_\nSecond line',ranges=sliceEmphasisRanges(sourceEmphasisRanges(text),0,text.length);
 const lines=wrapEmphasisRuns(emphasisDisplayRuns(text,ranges),t=>[...t].length,100);
 assert.deepEqual(lines.map(line=>line.map(r=>r.text).join('')),['First line','Second line']);
 assert.deepEqual(lines.flat().filter(r=>r.italic).map(r=>r.text),['line']);
});

test('presentation wrapping breaks cleanly at word boundaries without changing canonical text',async()=>{
 const {wrapEmphasisRuns,wrapText}=await model();
 const measure=t=>[...t].length;
 const wrapped=wrapText('foo bar baz',measure,7);
 assert.equal(wrapped[1],'baz','soft wraps never start a line with a space');
 assert.equal(wrapped.join(''),'foo bar baz');
 const styled=wrapEmphasisRuns([{text:'foo bar baz',italic:false}],measure,7);
 assert.equal(styled[1].map(r=>r.text).join(''),'baz');
 assert.equal(styled.flat().map(r=>r.text).join(''),'foo bar baz');
});

test('canvas context keeps full-source provenance ranges and never strips model strings',async()=>{
 const {buildShareModel,layoutShareCard,displayQuoteText}=await model();
 const emBook={bookId:'em',contentVersion:'v1',title:{zh:'一本书',en:'A book'},author:'An Author',visibility:'public',source:{format:'txt'},chapters:[{id:'c1',number:1}],sections:[{chapterId:'c1',number:1,paragraphs:[
  {id:'p0',original:'Earlier _context_ here.',translations:{}},
  {id:'p1',original:'xx _never_ leave _today_.',translations:{}},
  {id:'p2',original:'Later _tail_ text.',translations:{}}]}]};
 const full=emBook.sections[0].paragraphs[1].original,start=full.indexOf('never');
 const snapshot={bookId:'em',contentVersion:'v1',chapterId:'c1',parts:[{passageId:'p1',language:'en',variant:'interpretive',start,end:start+5,text:'never'}]};
 const share=buildShareModel(emBook,snapshot,{language:'en'});
 assert.equal(share.before,'xx _','intra-paragraph context keeps its exact raw slice');
 assert.ok(share.before.includes('_'),'raw model.before keeps syntax markers');
 assert.deepEqual(share.beforeEmphasis,[{start:4,end:4,open:true,close:false}]);
 assert.equal(share.after,'_ leave _today_.','the after window starts right after the selected content, keeping its raw characters');
 assert.equal(share.afterEmphasis.length,2,'after context formats from its own full-source window, including the trailing marker window');
 // a selection at paragraph start falls back to the adjacent paragraph window
 const adjacent=buildShareModel(emBook,{...snapshot,parts:[{...snapshot.parts[0],start:0,end:2,text:'xx'}]},{language:'en'});
 assert.equal(adjacent.before,'Earlier _context_ here.');
 assert.deepEqual(adjacent.beforeEmphasis,[{start:adjacent.before.indexOf('context'),end:adjacent.before.indexOf('context')+7,open:true,close:true}]);
 assert.equal(displayQuoteText(adjacent.before,adjacent.beforeEmphasis),'Earlier context here.');
 assert.equal(adjacent.after,full.slice(2));
 const layout=layoutShareCard(share,{language:'en',size:48,theme:'paper',above:'keep',below:'keep'},text=>[...text].length*6);
 const contexts=layout.items.filter(i=>i.kind==='context');
 assert.equal(contexts.length,2);
 assert.equal(contexts[0].runs.flat().map(r=>r.text).join(''),'xx');
 assert.equal(contexts[1].runs.flat().map(r=>r.text).join(''),'leave today.');
 assert.ok(contexts[1].runs.flat().some(r=>r.italic&&r.text==='today'));
 assert.ok(contexts.every(item=>item.runs.flat().every(r=>!r.marker)));
 // long context keeps style across the two visible lines and the ellipsis
 const longBook={bookId:'em',contentVersion:'v1',title:{zh:'一本书',en:'A book'},author:'An Author',visibility:'public',source:{format:'txt'},chapters:[{id:'c1',number:1}],sections:[{chapterId:'c1',number:1,paragraphs:[{id:'q1',original:'w1 w2 w3 w4 w5 w6 w7 w8 w9 w10 _eleven_ w12',translations:{}}]}]};
 const q=longBook.sections[0].paragraphs[0],at=q.original.indexOf('w12');
 const qShare=buildShareModel(longBook,{bookId:'em',contentVersion:'v1',chapterId:'c1',parts:[{passageId:'q1',language:'en',variant:'interpretive',start:at,end:at+3,text:'w12'}]},{language:'en'});
 const qLayout=layoutShareCard(qShare,{language:'en',size:48,theme:'paper',above:'keep',below:'hide'},text=>[...text].length*55);
 const above=qLayout.items.filter(i=>i.kind==='context');
 assert.equal(above.length,1);
 assert.equal(above[0].lines.length,2);
 assert.equal(above[0].runs[0][0].text,'…');
 assert.ok(above[0].runs.flat().some(r=>r.italic&&r.text==='eleven'),'style survives truncation and the ellipsis');
});

test('accessibility text uses the presented display while canonical model text stays raw',async()=>{
 const {displayQuoteText,sourceEmphasisRanges,sliceEmphasisRanges,shareFonts,ensureShareFonts}=await model();
 const text='Some _very_ nice words.',ranges=sliceEmphasisRanges(sourceEmphasisRanges(text),0,text.length);
 assert.equal(displayQuoteText(text,ranges),'Some very nice words.');
 assert.equal(displayQuoteText('plain _x_',undefined),'plain _x_');
 const share=await readFile(new URL('../app/share.js',import.meta.url),'utf8');
 assert.match(share,/share-preview-description[\s\S]{0,200}displayQuoteText/,'the canvas description must use the presented display');
 assert.ok(shareFonts.en.startsWith('"Leafhour Serif"'),'share Latin display uses the real self-hosted family');
 const loads=[];
 const state=await ensureShareFonts({load:spec=>{loads.push(spec);return Promise.resolve([{}]);}});
 assert.deepEqual(loads,['normal 48px "Leafhour Serif"','italic 48px "Leafhour Serif"'],'upright and italic faces load explicitly before first measure');
 assert.deepEqual({fallback:state.fallback,upright:state.upright,italic:state.italic},{fallback:false,upright:true,italic:true});
 assert.equal((await ensureShareFonts({load:()=>Promise.resolve([])})).fallback,true,'a missing face has an honest fallback boundary');
 assert.equal((await ensureShareFonts({load:()=>Promise.reject(Error('offline'))})).fallback,true);
 assert.equal((await ensureShareFonts(undefined)).fallback,true);
 assert.doesNotMatch(share,/kind==='translation'&&item\.language==='en'/,'no implicit whole-secondary-English italic');
});

test('context ellipses fit the drawn width and retain the two-line clamp',async()=>{
 const {buildShareModel,paragraphSnapshot,layoutShareCard}=await model();
 for(const styled of [false,true]){
  const raw=styled?'_'+'a'.repeat(129)+'_':'a'.repeat(129);
  const book={bookId:'context-fit',contentVersion:'v1',visibility:'public',source:{format:'txt'},title:{en:'Context'},chapters:[{id:'c1',number:1}],sections:[{chapterId:'c1',number:1,paragraphs:[{id:'p0',original:raw},{id:'p1',original:'quote'},{id:'p2',original:raw}]}]};
  const snapshot=paragraphSnapshot(book,book.sections[0].paragraphs[1],'c1','en');
  const share=buildShareModel(book,snapshot,{language:'en'}),before=JSON.stringify(share);
  const measure=(text,size,language,italic=false)=>[...text].length*(italic?21:20);
  const layout=layoutShareCard(share,{language:'en',above:'keep',below:'keep'},measure);
  const contexts=layout.items.filter(item=>item.kind==='context');
  assert.equal(contexts.length,2);
  for(const item of contexts){
   assert.equal(item.lines.length,2,JSON.stringify({styled,side:item.side,lines:item.lines}));
   const widths=item.lines.map((line,i)=>item.runs?item.runs[i].reduce((sum,run)=>sum+measure(run.text,item.fontSize,item.language,run.italic),0):measure(line,item.fontSize,item.language));
   assert.ok(widths.every(width=>width<=item.width),JSON.stringify({styled,side:item.side,widths,max:item.width}));
   assert.ok(item.side==='above'?item.lines[0].startsWith('…'):item.lines.at(-1).endsWith('…'));
  }
  assert.equal(JSON.stringify(share),before,'clipping is display-only');
 }
});

test('styled wrapping preserves consecutive, leading and trailing hard breaks',async()=>{
 const {wrapEmphasisRuns,wrapText}=await model();
 for(const text of ['a\n\nb','\na\n','\n\n','a\n']){
  const runs=[{text,italic:true}];
  assert.deepEqual(wrapEmphasisRuns(runs,t=>t.length,100).map(line=>line.map(run=>run.text).join('')),wrapText(text,t=>t.length,100),JSON.stringify(text));
 }
});
