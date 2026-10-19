import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {createLibraryService} from '../server/library-service.mjs';
import {createLibraryPortability} from '../server/library-portability.mjs';
import {exportLibraryInParts} from '../app/library-export.mjs';
import {createLibraryArchive,readLibraryArchive,personalExportItems,selectedRecordExport,portableHash,PART_BYTES} from '../app/library-portability.mjs';
import {validateLibraryBackup} from '../app/library-backup.mjs';
import {globalPreferencesDefaults,normalizeGlobalPreferences,validateGlobalPreferences,validateGlobalPreferencesMetadata,openingReadingView,entryViewPreferences,openingReadingPreferences} from '../app/reading-preferences.mjs';
import {zipSync,unzipSync,strToU8,strFromU8} from 'fflate';
import {resolveReaderEntry} from '../app/reader-return.mjs';
import {chineseOriginalOnly} from '../app/source-language.mjs';
import {readingBook,readingRecords} from './reading-fixtures.mjs';
import {mountReadingPreferencesForm,mountReadingSetupInvite} from '../app/library-reading-preferences.mjs';

const owner={id:'prefs-owner'},other={id:'prefs-other'};
const raw=(patch={})=>({...globalPreferencesDefaults,mode:'parallel',variant:'literal',...patch});
const snapshot=(patch={})=>validateGlobalPreferences(raw(patch));

// ---- reader opening precedence ----
test('reader opening precedence honors entry intent, remembered views, account defaults and guest defaults',()=>{
  const account=snapshot({mode:'zh',variant:'interpretive',font:27});
  const saved={...account,mode:'parallel',variant:'literal',readingPurpose:'manual',font:24,chapterId:'ch01',passageId:'p1',offset:12,withinParagraph:.2};
  // a valid per-book saved view wins, including a deliberate manual parallel/zh view
  const fromSaved=openingReadingView({saved,account});
  assert.equal(fromSaved.mode,'parallel');assert.equal(fromSaved.variant,'literal');assert.equal(fromSaved.font,24);
  assert.equal(openingReadingView({saved:{...saved,mode:'zh'},account}).mode,'zh','manual zh is remembered too');
  // account defaults open books without a saved view
  const fromAccount=openingReadingView({account});
  assert.equal(fromAccount.mode,'zh');assert.equal(fromAccount.variant,'interpretive');assert.equal(fromAccount.font,27);
  // safe guest defaults stay legacy original-first
  assert.equal(openingReadingView({}).mode,'en');assert.equal(openingReadingView({saved:null,account:null}).mode,'en');
  // Chinese-original-only books always stay on the source text
  const chinese={bookId:'zh-book',contentVersion:'v1',sourceLanguage:'zh',chapters:[],sections:[{chapterId:'ch01',paragraphs:[{id:'p1',original:'中文原文。',translations:{}}]}]};
  assert.equal(chineseOriginalOnly(chinese),true);
  assert.equal(openingReadingView({saved,account,sourceOnly:true}).mode,'en');
  assert.equal(openingReadingView({account,sourceOnly:true}).mode,'en');
  // exact entry intent overrides whatever would have opened
  const opened=openingReadingView({saved,account});
  assert.deepEqual({...opened,...entryViewPreferences({note:'question'})},{...opened,mode:'en'});
  assert.deepEqual(entryViewPreferences({action:'translate'}),{mode:'en'});
  assert.deepEqual(entryViewPreferences({layer:'original',mode:'en'}),{mode:'en'});
  assert.deepEqual(entryViewPreferences({layer:'interpretive',mode:'zh',variant:'interpretive'}),{mode:'zh',variant:'interpretive'});
  assert.deepEqual(entryViewPreferences(null),{});
  // real deep links resolve through the same entry override
  const book={bookId:'entry-book',contentVersion:'v1',sections:[{chapterId:'ch01',paragraphs:[{id:'p1',original:'x',translations:{}}]}]};
  const entry=resolveReaderEntry(book,new URLSearchParams({book:'entry-book',passage:'p1',contentVersion:'v1',layer:'literal'}));
  assert.deepEqual(entryViewPreferences(entry),{mode:'zh',variant:'literal'});
  assert.equal({...openingReadingView({account}),...entryViewPreferences(entry)}.variant,'literal','a cited layer wins over the account default variant');
});

test('reader integration remembers a manual parallel view and keeps source-only books on the original',async()=>{
  const preferences=await import('../app/reading-preferences.mjs');
  const {chineseOriginalOnly}=await import('../app/source-language.mjs');
  const {resolveReadingPosition,chooseReadingPosition,resumeSummary,recoveredPositionNeedsChoice}=await import('../app/reading-progress.mjs');
  const {mergeLoadedReadingRecords}=await import('../app/reading-load.mjs');
  const reader=await import('node:fs/promises').then(({readFile})=>readFile(new URL('../app/reader.js',import.meta.url),'utf8'));
  const delayed=reader.slice(reader.indexOf('async function adoptLoadedRecords('),reader.indexOf("for(const type of ['pointerdown'"));
  for(const sourceLanguage of ['en','zh']){
    const book={bookId:'restore-book',contentVersion:'v1',sourceLanguage,chapters:[{id:'ch02'}],sections:[{chapterId:'ch02',paragraphs:[{id:'p22',original:'Synthetic source.',translations:{}}]}]};
    const position={contentVersion:'v1',chapterId:'ch02',passageId:'p22',offset:-100,withinParagraph:.4,revision:2,mode:'parallel',variant:'literal',readingPurpose:'manual',preferredLanguage:'source'};
    const fresh={position,comments:[],questions:[]},state=openingReadingPreferences(normalizeGlobalPreferences({mode:'zh'}));let rendered,anchor;
    const {createReadingBook,createReadingNavigation}=await import('../app/reading-book.mjs');
    const context={readingNavigation:createReadingNavigation({isLoaded:()=>true,ensure:async()=>{},commit(){}}),readingBook:createReadingBook({book,readChapter:()=>assert.fail('complete books need no chapter read')}),book,state,openingReadingPreferences,chineseOriginalOnly,resolveReadingPosition,chooseReadingPosition,resumeSummary,recoveredPositionNeedsChoice,mergeLoadedReadingRecords,loadGeneration:1,recordsPending:true,records:fresh,selectedBookId:book.bookId,readerSession:{user:{id:'synthetic-owner'},readingPreferences:{preferences:normalizeGlobalPreferences({mode:'zh'})}},entryInteracted:false,localStorage:{getItem:()=>null},progressKey:'synthetic',recordsPositionUnresolved:false,progressSync:{revision:1,adopt(){}},deferredProgress:false,document:{body:{dataset:{}},dispatchEvent(){},getElementById:()=>({})},CustomEvent:class{},$:()=>({hidden:true}),renderChapter:()=>{rendered={...state};},restoreAnchor:value=>{anchor=value;},cachePosition(){},queueReadingFlow(){},renderPanel(){},api:async()=>fresh,trackActionFocus:()=>({stop(){},restore(){}}),closePanel(){},dismissTools(){},announce(){},progressSequence:0,persistTimer:null,clearTimeout};
    context.anchor=()=>anchor;vm.createContext(context);
    vm.runInContext(delayed+'\nthis.restoreDelayed=adoptLoadedRecords;',context);
    await context.restoreDelayed(fresh,{generation:1,explicitEntry:false});
    assert.equal(rendered.mode,sourceLanguage==='zh'?'en':'parallel','a remembered manual parallel view survives reopening; source-only stays original');
    assert.equal(rendered.variant,'literal');assert.equal(rendered.readingPurpose,'manual');
    assert.equal(anchor.passageId,'p22');assert.equal(anchor.withinParagraph,.4);
    assert.equal(fresh.position.mode,'parallel','restoring must not rewrite the saved record');
    assert.equal(state.mode,sourceLanguage==='zh'?'en':'parallel');
  }
});

