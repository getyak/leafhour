import {isUiLocale,isUiPreference} from './ui-locale-codec.mjs';
export const UI_HINT_COOKIE='leafhour.ui.hint.v1';
// A presentation hint, never an identity or account-preference record.
export function encodeUiLanguageHint({preference=null,browserLocale}={}){
 if(preference!==null&&!isUiPreference(preference)||!isUiLocale(browserLocale))return null;
 return '1.'+(preference||'-')+'.'+browserLocale;
}
export function parseUiLanguageHint(value){
 if(typeof value!=='string'||value.length>48)return null;
 const match=/^1\.(system|en|zh-Hans|zh-Hant|ja|-)\.(en|zh-Hans|zh-Hant|ja)$/.exec(value);
 return match?{preference:match[1]==='-'?null:match[1],browserLocale:match[2]}:null;
}
export function readInitialUiDecision(document){
 const root=document?.documentElement;if(!root?.getAttribute)return null;
 const locale=root.getAttribute('data-ui-initial-locale'),source=root.getAttribute('data-ui-initial-source'),raw=root.getAttribute('data-ui-initial-preference'),preference=raw||null;
 if(!isUiLocale(locale)||!['page','account','device','browser'].includes(source)||preference!==null&&!isUiPreference(preference))return null;
 if(source==='account'&&preference===null||source==='device'&&preference===null||source==='page'&&preference!==locale||source==='browser'&&preference!==null)return null;
 if(preference!==null&&preference!=='system'&&preference!==locale)return null;
 const owner=source==='account'?root.getAttribute('data-ui-initial-owner'):null;
 if(source==='account'&&(typeof owner!=='string'||!owner||owner.length>512||/[\u0000-\u001f\u007f]/.test(owner)))return null;
 const rawHint=root.getAttribute('data-ui-device-hint');
 return {locale,source,preference,ownerId:owner||null,deviceHint:parseUiLanguageHint(rawHint)?rawHint:null};
}

export const UI_ENTRY_PATHS=Object.freeze({'/':'/_ui/home','/library':'/_ui/library','/read':'/_ui/read'});
export function canonicalUiEntryPath(pathname){if(typeof pathname!=='string')return null;if(Object.hasOwn(UI_ENTRY_PATHS,pathname))return pathname;return Object.keys(UI_ENTRY_PATHS).find(key=>UI_ENTRY_PATHS[key]===pathname)||null;}
export function internalUiEntryPath(pathname){const canonical=canonicalUiEntryPath(pathname);return canonical===null?null:UI_ENTRY_PATHS[canonical];}
