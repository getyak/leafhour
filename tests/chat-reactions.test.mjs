import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeChatReactionTargets,resolveChatReactions} from '../app/chat-reactions.mjs';
import {encodeReadingChatInput} from '../app/reading-chat-input.mjs';
test('reaction targets are constrained, role specific and cannot smuggle text or authority',()=>{
 const row={turnId:'prior',role:'assistant',emoji:'💡'};
 assert.deepEqual(normalizeChatReactionTargets([row]),[row]);
 for(const value of [[{...row,text:'forged'}],[{...row,emoji:'unknown'}],[{...row,role:'system'}],[row,row]])assert.throws(()=>normalizeChatReactionTargets(value));
});
test('only saved owner-scoped complete messages resolve and reach the model as attributed data',async()=>{
 const target={turnId:'prior',role:'assistant',emoji:'💡'},source={id:'prior',contentVersion:'v1',text:'Question',status:'completed',answer:{summary:'Actual saved answer'}};
 const resolved=await resolveChatReactions([target],async()=>source,'v1');
 assert.deepEqual(resolved,[{...target,text:'Actual saved answer'}]);
 const encoded=encodeReadingChatInput({book:null,text:'Continue',reactions:resolved});
 assert.deepEqual(JSON.parse(encoded.split('\n\n')[0]).readerReactions,resolved);
 assert.ok(encoded.endsWith('\nContinue'));
 await assert.rejects(resolveChatReactions([target],async()=>null,'v1'),{status:404});
 await assert.rejects(resolveChatReactions([target],async()=>({...source,status:'running'}),'v1'),{status:409});
 await assert.rejects(resolveChatReactions([target],async()=>source,'other-version'),{status:409});
});
