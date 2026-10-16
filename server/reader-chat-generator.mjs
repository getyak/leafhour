import path from 'node:path';
import {tmpdir} from 'node:os';
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createChatGenerator} from '../harness/chat-generator.mjs';
const project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
function failure(error){
  const causes=[error,error?.cause,error?.cause?.cause].filter(Boolean),message=causes.map(e=>String(e.message||'')).join(' '),codes=['ERR_MODULE_NOT_FOUND','MODULE_NOT_FOUND','ERR_DLOPEN_FAILED','ERR_INVALID_ARG_TYPE','ENOENT','EROFS','EACCES','EPERM','ETIMEDOUT'];
  const code=causes.map(e=>e.code).find(code=>codes.includes(code))||codes.find(code=>new RegExp('\\b'+code+'\\b').test(message))||'OTHER';
  const patterns=[['host-preparation',/host preparation/i],['native-binding',/native binding|prebuilt binary|ERR_DLOPEN_FAILED/i],['native-probe',/Unsupported\/no-getter|this->field accessor|PrincipalRealm/i],['node-internals',/node-addon-(?:require-builtin|native-custom-loader)|unsupported Node module loader|internal\/modules/i],['shared-library',/GLIBC|undefined symbol|shared (?:object|libraries)|dlopen/i],['module-resolution',/profile resolution|registerHooks|resolveSync/i],['read-only-filesystem',/\bEROFS\b|read-only file system/i],['missing-file',/\bENOENT\b/],['missing-package',/Cannot find (?:package|module)|ERR_MODULE_NOT_FOUND/],['permission',/\b(?:EACCES|EPERM)\b/],['invalid-argument',/ERR_INVALID_ARG_TYPE|must be of type/],['sandbox-host',/bwrap|bubblewrap|landlock/i]];
  const signals=patterns.filter(([,pattern])=>pattern.test(message)).map(([name])=>name);
  const reason=signals.includes('missing-package')?'missing-runtime-package':signals.some(s=>['native-binding','native-probe','node-internals','shared-library'].includes(s))?'native-runtime':signals.includes('sandbox-host')?'sandbox-preparation':signals.includes('host-preparation')?'host-preparation':signals.includes('read-only-filesystem')?'read-only-filesystem':/initialize|handshake|transport closed/i.test(message)?'runtime-initialization':/pricing|费用参照/i.test(message)?'pricing-reference':/budget|额度/i.test(message)?'generation-budget':'runtime-failure';
  return {code,reason,signals};
}
export function createReaderChatGenerator({env=process.env,makeGenerator=createChatGenerator,logger=diagnostic=>console.error(JSON.stringify(diagnostic))}={}){
  if(!env.DEEPSEEK_API_KEY)return null;
  const generate=makeGenerator({runRoot:env.VERCEL?path.join(tmpdir(),'marginalia-reading-chat'):undefined,timeoutMs:75000,env});
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
