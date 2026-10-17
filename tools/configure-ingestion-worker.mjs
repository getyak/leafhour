import {loadLocalEnvironment} from '../server/local-env.mjs';
import {ingestionWakeToken} from '../server/ingestion-runner.mjs';
const index=process.argv.indexOf('--env-directory'),env={...process.env};
await loadLocalEnvironment({directory:index>=0?process.argv[index+1]:process.cwd(),env});
const token=ingestionWakeToken(env),origin=env.READER_PUBLIC_ORIGIN;
if(!token||!origin?.startsWith('https://')||!env.SUPABASE_URL)throw Error('Configure the existing Supabase server key and public origin first.');
const secret=env.SUPABASE_SECRET_KEY,headers={apikey:secret,...(secret.startsWith('eyJ')?{Authorization:'Bearer '+secret}:{}),'Content-Type':'application/json'};
const response=await fetch(env.SUPABASE_URL.replace(/\/$/,'')+'/rest/v1/rpc/reader_configure_ingestion_wake',{method:'POST',headers,body:JSON.stringify({wake_origin:origin,derived_token:token}),signal:AbortSignal.timeout(20000)});
if(!response.ok){await response.arrayBuffer();throw Error('Background worker configuration failed (HTTP '+response.status+'). Apply deploy/ingestion-worker.sql first.');}
console.log(JSON.stringify({configured:await response.json()===true,origin}));
