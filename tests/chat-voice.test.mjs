import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {createChatVoice} from '../server/chat-voice.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
const owner={id:'voice-owner'},other={id:'other-owner'};
function setup(){const rows=new Map(),blobs=new Map();return createChatVoice({store:{read:async(k,d)=>structuredClone(rows.get(k)??d),mutate:async(k,d,fn)=>{const row=structuredClone(rows.get(k)??d),result=await fn(row);rows.set(k,row);return result;},putBlob:async(k,b)=>blobs.set(k,Buffer.from(b)),blob:async k=>Buffer.from(blobs.get(k))}});}
const audio=Buffer.concat([Buffer.from('caff'),Buffer.alloc(900,7)]);
const metadata=(bytes=audio)=>({bytes:bytes.length,sha256:sha(bytes),mimeType:'audio/x-caf',durationMs:1200});
test('voice upload is resumable and idempotent, verifies bytes, and is owner-bound',async()=>{
 const voice=setup(),id=randomUUID(),input=metadata();
 const first=await voice.start(owner,id,input);assert.deepEqual(first.received,[]);
 await voice.part(owner,id,{index:0,base64:audio.toString('base64'),sha256:sha(audio)});
 assert.deepEqual((await voice.start(owner,id,input)).received,[0]);
 const receipt=await voice.complete(owner,id);assert.equal(receipt.id,id);assert.deepEqual(await voice.validate(owner,receipt),receipt);
 assert.deepEqual(await voice.bytes(owner,id,0),audio);assert.deepEqual(await voice.complete(owner,id),receipt);
 await assert.rejects(voice.view(other,id),{status:404});await assert.rejects(voice.bytes(other,id,0),{status:404});await assert.rejects(voice.validate(other,receipt),{status:404});
 await assert.rejects(voice.start(owner,id,{...input,durationMs:3000}),{status:409});
});
test('incomplete or tampered audio cannot become a playable message or trusted receipt',async()=>{
 const voice=setup(),id=randomUUID(),input=metadata();await voice.start(owner,id,input);
 await assert.rejects(voice.complete(owner,id),{status:422});await assert.rejects(voice.bytes(owner,id,0),{status:404});
 await assert.rejects(voice.part(owner,id,{index:0,base64:audio.toString('base64'),sha256:sha('wrong')}),{status:422});
 await voice.part(owner,id,{index:0,base64:audio.toString('base64'),sha256:sha(audio)});const receipt=await voice.complete(owner,id);
 await assert.rejects(voice.validate(owner,{...receipt,sha256:sha('wrong')}),{status:409});
});
test('voice validation rejects arbitrary paths and non-audio files',async()=>{
 const voice=setup();await assert.rejects(voice.start(owner,'../another-account',metadata()),{status:404});
 const bytes=Buffer.from('<script>not audio</script>'),id=randomUUID();await voice.start(owner,id,metadata(bytes));
 await voice.part(owner,id,{index:0,base64:bytes.toString('base64'),sha256:sha(bytes)});await assert.rejects(voice.complete(owner,id),{status:422});
 await assert.rejects(voice.start(null,randomUUID(),metadata()),{status:401});
});
test('voice originals export and restore on a clean instance, with validation before writes',async()=>{
 const source=setup(),id=randomUUID();await source.start(owner,id,metadata());await source.part(owner,id,{index:0,base64:audio.toString('base64'),sha256:sha(audio)});const receipt=await source.complete(owner,id);
 const asset=await source.exportVoice(owner,receipt),destination=setup();
 assert.deepEqual(await destination.restoreVoice(owner,asset,{validateOnly:true}),receipt);
 await assert.rejects(destination.view(owner,id),{status:404});
 const damaged=structuredClone(asset);damaged.parts[0]=Buffer.alloc(audio.length).toString('base64');
 await assert.rejects(destination.restoreVoice(owner,damaged,{validateOnly:true}),{status:422});
 await assert.rejects(destination.view(owner,id),{status:404});
 assert.deepEqual(await destination.restoreVoice(owner,asset,{validateOnly:false}),receipt);
 assert.deepEqual(await destination.bytes(owner,id,0),audio);
});
