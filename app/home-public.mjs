// A small public shell: no library, account, upload or model controllers.
const doc=document,trigger=doc.getElementById('home-menu-trigger'),menu=doc.getElementById('home-menu');
const close=()=>{menu?.close();trigger?.setAttribute('aria-expanded','false');};
if(trigger&&menu){
 const links=doc.getElementById('home-menu-links');
 for(const anchor of doc.querySelectorAll('.home-navigation a'))links?.append(anchor.cloneNode(true));
 trigger.addEventListener('click',()=>{if(menu.open){close();return;}menu.showModal();trigger.setAttribute('aria-expanded','true');});
 menu.querySelector('[data-close]')?.addEventListener('click',close);
 menu.addEventListener('close',()=>{trigger.setAttribute('aria-expanded','false');trigger.focus({preventScroll:true});});
 menu.addEventListener('click',event=>{if(event.target===menu)close();});
 menu.addEventListener('click',event=>{if(event.target.closest('a[href]'))close();});
}
try{const value=localStorage.getItem('marginalia-portal-appearance');if(['paper','night','system'].includes(value))doc.documentElement.dataset.siteTheme=value;}catch{}
const theme=doc.getElementById('site-theme');
theme?.addEventListener('click',async()=>{
 try{await import('./site-appearance.mjs');theme.click();}catch{}
},{once:true});
