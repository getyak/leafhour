import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {lookup} from 'node:dns/promises';
import https from 'node:https';
import {createHash,randomUUID,randomBytes,createCipheriv,createDecipheriv} from 'node:crypto';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {isPublicAddress} from './people-sources.mjs';

const fail=(message,status=400)=>Object.assign(Error(message),{status});
const hash=value=>createHash('sha256').update(value).digest('hex');
export function connectorURL(value){
 let url;try{url=new URL(value);}catch{throw fail('请输入完整的 HTTPS MCP 地址');}
 if(url.protocol!=='https:'||url.username||url.password||url.hash||url.search||url.port&&url.port!=='443'||url.href.length>2048)throw fail('请使用不含凭据或查询参数的 HTTPS MCP 地址');
 return url;
}
// Only the selected endpoint is reachable, with the validated DNS answer pinned
// to TLS. Ambient cookies, redirects and MCP-provided authorization URLs are not followed.
export function publicMcpFetch(endpoint,{resolve=lookup}={}){
 const expected=connectorURL(endpoint).href;
 return async(input,init={})=>{
  const url=connectorURL(typeof input==='string'||input instanceof URL?String(input):input.url);
  if(url.href!==expected)throw fail('MCP 服务器试图访问其他地址',403);
  const signal=AbortSignal.any([AbortSignal.timeout(20000),...(init.signal?[init.signal]:[])]);
  const rows=await Promise.race([resolve(url.hostname,{all:true,verbatim:true}),new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(fail('连接超时',504)),{once:true}))]);
  if(!rows.length||rows.some(row=>!isPublicAddress(row.address)))throw fail('MCP 地址必须指向公共网络',403);
  const headers=new Headers(init.headers);headers.delete('cookie');headers.delete('proxy-authorization');
  return new Promise((resolveResponse,reject)=>{
   const request=https.request(url,{method:init.method||'GET',headers:Object.fromEntries(headers),signal,agent:false,lookup:(_host,options,callback)=>options.all?callback(null,rows):callback(null,rows[0].address,rows[0].family)},response=>{
    if(response.statusCode>=300&&response.statusCode<400){response.destroy();reject(fail('请填写 MCP 的最终地址，连接不跟随跳转',502));return;}
    const resultHeaders=new Headers();for(const [key,value]of Object.entries(response.headers))if(value!==undefined)resultHeaders.set(key,Array.isArray(value)?value.join(', '):value);
    let size=0;
    const body=new ReadableStream({start(controller){response.on('data',chunk=>{size+=chunk.length;if(size>1024*1024){controller.error(fail('MCP 返回内容过大',413));response.destroy();return;}controller.enqueue(new Uint8Array(chunk));});response.on('end',()=>controller.close());response.on('error',error=>controller.error(error));},cancel(){response.destroy();request.destroy();}});
    resolveResponse(new Response([202,204,304].includes(response.statusCode)?null:body,{status:response.statusCode,headers:resultHeaders}));
   });request.on('error',reject);request.end(init.body||undefined);
  });
 };
}
export async function openMcpConnection({url,token='',fetchImpl=publicMcpFetch(url)}){
 const client=new Client({name:'Leafhour',version:'0.3.0'},{capabilities:{}});
 const transport=new StreamableHTTPClientTransport(connectorURL(url),{fetch:fetchImpl,requestInit:{headers:token?{Authorization:'Bearer '+token}:{}}});
 try{await client.connect(transport,{timeout:20000});return client;}catch(error){await client.close().catch(()=>{});throw fail(error.code===401||error.code===403?'鉴权失败，请检查访问令牌':'无法连接 MCP，请检查地址与鉴权方式',502);}
}
export function createMcpConnectors({store,dataDir,env=process.env,connect=openMcpConnection}){
 const active=new Map();
 const key=user=>{if(!user?.id)throw fail('请先登录',401);return 'mcp-connectors/'+hash(user.id);};
 let encryption;
 async function secretKey(){
  if(encryption)return encryption;
  const configured=env.LEAFHOUR_MCP_CREDENTIAL_KEY||env.SUPABASE_SECRET_KEY;
  if(configured)return encryption=createHash('sha256').update(configured).digest();
  if(env.VERCEL==='1')throw fail('此实例尚未配置 MCP 凭据存储',503);
  await mkdir(dataDir,{recursive:true,mode:0o700});const file=path.join(dataDir,'credential-key');
  try{encryption=await readFile(file);}catch(error){if(error.code!=='ENOENT')throw error;try{await writeFile(file,randomBytes(32),{mode:0o600,flag:'wx'});}catch(error){if(error.code!=='EEXIST')throw error;}encryption=await readFile(file);}
  if(encryption.length!==32)throw fail('MCP 凭据存储不可用',503);return encryption;
 }
 async function seal(token){if(!token)return null;const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',await secretKey(),iv);return Buffer.concat([iv,cipher.update(token,'utf8'),cipher.final(),cipher.getAuthTag()]).toString('base64');}
 async function unseal(value){if(!value)return '';const bytes=Buffer.from(value,'base64'),cipher=createDecipheriv('aes-256-gcm',await secretKey(),bytes.subarray(0,12));cipher.setAuthTag(bytes.subarray(-16));return Buffer.concat([cipher.update(bytes.subarray(12,-16)),cipher.final()]).toString('utf8');}
 const visible=({id,name,url,createdAt,credential})=>({id,name,url,createdAt,authenticated:!!credential});
 async function list(user){return (await store.read(key(user),{connections:[]})).connections.map(visible);}
 async function selected(user,id){const row=(await store.read(key(user),{connections:[]})).connections.find(row=>row.id===id);if(!row)throw fail('连接已移除',404);return row;}
 async function tools(client){let cursor;const rows=[];for(let page=0;page<10;page++){const result=await client.listTools(cursor?{cursor}:undefined,{timeout:20000});rows.push(...result.tools);if(rows.length>500)throw fail('工具数量超过 500',413);cursor=result.nextCursor;if(!cursor)return rows;}throw fail('工具分页过多',413);}
 async function use(user,id,work){
  const operation={cancelled:false,dispatched:false},operationKey=key(user)+'/'+id;
  const pending=active.get(operationKey)||new Set();pending.add(operation);active.set(operationKey,pending);
  const check=async()=>{await selected(user,id);if(operation.cancelled)throw fail('连接已移除',404);};let client;
  try{const row=await selected(user,id);client=await connect({url:row.url,token:await unseal(row.credential)});await check();return await work(client,check,operation);}
  finally{pending.delete(operation);if(!pending.size)active.delete(operationKey);await client?.close().catch(()=>{});}
 }
 return {list,
  async add(user,input){key(user);if(typeof input?.name!=='string'||!input.name.trim()||input.name.length>80||/[\x00-\x1f\x7f]/.test(input.name)||typeof(input.token??'')!=='string'||(input.token||'').length>8192||/[\r\n]/.test(input.token||''))throw fail('请填写名称和有效令牌');const url=connectorURL(input.url).href;
   if((await list(user)).length>=10)throw fail('最多保存 10 个连接，请先移除不再使用的连接',413);
   const client=await connect({url,token:input.token||''});let available;try{available=await tools(client);}finally{await client.close().catch(()=>{});}
   const row={id:randomUUID(),name:input.name.trim(),url,credential:await seal(input.token||''),createdAt:new Date().toISOString()};
   await store.mutate(key(user),{connections:[]},data=>{if(data.connections.length>=10)throw fail('连接数量已达上限',413);data.connections.push(row);});return {...visible(row),tools:available};
  },
  async remove(user,id){for(const operation of active.get(key(user)+'/'+id)||[])operation.cancelled=true;const pendingCalls=await store.mutate(key(user),{connections:[]},data=>{const count=(data.calls||[]).filter(call=>call.connectionId===id).length;data.connections=data.connections.filter(row=>row.id!==id);data.calls=(data.calls||[]).filter(call=>call.connectionId!==id);return count;});return {removed:true,pendingCalls};},
  async tools(user,id){return {tools:await use(user,id,async(client,check)=>{const value=await tools(client);await check();return value;})};},
  async call(user,id,input){
   if(input?.confirm!==true||typeof input.name!=='string'||!input.arguments||typeof input.arguments!=='object'||Array.isArray(input.arguments)||JSON.stringify(input.arguments).length>32768)throw fail('请确认工具名称与参数后调用');
   return use(user,id,async(client,check,operation)=>{
    const available=await tools(client);if(!available.some(tool=>tool.name===input.name))throw fail('找不到这个工具',404);await check();
    const requestId=randomUUID();
    // This CAS contains no network side effect. A stale read cannot grant a
    // dispatch after another hosted instance acknowledged removal. Once the
    // permit commits, removal explicitly reports this call as already in flight.
    await store.mutate(key(user),{connections:[]},data=>{
     if(!data.connections.some(row=>row.id===id))throw fail('连接已移除',404);
     data.calls??=[];if(data.calls.length>=100)throw fail('仍有工具调用待核对，请稍后再试',429);
     if(!data.calls.some(call=>call.id===requestId))data.calls.push({id:requestId,connectionId:id});
    });
    try{
     if(operation.cancelled)throw fail('连接已移除',404);
     operation.dispatched=true;
     try{return await client.callTool({name:input.name,arguments:input.arguments},undefined,{timeout:20000});}
     catch{throw fail('工具调用已发出，结果尚未确认。请先在对方服务核对，再决定是否重试。',502);}
    }finally{
     // Losing a cleanup write must never hide a known remote result or suggest
     // retrying an already completed write. Removal can clear this runtime fence.
     await store.mutate(key(user),{connections:[]},data=>{data.calls=(data.calls||[]).filter(call=>call.id!==requestId);}).catch(()=>{});
    }
   });
  }
 };
}
