import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {parse} from 'acorn';
import {resolveReadingPosition,chooseReadingPosition,resumeSummary,recoveredPositionNeedsChoice} from '../app/reading-progress.mjs';
import {resolveReaderOpening} from '../app/reader-entry.mjs';
import {openingReadingPreferences} from '../app/reading-preferences.mjs';
import {mergeLoadedReadingRecords} from '../app/reading-load.mjs';
import {createReadingActivityCheckpoint} from '../app/reading-activity-checkpoint.mjs';

let offline={};try{offline=await import('../app/offline-position.mjs');}catch(error){if(error.code!=='ERR_MODULE_NOT_FOUND')throw error;}
const book={bookId:'book',contentVersion:'source-v1',chapters:[{id:'one'},{id:'two'}],sections:[{chapterId:'one',paragraphs:[{id:'p1'}]},{chapterId:'two',paragraphs:[{id:'p2'}]}]};
const position=(passageId,revision=1)=>({contentVersion:'source-v1',chapterId:passageId==='p1'?'one':'two',passageId,offset:80,mode:'en',variant:'literal',revision});
const pending=()=>({...position('p2'),pending:true,baseRevision:1,localWriterId:'offline-tab',localSequence:4});
const memoryStorage=()=>{const rows=new Map();return {getItem:key=>rows.get(key)??null,setItem:(key,value)=>rows.set(key,String(value)),removeItem:key=>rows.delete(key)};};

test('a newer remote revision retains both positions and offers the actual local anchor',()=>{
 assert.equal(typeof offline.offlinePositionChoice,'function');
 const local=pending(),remote=position('p1',2),choice=offline.offlinePositionChoice({book,local,remote});
 assert.deepEqual(choice.local,local);assert.deepEqual(choice.remote,remote);assert.equal(choice.position.passageId,'p2');assert.equal(choice.unmapped,false);
 choice.local.passageId='changed';assert.equal(local.passageId,'p2');
});
test('same-revision pending progress and ordinary confirmed positions retain the existing resume policy',()=>{
 assert.equal(typeof offline.offlinePositionChoice,'function');
 assert.equal(offline.offlinePositionChoice({book,local:pending(),remote:position('p1',1)}),null);
 assert.equal(offline.offlinePositionChoice({book,local:position('p2'),remote:position('p1',2)}),null);
 assert.equal(offline.offlinePositionChoice({book,local:pending(),remote:null,remoteAvailable:false}),null);
});
test('source changes and unknown paragraphs keep the unmapped position without inventing a new anchor',()=>{
 assert.equal(typeof offline.offlinePositionChoice,'function');
 for(const local of [{...pending(),contentVersion:'old-source'},{...pending(),passageId:'removed'}]){
  const choice=offline.offlinePositionChoice({book,local,remote:position('p1',2)});
  assert.deepEqual(choice.local,local);assert.equal(choice.position,null);assert.equal(choice.unmapped,true);
 }
});
test('an unresolved candidate stays in its original row and both choices survive reopening',()=>{
 assert.equal(typeof offline.createOfflinePositionRecovery,'function');
 const storage=memoryStorage(),key='position|account-a|book',local=pending(),remote=position('p1',2);storage.setItem(key,JSON.stringify(local));
 const recovery=offline.createOfflinePositionRecovery({storage,key});assert.equal(recovery.retain({bookId:'book',local,remote}),true);
 assert.equal(recovery.write(remote,{protectPending:true}),false);assert.deepEqual(JSON.parse(storage.getItem(key)),local);
 const reopened=offline.createOfflinePositionRecovery({storage,key});assert.deepEqual(reopened.backup().positions[0],{bookId:'book',local,remote});
 assert.equal(reopened.write({...remote,pending:false}),true);assert.deepEqual(JSON.parse(storage.getItem(key)),{...remote,pending:false});assert.equal(reopened.has(),true);
});
test('failed durable preservation cannot overwrite the only pending position and still permits an in-memory backup',()=>{
 assert.equal(typeof offline.createOfflinePositionRecovery,'function');
 const raw=JSON.stringify(pending()),storage={getItem:key=>key==='position'?raw:null,setItem(){throw new DOMException('Full','QuotaExceededError');}};
 const recovery=offline.createOfflinePositionRecovery({storage,key:'position'}),remote=position('p1',2);
 assert.equal(recovery.retain({bookId:'book',local:pending(),remote}),false);assert.equal(recovery.write(remote,{protectPending:true}),false);assert.equal(storage.getItem('position'),raw);
 assert.equal(recovery.backup().positions[0].local.passageId,'p2');assert.equal(recovery.has(),true);
});
test('recovery copies are isolated by the existing account-and-book position key',()=>{
 assert.equal(typeof offline.createOfflinePositionRecovery,'function');
 const storage=memoryStorage(),a=offline.createOfflinePositionRecovery({storage,key:'position|a|book'}),b=offline.createOfflinePositionRecovery({storage,key:'position|b|book'});
 a.retain({bookId:'book',local:pending(),remote:position('p1',2)});assert.equal(a.has(),true);assert.equal(b.has(),false);assert.deepEqual(b.backup().positions,[]);
});

