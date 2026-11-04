import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {normalizeChatGuideTarget,normalizeChatGuideContext,chatGuideTarget} from '../app/chat-guide-context.mjs';
import {encodeReadingChatInput} from '../app/reading-chat-input.mjs';
import {portableChatTurns} from '../app/portable-chat.mjs';
import {createReaderServer} from '../server/server.mjs';
import {createCreditGate} from '../server/credit-gate.mjs';

const target={kind:'leafhour-reading-guide-context',schemaVersion:1,origin:'ai',guideId:'guide-fixture',bookId:'book',contentVersion:'v1',sourceKind:'cloud',locale:'zh-Hans'};
const resolved={...target,opening:'AI opening.',method:'AI reading method.',readingQuestion:'AI reading question?'};
test('guide targets cannot supply AI text and resolved context retains an explicit AI attribution',()=>{
 assert.deepEqual(normalizeChatGuideTarget(target),target);assert.deepEqual(chatGuideTarget(resolved),target);
 assert.deepEqual(normalizeChatGuideContext(resolved),resolved);
 assert.throws(()=>normalizeChatGuideTarget(resolved));assert.throws(()=>normalizeChatGuideContext({...resolved,origin:'user'}));assert.throws(()=>normalizeChatGuideContext({...resolved,notes:['private']}));
 const input=encodeReadingChatInput({book:{bookId:'book',contentVersion:'v1',title:'Fixture'},passageId:'p1',text:'User question only?',guideContext:resolved,history:[]});
 const [payload,user]=input.split('\n\n读者这次说：\n');assert.equal(user,'User question only?');assert.deepEqual(JSON.parse(payload).readingGuideContext,resolved);
});

test('portable history keeps the user words separate from AI guide context and rejects wrong book/version',()=>{
 const book={bookId:'book',contentVersion:'v1',sections:[{chapterId:'c1',paragraphs:[{id:'p1',original:'Fixture source.'}]}]};
 const history={kind:'marginalia-reader-chat',schemaVersion:1,bookId:'book',turns:[{id:'turn',passageId:'p1',contentVersion:'v1',createdAt:'2026-11-05T00:00:00Z',origin:'user',text:'User question only?',guideContext:resolved,status:'completed',answer:{kind:'conversation',origin:'ai',summary:'Answer.',sourceRefs:[],recommendations:[]}}]};
 const turn=portableChatTurns(history,book)[0];assert.equal(turn.text,'User question only?');assert.deepEqual(turn.guideContext,resolved);
 assert.throws(()=>portableChatTurns({...history,turns:[{...history.turns[0],guideContext:{...resolved,contentVersion:'other'}}]},book));
});

test('credit quote identity includes the strict guide reference without including client supplied guide prose',async()=>{
 const library={async getBook(){return {bookId:'book',contentVersion:'v1',sections:[{paragraphs:[{id:'p1',original:'Fixture source.'}]}]};}};
 const gate=createCreditGate({library,billing:{enabled:true,quote:async x=>x}}),base={id:'request',text:'User question only?',passageId:'p1',contentVersion:'v1',guideContext:target};
 const a=await gate.quote({id:'owner'},{action:'conversation',bookId:'book',input:base}),b=await gate.quote({id:'owner'},{action:'conversation',bookId:'book',input:{...base,guideContext:{...target,guideId:'guide-other'}}});
 assert.notEqual(a.scope.requestHash,b.scope.requestHash);
 await assert.rejects(gate.quote({id:'owner'},{action:'conversation',bookId:'book',input:{...base,guideContext:resolved}}));
});

