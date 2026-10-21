async page => {
 const checks=[],verify=(ok,label)=>{if(!ok)throw Error(label);checks.push(label);};
 await page.waitForFunction(()=>document.querySelector('#shelf-language').value==='zh'&&document.querySelectorAll('#featured-books .book-card').length===3);
 verify(await page.locator('#books #library-filter-controls').isVisible(),'home shelf exposes the same reading filters');
 await page.getByRole('button',{name:'筛选书籍，已选 1 项',exact:true}).click();
 await page.getByRole('group',{name:'阅读形态',exact:true}).getByRole('button',{name:'原版',exact:true}).click();
 await page.getByText('试试其他阅读语言，或将阅读形态改为全部。',{exact:true}).waitFor({state:'visible'});
 verify(await page.locator('#featured-books .home-shelf-empty').isVisible(),'home Chinese originals have a useful zero state');
 await page.getByRole('group',{name:'阅读形态',exact:true}).getByRole('button',{name:'双语对照',exact:true}).click();
 verify(await page.locator('#featured-books .book-card').count()===3,'home bilingual returns exactly the saved samples');
 verify(await page.getByText('有译本也可能只有部分段落，缺译处保留原文。',{exact:true}).isVisible(),'home explicitly discloses partial translation coverage');
 await page.screenshot({path:'/private/tmp/ai-test-GET-199.tdrcYD/home-mobile.png'});
 await page.keyboard.press('Escape');
 await page.locator('#shelf-filter-clear').click();
 verify(await page.locator('#shelf-language').inputValue()==='all'&&await page.locator('#shelf-form').inputValue()==='all','home clear removes the account default and format');
 await page.setViewportSize({width:1280,height:900});
 await page.getByRole('button',{name:'筛选书籍',exact:true}).click();
 await page.getByRole('group',{name:'阅读语言',exact:true}).getByRole('button',{name:'中文',exact:true}).click();
 await page.getByRole('group',{name:'阅读形态',exact:true}).getByRole('button',{name:'双语对照',exact:true}).click();
 await page.screenshot({path:'/private/tmp/ai-test-GET-199.tdrcYD/home-desktop.png'});
 verify(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'home has no horizontal overflow');
 return {checks,visibleCards:await page.locator('#featured-books .book-card').count()};
}
