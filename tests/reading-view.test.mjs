import {t as uiText,requestUiRoute,createUiLabels} from '../app/ui-locale.mjs';
test.beforeEach(async()=>{await requestUiRoute('zh-Hans');});
test.afterEach(async()=>{await requestUiRoute('en');});
import test from 'node:test';
import assert from 'node:assert/strict';
const fixture=()=>({bookId:'b',contentVersion:'v',sourceLanguage:'zh',title:{zh:'Example'},source:{format:'pdf'},chapters:[{id:'one'},{id:'two'},{id:'three'}],annotations:[],glossary:[],sections:[{number:1,chapterId:'one',paragraphs:[{id:'a',original:'甲'.repeat(180000),translations:{}}]},{number:2,chapterId:'two',paragraphs:[{id:'b',original:'乙',translations:{}}]},{number:3,chapterId:'three',paragraphs:[{id:'c',original:'丙',translations:{literal:{text:'译文'}}}]}]});

test('large reading view keeps all anchors but sends only the requested real chapter',async()=>{
 const {readingView,readingChapter}=await import('../server/reading-view.mjs');const original=fixture(),before=structuredClone(original),view=readingView(original,{passageId:'b'});
 assert.equal(view.reading.partial,true);assert.deepEqual(view.reading.loadedChapters,['two']);assert.equal(view.reading.hasTranslations,true);
 assert.deepEqual(view.sections.map(s=>s.paragraphs.map(p=>p.id)),[['a'],['b'],['c']]);assert.equal(view.sections[1].paragraphs[0].original,'乙');assert.deepEqual(view.sections[0].paragraphs[0],{id:'a',unloaded:true});assert.ok(JSON.stringify(view).length<3000);assert.deepEqual(original,before);
 assert.equal(readingChapter(original,'three','v').sections[0].paragraphs[0].original,'丙');assert.throws(()=>readingChapter(original,'three','old'),e=>e.status===409);assert.throws(()=>readingChapter(original,'missing','v'),e=>e.status===404);
});

test('small reading views stay complete and invalid preferred positions fall back safely',async()=>{
 const {readingView}=await import('../server/reading-view.mjs');const original=fixture();original.sections[0].paragraphs[0].original='甲';assert.deepEqual(readingView(original,{passageId:'absent'}),original);
 const large=fixture();assert.deepEqual(readingView(large,{chapterId:'three'}).reading.loadedChapters,['three']);assert.deepEqual(readingView(large,{passageId:'absent',chapterId:'absent'}).reading.loadedChapters,['one']);
});

test('chapter hydration deduplicates reads, keeps identities and source records, and retries failed reads',async()=>{
 const {readingView,readingChapter}=await import('../server/reading-view.mjs');const {createReadingBook}=await import('../app/reading-book.mjs');const original=fixture(),view=readingView(original,{chapterId:'two'});let calls=0,fail=true,changes=0;
 const loader=createReadingBook({book:view,readChapter:async id=>{calls++;await Promise.resolve();if(fail)throw Error('offline');return readingChapter(original,id,'v');},onContent:()=>changes++});
 assert.equal(loader.isLoaded('two'),true);assert.equal(loader.isLoaded('three'),false);await assert.rejects(loader.ensure('three'),/offline/);fail=false;await Promise.all([loader.ensure('three'),loader.ensure('three')]);assert.equal(calls,2);assert.equal(changes,1);assert.equal(loader.isLoaded('three'),true);assert.equal(view.sections[2].paragraphs[0].original,'丙');assert.equal(view.sections[1].paragraphs[0].original,'乙');assert.equal(view.contentVersion,'v');assert.equal(original.sections[0].paragraphs[0].original.length,180000);
});