const reader=await readFile(new URL('../app/reader.js',import.meta.url),'utf8'),declaration=name=>{const node=parse(reader,{ecmaVersion:'latest',sourceType:'module'}).body.find(row=>row.type==='FunctionDeclaration'&&row.id.name===name);assert.ok(node,'actual reader function '+name);return reader.slice(node.start,node.end);};
function readerContext(){
 const storage=memoryStorage(),local=pending(),remote=position('p1',2),nodes=new Map();storage.setItem('position',JSON.stringify(local));
 const context={book:structuredClone(book),localStorage:storage,progressKey:'position',recordsPositionUnresolved:false,progressSync:{revision:1,adopt(value){this.revision=value;}},deferredProgress:false,persistTimer:null,clearTimeout,READER_UI:'reader.b1.',positionRecovery:offline.createOfflinePositionRecovery?.({storage,key:'position'}),offlinePositionChoice:offline.offlinePositionChoice,refreshPositionRecovery(){},announceUi(){},$:id=>{if(!nodes.has(id))nodes.set(id,{hidden:true});return nodes.get(id);},recordsPending:true,loadGeneration:1,records:{comments:[],questions:[],position:null},recordsUnavailable:true,selectedBookId:'book',readerOwner:()=> 'account-a',document:{body:{dataset:{}}},entryInteracted:false,resolveReadingPosition,chooseReadingPosition,resumeSummary,recoveredPositionNeedsChoice,mergeLoadedReadingRecords,openingReadingPreferences,chineseOriginalOnly:()=>false,state:{chapterId:'two'},readingBook:{async ensure(){}},renderChapter(){},restoreAnchor(value){context.restored=value;},cachePosition(value){storage.setItem('position',JSON.stringify(value));},reportReadingResume(){},dispatchReaderEvent(){},queueReadingFlow(){},renderPanel(){},persist(){context.sent=true;}};
 context.progressActivity=createReadingActivityCheckpoint();vm.createContext(context);return {context,storage,local,remote,nodes};
}
test('the actual early opening preserves a conflicting local anchor and exposes the existing choice UI',()=>{
 const {context,local,remote,storage,nodes}=readerContext();vm.runInContext(declaration('preparePositionOpening')+';this.prepare=preparePositionOpening;',context);
 const policy=context.prepare(local,remote,true),opening=resolveReaderOpening({book,local:policy.local,remote,remoteAvailable:policy.remoteAvailable,state:{chapterId:'one'}});
 assert.equal(opening.position.passageId,'p2');assert.equal(context.recordsPositionUnresolved,true);assert.equal(nodes.get('progress-notice').hidden,false);assert.deepEqual(JSON.parse(storage.getItem('position')),local);
 assert.equal(context.positionRecovery.backup().positions[0].remote.revision,2);
});
test('late records cannot replace pending offline progress before the reader chooses',async()=>{
 const {context,local,remote,storage,nodes}=readerContext();vm.runInContext(declaration('preparePositionOpening')+'\n'+declaration('adoptLoadedRecords')+';this.adopt=adoptLoadedRecords;',context);
 await context.adopt({comments:[],questions:[],position:remote},{generation:1,explicitEntry:false,initialPosition:local});
 assert.equal(context.recordsPositionUnresolved,true);assert.equal(nodes.get('progress-notice').hidden,false);assert.equal(context.restored,undefined);assert.deepEqual(JSON.parse(storage.getItem('position')),local);assert.equal(context.sent,undefined);
});
function choiceContext({unmapped=false,failRecovery=false}={}){
 const f=readerContext(),{context,storage,local,remote}=f;if(unmapped){local.contentVersion='previous-source';storage.setItem('position',JSON.stringify(local));}
 context.document.getElementById=context.$;
 if(failRecovery){const set=storage.setItem;storage.setItem=(key,value)=>{if(key.includes('|recovery-'))throw new DOMException('Full','QuotaExceededError');return set(key,value);};}
 Object.assign(context,{readingNavigation:{begin:()=>()=>true},trackActionFocus:()=>({stop(){},restore(){}}),restoringProgress:false,progressSequence:0,api:async()=>({comments:[],questions:[],position:remote}),closePanel(){},dismissTools(){},overrides:{},selectedId:null,allowScrollSave:true,anchor:()=>context.restored||local,recordsUnavailable:false,setTimeout:()=>1,captureProgress:()=>({...context.restored||local,baseRevision:context.progressSync.revision})});
 vm.runInContext(declaration('persist')+'\n'+declaration('reconcileProgress')+';this.choose=reconcileProgress;',context);return f;
}
test('choosing the remote position preserves the local candidate before replacing its only row',async()=>{
 const {context,local,remote,storage}=choiceContext();await context.choose(true);
 assert.equal(context.restored.passageId,'p1');assert.equal(JSON.parse(storage.getItem('position')).pending,false);assert.deepEqual(context.positionRecovery.backup().positions[0],{bookId:'book',local,remote});
});
test('choosing the local position restores that candidate and submits against the freshly confirmed remote revision',async()=>{
 const {context,storage}=choiceContext();context.state.chapterId='one';await context.choose(false);
 assert.equal(context.restored.passageId,'p2');assert.equal(context.state.chapterId,'two');assert.equal(JSON.parse(storage.getItem('position')).baseRevision,2);assert.equal(context.recordsPositionUnresolved,false);
});
test('an unmapped original-source position remains recoverable after explicitly choosing the remote position',async()=>{
 const {context,local}=choiceContext({unmapped:true});await context.choose(true);
 assert.equal(context.restored.passageId,'p1');assert.deepEqual(context.positionRecovery.backup().positions[0].local,local);assert.equal(context.positionRecovery.has(),true);
});
test('a failed recovery write keeps the choice unresolved and leaves the original pending row intact',async()=>{
 const {context,storage,local}=choiceContext({failRecovery:true});context.recordsPositionUnresolved=true;await context.choose(true);
 assert.equal(context.recordsPositionUnresolved,true);assert.deepEqual(JSON.parse(storage.getItem('position')),local);assert.equal(context.restored,undefined);assert.equal(context.positionRecovery.backup().positions[0].local.passageId,'p2');
});
test('the real boot decision uses the pending local candidate before any position-cache write',()=>{
 const {context,local,remote,storage}=readerContext();context.records={position:remote};context.recordsUnavailable=false;
 Object.assign(context,{URLSearchParams,location:{search:''},paragraphMap:new Map(book.sections.flatMap(section=>section.paragraphs.map(p=>[p.id,{...p,chapterId:section.chapterId}]))),readerSession:{user:{id:'account-a'}},resolveReaderOpening});
 const start=reader.indexOf('    let localPosition=null;'),end=reader.indexOf('    // Opening precedence:',start);
 vm.runInContext(declaration('preparePositionOpening')+'\n'+reader.slice(start,end)+'\nthis.bootPosition=position;',context);
 assert.equal(context.bootPosition.passageId,'p2');assert.equal(context.recordsPositionUnresolved,true);assert.deepEqual(JSON.parse(storage.getItem('position')),local);
});
test('a newer pending position written during hydration cannot be overwritten by a stale explicit choice',async()=>{
 const {context,storage}=choiceContext();let release,started;const entered=new Promise(resolve=>started=resolve);context.readingBook.ensure=()=>{started();return new Promise(resolve=>release=resolve);};
 const choosing=context.choose(true);await entered;const newer={...pending(),offset:-210,localSequence:5};storage.setItem('position',JSON.stringify(newer));release();await choosing;
 assert.deepEqual(JSON.parse(storage.getItem('position')),newer);assert.equal(context.recordsPositionUnresolved,true);assert.equal(context.restored,undefined);
});
test('retrying records also preserves an unmapped pending source position even when its revision matches',async()=>{
 const {context,storage,local}=choiceContext({unmapped:true});context.api=async()=>({comments:[],questions:[],position:position('p1',1)});context.recordsRetryBusy=false;context.recordsRetryNotice='';context.sent=false;context.persist=()=>{context.sent=true;};
 vm.runInContext(declaration('preparePositionOpening')+'\n'+declaration('recoverRecords')+';this.recover=recoverRecords;',context);await context.recover();
 assert.equal(context.recordsPositionUnresolved,true);assert.equal(context.sent,false);assert.deepEqual(JSON.parse(storage.getItem('position')),local);assert.equal(context.positionRecovery.backup().positions[0].local.contentVersion,'previous-source');
});

