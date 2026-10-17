import {gzipSync} from 'node:zlib';
import {waitUntil} from '@vercel/functions';
import {configurationSummary} from '../server/model-config.mjs';
import {createPortal} from '../server/portal.mjs';
import {createHostedStore} from '../deploy/hosted-store.mjs';
import {createHostedAuth} from '../deploy/hosted-auth.mjs';

export function routeOf(req){
  const value=req.query?.path;
  if(Array.isArray(value))return '/api/'+value.join('/');
  if(value)return '/api/'+value;
  const pathname=new URL(req.url||'/','https://reader.invalid').pathname;
  return pathname.startsWith('/api/')?pathname:'/api/'+pathname.replace(/^\/+/, '');
}
const json=(res,status,body)=>{let payload=Buffer.from(JSON.stringify(body));res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','private, no-store');if(payload.length>1000000){payload=gzipSync(payload);res.setHeader('Content-Encoding','gzip');}if(payload.length>4000000){status=413;payload=Buffer.from(JSON.stringify({error:'内容超过云端传输限制，请分章节导出。原有资料仍保留。'}));res.removeHeader?.('Content-Encoding');}res.statusCode=status;res.end(payload);};
export function createHostedHandler({portalFactory=createPortal,storeFactory=createHostedStore,authFactory=createHostedAuth,background=waitUntil,env=process.env}={}){
let portalPromise;
return async function handler(req,res){
  res.setHeader('X-Robots-Tag','noindex, nofollow, noarchive');
  try{
    const route=routeOf(req);
    // Legacy single-owner APIs never read the private archive on this public surface.
    if(route!=='/api/internal/ingestion/wake'&&!/^\/api\/(auth\/|library(?:\/|$)|account\/profile$|book-gifts\/|agent\/)/.test(route))return json(res,404,{error:'请从书房选择一本书再开始阅读'});
    const origin=env.READER_PUBLIC_ORIGIN;
    if(!origin?.startsWith('https://'))return json(res,503,{error:'线上书房地址尚未配置'});
    if(!portalPromise){console.info(configurationSummary({env,speechSupported:true}));const store=storeFactory({env}),additionalWebOrigins=(env.READER_ADDITIONAL_WEB_ORIGINS||'').split(',').map(value=>value.trim()).filter(Boolean);portalPromise=portalFactory({dataDir:'hosted',publicOrigin:origin,additionalWebOrigins,allowLocal:false,dataStore:store,authService:authFactory({store,env}),hostedMcp:true,schedule:background,env}).catch(e=>{portalPromise=null;throw e;});}
    const portal=await portalPromise,url=new URL(req.url,origin);url.pathname=route;
    const handled=await portal.handle({req,res,url,send:(status,body)=>json(res,status,body)});
    if(!handled)json(res,404,{error:'找不到这个操作'});
  }catch(error){const retryAfter=Number.isInteger(error.retryAfter)&&error.retryAfter>0?Math.min(3600,error.retryAfter):null;if(retryAfter)res.setHeader('Retry-After',String(retryAfter));json(res,error.status||500,{error:error.status?error.message:'服务暂时无法完成操作，请重试',...(retryAfter?{retryAfter}:{})});}
}
}
export default createHostedHandler();
