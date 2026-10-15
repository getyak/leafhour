const names={system:'跟随系统',paper:'纸白',night:'夜色'},modes=Object.keys(names),key='marginalia-portal-appearance';let mode='system';try{const saved=localStorage.getItem(key);if(modes.includes(saved))mode=saved;}catch{}
const control=document.getElementById('site-theme');
export const getSiteAppearance=()=>mode;
function apply(){document.documentElement.dataset.siteTheme=mode;if(control){control.setAttribute('aria-label','页面外观：'+names[mode]+'；切换为'+names[modes[(modes.indexOf(mode)+1)%modes.length]]);control.title=names[mode];control.textContent=mode==='night'?'☾':mode==='paper'?'☀':'◐';}document.dispatchEvent(new CustomEvent('site:appearance',{detail:mode}));}
export function setSiteAppearance(next){if(!modes.includes(next))return false;mode=next;try{localStorage.setItem(key,mode);}catch{}apply();return true;}
apply();control?.addEventListener('click',()=>setSiteAppearance(modes[(modes.indexOf(mode)+1)%modes.length]));
window.addEventListener('storage',event=>{if(event.key===key&&modes.includes(event.newValue)){mode=event.newValue;apply();}});
