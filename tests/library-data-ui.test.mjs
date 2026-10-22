import test from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {mountLibraryData} from '../app/library-data.mjs';
import {requestUiRoute,t as uiText} from '../app/ui-locale.mjs';
import {createLibraryArchive,portableHash,MAX_ARCHIVE_BYTES} from '../app/library-portability.mjs';
import {strToU8} from 'fflate';
import {readingBook,readingRecords,focusSession} from './reading-fixtures.mjs';
test.beforeEach(()=>requestUiRoute('zh-Hans'));
test.afterEach(()=>requestUiRoute('en'));

class Element extends EventTarget{
 constructor(tag,doc){super();this.tagName=tag;this.doc=doc;this.children=[];this.attrs={};this.dataset={};this.value='';this.disabled=false;this.hidden=false;this.isConnected=true;this.classList={add(){},toggle(){}};}
 append(...nodes){for(const n of nodes){n.parentElement=this;this.children.push(n);if(this.tagName==='select'&&this.children.length===1)this.value=n.value;}}
 replaceChildren(...nodes){this.children=[];this.append(...nodes);}
 setAttribute(k,v){this.attrs[k]=String(v);}getAttribute(k){return this.attrs[k];}hasAttribute(k){return k in this.attrs;}removeAttribute(k){delete this.attrs[k];}focus(){this.doc.activeElement=this;}click(){if(!this.disabled)this.dispatchEvent(new Event('click'));}
 get options(){return this.children;}
}
const all=root=>[root,...root.children.flatMap(all)];
// Export awaits WebCrypto; event-loop turns do not imply its worker finished.
const waitFor=async(predicate,description)=>{const deadline=Date.now()+5000;while(!predicate()){assert.ok(Date.now()<deadline,'Timed out waiting for '+description);await delay(5);}};
const idle=s=>waitFor(()=>s.root.getAttribute('aria-busy')==='false','the data-panel operation to finish');
function fixture(t,handler){const before=globalThis.document,doc={};doc.createElement=tag=>new Element(tag,doc);doc.createTextNode=text=>Object.assign(new Element('#text',doc),{textContent:text});doc.body=doc.createElement('body');doc.activeElement=doc.body;globalThis.document=doc;t.after(()=>{globalThis.document=before;});const root=doc.createElement('section');doc.body.append(root);let owner='alice';const calls=[],blobs=[],originalUrl=URL.createObjectURL,originalRevoke=URL.revokeObjectURL;URL.createObjectURL=blob=>{blobs.push(blob);return 'blob:synthetic';};URL.revokeObjectURL=()=>{};t.after(()=>{URL.createObjectURL=originalUrl;URL.revokeObjectURL=originalRevoke;});
 const records=readingRecords();records.comments.push({id:'note',passageId:'p1',contentVersion:readingBook.contentVersion,text:'Selected comment',origin:'user',createdAt:'2026-10-14T12:00:00Z'});records.questions.push({id:'private',passageId:'p2',contentVersion:readingBook.contentVersion,text:'PRIVATE HIDDEN QUESTION',origin:'user',createdAt:'2026-10-14T12:00:00Z'});const entry={book:structuredClone(readingBook),records},backup={kind:'marginalia-library',schemaVersion:1,books:[entry],includesOriginalFiles:false};
 const api=async(url,body)=>{calls.push({url,body});if(handler)return handler(url,body);if(url.endsWith('/manifest'))return {kind:'marginalia-export-manifest',schemaVersion:1,exportedAt:'2026-10-17T00:00:00Z',books:[{bookId:readingBook.bookId,contentVersion:readingBook.contentVersion}]};const bytes=new TextEncoder().encode(JSON.stringify(entry));return {kind:'marginalia-book-export-part',schemaVersion:1,bookId:readingBook.bookId,contentVersion:readingBook.contentVersion,offset:0,totalBytes:bytes.length,nextOffset:null,snapshot:await portableHash(bytes),data:Buffer.from(bytes).toString('base64')};};
 const panel=mountLibraryData({root,api,getSession:()=>owner?{user:{id:owner}}:{user:null},getOwner:()=>owner});t.after(()=>panel.dispose());return {panel,root,doc,calls,blobs,backup,button:text=>all(root).find(n=>n.tagName==='button'&&n.textContent===text),label:name=>all(root).find(n=>n.attrs['aria-label']===name),status:()=>all(root).find(n=>n.attrs.role==='status').textContent,checks:()=>all(root).filter(n=>n.dataset.recordKey),setOwner:(value,{update=true}={})=>{owner=value;if(update)panel.update();},confirmAction:()=>all(root).find(n=>n.id==='data-confirm-action'),zoneState:()=>all(root).find(n=>String(n.className).includes('settings-dropzone-state'))};
}
test('native-like selection downloads exactly the preview; changes and owner switches invalidate private output',async t=>{
 const s=fixture(t);s.button('读取可选记录').click();await idle(s);assert.equal(s.checks().length,2);assert.ok(s.checks().every(i=>!i.checked));const mode=s.label('导出范围');mode.value='share';mode.dispatchEvent(new Event('change'));const first=s.checks()[0];first.checked=true;first.dispatchEvent(new Event('change'));s.button('预览所选内容').click();const preview=s.label('将要下载的完整内容预览').value;assert.ok(!preview.includes('PRIVATE HIDDEN QUESTION'));assert.ok(!preview.includes('Read this first.'));s.button('下载预览内容').click();assert.equal(await s.blobs[0].text(),preview);
 s.label('导出格式').value='markdown';s.label('导出格式').dispatchEvent(new Event('change'));assert.equal(s.button('下载预览内容').disabled,true);assert.equal(s.label('将要下载的完整内容预览').value,'');s.button('预览所选内容').click();const consents=all(s.root).filter(n=>n.type==='checkbox'&&!n.dataset.recordKey);consents.forEach(n=>n.checked=true);s.setOwner('bob');assert.equal(s.label('将要下载的完整内容预览').value,'');assert.equal(s.checks().length,0);assert.equal(s.button('下载预览内容').disabled,true);assert.ok(consents.every(n=>!n.checked));assert.equal(s.label('导出范围').value,'personal');
});
test('cancelling while start acknowledgement is pending still clears the newly allocated owner slot',async t=>{
 let resolveStart,started=false;const s=fixture(t,async(url)=>{if(url.endsWith('/start')){started=true;return new Promise(r=>{resolveStart=r;});}if(url.endsWith('/cancel'))return {cancelled:true};throw Error('Unexpected '+url);});const bytes=await createLibraryArchive(s.backup),file=all(s.root).find(n=>n.tagName==='input'&&n.type==='file');file.files=[{name:'backup.zip',size:bytes.length,arrayBuffer:async()=>bytes.buffer}];file.dispatchEvent(new Event('change'));await waitFor(()=>s.zoneState().dataset.state==='valid','the staged archive to validate');
 s.button('校验并恢复').click();all(s.root).find(n=>n.id==='data-confirm-action').click();
 await waitFor(()=>started,'the restore start request');assert.equal(started,true);
 s.button('取消当前操作').click();all(s.root).find(n=>n.id==='data-confirm-action').click();
 resolveStart({id:'synthetic-operation'});await idle(s);assert.ok(s.calls.some(c=>c.url.endsWith('/synthetic-operation/cancel')));assert.ok(!s.calls.some(c=>c.url.endsWith('/commit')));assert.match(s.status(),/已取消恢复并清除/);
});

