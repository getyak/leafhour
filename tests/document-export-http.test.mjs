import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createReaderServer} from '../server/server.mjs';
import {assembleBookTransfer} from '../app/book-transfer.mjs';

test('browser export assets are real font/manifest bytes and book export obeys owner boundaries',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'document-export-'));
 const server=await createReaderServer({bookPath:path.join(dir,'absent'),recordsPath:path.join(dir,'records.json'),sendCode:null,translator:null,chatGenerator:null,companionGenerator:null,speechProvider:null,dialogueGenerator:null,guideGenerator:null,paddleProvider:null,env:{}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(async()=>{await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});});
 const base='http://127.0.0.1:'+server.address().port,session=await server.portal.auth.localSession(),headers={Cookie:'marginalia_session='+session.token,'X-Reader-Owner':session.user.id};
 const fontResponse=await fetch(base+'/fonts/document-export/manifest.json'),fonts=await fontResponse.json();assert.ok(Array.isArray(fonts.fonts),'the response is the font manifest, never a serialized Buffer');
 const font=await fetch(base+'/fonts/document-export/'+fonts.fonts[0].file);assert.match(font.headers.get('content-type'),/^font\/ttf/);assert.deepEqual([...new Uint8Array(await font.arrayBuffer()).subarray(0,4)],[0,1,0,0]);
 const book=await server.portal.library.importDocument(session.user,{filename:'Synthetic.txt',bytes:Buffer.from('Private export source. 中文。')});
 await server.portal.library.addComment(session.user,book.bookId,{id:'secret',passageId:book.sections[0].paragraphs[0].id,text:'PRIVATE NOTE'});
 const url='/api/library/books/'+book.bookId;
 for(const action of ['/document-export','/content-part?offset=0&snapshot='+'0'.repeat(64)]){assert.ok([401,404].includes((await fetch(base+url+action)).status));assert.equal((await fetch(base+url+action,{headers:{...headers,'X-Reader-Owner':'someone-else'}})).status,409);}
 const manifest=await (await fetch(base+url+'/document-export',{headers})).json();
 const exported=await assembleBookTransfer(manifest,async(offset,snapshot)=>(await fetch(base+url+'/content-part?offset='+offset+'&snapshot='+snapshot,{headers})).json());
 assert.equal(exported.sections[0].paragraphs[0].original,'Private export source. 中文。');assert.ok(!JSON.stringify(exported).includes('PRIVATE NOTE'));
});
