// GET-192 pure UI-locale codec. This module is data and pure functions only:
// no document, storage, loader, top-level await or mutable runtime state. The
// browser runtime, the server safe-return/auth policy and the URL owners all
// share these exact validation rules so exactly one validated `ui` value can
// travel through owned links without broadening any other parameter.
export const UI_LOCALES=Object.freeze(['en','zh-Hans','zh-Hant','ja']);
export const DEFAULT_UI_LOCALE='en';
export const UI_PARAM='ui';
export const UI_PREFERENCE_KEY='leafhour.ui.locale.v1';

// Owned URL/device/API values use the exact four canonical codes. Only the
// bounded navigator mapping below accepts BCP-47 forms.
export function isUiLocale(value){
  return typeof value==='string'&&UI_LOCALES.includes(value);
}

// Bounded navigator BCP-47 mapping: only the listed language tags map to a
// canonical code. Arbitrary ja-/en- suffixes, unknown tags and whitespace are
// unsupported here as well as in owned URLs.
const NAVIGATOR_LOCALE_ALIASES=/* @__PURE__ */Object.freeze({
  en:'en', 'en-us':'en', 'en-gb':'en', 'en-au':'en', 'en-ca':'en',
  zh:'zh-Hans', 'zh-cn':'zh-Hans', 'zh-sg':'zh-Hans', 'zh-hans':'zh-Hans',
  'zh-tw':'zh-Hant', 'zh-hk':'zh-Hant', 'zh-mo':'zh-Hant', 'zh-hant':'zh-Hant',
  ja:'ja', 'ja-jp':'ja'
});
export function normalizeUiLocale(value){
  if(typeof value!=='string')return null;
  return NAVIGATOR_LOCALE_ALIASES[value.trim().toLowerCase()]||null;
}

// Browser-language fallback: the first language that maps to a supported code.
export function browserUiLocale(languages){
  if(typeof languages==='string')languages=[languages];
  if(!Array.isArray(languages))return DEFAULT_UI_LOCALE;
  for(const candidate of languages){
    const code=normalizeUiLocale(candidate);
    if(code)return code;
  }
  return DEFAULT_UI_LOCALE;
}

// One `ui` query value, validated strictly against the exact canonical codes.
// Duplicate, conflicting or unsupported values are rejected outright and can
// never broaden a link or an auth next target.
export function parseUiParam(search){
  let params;
  try{params=typeof search==='string'?new URLSearchParams(search):search&&typeof search.entries==='function'?search:null;}catch{return {status:'invalid',code:null};}
  if(!params)return {status:'invalid',code:null};
  const all=[];
  try{for(const [key,value] of params.entries())if(key===UI_PARAM)all.push(value);}catch{return {status:'invalid',code:null};}
  if(!all.length)return {status:'absent',code:null};
  const codes=all.map(value=>isUiLocale(value)?value:null);
  if(all.length>1){
    const unique=new Set(codes.map(code=>code||'\u0000'));
    return {status:unique.size>1?'conflict':'duplicate',code:null};
  }
  if(!codes[0])return {status:'unsupported',code:null};
  return {status:'valid',code:codes[0]};
}

// Rewrites ONLY the owned ui key inside a same-origin path URL. Everything else
// (pathname, unrelated query order and values, hash, book/passage/version/layer)
// is preserved verbatim.
export function mergeOwnedUi(search,code){
  if(!isUiLocale(code))throw Object.assign(Error('Invalid UI locale for owned link'),{code:'UI_LOCALE_INVALID'});
  const source=typeof search==='string'?search:'';
  const params=new URLSearchParams(source.startsWith('?')?source.slice(1):source);
  params.delete(UI_PARAM);
  params.append(UI_PARAM,code);
  return params.toString();
}