test('chapter hydration rejects a mixed book/version or missing/replaced paragraph before mutation',async()=>{
 const {readingView,readingChapter}=await import('../server/reading-view.mjs');const {createReadingBook}=await import('../app/reading-book.mjs');
 for(const corrupt of [x=>x.bookId='other',x=>x.contentVersion='other',x=>x.chapterId='other',x=>x.sections[0].paragraphs[0].id='other',x=>x.sections=[]]){
  const original=fixture(),view=readingView(original,{chapterId:'two'}),before=structuredClone(view),response=readingChapter(original,'three','v');corrupt(response);const loader=createReadingBook({book:view,readChapter:async()=>response});await assert.rejects(loader.ensure('three'));assert.deepEqual(view,before);
 }
});

test('a late chapter read cannot replace a newer navigation and a failed read remains retryable',async()=>{
 const {createReadingNavigation}=await import('../app/reading-book.mjs');const gates=new Map(),commits=[],notices=[];const navigation=createReadingNavigation({isLoaded:id=>id==='loaded',ensure:id=>new Promise((resolve,reject)=>gates.set(id,{resolve,reject})),commit:id=>commits.push(id),onError:e=>notices.push(e.message)});
 const first=navigation.navigate('first'),second=navigation.navigate('second');gates.get('second').resolve();assert.equal(await second,true);gates.get('first').resolve();assert.equal(await first,false);assert.deepEqual(commits,['second']);
 const failed=navigation.navigate('failed');gates.get('failed').reject(Error('offline'));assert.equal(await failed,false);assert.deepEqual(notices,['offline']);assert.deepEqual(commits,['second']);const retry=navigation.navigate('failed');gates.get('failed').resolve();assert.equal(await retry,true);assert.deepEqual(commits,['second','failed']);
 const stale=navigation.navigate('stale');assert.equal(await navigation.navigate('loaded'),true);gates.get('stale').resolve();assert.equal(await stale,false);assert.deepEqual(commits,['second','failed','loaded']);
});
test('a highlight ticket reserved before hydration loses to newer TOC and same-chapter jumps',async()=>{
 const {createReadingNavigation}=await import('../app/reading-book.mjs');let release;const loaded=new Set(['current']),commits=[];const navigation=createReadingNavigation({isLoaded:id=>loaded.has(id),ensure:id=>new Promise(r=>{release=()=>{loaded.add(id);r();};}),commit:id=>commits.push(id)});
 const ticket=navigation.begin(),hydration=new Promise(r=>{release=r;});const oldHighlight=(async()=>{await hydration;return navigation.navigate('old',null,{current:ticket});})();await navigation.navigate('current');release();assert.equal(await oldHighlight,false);assert.deepEqual(commits,['current']);
 const slow=navigation.navigate('another');await navigation.navigate('current');release();assert.equal(await slow,false);assert.deepEqual(commits,['current','current']);
 assert.equal(await navigation.navigate('current',null,{validate:()=>false}),false);assert.deepEqual(commits,['current','current']);
});
test('cross-chapter ending drafts load their actual source before showing or submitting and survive a failed read',async()=>{
 const {readFile}=await import('node:fs/promises'),vm=await import('node:vm'),script=await readFile(new URL('../app/reading-session.js',import.meta.url),'utf8');const extract=(start,end)=>script.slice(script.indexOf(start),script.indexOf(end,script.indexOf(start)));
 const book={sourceLanguage:'zh',contentVersion:'v',chapters:[{id:'one',title:{zh:'First'}}],sections:[{chapterId:'one',paragraphs:[{id:'a',unloaded:true}]}]},nodes=new Map();let release,fail=true,modal=0,submitted=null,notice='';const drafts={activeId:()=> 'draft',busy:()=>false,edit(){},text:()=> 'my retained draft',pending:()=>null,activate(){},reconcile(){},begin(key,payload){submitted=payload;return {...payload,text:'my retained draft'};},acknowledge:()=>true,finish(){},persist(){}};
 const reader={getBook:()=>book,ensurePassages:()=>new Promise((resolve,reject)=>{release=()=>{if(fail)reject(Error('offline'));else{book.sections[0].paragraphs[0]={id:'a',original:'Actual source from the old chapter'};resolve();}};}),dismissTools(){}};
 const context=vm.createContext({listen:(node,type,handler,options)=>node.addEventListener(type,handler,options),notice:(id,params)=>({id,params}),SESSION_UI:'reader.session.',READER_UI:'reader.b1.',ownedLabels:createUiLabels(uiText),label:(node,id,params)=>node.textContent=uiText(id,params),receiptFor:node=>(id,params)=>uiText(id,params),endingDate:null,endingDateLabel(){},book,drafts,endingOpening:0,endingAnchor:null,endingIsDraft:false,lastEnding:null,clock:{view:()=>({status:'idle'})},sourceFor:a=>book.sections[0].paragraphs.find(p=>p.id===a.passageId),bridge:()=>reader,disposed:false,sessionEpoch:0,readerSession:{user:{id:'synthetic-owner'}},renderDraftCount(){},$:id=>{if(!nodes.has(id))nodes.set(id,{textContent:'',value:'my retained draft',showModal(){modal++;}});return nodes.get(id);},message:value=>{notice=uiText(value.id,value.params);},records:()=>({}),persistDrafts:()=>true,updateEnding(){},render(){},Intl,Date,formatTime:()=>'',crypto:{randomUUID:()=> 'id'},api:async()=>({id:'saved'}),document:{dispatchEvent(){}},CustomEvent:class{},noteSaveReceipt:()=> 'saved'});
 vm.runInContext(extract('function endingScope(', 'async function saveEnding(')+extract('function showSource(', 'function updateEnding(')+extract('async function openEnding(', 'function openDraftList(')+extract('async function saveEnding(', 'async function markChapter('),context);
 const draft={key:'comment:a',id:'draft',updatedAt:'2026-10-16T00:00:00Z'};const failed=context.openEnding({draft});release();await failed;assert.equal(modal,0);assert.match(notice,/草稿仍保留/);
 fail=false;const opened=context.openEnding({draft});assert.equal(modal,0);release();await opened;assert.equal(modal,1);assert.match(nodes.get('ending-source').textContent,/Actual source/);
 const saving=context.saveEnding('comment');assert.equal(submitted,null);release();await saving;assert.equal(submitted.quote,'Actual source from the old chapter');
});
test('restoring a remote position cannot overwrite a newer chapter navigation or resolve its notice',async()=>{
 const {readFile}=await import('node:fs/promises'),vm=await import('node:vm'),{createReadingNavigation}=await import('../app/reading-book.mjs'),script=await readFile(new URL('../app/reader.js',import.meta.url),'utf8'),functionText=script.slice(script.indexOf('async function reconcileProgress('),script.indexOf("listen($('progress-use-remote'),"));let release,entered,adopted=0,rendered=0;const hydrating=new Promise(r=>entered=r);
 const state={chapterId:'current'},notice={hidden:false},navigation=createReadingNavigation({isLoaded:()=>true,ensure:async()=>{},commit:id=>state.chapterId=id});const context={listen:(node,type,handler,options)=>node.addEventListener(type,handler,options),readingNavigation:navigation,readingBook:{ensure:()=>new Promise(r=>{release=r;entered();})},state,book:{},api:async()=>({position:{chapterId:'old'}}),resolveReadingPosition:(b,p)=>p,trackActionFocus:()=>({stop(){},restore(){}}),$:id=>id==='progress-notice'?notice:{},restoringProgress:false,progressSequence:0,persistTimer:null,clearTimeout,progressSync:{adopt(){adopted++;}},recordsPositionUnresolved:true,openingReadingPreferences:()=>({}),chineseOriginalOnly:()=>false,closePanel(){},dismissTools(){},renderChapter(){rendered++;},restoreAnchor(){},cachePosition(){},resumeSummary:()=>null,anchor:()=>null,document:{getElementById:()=>null},announce(){}};vm.createContext(context);vm.runInContext(functionText,context);
 const old=context.reconcileProgress(true);await hydrating;await navigation.navigate('new');release();await old;assert.equal(state.chapterId,'new');assert.equal(rendered,0);assert.equal(adopted,0);assert.equal(notice.hidden,false);assert.equal(context.recordsPositionUnresolved,true);
});
