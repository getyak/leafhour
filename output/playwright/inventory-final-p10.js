async (page) => {
 await page.getByRole('button',{name:'更多段落操作',exact:true}).click();const menuSnapshot=(await page.locator('body').ariaSnapshot()).slice(-2400);
 const control=page.getByRole('button',{name:'从这里开始听',exact:true});await page.keyboard.press('Tab');await control.focus();const metric=await control.evaluate(el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,focusVisible:el.matches(':focus-visible'),outline:getComputedStyle(el).outline}});
 const posts=[];const handler=req=>{if(req.method()==='POST')posts.push(new URL(req.url()).pathname)};page.on('request',handler);
 await control.press('Enter');const audio=page.getByRole('dialog',{name:'听这一段',exact:true});const audioSnapshot=await audio.ariaSnapshot();await page.screenshot({path:'/tmp/inventory-final-p10-1440.png'});
 await audio.getByRole('button',{name:'关闭听读面板',exact:true}).click();await page.locator('body').ariaSnapshot();page.off('request',handler);
 return {id:'P10',width:1440,metric,menuSnapshot,audioSnapshot,posts,closed:!(await audio.isVisible()),returnFocus:await page.evaluate(()=>({tag:document.activeElement?.tagName,id:document.activeElement?.id,label:document.activeElement?.getAttribute('aria-label')}))};
}
