import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
import * as receipts from '../app/save-receipts.mjs';
const descriptor=(id,params)=>({id,params});
test('formatter-only receipt entries preserve receipt state and all legacy fallback outputs',()=>{
 for(const name of ['NoteSaveReceipt','ReadingSessionReceipt','DraftSaveReceipt']){const format=receipts['format'+name],legacy=receipts[name[0].toLowerCase()+name.slice(1)];assert.equal(typeof format,'function');for(const confirmed of [false,true])for(const durable of [false,true])for(const hasDraft of [false,true]){const state=Object.freeze({confirmed,durable,hasDraft});assert.deepEqual(format(state,descriptor),legacy(state,descriptor));let called=0;const value=legacy(state,(id,params,fallback)=>{called++;assert.equal(typeof fallback,'string');assert.deepEqual({id,params},format(state,descriptor));return fallback;});assert.equal(called,1);assert.equal(value,legacy(state));}}
 let calls=0;for(const view of [null,{status:'active',id:'end'},{status:'finished',id:'other'}])assert.equal(receipts.formatCurrentSessionReceipt(view,{id:'end'},{},()=>{calls++;}),'');assert.equal(calls,0);assert.deepEqual(receipts.formatCurrentSessionReceipt({status:'finished',id:'end'},{id:'end'},{confirmed:true},descriptor),{id:'receipt.session.saved',params:{}});
});
test('actual UTF8 reader formatter entry bundle drops legacy receipt prose without dropping state semantics',async()=>{
 const filename=fileURLToPath(new URL('../app/save-receipts.mjs',import.meta.url)),entry=['formatNoteSaveReceipt','formatReadingSessionReceipt','formatDraftSaveReceipt','formatCurrentSessionReceipt'];
 const result=await build({stdin:{contents:`import {${entry.join(',')}} from ${JSON.stringify(filename)};globalThis.receipts=[${entry.join(',')}];`,resolveDir:fileURLToPath(new URL('..',import.meta.url)),loader:'js'},bundle:true,format:'esm',platform:'browser',target:'es2022',minify:true,charset:'utf8',write:false,logLevel:'silent'});const source=result.outputFiles[0].text;assert.ok(source.includes('receipt.note.'));assert.ok(source.includes('receipt.session.'));for(const literal of ['已保存到自己的书房。','文字已留在本机草稿中。','本次时段已保存到书房。','当前文字是草稿，尚未提交。'])assert.ok(!source.includes(literal),literal);
});