test('choosing or dropping a backup only stages it and the restore waits for one explicit confirmation',async t=>{
 let starts=0;const s=fixture(t,async(url)=>{if(url.endsWith('/start')){starts++;return {id:'synthetic-operation'};}if(url.includes('/part'))return {};if(url.endsWith('/commit'))return {restored:1,originals:0};throw Error('Unexpected '+url);});
 const bytes=await createLibraryArchive(s.backup),file=all(s.root).find(n=>n.tagName==='input'&&n.type==='file'),zone=all(s.root).find(n=>String(n.className).includes('settings-dropzone'));
 file.files=[{name:'backup.zip',size:bytes.length,arrayBuffer:async()=>bytes.buffer}];file.dispatchEvent(new Event('change'));
 assert.equal(starts,0,'selecting a file never starts a restore');assert.ok(['selected','checking','valid','invalid'].includes(zone.dataset.state));assert.match(all(s.root).find(n=>String(n.className).includes('settings-dropzone-state')).textContent,/backup\.zip/);
 const drop=new Event('drop');drop.dataTransfer={files:[{name:'dropped.zip',size:bytes.length,arrayBuffer:async()=>bytes.buffer}]};zone.dispatchEvent(drop);
 assert.equal(starts,0,'dropping a file never starts a restore either');assert.match(all(s.root).find(n=>String(n.className).includes('settings-dropzone-state')).textContent,/dropped\.zip/);await waitFor(()=>s.zoneState().dataset.state==='valid','the dropped archive to validate locally');
 s.button('校验并恢复').click();
 const dialog=all(s.root).find(n=>String(n.tagName).toLowerCase()==='dialog');assert.equal(dialog.getAttribute('open'),'true','the consequence is stated before anything is written');
 assert.match(all(s.root).find(n=>String(n.className).includes('settings-confirm-consequence')).textContent,/合并/);
 assert.equal(starts,0);
 all(s.root).find(n=>n.id==='data-confirm-action').click();
 await waitFor(()=>starts===1,'the confirmed restore');await idle(s);assert.equal(starts,1);
});