// ---- compact settings form and first-reading invitation (DOM fixtures) ----
class Element extends EventTarget{
  constructor(tag,id){super();this.tagName=tag;this.id=id||'';this.children=[];this.attributes={};this.dataset={};this.value='';this.textContent='';this.className='';this.hidden=false;this.disabled=false;this.classList={toggle(){},add(){},remove(){}};}
  append(...nodes){for(const node of nodes){if(node.parentElement)node.parentElement.children=node.parentElement.children.filter(child=>child!==node);node.parentElement=this;this.children.push(node);}}
  setAttribute(key,value){this.attributes[key]=String(value);}getAttribute(key){return this.attributes[key];}hasAttribute(key){return key in this.attributes;}
  focus(){}
  querySelector(selector){const id=selector.startsWith('#')?selector.slice(1):null;const matches=node=>id?node.id===id:selector==='h2'?node.tagName==='h2':selector==='p:not([id])'?node.tagName==='p'&&!node.id:false;const walk=root=>matches(root)?root:root.children.map(walk).find(Boolean);return walk(this);}
}
const find=(root,id)=>root.querySelector('#'+id);
const dom=()=>{globalThis.document={createElement:tag=>new Element(tag),addEventListener(){},dispatchEvent(){}};return new Element('root');};

test('logout clears account defaults even when the portal retains the old preference snapshot',async()=>{
  const root=dom(),calls=[];
  let session={user:{id:'account-a'},readingPreferences:{revision:4,preferences:snapshot({font:27,theme:'night',mode:'zh'})}};
  const ui=mountReadingPreferencesForm({root,getSession:()=>session,api:async(url,body)=>{calls.push({url,body});return {revision:body.baseRevision+1,preferences:body.preferences};}});
  const font=find(root,'habits-font'),theme=find(root,'habits-theme'),view=find(root,'habits-view'),save=find(root,'habits-save'),form=find(root,'habits-status').parentElement;
  assert.equal(font.value,'27');
  // Actual portal signOut keeps the session envelope, clearing only user.
  session={...session,user:null};ui.update();
  assert.equal(font.value,String(globalPreferencesDefaults.font));assert.equal(theme.value,'system');assert.equal(view.value,'parallel');assert.equal(save.disabled,true);
  await form.dispatchEvent(new Event('submit',{cancelable:true}));await new Promise(setImmediate);assert.equal(calls.length,0);
  session={user:null,readingPreferences:null};ui.update();
  assert.equal(font.value,String(globalPreferencesDefaults.font));assert.equal(save.disabled,true);
  session={user:{id:'account-b'},readingPreferences:{revision:7,preferences:snapshot({font:24,theme:'leaf'})}};ui.update();
  assert.equal(font.value,'24');assert.equal(theme.value,'leaf');assert.equal(save.disabled,false);
  await form.dispatchEvent(new Event('submit',{cancelable:true}));await new Promise(setImmediate);
  assert.equal(calls.length,1);assert.equal(calls[0].body.baseRevision,7);assert.equal(calls[0].body.preferences.font,24);
});

test('the compact form saves one full snapshot, keeps hidden fields and reports honest errors',async()=>{
  const root=dom(),calls=[],saved=[];
  let session={user:{id:'account-a'},readingPreferences:{revision:2,updatedAt:'2026-10-18T00:00:00.000Z',preferences:snapshot({mode:'zh',pageLayout:'spread',parallelStyle:'reveal',lineHeight:2.2,theme:'leaf'})}};
  let responder=async(url,body)=>{calls.push({url,body});return {revision:3,updatedAt:'2026-10-18T01:00:00.000Z',preferences:body.preferences};};
  const ui=mountReadingPreferencesForm({root,api:(url,body)=>responder(url,body),getSession:()=>session,onSaved:value=>{saved.push(value);session.readingPreferences=value;}});
  const view=find(root,'habits-view'),language=find(root,'habits-language'),font=find(root,'habits-font'),theme=find(root,'habits-theme'),family=find(root,'habits-family'),form=find(root,'habits-status').parentElement;
  assert.equal(view.value,'zh','the saved account view is the starting point');assert.equal(theme.value,'leaf');
  view.value='parallel';view.dispatchEvent(new Event('change'));font.value='25';font.dispatchEvent(new Event('input'));
  await form.dispatchEvent(new Event('submit',{cancelable:true}));await new Promise(setImmediate);
  assert.equal(calls.length,1);assert.equal(calls[0].url,'/api/account/reading-preferences');assert.equal(calls[0].body.baseRevision,2);
  const posted=calls[0].body.preferences;
  assert.deepEqual(Object.keys(posted).sort(),Object.keys(globalPreferencesDefaults).sort(),'every appearance field stays in the full snapshot');
  assert.equal(posted.mode,'parallel');assert.equal(posted.font,25);assert.equal(posted.onboarding,'completed','completing the setup hides the invitation');
  for(const [key,value]of [['pageLayout','spread'],['parallelStyle','reveal'],['lineHeight',2.2],['theme','leaf'],['variant','literal']])assert.equal(posted[key],value,key+' is retained although the compact form hides it');
  validateGlobalPreferences(posted);
  assert.equal(saved.length,1);assert.equal(find(root,'habits-status').textContent.includes('saved'),true);
  assert.equal(view.value,'parallel');assert.equal(session.readingPreferences.revision,3);
  // a failed or 409 save keeps the visible values and never claims cloud success
  responder=async()=>{throw Object.assign(Error('阅读习惯已在另一处更新，请刷新后重新保存'),{status:409});};
  await form.dispatchEvent(new Event('submit',{cancelable:true}));await new Promise(setImmediate);
  assert.equal(saved.length,1);assert.equal(view.value,'parallel');assert.equal(font.value,'25');
  assert.match(find(root,'habits-status').textContent,/updated elsewhere/i);assert.equal(find(root,'habits-status').getAttribute('role'),'alert');
});

test('a late save from a previous account never adopts into the next account',async()=>{
  const root=dom(),saved=[];let session={user:{id:'account-a'},readingPreferences:null},release;
  const ui=mountReadingPreferencesForm({root,api:async()=>{await new Promise(r=>{release=r;});return {revision:9,updatedAt:'2026-10-18T02:00:00.000Z',preferences:snapshot()};},getSession:()=>session,onSaved:value=>saved.push(value)});
  const form=find(root,'habits-status').parentElement;
  await form.dispatchEvent(new Event('submit',{cancelable:true}));
  session={user:{id:'account-b'},readingPreferences:null}; // account switched while the request was in flight
  release();await new Promise(setImmediate);
  assert.equal(saved.length,0,'stale responses are dropped');assert.equal(find(root,'habits-status').textContent,'');
  ui.update();assert.equal(find(root,'habits-view').value,'parallel','the new account starts from its own defaults');
});

