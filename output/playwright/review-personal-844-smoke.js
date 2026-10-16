async page => {
  const out={fixture:true,width:390,height:844,checks:[],writes:[]};
  const check=(pass,label)=>{out.checks.push({label,pass:!!pass});if(!pass)throw Error(label);};
  const closeIntersection=async selector=>page.locator(selector).evaluate(n=>{const r=n.getBoundingClientRect(),d=n.closest('dialog').getBoundingClientRect();return {rect:r.toJSON(),visibleWidth:Math.max(0,Math.min(r.right,d.right,innerWidth)-Math.max(r.left,d.left,0)),visibleHeight:Math.max(0,Math.min(r.bottom,d.bottom,innerHeight)-Math.max(r.top,d.top,0))};});
  try{
    await page.clock.resume();await page.setViewportSize({width:390,height:844});
    if(!await page.locator('#library-account').isVisible())await page.locator('#library-menu').click();await page.locator('#library-account').click();
    await page.getByRole('textbox',{name:'怎么称呼你'}).fill('隔离草稿，仅检查844高度');
    out.profileClose=await closeIntersection('#library-settings-dialog .dialog-close');
    check(out.profileClose.visibleWidth>=44&&out.profileClose.visibleHeight>=44,'profile 844 close remains fully reachable');
    check(await page.evaluate(()=>document.documentElement.scrollWidth===innerWidth),'profile 844 overflow0');await page.screenshot({path:'output/playwright/review-personal-profile-390x844.png',animations:'disabled'});await page.keyboard.press('Escape');
    const card=page.locator('[data-book-id="gutenberg-alice"]').first();await card.locator('.book-action-trigger').click();await page.getByRole('menuitem',{name:'送出这本书',exact:true}).click();
    await page.locator('#library-book-dialog').evaluate(n=>n.scrollTop=n.scrollHeight);out.composeClose=await closeIntersection('#library-book-dialog .book-action-close');
    check(out.composeClose.visibleWidth>=44&&out.composeClose.visibleHeight>=44,'compose 844 scrolled close remains fully reachable');check(await page.evaluate(()=>document.documentElement.scrollWidth===innerWidth),'compose 844 overflow0');await page.screenshot({path:'output/playwright/review-personal-compose-390x844.png',animations:'disabled'});await page.keyboard.press('Escape');
    await page.goto('http://127.0.0.1:8337/gift/'+'A'.repeat(43));await page.locator('#gift-open').click();check(await page.locator('#gift-title').evaluate(n=>n===document.activeElement),'gift 844 opens with title focus');
    await page.locator('#gift-download').scrollIntoViewIfNeeded();check(await page.evaluate(()=>document.documentElement.scrollWidth===innerWidth),'gift 844 overflow0');await page.screenshot({path:'output/playwright/review-personal-gift-390x844.png',animations:'disabled'});
    const state=await page.evaluate(()=>window.__conditionalFixture());out.writes=state.requests.filter(r=>r.method!=='GET');check(out.writes.length===0,'independent 844 smoke creates no mutation');
  }catch(error){out.failure=error.message;}
  return out;
}
