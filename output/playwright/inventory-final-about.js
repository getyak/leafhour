async (page) => {
 const out=[];
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:width===390?844:1000});
  await page.goto('http://127.0.0.1:8337/library?settings=about',{waitUntil:'domcontentloaded'});
  const dialog=page.getByRole('dialog',{name:'设置',exact:true});await dialog.waitFor();const snap=await dialog.ariaSnapshot();
  const metrics=async loc=>{await page.keyboard.press('Tab');await loc.focus();return await loc.evaluate(el=>{const r=el.getBoundingClientRect();return {width:r.width,height:r.height,x:r.x,y:r.y,focusVisible:el.matches(':focus-visible'),outline:getComputedStyle(el).outline}})};
  const git=dialog.getByRole('link',{name:'查看开源项目 ↗',exact:true});const gm=await metrics(git);
  const pp=page.waitForEvent('popup');await git.press('Enter');const p=await pp;let loaded=true;await p.waitForLoadState('domcontentloaded',{timeout:8000}).catch(()=>loaded=false);out.push({id:'C16',width,metric:gm,url:p.url(),loaded});await p.close();
  const privacy=dialog.getByRole('link',{name:'隐私说明 ↗',exact:true});const pm=await metrics(privacy);const href=await privacy.getAttribute('href');const target=await privacy.getAttribute('target');
  if(target==='_blank'){
   const pq=page.waitForEvent('popup');await privacy.press('Enter');const q=await pq;await q.waitForLoadState('domcontentloaded',{timeout:8000});const ps=await q.locator('body').ariaSnapshot();out.push({id:'C17',width,metric:pm,href,target,url:q.url(),snapshot:ps.slice(0,700),returnByClosingPopup:true});await q.close();
  }else{
   await privacy.press('Enter');await page.waitForURL('**/privacy',{waitUntil:'domcontentloaded'});const ps=await page.locator('body').ariaSnapshot();out.push({id:'C17',width,metric:pm,href,target,url:page.url(),snapshot:ps.slice(0,700)});await page.goBack({waitUntil:'domcontentloaded'});await page.locator('body').ariaSnapshot();out.push({id:'C17-return',width,url:page.url(),dialogOpen:await dialog.isVisible()});
  }
  out.push({width,aboutSnapshot:snap,overflow:await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)});
 }
 return out;
}
