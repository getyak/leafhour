import {open,lstat} from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
const MAX_FILE=16384,MAX_REPLY=65536;
const entry=fileURLToPath(new URL('../../server/mcp.mjs',import.meta.url));
export class DailyHostError extends Error{constructor(code,message){super(message);this.name='DailyHostError';this.code=code;}}
const fail=code=>new DailyHostError(code,{
 'private-file':'配置与提交文件必须是当前用户拥有的绝对路径、0600独立普通文件，且路径不含符号链接。',
 'private-json':'私有文件不是有效的 JSON 对象。',
 'host-config':'每日陪读配置不正确，请重新连接。',
 'host-tool':'宿主仅能调用每日陪读的连接、领取与完成接口。',
 'host-response':'未取得有效的每日陪读回执；未输出可能包含私密信息的错误详情。'
}[code]);
export function validateHostOrigin(value){
 let url;try{url=new URL(value);}catch{throw fail('host-config');}
 const local=url.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(url.hostname);
 if((url.protocol!=='https:'&&!local)||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw fail('host-config');
 return url.origin;
}
// Defend against accidental aliases and shared files. This is not an OS sandbox
// against another process running with the same UID.
export async function readPrivateHostJson(file){
 if(typeof file!=='string'||!path.isAbsolute(file))throw fail('private-file');
 let handle;
 try{
  const absolute=path.resolve(file);let cursor=path.parse(absolute).root;
  for(const part of absolute.slice(cursor.length).split(path.sep).filter(Boolean)){
   cursor=path.join(cursor,part);const row=await lstat(cursor);
   if(row.isSymbolicLink()||(cursor!==absolute&&!row.isDirectory()))throw fail('private-file');
  }
  const row=await lstat(absolute);
  if(!row.isFile()||row.nlink!==1||(row.mode&0o077)!==0||(typeof process.getuid==='function'&&row.uid!==process.getuid())||row.size>MAX_FILE)throw fail('private-file');
  handle=await open(absolute,constants.O_RDONLY|constants.O_NOFOLLOW);const current=await handle.stat();
  if(!current.isFile()||current.nlink!==1||current.dev!==row.dev||current.ino!==row.ino||(current.mode&0o077)!==0)throw fail('private-file');
  const buffer=Buffer.alloc(MAX_FILE+1);let length=0;
  while(length<buffer.length){const {bytesRead}=await handle.read(buffer,length,buffer.length-length,length);if(!bytesRead)break;length+=bytesRead;}
  if(length>MAX_FILE)throw fail('private-file');
  let data;try{data=JSON.parse(buffer.subarray(0,length).toString('utf8'));}catch{throw fail('private-json');}
  if(!data||typeof data!=='object'||Array.isArray(data))throw fail('private-json');return data;
 }catch(error){if(error instanceof DailyHostError)throw error;throw fail('private-file');}
 finally{await handle?.close();}
}
export async function callDailyMcp({config,toolName,args,serverEntry=entry,onChild=()=>{}}){
 if(!['reader_daily_connect','reader_daily_claim','reader_daily_finish'].includes(toolName))throw fail('host-tool');
 const serviceUrl=validateHostOrigin(config?.serviceUrl),token=config?.token;
 if(typeof token!=='string'||!token.length||token.length>4096||/[\r\n]/.test(token))throw fail('host-config');
 let serialized;try{serialized=JSON.stringify(args);}catch{throw fail('host-config');}
 if(!serialized||Buffer.byteLength(serialized)>MAX_FILE||serialized.includes(token))throw fail('host-config');
 const client=new Client({name:'leafhour-daily-host',version:'1.0.0'}),transport=new StdioClientTransport({command:process.execPath,args:[serverEntry],cwd:path.dirname(path.dirname(serverEntry)),env:{PATH:process.env.PATH||'',READER_SERVICE_URL:serviceUrl,READER_ALLOW_REMOTE:serviceUrl.startsWith('https:')?'true':'false',READER_AGENT_TOKEN:token},stderr:'pipe'});
 // Child diagnostics are consumed but never reflected or persisted: upstream
 // proxies and third-party SDK exceptions may contain credentials or source.
 transport.stderr?.on('data',()=>{});
 try{
  await client.connect(transport,{timeout:20000});onChild(transport.pid);
  const result=await client.callTool({name:toolName,arguments:args},undefined,{timeout:20000});
  const raw=JSON.stringify(result);
  if(result.isError||Buffer.byteLength(raw)>MAX_REPLY||raw.includes(token))throw fail('host-response');
  let data=result.structuredContent;
  if(!data){try{data=JSON.parse(result.content?.find(row=>row.type==='text')?.text);}catch{throw fail('host-response');}}
  if(!data||typeof data!=='object'||Array.isArray(data))throw fail('host-response');return data;
 }catch{throw fail('host-response');}
 finally{
  let clean=true;try{await client.close();}catch{clean=false;}
  try{await transport.close();}catch{clean=false;}
  if(!clean)throw fail('host-response');
 }
}
