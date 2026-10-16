async page => {
  const out={widths:[],blockedMutations:[],cspErrors:[],mailApplicationOpened:false};
  const listener=m=>{if(m.text().includes('Content Security Policy'))out.cspErrors.push(m.text());};page.on('console',listener);
  await page.route('**/*',route=>route.request().method()==='GET'?route.continue():(out.blockedMutations.push({method:route.request().method(),path:new URL(route.request().url()).pathname}),route.fulfill({status:503,body:'Isolated privacy review: writes blocked'})));
  await page.context().grantPermissions(['clipboard-read','clipboard-write']);
  for(const width of [1440,390]){
    await page.setViewportSize({width,height:width===390?844:1000});
    const row={width,checks:[]};out.widths.push(row);
    const check=(label,pass)=>{row.checks.push({label,pass});if(!pass)throw Error(label);};
    const response=await page.goto('http://127.0.0.1:8337/privacy');await page.evaluate(()=>document.fonts.ready);
    row.csp=response.headers()['content-security-policy'];
    row.geometry=await page.locator('#main').evaluate(e=>{const s=getComputedStyle(e),h=e.querySelector('h1'),r=e.getBoundingClientRect();return{main:{left:r.left,right:r.right,width:r.width},maxWidth:s.maxWidth,paddingLeft:s.paddingLeft,paddingRight:s.paddingRight,fontSize:s.fontSize,lineHeight:s.lineHeight,heading:{left:h.getBoundingClientRect().left,right:h.getBoundingClientRect().right,fontSize:getComputedStyle(h).fontSize},styleSheets:[...document.styleSheets].map(x=>x.href)};});
    check('privacy external CSS restores bounded760 reading column with24 side padding',row.geometry.maxWidth==='760px'&&row.geometry.paddingLeft==='24px'&&row.geometry.paddingRight==='24px'&&row.geometry.main.width<=760);
    check('privacy title is inset and fully inside viewport',row.geometry.heading.left>=20&&row.geometry.heading.right<=width-20);
    check('privacy CSP remains strict without unsafe-inline style permission',row.csp.includes("style-src 'self'")&&!row.csp.includes("'unsafe-inline'"));
    check('privacy no horizontal overflow',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await page.screenshot({path:'output/playwright/review-privacy-'+width+'-overview-final.png',animations:'disabled'});
    await page.keyboard.press('Tab');
    check('privacy skip is the actual first keyboard target',await page.locator('a.skip').evaluate(e=>e===document.activeElement));
    await page.keyboard.press('Enter');check('privacy skip Enter reaches main anchor',new URL(page.url()).hash==='#main');
    await page.locator('a.skip').focus();const mail=page.locator('a[href="mailto:hi@cubxxw.com"]');let found=false;
    for(let i=0;i<9;i++){await page.keyboard.press('Tab');if(await mail.evaluate(e=>e===document.activeElement)){found=true;break;}}
    check('privacy email is reached through real Tab order',found);
    await page.waitForFunction(()=>{const e=document.querySelector('a[href^="mailto:"]'),r=e.getBoundingClientRect();return r.top>=2&&r.bottom<=innerHeight-2;},{},{timeout:3000});
    row.mailFocus=await mail.evaluate(e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return{top:r.top,bottom:r.bottom,scrollY,outlineWidth:s.outlineWidth,outlineStyle:s.outlineStyle,active:e===document.activeElement,href:e.getAttribute('href')};});
    check('privacy focused email settles into viewport with2px outline',row.mailFocus.active&&parseFloat(row.mailFocus.outlineWidth)>=2&&row.mailFocus.top>=2&&row.mailFocus.bottom<=(width===390?844:1000)-2);
    await mail.evaluate(e=>{const range=document.createRange();range.selectNodeContents(e);getSelection().removeAllRanges();getSelection().addRange(range);});await page.keyboard.press('Meta+c');
    row.copied=await page.evaluate(()=>navigator.clipboard.readText());check('privacy email address copies without activating external mail',row.copied==='hi@cubxxw.com');
    await page.evaluate(()=>getSelection().removeAllRanges());
    await mail.scrollIntoViewIfNeeded();await page.screenshot({path:'output/playwright/review-privacy-'+width+'-email-final.png',animations:'disabled'});
    row.targets=await page.locator('a').evaluateAll(es=>es.map(e=>{const r=e.getBoundingClientRect();return{name:e.textContent.trim(),href:e.getAttribute('href'),width:r.width,height:r.height};}));
    check('privacy visible independent links44 except natural inline mail',row.targets.filter(e=>e.width>0&&e.height>0&&!e.href.startsWith('mailto:')).every(e=>e.width>=44&&e.height>=44));
    const back=page.getByRole('link',{name:'回到书房 →',exact:true});await back.focus();await page.keyboard.press('Enter');await page.waitForURL('http://127.0.0.1:8337/library');
    check('privacy keyboard return reaches actual library',new URL(page.url()).pathname==='/library');
    await page.goBack();await page.locator('#main').waitFor();check('privacy browser Back restores readable privacy document',await page.getByRole('heading',{name:'登录与个人数据',exact:true}).isVisible());
  }
  page.off('console',listener);out.noCspStyleViolation=out.cspErrors.length===0;return out;
}
