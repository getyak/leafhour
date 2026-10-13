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
const json=(res,status,body)=>{let payload=JSON.stringify(body);if(Buffer.byteLength(payload)>4000000){status=413;payload=JSON.stringify({error:'内容超过云端传输限制，请在本机阅读或导出较大的书房。原有资料仍保留。'});}res.statusCode=status;res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','private, no-store');res.end(payload);};
export function createHostedHandler({portalFactory=createPortal,storeFactory=createHostedStore,authFactory=createHostedAuth,env=process.env}={}){
let portalPromise;
return async function handler(req,res){
  try{
    const route=routeOf(req);
    // Legacy single-owner APIs never read the private archive on this public surface.
    if(!/^\/api\/(auth\/|library(?:\/|$)|agent\/)/.test(route))return json(res,404,{error:'请从书房选择一本书再开始阅读'});
    const origin=env.READER_PUBLIC_ORIGIN;
    if(!origin?.startsWith('https://'))return json(res,503,{error:'线上书房地址尚未配置'});
    if(!portalPromise){const store=storeFactory({env});portalPromise=portalFactory({dataDir:'hosted',publicOrigin:origin,allowLocal:false,dataStore:store,authService:authFactory({store,env}),hostedMcp:true}).catch(e=>{portalPromise=null;throw e;});}
    const portal=await portalPromise,url=new URL(req.url,origin);url.pathname=route;
    const handled=await portal.handle({req,res,url,send:(status,body)=>json(res,status,body)});
    if(!handled)json(res,404,{error:'找不到这个操作'});
  }catch(error){json(res,error.status||500,{error:error.status?error.message:'服务暂时无法完成操作，请重试'});}
}
}
export default createHostedHandler();
