async page => {
  const base = 'http://127.0.0.1:8337';
  const output = 'output/playwright/';
  const result = { fixture:true, widths:[], blockedMutations:[], exportRequests:0, mailApplicationOpened:false };
  let failMetrics = false;
  const rate = {rate:null,numerator:0,denominator:0,sampleState:'insufficient',targetReached:null};
  const metrics = { uniqueSessions:0, sampleState:'insufficient',fragmentCoverage:rate,latency:{xray:{p95Ms:null,samples:0}},constraints:{quiet:rate},behavior:Object.fromEntries(['xrayContinue','stanceChoice','stanceSource','share','observationCopy','echoReread','immediateExit'].map(k=>[k,rate])),chatControl:{available:false}};
  await page.route('**/*', async route => {
    const req=route.request(); const path=new URL(req.url()).pathname;
    if(req.method()!=='GET'){ result.blockedMutations.push({method:req.method(),path}); return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Isolated auxiliary review: no writes'})}); }
    if(path==='/api/experience-metrics')return route.fulfill({status:failMetrics?503:200,contentType:'application/json',body:JSON.stringify(failMetrics?{error:'isolated load failure'}:metrics)});
    if(path==='/api/experiences/export'){result.exportRequests++;return route.fulfill({status:200,contentType:'application/json',headers:{'Content-Disposition':'attachment; filename="marginalia-my-experiences.json"'},body:JSON.stringify({fixture:true,schemaVersion:1,experiences:[],events:[]})});}
    return route.continue();
  });
  await page.context().grantPermissions(['clipboard-read','clipboard-write']);
  for(const width of [1440,390]){
    const height=width===390?844:1000;
    await page.setViewportSize({width,height});
    const row={width,height,checks:[],targets:[],download:null}; result.widths.push(row);
    const check=(label,pass,detail)=>{row.checks.push({label,pass,...(detail===undefined?{}:{detail})});if(!pass)throw Error(label);};
    const inspect=async locator=>locator.evaluate(e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return{name:e.textContent.trim(),width:r.width,height:r.height,outlineWidth:s.outlineWidth,outlineStyle:s.outlineStyle,href:e.getAttribute('href'),active:document.activeElement===e};});
    await page.goto(base+'/evals');
    await page.getByRole('status').filter({hasText:'记录来自 0 个本机阅读会话'}).waitFor();
    check('evals truthful insufficient sample and matching definitions',await page.getByRole('status').innerText().then(t=>t.includes('样本不足')));
    await page.keyboard.press('Tab');
    const home=page.getByRole('link',{name:'回到首页',exact:true});
    const homeFocus=await inspect(home);check('E14 first keyboard target named homepage with visible focus',homeFocus.active&&parseFloat(homeFocus.outlineWidth)>=2&&homeFocus.href==='/');
    await page.screenshot({path:output+'review-evals-'+width+'-overview.png',animations:'disabled'});
    await page.keyboard.press('Tab');
    const summary=page.locator('summary');
    check('E15 summary reached in Tab order',await summary.evaluate(e=>e===document.activeElement));
    await page.keyboard.press('Enter');
    check('E15 Enter reveals calculation and no invented sample attainment',await page.locator('details').evaluate(e=>e.open)&&await page.locator('#definitions').innerText().then(t=>t.includes('少于20个样本')&&t.includes('暂无同口径数据')));
    await page.keyboard.press('Space');
    check('E15 Space closes native details and retains focus',await page.locator('details').evaluate(e=>!e.open)&&await summary.evaluate(e=>e===document.activeElement));
    await page.keyboard.press('Enter');
    for(const loc of [home,summary,page.getByRole('link',{name:'打开聊天解释对照',exact:true}),page.getByRole('link',{name:'导出自己的体验记录',exact:true})])row.targets.push(await inspect(loc));
    check('evals every independent link and summary at least44',row.targets.every(t=>t.width>=44&&t.height>=44),row.targets);
    check('evals no horizontal overflow',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await page.screenshot({path:output+'review-evals-'+width+'-definitions.png',animations:'disabled'});
    await page.keyboard.press('Tab');
    check('E16 keyboard target is exact compatible reader route',await page.getByRole('link',{name:'打开聊天解释对照',exact:true}).evaluate(e=>e===document.activeElement&&e.getAttribute('href')==='/read?study=chat'));
    await page.keyboard.press('Enter');
    await page.locator('body[data-ready="true"]').waitFor({timeout:25000});
    check('E16 Enter reaches readable public reader without generation',await page.locator('#book-page').isVisible()&&page.url().includes('/read'));
    await page.goto(base+'/evals');
    await page.getByRole('status').filter({hasText:'记录来自 0'}).waitFor();
    const exp=page.getByRole('link',{name:'导出自己的体验记录',exact:true});
    await exp.focus();
    const dlPromise=page.waitForEvent('download');await page.keyboard.press('Enter');const dl=await dlPromise;
    const dlPath=output+'review-evals-'+width+'-download.json';await dl.saveAs(dlPath);
    row.download={name:dl.suggestedFilename(),file:dlPath};
    check('E17 Enter saves an actual browser download with the correct filename',row.download.name==='marginalia-my-experiences.json');
    check('E17 export leaves focus on usable download link',await exp.evaluate(e=>e===document.activeElement));
    failMetrics=true;await page.reload();await page.getByRole('status').filter({hasText:'暂时无法读取体验记录'}).waitFor();
    check('evals load503 explicitly preserves a reading exit',await home.isVisible()&&await page.getByRole('status').innerText().then(t=>t.includes('书页仍可继续阅读')));
    await home.focus();await page.keyboard.press('Enter');await page.waitForURL(base+'/');
    check('E14 keyboard homepage exit actually arrives',new URL(page.url()).pathname==='/');
    failMetrics=false;await page.goto(base+'/evals');await page.getByRole('status').filter({hasText:'记录来自 0'}).waitFor();
    check('evals reload recovers after isolated failure',await page.getByRole('status').innerText().then(t=>t.includes('样本不足')));
    await page.goto(base+'/privacy');
    await page.keyboard.press('Tab');
    const skip=page.getByRole('link',{name:'跳到正文',exact:true});check('E18 skip link receives first keyboard focus',await skip.evaluate(e=>e===document.activeElement));
    await page.keyboard.press('Enter');check('E18 Enter moves to real main anchor',new URL(page.url()).hash==='#main'&&await page.locator('#main').evaluate(e=>e.getBoundingClientRect().top>=-2&&e.getBoundingClientRect().top<100));
    const mail=page.locator('a[href="mailto:hi@cubxxw.com"]');
    // Start at the known skip target and traverse the real browser Tab order.
    await skip.focus();let found=false;for(let i=0;i<9;i++){await page.keyboard.press('Tab');if(await mail.evaluate(e=>e===document.activeElement)){found=true;break;}}
    const mailFocus=await inspect(mail);check('E20 email reachable by Tab with visible focus and correct mailto',found&&parseFloat(mailFocus.outlineWidth)>=2&&mailFocus.href==='mailto:hi@cubxxw.com');
    await mail.evaluate(e=>{const r=document.createRange();r.selectNodeContents(e);getSelection().removeAllRanges();getSelection().addRange(r);});
    await page.keyboard.press('Meta+c');row.mailCopied=await page.evaluate(()=>navigator.clipboard.readText());
    check('E20 address text really copies without opening mail',row.mailCopied==='hi@cubxxw.com');
    await page.evaluate(()=>getSelection().removeAllRanges());
    row.privacyTargets=await page.locator('a').evaluateAll(es=>es.map(e=>{const r=e.getBoundingClientRect();return {name:e.textContent.trim(),href:e.getAttribute('href'),width:r.width,height:r.height};}));
    check('E18 E19 repeated brand and library destinations remain correct',row.privacyTargets.filter(x=>x.href==='/').length===2&&row.privacyTargets.filter(x=>x.href==='/library').length===3);
    check('privacy independent targets44 with natural inline email exception',row.privacyTargets.filter(x=>x.width>0&&x.height>0&&!x.href.startsWith('mailto:')).every(x=>x.width>=44&&x.height>=44),row.privacyTargets);
    check('privacy no horizontal overflow',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await page.screenshot({path:output+'review-privacy-'+width+'-email.png',animations:'disabled'});
    const back=page.getByRole('link',{name:'回到书房 →',exact:true});await back.focus();await page.keyboard.press('Enter');await page.waitForURL(base+'/library');
    check('E19 keyboard return arrives at actual library',new URL(page.url()).pathname==='/library');
    await page.goBack();await page.locator('#main').waitFor();
    check('privacy browser Back returns to readable document',await page.getByRole('heading',{name:'登录与个人数据',exact:true}).isVisible());
  }
  result.noLiveWrites=result.blockedMutations.length===0;
  return result;
}
