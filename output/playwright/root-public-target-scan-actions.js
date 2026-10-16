async page => {
 await page.unrouteAll();
 const results=[];
 for(const width of [1440,390,320])for(const path of ['/','/library','/privacy']){
  await page.setViewportSize({width,height:1000});await page.goto('http://127.0.0.1:8337'+path);await page.locator('main').waitFor();if(path!=='/privacy')await page.locator(path==='/library'?'#library-books .book-card':'#featured-books .book-card').first().waitFor({state:'visible'});await page.evaluate(()=>document.fonts.ready);
  const data=await page.locator('a[href],button,summary,input:not([type=hidden]),select,textarea,[role=button]').evaluateAll(ns=>ns.filter(n=>n.getClientRects().length&&!n.closest('[hidden],[inert]')&&!n.matches('.skip-link')).map(n=>{const r=n.getBoundingClientRect();return {id:n.id,tag:n.tagName,name:(n.getAttribute('aria-label')||n.textContent||n.getAttribute('placeholder')||'').trim().slice(0,85),href:n.getAttribute('href'),width:r.width,height:r.height};}).filter(r=>r.width<43.9||r.height<43.9));
  results.push({width,path,overflow:await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth),small:data});
 }
 return results;
}
