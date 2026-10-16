async (page) => {
 const out=[];
 await page.getByRole('button',{name:'深读提示',exact:true}).click();
 await page.getByRole('dialog',{name:'从一个问题开始。'}).ariaSnapshot();
 const metric=async loc=>{await page.keyboard.press('Tab');await loc.focus();return await loc.evaluate(el=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el);return {x:r.x,y:r.y,width:r.width,height:r.height,focus:document.activeElement===el,focusVisible:el.matches(':focus-visible'),outline:s.outline}})};
 const guide=page.getByRole('dialog',{name:'从一个问题开始。'});
 const cornell=guide.getByRole('link',{name:'Cornell 阅读策略 ↗'});
 const cm=await metric(cornell);const dest=await cornell.getAttribute('href');
 const popupPromise=page.waitForEvent('popup');await cornell.press('Enter');const popup=await popupPromise;
 let loaded=true;await popup.waitForLoadState('domcontentloaded',{timeout:8000}).catch(()=>loaded=false);out.push({id:'D11',width:1440,dest,popupURL:popup.url(),loaded,metric:cm});await popup.close();
 const close=guide.getByRole('button',{name:'关闭深读提示'});const xm=await metric(close);await close.press('Enter');
 const afterClose=await page.locator('body').ariaSnapshot();out.push({id:'D10',width:1440,metric:xm,closed:!(await guide.isVisible()),focus:await page.evaluate(()=>({id:document.activeElement?.id,name:document.activeElement?.textContent?.trim()})),snapshotConfirmed:!afterClose.includes('dialog "从一个问题开始。"')});
 await page.getByRole('button',{name:'深读提示',exact:true}).click();await guide.ariaSnapshot();const ret=guide.getByRole('button',{name:'回到阅读',exact:true});const rm=await metric(ret);await ret.press('Enter');await page.locator('body').ariaSnapshot();out.push({id:'D12',width:1440,metric:rm,closed:!(await guide.isVisible()),focus:await page.evaluate(()=>({id:document.activeElement?.id,name:document.activeElement?.textContent?.trim()}))});
 return out;
}
