import {t as uiText,requestUiRoute} from '../app/ui-locale.mjs';
test.beforeEach(async()=>{await requestUiRoute('zh-Hans');});
test.afterEach(async()=>{await requestUiRoute('en');});
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {readingBook} from './reading-fixtures.mjs';
import {createReadingClock} from '../app/reading-clock.mjs';
import {createReadingOutbox} from '../app/reading-outbox.mjs';
import {createReadingQueueStore} from '../app/reading-queue-store.mjs';
import {createReadingSessionCoordinator} from '../app/reading-session-coordinator.mjs';
import {createManualReadingAction,manualReadingSession} from '../app/reading-manual.mjs';
import {createReadingMarkStore} from '../app/reading-mark-store.mjs';
import {createReadingMarkActions} from '../app/reading-mark-actions.mjs';
import {createReadingDraftStore} from '../app/reading-draft-store.mjs';
import {restoreReadingEnding,latestReadingEnding} from '../app/reading-ending-context.mjs';
const source=await readFile(new URL('../app/reading-session.js',import.meta.url),'utf8');
const between=(start,end)=>source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));
const anchor={chapterId:'ch01',passageId:'p1'},input={id:'manual-memory',book:readingBook,anchor,timeZone:'UTC',startedAt:'2026-10-14T12:00:00.000Z',endedAt:'2026-10-14T12:10:00.000Z'};
const tick=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};

// Execute the actual page lifecycle glue with real persistence modules. DOM
// rendering is separate; a corrupt mark store must not replace another store.
test('retrying partially failed initialization preserves and later saves the only memory manual snapshot',async()=>{
 const values=new Map([['marks','{}']]);let writesFail=true;const sent=[],fields=new Map(),storage={get length(){return values.size;},key:i=>[...values.keys()][i]||null,getItem:k=>values.get(k)??null,setItem(k,v){if(writesFail)throw Error('QuotaExceededError');values.set(k,String(v));},removeItem:k=>values.delete(k)};
 const context={listen:(node,type,handler,options)=>node.addEventListener(type,handler,options),disposed:false,SESSION_UI:'reader.session.',notice:(id,params)=>({id,params}),structuredClone,createReadingClock,createReadingOutbox,createReadingQueueStore,createReadingSessionCoordinator,createManualReadingAction,manualReadingSession,createReadingMarkStore,createReadingMarkActions,createReadingDraftStore,restoreReadingEnding,latestReadingEnding,loadJSON:()=>null,records:()=>({readingSessions:[]}),bridge:()=>({getBook:()=>readingBook}),ready:false,document:{body:{dataset:{ready:'true'}},hidden:false,hasFocus:()=>true},$:id=>{if(!fields.has(id))fields.set(id,{});return fields.get(id);},clock:createReadingClock(),readerSession:{user:{id:'isolated-reader'}},readerOffline:{owner:'isolated-reader',isOffline:()=>false},selectedBookId:readingBook.bookId,localStorage:storage,queueKey:'queue',markKey:'marks',draftKey:'drafts',endingKey:'ending',storageFailure:null,outbox:null,queueStore:null,coordinator:null,manualAction:null,marks:null,markStore:null,drafts:null,lastEnding:null,book:null,render(){},message(){},manualUi:{confirm(){}},api:async(route,row)=>{sent.push(structuredClone(row));return row;},syncing:false};
 vm.createContext(context);vm.runInContext(between('function setup(){',"listen($('reading-toggle'),")+'\n'+between('async function sync(){','\nfunction checkpoint(){'),context);context.setup();assert.equal(context.marks,null);
 await assert.rejects(context.manualAction.submit(input),/QuotaExceededError/);const original=context.manualAction;assert.equal(original.durable(),false);assert.equal(original.pending().id,input.id);await context.sync();
 assert.equal(context.manualAction,original,'initialization retry cannot discard an existing controller');assert.equal(context.manualAction.pending().id,input.id);assert.equal(sent.length,0);
 writesFail=false;values.set('marks','[]');await context.sync();await tick();await context.manualAction.retry();assert.equal(sent.length,1);assert.equal(sent[0].id,input.id);assert.equal(sent[0].durationSeconds,600);assert.equal(context.manualAction.pending(),null);
});
test('actual capture and click order resumes an idle estimate on its first continue click',()=>{
 let at=Date.parse('2026-10-14T12:00:00Z');const clock=createReadingClock({now:()=>at,heartbeatGapMs:5000});clock.start({id:'idle',bookId:readingBook.bookId,contentVersion:readingBook.contentVersion,anchor,timeZone:'UTC',source:'reader_estimate'});for(let n=0;n<120;n++){at+=1000;clock.view();}assert.equal(clock.view().idle,true);
 let click;const capture=new Map(),toggle={addEventListener:(type,fn)=>click=fn,closest:selector=>selector==='#reading-toggle'?toggle:null},context={listen:(node,type,handler,options)=>node.addEventListener(type,handler,options),clock,ready:true,frozen:false,document:{addEventListener:(type,fn)=>capture.set(type,fn)},$:()=>toggle,coordinator:{},queueStore:{},book:readingBook,timeZone:'UTC',deviceTimeZone:()=> 'UTC',actualAnchor:()=>anchor,checkpoint(){},sync(){},render(){},storageFailure:null,message(){}};
 vm.createContext(context);vm.runInContext(between("listen($('reading-toggle'),","listen($('reading-end'),")+'\n'+between("for(const type of ['pointerdown','keydown','scroll'])","listen(document,'reader:ready'"),context);
 capture.get('pointerdown')({isTrusted:true,target:toggle});click();assert.equal(clock.view().status,'active');assert.equal(clock.view().idle,false);at+=1000;assert.equal(clock.view().elapsedSeconds,121);
});
test('the page context uses the device timezone when opening each new manual record after a timezone change',t=>{
 const previous=process.env.TZ;process.env.TZ='UTC';t.after(()=>{if(previous===undefined)delete process.env.TZ;else process.env.TZ=previous;});let contextOfForm;const context={listen:(node,type,handler,options)=>node.addEventListener(type,handler,options),document:{getElementById:()=>({})},createReadingClock,book:readingBook,actualAnchor:()=>anchor,manualAction:null,mountManualReading:options=>{contextOfForm=options.getContext;return {};}};
 vm.createContext(context);vm.runInContext(between('const $=id=>','const queueKey=')+'\n'+between('const manualUi=mountManualReading(','function renderTimeSource('),context);
 assert.equal(contextOfForm().timeZone,'UTC');process.env.TZ='Asia/Singapore';assert.equal(contextOfForm().timeZone,'Asia/Singapore');
});