test('cloud and device guide followups resolve only the owner cache and preserve attribution through send and export',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'leafhour-guide-chat-'));const jobs=[];
 const server=await createReaderServer({recordsPath:path.join(dir,'records.json'),sendCode:null,translator:null,companionGenerator:null,readingGuideGenerator:async()=>({opening:'AI opening.',method:'AI method.',readingQuestion:'AI question?',model:'fixture-model'}),chatGenerator:async job=>{jobs.push(job);return {kind:'conversation',summary:'An answer.'};}});
 t.after(async()=>{await server.portal.chat.close();await rm(dir,{recursive:true,force:true});});
 const user=(await server.portal.auth.localSession()).user,book=await server.portal.library.importDocument(user,{filename:'Fixture.txt',bytes:Buffer.from('Fixture opening.')}),passageId=book.sections[0].paragraphs[0].id;
 const cloud=(await server.portal.readingGuides.ensure(user,{bookId:book.bookId,contentVersion:book.contentVersion,sourceKind:'cloud',locale:'zh-Hans'})).guide;
 const ref=chatGuideTarget({...resolved,guideId:cloud.id,bookId:book.bookId,contentVersion:book.contentVersion});
 const sent=await server.portal.chat.send(user,book.bookId,{id:'cloud-question',text:'User question only?',passageId,contentVersion:book.contentVersion,scopeRevision:0,guideContext:ref});
 assert.equal(sent.text,'User question only?');assert.equal(sent.guideContext.origin,'ai');assert.equal(sent.guideContext.method,'AI method.');assert.equal(jobs[0].text,sent.text);assert.deepEqual(jobs[0].guideContext,sent.guideContext);
 const exported=await server.portal.chat.exportHistory(user,book.bookId);assert.deepEqual(portableChatTurns(exported,book)[0].guideContext,sent.guideContext);
 const restoredOwner={id:'restored-guide-owner'},backup=await server.portal.library.exportLibrary(user);
 await server.portal.library.restoreLibrary(restoredOwner,backup);
 await server.portal.chat.restoreHistory(restoredOwner,book,exported,[book]);
 const restored=await server.portal.chat.findTurn(restoredOwner,book.bookId,'cloud-question');
 assert.equal(restored.text,'User question only?');assert.deepEqual(restored.guideContext,sent.guideContext);
 const localBook={bookId:'local-book',contentVersion:'local-v1',title:'Device book',chapterId:'c1',chapterTitle:'Opening',passageId:'p1',original:'Device opening.'};
 const device=(await server.portal.readingGuides.ensure(user,{bookId:localBook.bookId,contentVersion:localBook.contentVersion,sourceKind:'local-device',locale:'zh-Hans',context:{title:'Device book',author:'',chapters:[{id:'c1',title:'Opening'}],passages:[{id:'p1',chapterId:'c1',original:'Device opening.'}]}})).guide;
 const deviceRef={...ref,guideId:device.id,bookId:localBook.bookId,contentVersion:localBook.contentVersion,sourceKind:'local-device'};
 const local=await server.portal.chat.local.send(user,{id:'device-question',text:'User device question?',contentVersion:localBook.contentVersion,passageId:'p1',localBook,guideContext:deviceRef});
 assert.equal(local.text,'User device question?');assert.equal(local.guideContext.sourceKind,'local-device');assert.equal(jobs[1].guideContext.origin,'ai');
 assert.deepEqual(await server.portal.chat.local.send(user,{id:'device-question',text:'User device question?',contentVersion:localBook.contentVersion,passageId:'p1',localBook,guideContext:deviceRef}),local,'exact local retry returns the saved independent AI context');
 await assert.rejects(server.portal.chat.local.send(user,{id:'device-question',text:'User device question?',contentVersion:localBook.contentVersion,passageId:'p1',localBook,guideContext:{...deviceRef,guideId:'other-guide'}}),e=>e.status===409);
 await assert.rejects(server.portal.chat.local.send({id:'other-owner'},{id:'device-other',text:'Question?',contentVersion:localBook.contentVersion,passageId:'p1',localBook,guideContext:deviceRef}),e=>e.status===404);
 await assert.rejects(server.portal.chat.send(user,book.bookId,{id:'forged',text:'Question?',passageId,contentVersion:book.contentVersion,scopeRevision:0,guideContext:{...ref,sourceKind:'local-device'}}),e=>e.status===409);
});
