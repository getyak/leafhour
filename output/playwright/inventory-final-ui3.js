async (page) => {
 await page.getByRole('switch',{name:'连续阅读',exact:true}).uncheck();
 await page.getByRole('button',{name:'关闭阅读设置',exact:true}).click();
 const fresh=await page.locator('body').ariaSnapshot();
 const prev=page.getByRole('button',{name:'上一章',exact:true}), next=page.getByRole('button',{name:'下一章',exact:true});
 await next.scrollIntoViewIfNeeded(); await next.focus();
 const box=await next.boundingBox();
 const focus=await next.evaluate(el=>({active:document.activeElement===el,outline:getComputedStyle(el).outline,visible:el.matches(':focus-visible')}));
 const first={previousDisabled:await prev.isDisabled(),next:box,focus,title:await page.getByRole('heading',{level:1}).innerText()};
 await next.press('Enter'); await page.waitForFunction(()=>document.querySelector('h1')?.textContent?.includes('泪水池'));
 const secondSnapshot=await page.locator('body').ariaSnapshot();
 const second={title:await page.getByRole('heading',{level:1}).innerText(),url:page.url(),previousDisabled:await prev.isDisabled()};
 await prev.scrollIntoViewIfNeeded(); await prev.click();
 await page.waitForFunction(()=>document.querySelector('h1')?.textContent?.includes('掉进兔子洞'));
 const returnSnapshot=await page.locator('body').ariaSnapshot();
 return {width:1440,first,second,return:{title:await page.getByRole('heading',{level:1}).innerText(),url:page.url()},snapshotsConfirmed:[fresh.includes('上一章'),secondSnapshot.includes('泪水池'),returnSnapshot.includes('掉进兔子洞')]};
}
