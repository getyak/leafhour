import {LOCAL_EXECUTION_TYPES} from '../../packages/contracts/execution.mjs';
import http from 'node:http';
import path from 'node:path';
import {readFile,mkdir} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {createPortal} from '../../server/portal.mjs';
import {createHostedStore} from '../../deploy/hosted-store.mjs';
import {createHostedAuth} from '../../deploy/hosted-auth.mjs';
import {createAccountUiPreferences} from '../../server/account-ui-preferences.mjs';
import {createUiEntryHandler} from '../../api/ui-entry.js';
import {canonicalUiEntryPath} from '../../app/ui-first-paint-codec.mjs';
import {contentSecurityPolicy} from '../../server/content-security.mjs';
import {billingErrorDetails} from '../../server/billing-routes.mjs';
import {authMessageId} from '../../app/auth-errors.mjs';
import {audioFailureCode} from '../../app/audio-errors.mjs';
import {assertModuleEnvironment,executorToken,runtimeVersion,configuredCapabilities} from '../../packages/contracts/runtime-config.mjs';
import {createDispatchLedger} from '../../packages/adapters/dispatch-ledger.mjs';
import {createExecutionGateway,withExecutionAuthority} from './execution-gateway.mjs';
import {createRemoteProviders} from './remote-providers.mjs';
const cookie=req=>(req.headers.cookie||'').split(';').map(v=>v.trim()).find(v=>v.startsWith('marginalia_session='))?.slice('marginalia_session='.length);
export async function startApi({env=process.env,store,auth,preferences,readTemplate,portalFactory=createPortal}={}){
 assertModuleEnvironment('api',env);const dataDir=env.LEAFHOUR_DATA_DIR;if(!dataDir)throw Error('LEAFHOUR_DATA_DIR required');await mkdir(dataDir,{recursive:true,mode:0o700});
 const version=await runtimeVersion('api',env),dataStore=store||createHostedStore({env}),authService=auth||createHostedAuth({store:dataStore,env}),token=await executorToken(env);
 const gateway=await createExecutionGateway({store:dataStore,socketPath:env.LEAFHOUR_INTERNAL_SOCKET,token,appendDispatch:await createDispatchLedger({env})});
 let executionBlocked=null;if(configuredCapabilities(env).length){if(configuredCapabilities(env).some(type=>!LOCAL_EXECUTION_TYPES.includes(type))&&!env.LEAFHOUR_DISPATCH_LEDGER_URL&&env.LEAFHOUR_ALLOW_LOCAL_LEDGER!=='1')executionBlocked='dispatch_ledger_unconfigured';try{if(!dataStore.executionReceipt)throw Error();await dataStore.executionReceipt('00000000-0000-4000-8000-000000000000');}catch{executionBlocked='domain_receipt_unavailable';}}
 const providerEnv=executionBlocked?{...env,LEAFHOUR_AGENT_CAPABILITIES:''}:env;
 let portal;try{portal=await portalFactory({dataDir,publicOrigin:env.READER_PUBLIC_ORIGIN,additionalWebOrigins:(env.READER_ADDITIONAL_WEB_ORIGINS||'').split(',').filter(Boolean),allowLocal:false,dataStore,authService,hostedMcp:true,env,schedule:work=>{Promise.resolve(work).catch(()=>{});},...createRemoteProviders({gateway,env:providerEnv}),compiledWeb:true,webDir:env.LEAFHOUR_WEB_ROOT});}catch(error){await gateway.close();throw error;}
 const entry=createUiEntryHandler({env,storeFactory:()=>dataStore,authFactory:()=>authService,preferencesFactory:()=>preferences||portal.uiPreferences||createAccountUiPreferences({dataDir,dataStore}),readTemplate:readTemplate|| (surface=>readFile(path.join(env.LEAFHOUR_TEMPLATE_ROOT||path.join('build','modules','web','templates'),surface==='read'?'read.html':'home.html'),'utf8'))});
 let closing=false;const server=http.createServer(async(req,res)=>{
  const send=(status,value,type='application/json')=>{if(res.writableEnded||res.destroyed)return;res.writeHead(status,{'Content-Type':type+'; charset=utf-8','Cache-Control':'private, no-store'});res.end(req.method==='HEAD'?undefined:type==='application/json'?JSON.stringify(value):value);};
  try{
   const url=new URL(req.url,'http://127.0.0.1'),port=server.address()?.port,allowed=new Set(['127.0.0.1:'+port,'localhost:'+port]);if(env.READER_PUBLIC_ORIGIN)allowed.add(new URL(env.READER_PUBLIC_ORIGIN).host);for(const origin of (env.READER_ADDITIONAL_WEB_ORIGINS||'').split(',').filter(Boolean))allowed.add(new URL(origin).host);if(!allowed.has(req.headers.host))return send(403,{error:'当前地址未授权'});
   res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','same-origin');res.setHeader('Content-Security-Policy',contentSecurityPolicy(url.pathname,env));
   if(['/healthz','/version'].includes(url.pathname)&&['GET','HEAD'].includes(req.method))return send(200,url.pathname==='/version'?version:{...version,readable:!closing,execution:{...await gateway.control(),blocked:executionBlocked,configuredCapabilities:configuredCapabilities(env)}});
   if(closing)return send(503,{error:'服务正在更新，请稍后重试'});
   if(canonicalUiEntryPath(url.pathname)||['/api/ui-entry','/api/ui-entry.js'].includes(url.pathname))return entry(req,res);
   if(url.pathname.startsWith('/internal/'))return send(404,{error:'找不到这个操作'});
   const user=await authService.userFor(cookie(req));
   const jobRoute=url.pathname.match(/^\/api\/jobs\/([a-f0-9-]{36})(?:\/(events|cancel))?$/);
   if(jobRoute){if(!user?.id)return send(401,{error:'请先进入自己的书房'});if(req.headers['x-reader-owner']&&req.headers['x-reader-owner']!==user.id)return send(409,{error:'账户已切换，请重新进入书房'});const [,id,action]=jobRoute;if(req.method==='GET'&&!action)return send(200,await gateway.queue.view(id,user.id));if(req.method==='GET'&&action==='events'){const after=Number(url.searchParams.get('after')||0);if(!Number.isSafeInteger(after)||after<0)return send(400,{error:'事件位置无效'});return send(200,{events:await gateway.queue.events(id,user.id,after)});}if(req.method==='POST'&&action==='cancel'){if(![env.READER_PUBLIC_ORIGIN,...(env.READER_ADDITIONAL_WEB_ORIGINS||'').split(',')].includes(req.headers.origin))return send(403,{error:'请求来源未授权'});return send(200,await gateway.queue.cancel(id,user.id));}return send(405,{error:'不支持这个请求'});}
   const authority={ownerId:user?.id,operationId:req.headers['x-leafhour-operation'],authorize:async scope=>{const current=await authService.userFor(cookie(req));if(!current?.id||current.id!==user?.id)return false;if(scope?.bookId&&!scope.localDevice&&portal.library){try{const book=await portal.library.getBook(current,scope.bookId);if(scope.contentVersion&&book.contentVersion!==scope.contentVersion)return false;}catch{return false;}}return true;}};
   const handled=await withExecutionAuthority(authority,()=>portal.handle({req,res,url,send}));if(!handled)send(404,{error:'找不到这个操作'});
  }catch(error){send(error.status||500,{error:error.status?error.message:'服务暂时无法完成操作，请重试',...billingErrorDetails(error),...(error.status&&authMessageId(error.messageId)?{messageId:error.messageId}:{}),...(audioFailureCode(error.status,error.code)?{code:error.code}:{})});}
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(Number(env.LEAFHOUR_API_PORT||18331),'127.0.0.1',resolve);});
 return {server,gateway,portal,async close(){if(closing)return;closing=true;await gateway.control(true);const stopped=new Promise(resolve=>server.close(resolve));await gateway.close();await portal.chat?.close?.();await portal.ingestionRunner?.close?.();await stopped;}};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){const service=await startApi();let stopping=false;const stop=async()=>{if(stopping)return;stopping=true;await service.close();};process.once('SIGTERM',stop);process.once('SIGINT',stop);}
