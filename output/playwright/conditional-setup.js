async page => {
  await page.unrouteAll();
  const origin='http://127.0.0.1:8337';
  const catalog=await(await page.request.get(origin+'/api/library')).json();
  const publicBooks=catalog.books.filter(b=>b.visibility==='public').slice(0,3),previews={};
  for(const book of publicBooks)previews[book.bookId]=await(await page.request.get(origin+'/api/library/books/'+book.bookId+'/preview')).json();
  const user={id:'isolated-conditional-ui',email:'conditional@example.invalid',displayName:'隔离读者'};
  const books=publicBooks.map((book,index)=>({...book,shelfPosition:index,resume:{passageId:previews[book.bookId].passageId,label:'隔离进度 · 开篇',updatedAt:new Date(Date.now()-index*1000).toISOString(),mode:'zh',variant:'interpretive'},journey:{status:'reading',dailyGoalMinutes:15,completedChapters:0,totalChapters:book.chapters||1}}));
  const token='A'.repeat(43),oldToken='B'.repeat(43);
  const state={user,books,trash:[],revision:1,fail:{},delay:{},requests:[],unhandled:[],gifts:[{token:oldToken,recipient:'旧信的读者',revoked:false,shareUrl:'/gift/'+oldToken}],token,oldToken,previews};
  await page.exposeFunction("__conditionalFixture",patch=>{if(patch)for(const [key,value]of Object.entries(patch))state[key]=value&&typeof value==="object"&&!Array.isArray(value)?{...state[key],...value}:value;return state;});
  const reply=(route,data,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
  await page.route('**/*',async route=>{
    const req=route.request(),url=new URL(req.url()),path=url.pathname,method=req.method();
    const action=path==='/api/account/profile'?'profile':path==='/api/library/order'?'order':path==='/api/library/upload'?'upload':path.split('/').at(-1);
    if(method!=='GET'){
      let body;try{body=req.postDataJSON();}catch{body={};}
      state.requests.push({method,path,body:{...body,...(body?.base64?{base64:'[isolated file omitted]'}:{}),...(body?.avatarData?{avatarData:'[isolated preview omitted]'}:{})}});
      if(state.delay[action])await new Promise(r=>setTimeout(r,state.delay[action]));
      if(state.fail[action]>0){state.fail[action]--;return reply(route,{error:'隔离验证：'+action+' 暂时未保存，请重试。'},503);}
      if(path==='/api/account/profile'){state.user={...state.user,displayName:body.displayName,...(body.avatarData===undefined?{}:{avatarUrl:body.avatarData})};return reply(route,{displayName:state.user.displayName,avatarUrl:state.user.avatarUrl});}
      if(path==='/api/library/order'){const rank=new Map(body.bookIds.map((id,i)=>[id,i]));state.books=state.books.map(b=>({...b,shelfPosition:rank.get(b.bookId)}));return reply(route,{revision:++state.revision});}
      const matched=path.match(/^\/api\/library\/books\/([^/]+)\/(archive|restore|reading-goal|reading-milestones|gifts)$/);
      if(matched){const [,id,kind]=matched,book=state.books.find(b=>b.bookId===id);
        if(kind==='archive'){state.trash.push(book);state.books=state.books.filter(b=>b.bookId!==id);return reply(route,{revision:++state.revision});}
        if(kind==='restore'){const saved=state.trash.find(b=>b.bookId===id);state.trash=state.trash.filter(b=>b.bookId!==id);state.books.push(saved);return reply(route,{revision:++state.revision});}
        if(kind==='reading-goal'){book.journey.dailyGoalMinutes=body.minutes;return reply(route,{...book.journey});}
        if(kind==='reading-milestones'){book.journey.status=body.type==='book_finished'?'finished':'reading';return reply(route,{...book.journey});}
        if(kind==='gifts'){const gift={token,recipient:body.recipient,message:body.message,includeTranslations:body.includeTranslations,revoked:false,shareUrl:'/gift/'+token};state.gifts.push(gift);return reply(route,gift);}
      }
      if(path==='/api/library/upload'){const uploaded={...state.books[0],bookId:'isolated-uploaded-text',visibility:'private',title:{zh:'隔离上传样本',en:'Isolated upload'},author:'界面验证',source:{format:'txt',filename:'conditional-fixture.txt'},resume:null,journey:null,shelfPosition:5};state.books.push(uploaded);return reply(route,uploaded);}
      if(/^\/api\/book-gifts\/[^/]+\/revoke$/.test(path)){const gift=state.gifts.find(g=>g.token===path.split('/')[3]);if(gift)gift.revoked=true;return reply(route,{revoked:true});}
      if(/^\/api\/book-gifts\/[^/]+\/accept$/.test(path))return reply(route,{bookId:publicBooks[0].bookId,readUrl:'/read?book='+publicBooks[0].bookId,alreadyOwned:true});
      state.unhandled.push({path,method});return reply(route,{error:'隔离验证已拦截未指定的写入。'},503);
    }
    if(!path.startsWith('/api/'))return route.continue();
    if(path==='/api/auth/session')return reply(route,{user:state.user,passwordAvailable:true,directUpload:false,providers:{}});
    if(path==='/api/library'){
      if(state.fail.library>0){state.fail.library--;return reply(route,{error:'隔离验证：书房暂时无法载入。'},503);}
      return reply(route,{books:state.books,shelfRevision:state.revision});
    }
    if(path==='/api/library/trash'){
      if(state.fail.trash>0){state.fail.trash--;return reply(route,{error:'隔离验证：回收站暂时无法载入。'},503);}
      return reply(route,{books:state.trash,revision:state.revision});
    }
    if(path==='/api/library/activity'){
      if(state.fail.activity>0){state.fail.activity--;return reply(route,{error:'隔离验证：近况暂时无法载入。'},503);}
      const date=new Intl.DateTimeFormat('en-CA').format(new Date()),book=state.books[0];
      return reply(route,{month:url.searchParams.get('month'),days:[{date,durationSeconds:300,notes:1,questions:1,chapterMarks:0,totalDetails:1,books:[{bookId:book.bookId,title:book.title,durationSeconds:300,notes:1,questions:1,chapterMarks:0,source:{bookId:book.bookId,passageId:previews[book.bookId]?.passageId}}],details:[{type:'question',bookId:book.bookId,passageId:previews[book.bookId]?.passageId,title:book.title,text:'隔离问题：作者为什么这样说？',createdAt:new Date().toISOString()}]}],readingDays:1,durationSeconds:300,notes:1,questions:1});
    }
    const matched=path.match(/^\/api\/library\/books\/([^/]+)\/(preview|gifts|chat)$/);
    if(matched){const [,id,kind]=matched;
      if(kind==='preview'){
        if(state.delay.preview)await new Promise(r=>setTimeout(r,state.delay.preview));
        if(state.fail.preview>0){state.fail.preview--;return reply(route,{error:'隔离验证：这一段暂未载入。'},503);}
        const p=previews[id]||previews[publicBooks[0].bookId];return reply(route,{...p,question:{id:'isolated-question',passageId:p.passageId,text:'隔离问题：这个意象如何理解？'}});
      }
      if(kind==='gifts')return reply(route,{gifts:state.gifts});
      if(kind==='chat')return reply(route,{available:false,context:previews[id],turns:[]});
    }
    const giftMatch=path.match(/^\/api\/book-gifts\/([A-Za-z0-9_-]{43})$/);
    if(giftMatch){
      if(state.fail.giftLoad>0){state.fail.giftLoad--;return reply(route,{error:'隔离验证：信笺暂时不可用。'},503);}
      if(state.revoked)return reply(route,{error:'隔离信已收回'},404);
      const b=publicBooks[0];return reply(route,{...b,token:giftMatch[1],sender:'隔离寄信人',recipient:'隔离收信人',message:'这一页，让我想起了你。\n这是界面验证信笺。',createdAt:new Date().toISOString(),includeTranslations:true,readUrl:'/read?book='+b.bookId});
    }
    if(/^\/api\/library\/books\/(gutenberg-alice|gutenberg-meditations|gutenberg-walden)(?:\/|$)/.test(path)){
      const headers={...req.headers()};delete headers['x-reader-owner'];const response=await route.fetch({headers}),responseHeaders={...response.headers()};delete responseHeaders['x-reader-session-changed'];return route.fulfill({response,headers:responseHeaders});
    }
    state.unhandled.push({path,method});return reply(route,{error:'隔离验证未开放此读取。'},503);
  });
  await page.setViewportSize({width:1440,height:1000});
  await page.goto(origin+'/library');
  await page.getByRole('button',{name:'隔离读者 · 账户设置'}).waitFor();
  return {books:state.books.map(b=>({bookId:b.bookId,title:b.title})),token,isolated:true};
}