test('the first-reading invitation is quiet, skippable durably and reopens with the same form',async()=>{
  const root=dom();root.append(new Element('button','reading-setup-open'),new Element('button','reading-setup-skip'),new Element('p','reading-setup-status'));
  const opened=[],saved=[];let session={user:{id:'account-a'},readingPreferences:null},calls=[];
  const ui=mountReadingSetupInvite({root,api:async(url,body)=>{calls.push(body);return {revision:1,updatedAt:'2026-10-18T03:00:00.000Z',preferences:body.preferences};},getSession:()=>session,onSaved:value=>{saved.push(value);session.readingPreferences=value;},openSettings:tab=>opened.push(tab)});
  assert.equal(root.hidden,false,'signed-in users with no completed or dismissed setup see the invitation');
  find(root,'reading-setup-open').dispatchEvent(new Event('click'));assert.deepEqual(opened,['reading-habits'],'the invitation opens the same compact form');
  await find(root,'reading-setup-skip').dispatchEvent(new Event('click'));await new Promise(setImmediate);
  assert.equal(calls.length,1);assert.equal(calls[0].baseRevision,0);assert.equal(calls[0].preferences.onboarding,'dismissed','暂不设置 is recorded durably');
  validateGlobalPreferences(calls[0].preferences);
  assert.equal(root.hidden,true);assert.equal(saved.length,1);
  ui.update();assert.equal(root.hidden,true,'a dismissed invitation stays dismissed across updates');
  session={user:{id:'account-a'},readingPreferences:{revision:1,updatedAt:'2026-10-18T03:00:00.000Z',preferences:snapshot({onboarding:'pending'})}};
  ui.update();assert.equal(root.hidden,false,'an unfinished setup can reopen the invitation');
  session={user:{id:'account-a'},readingPreferences:{revision:2,updatedAt:'2026-10-18T04:00:00.000Z',preferences:snapshot({onboarding:'completed'})}};
  ui.update();assert.equal(root.hidden,true,'completing the setup hides the invitation');
  session={user:null,readingPreferences:null};ui.update();assert.equal(root.hidden,true,'guests are never asked');
});

// ---- reader "设为新书默认" action ----
test('the reader action saves the current view as new-book defaults without moving the book',async t=>{
  const {requestUiRoute}=await import('../app/ui-locale.mjs');await requestUiRoute('zh-Hans');t.after(()=>requestUiRoute('en'));
  const root=dom();
  root.append(new Element('section','reading-defaults-setting'),new Element('button','save-reading-defaults'),new Element('p','reading-defaults-status'));
  const {mountReadingDefaults}=await import('../app/reader-settings.mjs');
  const state={chapterId:'ch07',mode:'parallel',variant:'literal',font:26,theme:'night',readingPurpose:'deep',preferredLanguage:'zh',pageLayout:'spread',lineHeight:2.1,paragraphGap:28,letterSpacing:0.02,wordSpacing:0.04,fontWeight:500,indent:true,parallelLayout:'stack',parallelStyle:'quote',parallelColor:'green',parallelBackground:'soft'};
  const before=structuredClone(state);let session={user:{id:'account-a'},readingPreferences:{revision:4,updatedAt:'2026-10-18T05:00:00.000Z',preferences:snapshot({onboarding:'completed'})}},calls=[],saved=[],responder=async(url,body)=>{calls.push({url,body});return {revision:5,updatedAt:'2026-10-18T06:00:00.000Z',preferences:body.preferences};};
  const ui=mountReadingDefaults({document:{getElementById:id=>root.querySelector('#'+id)},api:(url,body)=>responder(url,body),getState:()=>state,getSession:()=>session,onSaved:value=>{saved.push(value);session.readingPreferences=value;}});
  const button=root.querySelector('#save-reading-defaults'),status=root.querySelector('#reading-defaults-status');
  assert.equal(root.querySelector('#reading-defaults-setting').hidden,false,'signed-in readers see the explicit action');
  await button.dispatchEvent(new Event('click'));await new Promise(setImmediate);
  assert.equal(calls[0].url,'/api/account/reading-preferences');assert.equal(calls[0].body.baseRevision,4);
  const posted=calls[0].body.preferences;
  assert.equal(posted.mode,'parallel');assert.equal(posted.variant,'literal');assert.equal(posted.font,26);assert.equal(posted.theme,'night');assert.equal(posted.parallelStyle,'quote');assert.equal(posted.pageLayout,'spread');
  assert.equal(posted.onboarding,'completed','the setup state is carried over, never silently invented');
  validateGlobalPreferences(posted);assert.deepEqual(state,before,'the chapter, anchor and records of this book stay untouched');
  assert.match(status.textContent,/新书默认|saved/i);assert.equal(saved.length,1);assert.equal(session.readingPreferences.revision,5);
  responder=async()=>{throw Object.assign(Error('阅读习惯已在另一处更新，请刷新后重新保存'),{status:409});};
  await button.dispatchEvent(new Event('click'));await new Promise(setImmediate);
  assert.equal(saved.length,1);assert.deepEqual(state,before);assert.match(status.textContent,/暂未保存/);assert.equal(status.getAttribute('role'),'alert');
  responder=async()=>{await new Promise(r=>setTimeout(r,0));return {revision:9,updatedAt:'2026-10-18T07:00:00.000Z',preferences:snapshot()};};
  await button.dispatchEvent(new Event('click'));session={user:{id:'account-b'},readingPreferences:null};await new Promise(setImmediate);
  assert.equal(saved.length,1,'a stale response never adopts into another account');
  session={user:null,readingPreferences:null};ui.update();assert.equal(root.querySelector('#reading-defaults-setting').hidden,true,'guests are not offered account defaults');
});

// ---- portability: manifest → parts → ZIP → fresh restore ----
function staging(){const values=new Map(),queues=new Map();return {values,async read(k,d){return structuredClone(values.get(k)??d);},async mutate(k,d,fn){const prior=queues.get(k)||Promise.resolve(),p=prior.catch(()=>{}).then(async()=>{const row=await this.read(k,d);fn(structuredClone(row));const result=await fn(row);values.set(k,JSON.parse(JSON.stringify(row)));return structuredClone(result);});queues.set(k,p);try{return await p;}finally{if(queues.get(k)===p)queues.delete(k);}}};}
const chatStub={exportHistory:async()=>null,validateHistory:async()=>{},restoreHistory:async()=>{}};
async function library(t,name){const dir=await mkdtemp(path.join(tmpdir(),'prefs-'+name+'-'));t.after(()=>rm(dir,{recursive:true,force:true}));return createLibraryService({dataDir:dir,catalogDir:null,translator:null});}
async function seed(service){
  const book=await service.importDocument(owner,{filename:'preferences-source.txt',bytes:Buffer.from('First source paragraph.\n\nSecond source paragraph.')});
  const p=book.sections[0].paragraphs[0];
  await service.addComment(owner,book.bookId,{id:'note',passageId:p.id,text:'Own comment',contentVersion:book.contentVersion});
  await service.saveProgress(owner,book.bookId,{...normalizeGlobalPreferences({}),chapterId:book.sections[0].chapterId,passageId:p.id,offset:3,mode:'parallel',variant:'interpretive'});
  return book;
}
const apiFor=(service,user)=>async url=>{
  const target=new URL(url,'https://fixture.invalid');
  if(target.pathname==='/api/library/export/manifest')return service.exportManifest(user);
  const match=target.pathname.match(/^\/api\/library\/books\/([^/]+)\/(export-part|portability-part)$/);
  if(match){const args={offset:Number(target.searchParams.get('offset')||0),snapshot:target.searchParams.get('snapshot')};return match[2]==='export-part'?service.exportBookPart(user,decodeURIComponent(match[1]),args):createLibraryPortability({library:service,chat:chatStub,store:staging()}).exportPart(user,decodeURIComponent(match[1]),args);}
  throw Error('unexpected export url '+url);
};

