const names={system:'跟随系统',paper:'纸白',night:'夜色'},modes=Object.keys(names),key='marginalia-portal-appearance';let mode='system';try{const saved=localStorage.getItem(key);if(modes.includes(saved))mode=saved;}catch{}
const control=document.getElementById('site-theme');
function apply(){document.documentElement.dataset.siteTheme=mode;if(control){control.setAttribute('aria-label','页面外观：'+names[mode]+'；切换为'+names[modes[(modes.indexOf(mode)+1)%modes.length]]);control.title=names[mode];control.textContent=mode==='night'?'☾':mode==='paper'?'☀':'◐';}}
apply();control?.addEventListener('click',()=>{mode=modes[(modes.indexOf(mode)+1)%modes.length];try{localStorage.setItem(key,mode);}catch{}apply();});
