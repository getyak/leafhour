import {billingErrorDetails} from './billing-routes.mjs';
import {contentSecurityPolicy} from './content-security.mjs';
import {authMessageId} from '../app/auth-errors.mjs';
import {audioFailureCode} from '../app/audio-errors.mjs';
import http from 'node:http';
import {cjkFontAssets} from './cjk-font-assets.mjs';
import {normalizeAppearance} from '../app/reading-preferences.mjs';
import {validParagraphAnchor} from '../app/paragraph-anchor.mjs';
import {applyPersonalRecordEdit,validatePersonalRecordMetadata,decodePersonalRecordId} from '../app/personal-records.mjs';
import {normalizeHighlight,saveHighlight,findHighlight,mergeHighlights} from '../app/highlights.mjs';
import {createExperienceService} from './experience-service.mjs';
import {createPortal} from './portal.mjs';
import {readFile,writeFile,rename,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {loadLocalEnvironment} from './local-env.mjs';
import {configurationSummary} from './model-config.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
// The verification page reads the same private, local observations as the book page.
const assets=new Map([['/',['app/index.html','text/html']],['/styles.css',['app/styles.css','text/css']],['/reader.js',['app/reader.js','text/javascript']],['/experiences.js',['app/experiences.js','text/javascript']],['/experiences.css',['app/experiences.css','text/css']],['/typography.css',['app/typography.css','text/css']],['/fonts/newsreader/newsreader-var.woff2',['app/fonts/newsreader/newsreader-var.woff2','font/woff2']],['/fonts/newsreader/newsreader-italic-var.woff2',['app/fonts/newsreader/newsreader-italic-var.woff2','font/woff2']],['/fonts/newsreader/OFL.txt',['app/fonts/newsreader/OFL.txt','text/plain']]]);
for(const file of ['interaction-craft.css','interface-tokens.css','interaction-craft.mjs','action-focus.mjs'])assets.set('/'+file,['app/'+file,file.endsWith('.css')?'text/css':'text/javascript']);
for(const file of ['reader-annotations.mjs','reader-annotation-margins.mjs','reader-annotation-pending.mjs','reader-annotation-records.mjs','reader-annotations.css','library-chat-markdown.mjs'])assets.set('/'+file,['app/'+file,file.endsWith('.css')?'text/css':'text/javascript']);
assets.set('/preference-memory-codec.mjs',['app/preference-memory-codec.mjs','text/javascript']);
assets.set('/reading-preferences.mjs',['app/reading-preferences.mjs','text/javascript']);
assets.set('/personal-records.mjs',['app/personal-records.mjs','text/javascript']);
assets.set('/reading-chat-scope.mjs',['app/reading-chat-scope.mjs','text/javascript']);
for(const file of ['reading-chat-quote.mjs','reading-chat-input.mjs','reader-chat-workspace.mjs','reader-chat-workspace.css'])assets.set('/'+file,['app/'+file,file.endsWith('.css')?'text/css':'text/javascript']);
assets.set('/personal-record-editor.mjs',['app/personal-record-editor.mjs','text/javascript']);
assets.set('/toolbar-placement.mjs',['app/toolbar-placement.mjs','text/javascript']);
assets.set('/note-drafts.mjs',['app/note-drafts.mjs','text/javascript']);
assets.set('/translation-state.mjs',['app/translation-state.mjs','text/javascript']);
assets.set('/reader-return.mjs',['app/reader-return.mjs','text/javascript']);
assets.set('/passage-layers.mjs',['app/passage-layers.mjs','text/javascript']);
assets.set('/source-emphasis.mjs',['app/source-emphasis.mjs','text/javascript']);
assets.set('/share-fonts.mjs',['app/share-fonts.mjs','text/javascript']);
assets.set('/reader-entry.mjs',['app/reader-entry.mjs','text/javascript']);
assets.set('/catalog-sample.mjs',['app/catalog-sample.mjs','text/javascript']);
assets.set('/reader-navigation.mjs',['app/reader-navigation.mjs','text/javascript']);
// GET-173 shared popover boundary plus its real user-open bookplate bootstrap.
for(const file of ['popover-controls.mjs','reader-book-actions-bootstrap.mjs'])assets.set('/'+file,['app/'+file,'text/javascript']);
for(const file of ['book-introduction.mjs','book-introduction-controller.mjs','reader-book-actions.mjs','reader-book-actions.css'])assets.set('/'+file,['app/'+file,file.endsWith('.css')?'text/css':'text/javascript']);
assets.set('/reader-immersion.mjs',['app/reader-immersion.mjs','text/javascript']);
assets.set('/reader-tools.mjs',['app/reader-tools.mjs','text/javascript']);
assets.set('/reader-settings.mjs',['app/reader-settings.mjs','text/javascript']);
assets.set('/reader-settings-choices.mjs',['app/reader-settings-choices.mjs','text/javascript']);
assets.set('/reader-settings.css',['app/reader-settings.css','text/css']);
for(const file of ['choice-control.mjs','choice-control.css'])assets.set('/'+file,['app/'+file,file.endsWith('.css')?'text/css':'text/javascript']);
assets.set('/reader-navigation.css',['app/reader-navigation.css','text/css']);
for(const file of ['reader-pagination.mjs','reader-pagination.css'])assets.set('/'+file,['app/'+file,file.endsWith('.css')?'text/css':'text/javascript']);
assets.set('/parallel-reading.mjs',['app/parallel-reading.mjs','text/javascript']);
assets.set('/parallel-reading.css',['app/parallel-reading.css','text/css']);
assets.set('/grant-result.mjs',['app/grant-result.mjs','text/javascript']);
assets.set('/mcp-config.mjs',['app/mcp-config.mjs','text/javascript']);
const downloads=new Map([['/exports/bilingual.md','book-bilingual.md'],['/exports/literal.md','book-literal.md'],['/exports/interpretive.md','book-interpretive.md'],['/exports/reading-pack.zip','reading-pack.zip']]);
for(const asset of cjkFontAssets)assets.set(asset.url,['app/'+asset.file,asset.mime]);
for(const file of ['reader-audio.js','reader-audio-bootstrap.mjs','reader-audio-metadata.mjs','reader-audio.css','audio-state.mjs'])assets.set('/'+file,['app/'+file,file.endsWith('.css')?'text/css':'text/javascript']);
assets.set('/listening-guide-state.mjs',['app/listening-guide-state.mjs','text/javascript']);
for(const file of ['reader-atmosphere.js','reader-atmosphere.css','atmosphere-state.mjs','atmosphere-audio.mjs','hearth-motion.mjs','nature-motion.mjs'])assets.set('/'+file,['app/'+file,file.endsWith('.css')?'text/css':'text/javascript']);
for(const name of ['forest','rain','hearth','sea'])assets.set('/assets/atmospheres/'+name+'.jpg',['app/assets/atmospheres/'+name+'.jpg','image/jpeg']);
for(const name of ['wind','birds','rain','fire','waves'])assets.set('/assets/atmospheres/'+name+'.mp3',['app/assets/atmospheres/'+name+'.mp3','audio/mpeg']);
assets.set('/assets/atmospheres/NOTICE.md',['app/assets/atmospheres/NOTICE.md','text/plain']);
for(const [url,file,type] of [['/share.js','app/share.js','text/javascript'],['/share-model.mjs','app/share-model.mjs','text/javascript'],['/share.css','app/share.css','text/css']])assets.set(url,[file,type]);
assets.set('/evals',['app/evals.html','text/html']);assets.set('/evals.js',['app/evals.js','text/javascript']);assets.set('/evals.css',['app/evals.css','text/css']);
const fail=(message,status=400)=>Object.assign(new Error(message),{status});

export async function createReaderServer({bookPath=path.join(root,'local/finite-infinite-games/book.json'),recordsPath=path.join(root,'local/service/records.json'),publicOrigin=null,experienceStorePath=path.join(path.dirname(recordsPath),'experience-records.json'),experiencePackPath=path.join(path.dirname(bookPath),'experience-pack.json'),generator=null,portalDataDir=path.join(path.dirname(recordsPath),'portal'),sendCode,translator,allowLocal=true,speechProvider,dialogueGenerator,guideGenerator,chatGenerator,companionGenerator,introductionGenerator,giftQuoteGenerator=null,annotationGenerator,dataStore=null,authService=null,paddleProvider,env=process.env}={}){
  const portal=await createPortal({dataDir:portalDataDir,publicOrigin,sendCode,translator,allowLocal,speechProvider,dialogueGenerator,guideGenerator,chatGenerator,companionGenerator,introductionGenerator,giftQuoteGenerator,annotationGenerator,dataStore,authService,paddleProvider,env});
  let book;try{book=JSON.parse(await readFile(bookPath,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;book=await portal.library.getBook(null,'gutenberg-alice');}
  if(!Array.isArray(book.sections)||!Array.isArray(book.chapters))throw Error('Reading package is not ready');
  portal.setLegacyBook(book);
  const experiences=await createExperienceService({book,storePath:experienceStorePath,packPath:experiencePackPath,generator});
  const ids=new Set(book.sections.flatMap(s=>s.paragraphs.map(p=>p.id))),chapterIds=new Set(book.chapters.map(c=>c.id));
  const legacyIds=new Set(['fig-1986-s001-p001','fig-1986-s001-p002','fig-1986-s002-p001','fig-1986-s002-p002']);
  const empty=()=>({kind:'marginalia-personal-records',schemaVersion:2,bookId:book.bookId,contentVersion:book.contentVersion,comments:[],questions:[],readingSessions:[],position:null});
  await mkdir(path.dirname(recordsPath),{recursive:true,mode:0o700});
  let writes=Promise.resolve();
  const readRecords=async()=>{try{return JSON.parse(await readFile(recordsPath,'utf8'));}catch(e){if(e.code==='ENOENT')return empty();throw e;}};
  const mutate=operation=>{const work=writes.catch(()=>{}).then(async()=>{const records=await readRecords();const result=operation(records);const temp=recordsPath+'.pending';await writeFile(temp,JSON.stringify(records,null,2),{mode:0o600});await rename(temp,recordsPath);return result;});writes=work;return work;};
  const checkPosition=p=>{
    if(!p||!chapterIds.has(p.chapterId)||!ids.has(p.passageId)||!book.sections.some(s=>s.chapterId===p.chapterId&&s.paragraphs.some(x=>x.id===p.passageId)))throw fail('阅读位置无法对应当前章节');
    if(!validParagraphAnchor(p)||!['zh','en','parallel'].includes(p.mode)||!['literal','interpretive'].includes(p.variant)||!Number.isFinite(p.font)||typeof p.theme!=='string')throw fail('阅读偏好格式不正确');
    let appearance;try{appearance=normalizeAppearance(p,true);}catch{throw fail('阅读偏好格式不正确');}
    return {chapterId:p.chapterId,passageId:p.passageId,offset:p.offset,...(p.withinParagraph!==undefined?{withinParagraph:p.withinParagraph}:{}),mode:p.mode,variant:p.variant,...appearance,updatedAt:new Date().toISOString()};
  };
  const cleanRecord=(r,type)=>{
    if(!r||typeof r.id!=='string'||!r.id||r.id.length>128||!ids.has(r.passageId)||typeof r.text!=='string'||!r.text.trim()||r.text.length>2000)throw fail('记录无法安全对应原文');
    if(r.bookId&&r.bookId!==book.bookId)throw fail('记录不属于这本书');
    if(r.origin&&r.origin!=='user')throw fail('用户原话与其他内容需要分开');
    const version=r.contentVersion||book.contentVersion;
    if(version!==book.contentVersion&&!(version==='design-sample-1'&&legacyIds.has(r.passageId)))throw fail('记录的来源版本不兼容');
    if(r.createdAt&&!Number.isFinite(Date.parse(r.createdAt)))throw fail('记录日期不正确');
    validatePersonalRecordMetadata(r);
    const createdAt=r.createdAt||new Date().toISOString(),out={id:r.id,bookId:book.bookId,passageId:r.passageId,contentVersion:version,text:r.text,origin:'user',createdAt,updatedAt:r.updatedAt||createdAt,revision:r.revision||0,...(r.lastEditId?{lastEditId:r.lastEditId}:{})};
    if(typeof r.quote==='string'&&r.quote.length<=4000){out.quote=r.quote;out.quoteLanguage=['zh','en'].includes(r.quoteLanguage)?r.quoteLanguage:'zh';if(['original','translation'].includes(r.quoteOrigin))out.quoteOrigin=r.quoteOrigin;}
    if(type==='question')out.status='open';return out;
  };
  const parseBody=async(req,limit=4*1024*1024)=>{
    if(!req.headers['content-type']?.startsWith('application/json'))throw fail('需要JSON记录',415);
    let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>limit)throw fail('记录包过大',413);chunks.push(chunk);}try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw fail('记录包不是有效JSON');}
  };
  const server=http.createServer(async(req,res)=>{
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','same-origin');res.setHeader('Cache-Control','no-store');
    res.setHeader('Content-Security-Policy',contentSecurityPolicy());
    const send=(status,data,type='application/json')=>{res.statusCode=status;res.setHeader('Content-Type',type+'; charset=utf-8');res.end(type==='application/json'?JSON.stringify(data):data);};
    try{
      const port=server.address()?.port,host=req.headers.host;
      const allowed=new Set(['127.0.0.1:'+port,'localhost:'+port,'[::1]:'+port]);if(publicOrigin)allowed.add(new URL(publicOrigin).host);
      if(!allowed.has(host))throw fail('当前地址未授权',403);
      const url=new URL(req.url,'http://'+host);
      res.setHeader('Content-Security-Policy',contentSecurityPolicy(url.pathname));
      if(url.pathname==='/read'||url.pathname==='/evals'||url.pathname.startsWith('/api/'))res.setHeader('X-Robots-Tag','noindex, nofollow, noarchive');
      if(url.pathname==='/gift-preview')res.setHeader('Content-Security-Policy',res.getHeader('Content-Security-Policy').replace("frame-ancestors 'none'","frame-ancestors 'self'"));
      if(await portal.handle({req,res,url,send}))return;
      if(publicOrigin&&(url.pathname.startsWith('/api/')||url.pathname.startsWith('/exports/')||url.pathname==='/evals'||url.pathname==='/health'))throw fail('旧样书入口仅用于本机；请从自己的书房进入',403);
      if(req.method==='POST'){
        const origin=req.headers.origin;
        if(origin!==('http://'+host)&&origin!==publicOrigin)throw fail('请求来源未授权',403);
        const body=await parseBody(req,['/api/audio/import','/api/audio/validate'].includes(url.pathname)?32*1024*1024:undefined);
        if(url.pathname.startsWith('/api/audio/')&&await portal.audioRoutes.handle({req,res,url,user:{id:'legacy-local'},bookId:book.bookId,action:url.pathname.slice(11),body,send}))return;
        if(await experiences.handle({req,res,url,body,send}))return;
        if(url.pathname==='/api/highlights'){
          const saved=await mutate(records=>{records.highlights??=[];return saveHighlight(records.highlights,body,book);});send(201,saved);return;
        }
        const removeHighlight=url.pathname.match(/^\/api\/highlights\/([A-Za-z0-9_-]{1,128})\/remove$/);if(removeHighlight){const saved=await mutate(records=>{const row=findHighlight(records.highlights||[],removeHighlight[1]);if(!row)throw fail('找不到这条高亮',404);row.deletedAt??=new Date().toISOString();return row;});send(200,saved);return;}
        const editRecord=url.pathname.match(/^\/api\/(comments|questions)\/([^/]+)\/edit$/);
        if(editRecord){const key=editRecord[1],id=decodePersonalRecordId(editRecord[2]);const saved=await mutate(records=>{const record=records[key].find(row=>row.id===id);if(!record)throw fail('找不到自己的这条记录',404);return applyPersonalRecordEdit(record,body,book);});send(200,saved);return;}
        if(url.pathname==='/api/comments'||url.pathname==='/api/questions'){
          const type=url.pathname.endsWith('questions')?'question':'comment',key=type==='question'?'questions':'comments';const record=cleanRecord(body,type);
          const result=await mutate(records=>{const old=records[key].find(r=>r.id===record.id);if(old){if(old.passageId!==record.passageId||old.text!==record.text)throw fail('记录ID冲突',409);return {record:old,existing:true};}records[key].push(record);return {record,existing:false};});send(result.existing?200:201,result.record);return;
        }
        if(url.pathname==='/api/progress'){const position=checkPosition(body);await mutate(records=>{records.position=position;});send(200,position);return;}
        if(url.pathname==='/api/records/import'){
          if(body.kind!=='marginalia-personal-records'||![1,2].includes(body.schemaVersion)||body.bookId!==book.bookId)throw fail('请选择这本书的个人记录包');
          const clean=(rows,type)=>{if(!Array.isArray(rows)||rows.length>1000)throw fail('记录数量或格式不正确');return rows.map(r=>cleanRecord(r,type));};
          const comments=clean(body.comments,'comment'),questions=clean(body.questions,'question');
          if(body.highlights!==undefined&&(!Array.isArray(body.highlights)||body.highlights.length>10000))throw fail('高亮格式不正确');const highlights=(body.highlights||[]).map(row=>normalizeHighlight(row,book,{stored:true}));
          if(!Array.isArray(body.readingSessions)||body.readingSessions.length>1000)throw fail('时段格式不正确');
          const sessions=body.readingSessions.map(r=>{if(typeof r.id!=='string'||!r.id||r.bookId!==book.bookId||!Number.isFinite(Date.parse(r.startedAt))||!Number.isFinite(Date.parse(r.endedAt))||!Number.isFinite(r.durationSeconds)||r.durationSeconds<0||r.durationSeconds>86400||r.source!=='design_preview_focus_timer')throw fail('时段格式不正确');return {...r};});
          const position=body.position?checkPosition(body.position):null;
          const result=await mutate(records=>{const merge=(old,incoming)=>{const map=new Map(old.map(r=>[r.id,r]));for(const r of incoming)if(!map.has(r.id))map.set(r.id,r);return [...map.values()];};records.highlights=mergeHighlights(records.highlights||[],highlights);records.comments=merge(records.comments,comments);records.questions=merge(records.questions,questions);records.readingSessions=merge(records.readingSessions,sessions);if(position)records.position=position;return {comments:records.comments.length,questions:records.questions.length};});send(200,result);return;
        }
        throw fail('找不到这个操作',404);
      }
      if(req.method!=='GET'&&req.method!=='HEAD')throw fail('不支持这个请求',405);
      if(url.pathname.startsWith('/api/audio/')&&await portal.audioRoutes.handle({req,res,url,user:{id:'legacy-local'},bookId:book.bookId,action:url.pathname.slice(11),body:null,send}))return;
      if(await experiences.handle({req,res,url,body:null,send}))return;
      if(url.pathname==='/health'){send(200,{ready:true,bookId:book.bookId,chapters:book.chapters.length});return;}
      if(url.pathname==='/api/book'){send(200,book);return;}
      if(url.pathname==='/api/records'||url.pathname==='/api/records/export'){await writes.catch(()=>{});if(url.pathname.endsWith('export'))res.setHeader('Content-Disposition','attachment; filename="leafhour-my-records.json"');send(200,await readRecords());return;}
      if(url.pathname==='/favicon.ico'){res.writeHead(204);res.end();return;}
      if(url.pathname==='/read'){send(200,await readFile(path.join(root,'app/index.html')),'text/html');return;}
      if(assets.has(url.pathname)){const [file,type]=assets.get(url.pathname);const data=await readFile(path.join(root,file));if(type.startsWith('image/')||type.startsWith('audio/')||type.startsWith('font/')){res.writeHead(200,{'Content-Type':type,'Content-Length':data.length});res.end(req.method==='HEAD'?undefined:data);}else send(200,data,type);return;}
      if(downloads.has(url.pathname)){const filename=downloads.get(url.pathname),file=path.join(path.dirname(bookPath),'exports',filename);res.setHeader('Content-Disposition','attachment; filename="'+filename+'"');send(200,await readFile(file),filename.endsWith('.zip')?'application/zip':'text/markdown');return;}
      throw fail('找不到这个页面',404);
    }catch(e){send(e.status||500,{error:e.status?e.message:'服务暂时无法完成操作',...billingErrorDetails(e),...(e.status&&authMessageId(e.messageId)?{messageId:e.messageId}:{}),...(audioFailureCode(e.status,e.code)?{code:e.code}:{})});}
  });
  const closeHttp=server.close.bind(server);
  server.close=callback=>{const closing=Promise.all([experiences.close(),portal.audio?.close(),portal.chat.close(),portal.ingestionRunner.close()]);closeHttp(error=>{closing.then(()=>callback?.(error),failure=>callback?.(failure));});return server;};
  server.experiences=experiences;
  server.portal=portal;
  return server;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  await loadLocalEnvironment();
  const port=Number(process.env.READER_PORT||8330),host=process.env.READER_HOST||'127.0.0.1';
  if(!['127.0.0.1','localhost'].includes(host))throw Error('This version is a private local service; external hosting requires authentication.');
  let generator=null;
  if(process.env.DEEPSEEK_API_KEY){const {createHarnessGenerator}=await import('../harness/generator.mjs');generator=await createHarnessGenerator();}
  const recordsPath=process.env.READER_DATA_DIR?path.join(path.resolve(process.env.READER_DATA_DIR),'records.json'):undefined;
  const server=await createReaderServer({generator,recordsPath,bookPath:process.env.READER_BOOK_PATH?path.resolve(process.env.READER_BOOK_PATH):undefined,publicOrigin:process.env.READER_PUBLIC_ORIGIN||null});
  server.listen(port,host,()=>{console.log(configurationSummary({speechSupported:!!server.portal.audio}));console.log('Leafhour 已启动：http://'+host+':'+server.address().port);});
  process.on('SIGTERM',()=>server.close());process.on('SIGINT',()=>server.close());
}
