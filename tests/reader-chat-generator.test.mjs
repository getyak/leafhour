import test from 'node:test';
import assert from 'node:assert/strict';
import {createReaderChatGenerator} from '../server/reader-chat-generator.mjs';
test('runtime failures are classified for operators without logging credentials, source or question text',async()=>{
  const diagnostics=[],privateText='do-not-log-this-secret-or-question';
  const generator=createReaderChatGenerator({env:{DEEPSEEK_API_KEY:privateText,VERCEL:'1'},logger:d=>diagnostics.push(d),makeGenerator:()=>async()=>{throw Object.assign(Error('Cannot find package '+privateText),{code:'ERR_MODULE_NOT_FOUND'});}});
  await assert.rejects(generator({runId:'safe-run',text:privateText}),/Cannot find package/);
  assert.equal(diagnostics.length,1);assert.equal(diagnostics[0].reason,'missing-runtime-package');assert.equal(diagnostics[0].code,'ERR_MODULE_NOT_FOUND');assert.equal(diagnostics[0].hosted,true);assert.doesNotMatch(JSON.stringify(diagnostics),new RegExp(privateText));
});
