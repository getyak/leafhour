import path from 'node:path';
import {tmpdir} from 'node:os';
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createHarnessGenerator} from '../harness/generator.mjs';
const project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
function failure(error){
  const causes=[error,error?.cause,error?.cause?.cause].filter(Boolean),message=causes.map(e=>String(e.message||'')).join(' '),codes=new Set(['ERR_MODULE_NOT_FOUND','MODULE_NOT_FOUND','ENOENT','EROFS','EACCES','EPERM','ETIMEDOUT']);
  const code=causes.map(e=>e.code).find(code=>codes.has(code))||'OTHER';
  const reason=/Cannot find (?:package|module)|ERR_MODULE_NOT_FOUND/.test(message)?'missing-runtime-package':/host preparation|sandbox/i.test(message)?'sandbox-preparation':/GLIBC|undefined symbol|\.node.*(?:load|open)/i.test(message)?'native-runtime':/initialize|handshake|transport closed/i.test(message)?'runtime-initialization':/pricing|费用参照/i.test(message)?'pricing-reference':/budget|额度/i.test(message)?'generation-budget':code==='EROFS'?'read-only-filesystem':'runtime-failure';
  return {code,reason};
}
export function createReaderChatGenerator({env=process.env,makeGenerator=createHarnessGenerator,logger=diagnostic=>console.error(JSON.stringify(diagnostic))}={}){
  if(!env.DEEPSEEK_API_KEY)return null;
  const generate=makeGenerator({runRoot:env.VERCEL?path.join(tmpdir(),'marginalia-reading-chat'):undefined,timeoutMs:45000});
  const reported=new WeakSet();
  const phases=new Set(['record-question','quota','generation','verify-source','verify-version','save-answer','initialize','run','publish']);
  const reportFailure=(error,{phase}={})=>{
    if(error&&typeof error==='object'){if(reported.has(error))return;reported.add(error);}
    const stage=phases.has(error?.readerStage)?error.readerStage:phases.has(phase)?phase:'setup';
    const diagnostic={event:'reading-chat-runtime-failed',stage,...failure(error),hosted:!!env.VERCEL,platform:process.platform,arch:process.arch,nodeMajor:Number(process.versions.node.split('.')[0]),bundleManifest:existsSync(path.join(project,'.reader-runtime/manifest.json')),bundleClient:existsSync(path.join(project,'.reader-runtime/node_modules/@deepseek-ai/dsh-sdk-client/lib/index.js'))};
    try{logger(diagnostic);}catch{}
  };
  const wrapped=async job=>{try{return await generate(job);}catch(error){reportFailure(error);throw error;}};
  wrapped.reportFailure=reportFailure;return wrapped;
}
