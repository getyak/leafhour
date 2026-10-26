import test from 'node:test';
import assert from 'node:assert/strict';
const location=()=>import('../app/reader-location.mjs').catch(()=>({}));
test('chapter progress measures only this rendered chapter and reaches its visible end',async()=>{
 const {chapterScrollProgress:progress}=await location();assert.equal(typeof progress,'function');
 assert.equal(progress({top:80,bottom:2080,viewport:800,inset:80}),0);
 assert.equal(progress({top:-560,bottom:1440,viewport:800,inset:80}),.5);
 assert.equal(progress({top:-1200,bottom:800,viewport:800,inset:80}),1);
 assert.equal(progress({top:-1900,bottom:100,viewport:800,inset:80}),1);
 // Appending the next chapter does not change the measured chapter rectangle.
 assert.equal(progress({top:-560,bottom:1440,viewport:800,inset:80,documentHeight:90000}),.5);
});
test('unlaid out, empty, nonfinite or occluded geometry is unknown, never a fake zero',async()=>{
 const {chapterScrollProgress:progress}=await location();assert.equal(typeof progress,'function');
 for(const patch of [{bottom:80},{bottom:NaN},{top:Infinity},{viewport:0},{inset:800}])assert.equal(progress({top:80,bottom:2080,viewport:800,inset:80,...patch}),null);
 assert.equal(progress({top:80,bottom:400,viewport:800,inset:80}),1,'the whole short chapter is visible');
 assert.equal(progress({top:900,bottom:1200,viewport:800,inset:80}),0,'a short chapter below view is not complete');
});
test('chapter numbering distinguishes real body chapters, fragments and named frontmatter',async()=>{
 const {locationChapter}=await location();assert.equal(typeof locationChapter,'function');
 const chapters=[{id:'front',kind:'frontmatter',title:{zh:'Preface'}},{id:'a',kind:'body',number:5},{id:'b',kind:'body',number:9}];
 assert.deepEqual(locationChapter({chapters},'b'),{id:'reader.location.chapter',params:{number:2,count:2}});
 assert.deepEqual(locationChapter({chapters},'front'),{title:'Preface'});
 assert.deepEqual(locationChapter({chapters,source:{structure:'automatic_groups'}},'a'),{id:'reader.location.fragment',params:{number:2,count:3}});
 assert.equal(locationChapter({chapters},'missing'),null);
});
test('local reader serves the location enhancement as executable code',async()=>{
 const {createReaderServer}=await import('../server/server.mjs'),fs=await import('node:fs/promises'),os=await import('node:os'),path=await import('node:path');
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'reader-location-')),server=await createReaderServer({bookPath:root+'/missing.json',recordsPath:root+'/records.json',portalDataDir:root+'/portal',env:{},allowLocal:true});
 try{await new Promise(r=>server.listen(0,'127.0.0.1',r));const response=await fetch('http://127.0.0.1:'+server.address().port+'/reader-location.mjs');assert.equal(response.status,200);assert.match(response.headers.get('content-type'),/javascript/);assert.match(await response.text(),/mountReaderLocation/);}finally{await new Promise(r=>server.close(r));await fs.rm(root,{recursive:true,force:true});}
});
test('display subscription follows layout and locale, delegates reveal and releases stale callbacks',async()=>{
 const {fixture}=await import('./annotation-dom-fixture.mjs'),{requestUiRoute}=await import('../app/ui-locale.mjs');await requestUiRoute('en');
 const {mountReaderLocation}=await location();assert.equal(typeof mountReaderLocation,'function');
 const {document,win}=fixture('<body class="is-focused"><header id="reading-header"></header><button id="open-book-info"></button><button id="open-chapter"></button><span id="running-progress"></span><div id="reading-pages"><article id="chapter-text"><section data-chapter-id="a"><p class="passage">Original</p></section></article></div><button id="reading-tools-trigger" aria-describedby="existing"></button><output id="page-position">Two pages · 2 / 5</output></body>');
 let resize,disconnected=0;win.ResizeObserver=class{constructor(fn){resize=fn;}observe(){}disconnect(){disconnected++;}};
 const book={title:{zh:'完整书名📚'},chapters:[{id:'a',kind:'body',title:{zh:'完整章节名'},number:1}],sections:[{chapterId:'a',paragraphs:[{id:'p',original:'Original'}]}]};
 let top=24;document.querySelector('[data-chapter-id]').getBoundingClientRect=()=>({top,bottom:top+2000});
 const revealed=[],tools={toolbar:{reveal:(...args)=>revealed.push(args)}},reader={getBook:()=>book,getChapterId:()=> 'a'};
 const before=win.requestAnimationFrame,frames=[];win.requestAnimationFrame=fn=>{frames.push(fn);return before(fn);};
 const handle=mountReaderLocation({document,tools,getReader:()=>reader});win.flushFrames();
 assert.match(document.getElementById('reading-location').textContent,/Chapter 1 \/ 1 · 0% within chapter/);
 assert.equal(document.getElementById('open-chapter').title,'完整章节名');
 top=-538;resize();win.flushFrames();assert.equal(document.getElementById('running-progress').textContent,'50%');
 document.body.dataset.paginated='true';document.dispatchEvent(new Event('reader:page'));win.flushFrames();assert.equal(document.getElementById('running-progress').textContent,'2 / 5');assert.equal(document.getElementById('running-progress').getAttribute('aria-label'),'Two pages · 2 / 5');assert.doesNotMatch(document.getElementById('reading-location').textContent,/%/);
 const move=new Event('pointermove');Object.assign(move,{pointerType:'mouse',clientY:8,buttons:0});document.dispatchEvent(move);assert.deepEqual(revealed,[[false]]);
 const stale=frames.at(-1);document.dispatchEvent(new Event('reader:session-changed'));stale();resize();win.flushFrames();
 assert.equal(disconnected,1);assert.equal(document.getElementById('reading-location'),null);assert.equal(document.getElementById('reading-tools-trigger').getAttribute('aria-describedby'),'existing');
 document.dispatchEvent(move);assert.equal(revealed.length,1);await requestUiRoute('ja');handle.unmount();assert.equal(disconnected,1);
});
test('a location module resolved after reader disposal cannot mount a new subscription',async()=>{
 const fs=await import('node:fs/promises'),vm=await import('node:vm');const source=await fs.readFile(new URL('../app/reader.js',import.meta.url),'utf8');
 const statement=source.split('\n').find(line=>line.startsWith('void import(')&&line.includes('mountReaderLocation'));assert.ok(statement);
 let mounts=0;vm.runInNewContext(statement.replace(/import\([^)]+\)/,'loading'),{loading:Promise.resolve({mountReaderLocation:()=>mounts++}),readerDisposed:true,document:{},readerTools:{}});await Promise.resolve();await Promise.resolve();assert.equal(mounts,0);
});
