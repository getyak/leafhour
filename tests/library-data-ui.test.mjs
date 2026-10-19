import test from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {mountLibraryData} from '../app/library-data.mjs';
import {requestUiRoute,t as uiText} from '../app/ui-locale.mjs';
import {createLibraryArchive,portableHash} from '../app/library-portability.mjs';
import {readingBook,readingRecords,focusSession} from './reading-fixtures.mjs';
test.beforeEach(()=>requestUiRoute('zh-Hans'));
test.afterEach(()=>requestUiRoute('en'));

class Element extends EventTarget{
 constructor(tag,doc){super();this.tagName=tag;this.doc=doc;this.children=[];this.attrs={};this.dataset={};this.value='';this.disabled=false;this.hidden=false;this.isConnected=true;this.classList={add(){},toggle(){}};}
 append(...nodes){for(const n of nodes){n.parentElement=this;this.children.push(n);if(this.tagName==='select'&&this.children.length===1)this.value=n.value;}}
 replaceChildren(...nodes){this.children=[];this.append(...nodes);}
 setAttribute(k,v){this.attrs[k]=String(v);}getAttribute(k){return this.attrs[k];}focus(){this.doc.activeElement=this;}click(){if(!this.disabled)this.dispatchEvent(new Event('click'));}
 get options(){return this.children;}
}
const all=root=>[root,...root.children.flatMap(all)];
// Export awaits WebCrypto; event-loop turns do not imply its worker finished.
const waitFor=async(predicate,description)=>{const deadline=Date.now()+5000;while(!predicate()){assert.ok(Date.now()<deadline,'Timed out waiting for '+description);await delay(5);}};
const idle=s=>waitFor(()=>s.root.getAttribute('aria-busy')==='false','the data-panel operation to finish');
function fixture(t,handler){const before=globalThis.document,doc={};doc.createElement=tag=>new Element(tag,doc);doc.createTextNode=text=>Object.assign(new Element('#text',doc),{textContent:text});doc.body=doc.createElement('body');doc.activeElement=doc.body;globalThis.document=doc;t.after(()=>{globalThis.document=before;});const root=doc.createElement('section');doc.body.append(root);let owner='alice';const calls=[],blobs=[],originalUrl=URL.createObjectURL,originalRevoke=URL.revokeObjectURL;URL.createObjectURL=blob=>{blobs.push(blob);return 'blob:synthetic';};URL.revokeObjectURL=()=>{};t.after(()=>{URL.createObjectURL=originalUrl;URL.revokeObjectURL=originalRevoke;});
 const records=readingRecords();records.comments.push({id:'note',passageId:'p1',contentVersion:readingBook.contentVersion,text:'Selected comment',origin:'user',createdAt:'2026-10-14T12:00:00Z'});records.questions.push({id:'private',passageId:'p2',contentVersion:readingBook.contentVersion,text:'PRIVATE HIDDEN QUESTION',origin:'user',createdAt:'2026-10-14T12:00:00Z'});const entry={book:structuredClone(readingBook),records},backup={kind:'marginalia-library',schemaVersion:1,books:[entry],includesOriginalFiles:false};
 const api=async(url,body)=>{calls.push({url,body});if(handler)return handler(url,body);if(url.endsWith('/manifest'))return {kind:'marginalia-export-manifest',schemaVersion:1,exportedAt:'2026-10-17T00:00:00Z',books:[{bookId:readingBook.bookId,contentVersion:readingBook.contentVersion}]};const bytes=new TextEncoder().encode(JSON.stringify(entry));return {kind:'marginalia-book-export-part',schemaVersion:1,bookId:readingBook.bookId,contentVersion:readingBook.contentVersion,offset:0,totalBytes:bytes.length,nextOffset:null,snapshot:await portableHash(bytes),data:Buffer.from(bytes).toString('base64')};};
 const panel=mountLibraryData({root,api,getSession:()=>({user:{id:owner}}),getOwner:()=>owner});t.after(()=>panel.dispose());return {panel,root,doc,calls,blobs,backup,button:text=>all(root).find(n=>n.tagName==='button'&&n.textContent===text),label:name=>all(root).find(n=>n.attrs['aria-label']===name),status:()=>all(root).find(n=>n.attrs.role==='status').textContent,checks:()=>all(root).filter(n=>n.dataset.recordKey),setOwner:value=>{owner=value;panel.update();}};
}
test('native-like selection downloads exactly the preview; changes and owner switches invalidate private output',async t=>{
 const s=fixture(t);s.button('读取可选记录').click();await idle(s);assert.equal(s.checks().length,2);assert.ok(s.checks().every(i=>!i.checked));const mode=s.label('导出范围');mode.value='share';mode.dispatchEvent(new Event('change'));const first=s.checks()[0];first.checked=true;first.dispatchEvent(new Event('change'));s.button('预览所选内容').click();const preview=s.label('将要下载的完整内容预览').value;assert.ok(!preview.includes('PRIVATE HIDDEN QUESTION'));assert.ok(!preview.includes('Read this first.'));s.button('下载预览内容').click();assert.equal(await s.blobs[0].text(),preview);
 s.label('导出格式').value='markdown';s.label('导出格式').dispatchEvent(new Event('change'));assert.equal(s.button('下载预览内容').disabled,true);assert.equal(s.label('将要下载的完整内容预览').value,'');s.button('预览所选内容').click();const consents=all(s.root).filter(n=>n.type==='checkbox'&&!n.dataset.recordKey);consents.forEach(n=>n.checked=true);s.setOwner('bob');assert.equal(s.label('将要下载的完整内容预览').value,'');assert.equal(s.checks().length,0);assert.equal(s.button('下载预览内容').disabled,true);assert.ok(consents.every(n=>!n.checked));assert.equal(s.label('导出范围').value,'personal');
});
test('cancelling while start acknowledgement is pending still clears the newly allocated owner slot',async t=>{
 let resolveStart,started=false;const s=fixture(t,async(url)=>{if(url.endsWith('/start')){started=true;return new Promise(r=>{resolveStart=r;});}if(url.endsWith('/cancel'))return {cancelled:true};throw Error('Unexpected '+url);});const bytes=await createLibraryArchive(s.backup),file=all(s.root).find(n=>n.tagName==='input'&&n.type==='file');file.files=[{name:'backup.zip',size:bytes.length,arrayBuffer:async()=>bytes.buffer}];s.button('校验并恢复').click();await waitFor(()=>started,'the restore start request');assert.equal(started,true);s.button('取消当前操作').click();resolveStart({id:'synthetic-operation'});await idle(s);assert.ok(s.calls.some(c=>c.url.endsWith('/synthetic-operation/cancel')));assert.ok(!s.calls.some(c=>c.url.endsWith('/commit')));assert.match(s.status(),/已取消恢复并清除/);
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
