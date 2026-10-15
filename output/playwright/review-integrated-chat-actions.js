async page => {
  // Browser-only synthetic identity and answer; never dispatch a paid request.
  const out={fixture:true,blockedMutations:[],checks:[]};
  const check=(value,label)=>{out.checks.push({label,pass:!!value});if(!value)throw Error(label);};
  try {
    await page.unrouteAll();
    const preview=await (await page.request.get('http://127.0.0.1:8337/api/library/books/gutenberg-meditations/preview')).json();
    const context={...preview,passageId:preview.passageId};
    const answer='隔离界面示例：这一解释仅用来检查复制与原文入口。';
    await page.route('**/api/**',async route=>{
      const req=route.request(),path=new URL(req.url()).pathname;
      if(path==='/api/auth/session')return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({user:{id:'isolated-ui-review',email:'review@example.invalid'}})});
      if(/\/chat$/.test(path)&&req.method()==='GET')return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({bookId:'gutenberg-meditations',contentVersion:preview.contentVersion,available:true,context,turns:[{id:'isolated-answer',passageId:preview.passageId,contentVersion:preview.contentVersion,text:'隔离界面示例问题',origin:'user',status:'completed',answer:{summary:answer,sourceRefs:[{passageId:preview.passageId,quote:preview.original||'公版原文定位示例'}]}}]})});
      if(req.method()!=='GET'){out.blockedMutations.push({path,method:req.method()});return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'隔离验证不执行写入或生成。'})});}
      // Public content stays anonymous at the real server. The synthetic owner
      // belongs only to this browser fixture, avoiding session-change redirects.
      const headers={...req.headers()};delete headers['x-reader-owner'];
      const response=await route.fetch({headers}),responseHeaders={...response.headers()};
      delete responseHeaders['x-reader-session-changed'];
      return route.fulfill({response,headers:responseHeaders});
    });
    await page.setViewportSize({width:1440,height:1000});
    await page.goto('http://127.0.0.1:8337/read?book=gutenberg-meditations');
    const panel=page.locator('#reader-conversation'),launcher=page.locator('.library-chat-launcher'),input=page.locator('#library-chat-input');
    await launcher.waitFor({state:'visible'});await launcher.click();await input.waitFor({state:'visible'});await page.waitForTimeout(220);
    check(await panel.getAttribute('aria-modal')==='false','nonmodal semantics');
    check(await page.evaluate(()=>getComputedStyle(document.documentElement).overflow!=='hidden'),'document is not scroll locked');
    out.desktopRects=await panel.locator('button,summary').evaluateAll(ns=>ns.filter(n=>n.getClientRects().length).map(n=>({name:n.getAttribute('aria-label')||n.textContent.trim(),width:n.getBoundingClientRect().width,height:n.getBoundingClientRect().height})));
    check(out.desktopRects.every(r=>r.width>=44&&r.height>=44),'desktop independent control targets at least 44');
    const draft='隔离草稿：想再核对这一段。';await input.fill(draft);await input.press('Shift+Enter');
    await input.dispatchEvent('compositionstart');await input.press('Enter');await input.dispatchEvent('compositionend');
    check(!out.blockedMutations.some(r=>/\/chat(?:\/|$)/.test(r.path)),'newline and IME do not submit chat');
    const saved=await input.inputValue();await input.press('Escape');await page.waitForTimeout(100);
    check(!await panel.evaluate(n=>n.open),'Escape closes companion');
    check(await launcher.evaluate(n=>n===document.activeElement),'Escape returns to launcher');
    await launcher.click();check(await input.inputValue()===saved,'draft survives collapse and reopen');
    // Keep the visual evidence on a normal single-line draft after the IME and
    // newline edge-case check; trailing blank lines otherwise scroll it away.
    out.retainedDraft=await input.inputValue();
    await input.fill('隔离草稿：第一行。\n第二行末尾。');
    out.desktopTwoLines=await input.evaluate(n=>({clientHeight:n.clientHeight,scrollHeight:n.scrollHeight,scrollTop:n.scrollTop,lineHeight:getComputedStyle(n).lineHeight}));
    check(out.desktopTwoLines.clientHeight===out.desktopTwoLines.scrollHeight&&out.desktopTwoLines.scrollTop===0,'desktop normal two lines need no scroll');
    await input.fill(draft);
    await panel.locator('.library-chat-close').focus();let tabLeft=false;
    for(let i=0;i<20;i++){await page.keyboard.press('Tab');if(await panel.evaluate(n=>!n.contains(document.activeElement))){tabLeft=true;break;}}
    check(tabLeft,'Tab can leave nonmodal panel');
    const before=await page.evaluate(()=>scrollY);await page.mouse.move(40,120);await page.mouse.wheel(0,300);await page.waitForTimeout(120);
    const after=await page.evaluate(()=>scrollY);out.desktopScroll={before,after};check(after>before,'desktop exposed正文 scrolls with companion open');
    await page.screenshot({path:'output/playwright/review-integrated-chat-1440.png'});
    await page.setViewportSize({width:390,height:844});await page.waitForTimeout(220);
    out.mobileRects=await panel.locator('button,summary').evaluateAll(ns=>ns.filter(n=>n.getClientRects().length).map(n=>({name:n.getAttribute('aria-label')||n.textContent.trim(),width:n.getBoundingClientRect().width,height:n.getBoundingClientRect().height})));
    check(out.mobileRects.every(r=>r.width>=44&&r.height>=44),'390 independent control targets at least 44');
    out.mobileOverflow=await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth);check(out.mobileOverflow===0,'390 no horizontal overflow');
    await input.fill('隔离草稿：第一行。\n第二行末尾。');
    out.mobileTwoLines=await input.evaluate(n=>({clientHeight:n.clientHeight,scrollHeight:n.scrollHeight,scrollTop:n.scrollTop,lineHeight:getComputedStyle(n).lineHeight}));
    check(out.mobileTwoLines.clientHeight===out.mobileTwoLines.scrollHeight&&out.mobileTwoLines.scrollTop===0,'390 normal two lines need no scroll');
    await input.fill(draft);
    await panel.locator('.library-chat-references > summary').click();
    await page.getByRole('button',{name:'复制这条 AI 解释'}).click();
    await page.waitForFunction(()=>['已复制','已选中，可复制'].includes(document.querySelector('[aria-label="复制这条 AI 解释"]')?.textContent),null,{timeout:3000});
    out.copyReceipt=await page.getByRole('button',{name:'复制这条 AI 解释'}).innerText();check(['已复制','已选中，可复制'].includes(out.copyReceipt),'answer copy has usable receipt');
    await page.screenshot({path:'output/playwright/review-integrated-chat-390.png'});
    await panel.locator('.library-chat-references .library-chat-source-link').click();
    check(!await panel.evaluate(n=>n.open),'reference navigation closes companion');
    out.referencePassage=preview.passageId;
    check(!out.blockedMutations.some(r=>/\/chat(?:\/|$)/.test(r.path)),'no paid chat request dispatched');
  } catch(error) {out.failure=error.message;}
  return out;
}