test('guest controls stay read-only and explain how to unlock them',async t=>{
 const s=fixture(t);s.setOwner(null);
 assert.equal(s.button('校验并恢复').disabled,true);assert.equal(s.button('读取可选记录').disabled,true);
 const hint=all(s.root).find(n=>n.id==='data-guest');assert.equal(hint.hidden,false);assert.match(hint.textContent,/登录/);
 s.setOwner('alice');assert.equal(hint.hidden,true);assert.equal(s.button('校验并恢复').disabled,true,'sign-in still requires a checked file');
});

test('actual data owner relabels in place and generates new Markdown only on explicit preview',async t=>{
 const s=fixture(t);s.button('读取可选记录').click();await idle(s);
 const first=s.checks()[0];first.checked=true;first.dispatchEvent(new Event('change'));
 const format=s.label('导出格式'),output=s.label('将要下载的完整内容预览'),preview=s.button('预览所选内容'),save=s.button('下载预览内容');
 format.value='markdown';format.dispatchEvent(new Event('change'));preview.click();const original=output.value;
 assert.match(original,/^# 个人记录/);assert.ok(original.includes('Selected comment'));
 output.focus();output.selectionStart=5;output.selectionEnd=13;
 const rowNodes=[...all(s.root)],requests=s.calls.length,book=s.label('选择记录所属书籍'),title=book.options[0].textContent;
 for(const select of [format,book])select.replaceChildren=()=>assert.fail('locale cannot rebuild options');
 for(const locale of ['ja','zh-Hant','en']){
  await requestUiRoute(locale);assert.equal(s.root.getAttribute('lang'),locale);assert.equal(s.calls.length,requests);assert.equal(s.checks()[0],first);assert.equal(first.checked,true);assert.equal(format.value,'markdown');assert.equal(book.options[0].textContent,title);assert.equal(output.value,original);assert.equal(s.doc.activeElement,output);assert.equal(output.selectionStart,5);assert.equal(output.selectionEnd,13);assert.deepEqual(all(s.root),rowNodes);
 }
 save.click();assert.equal(await s.blobs[0].text(),original);
 preview.click();assert.match(output.value,/^# Personal records/);assert.ok(output.value.includes('Selected comment'));assert.equal(s.calls.length,requests);
 const english=output.value;s.panel.dispose();await requestUiRoute('ja');assert.equal(output.value,english);preview.click();save.click();assert.equal(s.blobs.length,1);
});

test('pending data exports cannot resume after owner ABA or disposal',async t=>{
 let resolve;const pending=new Promise(done=>{resolve=done;});const s=fixture(t,()=>pending);const load=s.button('读取可选记录');load.click();await waitFor(()=>s.calls.length===1,'the manifest request');
 s.setOwner('bob');s.setOwner('alice');s.panel.dispose();resolve({kind:'marginalia-export-manifest',schemaVersion:1,exportedAt:'2026-10-17T00:00:00Z',books:[]});await delay(10);assert.equal(s.calls.length,1);assert.equal(s.checks().length,0);assert.equal(s.blobs.length,0);load.click();await delay(5);assert.equal(s.calls.length,1);
});

test('real focus-record rows relabel in four languages while preserving the exported source enum',async t=>{
 const s=fixture(t);s.backup.books[0].records.readingSessions.push(focusSession());s.button('读取可选记录').click();await idle(s);
 const check=s.checks().find(node=>JSON.parse(node.dataset.recordKey)[1]==='time');assert.ok(check);const description=check.parentElement.children[2],calls=s.calls.length;
 for(const locale of ['en','zh-Hans','zh-Hant','ja']){
  await requestUiRoute(locale);assert.equal(description.textContent,uiText('reading.time.source.reader_focus')+' · '+uiText('data.seconds',{seconds:360}));assert.equal(s.calls.length,calls);
 }
 check.checked=true;check.dispatchEvent(new Event('change'));s.button(uiText('data.preview')).click();const output=JSON.parse(s.label(uiText('data.output')).value);assert.equal(output.items[0].source,'reader_focus');assert.equal(output.items[0].durationSeconds,360);
});

// ---- component review 02 repairs ----
const namedFile=(name,bytes)=>({name,size:bytes.length,arrayBuffer:async()=>bytes.buffer});
async function stageArchive(s,chosen){const file=all(s.root).find(n=>n.type==='file');file.files=[chosen];file.dispatchEvent(new Event('change'));await waitFor(()=>s.zoneState().dataset.state==='valid','the staged archive to validate');}
test('the advanced disclosure carries its class and never shows internal identifiers',async t=>{
 const s=fixture(t);
 const advanced=all(s.root).find(n=>String(n.className).split(' ').includes('settings-advanced'));
 assert.ok(advanced,'the details element keeps its settings-advanced class');
 assert.ok(!String(advanced.textContent).includes('settings-advanced'),'internal class names are not visible copy');
 assert.ok(String(advanced.textContent).length>0,'real advanced copy is present');
});

test('guest read-only covers the file field, switches and export selects consistently',async t=>{
 const s=fixture(t);s.setOwner(null);
 const file=all(s.root).find(n=>n.tagName==='input'&&n.type==='file');
 const checks=all(s.root).filter(n=>n.type==='checkbox');
 const selects=all(s.root).filter(n=>n.tagName==='select');
 assert.equal(checks.length>=2,true);
 assert.equal(file.disabled,true);assert.ok(checks.every(node=>node.disabled===true),'switches match the read-only explanation');
 assert.ok(selects.every(node=>node.disabled===true),'export selects match too');
 s.setOwner('alice');
 assert.equal(file.disabled,false);assert.ok(checks.every(node=>node.disabled===false));assert.ok(selects.every(node=>node.disabled===false));
});

test('the dropzone reflects real local archive validation and stale results never paint a later selection',async t=>{
 let releaseValidation;const s=fixture(t,async url=>{if(url.endsWith('/start'))return {id:'op'};throw Error('unexpected '+url);});
 const good=await createLibraryArchive(s.backup),bad=strToU8('not a zip at all');
 const file=all(s.root).find(n=>n.tagName==='input'&&n.type==='file');
 const slow={name:'slow.zip',size:10,arrayBuffer:()=>new Promise(resolve=>{releaseValidation=()=>resolve(bad.buffer);})};
 file.files=[slow];file.dispatchEvent(new Event('change'));
 assert.equal(s.zoneState().dataset.state,'checking','validation starts locally on selection');
 const later=namedFile('later.zip',good);
 file.files=[later];file.dispatchEvent(new Event('change'));
 releaseValidation();await waitFor(()=>s.zoneState().dataset.state==='valid','the newest selection to win');
 assert.match(s.zoneState().textContent,/later\.zip/);
 assert.equal(s.calls.length,0,'selection and validation never touch the API');
 file.files=[namedFile('broken.zip',bad)];file.dispatchEvent(new Event('change'));
 await waitFor(()=>s.zoneState().dataset.state==='invalid','a broken archive to be reported');
 assert.match(s.zoneState().textContent,/broken\.zip/);
 assert.equal(s.calls.length,0,'still zero API calls before the explicit confirmation');
});

test('the restore confirmation is bound to its opening owner, generation and exact file',async t=>{
 let starts=0;const s=fixture(t,async url=>{if(url.endsWith('/start')){starts++;return {id:'op'};}if(url.includes('/part'))return {};if(url.endsWith('/commit'))return {restored:1,originals:0};throw Error('unexpected '+url);});
 const bytes=await createLibraryArchive(s.backup),file=all(s.root).find(n=>n.tagName==='input'&&n.type==='file');
 await stageArchive(s,namedFile('A.zip',bytes));s.button('校验并恢复').click();
 s.setOwner('bob',{update:false}); // owner changed while the confirmation waits
 s.confirmAction().click();await idle(s);
 assert.equal(starts,0,'a confirmation opened for A never restores as B');
 assert.equal(all(s.root).find(n=>String(n.tagName).toLowerCase()==='dialog').hasAttribute('open'),false,'the stale confirmation is withdrawn');
 s.setOwner('alice');await stageArchive(s,namedFile('C.zip',bytes));s.button('校验并恢复').click();
 file.files=[namedFile('second.zip',bytes)]; // file swapped while the confirmation waits
 s.confirmAction().click();await idle(s);
 assert.equal(starts,0,'the old confirmation never reads the replacement file');
 await stageArchive(s,namedFile('final.zip',bytes));s.button('校验并恢复').click();s.confirmAction().click();
 await waitFor(()=>starts===1,'the confirmation that matches its opening state');await idle(s);
 assert.equal(starts,1);
});

test('the cancel confirmation is bound to its opening operation and owner',async t=>{
 let resolveStart,started=false;const s=fixture(t,async url=>{if(url.endsWith('/start')){started=true;return new Promise(r=>{resolveStart=r;});}if(url.endsWith('/cancel'))return {cancelled:true};throw Error('unexpected '+url);});
 const bytes=await createLibraryArchive(s.backup),file=all(s.root).find(n=>n.tagName==='input'&&n.type==='file');
 await stageArchive(s,namedFile('backup.zip',bytes));s.button('校验并恢复').click();s.confirmAction().click();
 await waitFor(()=>started,'the restore start request');
 s.button('取消当前操作').click();
 s.setOwner('bob',{update:false});
 s.confirmAction().click();resolveStart({id:'synthetic-operation'});await idle(s);
 assert.ok(!s.calls.some(call=>call.url.endsWith('/cancel')),'a stale cancel confirmation is refused');
});


test('an oversized staged archive is rejected before reading any bytes',async t=>{
 const s=fixture(t);let reads=0;const file=all(s.root).find(n=>n.type==='file');file.files=[{name:'too-large.zip',size:MAX_ARCHIVE_BYTES+1,arrayBuffer:async()=>{reads++;return new ArrayBuffer(3);}}];file.dispatchEvent(new Event('change'));
 await waitFor(()=>s.zoneState().dataset.state==='invalid','oversized validation');assert.equal(reads,0);assert.equal(s.calls.length,0);
});

test('an open restore confirmation relabels without replacing the file or dispatching',async t=>{
 const s=fixture(t),file=all(s.root).find(n=>n.type==='file'),chosen=namedFile('staged.zip',await createLibraryArchive(s.backup));await stageArchive(s,chosen);s.button(uiText('data.restore')).click();const title=all(s.root).find(n=>n.className==='settings-confirm-title');
 await requestUiRoute('ja');assert.equal(title.textContent,uiText('data.confirm.restoreTitle'));assert.equal(file.files[0],chosen);assert.equal(s.calls.length,0);
});


test('restore becomes available only for a successfully checked current file',async t=>{
 const s=fixture(t),restore=s.button('校验并恢复'),file=all(s.root).find(n=>n.type==='file');
 assert.equal(restore.disabled,true,'no file has been checked yet');
 const good=await createLibraryArchive(s.backup),bad=strToU8('broken archive');let release;
 file.files=[{name:'pending.zip',size:good.length,arrayBuffer:()=>new Promise(resolve=>{release=()=>resolve(good.buffer);})}];file.dispatchEvent(new Event('change'));
 assert.equal(restore.disabled,true,'checking is not permission to restore');
 restore.dispatchEvent(new Event('click'));assert.equal(all(s.root).find(n=>n.tagName==='dialog').hasAttribute('open'),false,'even a synthetic activation cannot open an unchecked restore');
 release();await waitFor(()=>s.zoneState().dataset.state==='valid','the archive check');assert.equal(restore.disabled,false);
 file.files=[namedFile('broken.zip',bad)];file.dispatchEvent(new Event('change'));assert.equal(restore.disabled,true,'replacing a valid file revokes permission immediately');
 await waitFor(()=>s.zoneState().dataset.state==='invalid','the rejected archive');assert.equal(restore.disabled,true);
 file.files=[];file.dispatchEvent(new Event('change'));assert.equal(restore.disabled,true);assert.equal(s.zoneState().dataset.state,'empty');assert.equal(s.calls.length,0);
});

test('an old valid archive check cannot unlock a new file or another account',async t=>{
 const s=fixture(t),restore=s.button('校验并恢复'),file=all(s.root).find(n=>n.type==='file'),good=await createLibraryArchive(s.backup);let finishOld,finishNew;
 file.files=[{name:'old.zip',size:good.length,arrayBuffer:()=>new Promise(resolve=>{finishOld=()=>resolve(good.buffer);})}];file.dispatchEvent(new Event('change'));
 file.files=[{name:'new.zip',size:good.length,arrayBuffer:()=>new Promise(resolve=>{finishNew=()=>resolve(good.buffer);})}];file.dispatchEvent(new Event('change'));
 finishOld();await delay(15);assert.equal(restore.disabled,true);assert.equal(s.zoneState().dataset.state,'checking');
 s.setOwner('bob');finishNew();await delay(15);assert.equal(restore.disabled,true,'an earlier owner cannot grant restore permission');assert.equal(s.zoneState().dataset.state,'empty');
 s.setOwner('alice');assert.equal(restore.disabled,true,'returning to the first owner does not revive its check');assert.equal(s.calls.length,0);
});