test('account defaults travel through manifest, parts and ZIP and recover on a fresh instance',async t=>{
  const source=await library(t,'source');await seed(source);
  const view=await source.saveReadingPreferences(owner,{baseRevision:0,preferences:snapshot({mode:'parallel',variant:'literal',font:27,theme:'night',onboarding:'completed'})});
  const backup=await exportLibraryInParts({api:apiFor(source,owner)});
  assert.deepEqual(backup.readingPreferences.preferences,view.preferences);
  assert.equal(backup.readingPreferences.revision,view.revision);assert.equal(backup.readingPreferences.kind,'marginalia-reading-preferences');
  const manifest=await source.exportManifest(owner);assert.deepEqual(manifest.readingPreferences.preferences,view.preferences);
  const bytes=await createLibraryArchive(backup),unzipped=await readLibraryArchive(bytes);
  assert.deepEqual(unzipped.backup.readingPreferences,backup.readingPreferences,'the current archive format carries the optional metadata without a schema bump');
  validateLibraryBackup(unzipped.backup);
  const target=await library(t,'target'),portability=createLibraryPortability({library:target,chat:chatStub,store:staging()});
  const operation=await portability.start(owner,{bytes:bytes.length,sha256:await portableHash(bytes)});
  for(let offset=0;offset<bytes.length;offset+=PART_BYTES)await portability.part(owner,operation.id,{offset,data:Buffer.from(bytes.subarray(offset,Math.min(bytes.length,offset+PART_BYTES))).toString('base64')});
  await portability.commit(owner,operation.id);
  const recovered=await target.getReadingPreferences(owner);
  assert.deepEqual(recovered.preferences,view.preferences,'a fresh instance restores the account defaults');
  assert.equal(recovered.revision,view.revision);assert.equal(recovered.updatedAt,view.updatedAt);
  // the restored library keeps books, records and the per-book view alongside the account defaults
  const books=await target.list(owner);assert.equal(books.length,1);
  const records=await target.records(owner,books[0].bookId);assert.equal(records.comments.length,1);assert.equal(records.position.mode,'parallel');
});

test('a configured target keeps its own defaults and revision while legacy backups leave them untouched',async t=>{
  const source=await library(t,'source');await seed(source);
  const view=await source.saveReadingPreferences(owner,{baseRevision:0,preferences:snapshot({font:27,onboarding:'completed'})});
  const backup=await exportLibraryInParts({api:apiFor(source,owner)}),bytes=await createLibraryArchive(backup);
  const target=await library(t,'target');
  const mine=await target.saveReadingPreferences(owner,{baseRevision:0,preferences:snapshot({font:19,theme:'mist',onboarding:'dismissed'})});
  const later=await target.saveReadingPreferences(owner,{baseRevision:mine.revision,preferences:snapshot({font:18,theme:'warm',onboarding:'dismissed'})});
  const portability=createLibraryPortability({library:target,chat:chatStub,store:staging()});
  const operation=await portability.start(owner,{bytes:bytes.length,sha256:await portableHash(bytes)});
  for(let offset=0;offset<bytes.length;offset+=PART_BYTES)await portability.part(owner,operation.id,{offset,data:Buffer.from(bytes.subarray(offset,Math.min(bytes.length,offset+PART_BYTES))).toString('base64')});
  await portability.commit(owner,operation.id);
  const kept=await target.getReadingPreferences(owner);
  assert.deepEqual(kept.preferences,later.preferences,'preserveExisting keeps an already configured target');
  assert.equal(kept.revision,later.revision,'a restore never resets the revision backward');
  assert.notEqual(kept.preferences.font,view.preferences.font);
  // legacy backups without the optional metadata stay valid and change nothing
  const legacy=structuredClone(backup);delete legacy.readingPreferences;
  validateLibraryBackup(legacy);
  const fresh=await library(t,'legacy');await fresh.restoreLibrary(owner,legacy);
  assert.deepEqual(await fresh.getReadingPreferences(owner),{revision:0,updatedAt:null,preferences:null});
  assert.equal((await fresh.list(owner)).length,1);
});

test('unknown or unbounded preference metadata rejects the package before any restore write',async t=>{
  const source=await library(t,'source');await seed(source);await source.saveReadingPreferences(owner,{baseRevision:0,preferences:snapshot()});
  const backup=await exportLibraryInParts({api:apiFor(source,owner)});
  for(const change of [m=>{m.readingPreferences.extra=1;},m=>{m.readingPreferences.preferences.font=1000;},m=>{m.readingPreferences.revision=-1;},m=>{delete m.readingPreferences.preferences.theme;},m=>{m.readingPreferences.kind='other';}]){
    const bad=structuredClone(backup);change(bad);
    await assert.rejects(createLibraryArchive(bad),/阅读习惯|备份/);
    assert.throws(()=>validateLibraryBackup(bad),/阅读习惯/);
  }
  const target=await library(t,'target');
  assert.deepEqual(await target.getReadingPreferences(owner),{revision:0,updatedAt:null,preferences:null});
});

test('gifts and selected personal exports never carry account reading defaults',async t=>{
  const source=await library(t,'source');const book=await seed(source);
  const view=await source.saveReadingPreferences(owner,{baseRevision:0,preferences:snapshot({theme:'mist',onboarding:'dismissed'})});
  const entry=await source.exportBookEntry(owner,book.bookId);
  assert.equal(Object.hasOwn(entry,'readingPreferences'),false,'per-book entries stay free of account metadata');
  const gift={kind:'marginalia-library',schemaVersion:1,books:[{book:structuredClone(entry.book),records:{...readingRecords(),bookId:entry.book.bookId,contentVersion:entry.book.contentVersion}}],readingPreferences:structuredClone({kind:'marginalia-reading-preferences',schemaVersion:1,revision:view.revision,updatedAt:view.updatedAt,preferences:view.preferences})};
  await assert.rejects(source.receiveGift(owner,gift),/阅读习惯/);
  const backup=await exportLibraryInParts({api:apiFor(source,owner)}),items=personalExportItems(backup),note=items.find(item=>item.id==='note');
  for(const format of ['json','markdown']){
    const output=selectedRecordExport([note],{format,includeQuotes:true});
    for(const hidden of ['readingPreferences','onboarding','dismissed','mist'])assert.ok(!output.includes(hidden),'selected records exclude account defaults: '+hidden);
  }
});

test('existing book settings only move the current book and never overwrite the account defaults',async t=>{
  const source=await library(t,'source');const book=await seed(source);
  const view=await source.saveReadingPreferences(owner,{baseRevision:0,preferences:snapshot({mode:'zh',variant:'interpretive',font:27})});
  const passage=book.sections[0].paragraphs[0];
  await source.saveProgress(owner,book.bookId,{...normalizeGlobalPreferences({font:20}),chapterId:book.sections[0].chapterId,passageId:passage.id,offset:4,mode:'parallel',variant:'literal'});
  const after=await source.getReadingPreferences(owner);
  assert.deepEqual(after,view,'in-book changes persist only with the book progress');
  const records=await source.records(owner,book.bookId);assert.equal(records.position.mode,'parallel');assert.equal(records.position.variant,'literal');assert.equal(records.position.font,20);
});

