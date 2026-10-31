import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHostedStore} from '../deploy/hosted-store.mjs';
import {createHostedAuth} from '../deploy/hosted-auth.mjs';
import {createAccountUiPreferences} from '../server/account-ui-preferences.mjs';
import {portalDocument} from '../server/portal-document.mjs';
import {canonicalUiEntryPath} from '../app/ui-first-paint-codec.mjs';
import {contentSecurityPolicy} from '../server/content-security.mjs';
import {selectInitialUiLanguage,fallbackInitialUiLanguage,readerDocument,initialRetryDocument,needsUiSessionHandoff,sessionUiHandoffDocument} from '../server/ui-first-paint.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const surfaces=Object.freeze({home:'/',library:'/library',read:'/read'}),marker='__leafhour_surface';
export function uiEntryTarget(req,origin='https://leafhour.invalid'){
 const url=new URL(req.url||'/',origin),values=url.searchParams.getAll(marker),framework=req.query?.[marker],canonical=canonicalUiEntryPath(url.pathname);
 if(values.length>1||Array.isArray(framework)||framework!==undefined&&values.length===1&&framework!==values[0])throw Object.assign(Error('Ambiguous UI entry'),{status:400});
 const pathSurface=Object.entries(surfaces).find(([,pathname])=>pathname===canonical)?.[0],pathRole=pathSurface?(url.pathname===canonical?'':'internal-')+pathSurface:null;
 if(!pathRole&&!['/api/ui-entry','/api/ui-entry.js'].includes(url.pathname))throw Object.assign(Error('Unknown UI entry'),{status:400});
 const role=values[0]??framework??pathRole,internal=typeof role==='string'&&role.startsWith('internal-'),value=internal?role.slice('internal-'.length):role;
 if(!Object.hasOwn(surfaces,value)||pathRole&&role!==pathRole)throw Object.assign(Error('Unknown UI entry'),{status:400});
 url.pathname=surfaces[value];const parts=url.search.slice(1).split('&').filter(part=>{try{return decodeURIComponent(part.split('=',1)[0].replace(/\+/g,' '))!==marker;}catch{return true;}});url.search=parts.filter(Boolean).length?'?'+parts.join('&'):'';return {surface:value,url,internal};
}
export function createUiEntryHandler({env=process.env,storeFactory=createHostedStore,authFactory=createHostedAuth,preferencesFactory=createAccountUiPreferences,readTemplate=surface=>readFile(path.join(root,surface==='read'?'.ui-entry/read.html':'app/home.html'),'utf8'),timeoutMs=5000}={}){
 let services;
 const current=()=>{if(!services){const store=storeFactory({env});services={auth:authFactory({store,env}),preferences:preferencesFactory({dataDir:'hosted/library',dataStore:store})};}return services;};
 return async function handler(req,res){
  let origin='https://leafhour.invalid';try{const configured=new URL(env.READER_PUBLIC_ORIGIN);if(configured.protocol==='https:')origin=configured.origin;}catch{}let target;
  res.setHeader('Cache-Control','private, no-store');res.setHeader('Vary','Cookie, Accept-Language, Sec-Fetch-Site');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Content-Type','text/html; charset=utf-8');
  const send=(status,html)=>{res.statusCode=status;res.setHeader('Content-Length',Buffer.byteLength(html));res.end(req.method==='HEAD'?undefined:html);};
  try{
   target=uiEntryTarget(req,origin);if(target.surface!=='home'||target.internal)res.setHeader('X-Robots-Tag','noindex, nofollow, noarchive');res.setHeader('Content-Security-Policy',contentSecurityPolicy(target.url.pathname,env));
   if(!['GET','HEAD'].includes(req.method)){res.setHeader('Allow','GET, HEAD');return send(405,initialRetryDocument(target.url,fallbackInitialUiLanguage({url:target?.url,cookie:req.headers.cookie,acceptLanguage:req.headers['accept-language']})));}
   if(!target.internal&&needsUiSessionHandoff({url:target.url,cookie:req.headers.cookie,secFetchSite:req.headers['sec-fetch-site']})){res.setHeader('X-Robots-Tag','noindex, nofollow, noarchive');return send(200,sessionUiHandoffDocument(target.url,fallbackInitialUiLanguage({url:target.url,cookie:req.headers.cookie,acceptLanguage:req.headers['accept-language']})));}
   const decision=await selectInitialUiLanguage({url:target.url,cookie:req.headers.cookie,acceptLanguage:req.headers['accept-language'],getUser:token=>current().auth.userFor(token),getAccountPreference:user=>current().preferences.get(user),timeoutMs});
   const source=await readTemplate(target.surface);return send(200,target.surface==='read'?readerDocument(source,decision):portalDocument(source,target.url.pathname,decision));
  }catch(error){
   const url=target?.url||new URL('/library',origin),fallback=fallbackInitialUiLanguage({url:target?.url,cookie:req.headers.cookie,acceptLanguage:req.headers['accept-language']});
   res.setHeader('X-Robots-Tag','noindex, nofollow, noarchive');res.setHeader('Content-Security-Policy',contentSecurityPolicy(url.pathname,env));if(error.status!==400)res.setHeader('Retry-After','5');return send(error.status===400?400:503,initialRetryDocument(url,fallback));
  }
 };
}
export default createUiEntryHandler();
