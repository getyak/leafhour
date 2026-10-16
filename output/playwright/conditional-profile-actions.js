async page => {
 const control=patch=>page.evaluate(patch=>window.__conditionalFixture(patch),patch),out={group:'N38–43',checks:[],targets:[]};
 const check=(v,label)=>{out.checks.push({label,pass:!!v});if(!v)throw Error(label);};
 const count=async()=>(await control()).requests.filter(r=>r.path==='/api/account/profile').length;
 try{
  await control({requests:[],fail:{profile:0},delay:{profile:0}});await page.setViewportSize({width:1440,height:1000});await page.goto('http://127.0.0.1:8337/library');
  await page.getByRole('button',{name:'隔离读者 · 账户设置'}).click();
  const name=page.getByRole('textbox',{name:'怎么称呼你'}),email=page.getByRole('textbox',{name:'登录邮箱'}),save=page.getByRole('button',{name:'保存个人资料',exact:true}),file=page.locator('#profile-avatar-file');
  check(await email.inputValue()==='conditional@example.invalid'&&await email.evaluate(n=>n.readOnly),'read-only current identity');
  await name.fill('保留的资料草稿');await file.setInputFiles({name:'invalid.svg',mimeType:'image/svg+xml',buffer:Buffer.from('<svg/>')});
  await page.waitForFunction(()=>document.querySelector('#profile-status').textContent.includes('JPG'));
  check(await count()===0&&await name.inputValue()==='保留的资料草稿','invalid avatar never submits and retains name');
  const png=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=80;c.height=40;const x=c.getContext('2d');x.fillStyle='#426048';x.fillRect(0,0,80,40);return c.toDataURL().split(',')[1];});
  await file.setInputFiles({name:'avatar.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});
  await page.waitForFunction(()=>document.querySelector('#profile-status').textContent.includes('准备好'));
  check(await page.locator('.profile-avatar img').count()===1&&await count()===0,'local bounded avatar preview precedes explicit save');
  await file.setInputFiles([]);check(await name.inputValue()==='保留的资料草稿','cancelled file selection retains draft');
  await control({fail:{profile:1},delay:{profile:1200}});
  await save.click();await page.keyboard.press('Enter');
  check(await page.evaluate(()=>['profile-display-name','profile-avatar-file','profile-avatar-reset','profile-save'].every(id=>document.getElementById(id).disabled)),'profile busy locks all editing controls');
  await page.waitForFunction(()=>document.querySelector('#profile-status').textContent.includes('暂时未保存'));
  check(await count()===1&&await name.inputValue()==='保留的资料草稿'&&!await save.isDisabled(),'failed save retains draft and allows one retry');
  await save.click();await page.waitForFunction(()=>document.querySelector('#profile-status').textContent==='个人资料已保存。');
  check(await count()===2&&await page.locator('#library-account').getAttribute('aria-label')==='保留的资料草稿 · 账户设置','successful profile updates visible identity');
  await page.getByRole('button',{name:'恢复默认头像'}).click();
  check((await page.locator('#profile-status').innerText()).includes('保存后')&&await count()===2,'reset is an explicit pending preview');
  await save.click();await page.waitForFunction(()=>document.querySelector('#profile-status').textContent==='个人资料已保存。');
  check((await control()).requests.at(-1).body.avatarData===null,'default avatar applies only after save');
  for(const width of [1440,390]){
   await page.setViewportSize({width,height:1000});await page.waitForTimeout(180);
   const rects=await page.locator('#settings-panel-account').locator('button,input:not([type=file]),label[for=profile-avatar-file]').evaluateAll(nodes=>nodes.filter(n=>n.getClientRects().length).map(n=>({name:n.getAttribute('aria-label')||n.textContent.trim()||n.id,width:n.getBoundingClientRect().width,height:n.getBoundingClientRect().height})));
   out.targets.push({width,rects});check(rects.every(r=>r.height>=44),'profile targets '+width+' at least 44 high');
   check(await page.evaluate(()=>document.documentElement.scrollWidth===innerWidth),'profile '+width+' no horizontal overflow');
   await page.screenshot({path:'output/playwright/conditional-profile-'+width+'.png'});
  }
  await page.getByRole('tab',{name:'账户',exact:true}).focus();await page.keyboard.press('ArrowRight');check(await page.getByRole('tab',{name:'外观',exact:true}).getAttribute('aria-selected')==='true','settings tab key advances exactly once');
  await page.keyboard.press('Home');check(await page.getByRole('tab',{name:'账户',exact:true}).getAttribute('aria-selected')==='true','Home returns to account tab');
  await page.keyboard.press('Escape');await page.waitForTimeout(50);check(await page.locator('#library-menu').evaluate(n=>n===document.activeElement),'mobile close returns to navigation launcher');
 }catch(error){out.failure=error.message;}
 out.requests=(await control()).requests.filter(r=>r.path==='/api/account/profile');return out;
}