// ---- conflict recovery and pending-state isolation ----
test('conflict recovery reads the latest version, keeps explicit edits and waits for a manual save',async()=>{
  const root=dom(),calls=[],saved=[];
  let session={user:{id:'account-a'},readingPreferences:{revision:1,updatedAt:'2026-10-18T00:00:00.000Z',preferences:snapshot({mode:'zh',theme:'paper',pageLayout:'spread',parallelStyle:'plain'})}};
  let postResult='conflict';
  const api=async(url,body)=>{
    calls.push({url,body});
    if(body===undefined)return {revision:7,updatedAt:'2026-10-18T02:00:00.000Z',preferences:snapshot({mode:'en',theme:'night',pageLayout:'scroll',parallelStyle:'tint',font:20})};
    if(postResult==='conflict')throw Object.assign(Error('阅读习惯已在另一处更新，请刷新后重新保存'),{status:409});
    return postResult;
  };
  const ui=mountReadingPreferencesForm({root,api,getSession:()=>session,onSaved:value=>{saved.push(value);session.readingPreferences=value;}});
  const view=find(root,'habits-view'),font=find(root,'habits-font'),theme=find(root,'habits-theme'),form=find(root,'habits-status').parentElement,recover=find(root,'habits-recover');
  view.value='parallel';view.dispatchEvent(new Event('change'));font.value='25';font.dispatchEvent(new Event('input'));
  await form.dispatchEvent(new Event('submit',{cancelable:true}));await new Promise(setImmediate);
  assert.equal(calls.length,1);assert.equal(calls[0].body.baseRevision,1);
  assert.equal(recover.hidden,false,'a conflict offers the read-only recovery action');assert.match(find(root,'habits-status').textContent,/Load the latest version/i);
  await recover.dispatchEvent(new Event('click'));await new Promise(setImmediate);
  assert.equal(calls.length,2,'reading the latest version is read-only: nothing resubmits automatically');assert.equal(calls[1].body,undefined);assert.equal(calls[1].url,'/api/account/reading-preferences');
  assert.equal(view.value,'parallel');assert.equal(font.value,'25','explicit edits survive the recovery');
  assert.equal(theme.value,'night','untouched fields follow the latest server snapshot');
  assert.match(find(root,'habits-status').textContent,/save again/i);assert.equal(recover.hidden,true);
  postResult={revision:8,updatedAt:'2026-10-18T03:00:00.000Z',preferences:snapshot({mode:'parallel',font:25,theme:'night',pageLayout:'scroll',parallelStyle:'tint'})};
  await form.dispatchEvent(new Event('submit',{cancelable:true}));await new Promise(setImmediate);
  assert.equal(calls.length,3,'confirmation stays a manual action');
  assert.equal(calls[2].body.baseRevision,7,'the manual save uses the latest revision');
  validateGlobalPreferences(calls[2].body.preferences);
  assert.equal(calls[2].body.preferences.mode,'parallel');assert.equal(calls[2].body.preferences.font,25);
  assert.equal(calls[2].body.preferences.theme,'night');assert.equal(calls[2].body.preferences.pageLayout,'scroll');assert.equal(calls[2].body.preferences.parallelStyle,'tint');
  assert.equal(calls[2].body.preferences.onboarding,'completed');
  assert.equal(saved.length,1);assert.equal(session.readingPreferences.revision,8);
});

test('a failed latest-version read keeps the draft and can retry',async()=>{
  const root=dom(),calls=[];
  let session={user:{id:'account-a'},readingPreferences:{revision:1,updatedAt:'2026-10-18T00:00:00.000Z',preferences:snapshot({mode:'zh',theme:'paper'})}};
  let failGet=true;
  const api=async(url,body)=>{
    calls.push({url,body});
    if(body===undefined){if(failGet)throw Object.assign(Error('服务暂时无法连接，请稍后重试'),{status:503});return {revision:4,updatedAt:'2026-10-18T02:00:00.000Z',preferences:snapshot({mode:'en',theme:'leaf'})};}
    throw Object.assign(Error('阅读习惯已在另一处更新，请刷新后重新保存'),{status:409});
  };
  const ui=mountReadingPreferencesForm({root,api,getSession:()=>session,onSaved(){}});
  const view=find(root,'habits-view'),theme=find(root,'habits-theme'),form=find(root,'habits-status').parentElement,recover=find(root,'habits-recover');
  await form.dispatchEvent(new Event('submit',{cancelable:true}));await new Promise(setImmediate);
  assert.equal(recover.hidden,false);
  await recover.dispatchEvent(new Event('click'));await new Promise(setImmediate);
  assert.match(find(root,'habits-status').textContent,/could not load/i);
  assert.equal(view.value,'zh');assert.equal(theme.value,'paper','a failed read keeps the existing draft');
  assert.equal(recover.hidden,false,'the read-only recovery stays available to retry');
  failGet=false;
  await recover.dispatchEvent(new Event('click'));await new Promise(setImmediate);
  assert.equal(view.value,'en');assert.equal(theme.value,'leaf');
  assert.match(find(root,'habits-status').textContent,/save again/i);assert.equal(recover.hidden,true);
  assert.equal(calls.filter(call=>call.body!==undefined).length,1,'a conflict never resubmits automatically');
});

test('a late latest-version read never adopts into another account',async()=>{
  const root=dom();let session={user:{id:'account-a'},readingPreferences:null},release;
  const api=async(url,body)=>{
    if(body!==undefined)throw Object.assign(Error('阅读习惯已在另一处更新，请刷新后重新保存'),{status:409});
    await new Promise(resolve=>{release=resolve;});return {revision:9,updatedAt:'2026-10-18T03:00:00.000Z',preferences:snapshot({mode:'zh',font:27})};
  };
  const ui=mountReadingPreferencesForm({root,api,getSession:()=>session,onSaved(){}});
  const form=find(root,'habits-status').parentElement;
  await form.dispatchEvent(new Event('submit',{cancelable:true}));await new Promise(setImmediate);
  await find(root,'habits-recover').dispatchEvent(new Event('click'));
  session={user:{id:'account-b'},readingPreferences:null};ui.update();
  release();await new Promise(setImmediate);
  assert.equal(find(root,'habits-view').value,'parallel','a late read never adopts into the next account');
  assert.equal(find(root,'habits-status').textContent,'');
});

test('same-owner session refreshes adopt new versions without losing explicit edits',async()=>{
  const root=dom(),calls=[];
  let session={user:{id:'account-a'},readingPreferences:{revision:1,updatedAt:'2026-10-18T00:00:00.000Z',preferences:snapshot({mode:'zh',theme:'paper',pageLayout:'spread'})}};
  const ui=mountReadingPreferencesForm({root,api:async(url,body)=>{calls.push({url,body});return {revision:4,updatedAt:'2026-10-18T02:00:00.000Z',preferences:body.preferences};},getSession:()=>session,onSaved(){}});
  const view=find(root,'habits-view'),theme=find(root,'habits-theme'),form=find(root,'habits-status').parentElement;
  view.value='parallel';view.dispatchEvent(new Event('change'));
  session={user:{id:'account-a'},readingPreferences:{revision:3,updatedAt:'2026-10-18T01:00:00.000Z',preferences:snapshot({mode:'en',theme:'night',pageLayout:'scroll'})}};
  ui.update();
  assert.equal(view.value,'parallel','an explicit edit survives the same-owner refresh');
  assert.equal(theme.value,'night','untouched fields adopt the newer authoritative version');
  await form.dispatchEvent(new Event('submit',{cancelable:true}));await new Promise(setImmediate);
  assert.equal(calls[0].body.baseRevision,3,'the refreshed revision becomes the next save base');
  assert.equal(calls[0].body.preferences.mode,'parallel');assert.equal(calls[0].body.preferences.theme,'night');assert.equal(calls[0].body.preferences.pageLayout,'scroll');
  validateGlobalPreferences(calls[0].body.preferences);
});

