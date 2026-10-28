import {UI_LOCALES,UI_PREFERENCES,DEFAULT_UI_LOCALE,UI_PARAM,UI_PREFERENCE_KEY,UI_SESSION_PREFERENCE_KEY,isUiLocale,isUiPreference,normalizeUiLocale,browserUiLocale,parseUiParam} from './ui-locale-codec.mjs';
import {UI_HINT_COOKIE,UI_ENTRY_PATHS,canonicalUiEntryPath,internalUiEntryPath,encodeUiLanguageHint,parseUiLanguageHint,readInitialUiDecision} from './ui-first-paint-codec.mjs';

export const UI_FIRST_PAINT_COPY=Object.freeze({
 en:{failed:'The selected language could not load.',retry:'Reload',back:'Reading room'},
 'zh-Hans':{failed:'所选语言暂时无法加载。',retry:'重新载入',back:'返回书房'},
 'zh-Hant':{failed:'所選語言暫時無法載入。',retry:'重新載入',back:'返回書房'},
 ja:{failed:'選択した言語を読み込めませんでした。',retry:'再読み込み',back:'書斎へ戻る'}
});
function readHintCookie(document){
 try{const rows=String(document.cookie||'').split(';').map(row=>row.trim()).filter(row=>row.startsWith(UI_HINT_COOKIE+'='));return rows.length===1?parseUiLanguageHint(rows[0].slice(UI_HINT_COOKIE.length+1)):null;}catch{return null;}
}
export function mirrorUiLanguageHint({document=globalThis.document,location=globalThis.location,storage,languages}={}){
 if(!document)return {hint:null,preference:null,browserLocale:'en',written:false};
 const previous=readHintCookie(document)||parseUiLanguageHint(readInitialUiDecision(document)?.deviceHint);
 let preference=null;
 try{const value=(storage===undefined?globalThis.localStorage:storage)?.getItem?.(UI_PREFERENCE_KEY);preference=isUiPreference(value)?value:null;}catch{preference=previous?.preference||null;}
 const browserLocale=browserUiLocale(languages??(globalThis.navigator?.languages?.length?globalThis.navigator.languages:[globalThis.navigator?.language].filter(Boolean)));
 const hint=encodeUiLanguageHint({preference,browserLocale});
 try{document.cookie=UI_HINT_COOKIE+'='+hint+'; Path=/; Max-Age=31536000; SameSite=Lax'+(location?.protocol==='https:'?'; Secure':'');}catch{}
 const saved=readHintCookie(document);
 return {hint,preference,browserLocale,written:!!saved&&encodeUiLanguageHint(saved)===hint};
}
export function showUiStartFailure(document,locale,target){
 const root=document?.documentElement;if(!root)return;
 const copy=UI_FIRST_PAINT_COPY[locale]||UI_FIRST_PAINT_COPY.en;
 root.hidden=false;root.lang=locale;
 const render=()=>{
  if(!document.body){setTimeout(render,0);return;}
  let section=document.getElementById?.('ui-first-paint-error');
  if(!section){section=document.createElement('section');section.id='ui-first-paint-error';section.setAttribute('role','alert');section.className='loading-state';const p=document.createElement('p'),retry=document.createElement('a'),back=document.createElement('a');p.textContent=copy.failed;retry.textContent=copy.retry;retry.href=target;back.textContent=copy.back;back.href='/library?ui='+locale;section.append(p,retry,document.createElement('br'),back);const host=['book-page','library-view','home-view'].map(id=>document.getElementById?.(id)).find(node=>node&&!node.hidden&&!node.closest?.('[hidden]'))||document.body;host.replaceChildren(section);}
 };
 render();
}
function navigateUiDocument(options,document,location,locale,target){
 const root=document.documentElement;root.setAttribute('data-ui-handoff','');root.hidden=true;
 const schedule=options.setTimeout||globalThis.setTimeout,cancel=options.clearTimeout||globalThis.clearTimeout;
 const timer=schedule(()=>showUiStartFailure(document,locale,target),8000);
 (options.view??globalThis.window)?.addEventListener?.('pagehide',()=>cancel(timer),{once:true});
 try{location.replace(target);}catch{cancel(timer);showUiStartFailure(document,locale,target);return {kind:'failed',reason:'navigation',locale};}
 return {kind:'handoff',locale,target};
}
// Only legacy device hints can require another HTTP document. This runs as a
// classic head script before body parsing; it never translates live content.
export function runUiFirstPaintHandoff(options={}){
 const document=options.document??globalThis.document,location=options.location??globalThis.location,initial=readInitialUiDecision(document);
 if(!initial)return {kind:'continue',reason:'no-initial-decision'};
 let address;try{address=new URL(location.href);}catch{return {kind:'continue',reason:'no-location'};}
 const canonical=canonicalUiEntryPath(address.pathname);
 if(canonical!==null&&canonical!==address.pathname){const target=new URL(address.href);target.pathname=canonical;try{const history=options.history??globalThis.history;history.replaceState(history.state??null,'',target.href);}catch{return navigateUiDocument(options,document,location,initial.locale,target.href);}}
 const hint=mirrorUiLanguageHint({...options,document,location});
 if(document.documentElement.getAttribute('data-ui-session-handoff')==='true'){
  const target=new URL(location.href),path=internalUiEntryPath(target.pathname);if(!path)return {kind:'continue',reason:'unknown-entry'};target.pathname=path;return navigateUiDocument(options,document,location,initial.locale,target.href);
 }
 if(initial.source==='page'||initial.source==='account'&&initial.preference!=='system')return {kind:'continue',locale:initial.locale};
 let session=null;
 try{const value=(options.sessionStorage===undefined?globalThis.sessionStorage:options.sessionStorage)?.getItem?.(UI_SESSION_PREFERENCE_KEY);if(isUiPreference(value))session=value;}catch{}
 const preference=initial.source==='account'?initial.preference:session||hint.preference;
 const locale=preference&&preference!=='system'?preference:hint.browserLocale;
 if(locale===initial.locale)return {kind:'continue',locale};
 let next;try{next=new URL(location.href);if(!['http:','https:'].includes(next.protocol))return {kind:'continue',reason:'non-web'};}catch{return {kind:'continue',reason:'no-location'};}
 const query=parseUiParam(next.search);
 const root=document.documentElement;root.setAttribute('data-ui-handoff','');root.hidden=true;
 if(query.status==='valid'&&query.code===locale){showUiStartFailure(document,locale,next.href);return {kind:'failed',reason:'stale-document',locale};}
 let repeated=false;
 const guard=next.origin+next.pathname+'|'+locale+'|'+hint.hint;
 try{const store=options.sessionStorage===undefined?globalThis.sessionStorage:options.sessionStorage;repeated=store?.getItem?.('leafhour.ui.hint.handoff.v1')===guard;store?.setItem?.('leafhour.ui.hint.handoff.v1',guard);}catch{}
 if(!hint.written||session||repeated){next.searchParams.delete('ui');next.searchParams.append('ui',locale);}
 const path=internalUiEntryPath(next.pathname);if(!path){showUiStartFailure(document,locale,next.href);return {kind:'failed',reason:'unknown-entry',locale};}next.pathname=path;
 return navigateUiDocument(options,document,location,locale,next.href);
}
// A failed session lookup is unknown, not a verified signed-out user.
export async function readVerifiedUiSession({request=globalThis.fetch,timeoutMs=6000}={}){
 if(typeof request!=='function')return null;
 const controller=new AbortController();let timer;
 const read=async()=>{const response=await request('/api/auth/session',{method:'GET',credentials:'same-origin',cache:'no-store',redirect:'error',signal:controller.signal});if(!response.ok)return null;const value=await response.json();if(!value||typeof value!=='object'||Array.isArray(value)||!Object.hasOwn(value,'user'))return null;const id=value.user===null?null:value.user?.id;if(id!==null&&(typeof id!=='string'||!id||id.length>512||/[\u0000-\u001f\u007f]/.test(id)))return null;return value;};
 try{return await Promise.race([read().catch(()=>null),new Promise(resolve=>{timer=setTimeout(()=>{controller.abort();resolve(null);},Math.max(1,Math.min(15000,timeoutMs)));})]);}finally{clearTimeout(timer);controller.abort();}
}
// Existing initial failures must not cause English owners to overwrite the
// selected HTML. A native reload stays usable even while modules are stopped.
export async function settleInitialUi(runtime,{document=globalThis.document,location=globalThis.location,initialDecision=null}={}){
 const initial=initialDecision||readInitialUiDecision(document);
 if(!initial)return runtime.initializeOnce();
 if(document.documentElement.hasAttribute?.('data-ui-handoff'))return new Promise(()=>{});
 await runtime.initializeOnce();
 let state=runtime.getUiLocaleState();
 if(state.phase==='pending'&&runtime.handlePopstate){await runtime.handlePopstate();state=runtime.getUiLocaleState();}
 if(state.phase!=='ready'||state.initialFallback){showUiStartFailure(document,initial.locale,location.href);return new Promise(()=>{});}
 return state;
}
const constants={UI_LOCALES,UI_PREFERENCES,DEFAULT_UI_LOCALE,UI_PARAM,UI_PREFERENCE_KEY,UI_SESSION_PREFERENCE_KEY,UI_HINT_COOKIE,UI_ENTRY_PATHS,UI_FIRST_PAINT_COPY};
export const UI_FIRST_PAINT_SCRIPT='(()=>{'+Object.entries(constants).map(([key,value])=>'const '+key+'='+JSON.stringify(value)+';').join('')+[isUiLocale,isUiPreference,normalizeUiLocale,browserUiLocale,parseUiParam,encodeUiLanguageHint,parseUiLanguageHint,readInitialUiDecision,canonicalUiEntryPath,internalUiEntryPath,readHintCookie,mirrorUiLanguageHint,showUiStartFailure,navigateUiDocument,runUiFirstPaintHandoff].map(fn=>'const '+fn.name+'='+fn.toString()+';').join('\n')+';runUiFirstPaintHandoff();})();';
