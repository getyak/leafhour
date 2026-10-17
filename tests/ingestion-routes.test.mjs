import test from 'node:test';import assert from 'node:assert/strict';
import {createHostedHandler} from '../api/[...path].js';
import {createPortal} from '../server/portal.mjs';
import {ingestionWakeToken} from '../server/ingestion-runner.mjs';
test('only the exact protected background endpoint bypasses interactive origin checks',async()=>{
 const rows=new Map(),work=[];let userLookups=0;
 const store={read:async(k,f)=>structuredClone(rows.get(k)??f),mutate:async(k,f,fn)=>{const d=structuredClone(rows.get(k)??f),v=fn(d);rows.set(k,d);return v;},putBlob:async()=>{},blob:async()=>Buffer.alloc(0)};
 const env={SUPABASE_SECRET_KEY:'server-fixture',READER_PUBLIC_ORIGIN:'https://reader.example.com'};
 const handler=createHostedHandler({env,background:p=>work.push(p),storeFactory:()=>store,authFactory:()=>({userFor:async()=>{userLookups++;return null;}}),portalFactory:o=>createPortal({...o,catalogDir:null,translator:null,speechProvider:null,dialogueGenerator:null,guideGenerator:null,chatGenerator:null,companionGenerator:null,paddleProvider:null})});
 const call=async(path,authorization)=>{let value;const res={setHeader(){},end:b=>{value=JSON.parse(b);}};await handler({url:path,method:'POST',headers:{authorization,'content-type':'application/json'},body:{}},res);return {status:res.statusCode,value};};
 assert.equal((await call('/api/internal/ingestion/wake','Bearer wrong')).status,404);
 assert.equal((await call('/api/internal/ingestion/other','Bearer '+ingestionWakeToken(env))).status,404);
 assert.equal((await call('/api/internal/ingestion/wake','Bearer '+ingestionWakeToken(env))).status,202);
 await Promise.all(work);assert.equal(userLookups,0);
});
