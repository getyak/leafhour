import english from '../app/ui-catalogs/en.mjs';
import simplified from '../app/ui-catalogs/zh-Hans.mjs';
import traditional from '../app/ui-catalogs/zh-Hant.mjs';
import japanese from '../app/ui-catalogs/ja.mjs';
import {isUiLocale,isUiPreference,parseUiParam,browserUiLocale} from '../app/ui-locale-codec.mjs';
import {UI_HINT_COOKIE,parseUiLanguageHint,encodeUiLanguageHint,canonicalUiEntryPath,internalUiEntryPath} from '../app/ui-first-paint-codec.mjs';
import {UI_FIRST_PAINT_SCRIPT} from './ui-first-paint-script.mjs';

const catalogues=Object.freeze({en:english,'zh-Hans':simplified,'zh-Hant':traditional,ja:japanese});
const controls=/[\u0000-\u001f\u007f-\u009f]/;
const validOwner=value=>typeof value==='string'&&value.length>0&&value.length<=512&&!controls.test(value);
export const escapeUiHtml=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
export function firstPaintCatalogue(locale){return catalogues[isUiLocale(locale)?locale:'en'];}
function cookieValue(cookie,name){
 if(typeof cookie!=='string'||cookie.length>16384)return null;
 const values=cookie.split(';').map(part=>part.trim()).filter(part=>part.startsWith(name+'=')).map(part=>part.slice(name.length+1));
 if(values.length!==1)return null;
 try{return decodeURIComponent(values[0]);}catch{return null;}
}
export function firstPaintSessionToken(cookie){const value=cookieValue(cookie,'marginalia_session');return typeof value==='string'&&/^[A-Za-z0-9_-]{43}$/.test(value)?value:null;}
export function needsUiSessionHandoff({url,cookie='',secFetchSite}={}){
 let target;try{target=url instanceof URL?url:new URL(url||'/','https://leafhour.invalid');}catch{return false;}
 const canonical=canonicalUiEntryPath(target.pathname);
 return canonical!==null&&canonical===target.pathname&&secFetchSite==='cross-site'&&parseUiParam(target.search).status!=='valid'&&!firstPaintSessionToken(cookie);
}
export function sessionUiHandoffDocument(url,decisionFallback){
 const target=url instanceof URL?url:new URL(url||'/library','https://leafhour.invalid'),canonical=canonicalUiEntryPath(target.pathname)||'/library',href=internalUiEntryPath(canonical)+target.search+target.hash;
 const source='<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Leafhour</title></head><body><main id="ui-session-handoff" aria-busy="true"><svg width="48" height="48" viewBox="0 0 48 48" fill="none" stroke="currentColor" aria-hidden="true"><path d="M8 11h13c2 0 3 2 3 3v25c0-3-2-4-4-4H8V11Zm32 0H27c-2 0-3 2-3 3v25c0-3 2-4 4-4h12V11Z"/></svg><a href="'+escapeUiHtml(href)+'">↻</a></main></body></html>';
 return stampInitialUiDocument(source,decisionFallback).replace(/<html\b/,'<html data-ui-session-handoff="true"');
}

