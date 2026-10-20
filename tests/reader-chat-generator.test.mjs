import test from 'node:test';
import assert from 'node:assert/strict';
import {createReaderChatGenerator,createReaderAnnotationGenerator,ANNOTATION_INPUT_LABEL,ANNOTATION_SYSTEM_PROMPT} from '../server/reader-chat-generator.mjs';
test('runtime failures are classified for operators without logging credentials, source or question text',async()=>{
  const diagnostics=[],privateText='do-not-log-this-secret-or-question';
  const generator=createReaderChatGenerator({env:{DEEPSEEK_API_KEY:privateText,VERCEL:'1'},logger:d=>diagnostics.push(d),makeGenerator:()=>async()=>{throw Object.assign(Error('Cannot find package '+privateText),{code:'ERR_MODULE_NOT_FOUND'});}});
  await assert.rejects(generator({runId:'safe-run',text:privateText}),/Cannot find package/);
  assert.equal(diagnostics.length,1);assert.equal(diagnostics[0].reason,'missing-runtime-package');assert.equal(diagnostics[0].code,'ERR_MODULE_NOT_FOUND');assert.equal(diagnostics[0].hosted,true);assert.doesNotMatch(JSON.stringify(diagnostics),new RegExp(privateText));
});

test('generic host preparation is not mislabeled as a sandbox failure',async()=>{
 const diagnostics=[],privateText='private-source-key';
 const generator=createReaderChatGenerator({env:{DEEPSEEK_API_KEY:privateText},logger:d=>diagnostics.push(d),makeGenerator:()=>async()=>{throw Error('dsh: host preparation failed: No usable native binding found for node-addon-require-builtin-linux-x64-gnu '+privateText);}});
 await assert.rejects(generator({text:privateText}));
 assert.equal(diagnostics[0].reason,'native-runtime');
 assert.deepEqual(diagnostics[0].signals,['host-preparation','native-binding','node-internals']);
 assert.doesNotMatch(JSON.stringify(diagnostics),new RegExp(privateText));
});

test('an unsupported native getter probe is distinct from sandbox policy',async()=>{
 const diagnostics=[];
 const generator=createReaderChatGenerator({env:{DEEPSEEK_API_KEY:'fixture'},logger:d=>diagnostics.push(d),makeGenerator:()=>async()=>{throw Error('dsh: host preparation failed: Unsupported/no-getter: x64 sysv getter is not a recognized this->field accessor');}});
 await assert.rejects(generator({text:'private reading question'}));
 assert.equal(diagnostics[0].reason,'native-runtime');
 assert.deepEqual(diagnostics[0].signals,['host-preparation','native-probe']);
});

test('injected environment reaches the independent chat generator',async()=>{const env={DEEPSEEK_API_KEY:'fixture',VERCEL:'1'};let options;createReaderChatGenerator({env,makeGenerator:value=>{options=value;return async()=>({});}});assert.equal(options.env,env);assert.equal(options.timeoutMs,75000);});

test('annotation generator keeps the existing official factory and explicit attribution prompt',async()=>{
 assert.equal(createReaderAnnotationGenerator({env:{}}),null);
 const env={DEEPSEEK_API_KEY:'synthetic-not-a-secret'};let options,received;
 const generate=createReaderAnnotationGenerator({env,makeGenerator:value=>{options=value;return async job=>{received=job;return {kind:'annotation',text:'Synthetic'};};}});
 const job={text:'Synthetic selected words'};assert.deepEqual(await generate(job),{kind:'annotation',text:'Synthetic'});
 assert.equal(received,job);assert.equal(options.env,env);assert.equal(options.timeoutMs,75000);
 assert.equal(options.inputLabel,ANNOTATION_INPUT_LABEL);assert.equal(options.systemPrompt,ANNOTATION_SYSTEM_PROMPT);
 assert.match(options.systemPrompt,/translationStatus/);assert.match(options.systemPrompt,/reader_cite/);
});