test('a pending save releases the next account and never adopts old results',async()=>{
  for(const outcome of ['success','failure'])for(const target of ['new-owner','guest']){
    const root=dom(),calls=[],saved=[];let session={user:{id:'account-a'},readingPreferences:{revision:1,updatedAt:'2026-10-18T00:00:00.000Z',preferences:snapshot({font:27})}},release;
    const api=async(url,body)=>{calls.push({url,body});await new Promise(resolve=>{release=resolve;});if(outcome==='failure')throw Object.assign(Error('服务暂时无法连接，请稍后重试'),{status:503});return {revision:2,updatedAt:'2026-10-18T02:00:00.000Z',preferences:snapshot({font:27})};};
    const ui=mountReadingPreferencesForm({root,api,getSession:()=>session,onSaved:value=>saved.push(value)});
    const form=find(root,'habits-status').parentElement,save=find(root,'habits-save');
    await form.dispatchEvent(new Event('submit',{cancelable:true}));
    assert.equal(save.disabled,true,'the in-flight save disables only its own form');
    session=target==='guest'?{user:null,readingPreferences:null}:{user:{id:'account-b'},readingPreferences:null};ui.update();
    if(target==='new-owner'){assert.equal(save.disabled,false,'the next account is immediately usable');assert.equal(find(root,'habits-view').disabled,false);}
    assert.equal(find(root,'habits-view').value,'parallel','the next account starts from its own defaults');
    release();await new Promise(setImmediate);
    assert.equal(saved.length,0,outcome+' '+target+': no old result is adopted');assert.equal(calls.length,1,'no cross-owner request');
    assert.equal(find(root,'habits-status').textContent,'');
    if(target==='new-owner'){assert.equal(save.disabled,false,'old completion never re-disables the current account');assert.equal(find(root,'habits-view').disabled,false);}
    else{assert.equal(save.disabled,true,'guests stay read-only');session={user:{id:'account-c'},readingPreferences:null};ui.update();assert.equal(save.disabled,false,'signing in later is immediately usable');}
  }
});

test('oversized timestamps are rejected before parsing and before any restore writes',async t=>{
  const meta={kind:'marginalia-reading-preferences',schemaVersion:1,revision:1,updatedAt:'2026-10-18T00:00:00.000Z',preferences:snapshot()};
  assert.deepEqual(validateGlobalPreferencesMetadata(meta),meta);
  assert.equal(validateGlobalPreferencesMetadata({...meta,updatedAt:'2026-10-18T12:00:00+08:00'}).updatedAt,'2026-10-18T12:00:00+08:00','normal ISO/time strings stay valid');
  const original=Date.parse;let parsedOversized=0;
  Date.parse=value=>{if(typeof value==='string'&&value.length>64)parsedOversized++;return original(value);};
  try{
    // The parseable oversized value is the real acceptance bug: Date.parse alone would accept it.
    const parseable='2026-10-18T00:00:00.'+'0'.repeat(2000)+'Z';
    assert.ok(parseable.length>64&&Number.isFinite(original(parseable)),'fixture: oversized yet parseable');
    for(const updatedAt of ['x'.repeat(65),parseable,'A'.repeat(1100000)])assert.throws(()=>validateGlobalPreferencesMetadata({...meta,updatedAt}),/阅读习惯/,'oversized rejected at '+updatedAt.length);
  }finally{Date.parse=original;}
  assert.equal(parsedOversized,0,'the length bound must reject before any Date.parse');
  const source=await library(t,'oversize');await seed(source);await source.saveReadingPreferences(owner,{baseRevision:0,preferences:snapshot()});
  const backup=await exportLibraryInParts({api:apiFor(source,owner)}),oversize=structuredClone(backup);oversize.readingPreferences.updatedAt='2026-10-18T00:00:00.'+'0'.repeat(2000)+'Z';
  assert.throws(()=>validateLibraryBackup(oversize),/阅读习惯/);
  const target=await library(t,'oversize-target');
  await assert.rejects(target.restoreLibrary(owner,oversize),/阅读习惯/);
  assert.deepEqual(await target.getReadingPreferences(owner),{revision:0,updatedAt:null,preferences:null},'rejected before any restore write');
  assert.equal((await target.list(owner)).length,0);
  // ZIP import: an oversized manifest timestamp never reaches a restore
  const bytes=await createLibraryArchive(backup),files=unzipSync(bytes),manifest=JSON.parse(strFromU8(files['manifest.json']));
  manifest.readingPreferences.updatedAt='2026-10-18T00:00:00.'+'0'.repeat(2000)+'Z';files['manifest.json']=strToU8(JSON.stringify(manifest));
  const poisoned=zipSync(files);
  await assert.rejects(readLibraryArchive(poisoned),/阅读习惯/);
  const restoreTarget=await library(t,'oversize-zip'),portability=createLibraryPortability({library:restoreTarget,chat:chatStub,store:staging()});
  const operation=await portability.start(owner,{bytes:poisoned.length,sha256:await portableHash(poisoned)});
  for(let offset=0;offset<poisoned.length;offset+=PART_BYTES)await portability.part(owner,operation.id,{offset,data:Buffer.from(poisoned.subarray(offset,Math.min(poisoned.length,offset+PART_BYTES))).toString('base64')});
  await assert.rejects(portability.commit(owner,operation.id),/阅读习惯/);
  assert.deepEqual(await restoreTarget.getReadingPreferences(owner),{revision:0,updatedAt:null,preferences:null});
  assert.equal((await restoreTarget.list(owner)).length,0,'nothing is written before the package passes validation');
  // untouched archives with normal timestamps still restore
  const clean=await library(t,'oversize-clean');await clean.restoreLibrary(owner,backup);
  assert.equal((await clean.getReadingPreferences(owner)).preferences.onboarding,snapshot().onboarding);
});

