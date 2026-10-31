import test from 'node:test';
import assert from 'node:assert/strict';
import {chooseCurrentBook} from '../app/reading-calendar.mjs';
import {compareShelfBooks,currentReadingBookmark} from '../app/library-workspace.mjs';
import * as workspace from '../app/library-workspace.mjs';
import {resumeSummary} from '../app/reading-progress.mjs';
import {readingBook,readingRecords} from './reading-fixtures.mjs';
import {validateLibraryBackup} from '../app/library-backup.mjs';
import {createLibraryArchive,readLibraryArchive} from '../app/library-portability.mjs';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {mergeLoadedReadingRecords} from '../app/reading-load.mjs';
import {createProgressSync} from '../app/progress-sync.mjs';
import {createOwnerScope} from '../app/owner-scope.mjs';
import {adoptForegroundProgress,createReaderProgressRefresh} from '../app/reader-progress-refresh.mjs';
import {parse} from 'acorn';

test('a newer reading checkpoint outranks an older session in continuation and recent sorting',()=>{
 const a={bookId:'a',resume:{passageId:'a1',observedAt:'2026-11-01T00:00:00Z',updatedAt:'2026-11-01T02:00:00Z'},journey:{lastReadAt:'2026-10-01T00:00:00Z'}};
 const b={bookId:'b',resume:{passageId:'b1',updatedAt:'2026-10-31T00:00:00Z'},journey:{lastReadAt:'2026-10-31T00:00:00Z'}};
 assert.equal(chooseCurrentBook([b,a]).bookId,'a');assert.equal(currentReadingBookmark([b,a]).bookId,'a');assert.deepEqual([b,a].sort((x,y)=>compareShelfBooks(x,y,'recent')).map(x=>x.bookId),['a','b']);
});
test('a delayed offline upload retains its actual reading date and offset dates compare as instants',()=>{
 const old={bookId:'old',resume:{passageId:'p',observedAt:'2026-10-01T00:00:00Z',updatedAt:'2026-11-01T04:00:00Z'}};
 const recent={bookId:'recent',resume:{passageId:'p',observedAt:'2026-11-01T00:45:00Z'}};
 const offset={bookId:'offset',resume:{passageId:'p',updatedAt:'2026-11-01T08:30:00+08:00'}};
 assert.equal(chooseCurrentBook([old,recent,offset]).bookId,'recent');
 assert.equal(chooseCurrentBook([{bookId:'invalid',resume:{passageId:'p',observedAt:'invalid',updatedAt:'invalid'}},recent]).bookId,'recent');
});
test('pins prefix every shelf sort without changing the manual positions or inventing reading from imports',()=>{
 const rows=[{bookId:'a',shelfPosition:0,addedAt:'2026-11-01T00:00:00Z'},{bookId:'b',shelfPosition:1,pinned:true,addedAt:'2026-01-01T00:00:00Z'}];
 for(const sort of ['manual','recent','added','published-asc','published-desc'])assert.deepEqual([...rows].sort((a,b)=>compareShelfBooks(a,b,sort)).map(b=>b.bookId),['b','a']);
 assert.equal(chooseCurrentBook(rows),null);assert.deepEqual(rows.map(b=>b.shelfPosition),[0,1]);
});
test('full resume summaries preserve the actual event timestamp separately from receipt time',()=>{
 const position={chapterId:'ch01',passageId:'p1',offset:0,mode:'en',variant:'literal',observedAt:'2026-10-14T12:00:00Z',updatedAt:'2026-11-01T00:00:00Z'};
 const resume=resumeSummary(readingBook,position);assert.equal(resume.observedAt,position.observedAt);assert.equal(resume.updatedAt,position.updatedAt);
});

