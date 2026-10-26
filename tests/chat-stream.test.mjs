import test from 'node:test';
import assert from 'node:assert/strict';
const module=await import('../app/chat-stream.mjs').catch(()=>({}));
const decode=(...args)=>{assert.equal(typeof module.readChatResponse,'function','Incremental response decoder must exist');return module.readChatResponse(...args);};
const response=frames=>new Response(new ReadableStream({start(controller){const bytes=new TextEncoder().encode(frames);for(const byte of bytes)controller.enqueue(new Uint8Array([byte]));controller.close();}}),{headers:{'Content-Type':'application/x-ndjson'}});
test('incremental UTF-8 decoding exposes prefixes and ignores repeated or stale snapshots',async()=>{
 const progress=[],frames=[{type:'progress',id:'q',sequence:1,text:'中文'},{type:'progress',id:'q',sequence:1,text:'中文'},{type:'progress',id:'q',sequence:0,text:'旧'},{type:'progress',id:'q',sequence:2,text:'中文🙂'},{type:'result',turn:{id:'q',status:'completed',answer:{summary:'中文🙂'}}}];
 const result=await decode(response(frames.map(JSON.stringify).join('\n')+'\n'),{onProgress:value=>progress.push(value.text)});
 assert.deepEqual(progress,['中文','中文🙂']);assert.equal(result.status,'completed');
});
test('a dropped stream never treats provisional text as a completed answer',async()=>{
 await assert.rejects(decode(response(JSON.stringify({type:'progress',id:'q',sequence:1,text:'未完成'})+'\n')),/interrupted/i);
});
test('coalesced network reads keep the per-frame bound independent of chunk size',async()=>{
 const frames=Array.from({length:20},(_,index)=>({type:'progress',id:'q',sequence:index+1,text:'x'.repeat(10000)}));frames.push({type:'result',turn:{id:'q',status:'completed'}});
 const result=await decode(new Response(frames.map(JSON.stringify).join('\n')+'\n',{headers:{'Content-Type':'application/x-ndjson'}}));assert.equal(result.status,'completed');
});
test('stream errors preserve a bounded billing recovery receipt and JSON callers still work',async()=>{
 await assert.rejects(decode(response(JSON.stringify({type:'error',status:502,billingOperation:{id:'op',status:'released'}})+'\n')),error=>error.status===502&&error.billingOperation.status==='released');
 assert.deepEqual(await decode(new Response('{"status":"completed"}',{headers:{'Content-Type':'application/json'}})),{status:'completed'});
});
test('identity change stops progress before subsequent chunks can render',async()=>{
 let current=true,count=0;
 const rows=[{type:'progress',id:'q',sequence:1,text:'One'},{type:'progress',id:'q',sequence:2,text:'Two'},{type:'result',turn:{id:'q',status:'completed'}}];
 await assert.rejects(decode(response(rows.map(JSON.stringify).join('\n')+'\n'),{isCurrent:()=>current,onProgress:()=>{count++;current=false;}}));assert.equal(count,1);
});
