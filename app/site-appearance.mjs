import {homeLocale} from './home-locale.mjs';
const copy={
  en:{names:{system:'System',paper:'Paper',night:'Night'},label:(mode,next)=>'Appearance: '+mode+'; switch to '+next},
  'zh-Hans':{names:{system:'跟随系统',paper:'纸白',night:'夜色'},label:(mode,next)=>'页面外观：'+mode+'；切换为'+next},
  'zh-Hant':{names:{system:'跟隨系統',paper:'紙白',night:'夜色'},label:(mode,next)=>'頁面外觀：'+mode+'；切換為'+next},
  ja:{names:{system:'システム',paper:'紙',night:'夜'},label:(mode,next)=>'外観：'+mode+'；'+next+'に切り替え'}
}[homeLocale(document)];
const names=copy.names,modes=Object.keys(names),key='marginalia-portal-appearance';let mode='system';try{const saved=localStorage.getItem(key);if(modes.includes(saved))mode=saved;}catch{}
const control=document.getElementById('site-theme');
export const getSiteAppearance=()=>mode;
function apply(){document.documentElement.dataset.siteTheme=mode;if(control){control.setAttribute('aria-label',copy.label(names[mode],names[modes[(modes.indexOf(mode)+1)%modes.length]]));control.title=names[mode];control.textContent=mode==='night'?'☾':mode==='paper'?'☀':'◐';}document.dispatchEvent(new CustomEvent('site:appearance',{detail:mode}));}
export function setSiteAppearance(next){if(!modes.includes(next))return false;mode=next;try{localStorage.setItem(key,mode);}catch{}apply();return true;}
apply();control?.addEventListener('click',()=>setSiteAppearance(modes[(modes.indexOf(mode)+1)%modes.length]));
window.addEventListener('storage',event=>{if(event.key===key&&modes.includes(event.newValue)){mode=event.newValue;apply();}});