// ---- authoritative in-place updates and pending-operation ownership ----
test('same-owner authoritative updates arrive through the portal in-place session mutation',async()=>{
  const root=dom(),calls=[];
  const session={user:{id:'account-a'},readingPreferences:{revision:1,updatedAt:'2026-10-18T00:00:00.000Z',preferences:snapshot({font:20,theme:'paper',pageLayout:'spread'})}};
  const ui=mountReadingPreferencesForm({root,api:async(url,body)=>{calls.push({url,body});return {revision:body.baseRevision+1,updatedAt:'2026-10-18T04:00:00.000Z',preferences:body.preferences};},getSession:()=>session,onSaved(){}});
  const view=find(root,'habits-view'),font=find(root,'habits-font'),theme=find(root,'habits-theme'),form=find(root,'habits-status').parentElement;
  assert.equal(font.value,'20');
  // Pristine: the portal mutates the SAME session object in place (invite/onSaved path).
  session.readingPreferences={revision:2,updatedAt:'2026-10-18T01:00:00.000Z',preferences:snapshot({font:27,theme:'night',pageLayout:'scroll'})};
  ui.update();
  assert.equal(font.value,'27','the newer authoritative snapshot is adopted without a session identity change');assert.equal(theme.value,'night');
  assert.equal(calls.length,0,'adoption is read-only: no auto-save and no retry');
  await form.dispatchEvent(new Event('submit',{cancelable:true}));await new Promise(setImmediate);
  assert.equal(calls[0].body.baseRevision,2,'the manual save uses the adopted revision');assert.equal(calls[0].body.preferences.font,27);assert.equal(calls[0].body.preferences.pageLayout,'scroll');
  // Dirty: explicit edits survive the same in-place update; untouched fields follow.
  view.value='zh';view.dispatchEvent(new Event('change'));
  session.readingPreferences={revision:4,updatedAt:'2026-10-18T02:00:00.000Z',preferences:snapshot({mode:'en',font:28,theme:'leaf',parallelStyle:'tint'})};
  ui.update();
  assert.equal(view.value,'zh','an explicit edit survives the in-place update');assert.equal(font.value,'28');assert.equal(theme.value,'leaf');
  await form.dispatchEvent(new Event('submit',{cancelable:true}));await new Promise(setImmediate);
  assert.equal(calls[1].body.baseRevision,4);assert.equal(calls[1].body.preferences.mode,'zh');assert.equal(calls[1].body.preferences.font,28);assert.equal(calls[1].body.preferences.parallelStyle,'tint');
  validateGlobalPreferences(calls[1].body.preferences);
  // A stale in-place view never regresses an adopted newer result.
  session.readingPreferences={revision:2,updatedAt:'2026-10-18T01:00:00.000Z',preferences:snapshot({font:20})};
  ui.update();
  assert.equal(font.value,'28');assert.equal(theme.value,'leaf');assert.equal(calls.length,2);
});

test("a refresh during this owner's request reconciles safely after it",async()=>{
  const root=dom(),calls=[];
  const session={user:{id:'account-a'},readingPreferences:{revision:1,updatedAt:'2026-10-18T00:00:00.000Z',preferences:snapshot({font:20,theme:'paper'})}};
  let release,responder=async body=>{await new Promise(resolve=>{release=resolve;});return {revision:2,updatedAt:'2026-10-18T02:00:00.000Z',preferences:body.preferences};};
  const ui=mountReadingPreferencesForm({root,api:async(url,body)=>{calls.push({url,body});return responder(body);},getSession:()=>session,onSaved(){}});
  const view=find(root,'habits-view'),font=find(root,'habits-font'),theme=find(root,'habits-theme'),form=find(root,'habits-status').parentElement;
  font.value='25';font.dispatchEvent(new Event('input'));
  await form.dispatchEvent(new Event('submit',{cancelable:true})); // base1 pending
  session.readingPreferences={revision:1,updatedAt:'2026-10-18T01:00:00.000Z',preferences:snapshot({font:20,theme:'paper',parallelStyle:'quote'})};ui.update();
  assert.equal(font.value,'25','a mid-flight refresh is deferred over the in-flight request');
  release();await new Promise(setImmediate);
  assert.equal(font.value,'25','a stale refresh never overwrites the newer saved result');assert.equal(calls[0].body.baseRevision,1);
  assert.match(find(root,'habits-status').textContent,/saved/i);
  // a newer refresh during a conflicting request reconciles after it, keeping edits
  view.value='zh';view.dispatchEvent(new Event('change'));
  responder=async()=>{await new Promise(resolve=>{release=resolve;});throw Object.assign(Error('阅读习惯已在另一处更新，请刷新后重新保存'),{status:409});};
  await form.dispatchEvent(new Event('submit',{cancelable:true})); // base2 pending, conflicts
  session.readingPreferences={revision:3,updatedAt:'2026-10-18T03:00:00.000Z',preferences:snapshot({mode:'en',font:28,theme:'leaf'})};ui.update();
  release();await new Promise(setImmediate);
  assert.equal(view.value,'zh','the explicit edit survives the post-request reconciliation');assert.equal(font.value,'28');assert.equal(theme.value,'leaf');
  assert.equal(find(root,'habits-recover').hidden,false);
  assert.equal(calls.length,2,'reconciliation never triggers a write');
  responder=async body=>({revision:4,updatedAt:'2026-10-18T04:00:00.000Z',preferences:body.preferences});
  await form.dispatchEvent(new Event('submit',{cancelable:true}));await new Promise(setImmediate);
  assert.equal(calls[2].body.baseRevision,3,'the reconciled revision is the next manual save base');assert.equal(calls[2].body.preferences.mode,'zh');assert.equal(calls[2].body.preferences.font,28);
});

test('a superseded completion never releases the current account pending save',async()=>{
  for(const outcome of ['success','failure']){
    const root=dom(),calls=[],saved=[],pending=[];
    let session={user:{id:'account-a'},readingPreferences:null};
    const api=async(url,body)=>{const index=calls.length;calls.push({url,body});await new Promise(resolve=>pending.push(resolve));if(outcome==='failure'&&index===0)throw Object.assign(Error('服务暂时无法连接，请稍后重试'),{status:503});return {revision:index+2,updatedAt:'2026-10-18T05:00:00.000Z',preferences:body.preferences};};
    const ui=mountReadingPreferencesForm({root,api,getSession:()=>session,onSaved:value=>saved.push(value)});
    const form=find(root,'habits-status').parentElement,save=find(root,'habits-save');
    await form.dispatchEvent(new Event('submit',{cancelable:true})); // account A save pending
    assert.equal(save.disabled,true);assert.equal(form.getAttribute('aria-busy'),'true');
    session={user:{id:'account-b'},readingPreferences:null};ui.update(); // releases A; B starts clean
    assert.equal(save.disabled,false);assert.equal(form.getAttribute('aria-busy'),'false');
    await form.dispatchEvent(new Event('submit',{cancelable:true})); // account B save pending
    assert.equal(save.disabled,true);assert.equal(form.getAttribute('aria-busy'),'true');
    await form.dispatchEvent(new Event('submit',{cancelable:true})); // duplicate attempt while B pending
    assert.equal(calls.length,2,'a duplicate submit while B is pending creates no third POST');
    pending[0]();await new Promise(setImmediate); // A completes late (success or failure)
    assert.equal(save.disabled,true,'a superseded completion never releases the current pending save');
    assert.equal(form.getAttribute('aria-busy'),'true');
    assert.equal(calls.length,2);assert.equal(saved.length,0);
    assert.equal(find(root,'habits-status').textContent,'');
    pending[1]();await new Promise(setImmediate); // B completes
    assert.equal(save.disabled,false);assert.equal(form.getAttribute('aria-busy'),'false');
    assert.equal(saved.length,1,'B adopts exactly once');assert.equal(calls.length,2);
    assert.match(find(root,'habits-status').textContent,/saved/i);
  }
});

