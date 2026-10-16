async page => {
 const out={fixture:true,baseline:'origin/main79b3025 integrated',widths:[],mutations:[],externalNavigations:[],blocked:[]};
 try{
  await page.context().unrouteAll();await page.unrouteAll();await page.context().grantPermissions(['clipboard-read','clipboard-write']);
  const base='http://127.0.0.1:8337',catalog=await(await page.request.get(base+'/api/library')).json(),books=catalog.books.filter(b=>b.visibility==='public'),data={},previews={};
  for(const b of books){data[b.bookId]=await(await page.request.get(base+'/api/library/books/'+b.bookId)).json();previews[b.bookId]=await(await page.request.get(base+'/api/library/books/'+b.bookId+'/preview')).json();}
  const alice=books.find(b=>b.bookId==='gutenberg-alice'),other=books.find(b=>b.bookId==='gutenberg-meditations'),third=books.find(b=>b.bookId==='gutenberg-walden');
  const paragraph=id=>data[id].sections.flatMap(s=>s.paragraphs).find(p=>p.id===data[id].readingStart.passageId);
  const ref=id=>({bookId:id,passageId:paragraph(id).id,quote:paragraph(id).original.slice(0,80),layer:'original',url:'/read?book='+id+'&passage='+paragraph(id).id});
  const refs=[ref(alice.bookId),ref(other.bookId)],external='https://example.com/marginalia-agent-review';
  const markdown='## 隔离回答：先核对原文\n\n这是一份**界面夹具**，不是模型结果。可以[回到当前原句]('+refs[0].url+')、[核对另一本原句]('+refs[1].url+')，或[查看普通外部资料]('+external+')。\n\n- 第一条：保留出处与用户问题的区别。\n- 第二条：相关书目只是检索候选。\n\n| 第一列 | 第二列 | 第三列 | 第四列 | 第五列 |\n| --- | --- | --- | --- | --- |\n| 原文 | 译文 | 注解 | 用户笔记 | 书目结果 |\n\n```text\n'+('public-fixture-code-'.repeat(20))+'\n```\n\n> 仅观察条件界面的可读性。\n\n<img src=x onerror=alert(1)>\n\n[不安全协议](javascript:alert(1))';
  const completed=(id='isolated-agent-history')=>({id,bookId:alice.bookId,passageId:previews[alice.bookId].passageId,contentVersion:previews[alice.bookId].contentVersion,text:'隔离提问：请对比章节并找下一本。',origin:'user',status:'completed',createdAt:new Date().toISOString(),activity:[{tool:'reader_read_chapter',bookId:alice.bookId,chapterId:'chapter-a',status:'completed',label:'查阅第一章'},{tool:'reader_read_chapter',bookId:alice.bookId,chapterId:'chapter-b',status:'completed',label:'查阅第二章'},{tool:'web_search',status:'failed',label:'检索站外资料'}],answer:{summary:markdown,sourceRefs:refs,recommendations:[{title:'爱丽丝梦游仙境',bookId:alice.bookId,owned:true,source:'library',url:'/read?book='+alice.bookId},{title:'瓦尔登湖',bookId:third.bookId,owned:false,source:'catalog',url:'/read?book='+third.bookId},{title:'隔离外部书目',owned:false,source:'openlibrary',url:external},{title:'不得出现的第四候选',owned:false,source:'openlibrary',url:'https://example.com/fourth'}]}});
  const fixture={turns:[completed()],post:null,postRelease:null,pendingGetCount:0};let clockInstalled=false;
  await page.context().route('**/*',async route=>{
   const req=route.request(),u=new URL(req.url()),path=u.pathname,method=req.method();const reply=(body,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
   if(u.origin!==base){out.externalNavigations.push({url:u.href,method});return method==='GET'?route.fulfill({contentType:'text/html',body:'<!doctype html><title>Isolated external target</title><p>External destination fixture; no external request was sent.</p>'}):reply({error:'blocked external mutation'},503);}
   if(path==='/api/auth/session')return reply({user:{id:'isolated-agent-ui-review',email:'review@example.invalid'},passwordAvailable:true,providers:{}});
   if(path==='/api/library')return reply({books});
   if(path==='/api/library/activity')return reply({month:u.searchParams.get('month'),days:[],readingDays:0,durationSeconds:0,notes:0,questions:0});
   const m=path.match(/^\/api\/library\/books\/([^/]+)(?:\/(.*))?$/);
   if(m&&data[m[1]]){const id=m[1],action=m[2];
    if(!action&&method==='GET')return reply(data[id]);
    if(action==='preview'&&method==='GET')return reply(previews[id]);
    if(action==='records'&&method==='GET')return reply({schemaVersion:3,comments:[],questions:[],readingSessions:[],readingMilestones:[],position:null});
    if(action==='chat'&&method==='GET'){if(fixture.post)fixture.pendingGetCount++;return reply({bookId:id,title:books.find(b=>b.bookId===id).title,contentVersion:previews[id].contentVersion,available:true,context:previews[id],turns:fixture.turns.filter(t=>t.bookId===id)});}
    if(action==='chat'&&method==='POST'){const payload=req.postDataJSON();out.mutations.push({kind:'chat-send',path,payload});const turn={...payload,bookId:id,origin:'user',status:'running',createdAt:new Date().toISOString(),activity:[{tool:'reader_read_chapter',bookId:id,chapterId:'chapter-a',status:'running',label:'正在查阅第一章'}],answer:null};fixture.turns.push(turn);fixture.post={route,turn};return new Promise(resolve=>fixture.postRelease=resolve);}
    if(/^chat\/[^/]+\/cancel$/.test(action)&&method==='POST'){out.mutations.push({kind:'chat-cancel',path});const turn=fixture.turns.find(t=>t.id===action.split('/')[1]);turn.status='cancelled';return reply(turn);}
   }
   if(path.startsWith('/api/')){out.blocked.push({method,path});return reply({error:'isolated new chat review: endpoint not exposed'},503);}
   if(method!=='GET'){out.blocked.push({method,path});return reply({error:'isolated new chat review: no writes'},503);}
   return route.continue();
  });
  for(const width of [1440,390]){
   await page.setViewportSize({width,height:width===390?844:1000});await page.goto(base+'/read?book='+alice.bookId);await page.locator('body[data-ready="true"]').waitFor();await page.locator('.library-chat-launcher').focus();await page.keyboard.press('Enter');await page.locator('.library-chat-answer').waitFor();await page.waitForTimeout(250);
   const row={width,checks:[]};out.widths.push(row);
   const geometry=async()=>page.locator('#reader-conversation').evaluate(d=>{const r=d.getBoundingClientRect(),h=d.querySelector('.library-chat-header').getBoundingClientRect(),f=d.querySelector('.library-chat-frame'),c=d.querySelector('.library-chat-close').getBoundingClientRect(),m=d.querySelector('.library-chat-messages');return {rootTop:r.top,rootBottom:r.bottom,rootScroll:d.scrollTop,frameTop:f.getBoundingClientRect().top,frameScroll:f.scrollTop,headerTop:h.top,headerBottom:h.bottom,closeTop:c.top,closeBottom:c.bottom,closeHeight:c.height,messagesTop:m.getBoundingClientRect().top,messagesScroll:m.scrollTop};});
   row.open=await geometry();await page.locator('button[aria-label="复制这条 AI 回答"]').focus();let reached=false;
   for(let i=0;i<12;i++){await page.keyboard.press('Tab');if(await page.evaluate(()=>document.activeElement?.tagName==='SUMMARY'&&!!document.activeElement.closest('.library-chat-activity-details'))){reached=true;break;}}
   row.focused=await geometry();await page.keyboard.press('Enter');await page.waitForTimeout(80);row.expanded=await geometry();
   row.checks.push({label:'native Tab reaches tool summary',pass:reached});row.checks.push({label:'native keyboard expansion preserves44 close inside panel',pass:row.expanded.closeTop>=row.expanded.rootTop&&row.expanded.closeBottom<=row.expanded.rootBottom&&row.expanded.closeHeight>=44});
   await page.screenshot({path:'output/playwright/review-agent-layout-'+width+'-native.png',animations:'disabled'});
   await page.locator('.library-chat-activity-details').first().scrollIntoViewIfNeeded();row.helperScroll=await geometry();await page.keyboard.press('Escape');
  }
 }catch(error){out.failure=error.message;}
 return out;
}
