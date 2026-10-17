import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {createReaderServer} from '../server/server.mjs';

test('opening a saved view restores its chosen manual mode and variant without losing typography',async()=>{
  const preferences=await import('../app/reading-preferences.mjs');
  const {passagePresentation}=await import('../app/passage-layers.mjs');
  const passage={original:'Original prose.',translations:{literal:{text:'已有直译。'}}};
  for(const [previousMode,expected]of [[undefined,['original']],['en',['original']],['zh',['translation']],['parallel',['original','translation']]]){
    const saved={mode:previousMode,variant:'literal',font:26,theme:'night',chapterId:'ch02',passageId:'p2'};
    const opening=preferences.openingReadingPreferences?.(saved)||saved;
    const view=passagePresentation(passage,opening);
    assert.deepEqual(view.layers.map(layer=>layer.kind),expected,previousMode);
    assert.equal(view.layers.at(-1).text,expected.at(-1)==='translation'?'已有直译。':'Original prose.');
    assert.equal(opening.mode,previousMode||'en');assert.equal(opening.variant,'literal');assert.equal(opening.font,26);assert.equal(opening.theme,'night');
  }
  // A missing translation never borrows another variant: the original stays readable.
  const fallback=passagePresentation({original:'Original prose.',translations:{interpretive:{text:'Only interpretive exists.'}}},preferences.openingReadingPreferences({mode:'zh',variant:'literal'}));
  assert.deepEqual(fallback.layers.map(layer=>layer.kind),['original']);
  assert.match(fallback.notice,/尚未翻译/);
});

test('reading appearance travels with exported records, rejects invalid imports atomically, and accepts old positions',async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'reader-appearance-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const bookPath=path.join(dir,'book.json');
  await writeFile(bookPath,JSON.stringify({bookId:'appearance-book',contentVersion:'v1',chapters:[{id:'ch01'}],sections:[{number:1,chapterId:'ch01',paragraphs:[{id:'p1'}]}]}));
  const servers=[];
  t.after(async()=>{for(const server of servers)await new Promise(r=>server.close(r));});
  async function open(name){const server=await createReaderServer({bookPath,recordsPath:path.join(dir,name,'records.json')});servers.push(server);await new Promise(r=>server.listen(0,'127.0.0.1',r));return 'http://127.0.0.1:'+server.address().port;}
  const base=await open('first'),other=await open('second');
  for(const [file,type]of [['parallel-reading.mjs','javascript'],['parallel-reading.css','css'],['reader-immersion.mjs','javascript'],['reader-settings.mjs','javascript'],['reader-settings.css','css'],['reader-pagination.mjs','javascript'],['reader-pagination.css','css']]){
    const response=await fetch(base+'/'+file);assert.equal(response.status,200,file);assert.ok(response.headers.get('content-type').includes(type));
  }
  const post=(base,url,data)=>fetch(base+url,{method:'POST',headers:{'Content-Type':'application/json',Origin:base},body:JSON.stringify(data)});
  const legacy={chapterId:'ch01',passageId:'p1',offset:100,mode:'parallel',variant:'literal',font:23,theme:'night'};
  const custom={...legacy,readingPurpose:'deep',preferredLanguage:'zh',pageLayout:'spread',theme:'leaf',fontFamily:'kai',lineHeight:2.2,paragraphGap:32,letterSpacing:0.04,wordSpacing:0.12,fontWeight:600,indent:true,parallelLayout:'stack',parallelStyle:'reveal',parallelColor:'blue',parallelBackground:'soft'};
  assert.equal((await post(base,'/api/progress',custom)).status,200);
  const exported=await (await fetch(base+'/api/records/export')).json();
  for(const [key,value] of Object.entries(custom))assert.equal(exported.position[key],value,key);
  assert.equal((await post(other,'/api/records/import',exported)).status,200);
  const restored=await (await fetch(other+'/api/records')).json();
  for(const [key,value] of Object.entries(custom))assert.equal(restored.position[key],value,key);
  for(const invalid of [{readingPurpose:'injected'},{preferredLanguage:'injected'},{pageLayout:'injected'},{fontFamily:'injected'},{theme:'unknown'},{lineHeight:9},{paragraphGap:-4},{letterSpacing:1},{wordSpacing:-1},{fontWeight:900},{indent:'yes'},{parallelLayout:'injected'},{parallelStyle:'blur(9px)'},{parallelColor:'#fff'},{parallelBackground:'url(evil)'}]){
    const bad={...exported,position:{...custom,...invalid},comments:[{id:'bad-note',passageId:'p1',text:'should never be imported'}]};
    assert.equal((await post(other,'/api/records/import',bad)).status,400,JSON.stringify(invalid));
    const unchanged=await (await fetch(other+'/api/records')).json();
    assert.deepEqual(unchanged.position,restored.position);assert.equal(unchanged.comments.length,0);
  }
  assert.equal((await post(other,'/api/progress',legacy)).status,200);
  const migrated=await (await fetch(other+'/api/records')).json();
  assert.equal(migrated.position.pageLayout,'scroll');assert.equal(migrated.position.fontFamily,'song');assert.equal(migrated.position.lineHeight,1.98);assert.equal(migrated.position.indent,false);
  assert.equal(migrated.position.parallelLayout,'columns');assert.equal(migrated.position.parallelStyle,'plain');
  assert.equal(migrated.position.readingPurpose,'manual');assert.equal(migrated.position.preferredLanguage,'source');
});

