import test from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {mountLibraryData} from '../app/library-data.mjs';
import {createLibraryArchive,portableHash} from '../app/library-portability.mjs';
import {readingBook,readingRecords} from './reading-fixtures.mjs';

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
 const panel=mountLibraryData({root,api,getSession:()=>({user:{id:owner}}),getOwner:()=>owner});return {panel,root,doc,calls,blobs,backup,button:text=>all(root).find(n=>n.tagName==='button'&&n.textContent===text),label:name=>all(root).find(n=>n.attrs['aria-label']===name),status:()=>all(root).find(n=>n.attrs.role==='status').textContent,checks:()=>all(root).filter(n=>n.dataset.recordKey),setOwner:value=>{owner=value;panel.update();}};
}
test('native-like selection downloads exactly the preview; changes and owner switches invalidate private output',async t=>{
 const s=fixture(t);s.button('读取可选记录').click();await idle(s);assert.equal(s.checks().length,2);assert.ok(s.checks().every(i=>!i.checked));const mode=s.label('导出范围');mode.value='share';mode.dispatchEvent(new Event('change'));const first=s.checks()[0];first.checked=true;first.dispatchEvent(new Event('change'));s.button('预览所选内容').click();const preview=s.label('将要下载的完整内容预览').value;assert.ok(!preview.includes('PRIVATE HIDDEN QUESTION'));assert.ok(!preview.includes('Read this first.'));s.button('下载预览内容').click();assert.equal(await s.blobs[0].text(),preview);
 s.label('导出格式').value='markdown';s.label('导出格式').dispatchEvent(new Event('change'));assert.equal(s.button('下载预览内容').disabled,true);assert.equal(s.label('将要下载的完整内容预览').value,'');s.button('预览所选内容').click();const consents=all(s.root).filter(n=>n.type==='checkbox'&&!n.dataset.recordKey);consents.forEach(n=>n.checked=true);s.setOwner('bob');assert.equal(s.label('将要下载的完整内容预览').value,'');assert.equal(s.checks().length,0);assert.equal(s.button('下载预览内容').disabled,true);assert.ok(consents.every(n=>!n.checked));assert.equal(s.label('导出范围').value,'personal');
});
test('cancelling while start acknowledgement is pending still clears the newly allocated owner slot',async t=>{
 let resolveStart,started=false;const s=fixture(t,async(url)=>{if(url.endsWith('/start')){started=true;return new Promise(r=>{resolveStart=r;});}if(url.endsWith('/cancel'))return {cancelled:true};throw Error('Unexpected '+url);});const bytes=await createLibraryArchive(s.backup),file=all(s.root).find(n=>n.tagName==='input'&&n.type==='file');file.files=[{name:'backup.zip',size:bytes.length,arrayBuffer:async()=>bytes.buffer}];s.button('校验并恢复').click();await waitFor(()=>started,'the restore start request');assert.equal(started,true);s.button('取消当前操作').click();resolveStart({id:'synthetic-operation'});await idle(s);assert.ok(s.calls.some(c=>c.url.endsWith('/synthetic-operation/cancel')));assert.ok(!s.calls.some(c=>c.url.endsWith('/commit')));assert.match(s.status(),/已取消恢复并清除/);
});