export function withUiParam(url,code){
  if(!isUiLocale(code))throw Object.assign(Error('Invalid UI locale for owned link'),{code:'UI_LOCALE_INVALID'});
  const raw=String(url||'');
  const hashAt=raw.indexOf('#');
  const hash=hashAt<0?'':raw.slice(hashAt);
  const withoutHash=hashAt<0?raw:raw.slice(0,hashAt);
  const queryAt=withoutHash.indexOf('?');
  const pathname=queryAt<0?withoutHash:withoutHash.slice(0,queryAt);
  const search=queryAt<0?'':withoutHash.slice(queryAt+1);
  return pathname+'?'+mergeOwnedUi(search,code)+hash;
}

// Reads the single validated ui from an owned URL. Returns the effective code
// decision data, never a fallback opinion.
export function readUiParam(url){
  const raw=String(url||'');
  const hashAt=raw.indexOf('#');
  const withoutHash=hashAt<0?raw:raw.slice(0,hashAt);
  const queryAt=withoutHash.indexOf('?');
  return parseUiParam(queryAt<0?'':withoutHash.slice(queryAt+1));
}

export function validateUiParam(code){
  return isUiLocale(code)?code:null;
}

// Explicit route classification. Authored home and support routes (including
// the English aliases and language-prefixed guides) are path-authoritative:
// their route language wins over any conflicting ui query. Every other path is
// a canonical surface (library/read/gift/evals/source-review/...) that resolves
// ui by query -> saved preference -> navigator with no implicit persistence.
export const UI_AUTHORED_ROUTES=/* @__PURE__ */Object.freeze({
  '/en':'en', '/zh-hans':'zh-Hans', '/zh-hant':'zh-Hant', '/ja':'ja',
  '/mcp':'en', '/en/mcp':'en', '/zh-hans/mcp':'zh-Hans', '/zh-hant/mcp':'zh-Hant', '/ja/mcp':'ja',
  '/pricing':'en', '/en/pricing':'en', '/zh-hans/pricing':'zh-Hans', '/zh-hant/pricing':'zh-Hant', '/ja/pricing':'ja',
  '/terms':'en', '/en/terms':'en', '/zh-hans/terms':'zh-Hans', '/zh-hant/terms':'zh-Hant', '/ja/terms':'ja',
  '/refunds':'en', '/en/refunds':'en', '/zh-hans/refunds':'zh-Hans', '/zh-hant/refunds':'zh-Hant', '/ja/refunds':'ja',
  '/privacy':'en', '/en/privacy':'en', '/zh-hans/privacy':'zh-Hans', '/zh-hant/privacy':'zh-Hant', '/ja/privacy':'ja'
});
const UI_HOME_ROUTES=/* @__PURE__ */Object.freeze(['/en', '/zh-hans', '/zh-hant', '/ja']);
export function classifyUiRoute(pathname){
  const path=String(pathname||'/')||'/';
  const code=Object.hasOwn(UI_AUTHORED_ROUTES,path)?UI_AUTHORED_ROUTES[path]:null;
  if(!code)return {kind:'canonical',code:null};
  return {kind:UI_HOME_ROUTES.includes(path)?'home':'support',code};
}

// The owned canonical navigation context captured at request start and
// rechecked immediately before the first commit side effect: a pathname, book
// or source-context transition makes a pending request stale.
export function uiNavigationContext(href){
  let url;
  try{url=new URL(String(href||''),'https://leafhour.invalid');}catch{return {pathname:'/',book:'',source:''};}
  return {pathname:url.pathname,book:url.searchParams.get('book')||'',source:url.searchParams.get('source')||''};
}
export function sameUiNavigationContext(a,b){
  return !!a&&!!b&&a.pathname===b.pathname&&a.book===b.book&&a.source===b.source;
}

// Authored prose follows its pathname, even when device persistence is denied.
// Only these owned documents have localized authored routes.
export function uiAuthoredPath(route,code){
  if(!isUiLocale(code)||!['/','/privacy','/mcp','/pricing','/terms','/refunds'].includes(route))throw Error('Invalid authored UI destination');
  const prefix={en:'','zh-Hans':'/zh-hans','zh-Hant':'/zh-hant',ja:'/ja'}[code];
  return route==='/'?prefix||'/en':prefix+route;
}