test('explicit reading purposes choose a starting language without overwriting variants or manual views',async()=>{
  const {preferredReadingMode,openingReadingPreferences,normalizeAppearance}=await import('../app/reading-preferences.mjs');
  assert.equal(typeof preferredReadingMode,'function');
  const saved={readingPurpose:'deep',preferredLanguage:'zh',mode:'parallel',variant:'literal',font:26,theme:'night'};
  const before=structuredClone(saved);
  assert.equal(preferredReadingMode(saved),'zh');
  assert.equal(preferredReadingMode({...saved,readingPurpose:'language'}),'en');
  assert.equal(preferredReadingMode({...saved,preferredLanguage:'source'}),'en');
  assert.equal(preferredReadingMode({...saved,readingPurpose:'manual'}),'parallel');
  assert.equal(preferredReadingMode(saved,{sourceOnly:true}),'en');
  const reopened=openingReadingPreferences(saved);
  for(const [key,value]of Object.entries(saved))assert.equal(reopened[key],value,key);
  assert.equal(openingReadingPreferences({readingPurpose:'deep',preferredLanguage:'zh'}).mode,'zh');
  assert.equal(openingReadingPreferences({readingPurpose:'language',preferredLanguage:'zh'}).mode,'en');
  assert.equal(openingReadingPreferences({...saved,readingPurpose:'manual'}).mode,'parallel','a valid saved manual view is a deliberate choice and must survive reopening');
  assert.equal(openingReadingPreferences({readingPurpose:'manual',variant:'literal'}).mode,'en','records without a saved mode keep the legacy original opening');
  for(const invalid of [{readingPurpose:'injected'},{preferredLanguage:'fr'}])assert.throws(()=>normalizeAppearance(invalid,true));
  assert.deepEqual(saved,before);
});

test('parallel settings restore independently of the opening language and safely normalize older preferences',async()=>{
  const {normalizeAppearance,openingReadingPreferences}=await import('../app/reading-preferences.mjs');
  const chosen={parallelLayout:'stack',parallelStyle:'quote',parallelColor:'green',parallelBackground:'none'};
  const reopened=openingReadingPreferences({...chosen,mode:'parallel'});
  assert.equal(reopened.mode,'parallel','a remembered manual parallel view opens again as parallel');
  for(const [key,value]of Object.entries(chosen))assert.equal(reopened[key],value);
  assert.equal(openingReadingPreferences(chosen).mode,'en','older records without a saved mode still open in the original');
  const old=normalizeAppearance({parallelLayout:'invalid',parallelStyle:17});
  assert.equal(old.parallelLayout,'columns');assert.equal(old.parallelStyle,'plain');assert.equal(old.parallelColor,'auto');assert.equal(old.parallelBackground,'auto');
  for(const style of ['plain','muted','quote','tint','reveal'])assert.equal(normalizeAppearance({parallelStyle:style},true).parallelStyle,style);
});

