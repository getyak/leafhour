async (page) => {
 const out=[];
 await page.getByText('关于声音与素材',{exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'此刻，想在哪里读？'});const snap=await dialog.ariaSnapshot();
 const link=dialog.getByRole('link',{name:'查看素材来源',exact:true});await page.keyboard.press('Tab');await link.focus();
 const metric=await link.evaluate(el=>{const r=el.getBoundingClientRect();return {width:r.width,height:r.height,focusVisible:el.matches(':focus-visible'),outline:getComputedStyle(el).outline}});
 const pop=page.waitForEvent('popup');await link.press('Enter');const p=await pop;await p.waitForLoadState('domcontentloaded',{timeout:8000}).catch(()=>{});
 out.push({id:'M10',width:1440,metric,url:p.url(),body:(await p.locator('body').innerText()).slice(0,600),snapshot:snap.slice(-1800)});await p.close();
 await dialog.getByRole('button',{name:'关闭阅读氛围'}).click();await page.locator('body').ariaSnapshot();out.push({returnFocus:await page.evaluate(()=>({id:document.activeElement?.id,name:document.activeElement?.getAttribute('aria-label')}))});
 const para=page.getByRole('paragraph').filter({hasText:'Alice was beginning to get very tired'}).first();
 await para.scrollIntoViewIfNeeded();await para.click();
 out.push({step:'paragraph',snapshot:(await page.locator('body').ariaSnapshot()).slice(-6000)});
 return out;
}