const convergence=await import('../app/account-shelf-sync.mjs').catch(()=>({}));
test('authoritative account rows replace membership while retaining loaded translation metadata only for the same source',()=>{
 assert.equal(typeof convergence.mergeAccountShelf,'function');
 const old=[{bookId:'keep',contentVersion:'v1',translationLanguages:['zh'],supportsParallel:true,translatedParagraphs:3,translationCoverage:'complete',personalizationPending:false},{bookId:'archived',contentVersion:'v1'},{bookId:'changed',contentVersion:'v1',supportsParallel:true}];
 const snapshot={kind:'leafhour-account-shelf-v1',user:{id:'a'},books:[{bookId:'keep',contentVersion:'v1',readingStateReady:true,personalizationPending:true,pinned:true,resume:{passageId:'p2'}},{bookId:'changed',contentVersion:'v2',personalizationPending:true}],archivedBooks:[old[1]],shelfRevision:4,shelf:{revision:4,pinned:['keep']}};
 const rows=convergence.mergeAccountShelf(old,snapshot,'a');assert.deepEqual(rows.map(b=>b.bookId),['keep','changed']);assert.equal(rows[0].supportsParallel,true);assert.equal(rows[0].resume.passageId,'p2');assert.equal(rows[0].pinned,true);assert.equal(rows[0].personalizationPending,false);assert.equal(rows[1].supportsParallel,undefined);assert.throws(()=>convergence.mergeAccountShelf(old,snapshot,'b'));
});
test('late full hydration enriches the current source without resurrecting archived books or stale positions',()=>{
 assert.equal(typeof convergence.hydrateAccountBooks,'function');
 const current=[{bookId:'keep',contentVersion:'v1',pinned:true,resume:{passageId:'new'},shelfPosition:3},{bookId:'changed',contentVersion:'v2'}];
 const old=[{bookId:'archived',contentVersion:'v1'},{bookId:'keep',contentVersion:'v1',pinned:false,resume:{passageId:'old'},translationLanguages:['zh'],supportsParallel:true},{bookId:'changed',contentVersion:'v1',supportsParallel:true}];
 const rows=convergence.hydrateAccountBooks(current,old,{stale:true});assert.deepEqual(rows.map(b=>b.bookId),['keep','changed']);assert.equal(rows[0].resume.passageId,'new');assert.equal(rows[0].pinned,true);assert.equal(rows[0].supportsParallel,true);assert.equal(rows[1].supportsParallel,undefined);
 assert.deepEqual(convergence.hydrateAccountBooks(current,[old[0]],{stale:false}).map(b=>b.bookId),['archived']);
});
test('foreground bursts share one read and an owner switch invalidates the late response',async()=>{
 assert.equal(typeof convergence.createForegroundRefresh,'function');let owner='a',finish,reads=0;const applied=[];
 const refresh=convergence.createForegroundRefresh({capture:()=>owner,isCurrent:ticket=>ticket===owner,read:async()=>{reads++;return new Promise(resolve=>finish=resolve);},apply:row=>applied.push(row)});
 const a=refresh.refresh(),b=refresh.refresh();assert.equal(a,b);await Promise.resolve();assert.equal(reads,1);owner='b';finish({owner:'a'});await a;assert.equal(applied.length,0);
 const c=refresh.refresh();await Promise.resolve();finish({owner:'b'});await c;assert.equal(applied.length,1);
});
test('pin receipts change only the pinned prefix; explicit manual positions stay independent',()=>{
 assert.equal(typeof convergence.applyShelfPins,'function');assert.equal(typeof workspace.manualShelfBooks,'function');
 const before=[{bookId:'a',shelfPosition:0},{bookId:'b',shelfPosition:1}];const rows=convergence.applyShelfPins(before,{revision:2,pinned:['b'],pinsInitialized:true});assert.deepEqual(workspace.libraryShelf(rows).map(b=>b.bookId),['b','a']);assert.deepEqual(workspace.manualShelfBooks(rows).map(b=>b.bookId),['a','b']);assert.deepEqual(rows.map(b=>b.shelfPosition),[0,1]);assert.equal(rows[1].pinned,true);
});
const activity=await import('../app/reading-activity-checkpoint.mjs').catch(()=>({}));
test('only a real interaction advances a checkpoint timestamp; retries and cold restoration retain the event',()=>{
 assert.equal(typeof activity.createReadingActivityCheckpoint,'function');let at=Date.parse('2026-11-01T00:00:00Z');const events=activity.createReadingActivityCheckpoint({now:()=>at});
 assert.equal(events.observedAt,null);events.restore({observedAt:'2026-10-01T00:00:00Z'});assert.equal(events.observedAt,'2026-10-01T00:00:00Z');events.interact({isTrusted:false});assert.equal(events.observedAt,'2026-10-01T00:00:00Z');events.interact({isTrusted:true});const first=events.observedAt;at+=60000;assert.equal(events.observedAt,first);events.restore({observedAt:'2026-10-02T00:00:00Z'});assert.equal(events.observedAt,first);events.interact({isTrusted:true});assert.equal(events.observedAt,new Date(at).toISOString());
});
const draining=await import('../app/account-reading-drain.mjs').catch(()=>({}));
const memory=()=>{const values=new Map();return {get length(){return values.size;},key:i=>[...values.keys()][i]??null,getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,String(v)),removeItem:k=>values.delete(k)};};
const sessionRow=(patch={})=>({id:'session',bookId:'book',contentVersion:'v1',source:'reader_focus',sequence:1,status:'finished',startedAt:'2026-10-01T00:00:00.000Z',endedAt:'2026-10-01T00:01:00.000Z',timeZone:'UTC',start:{chapterId:'c',passageId:'p'},end:{chapterId:'c',passageId:'p'},segments:[{startedAt:'2026-10-01T00:00:00.000Z',endedAt:'2026-10-01T00:01:00.000Z'}],durationSeconds:60,...patch});
test('library foreground drains another book without its body and preserves newer local snapshots',async()=>{
 assert.equal(typeof draining.drainAccountReading,'function');const storage=memory(),key='marginalia-reading-outbox-v1|a|book|session|session',row=sessionRow();storage.setItem(key,JSON.stringify(row));let sent;
 const result=await draining.drainAccountReading({storage,owner:'a',books:[{bookId:'book',contentVersion:'v1'}],isCurrent:()=>true,send:async(bookId,value)=>{sent={bookId,value};storage.setItem(key,JSON.stringify(sessionRow({sequence:2})));return value;}});
 assert.equal(result.sent,1);assert.equal(sent.bookId,'book');assert.deepEqual(sent.value,row);assert.equal(JSON.parse(storage.getItem(key)).sequence,2);
});
test('cross-book drain rejects wrong receipts and changed source versions and never acknowledges after owner change',async()=>{
 assert.equal(typeof draining.drainAccountReading,'function');
 for(const mode of ['owner','receipt','version']){const storage=memory(),key='marginalia-reading-outbox-v1|a|book|session|session';storage.setItem(key,JSON.stringify(sessionRow()));storage.setItem('marginalia-reading-outbox-v1|b|book|session|private',JSON.stringify(sessionRow({id:'private'})));let current=true,calls=0;
 const result=await draining.drainAccountReading({storage,owner:'a',books:[{bookId:'book',contentVersion:mode==='version'?'v2':'v1'}],isCurrent:()=>current,send:async(_id,row)=>{calls++;if(mode==='owner')current=false;return mode==='receipt'?{...row,contentVersion:'wrong'}:row;}});
 assert.equal(result.sent,0);assert.equal(calls,mode==='version'?0:1);assert.notEqual(storage.getItem(key),null);assert.notEqual(storage.getItem('marginalia-reading-outbox-v1|b|book|session|private'),null);assert.equal(storage.getItem('marginalia-reading-outbox-v1|a|book|receipt|session'),null);
 }
});
test('the real visible-reader adoption offers a newer position while keeping the page and local drafts',async()=>{
 const fields=new Map(),local={passageId:'p1',pending:true,baseRevision:2},notes=[{id:'local-note',text:'Confirmed local thought',revision:1}],context={book:readingBook,records:{position:{revision:2},comments:notes},recordsUnavailable:false,recordsPositionUnresolved:false,progressSync:createProgressSync({revision:2,send:async()=>assert.fail('no automatic write')}),mergeLoadedReadingRecords,localStorage:{getItem:()=>JSON.stringify(local)},progressKey:'key',positionRecovery:{retain:()=>true},refreshPositionRecovery(){},clearTimeout(){},persistTimer:1,$:id=>{if(!fields.has(id))fields.set(id,{});return fields.get(id);},announceUi(){},READER_UI:'reader.b1.',dispatchReaderEvent(){},restoreAnchor:()=>assert.fail('no page jump'),renderPanel:()=>assert.fail('no editor replacement')};
 const host={current:()=>context,sync:context.progressSync,adopt:value=>{context.records=value;context.recordsUnavailable=false;},local:()=>local,retain:context.positionRecovery.retain,conflict:()=>{context.recordsPositionUnresolved=true;context.$('progress-notice').hidden=false;},updated(){}};
 adoptForegroundProgress(host,{revision:2,fresh:{bookId:readingBook.bookId,contentVersion:readingBook.contentVersion,position:{revision:3,passageId:'p2'},comments:[],questions:[]}});
 assert.equal(context.recordsPositionUnresolved,true);assert.equal(context.progressSync.paused,true);assert.equal(fields.get('progress-notice').hidden,false);assert.equal(context.records.comments[0].text,notes[0].text);
});
test('the deferred reader coordinator fences an owner change while its progress read is in flight',async()=>{
 let finish,updates=0;const current={owner:'a',epoch:1,book:readingBook,records:{position:{revision:2}},ready:true};
 const controller=createReaderProgressRefresh({current:()=>current,sync:createProgressSync({revision:2,send:async()=>assert.fail('no automatic write')}),read:()=>new Promise(resolve=>finish=resolve),adopt:()=>updates++,local:()=>null,retain:()=>assert.fail('stale owner must not touch recovery'),conflict:()=>assert.fail('stale owner must not publish UI'),updated:()=>updates++});
 const pending=controller.refresh();await new Promise(setImmediate);current.owner='b';finish({bookId:readingBook.bookId,contentVersion:readingBook.contentVersion,position:{revision:3}});await pending;assert.equal(updates,0);
});
test('optional personal pin state round trips in backups while old backups remain valid and malformed flags reject',async()=>{
 const backup={kind:'marginalia-library',schemaVersion:1,books:[{book:structuredClone(readingBook),records:readingRecords(),shelf:{order:[readingBook.bookId],pinned:true}}]};
 assert.equal(validateLibraryBackup(backup).books,1);const restored=await readLibraryArchive(await createLibraryArchive(backup));assert.equal(restored.backup.books[0].shelf.pinned,true);
 const old=structuredClone(backup);delete old.books[0].shelf;assert.equal(validateLibraryBackup(old).books,1);
 for(const pinned of ['true',1,null,{}]){const bad=structuredClone(backup);bad.books[0].shelf.pinned=pinned;assert.throws(()=>validateLibraryBackup(bad));}
});
test('a full translation hydration refreshes translation facts when no newer account snapshot superseded it',()=>{
 const rows=convergence.hydrateAccountBooks([{bookId:'b',contentVersion:'v1',supportsParallel:true,personalizationPending:false}],[{bookId:'b',contentVersion:'v1',supportsParallel:false}],{stale:false});assert.equal(rows[0].supportsParallel,false);
});
const portalSource=await readFile(new URL('../app/portal.js',import.meta.url),'utf8');
function portalRefreshFixture(){
 const calls=[],scope=createOwnerScope('a'),releases=new Map();let finish;const fields={children:[]};
 const context={...convergence,ownerScope:scope,accountStateEpoch:0,refreshGeneration:1,session:{user:{id:'a'}},books:[{bookId:'keep',contentVersion:'v1',supportsParallel:true,personalizationPending:false},{bookId:'archived',contentVersion:'v1'}],shelfRevision:1,personalizationPending:false,taskStorage:null,drainAccountReading:draining.drainAccountReading,api:async url=>{calls.push(url);return new Promise(resolve=>{finish=resolve;releases.set(url,resolve);});},shelfDrag:{reset(){}},dashboard:{update(){}},renderBooks(){},homeMenu:null,readingWorkspace:null,libraryArrival:null,document:{activeElement:null},$:()=>fields,window:{scrollY:0},status(){}};
 context.orderOperation=null;context.loadAccountShelfSync=async()=>convergence;vm.createContext(context);const start=portalSource.indexOf('accountForeground=createAccountShelfRefresh('),end=portalSource.indexOf('\n  return accountForeground;',start);vm.runInContext(portalSource.slice(start,end),context);return {context,calls,scope,release:(row,url)=>url?releases.get(url)(row):finish(row)};
}
const accountSnapshot=()=>({kind:'leafhour-account-shelf-v1',user:{id:'a'},shelfRevision:4,shelf:{revision:4,pinned:['keep'],pinsInitialized:true},books:[{bookId:'keep',contentVersion:'v1',pinned:true,readingStateReady:true,personalizationPending:true,resume:{passageId:'new'}}],archivedBooks:[{bookId:'archived',contentVersion:'v1'}]});
test('the real portal foreground reads only the light account projection and replaces archived membership',async()=>{
 const f=portalRefreshFixture(),a=f.context.accountForeground.refresh(),b=f.context.accountForeground.refresh();assert.equal(a,b);await Promise.resolve();assert.deepEqual(f.calls,['/api/library?view=account']);f.release(accountSnapshot());await a;
 assert.deepEqual(f.context.books.map(b=>b.bookId),['keep']);assert.equal(f.context.books[0].supportsParallel,true);assert.equal(f.context.books[0].resume.passageId,'new');assert.equal(f.context.shelfRevision,4);
});
test('the real portal foreground ignores an account-switch response',async()=>{
 const f=portalRefreshFixture(),pending=f.context.accountForeground.refresh();await Promise.resolve();f.scope.adopt('b');f.context.session={user:{id:'b'}};f.release(accountSnapshot());await pending;assert.equal(f.context.books.length,2);assert.equal(f.context.shelfRevision,1);
});
for(const outcome of ['confirmed','failed-module','owner-switch'])test('lazy account drain is owner fenced and keeps shelf metadata available after '+outcome,async()=>{
 const scope=createOwnerScope('a'),storage=memory(),key='marginalia-reading-outbox-v1|a|keep|session|session',row=sessionRow({bookId:'keep'});storage.setItem(key,JSON.stringify(row));const urls=[],applied=[];let loads=0,finish;
 const controller=convergence.createAccountShelfRefresh({scope,current:()=>({generation:1,accountID:scope.capture().owner,books:[],busy:false}),storage,begin(){},apply:(snapshot,rows)=>applied.push(rows),api:async(url,body)=>{urls.push(url);return body||accountSnapshot();},loadDrain:async()=>{loads++;if(outcome==='failed-module')throw Error('module unavailable');if(outcome==='owner-switch')await new Promise(resolve=>finish=resolve);return draining;}});
 const pending=controller.refresh();await new Promise(setImmediate);if(outcome==='owner-switch'){scope.adopt('b');finish();}await pending;assert.equal(loads,1);assert.equal(urls[0],'/api/library?view=account');assert.ok(urls.every(url=>url==='/api/library?view=account'||url.endsWith('/reading-sessions')));
 if(outcome==='confirmed'){assert.equal(urls.filter(url=>url.endsWith('/reading-sessions')).length,1);assert.equal(storage.getItem(key),null);assert.equal(applied.length,1);}
 else{assert.notEqual(storage.getItem(key),null);assert.equal(urls.length,1);assert.equal(applied.length,outcome==='owner-switch'?0:1);}
});
test('the real full hydration cannot resurrect a book removed by a newer account refresh',async()=>{
 const f=portalRefreshFixture(),node=parse(portalSource,{ecmaVersion:'latest',sourceType:'module'}).body.find(n=>n.type==='FunctionDeclaration'&&n.id.name==='hydrateLibrary');vm.runInContext(portalSource.slice(node.start,node.end),f.context);
 const pending=f.context.hydrateLibrary(1,f.scope.capture());await Promise.resolve();f.context.accountStateEpoch++;f.context.books=[{bookId:'keep',contentVersion:'v1',personalizationPending:true,pinned:true,resume:{passageId:'new'}}];f.context.shelfRevision=4;f.release({shelfRevision:1,books:[{bookId:'keep',contentVersion:'v1',supportsParallel:true,resume:{passageId:'old'}},{bookId:'archived',contentVersion:'v1'}]});await pending;
 assert.deepEqual(f.context.books.map(b=>b.bookId),['keep']);assert.equal(f.context.books[0].resume.passageId,'new');assert.equal(f.context.books[0].supportsParallel,true);assert.equal(f.context.shelfRevision,4);
});
test('a cold programmatic position save remains local until a real reading event exists',async()=>{
 const source=await readFile(new URL('../app/reader.js',import.meta.url),'utf8'),node=parse(source,{ecmaVersion:'latest',sourceType:'module'}).body.find(n=>n.type==='FunctionDeclaration'&&n.id.name==='persist');let cached,timers=0;
 const context={book:{},captureProgress:()=>({passageId:'p1'}),readerOwner:()=> 'a',selectedBookId:'book',cachePosition:value=>cached=value,clearTimeout(){},persistTimer:null,setTimeout:()=>timers++,recordsUnavailable:false,recordsPositionUnresolved:false,deferredProgress:false,progressSync:{save:()=>assert.fail('cold save cannot create recent reading')}};vm.createContext(context);vm.runInContext(source.slice(node.start,node.end),context);context.persist();assert.equal(cached.pending,false);assert.equal(timers,0);
});
test('a hydration started during a light refresh cannot later overwrite that refresh receipt',async()=>{
 const f=portalRefreshFixture(),node=parse(portalSource,{ecmaVersion:'latest',sourceType:'module'}).body.find(n=>n.type==='FunctionDeclaration'&&n.id.name==='hydrateLibrary');vm.runInContext(portalSource.slice(node.start,node.end),f.context);
 const account=f.context.accountForeground.refresh();await Promise.resolve();const full=f.context.hydrateLibrary(1,f.scope.capture());await Promise.resolve();f.release(accountSnapshot(),'/api/library?view=account');await account;f.release({shelfRevision:1,books:[{bookId:'archived',contentVersion:'v1'}]},'/api/library');await full;
 assert.deepEqual(f.context.books.map(b=>b.bookId),['keep']);assert.equal(f.context.shelfRevision,4);
});
test('reading-state filters use authoritative status even while translation metadata is still loading',()=>{
 const rows=[{bookId:'finished',personalizationPending:true,readingStateReady:true,journey:{status:'finished'}}];assert.equal(workspace.libraryShelf(rows,{status:'reading'}).length,0);assert.equal(workspace.libraryShelf(rows,{status:'finished'}).length,1);
});
test('full legacy hydration retains verified pins when that response does not carry pin fields',()=>{
 const rows=convergence.hydrateAccountBooks([{bookId:'b',contentVersion:'v1',pinned:true,readingStateReady:true}],[{bookId:'b',contentVersion:'v1',supportsParallel:false}],{stale:false});assert.equal(rows[0].pinned,true);assert.equal(rows[0].supportsParallel,false);
});
test('finished cross-book delivery retires its receipt and each foreground drain is bounded to 20 requests',async()=>{
 const storage=memory(),prefix='marginalia-reading-outbox-v1|a|book';for(let i=0;i<21;i++){const row=sessionRow({id:'r'+i});storage.setItem(prefix+'|session|'+row.id,JSON.stringify(row));}
 const result=await draining.drainAccountReading({storage,owner:'a',books:[{bookId:'book',contentVersion:'v1'}],isCurrent:()=>true,send:async(_id,row)=>row});assert.equal(result.sent,20);assert.equal(storage.getItem(prefix+'|receipt|r0'),null);assert.equal(storage.getItem(prefix+'|session|r0'),null);assert.notEqual(storage.getItem(prefix+'|session|r20'),null);
});
test('a receipt cannot erase a concurrently changed legacy payload even at the same sequence',async()=>{
 const storage=memory(),key='marginalia-reading-outbox-v1|a|book',row=sessionRow();storage.setItem(key,JSON.stringify([row]));
 await draining.drainAccountReading({storage,owner:'a',books:[{bookId:'book',contentVersion:'v1'}],isCurrent:()=>true,send:async(_id,sent)=>{storage.setItem(key,JSON.stringify([{...row,status:'paused'}]));return sent;}});assert.equal(JSON.parse(storage.getItem(key))[0].status,'paused');
});
for(const timing of ['before-ack','after-ack'])test('full hydration started during an order cannot roll back the '+timing+' manual intent',async()=>{
 const f=portalRefreshFixture(),ast=parse(portalSource,{ecmaVersion:'latest',sourceType:'module'});for(const name of ['hydrateLibrary','saveShelfOrder']){const node=ast.body.find(n=>n.type==='FunctionDeclaration'&&n.id.name===name);vm.runInContext(portalSource.slice(node.start,node.end),f.context);}
 Object.assign(f.context,{books:[{bookId:'a',contentVersion:'v1',shelfPosition:0},{bookId:'b',contentVersion:'v1',shelfPosition:1}],shelfRevision:0,manualShelfBooks:workspace.manualShelfBooks,getOwner:()=> 'a:0',shelfControls:{set(){}},bookActions:null});f.context.document.querySelectorAll=()=>[];
 const ordering=f.context.saveShelfOrder(['b','a']),hydrating=f.context.hydrateLibrary(1,f.scope.capture());await Promise.resolve();
 const old={shelfRevision:0,books:[{bookId:'a',contentVersion:'v1',shelfPosition:0,supportsParallel:true},{bookId:'b',contentVersion:'v1',shelfPosition:1}]};
 if(timing==='before-ack'){f.release(old,'/api/library');await hydrating;assert.deepEqual(workspace.manualShelfBooks(f.context.books).map(b=>b.bookId),['b','a']);}
 f.release({revision:1},'/api/library/order');await ordering;
 if(timing==='after-ack'){f.release(old,'/api/library');await hydrating;}
 assert.equal(f.context.shelfRevision,1);assert.deepEqual(workspace.manualShelfBooks(f.context.books).map(b=>b.bookId),['b','a']);
});
test('an older full hydration never lowers a known shelf revision',async()=>{
 const f=portalRefreshFixture(),node=parse(portalSource,{ecmaVersion:'latest',sourceType:'module'}).body.find(n=>n.type==='FunctionDeclaration'&&n.id.name==='hydrateLibrary');vm.runInContext(portalSource.slice(node.start,node.end),f.context);f.context.shelfRevision=4;const pending=f.context.hydrateLibrary(1,f.scope.capture());f.release({shelfRevision:0,books:[]});await pending;assert.equal(f.context.shelfRevision,4);assert.equal(f.context.books.length,2);
});
test('a stationary trusted reading tap freezes a durable checkpoint without requiring scroll or a running timer',async()=>{
 const source=await readFile(new URL('../app/reader.js',import.meta.url),'utf8'),ast=parse(source,{ecmaVersion:'latest',sourceType:'module'}),persistNode=ast.body.find(n=>n.type==='FunctionDeclaration'&&n.id.name==='persist'),start=source.indexOf("for(const type of ['pointerdown'"),end=source.indexOf('let progressRefreshLoad=',start),listeners=new Map();let saved;
 const progressActivity=activity.createReadingActivityCheckpoint({now:()=>Date.parse('2026-11-01T00:00:00Z')}),context={progressActivity,entryInteracted:false,restoringProgress:false,document:{hidden:false},listen:(_target,type,handler)=>listeners.set(type,handler),book:{},captureProgress:()=>({chapterId:'c',passageId:'p',observedAt:progressActivity.observedAt}),readerOwner:()=> 'a',selectedBookId:'book',cachePosition:value=>saved=value,clearTimeout(){},persistTimer:null,setTimeout:()=>1,recordsUnavailable:false,recordsPositionUnresolved:false,deferredProgress:false,progressSync:{save:async()=>{}}};
 vm.createContext(context);vm.runInContext(source.slice(persistNode.start,persistNode.end)+'\n'+source.slice(start,end),context);const target={closest:selector=>selector.includes('#book-page')?target:null};listeners.get('pointerdown')({isTrusted:true,target});assert.equal(saved?.pending,true);assert.equal(saved.observedAt,'2026-11-01T00:00:00.000Z');
 const previous=saved;listeners.get('pointerdown')({isTrusted:false,target});assert.equal(saved,previous);
});