const partialBook=()=>({...structuredClone(book),reading:{partial:true,loadedChapters:['one'],offlineFallback:{requestedChapterId:'two',chapterId:'one',passageId:'p1'}},sections:[{chapterId:'one',paragraphs:[{id:'p1',original:'Available original source'}]},{chapterId:'two',paragraphs:[{id:'p2',unloaded:true}]}]});
for(const isPending of [false,true])test('partial offline opening uses the saved chapter without pretending to restore '+(isPending?'pending':'confirmed')+' progress',()=>{
 assert.equal(typeof offline.resolveReaderOpening,'function');
 const local=isPending?pending():position('p2'),opening=offline.resolveReaderOpening({book:partialBook(),local,remote:local,remoteAvailable:false,state:{chapterId:'two'}});
 assert.equal(opening.chapterId,'one');assert.equal(opening.position,null);assert.equal(opening.chosen,null);assert.equal(opening.requestedEntry,null);assert.equal(opening.offlineFallback.requestedChapterId,'two');
});
test('an unavailable offline citation is suppressed for this opening while its original query remains retryable',()=>{
 assert.equal(typeof offline.resolveReaderOpening,'function');
 const query=new URLSearchParams({book:'book',passage:'p2',contentVersion:'source-v1',layer:'original',note:'comment'}),before=query.toString();
 const opening=offline.resolveReaderOpening({book:partialBook(),query,local:pending(),state:{chapterId:'two'}});
 assert.equal(opening.chapterId,'one');assert.equal(opening.position,null);assert.equal(opening.requestedEntry,null);assert.equal(opening.sampleEntry,null);assert.equal(query.toString(),before);
});
test('the offline wrapper delegates the original opening policy unchanged when no fallback is present',()=>{
 assert.equal(typeof offline.resolveReaderOpening,'function');
 for(const query of [new URLSearchParams(),new URLSearchParams({passage:'p1',contentVersion:'source-v1',layer:'original'})]){
  const input={book,query,local:pending(),remote:position('p1',1),state:{chapterId:'one'}};
  assert.deepEqual(offline.resolveReaderOpening(input),resolveReaderOpening(input));
 }
});
test('a malformed fallback cannot turn an unloaded placeholder into a readable opening',()=>{
 assert.equal(typeof offline.resolveReaderOpening,'function');
 const value=partialBook();value.sections[0].paragraphs=[{id:'p1',unloaded:true}];
 assert.throws(()=>offline.resolveReaderOpening({book:value}),error=>error.code==='offline_missing');
});
test('a valid fallback can use a saved paragraph beyond the first section of its chapter',()=>{
 const value=partialBook();value.sections.unshift({chapterId:'one',paragraphs:[]});
 assert.equal(offline.resolveReaderOpening({book:value,local:pending()}).chapterId,'one');
});
for(const failRecovery of [false,true])test('offline fallback keeps the original pending row before any writes '+(failRecovery?'when retention fails':'after durable retention'),()=>{
 const {context,storage,local}=choiceContext({failRecovery});context.book=partialBook();context.recordsPositionUnresolved=false;
 vm.runInContext(declaration('prepareOfflineFallback')+';this.prepareFallback=prepareOfflineFallback;',context);context.prepareFallback({offlineFallback:context.book.reading.offlineFallback},local,local);
 assert.equal(context.recordsPositionUnresolved,true);assert.deepEqual(JSON.parse(storage.getItem('position')),local);assert.equal(context.positionRecovery.backup().positions[0].local.passageId,'p2');
 assert.equal(context.$('progress-use-remote').disabled,true);assert.equal(context.$('progress-keep-here').disabled,true);
});
for(const useRemote of [false,true])test('offline position reconciliation never fetches or claims a remote choice '+useRemote,async()=>{
 const {context,storage,local}=choiceContext();context.book=partialBook();context.readerOffline={isOffline:()=>true};context.recordsPositionUnresolved=true;let requests=0;context.api=async()=>{requests++;return {comments:[],questions:[],offline:true,position:local};};
 await context.choose(useRemote);assert.equal(requests,0);assert.equal(context.recordsPositionUnresolved,true);assert.deepEqual(JSON.parse(storage.getItem('position')),local);assert.equal(context.restored,undefined);
});
test('late offline records cannot send a fallback opening back into its unavailable resume chapter',async()=>{
 const {context,local}=readerContext();context.book=partialBook();context.readerOffline={isOffline:()=>true};let ensured=0;context.readingBook.ensure=async()=>{ensured++;throw Error('Unavailable chapter');};context.prepareOfflineFallback=()=>{context.recordsPositionUnresolved=true;};
 vm.runInContext(declaration('preparePositionOpening')+'\n'+declaration('adoptLoadedRecords')+';this.adopt=adoptLoadedRecords;',context);
 await context.adopt({comments:[],questions:[],offline:true,position:local},{generation:1,explicitEntry:false,initialPosition:null,hadSaved:true});
 assert.equal(ensured,0);assert.equal(context.recordsPositionUnresolved,true);assert.equal(context.restored,undefined);
});
for(const isPending of [false,true])test('the actual boot decision opens an available partial chapter without rewriting '+(isPending?'pending':'confirmed')+' resume data',()=>{
 const {context,local,storage}=readerContext();if(!isPending)local.pending=false;storage.setItem('position',JSON.stringify(local));context.book=partialBook();context.records={position:local,offline:true};context.recordsUnavailable=false;
 Object.assign(context,{URLSearchParams,location:{search:'?book=book&passage=p2&contentVersion=source-v1&layer=original'},paragraphMap:new Map(context.book.sections.flatMap(section=>section.paragraphs.map(p=>[p.id,{...p,chapterId:section.chapterId}]))),readerSession:{offlineOwner:'account-a'},resolveReaderOpening:offline.resolveReaderOpening});
 const start=reader.indexOf('    let localPosition=null;'),end=reader.indexOf('    // Opening precedence:',start);
 vm.runInContext(declaration('preparePositionOpening')+'\n'+declaration('prepareOfflineFallback')+'\n'+reader.slice(start,end)+'\nthis.bootPosition=position;this.bootEntry=requestedEntry;',context);
 assert.equal(context.state.chapterId,'one');assert.equal(context.bootPosition,null);assert.equal(context.bootEntry,null);assert.equal(context.recordsPositionUnresolved,true);assert.deepEqual(JSON.parse(storage.getItem('position')),local);assert.match(context.location.search,/passage=p2/);
});
test('ordinary offline progress conflicts also reject reconciliation before the session transport is called',async()=>{
 const {context}=choiceContext();context.readerOffline={isOffline:()=>true};context.recordsPositionUnresolved=true;let requests=0;context.api=async()=>{requests++;return {position:position('p1',2)};};
 await context.choose(true);assert.equal(requests,0);assert.equal(context.recordsPositionUnresolved,true);assert.equal(context.restored,undefined);
});
test('retrying personal records cannot unlock or replace the original position during an offline fallback',async()=>{
 const {context,storage,local}=choiceContext();context.book=partialBook();context.readerOffline={isOffline:()=>true};context.recordsPositionUnresolved=true;context.recordsRetryBusy=false;context.recordsRetryNotice='';let requests=0;context.api=async()=>{requests++;return {comments:[],questions:[],offline:true,position:local};};
 vm.runInContext(declaration('preparePositionOpening')+'\n'+declaration('recoverRecords')+';this.recover=recoverRecords;',context);await context.recover();
 assert.equal(requests,0);assert.equal(context.recordsPositionUnresolved,true);assert.deepEqual(JSON.parse(storage.getItem('position')),local);
});
test('scrolling a temporary fallback preserves a confirmed guest resume and retains its recovery copy',()=>{
 const {context,storage,local}=choiceContext();const confirmed={...local,pending:false};storage.setItem('position',JSON.stringify(confirmed));context.book=partialBook();context.readerOwner=()=>null;context.selectedBookId='book';context.recordsUnavailable=false;let captures=0;context.captureProgress=()=>{captures++;return {...confirmed,chapterId:'one',passageId:'p1'};};context.cachePosition=value=>context.positionRecovery.write(value,{protectPending:context.recordsPositionUnresolved});
 vm.runInContext(declaration('prepareOfflineFallback')+'\n'+declaration('persist')+';this.prepareFallback=prepareOfflineFallback;this.persistFallback=persist;',context);context.prepareFallback({offlineFallback:context.book.reading.offlineFallback},confirmed,confirmed);context.persistFallback();assert.deepEqual(JSON.parse(storage.getItem('position')),confirmed);assert.equal(captures,0);assert.equal(context.positionRecovery.backup().positions[0].local.passageId,confirmed.passageId);
});
