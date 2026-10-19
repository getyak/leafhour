import test from 'node:test';
import assert from 'node:assert/strict';
import {zipSync,unzipSync,strToU8,strFromU8} from 'fflate';
import {createLibraryArchive,readLibraryArchive,personalExportItems,selectedRecordExport} from '../app/library-portability.mjs';
import {readingBook,readingRecords,focusSession} from './reading-fixtures.mjs';

function fixture(){const book=structuredClone(readingBook),records=readingRecords();records.comments.push({id:'note',passageId:'p1',contentVersion:book.contentVersion,text:'<script>自己的评论</script>',origin:'user',createdAt:'2026-10-14T12:00:00Z'});records.questions.push({id:'private',passageId:'p2',contentVersion:book.contentVersion,text:'PRIVATE QUESTION',origin:'user',createdAt:'2026-10-14T12:00:00Z'});records.readingSessions.push(focusSession());return {kind:'marginalia-library',schemaVersion:1,exportedAt:'2026-10-17T00:00:00.000Z',books:[{book,records,chat:{kind:'marginalia-reader-chat',schemaVersion:1,bookId:book.bookId,turns:[]}}],includesOriginalFiles:false};}
test('open ZIP carries inventory and byte-exact optional originals, never hidden config',async()=>{
 const source=fixture();source.books[0].book.source.sha256=await sha(strToU8('original'));const original={bookId:readingBook.bookId,bytes:strToU8('original')};
 const bytes=await createLibraryArchive(source,{originals:[original]});assert.equal(bytes[0],80);const files=unzipSync(bytes),manifest=JSON.parse(strFromU8(files['manifest.json']));assert.equal(manifest.includesOriginalFiles,true);assert.equal(Object.keys(files).length,3);
 const restored=await readLibraryArchive(bytes);assert.deepEqual(restored.backup, {...source,includesOriginalFiles:true});assert.equal(strFromU8(restored.originals[0].bytes),'original');
 assert.equal((await readLibraryArchive(await createLibraryArchive(source))).originals.length,0);
});
test('malformed final entry, unsafe paths, credentials and non-inventory bytes reject before restore',async()=>{
 const source=fixture(),bytes=await createLibraryArchive(source);for(const change of [f=>{f['books/000.json'][10]^=1;},f=>{f['../outside']=strToU8('unsafe');},f=>{f['unexpected.json']=strToU8('extra');}]){const files=unzipSync(bytes);change(files);await assert.rejects(readLibraryArchive(zipSync(files)),/备份|校验|路径|清单/);}
 source.books[0].records.accessToken='do-not-export';await assert.rejects(createLibraryArchive(source),/凭据|令牌/);
});
test('single selected personal record and sharing preview never carry hidden questions/time/book',()=>{
 const source=fixture(),items=personalExportItems(source),note=items.find(i=>i.id==='note');assert.ok(items.some(i=>i.category==='time'));assert.ok(items.some(i=>i.id==='private'));
 for(const format of ['json','markdown']){const output=selectedRecordExport([note],{format,sharing:true,includeQuotes:false});assert.ok(output.includes('自己的评论'));for(const privateText of ['PRIVATE QUESTION','reader_focus','Read this first.','Keep your own question.'])assert.ok(!output.includes(privateText));}
 const quoted=selectedRecordExport([note],{format:'json',sharing:true,includeQuotes:true});assert.equal(JSON.parse(quoted).items[0].quote,'Read this first.');assert.throws(()=>selectedRecordExport(items.filter(i=>i.category==='time'),{sharing:true}),/分享/);
 assert.throws(()=>selectedRecordExport([]),/选择/);
});
test('new Markdown formatting is explicit and cannot change JSON, source identities or literal content',()=>{
 const items=personalExportItems(fixture()),note=items.find(i=>i.id==='note');
 const labels={personal:'Personal records',type:'Type: ',origin:'Origin: ',user:'User',id:'ID: ',version:'Source version: ',anchor:'Anchor: ',created:'Created: ',quote:'Original quote:'};
 const json=selectedRecordExport([note],{includeQuotes:true});assert.equal(selectedRecordExport([note],{includeQuotes:true,labels}),json);
 const markdown=selectedRecordExport([note],{format:'markdown',includeQuotes:true,labels});
 assert.match(markdown,/^# Personal records/);for(const literal of [note.id,note.bookId,note.contentVersion,note.text,note.quote])assert.ok(markdown.includes(literal));assert.ok(markdown.includes('Type: comment · Origin: User'));
 assert.match(selectedRecordExport([note],{format:'markdown'}),/^# 个人记录/);
});
test('forged ZIP expansion sizes are rejected before accepting data beyond the declared bound',async()=>{
 const bytes=zipSync({'books/000.json':strToU8('A'.repeat(3*1024*1024))},{level:9});
 for(const size of [1,513*1024*1024]){const forged=bytes.slice(),view=new DataView(forged.buffer);view.setUint32(22,size,true);for(let n=0;n<forged.length-46;n++)if(view.getUint32(n,true)===0x02014b50){view.setUint32(n+24,size,true);break;}await assert.rejects(readLibraryArchive(forged),/容量|清单|解压/);}
});
const credentialUrls=[' \nhttps://example.invalid/book?access_token=SYNTHETIC-CREDENTIAL','ht\ntps://example.invalid/book?sig=SYNTHETIC-CREDENTIAL','https://example.invalid/book?password=SYNTHETIC-CREDENTIAL','https://example.invalid/book?ACCESS_key=SYNTHETIC-CREDENTIAL','https://example.invalid/book?sig=SYNTHETIC-CREDENTIAL','https://example.invalid/book#access_token=SYNTHETIC-CREDENTIAL'];
test('generated packages reject credential URLs without treating user prose as configuration',async()=>{
 for(const url of credentialUrls){const source=fixture();source.books[0].book.source.url=url;await assert.rejects(createLibraryArchive(source),/凭据|令牌/);}
 const safe=fixture();safe.books[0].records.comments[0].text='A note about password and token words stays verbatim.';await createLibraryArchive(safe);
});
test('hash-consistent imported packages also reject embedded URL passwords, signing keys and tokens',async()=>{
 const bytes=await createLibraryArchive(fixture());for(const url of credentialUrls){const files=unzipSync(bytes),entry=JSON.parse(strFromU8(files['books/000.json'])),manifest=JSON.parse(strFromU8(files['manifest.json']));entry.book.source.url=url;files['books/000.json']=strToU8(JSON.stringify(entry));manifest.files[0].bytes=files['books/000.json'].length;manifest.files[0].sha256=await sha(files['books/000.json']);files['manifest.json']=strToU8(JSON.stringify(manifest));await assert.rejects(readLibraryArchive(zipSync(files)),/凭据|令牌/);}
});
async function sha(b){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',b))].map(n=>n.toString(16).padStart(2,'0')).join('');}