test('delayed and conflict restoration keep Chinese original-only books readable without losing preferences or anchors',async()=>{
  const {openingReadingPreferences}=await import('../app/reading-preferences.mjs');
  const {chineseOriginalOnly}=await import('../app/source-language.mjs');
  const {resolveReadingPosition,chooseReadingPosition,resumeSummary,recoveredPositionNeedsChoice}=await import('../app/reading-progress.mjs');
  const {mergeLoadedReadingRecords}=await import('../app/reading-load.mjs');
  const reader=await readFile(new URL('../app/reader.js',import.meta.url),'utf8');
  const delayed=reader.slice(reader.indexOf('async function adoptLoadedRecords('),reader.indexOf("for(const type of ['pointerdown'"));
  const conflict=reader.slice(reader.indexOf('async function reconcileProgress('),reader.indexOf("$('progress-use-remote').addEventListener"));
  for(const sourceLanguage of ['zh','en'])for(const restore of ['delayed','conflict']){
    const book={bookId:'restore-book',contentVersion:'v1',sourceLanguage,chapters:[{id:'ch02'}],sections:[{chapterId:'ch02',paragraphs:[{id:'p22',original:'Synthetic source.',translations:{}}]}]};
    const position={contentVersion:'v1',chapterId:'ch02',passageId:'p22',offset:-100,withinParagraph:.4,revision:2,mode:'parallel',variant:'literal',readingPurpose:'deep',preferredLanguage:'zh'};
    const fresh={position,comments:[],questions:[]},state=openingReadingPreferences();let rendered,anchor;
    const {createReadingBook,createReadingNavigation}=await import('../app/reading-book.mjs');
    const context={readingNavigation:createReadingNavigation({isLoaded:()=>true,ensure:async()=>{},commit(){}}),readingBook:createReadingBook({book,readChapter:()=>assert.fail('complete books need no chapter read')}),book,state,openingReadingPreferences,chineseOriginalOnly,resolveReadingPosition,chooseReadingPosition,resumeSummary,recoveredPositionNeedsChoice,mergeLoadedReadingRecords,loadGeneration:1,recordsPending:true,records:fresh,selectedBookId:book.bookId,readerSession:{user:{id:'synthetic-owner'}},entryInteracted:false,localStorage:{getItem:()=>null},progressKey:'synthetic',recordsPositionUnresolved:false,progressSync:{revision:1,adopt(){}},deferredProgress:false,document:{body:{dataset:{}},dispatchEvent(){},getElementById:()=>({})},CustomEvent:class{},$:()=>({hidden:true}),renderChapter:()=>{rendered={...state};},restoreAnchor:value=>{anchor=value;},cachePosition(){},queueReadingFlow(){},renderPanel(){},api:async()=>fresh,trackActionFocus:()=>({stop(){},restore(){}}),closePanel(){},dismissTools(){},announce(){},progressSequence:0,persistTimer:null,clearTimeout};
    context.anchor=()=>anchor;
    vm.createContext(context);
    vm.runInContext(delayed+'\n'+conflict+';this.restoreDelayed=adoptLoadedRecords;this.restoreConflict=reconcileProgress;',context);
    if(restore==='delayed')await context.restoreDelayed(fresh,{generation:1,explicitEntry:false});else await context.restoreConflict(true);
    assert.equal(rendered?.mode,sourceLanguage==='zh'?'en':'parallel',sourceLanguage+' '+restore);
    for(const key of ['readingPurpose','preferredLanguage','variant'])assert.equal(rendered[key],position[key],key);
    assert.equal(anchor.passageId,'p22');assert.equal(anchor.withinParagraph,.4);
    assert.equal(fresh.position.mode,'parallel','restoring must not rewrite the saved record');
  }
});