export function acceptedUiLanguage(header){
 if(typeof header!=='string'||header.length>8192)return 'en';
 const languages=header.split(',').map((item,index)=>{const [tag,...parameters]=item.trim().split(';');let quality=1;for(const parameter of parameters){const match=parameter.trim().match(/^q=(0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/);if(!match)return null;quality=Number(match[1]);}return {tag,quality,index};}).filter(row=>row&&row.quality>0).sort((a,b)=>b.quality-a.quality||a.index-b.index).map(row=>row.tag);
 return browserUiLocale(languages);
}
export function fallbackInitialUiLanguage({cookie='',acceptLanguage='',url}={}){
 const hint=parseUiLanguageHint(cookieValue(cookie,UI_HINT_COOKIE)),browserLocale=hint?.browserLocale||acceptedUiLanguage(acceptLanguage),deviceHint=hint?encodeUiLanguageHint(hint):'';
 const query=url?parseUiParam((url instanceof URL?url:new URL(url,'https://leafhour.invalid')).search):null;if(query?.status==='valid')return {locale:query.code,source:'page',preference:query.code,deviceHint};
 if(hint?.preference)return {locale:hint.preference==='system'?browserLocale:hint.preference,source:'device',preference:hint.preference,deviceHint};
 return {locale:browserLocale,source:'browser',preference:null,deviceHint};
}
const unavailable=()=>Object.assign(Error('Initial interface language could not be verified'),{status:503,code:'UI_INITIAL_UNAVAILABLE'});
function accountChoice(value){
 if(!value||typeof value!=='object'||Array.isArray(value))throw unavailable();
 const keys=Object.keys(value);if(keys.length!==3||keys.some(key=>!['revision','updatedAt','uiLocale'].includes(key))||!Number.isSafeInteger(value.revision)||value.revision<0||value.uiLocale!==null&&!isUiPreference(value.uiLocale))throw unavailable();
 if(value.revision===0){if(value.updatedAt!==null||value.uiLocale!==null)throw unavailable();}
 else if(typeof value.updatedAt!=='string'||value.updatedAt.length>64||!Number.isFinite(Date.parse(value.updatedAt)))throw unavailable();
 return value.uiLocale;
}
export async function selectInitialUiLanguage({url,cookie='',acceptLanguage='',getUser=async()=>null,getAccountPreference=async()=>({revision:0,updatedAt:null,uiLocale:null}),timeoutMs=5000}={}){
 const target=url instanceof URL?url:new URL(url||'/library','https://leafhour.invalid'),query=parseUiParam(target.search),fallback=fallbackInitialUiLanguage({cookie,acceptLanguage});
 if(query.status==='valid')return {locale:query.code,source:'page',preference:query.code,deviceHint:fallback.deviceHint};
 const token=firstPaintSessionToken(cookie);if(!token)return fallback;
 let timer;
 const read=async()=>{
  const user=await getUser(token);if(user===null)return fallback;if(!validOwner(user?.id))throw unavailable();
  const preference=accountChoice(await getAccountPreference(user));if(preference===null)return fallback;
  const current=await getUser(token);if(!validOwner(current?.id)||current.id!==user.id)throw unavailable();
  const hint=parseUiLanguageHint(cookieValue(cookie,UI_HINT_COOKIE)),browserLocale=hint?.browserLocale||acceptedUiLanguage(acceptLanguage);
  return {locale:preference==='system'?browserLocale:preference,source:'account',preference,ownerId:user.id,deviceHint:fallback.deviceHint};
 };
 try{return await Promise.race([read(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(unavailable()),Number.isFinite(timeoutMs)?Math.max(1,Math.min(10000,timeoutMs)):5000);})]);}
 catch{throw unavailable();}finally{clearTimeout(timer);}
}
function normalizeDecision(decision){
 const locale=isUiLocale(decision?.locale)?decision.locale:'en',source=['page','account','device','browser'].includes(decision?.source)?decision.source:'browser';
 const preference=source==='page'?locale:source==='browser'?null:isUiPreference(decision?.preference)?decision.preference:null;
 const result={locale,source,preference,deviceHint:parseUiLanguageHint(decision?.deviceHint)?decision.deviceHint:''};
 if(source==='account'&&validOwner(decision?.ownerId))result.ownerId=decision.ownerId;
 return result;
}
const attribute=(attributes,name)=>attributes.match(new RegExp('(?:^|\\s)'+name+'\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\')','i'))?.slice(1).find(value=>value!==undefined);
function setAttribute(attributes,name,value){const pattern=new RegExp('(?:^|\\s)'+name+'\\s*=\\s*(?:"[^"]*"|\'[^\']*\')','i'),encoded=' '+name+'="'+escapeUiHtml(value)+'"';return pattern.test(attributes)?attributes.replace(pattern,encoded):attributes+encoded;}
function ownedAttributes(attributes,catalogue,locale){
 let changed=false;
 for(const name of ['aria-label','title','placeholder']){const key=attribute(attributes,'data-ui-'+name);if(key&&Object.hasOwn(catalogue,key)&&!/{[A-Za-z0-9_]+}/.test(catalogue[key])){attributes=setAttribute(attributes,name,catalogue[key]);changed=true;}}
 return changed?setAttribute(attributes,'lang',locale):attributes;
}
// Only trusted, marked leaf UI is replaced. Script/style/source code and
// textarea values remain byte-for-byte data, including HTML-like strings.
export function localizeOwnedUiHtml(source,locale){
 const catalogue=firstPaintCatalogue(locale),protectedBlock=/(<(script|style|textarea|pre|code)\b(?:[^"'>]|"[^"]*"|'[^']*')*>[\s\S]*?<\/\2\s*>|<!--[\s\S]*?-->)/gi;
 return String(source).split(protectedBlock).map((part,index,parts)=>{
  // Capturing groups in split include the tag-name subgroup; discard it.
  if(index%3===2)return '';
  if(index%3===1){if(/^<textarea\b/i.test(part))return part.replace(/^<textarea\b((?:[^"'>]|"[^"]*"|'[^']*')*)>/i,(_,attributes)=>'<textarea'+ownedAttributes(attributes,catalogue,locale)+'>');return part;}
  return part.replace(/<([A-Za-z][A-Za-z0-9:-]*)\b((?:[^"'<>]|"[^"]*"|'[^']*')*)>([^<>]*)<\/\1\s*>/g,(_,tag,attributes,text)=>{const key=attribute(attributes,'data-ui');if(key&&Object.hasOwn(catalogue,key)&&!/{[A-Za-z0-9_]+}/.test(catalogue[key])){attributes=setAttribute(attributes,'lang',locale);text=escapeUiHtml(catalogue[key]);}return '<'+tag+attributes+'>'+text+'</'+tag+'>';}).replace(/<([A-Za-z][A-Za-z0-9:-]*)\b((?:[^"'<>]|"[^"]*"|'[^']*')*)>/g,(_,tag,attributes)=>'<'+tag+ownedAttributes(attributes,catalogue,locale)+'>');
 }).join('');
}
export function stampInitialUiDocument(source,decision){
 const value=normalizeDecision(decision);let html=String(source).replace(/<script\s+data-ui-first-paint(?:\s[^>]*)?>[\s\S]*?<\/script>/gi,'');
 const attributes=['data-ui-initial-locale','data-ui-initial-source','data-ui-initial-preference','data-ui-initial-owner','data-ui-device-hint'];
 html=html.replace(/<html\b([^>]*)>/i,(_,current)=>{let attrs=current;for(const name of attributes)attrs=attrs.replace(new RegExp('\\s'+name+'=(?:"[^"]*"|\'[^\']*\')','gi'),'');attrs=setAttribute(attrs,'lang',value.locale);attrs=setAttribute(attrs,'data-ui-initial-locale',value.locale);attrs=setAttribute(attrs,'data-ui-initial-source',value.source);attrs=setAttribute(attrs,'data-ui-initial-preference',value.preference||'');if(value.ownerId)attrs=setAttribute(attrs,'data-ui-initial-owner',value.ownerId);attrs=setAttribute(attrs,'data-ui-device-hint',value.deviceHint);return '<html'+attrs+'>';});
 const script='<script data-ui-first-paint>'+UI_FIRST_PAINT_SCRIPT+'</script>';
 return html.replace(/(<head\b[^>]*>)([\s\S]*?)(<\/head>)/i,(_,open,contents,close)=>{
  const charset=/<meta\s+charset\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)\s*\/?>/i.exec(contents),firstScript=contents.search(/<script\b/i);
  if(charset&&(firstScript<0||charset.index<firstScript)){const end=charset.index+charset[0].length;return open+contents.slice(0,end)+script+contents.slice(end)+close;}
  return open+'<meta charset="utf-8">'+script+contents+close;
 });
}
export function readerDocument(source,decision={locale:'en',source:'browser',preference:null}){return stampInitialUiDocument(localizeOwnedUiHtml(source,decision.locale),decision);}
export function initialRetryDocument(url,decision){
 const value=normalizeDecision(decision),catalogue=firstPaintCatalogue(value.locale),target=url instanceof URL?url:new URL(url||'/library','https://leafhour.invalid'),href=target.pathname+target.search;
 return '<!doctype html><html lang="'+value.locale+'"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>'+escapeUiHtml(catalogue['ui.locale.reload'])+' · Leafhour</title><link rel="stylesheet" href="/typography.css"><link rel="stylesheet" href="/portal.css"></head><body><main><h1>Leafhour</h1><p role="status">'+escapeUiHtml(catalogue['ui.generic.error'])+'</p><a data-ui-initial-retry href="'+escapeUiHtml(href)+'">'+escapeUiHtml(catalogue['ui.locale.reload'])+'</a></main></body></html>';
}