test('a superseded skip completion never releases the next account pending dismissal',async()=>{
  for(const outcome of ['success','failure']){
    const root=dom();root.append(new Element('button','reading-setup-open'),new Element('button','reading-setup-skip'),new Element('p','reading-setup-status'));
    const calls=[],saved=[],pending=[];
    let session={user:{id:'account-a'},readingPreferences:null};
    const api=async(url,body)=>{const index=calls.length;calls.push({url,body});await new Promise(resolve=>pending.push(resolve));if(outcome==='failure'&&index===0)throw Object.assign(Error('服务暂时无法连接，请稍后重试'),{status:503});return {revision:index+2,updatedAt:'2026-10-18T05:00:00.000Z',preferences:body.preferences};};
    const ui=mountReadingSetupInvite({root,api,getSession:()=>session,onSaved:value=>{saved.push(value);session.readingPreferences=value;},openSettings(){}});
    const skip=find(root,'reading-setup-skip');
    await skip.dispatchEvent(new Event('click')); // account A dismissal pending
    assert.equal(skip.disabled,true);
    session={user:{id:'account-b'},readingPreferences:null};ui.update();
    assert.equal(skip.disabled,false);
    await skip.dispatchEvent(new Event('click')); // account B dismissal pending
    assert.equal(skip.disabled,true);
    await skip.dispatchEvent(new Event('click'));
    assert.equal(calls.length,2,'a duplicate skip while B is pending creates no third POST');
    pending[0]();await new Promise(setImmediate); // A completes late
    assert.equal(skip.disabled,true,'a superseded completion never releases the next pending dismissal');
    assert.equal(find(root,'reading-setup-status').textContent,'');
    assert.equal(saved.length,0);assert.equal(calls.length,2);
    pending[1]();await new Promise(setImmediate); // B completes
    assert.equal(saved.length,1,'the dismissal is adopted exactly once');
    assert.equal(root.hidden,true);assert.match(find(root,'reading-setup-status').textContent,/Set up later/i);
  }
});


test('locale refresh keeps the reading-preferences request, dirty fields and native option nodes intact',async()=>{
  const {requestUiRoute,t}=await import('../app/ui-locale.mjs');await requestUiRoute('en');
  const root=dom(),session={user:{id:'locale-owner'},readingPreferences:{revision:2,preferences:snapshot({theme:'paper'})}};
  let finish,calls=0,saved=0;const ui=mountReadingPreferencesForm({root,getSession:()=>session,api:()=>{calls++;return new Promise(resolve=>{finish=resolve;});},onSaved:()=>saved++});
  const view=find(root,'habits-view'),font=find(root,'habits-font'),save=find(root,'habits-save'),form=find(root,'habits-status').parentElement;
  view.value='zh';view.dispatchEvent(new Event('change'));font.value='27';font.dispatchEvent(new Event('input'));const options=[...view.children];
  form.dispatchEvent(new Event('submit',{cancelable:true}));
  try{
    await requestUiRoute('ja');assert.equal(calls,1);assert.equal(save.textContent,t('prefs.saving'));assert.equal(save.disabled,true);
    assert.equal(view.value,'zh');assert.equal(font.value,'27');assert.deepEqual(view.children,options);assert.equal(options[0].textContent,t('prefs.mode.original'));
    assert.equal(form.children.find(x=>x.className==='settings-description').textContent,t('prefs.help'));
    ui.dispose();const label=save.textContent;await requestUiRoute('zh-Hant');assert.equal(save.textContent,label);
    finish({revision:3,preferences:snapshot({font:20})});await new Promise(setImmediate);assert.equal(saved,0);assert.equal(font.value,'27');
    form.dispatchEvent(new Event('submit',{cancelable:true}));assert.equal(calls,1);
  }finally{ui.dispose();await requestUiRoute('en');}
});

test('a second preferences mount cannot refresh a disposed first mount',async()=>{
  const {requestUiRoute,t}=await import('../app/ui-locale.mjs');await requestUiRoute('en');
  const a=dom(),b=dom(),session={user:{id:'same-owner'}};
  const first=mountReadingPreferencesForm({root:a,getSession:()=>session,api:async()=>{}}),second=mountReadingPreferencesForm({root:b,getSession:()=>session,api:async()=>{}});
  first.dispose();const before=find(a,'habits-save').textContent;
  try{await requestUiRoute('ja');second.updateLabels();assert.equal(find(a,'habits-save').textContent,before);assert.equal(find(b,'habits-save').textContent,t('prefs.save'));}
  finally{second.dispose();await requestUiRoute('en');}
});

test('reformatting an invitation failure never replays its business error and owner changes discard the cached status',async()=>{
  const {requestUiRoute,t}=await import('../app/ui-locale.mjs');await requestUiRoute('en');
  const root=dom(),open=new Element('button','reading-setup-open'),skip=new Element('button','reading-setup-skip'),status=new Element('p','reading-setup-status');root.append(open,skip,status);
  let session={user:{id:'invite-a'}},calls=0;const errors=[];
  const ui=mountReadingSetupInvite({root,getSession:()=>session,api:async()=>{calls++;throw Error('unknown server prose');},onError:text=>errors.push(text)});
  try{
    skip.dispatchEvent(new Event('click'));await new Promise(setImmediate);assert.equal(errors.length,1);assert.equal(calls,1);
    await requestUiRoute('ja');assert.equal(status.textContent,t('prefs.skipFailed'));assert.equal(errors.length,1);assert.equal(skip.textContent,t('prefs.setup.skip'));
    session={user:{id:'invite-b'}};ui.update();assert.equal(status.textContent,'');
    await requestUiRoute('zh-Hant');assert.equal(status.textContent,'');assert.equal(errors.length,1);
    ui.dispose();const before=skip.textContent;await requestUiRoute('en');assert.equal(skip.textContent,before);
    skip.dispatchEvent(new Event('click'));assert.equal(calls,1);
  }finally{ui.dispose();await requestUiRoute('en');}
});

test('the complete reading invitation relabels existing heading, description and accessible name without replaying pending dismissal',async()=>{
 const {requestUiRoute,t}=await import('../app/ui-locale.mjs');await requestUiRoute('en');const root=dom(),heading=new Element('h2'),description=new Element('p'),open=new Element('button','reading-setup-open'),skip=new Element('button','reading-setup-skip'),status=new Element('p','reading-setup-status');heading.textContent='Set up reading habits';description.textContent='Initial English invitation';root.append(heading,description,open,skip,status);
 let reads=0,calls=0,resolve;const session={user:{id:'invite-owner'}},ui=mountReadingSetupInvite({root,getSession(){reads++;return session;},api:()=>{calls++;return new Promise(done=>{resolve=done;});}});skip.dispatchEvent(new Event('click'));const children=[...root.children],before=reads;
 try{for(const code of ['ja','zh-Hant','zh-Hans','en']){await requestUiRoute(code);assert.equal(root.getAttribute('aria-label'),t('shell.settings.tab.reading-habits'));assert.equal(heading.textContent,t('prefs.setup.open'));assert.equal(description.textContent,t('prefs.setup.description'));assert.notEqual(description.textContent,'prefs.setup.description');assert.equal(open.textContent,t('prefs.setup.open'));assert.equal(skip.textContent,t('prefs.setup.skip'));assert.deepEqual(root.children,children);assert.equal(open.disabled,true);assert.equal(skip.disabled,true);assert.equal(root.hidden,false);assert.equal(reads,before);assert.equal(calls,1);}
  ui.dispose();const text=description.textContent;await requestUiRoute('ja');assert.equal(description.textContent,text);resolve({revision:1,preferences:snapshot({onboarding:'dismissed'})});await new Promise(setImmediate);assert.equal(calls,1);
 }finally{ui.dispose();await requestUiRoute('en');}
});
