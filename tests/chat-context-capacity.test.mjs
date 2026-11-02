import test from 'node:test';
import assert from 'node:assert/strict';
import {encodeReadingChatInput} from '../app/reading-chat-input.mjs';
import {compactChatHistory,chatModelCapacity} from '../server/chat-context.mjs';

test('published model capacity replaces small product token caps',()=>{
 assert.deepEqual(chatModelCapacity('deepseek-flash'),{contextWindow:1048576,maxOutputTokens:393216});
 assert.throws(()=>chatModelCapacity('unknown'),/capacity/i);
});
test('chat input retains more than six turns and long current text',()=>{
 const history=Array.from({length:20},(_,i)=>({role:i%2?'assistant':'user',content:'message '+i}));
 const result=encodeReadingChatInput({book:null,text:'长'.repeat(30000),history});
 assert.deepEqual(JSON.parse(result.split('\n\n读者这次说：\n')[0]).history,history);
});
test('context compaction summarizes older roles, retains recent text and never mutates originals',async()=>{
 const history=Array.from({length:20},(_,i)=>({role:i%2?'assistant':'user',content:String(i)+'x'.repeat(100)})),original=structuredClone(history),seen=[];
 const result=await compactChatHistory(history,{inputBudgetTokens:250,summarize:async rows=>{seen.push(rows);return 'Earlier discussion checkpoint.';}});
 assert.ok(seen.length);assert.equal(seen[0][0].role,'user');assert.deepEqual(history,original);
 assert.deepEqual(result.at(-1),history.at(-1));assert.equal(result[0].role,'user');assert.match(result[0].content,/checkpoint/);
 assert.ok(Buffer.byteLength(JSON.stringify(result))<=1000);
});

test('failed or non-reducing compaction never returns a silently truncated projection',async()=>{
 const history=[{role:'user',content:'x'.repeat(800)},{role:'assistant',content:'y'.repeat(800)}],original=structuredClone(history);
 await assert.rejects(compactChatHistory(history,{inputBudgetTokens:125,summarize:async()=>{throw Error('Provider unavailable');}}),/Provider unavailable/);
 await assert.rejects(compactChatHistory(history,{inputBudgetTokens:125,summarize:async()=> 'z'.repeat(1000)}),/did not reduce/);
 assert.deepEqual(history,original);
});

test('conversation deadlines follow host capacity and permit longer self-hosted runs',async()=>{
 const {chatRuntimeTimeout}=await import('../server/chat-context.mjs');
 assert.equal(chatRuntimeTimeout({}),270000);assert.equal(chatRuntimeTimeout({LEAFHOUR_CHAT_TIMEOUT_MS:'900000'}),900000);
 assert.equal(chatRuntimeTimeout({VERCEL:'1',LEAFHOUR_CHAT_TIMEOUT_MS:'900000'}),270000);
 assert.throws(()=>chatRuntimeTimeout({LEAFHOUR_CHAT_TIMEOUT_MS:'invalid'}),/timeout/);
});

test('an oversized final assistant history message is compacted with its user role pair',async()=>{
 const history=[{role:'user',content:'Explain this topic carefully. '.repeat(100)},{role:'assistant',content:'答'.repeat(180000)}],original=structuredClone(history),seen=[];
 const result=await compactChatHistory(history,{inputBudgetTokens:74000,summaryInputTokens:655360,summarize:async rows=>{seen.push(rows);if(seen.length>3)throw Error('Repeated non-progress compaction');return 'User requested an explanation; the assistant explained the topic.';}});
 assert.equal(seen.length,1);assert.deepEqual(seen[0],history);assert.deepEqual(history,original);assert.equal(result.length,1);
});

test('unchanged checkpoints fail instead of repeatedly consuming provider calls',async()=>{
 const checkpoint={role:'user',content:'Conversation checkpoint (summary of earlier role-labelled messages):\n'+'x'.repeat(300)},original=[checkpoint];let calls=0;
 await assert.rejects(compactChatHistory(original,{inputBudgetTokens:30,summaryInputTokens:1000,summarize:async()=>{if(++calls>3)throw Error('Repeated non-progress compaction');return 'x'.repeat(300);}}),/did not reduce/);
 assert.equal(calls,1);assert.deepEqual(original,[checkpoint]);
});

test('a single huge final history message is summarized in provider-sized role-labelled batches',async()=>{
 const {estimateChatTokens}=await import('../server/chat-context.mjs');
 const history=[{role:'assistant',content:'答'.repeat(180000)}],original=structuredClone(history);let calls=0;
 const result=await compactChatHistory(history,{inputBudgetTokens:30000,summaryInputTokens:60000,summarize:async rows=>{
  calls++;assert.ok(estimateChatTokens(JSON.stringify(rows))<=60000);assert.ok(rows.some(r=>r.role==='assistant'));return 'Earlier assistant explanation checkpoint.';
 }});
 assert.ok(calls>1);assert.ok(estimateChatTokens(JSON.stringify(result))<=30000);assert.deepEqual(history,original);
});
