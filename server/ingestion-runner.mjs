import {createHmac,randomUUID,timingSafeEqual} from 'node:crypto';
import {fail} from './document-import.mjs';
const QUEUE='ingestion/queue/v1',runnable=new Set(['preparing','running','publishing']);
export const ingestionWakeToken=env=>env.SUPABASE_SECRET_KEY?createHmac('sha256',env.SUPABASE_SECRET_KEY).update('leafhour-ingestion-wake-v1').digest('hex'):null;
export function createIngestionRunner({store,ingestion,schedule=()=>{},env=process.env,fetcher=fetch,publicOrigin=null,now=Date.now,sliceMs=20000,stepDelayMs=1500,maxSteps=8}={}){
 if(!store?.mutate||!ingestion?.advance||sliceMs<1||sliceMs>60000||maxSteps<1||maxSteps>16)throw new TypeError('Invalid ingestion runner configuration');
 let active=null,timer=null,closed=false;const secret=ingestionWakeToken(env),empty=()=>({jobs:[],lease:null});
 const authorized=header=>{const expected=secret&&'Bearer '+secret;if(typeof header!=='string'||!expected)return false;const a=Buffer.from(header),b=Buffer.from(expected);return a.length===b.length&&timingSafeEqual(a,b);};
 const remove=async(owner,id)=>store.mutate(QUEUE,empty(),q=>{q.jobs=q.jobs.filter(j=>j.ownerId!==owner||j.id!==id);});
 async function enqueue(owner,id,{start=true}={}){
  if(!owner?.id||typeof owner.id!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(owner.id)||!/^[-a-f0-9]{36}$/.test(id))throw fail('整理任务身份无效。',404);
  const job=await ingestion.view(owner,id);
  if(!runnable.has(job.state)){await remove(owner.id,id);return job;}
  await store.mutate(QUEUE,empty(),q=>{const old=q.jobs.find(j=>j.ownerId===owner.id&&j.id===id);if(old){old.nextAt=Math.min(old.nextAt,now());return;}if(q.jobs.length>=200)throw fail('当前整理任务较多，原文件已保留，请稍后继续。',429);q.jobs.push({ownerId:owner.id,id,nextAt:now(),readFailures:0});});
  if(start)tick();return job;
 }
 async function runSlice(){
  const token=randomUUID(),claimed=await store.mutate(QUEUE,empty(),q=>{if(q.lease?.until>now())return false;q.lease={token,until:now()+240000};return true;});if(!claimed)return;
  const started=now();let steps=0;
  try{
   while(!closed&&now()-started<sliceMs&&steps<maxSteps){
    const q=await store.read(QUEUE,empty());if(q.lease?.token!==token)return;const row=q.jobs.slice().sort((a,b)=>a.nextAt-b.nextAt)[0];if(!row)return;
    const delay=row.nextAt-now();if(delay>0){if(now()-started+delay>=sliceMs)return;await new Promise(r=>setTimeout(r,Math.min(delay,1500)));continue;}
    const owner={id:row.ownerId};let job;
    try{job=await ingestion.view(owner,row.id);if(runnable.has(job.state))job=await ingestion.advance(owner,row.id);}
    catch{try{job=await ingestion.view(owner,row.id);}catch{}}
    steps++;
    if(job&&!runnable.has(job.state)){await remove(row.ownerId,row.id);continue;}
    await store.mutate(QUEUE,empty(),current=>{if(current.lease?.token!==token)return;const target=current.jobs.find(j=>j.ownerId===row.ownerId&&j.id===row.id);if(!target)return;target.readFailures=job?0:Math.min(6,target.readFailures+1);target.nextAt=now()+(job?stepDelayMs:Math.min(60000,1000*2**target.readFailures));});
   }
  }finally{await store.mutate(QUEUE,empty(),q=>{if(q.lease?.token===token)q.lease=null;});}
 }
 async function continueLater(){
  if(closed)return;const q=await store.read(QUEUE,empty());if(!q.jobs.length)return;
  const delay=Math.max(0,Math.min(...q.jobs.map(j=>j.nextAt))-now());
  if(publicOrigin&&secret){
   // Longer backoffs are resumed by the durable, idle-aware database wake.
   if(delay>5000)return;if(delay)await new Promise(r=>setTimeout(r,delay));
   try{await fetcher(new URL('/api/internal/ingestion/wake',publicOrigin),{method:'POST',redirect:'error',headers:{Authorization:'Bearer '+secret,'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(10000)});}catch{}
  }else{timer=setTimeout(()=>tick(),Math.max(10,delay));timer.unref?.();}
 }
 function tick(){
  if(closed||active)return active;
  const work=Promise.resolve().then(runSlice).catch(()=>{}).finally(async()=>{active=null;await continueLater().catch(()=>{});});active=work;
  try{schedule(work);}catch{closed=true;}return work;
 }
 async function close(){closed=true;clearTimeout(timer);await active;}
 return {enqueue,tick,authorized,close};
}
