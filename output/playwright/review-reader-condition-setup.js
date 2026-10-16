async page => {
  await page.clock.resume();await page.unrouteAll();
  await page.evaluate(()=>{for(const key of Object.keys(localStorage))if(key.includes('|isolated-reader-review|'))localStorage.removeItem(key);});
  const base='http://127.0.0.1:8337',bookId='gutenberg-alice';
  const book=await (await page.request.get(base+'/api/library/books/'+bookId)).json();
  book.visibility='private';book.source={...book.source,format:'txt',filename:'isolated-source.txt'};
  const first=book.sections.flatMap(s=>s.paragraphs).find(p=>p.id===book.readingStart.passageId),section=book.sections.find(s=>s.paragraphs.some(p=>p.id===first.id));
  first.annotationIds=['isolated-annotation'];first.termIds=['isolated-term'];
  book.annotations.push({id:'isolated-annotation',kind:'context',attribution:'editorial',title:'隔离编辑注解',text:'这是一条用于检验归属与展开的隔离注解。'});
  book.glossary.push({id:'isolated-term',zh:'隔离术语',en:'isolated term',definition:'仅用于检查术语折叠与可读性。'});
  const fixture={book,bookId,firstId:first.id,secondId:section.paragraphs.find(p=>p.id!==first.id)?.id||first.id,chapterId:section.chapterId,loadFail:true,recordsFail:true,progressConflict:false,originalAvailable:true,originalDownloadFail:true,importFail:false,sessionSaveFail:true,noteSaveFail:true,prepareTranslationFail:true,dialogueFail:true,writes:[],reads:[]};
  const audioBytes=await (await page.request.get(base+'/assets/atmospheres/rain.mp3')).body();
  fixture.dialogue={id:'isolated-dialogue',bookId,chapterId:section.chapterId,revision:2,origin:'user-edited-ai',turns:[{speaker:'guide',text:'隔离新版讲稿：先核对原文。',sourceRefs:[{passageId:first.id,quote:first.original.slice(0,60)}]},{speaker:'questioner',text:'隔离追问：这一句的前提是什么？',sourceRefs:[{passageId:first.id,quote:first.original.slice(0,60)}]}]};
  fixture.audioSession={id:'isolated-audio-session',bookId,chapterId:section.chapterId,mode:'dialogue',status:'ready',language:'en',dialogueId:'isolated-dialogue',dialogueSnapshot:{...fixture.dialogue,revision:1,origin:'ai',turns:fixture.dialogue.turns.map(t=>({...t,text:t.text.replace('新版','旧版配音快照')}))},position:{clipIndex:0,seconds:0},clips:[{id:'isolated-audio-clip',passageId:first.id,status:'ready',voice:'Sulafat'}]};
  fixture.records={schemaVersion:3,comments:[],questions:[],readingSessions:[],readingMilestones:[],position:null};
  globalThis.reviewReaderFixture=fixture;
  await page.route('**/api/**',async route=>{
    const req=route.request(),u=new URL(req.url()),path=u.pathname;
    const reply=(data,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
    const failure=message=>reply({error:message},503);
    if(path==='/api/auth/session')return reply({user:{id:'isolated-reader-review',email:'review@example.invalid'},passwordAvailable:true,providers:{},translationAvailable:false});
    const prefix='/api/library/books/'+bookId;
    if(path===prefix){fixture.reads.push('book');return fixture.loadFail?failure('隔离书籍载入失败，请重试。'):reply(book);}
    const action=path.startsWith(prefix+'/')?path.slice(prefix.length+1):null;
    if(action==='records'){fixture.reads.push('records');return fixture.recordsFail?failure('隔离个人记录暂时无法读取。'):reply(fixture.records);}
    if(action==='progress'&&req.method()==='POST'){const data=req.postDataJSON();fixture.writes.push({action,data});if(fixture.progressConflict){fixture.progressConflict=false;return reply({error:'隔离位置已在另一处更新。'},409);}const saved={...data,revision:(fixture.records.position?.revision||0)+1,updatedAt:new Date().toISOString()};fixture.records.position=saved;return reply(saved);}
    if(action==='records/export')return reply({kind:'marginalia-records',bookId,...fixture.records});
    if(action==='records/import'&&req.method()==='POST'){const data=req.postDataJSON();fixture.writes.push({action,data});if(fixture.importFail)return failure('隔离记录包暂时无法合并，请重试。');return reply({merged:true});}
    if(action==='original/info')return reply(fixture.originalAvailable?{available:true,filename:'isolated-source.txt'}:{available:false,reason:'隔离示例：此书暂缺原文件。'});
    if(action==='original'){fixture.reads.push('original');if(fixture.originalDownloadFail){fixture.originalDownloadFail=false;return failure('隔离原文件下载失败，请重试。');}return route.fulfill({status:200,contentType:'text/plain',body:'Isolated original file for browser UI verification.\n'});}
    if(action==='reading-sessions'&&req.method()==='POST'){const data=req.postDataJSON();fixture.writes.push({action,data});if(fixture.sessionSaveFail)return failure('隔离时段保存失败，请重试。');fixture.records.readingSessions=[data];return reply(data);}
    if(['comments','questions'].includes(action)&&req.method()==='POST'){const data=req.postDataJSON();fixture.writes.push({action,data});if(fixture.noteSaveFail)return failure('隔离笔记保存失败，请重试。');const saved={...data,origin:'user',createdAt:new Date().toISOString()};fixture.records[action].push(saved);return reply(saved);}
    if(action==='audio/capabilities')return reply({local:true,speechAvailable:true,dialogueAvailable:true,voices:[{id:'Sulafat',label:'隔离正文声音'},{id:'Charon',label:'隔离讲解者'},{id:'Puck',label:'隔离提问者'}]});
    if(action==='audio/preferences')return reply({narrator:'Sulafat',guide:'Charon',questioner:'Puck',speed:1,follow:true});
    if(action==='audio/prepare'){const data=req.postDataJSON();fixture.writes.push({action,data});if(data.language==='zh'&&fixture.prepareTranslationFail)return failure('隔离译文尚未准备，请改听对应原文。');return reply({clips:[{text:'Isolated public text for listening UI.'}],estimate:{seconds:6,usdRange:{low:0.0001,high:0.0002}}});}
    if(action==='audio/dialogues'&&req.method()==='POST'){fixture.writes.push({action,data:req.postDataJSON()});if(fixture.dialogueFail){fixture.dialogueFail=false;return failure('隔离讲稿暂时无法生成，请重试。');}return reply(fixture.dialogue);}
    if(action==='audio/dialogues/isolated-dialogue')return reply(fixture.dialogue);
    if(action==='audio/records')return reply({sessions:[{...fixture.audioSession,readyCount:1,clipCount:1}],dialogues:[{id:'isolated-dialogue',chapterId:section.chapterId,revision:2,turnCount:2,origin:'user-edited-ai'}]});
    if(action==='audio/sessions/isolated-audio-session')return reply(fixture.audioSession);
    if(action==='audio/clips/isolated-audio-clip')return route.fulfill({status:200,contentType:'audio/mpeg',body:audioBytes});
    if(action==='audio/position')return reply({saved:true});
    fixture.reads.push({path,method:req.method()});return failure('隔离验收未开放此接口。');
  });
  await page.setViewportSize({width:1440,height:1000});await page.goto(base+'/read?book='+bookId);
  return {fixture:true,bookId,firstId:first.id,chapterId:section.chapterId};
}
