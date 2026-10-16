async page => {
  const out={fixture:true,checks:[],writes:[],blocked:[]};
  const check=(pass,label)=>{out.checks.push({label,pass:!!pass});if(!pass)throw Error(label);};
  try {
    await page.unrouteAll();
    const base='http://127.0.0.1:8337';
    const catalog=await (await page.request.get(base+'/api/library')).json();
    const books=catalog.books.filter(b=>b.visibility==='public'),previews={};
    for(const book of books)previews[book.bookId]=await (await page.request.get(base+'/api/library/books/'+book.bookId+'/preview')).json();
    const fixture={available:true,turns:[],getCount:0,anonymous:false,booksEmpty:false};
    await page.route('**/api/**',async route=>{
      const req=route.request(),u=new URL(req.url()),path=u.pathname;
      const reply=data=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
      if(path==='/api/auth/session')return reply({user:fixture.anonymous?null:{id:'isolated-current-chat',email:'review@example.invalid'},passwordAvailable:true,providers:{}});
      if(path==='/api/library')return reply({books:fixture.booksEmpty?[]:books});
      if(path==='/api/library/activity')return reply({month:u.searchParams.get('month'),days:[],readingDays:0,durationSeconds:0,notes:0,questions:0});
      const match=path.match(/^\/api\/library\/books\/([^/]+)\/(.*)$/);
      if(match){const id=match[1],action=match[2],context=previews[id];
        if(action==='preview')return reply(context);
        if(action==='chat'&&req.method()==='GET'){fixture.getCount++;return reply({bookId:id,title:books.find(b=>b.bookId===id).title,contentVersion:context.contentVersion,available:fixture.available,context,turns:fixture.turns.filter(t=>t.bookId===id)});}
        if(action==='chat'&&req.method()==='POST'){const payload=req.postDataJSON();out.writes.push({path,method:'POST',kind:'send'});const turn={...payload,bookId:id,origin:'user',status:'running',createdAt:new Date().toISOString(),answer:null};fixture.turns.push(turn);return reply(turn);}
        if(/^chat\/[^/]+\/cancel$/.test(action)&&req.method()==='POST'){out.writes.push({path,method:'POST',kind:'cancel'});const turn=fixture.turns.find(t=>t.id===action.split('/')[1]);turn.status='cancelled';return reply(turn);}
      }
      out.blocked.push({path,method:req.method()});return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'隔离验收未开放此接口。'})});
    });
    await page.setViewportSize({width:1440,height:1000});await page.goto(base+'/library');
    const launcher=page.locator('.library-chat-launcher'),panel=page.locator('#library-chat'),input=page.locator('#library-chat-input');
    await launcher.click();await input.waitFor({state:'visible'});
    await page.clock.install();
    const question='隔离验收：这段论证的前提是什么？';await input.fill(question);await input.press('Enter');
    await page.getByRole('button',{name:'停止',exact:true}).waitFor({state:'visible'});
    check(out.writes.filter(w=>w.kind==='send').length===1,'Enter sends exactly one intercepted request');
    check(await input.isDisabled()&&await page.locator('#library-chat-book').isDisabled()&&await page.getByRole('button',{name:'发送问题',exact:true}).isDisabled(),'pending input book chooser and send disabled');
    await panel.locator('.library-chat-close').click();check(!await panel.evaluate(n=>n.open),'collapse during pending is allowed');
    check(await launcher.getAttribute('aria-label')==='打开阅读对话，提问正在处理','collapsed launcher describes pending');
    await launcher.click();check(await page.getByRole('button',{name:'停止',exact:true}).isVisible(),'pending survives collapse and reopen');
    for(let i=0;i<18;i++){await page.clock.fastForward(6000);await page.waitForTimeout(100);if((await page.locator('#library-chat-status').innerText()).includes('还在处理'))break;}
    out.longWait={text:await page.locator('#library-chat-status').innerText(),getCount:fixture.getCount};check(out.longWait.text.includes('还在处理'),'bounded long-wait state appears after polling');
    await page.screenshot({path:'output/playwright/review-current-chat-1440-wait.png',animations:'disabled'});
    await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'停止',exact:true}).click();
    await page.waitForFunction(()=>!document.querySelector('#library-chat-input').disabled);
    check(out.writes.filter(w=>w.kind==='cancel').length===1,'stop sends exactly one intercepted cancel');
    check(await input.inputValue()===question,'stop restores original question');
    check((await page.locator('#library-chat-status').innerText()).includes('已停止'),'stop has explicit receipt');
    await page.screenshot({path:'output/playwright/review-current-chat-390-stopped.png',animations:'disabled'});
    fixture.available=false;await page.locator('#library-chat-book').selectOption(books.find(b=>b.bookId!==fixture.turns[0].bookId).bookId);
    await page.getByText('阅读助手暂时不可用。可以先写下问题，稍后再试。',{exact:true}).waitFor();
    await input.fill('隔离草稿：留到服务恢复时再问。');check(await page.getByRole('button',{name:'发送问题',exact:true}).isDisabled(),'unavailable service preserves editable draft but disables send');
    out.mobileRects=await panel.locator('button,summary,select').evaluateAll(ns=>ns.filter(n=>n.getClientRects().length).map(n=>({name:n.getAttribute('aria-label')||n.textContent.trim().slice(0,30),w:n.getBoundingClientRect().width,h:n.getBoundingClientRect().height})));
    check(out.mobileRects.every(r=>r.w>=44&&r.h>=44),'390 independent controls satisfy 44px');
    check(await page.evaluate(()=>document.documentElement.scrollWidth===innerWidth),'390 has no horizontal overflow');
    await input.press('Escape');check(await launcher.evaluate(n=>n===document.activeElement),'Escape returns focus to launcher');
    await launcher.press('Enter');check(await input.inputValue()==='隔离草稿：留到服务恢复时再问。','keyboard reopen preserves unavailable draft');
    await page.screenshot({path:'output/playwright/review-current-chat-390-unavailable.png',animations:'disabled'});
    const suggestion=panel.locator('.library-chat-suggestion').first();const suggestionText=await suggestion.innerText();await suggestion.click();check(await input.inputValue()===suggestionText&&await input.evaluate(n=>n===document.activeElement),'Q14 suggestion fills editable draft without sending');
    await panel.locator('.library-chat-menu > summary').click();check((await panel.locator('.library-chat-menu-hint').innerText()).includes('当前段与相邻段'),'N92 more menu explains bounded context');await panel.locator('.library-chat-menu > summary').click();
    await page.locator('#library-chat-book').selectOption(fixture.turns[0].bookId);await page.getByText('这次提问已停止。',{exact:true}).waitFor();await panel.locator('.library-chat-menu > summary').click();const exportPromise=page.waitForEvent('download');await page.getByRole('button',{name:'导出这段对话',exact:true}).click();const exported=await exportPromise;await exported.saveAs('output/playwright/review-chat-export-fixture.json');check(exported.suggestedFilename().includes('循页-对话-'),'Q12 real local conversation export is delivered');
    fixture.booksEmpty=true;await page.reload();await page.locator('.library-chat-launcher').click();await page.getByRole('button',{name:'回到书架',exact:true}).click();check(!await page.locator('#library-chat').evaluate(n=>n.open),'Q13 empty-book action closes companion to shelf');
    fixture.booksEmpty=false;fixture.anonymous=true;await page.reload();await page.locator('.library-chat-launcher').click();await page.getByRole('button',{name:'登录后开始',exact:true}).click();await page.locator('#auth-dialog').waitFor({state:'visible'});check(!await page.locator('#library-chat').evaluate(n=>n.open)&&await page.locator('dialog:modal').count()===1,'Q15 anonymous login opens one auth modal without stacking');await page.keyboard.press('Escape');
    out.requestsAreBrowserFixtures=true;
  } catch(error){out.failure=error.message;}
  return out;
}
