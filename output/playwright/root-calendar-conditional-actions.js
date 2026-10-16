async (page,width=1440) => {
 const out={fixture:true,width,checks:[],mutations:[]},check=(v,name)=>out.checks.push({name,pass:!!v});
 const catalog=await(await page.request.get('http://127.0.0.1:8337/api/library')).json();
 const first=catalog.books[0],preview=await(await page.request.get('http://127.0.0.1:8337/api/library/books/'+first.bookId+'/preview')).json();
 let activityReady=false,signedIn=true,logoutReady=false;
 const today=await page.evaluate(()=>{const p=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()).map(x=>[x.type,x.value]));return p.year+'-'+p.month+'-'+p.day;});
 const details=['reading','comment','question','chapter_read'].map((type,i)=>({id:'isolated-calendar-'+i,type,bookId:first.bookId,passageId:preview.passageId,title:first.title,createdAt:today+'T09:0'+i+':00.000Z',text:type==='comment'?'隔离日历：我的理解。':type==='question'?'隔离日历：还想核对原文。':null}));
 await page.unrouteAll();
 await page.route('**/api/**',async route=>{
  const req=route.request(),url=new URL(req.url()),path=url.pathname;
  const json=(body,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
  if(path==='/api/auth/session')return json({user:signedIn?{id:'isolated-calendar-review',email:'calendar@example.invalid',displayName:'隔离日历读者'}:null});
  if(req.method()!=='GET'){
   out.mutations.push({path,method:req.method()});
   if(path==='/api/auth/logout'){if(!logoutReady)return json({error:'隔离验证：退出暂时失败，请重试。'},503);signedIn=false;return json({ok:true});}
   return json({error:'隔离验证不执行真实写入。'},503);
  }
  if(path==='/api/library/activity'){
   if(!activityReady)return json({error:'隔离验证：阅读记录暂未载入，请重试。'},503);
   const month=url.searchParams.get('month'),has=month===today.slice(0,7);
   return json({month,readingDays:has?1:0,durationSeconds:has?420:0,notes:has?1:0,questions:has?1:0,days:has?[{date:today,durationSeconds:420,notes:1,questions:1,chapterMarks:1,totalDetails:details.length,details,books:[{bookId:first.bookId,title:first.title,durationSeconds:420,notes:1,questions:1,chapterMarks:1,source:details[0]}]}]:[]});
  }
  if(path==='/api/library')return json(catalog);
  const headers={...req.headers()};delete headers['x-reader-owner'];
  const response=await route.fetch({headers}),rh={...response.headers()};delete rh['x-reader-session-changed'];return route.fulfill({response,headers:rh});
 });
 try{
  await page.setViewportSize({width,height:width===390?844:1000});await page.goto('http://127.0.0.1:8337/library?calendar=1');
  const calendar=page.locator('#reading-history');await calendar.waitFor({state:'visible'});
  const retry=calendar.getByRole('button',{name:'重新载入',exact:true});await retry.waitFor({state:'visible'});
  check((await calendar.innerText()).includes('隔离验证：阅读记录暂未载入'),'calendar error explains failure rather than empty records');
  out.errorDateLabel=await calendar.locator('[data-date="'+today+'"]').getAttribute('aria-label');check(out.errorDateLabel.includes('未载入'),'failed calendar dates do not claim there are no records');
  out.errorFocus=await page.evaluate(()=>document.activeElement?.outerHTML.slice(0,180));
  await page.screenshot({path:'output/playwright/root-calendar-error-'+width+'.png'});
  activityReady=true;await retry.click();await calendar.locator('.day-history').waitFor({state:'visible'});
  check(!(await retry.isVisible()),'retry disappears after successful isolated response');
  out.afterRetryFocus=await page.evaluate(()=>({tag:document.activeElement?.tagName,id:document.activeElement?.id,date:document.activeElement?.dataset.date,text:document.activeElement?.textContent.slice(0,100)}));check(out.afterRetryFocus.date===today,'successful retry restores the selected calendar date focus');
  check((await calendar.locator('.day-counts').innerText()).includes('1 条笔记'),'calendar preserves returned counts');
  const history=calendar.locator('.day-history > summary');await history.focus();await history.press('Enter');check(await calendar.locator('.day-history').evaluate(n=>n.open),'keyboard expands day records');
  out.links=await calendar.locator('.day-books a,.day-record').evaluateAll(ns=>ns.map(n=>({name:n.innerText,href:n.getAttribute('href'),width:n.getBoundingClientRect().width,height:n.getBoundingClientRect().height})));
  check(out.links.every(n=>n.href.includes('book='+first.bookId)&&n.href.includes('passage='+preview.passageId)),'day links retain actual public book and passage');
  check(out.links.some(n=>n.href.includes('note=question')),'question link retains note type');
  out.navigations=[];
  for(const [selector,method] of [['.day-books a','keyboard'],['.day-record[href*="note=question"]','pointer']]){
   if(!await calendar.locator('.day-history').evaluate(n=>n.open))await calendar.locator('.day-history > summary').press('Enter');
   const link=calendar.locator(selector).first();
   if(method==='keyboard')await link.press('Enter');else await link.click();
   await page.waitForURL(/\/read\?book=/);await page.waitForFunction(()=>document.body.dataset.ready==='true');
   const destination=new URL(page.url()),state=await page.evaluate(id=>({targetTop:document.getElementById(id)?.getBoundingClientRect().top,targetBottom:document.getElementById(id)?.getBoundingClientRect().bottom,anchor:window.marginaliaReader.getAnchor()?.passageId,selected:window.marginaliaReader.getSelectedId(),panelVisible:!document.querySelector('#note-panel').hidden,tab:document.querySelector('.panel-tabs [aria-selected=true]')?.dataset.panelTab}),preview.passageId);out.navigations.push({method,url:page.url(),ready:await page.locator('body').getAttribute('data-ready'),...state});
   check(destination.searchParams.get('book')===first.bookId&&(Math.abs(state.targetTop-160)<2||state.selected===preview.passageId),'actual '+method+' day link reaches the matching public passage');
   if(method==='pointer')check(state.panelVisible&&state.tab==='question'&&state.selected===preview.passageId,'actual question record opens the matching question panel');
   await page.goto('http://127.0.0.1:8337/library?calendar=1');await calendar.waitFor({state:'visible'});await calendar.locator('.day-history').waitFor({state:'visible'});
  }
  if(!await calendar.locator('.day-history').evaluate(n=>n.open))await calendar.locator('.day-history > summary').press('Enter');
  await page.screenshot({path:'output/playwright/root-calendar-records-'+width+'.png'});
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:'output/playwright/root-calendar-records-390.png'});
  out.mobile=await calendar.locator('.day-history > summary,.day-books a,.day-record').evaluateAll(ns=>ns.map(n=>({name:n.innerText,width:n.getBoundingClientRect().width,height:n.getBoundingClientRect().height})));
  out.closeGeometry=await calendar.evaluate(d=>{const b=d.querySelector('.dialog-close'),r=b.getBoundingClientRect(),c=d.getBoundingClientRect();return {dialog:{top:c.top,bottom:c.bottom,scrollTop:d.scrollTop,overflow:getComputedStyle(d).overflow},close:{top:r.top,bottom:r.bottom,left:r.left,right:r.right,width:r.width,height:r.height},visibleHeight:Math.max(0,Math.min(r.bottom,c.bottom,innerHeight)-Math.max(r.top,c.top,0)),visibleWidth:Math.max(0,Math.min(r.right,c.right,innerWidth)-Math.max(r.left,c.left,0))};});check(out.closeGeometry.close.left>195,'calendar close retains its expected right-side position');check(out.closeGeometry.visibleHeight>=43.9&&out.closeGeometry.visibleWidth>=43.9,'calendar close remains a fully visible 44px target after details scrolling');
  out.overflow=await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth);check(out.overflow===0,'390 no horizontal overflow');
  await page.mouse.move(185,700);await page.mouse.wheel(0,2400);await page.waitForFunction(()=>{const d=document.querySelector('#reading-history');return d.scrollTop+d.clientHeight>=d.scrollHeight-2;});
  out.closeGeometryEnd=await calendar.evaluate(d=>{const b=d.querySelector('.dialog-close'),r=b.getBoundingClientRect(),c=d.getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,right:r.right,width:r.width,height:r.height,scrollTop:d.scrollTop,visibleHeight:Math.max(0,Math.min(r.bottom,c.bottom,innerHeight)-Math.max(r.top,c.top,0)),visibleWidth:Math.max(0,Math.min(r.right,c.right,innerWidth)-Math.max(r.left,c.left,0))};});
  check(out.closeGeometryEnd.visibleHeight>=43.9&&out.closeGeometryEnd.visibleWidth>=43.9,'calendar close remains fully visible at the bottom of long records');
  await page.screenshot({path:'output/playwright/root-calendar-bottom-'+width+'.png'});
  if(out.closeGeometryEnd.visibleHeight>=43.9){await page.mouse.click((out.closeGeometryEnd.left+out.closeGeometryEnd.right)/2,(out.closeGeometryEnd.top+out.closeGeometryEnd.bottom)/2);await calendar.waitFor({state:'hidden'});check(true,'calendar close responds to a real pointer at the bottom without automatic scrolling');}else await calendar.press('Escape');
  await page.setViewportSize({width,height:width===390?844:1000});await page.locator(width===390?'#library-menu':'#library-settings').waitFor({state:'visible'});if(!await page.locator('#library-settings').isVisible())await page.locator('#library-menu').click();await page.locator('#library-settings').click();
  const settings=page.locator('#library-settings-dialog'),logout=settings.getByRole('button',{name:'退出登录',exact:true});await logout.click();await settings.getByText('隔离验证：退出暂时失败，请重试。',{exact:true}).waitFor();
  out.afterLogoutErrorFocus=await page.evaluate(()=>({tag:document.activeElement?.tagName,id:document.activeElement?.id,text:document.activeElement?.textContent.slice(0,90)}));
  check(await logout.isEnabled(),'logout failure restores retry control');
  check((await page.locator('#library-account').getAttribute('aria-label')).includes('隔离日历读者'),'logout failure retains current account context');check(out.afterLogoutErrorFocus.tag==='BUTTON'&&out.afterLogoutErrorFocus.text==='退出登录','logout error restores focus to the retryable logout button');
  await page.screenshot({path:'output/playwright/root-logout-error-'+width+'.png'});
  logoutReady=true;await logout.click();await settings.getByText('已退出。自己的书与记录仍保存在原账户。',{exact:true}).waitFor();await page.waitForFunction(()=>document.querySelector('#library-account')?.textContent.includes('进入自己的书房'));
  check(!(await page.locator('body').innerText()).includes('calendar@example.invalid'),'logout success removes synthetic identity');
  out.afterLogoutSuccessFocus=await page.evaluate(()=>({tag:document.activeElement?.tagName,id:document.activeElement?.id,text:document.activeElement?.textContent.slice(0,90)}));check(out.afterLogoutSuccessFocus.tag==='BUTTON'&&out.afterLogoutSuccessFocus.text==='登录或注册','completed logout focuses the login entry');
 }catch(e){out.failure=e.message;}
 return out;
}
