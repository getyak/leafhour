import {bookTransfer as transferReading} from './book-transfer.mjs';
import {readingView,readingChapter} from './reading-view.mjs';
import {createIngestionRunner} from './ingestion-runner.mjs';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createLibraryService} from './library-service.mjs';
import {createEmailAuth,smtpSender} from './email-auth.mjs';
import {createTranslator} from './translation.mjs';
import {fail} from './document-import.mjs';
import {audioHash} from './audio-content.mjs';
import {createAudioStore} from './audio-store.mjs';
import {createAudioService} from './audio-service.mjs';
import {createSpeechProvider} from './audio-provider.mjs';
import {createDialogueGenerator} from './dialogue-generator.mjs';
import {createGuideGenerator} from './listening-guide-generator.mjs';
import {createAudioRoutes} from './audio-routes.mjs';
import {portalDocument} from './portal-document.mjs';
import {roomExcerpt,latestRoomQuestion} from '../app/library-workspace.mjs';
import {createReaderChatService} from './reader-chat.mjs';
import {createReaderChatGenerator} from './reader-chat-generator.mjs';
import {createBookIntroductionService} from './book-introduction.mjs';
import {createIntroductionGenerator} from '../harness/introduction-generator.mjs';
import {createCompanionGenerator} from '../harness/companion-generator.mjs';
import {authPurpose} from './auth-policy.mjs';
import {safeGiftReturn} from '../app/reader-return.mjs';
import {createAccountProfile} from './account-profile.mjs';
import {createPaddleProvider} from './paddleocr.mjs';
import {createBookIngestion} from './book-ingestion.mjs';
import {createIngestionStorage} from './ingestion-storage.mjs';
import {createIngestionUpload} from './ingestion-upload.mjs';
import {createBookGifts} from './book-gifts.mjs';
import {createGiftQuoteService} from './gift-quote.mjs';
import {createLibraryPortability} from './library-portability.mjs';
import {decodePersonalRecordId} from '../app/personal-records.mjs';
import {agentReadArgs,scopedAgentRead} from './scoped-agent-reading.mjs';
import {createDailyReadingService} from './daily-reading.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const cookieToken=req=>(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith('marginalia_session='))?.slice('marginalia_session='.length);
const jsonBody=async(req,limit=29*1024*1024)=>{if(!req.headers['content-type']?.startsWith('application/json'))throw fail('请使用 JSON 请求',415);if(req.body&&typeof req.body==='object'){if(Buffer.byteLength(JSON.stringify(req.body))>limit)throw fail('这次导入内容过大，请分书恢复',413);return req.body;}let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>limit)throw fail('这次导入内容过大，请分书恢复',413);chunks.push(chunk);}try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw fail('请求格式不正确');}};
export async function createPortal({dataDir,publicOrigin=null,additionalWebOrigins=[],sendCode,translator,catalogDir=path.join(root,'catalog'),allowLocal=true,dataStore=null,authService=null,hostedMcp=false,speechProvider,dialogueGenerator,guideGenerator,chatGenerator,companionGenerator,introductionGenerator,schedule=()=>{},paddleProvider,env=process.env,giftQuoteGenerator=null}={}){
  const webOrigins=new Set(publicOrigin?[publicOrigin]:[]);
  if(!Array.isArray(additionalWebOrigins))throw fail('额外网页来源配置无效',503);
  for(const value of additionalWebOrigins){
    let url;try{if(typeof value!=='string'||value.includes('*'))throw Error();url=new URL(value);}catch{throw fail('额外网页来源配置无效',503);}
    if(url.protocol!=='https:'||url.origin!==value||url.username||url.password)throw fail('额外网页来源配置无效',503);
    webOrigins.add(value);
  }
  const auth=authService||await createEmailAuth({dataDir:path.join(dataDir,'auth'),sendCode:sendCode===undefined?await smtpSender():sendCode});
  const library=await createLibraryService({dataDir:path.join(dataDir,'library'),catalogDir,translator:translator===undefined?createTranslator():translator,dataStore});
  const provider=paddleProvider===undefined?createPaddleProvider({env}):paddleProvider;
  const ingestionStore=dataStore||createIngestionStorage({dataDir:path.join(dataDir,'ingestion')});
  const ingestion=createBookIngestion({store:ingestionStore,library,provider});
  const ingestionUpload=createIngestionUpload({store:ingestionStore,ingestion});
  const ingestionRunner=createIngestionRunner({store:ingestionStore,ingestion,schedule,env,publicOrigin:dataStore?publicOrigin:null});
  const profile=createAccountProfile({dataDir:path.join(dataDir,'library'),dataStore});
  const gifts=createBookGifts({library,dataDir:path.join(dataDir,'library'),dataStore,getProfile:profile.get});
  const giftQuotes=createGiftQuoteService({library,gifts,generator:giftQuoteGenerator,env,onDiagnostic:env.VERCEL==='1'?event=>console.warn(JSON.stringify(event)):undefined});
  const visibleUser=async user=>user?{id:user.id,email:user.email||null,kind:user.kind,...await profile.get(user)}:null;
  async function shelfView(user,rows){
    for(let attempt=0;attempt<3;attempt++){
      const before=await library.shelfState(user),books=await rows(user),after=await library.shelfState(user);
      if(before.revision===after.revision)return {books,revision:after.revision};
    }
    throw fail('书架正在另一处更新，请稍后刷新',409);
  }
  const readingGenerator=chatGenerator===undefined?createReaderChatGenerator():chatGenerator;
  const bookIntroductions=createBookIntroductionService({library,generator:introductionGenerator===undefined?createReaderChatGenerator({env,makeGenerator:createIntroductionGenerator}):introductionGenerator});
  const proactiveGenerator=companionGenerator===undefined?createReaderChatGenerator({makeGenerator:createCompanionGenerator}):companionGenerator;
  const chat=await createReaderChatService({companionGenerator:proactiveGenerator,library,dataDir:path.join(dataDir,'library'),dataStore,generator:readingGenerator,onError:(error,context)=>readingGenerator?.reportFailure?.(error,context)});
  // One quiet daily companion plan per account; no schedule, model job or
  // generation happens in this process. The external host owns the heartbeat.
  const dailyReading=createDailyReadingService({library,dataDir:path.join(dataDir,'library','daily'),dataStore});
  const portability=createLibraryPortability({library,chat,store:ingestionStore});
  let legacyBook=null;
  const audioLibrary={getBook:(owner,id)=>owner?.id==='legacy-local'&&legacyBook?.bookId===id?Promise.resolve(legacyBook):library.getBook(owner,id)};
  const durableAudio=dataStore&&['read','mutate','putBlob','blob'].every(k=>typeof dataStore[k]==='function');
  const audio=durableAudio||allowLocal&&!publicOrigin&&!dataStore?await createAudioService({store:await createAudioStore({dataDir:path.join(dataDir,'audio'),dataStore:durableAudio?dataStore:null}),getBook:audioLibrary.getBook,speechProvider:speechProvider===undefined?createSpeechProvider({env}):speechProvider,dialogueGenerator:dialogueGenerator===undefined?createDialogueGenerator({env}):dialogueGenerator,schedule,durable:!!durableAudio,env}):null;
  const audioRoutes=createAudioRoutes({audio,library:audioLibrary,guideGenerator:guideGenerator===undefined?createGuideGenerator({env}):guideGenerator});
  async function handle({req,res,url,send}){
    const presenceReceivedAt=url.pathname==='/api/library/daily-reading/presence'?Date.now():null;
    const p=url.pathname;
    if(p==='/api/internal/ingestion/wake'){if(req.method!=='POST'||!ingestionRunner.authorized(req.headers.authorization))throw fail('找不到这个操作',404);ingestionRunner.tick();send(202,{accepted:true});return true;}
    const isAPI=p.startsWith('/api/auth/')||p.startsWith('/api/library')||p.startsWith('/api/agent/')||p.startsWith('/api/account/')||p.startsWith('/api/book-gifts/');
    const files={'/':'home.html','/library':'home.html','/en':'home.html','/zh-hans':'home.html','/zh-hant':'home.html','/ja':'home.html','/privacy':'en/privacy.html','/en/privacy':'en/privacy.html','/zh-hans/privacy':'zh-hans/privacy.html','/zh-hant/privacy':'zh-hant/privacy.html','/ja/privacy':'ja/privacy.html','/mcp':'en/mcp.html','/en/mcp':'en/mcp.html','/zh-hans/mcp':'zh-hans/mcp.html','/zh-hant/mcp':'zh-hant/mcp.html','/ja/mcp':'ja/mcp.html','/auth.css':'auth.css','/auth-dialog.mjs':'auth-dialog.mjs','/auth-flow.mjs':'auth-flow.mjs','/auth-assets/google.png':'auth-assets/google.png','/auth-assets/apple.svg':'auth-assets/apple.svg','/portal.css':'portal.css','/portal.js':'portal.js','/owner-scope.mjs':'owner-scope.mjs','/paragraph-anchor.mjs':'paragraph-anchor.mjs','/source-language.mjs':'source-language.mjs','/upload-state.mjs':'upload-state.mjs','/library-backup.mjs':'library-backup.mjs','/reader-api.mjs':'reader-api.mjs','/reading-progress.mjs':'reading-progress.mjs','/progress-sync.mjs':'progress-sync.mjs','/reader-translation.js':'reader-translation.js'};
    for(const file of ['library-portability.mjs','portable-chat.mjs','library-data.mjs','library-data.css','fflate.mjs','fflate-LICENSE.txt'])files['/'+file]=file;
    files['/document-source.mjs']='document-source.mjs';files['/pdf-ingestion.mjs']='pdf-ingestion.mjs';files['/pdf-onboarding.mjs']='pdf-onboarding.mjs';files['/pdf-onboarding-state.mjs']='pdf-onboarding-state.mjs';files['/book-transfer.mjs']='book-transfer.mjs';
    files['/source-review']='source-review.html';for(const file of ['source-review.mjs','source-review.css','source-revisions.mjs'])files['/'+file]=file;
    files['/original-download.mjs']='original-download.mjs';files['/reading-book.mjs']='reading-book.mjs';
    files['/reader-conversation.mjs']='reader-conversation.mjs';
    for(const file of ['reader-companion.mjs','reader-companion-state.mjs','reader-companion.css'])files['/'+file]=file;
    files['/reading-arrival.css']='reading-arrival.css';files['/reading-arrival.mjs']='reading-arrival.mjs';files['/arrival-catalog.mjs']='arrival-catalog.mjs';files['/arrival-excerpt.mjs']='arrival-excerpt.mjs';files['/save-receipts.mjs']='save-receipts.mjs';
    files['/home-motion.css']='home-motion.css';files['/home-motion.mjs']='home-motion.mjs';
    for(const file of ['library-craft.css','book-binding.mjs','brand-assets/sage-paper.webp'])files['/'+file]=file;
    files['/library-incremental.mjs']='library-incremental.mjs';
    for(const file of ['home-atmosphere.css','home-atmosphere.mjs','brand-assets/sunlit-room.webp','brand-assets/foliage-canopy.webp'])files['/'+file]=file;
    files['/reading-session-record.mjs']='reading-session-record.mjs';
    for(const file of ['reading-time-policy.mjs','reading-manual.mjs','reading-manual-ui.mjs'])files['/'+file]=file;
    files['/reading-toolbar.mjs']='reading-toolbar.mjs';
    files['/reading-flow.mjs']='reading-flow.mjs';files['/reading-load.mjs']='reading-load.mjs';files['/personal-records.mjs']='personal-records.mjs';files['/reading-chat-scope.mjs']='reading-chat-scope.mjs';files['/personal-record-editor.mjs']='personal-record-editor.mjs';
    for(const file of ['highlights.mjs','reader-highlights.mjs'])files['/'+file]=file;
    files['/reading-flow.css']='reading-flow.css';
    for(const file of ['library-filter-controls.mjs','library-filters.css','library-workspace.mjs','library-workspace.css','reading-calendar.mjs','reading-dashboard.mjs','library-restore.mjs','library-export.mjs','site-appearance.mjs','reading-clock.mjs','reading-outbox.mjs','reading-queue-store.mjs','reading-session-coordinator.mjs','reading-mark-actions.mjs','reading-mark-store.mjs','reading-draft-store.mjs','reading-retained-backup.mjs','reading-journey.mjs','reading-pending-backup.mjs','reading-ending-context.mjs','reading-session.js','reading-session.css','brand-assets/reading-window.webp','brand-assets/page-detail.webp','brand-assets/page-mark.svg','leafhour-brand.css','brand-assets/leafhour-mark.svg','brand-assets/leafhour-social.svg','brand-assets/leafhour-social.png'])files['/'+file]=file;
    for(const file of ['squirrel-motion.mjs','squirrel-position.mjs','library-shell.mjs','library-shell.css','library-daily-reading.mjs','library-daily-reading.css','reader-presence.mjs','library-reading-preferences.mjs','library-chat.mjs','library-chat-state.mjs','library-chat-markdown.mjs','library-chat.css','icons.svg','icons-LICENSE.txt'])files['/'+file]=file;
    for(const file of ['library-profile.mjs','library-book-actions.mjs','reading-schedule.mjs','shelf-order.mjs','library-personal.css','book-gift.css','book-gift.mjs','gift-preview.mjs','gift-ritual.mjs','gift-compose.mjs','gift-compose.css','gift-identity.mjs','gift-compose-state.mjs','gift-quote.mjs','gift-waves.mjs','reader-return.mjs'])files['/'+file]=file;
    files['/gift-preview']='book-gift.html';for(const file of ['brand-assets/letter-edge.svg','brand-assets/envelope-edge.svg'])files['/'+file]=file;
    if(safeGiftReturn(p)){files[p]='book-gift.html';res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Cache-Control','private, no-store');}
    Object.assign(files,{'/home-locale.mjs':'home-locale.mjs','/discovery.css':'discovery.css','/robots.txt':'robots.txt','/sitemap.xml':'sitemap.xml'});
    // GET-167 typography foundation: shared tokens plus the self-hosted
    // Newsreader faces (OFL-1.1); the hosted build also ships its public manifest.
    for(const file of ['typography.css','fonts/newsreader/newsreader-var.woff2','fonts/newsreader/newsreader-italic-var.woff2','fonts/newsreader/OFL.txt'])files['/'+file]=file;
    if(!isAPI&&!files[p])return false;
    if(isAPI||p==='/source-review'||p==='/library'||p==='/gift-preview'||safeGiftReturn(p))res.setHeader('X-Robots-Tag','noindex, nofollow, noarchive');
    if(!isAPI){if(req.method!=='GET'&&req.method!=='HEAD')throw fail('不支持这个请求',405);const type=p==="/robots.txt"?"text/plain":p==="/sitemap.xml"?"application/xml":p.endsWith('.woff2')?'font/woff2':p.endsWith('.txt')?'text/plain':p.endsWith('.webp')?'image/webp':p.endsWith('.png')?'image/png':p.endsWith('.svg')?'image/svg+xml':p.endsWith('.css')?'text/css':p.endsWith('.js')||p.endsWith('.mjs')?'text/javascript':'text/html';const file=await readFile(path.join(root,'app',files[p]));if(type.startsWith('font/')){res.writeHead(200,{'Content-Type':type,'Content-Length':file.length});res.end(req.method==='HEAD'?undefined:file);return true;}send(200,files[p]==='home.html'?portalDocument(file.toString('utf8'),p):file,type);return true;}
    if(req.method!=='GET'&&req.method!=='POST')throw fail('不支持这个请求',405);
    // Hosted clients must be configured explicitly; Host only describes a local HTTP instance.
    const originAllowed=webOrigins.has(req.headers.origin)||!publicOrigin&&req.headers.origin==='http://'+req.headers.host;
    if(req.headers.origin&&!originAllowed)throw fail('请求来源未授权',403);
    if(req.method==='POST'&&!p.startsWith('/api/agent/')&&!originAllowed)throw fail('请求来源未授权',403);
    if(p==='/api/auth/oauth'&&req.method==='POST'&&publicOrigin&&req.headers.origin!==publicOrigin)throw fail('请在 '+publicOrigin+' 使用 Google 或 Apple 登录。当前页面仍可使用邮箱或密码登录。',403);
    const flowToken=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('marginalia_auth_flow='))?.slice('marginalia_auth_flow='.length);
    const setFlow=value=>`marginalia_auth_flow=${value}; HttpOnly; Secure; SameSite=Lax; Path=/api/auth; Max-Age=${value?600:0}`;
    if(p==='/api/auth/callback'&&req.method==='GET'){
      if(!publicOrigin||typeof auth.finishOAuth!=='function'){send(404,{error:'这个登录入口尚未开放'});return true;}
      let next,session,returnTo=null,errorCode='expired';
      try{
        if(url.searchParams.has('error')){returnTo=await auth.cancelOAuth(flowToken);errorCode='cancelled';}
        else{session=await auth.finishOAuth(flowToken,url.searchParams.get('code'));next=session.next;}
      }catch(error){errorCode=error.status>=500?'unavailable':'expired';returnTo=await auth.cancelOAuth(flowToken).catch(()=>null);}
      if(!session){const query=new URLSearchParams({login:'1',auth_error:errorCode});if(returnTo?.startsWith('/read?')||safeGiftReturn(returnTo))query.set('next',returnTo);else if(returnTo==='/library?upload=1')query.set('upload','1');next='/library?'+query;}
      const cookies=[setFlow('')];if(session)cookies.push(`marginalia_session=${session.token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800; Secure`);
      res.setHeader('Set-Cookie',cookies);res.setHeader('Cache-Control','private, no-store');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Location',new URL(next,publicOrigin).href);res.statusCode=303;res.end();return true;
    }
    const token=cookieToken(req);
    if(p==='/api/auth/logout'&&req.method==='POST'){await jsonBody(req,4096);await auth.logout(token);res.setHeader('Set-Cookie',`marginalia_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${publicOrigin?.startsWith('https:')?'; Secure':''}`);send(200,{signedOut:true});return true;}
    const user=req.method==='GET'&&p.startsWith('/api/book-gifts/')?null:await auth.userFor(token);
    const ownerScoped=p.startsWith('/api/library')||p==='/api/account/reading-preferences'||req.method==='POST'&&(p==='/api/account/profile'||/^\/api\/book-gifts\/[^/]+\/(?:accept|revoke)$/.test(p));
    if(ownerScoped&&req.headers['x-reader-owner']&&req.headers['x-reader-owner']!==(user?.id||'guest')){res.setHeader('X-Reader-Session-Changed','1');throw fail('账户已切换，请重新进入书房。原账户草稿仍留在原处。',409);}
    const body=req.method==='POST'?await jsonBody(req,p==='/api/account/reading-preferences'?8*1024:p.startsWith('/api/library/daily-reading')||p.startsWith('/api/agent/daily-')?8*1024:p.startsWith('/api/auth/')||p.startsWith('/api/book-gifts/')||p.endsWith('/introduction')?4096:p.startsWith('/api/library/restore/')?2*1024*1024:p==='/api/account/profile'?160*1024:p.endsWith('/audio/import')||p.endsWith('/audio/validate')?32*1024*1024:['/api/library/import','/api/library/validate'].includes(p)?200*1024*1024:29*1024*1024):null;
    const localAllowed=allowLocal&&['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress)&&!publicOrigin;
    const setSession=value=>res.setHeader('Set-Cookie',`marginalia_session=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${value?604800:0}${publicOrigin?.startsWith('https:')?'; Secure':''}`);
    if(p==='/api/auth/session'&&req.method==='GET'){
      const capabilities=auth.capabilities?await auth.capabilities():{email:auth.emailAvailable,providers:{google:false,apple:false},otp:{digits:6,expiresIn:600,retryAfter:60}};
      // Host only hides unusable OAuth buttons; it never authorizes a web origin.
      const providers=publicOrigin&&req.headers.host!==new URL(publicOrigin).host?{google:false,apple:false}:capabilities.providers;
      send(200,{user:await visibleUser(user),emailAvailable:capabilities.email,passwordAvailable:capabilities.password===true,providers,otp:capabilities.otp,localAvailable:localAllowed,translationAvailable:library.translationAvailable,directUpload:!!dataStore?.beginUpload,pdfOcrAvailable:!!provider,readingPreferences:user?await library.getReadingPreferences(user):null});return true;
    }
    if(p==='/api/account/reading-preferences'){
      res.setHeader('Cache-Control','private, no-store');
      // GET is read-only and creates no state; guests only ever see an empty view.
      if(req.method==='GET'){send(200,user?await library.getReadingPreferences(user):{revision:0,updatedAt:null,preferences:null});return true;}
      send(200,await library.saveReadingPreferences(user,body));return true;
    }
    if(p==='/api/account/profile'&&req.method==='POST'){send(200,await profile.save(user,body));return true;}
    if(p==='/api/auth/oauth'&&req.method==='POST'){
      if(typeof auth.beginOAuth!=='function')throw fail('这个登录方式正在准备中',503);
      if(flowToken)await auth.cancelOAuth(flowToken);
      const flow=await auth.beginOAuth(body.provider,body.next);res.setHeader('Set-Cookie',setFlow(flow.transactionToken));send(200,{url:flow.authorizeUrl});return true;
    }
    if(p==='/api/auth/password'&&req.method==='POST'){if(typeof auth.signInPassword!=='function')throw fail('此书房尚未开启密码登录，可以使用验证码或本机书房',503);const session=await auth.signInPassword(body.email,body.password);setSession(session.token);send(200,{user:session.user});return true;}
    if(p==='/api/auth/password/setup'&&req.method==='POST'){if(typeof auth.setPassword!=='function')throw fail('此书房尚未开启密码设置',503);send(200,await auth.setPassword(token,body.password,body.setupToken));return true;}
    if(['/api/auth/code','/api/auth/verify'].includes(p)&&req.method==='POST'){
      const purpose=authPurpose(body.purpose);if(purpose!=='login'&&typeof auth.setPassword!=='function')throw fail('此书房尚未开启密码设置',503);
      if(p==='/api/auth/code'){send(200,await auth.requestCode(body.email,purpose));return true;}
      const session=await auth.verifyCode(body.email,body.code,purpose);setSession(session.token);send(200,{user:session.user,...(session.passwordSetup?{passwordSetup:true,passwordSetupToken:session.passwordSetupToken}:{})});return true;
    }
    if(p==='/api/auth/local'&&req.method==='POST'){if(!localAllowed)throw fail('本机书房只在本机模式可用',403);const session=await auth.localSession();setSession(session.token);send(200,{user:session.user});return true;}
    if(p==='/api/library'&&req.method==='GET'){const view=await shelfView(user,library.list);send(200,{books:view.books,user:await visibleUser(user),shelfRevision:view.revision});return true;}
    if(p==='/api/library/order'&&req.method==='POST'){send(200,await library.reorderShelf(user,body));return true;}
    if(p==='/api/library/trash'&&req.method==='GET'){send(200,await shelfView(user,library.trash));return true;}
    if(p==='/api/library/activity'&&req.method==='GET'){send(200,await library.readingActivity(user,{month:url.searchParams.get('month'),timeZone:url.searchParams.get('timeZone')}));return true;}
    if(p==='/api/library/mcp-setup'&&req.method==='GET'){
      if(!user)throw fail('请先进入自己的书房',401);
      if(hostedMcp){const sourceCommit=env.VERCEL_GIT_COMMIT_SHA;if(typeof sourceCommit!=='string'||!/^[a-f0-9]{40}$/.test(sourceCommit))throw fail('线上版本尚未准备好，请稍后重新读取接入配置。',503);send(200,{hosted:true,serviceUrl:publicOrigin,sourceCommit});return true;}
      if(!localAllowed)throw fail('本机接入配置只能在运行 Leafhour 的电脑上读取。远程接入尚未支持。',403);
      const loopback=req.socket.localAddress==='::1'?'[::1]':'127.0.0.1';
      send(200,{command:process.execPath,args:[path.join(root,'server/mcp.mjs')],serviceUrl:'http://'+loopback+':'+req.socket.localPort});return true;
    }
    if(p==='/api/library/pdf-upload/start'&&req.method==='POST'){const result=await ingestionUpload.start(user,body);if(result.job)await ingestionRunner.enqueue(user,result.job.id);send(201,result);return true;}
    const partUpload=p.match(/^\/api\/library\/pdf-upload\/([-a-z0-9]{36})\/(part|complete)$/);
    if(partUpload&&req.method==='POST'){const result=partUpload[2]==='part'?await ingestionUpload.part(user,partUpload[1],body):await ingestionUpload.complete(user,partUpload[1]);if(partUpload[2]==='complete')await ingestionRunner.enqueue(user,result.id);send(200,result);return true;}
    if(p==='/api/library/ingestion'&&req.method==='GET'){const jobs=await ingestion.list(user);for(const job of jobs)if(['preparing','running','publishing'].includes(job.state))await ingestionRunner.enqueue(user,job.id);send(200,{jobs});return true;}
    const ingestRoute=p.match(/^\/api\/library\/ingestion\/([-a-z0-9]{36})(?:\/(advance|cancel|resume|consent|preview))?$/);
    if(ingestRoute){const [,id,action]=ingestRoute;if(req.method==='GET'&&action==='preview')send(200,await ingestion.preview(user,id));else if(req.method==='GET'&&!action)send(200,await ingestion.view(user,id));else if(req.method==='POST'&&action&&action!=='preview'){const result=action==='consent'?await ingestion.consent(user,id,body):await ingestion[action](user,id);await ingestionRunner.enqueue(user,id);send(200,result);}else throw fail('不支持这个请求',405);return true;}
    if(p==='/api/library/upload/start'&&req.method==='POST'){
      if(!dataStore?.beginUpload)throw fail('此书房使用本机上传',404);
      send(201,await dataStore.beginUpload(user,body));return true;
    }
    if(p==='/api/library/upload/complete'&&req.method==='POST'){
      if(!dataStore?.completeUpload)throw fail('此书房使用本机上传',404);
      send(201,await dataStore.completeUpload(user,body.id,library));return true;
    }
    if(p==='/api/library/upload'&&req.method==='POST'){
      if(!user)throw fail('请先进入自己的书房',401);if(typeof body.base64!=='string'||!body.base64.length||body.base64.length>28*1024*1024||!/^[A-Za-z0-9+/]*={0,2}$/.test(body.base64))throw fail('文件编码不正确');
      send(201,await library.importDocument(user,{filename:body.filename,bytes:Buffer.from(body.base64,'base64')}));return true;
    }
    if(p==='/api/library/restore/start'&&req.method==='POST'){send(201,await portability.start(user,body));return true;}
    const restoreOperation=p.match(/^\/api\/library\/restore\/([a-f0-9-]{36})\/(part|commit|cancel)$/);
    if(restoreOperation&&req.method==='POST'){const [,id,action]=restoreOperation;send(200,await portability[action](user,id,body));return true;}
    if(p==='/api/library/export'&&req.method==='GET'){res.setHeader('Content-Disposition','attachment; filename="leafhour-library.json"');send(200,await library.exportLibrary(user));return true;}
    if(p==='/api/library/export/manifest'&&req.method==='GET'){send(200,await library.exportManifest(user));return true;}
    if(p==='/api/library/import'&&req.method==='POST'){send(200,await library.restoreLibrary(user,body));return true;}
    if(p==='/api/library/validate'&&req.method==='POST'){send(200,await library.validateRestore(user,body));return true;}
    if(p==='/api/library/grants'){if(req.method==='GET')send(200,{grants:await library.grants(user)});else send(201,await library.createGrant(user,body));return true;}
    const revoke=p.match(/^\/api\/library\/grants\/([^/]+)\/revoke$/);if(revoke&&req.method==='POST'){send(200,await library.revokeGrant(user,revoke[1]));return true;}
    if(p==='/api/library/daily-reading'||p==='/api/library/daily-reading/presence'||p==='/api/library/daily-reading/pause'||p==='/api/library/daily-reading/resume'||p==='/api/library/daily-reading/test'){
      res.setHeader('Cache-Control','private, no-store');
      if(!user)throw fail('请先进入自己的书房',401);if(req.headers['x-reader-owner']!==user.id)throw fail('请重新核对当前书房账户',409);
      if(req.method==='GET'&&p==='/api/library/daily-reading'){send(200,await dailyReading.view(user));return true;}
      if(req.method!=='POST')throw fail('不支持这个请求',405);
      if(p==='/api/library/daily-reading'){send(200,await dailyReading.configure(user,body));return true;}
      {
        if(p==='/api/library/daily-reading/presence'){send(200,await dailyReading.reportPresence(user,body,{receivedAt:presenceReceivedAt}));return true;}
        if(p==='/api/library/daily-reading/pause'){send(200,await dailyReading.pause(user,body));return true;}
        if(p==='/api/library/daily-reading/resume'){send(200,await dailyReading.resume(user,body));return true;}
        send(200,await dailyReading.requestTest(user,body));return true;
      }
    }
    const gift=p.match(/^\/api\/book-gifts\/([A-Za-z0-9_-]{43})(?:\/(download|download-part|accept|revoke))?$/);
    if(gift){
      const [,giftToken,action]=gift;res.setHeader('Cache-Control','private, no-store');res.setHeader('Referrer-Policy','no-referrer');
      if(!action&&req.method==='GET'){send(200,await gifts.view(giftToken));return true;}
      if(action==='download'&&req.method==='GET'){const backup=await gifts.download(giftToken);if(Buffer.byteLength(JSON.stringify(backup))>3*1024*1024)throw fail('这份阅读包较大，请从赠书信页面分段下载',413);res.setHeader('Content-Disposition','attachment; filename="leafhour-book-gift.json"');send(200,backup);return true;}
      if(action==='download-part'&&req.method==='GET'){send(200,await gifts.downloadPart(giftToken,{offset:Number(url.searchParams.get('offset')||0),snapshot:url.searchParams.get('snapshot')}));return true;}
      if(action==='accept'&&req.method==='POST'){send(200,await gifts.accept(user,giftToken));return true;}
      if(action==='revoke'&&req.method==='POST'){send(200,await gifts.revoke(user,giftToken));return true;}
    }
    const match=p.match(/^\/api\/library\/books\/([^/]+)(?:\/(.+))?$/);
    if(match){const [,id,action]=match;
      if(action==='introduction'){
        res.setHeader('Cache-Control','private, no-store');
        if(req.method==='GET')send(200,await bookIntroductions.view(user,id));
        else if(req.method==='POST'){
          const controller=new AbortController(),cancel=()=>{if(!res.writableEnded)controller.abort();};res.once('close',cancel);
          try{send(200,await bookIntroductions.generate(user,id,body,{authorize:async()=>(await auth.userFor(token))?.id===user?.id,signal:controller.signal}));}finally{res.removeListener('close',cancel);}
        }
        else throw fail('不支持这个请求',405);
        return true;
      }
      if(action==='source-review'&&req.method==='GET'){send(200,await library.sourceReview(user,id));return true;}
      if(action==='source-evidence'&&req.method==='GET'){send(200,await library.sourceEvidence(user,id,{passageId:url.searchParams.get('passageId'),...(url.searchParams.has('page')?{page:Number(url.searchParams.get('page'))}:{})}));return true;}
      if(action==='source-revisions'&&req.method==='POST'){const result=await library.createSourceRevision(user,id,body);send(201,{...result,book:{bookId:result.book.bookId,contentVersion:result.book.contentVersion,title:result.book.title}});return true;}
      if(action==='source-anchors/resolve'&&req.method==='POST'){send(200,await library.resolveSourceAnchor(user,id,body));return true;}
      if(action==='archive'&&req.method==='POST'){send(200,await library.archiveBook(user,id,body));return true;}
      if(action==='restore'&&req.method==='POST'){send(200,await library.restoreBook(user,id,body));return true;}
      if(action==='gifts'&&req.method==='POST'){send(201,await gifts.create(user,id,body));return true;}
      if(action==='gifts'&&req.method==='GET'){send(200,{gifts:await gifts.list(user,id)});return true;}
      // Preparing a quotation only stages a private, owner-bound suggestion; it
      // never publishes a link and the sealing endpoint alone creates a gift.
      if(action==='gift-quote'&&req.method==='POST'){send(200,await giftQuotes.prepare(user,id));return true;}
      if(action?.startsWith('audio/'))return audioRoutes.handle({req,res,url,user,bookId:id,action:action.slice(6),body,send});
      if(action==='content-part'&&req.method==='GET'){send(200,await library.bookTransfer(user,id,Number(url.searchParams.get('offset')),url.searchParams.get('snapshot')));return true;}
      if(!action&&req.method==='GET'){const book=await library.getBook(user,id);if(req.headers['x-reader-book-transfer']==='1'&&Buffer.byteLength(JSON.stringify(book))>3000000&&(dataStore||Buffer.byteLength(JSON.stringify(book))<=32*1024*1024)){res.setHeader('X-Reader-Book-Transfer','parts');send(200,await library.bookTransfer(user,id));}else send(200,book);return true;}
      if(action==='preview'&&req.method==='GET'){
        const book=await library.getBook(user,id),excerpt=roomExcerpt(book,url.searchParams.get('passageId')||undefined);
        let question=null;
        if(user){try{question=latestRoomQuestion(book,await library.records(user,id));}catch{/* An optional personal slip must not hide a readable source excerpt. */}}
        send(200,{...excerpt,question});return true;
      }
      if(action==='companion'&&req.method==='GET'){send(200,await chat.companion.view(user,id));return true;}
      if(action==='companion'&&req.method==='POST'){send(200,await chat.companion.configure(user,id,body));return true;}
      if(action==='companion/observe'&&req.method==='POST'){send(200,await chat.companion.observe(user,id,body));return true;}
      if(action==='companion/messages'&&req.method==='POST'){send(200,await chat.companion.generate(user,id,body,{authorize:async()=>(await auth.userFor(token))?.id===user?.id}));return true;}
      if(action==='chat/scope'&&req.method==='POST'){send(200,await chat.configureScope(user,id,body));return true;}
      if(action==='chat'&&req.method==='GET'){send(200,await chat.view(user,id,{passageId:url.searchParams.get('passageId')||undefined}));return true;}
      if(action==='chat'&&req.method==='POST'){send(200,await chat.send(user,id,body));return true;}
      const cancelChat=action?.match(/^chat\/([^/]+)\/cancel$/);if(cancelChat&&req.method==='POST'){send(200,await chat.cancel(user,id,cancelChat[1]));return true;}
      if(action==='portability-part'&&req.method==='GET'){send(200,await portability.exportPart(user,id,{offset:Number(url.searchParams.get('offset')||0),snapshot:url.searchParams.get('snapshot')}));return true;}
      if(action==='portability-original'&&req.method==='GET'){send(200,await portability.originalPart(user,id,{offset:Number(url.searchParams.get('offset')||0),sha256:url.searchParams.get('sha256')}));return true;}
      if(action==='export-part'&&req.method==='GET'){send(200,await library.exportBookPart(user,id,{offset:Number(url.searchParams.get('offset')||0),snapshot:url.searchParams.get('snapshot')}));return true;}
      const sendReading=payload=>{if(url.searchParams.has('offset'))send(200,transferReading(payload,Number(url.searchParams.get('offset')),url.searchParams.get('snapshot')));else if(Buffer.byteLength(JSON.stringify(payload))>3000000){res.setHeader('X-Reader-Book-Transfer','parts');send(200,transferReading(payload));}else send(200,payload);};
      if(action==='reading'&&req.method==='GET'){sendReading(readingView(await library.getBook(user,id),{chapterId:url.searchParams.get('chapterId'),passageId:url.searchParams.get('passageId')}));return true;}
      const chapterRead=action?.match(/^chapters\/([A-Za-z0-9_.:-]{1,128})$/);
      if(chapterRead&&req.method==='GET'){sendReading(readingChapter(await library.getBook(user,id),chapterRead[1],url.searchParams.get('contentVersion')));return true;}
      if(action==='original/range'&&req.method==='GET'){const part=await library.originalRange(user,id,{offset:Number(url.searchParams.get('offset')),length:Number(url.searchParams.get('length')),sha256:url.searchParams.get('sha256')});res.statusCode=206;res.setHeader('Content-Type','application/octet-stream');res.setHeader('Cache-Control','private, no-store');res.setHeader('Content-Length',part.bytes.length);res.setHeader('Content-Range','bytes '+part.offset+'-'+(part.offset+part.bytes.length-1)+'/'+part.total);res.end(part.bytes);return true;}
      if(action==='original/parts'&&req.method==='GET'){send(200,await library.originalParts(user,id));return true;}
      if(action==='original/info'&&req.method==='GET'){send(200,await library.originalInfo(user,id));return true;}
      if(action==='original'&&req.method==='GET'){if(dataStore?.signedBlob){const file=await library.originalDownload(user,id);res.statusCode=302;res.setHeader('Location',file.url+'&download=original.'+(['pdf','epub','txt','md'].includes(file.format)?file.format:'bin'));res.setHeader('Cache-Control','private, no-store');res.end();return true;}const file=await library.getOriginal(user,id);res.statusCode=200;res.setHeader('Content-Type','application/octet-stream');res.setHeader('Content-Disposition','attachment; filename="original.'+(['pdf','epub','txt','md'].includes(file.format)?file.format:'bin')+'"');res.setHeader('Cache-Control','private, no-store');res.setHeader('Content-Length',file.bytes.length);res.end(file.bytes);return true;}
      if(['records','records/export'].includes(action)&&req.method==='GET'){send(200,await library.records(user,id));return true;}
      if(['comments','questions'].includes(action)&&req.method==='POST'){send(201,await library.addComment(user,id,body,action));return true;}
      const editRecord=action?.match(/^(comments|questions)\/([^/]+)\/edit$/);if(editRecord&&req.method==='POST'){send(200,await library.editComment(user,id,decodePersonalRecordId(editRecord[2]),body,editRecord[1]));return true;}
      if(action==='highlights'&&req.method==='POST'){send(201,await library.addHighlight(user,id,body));return true;}
      const removeHighlight=action?.match(/^highlights\/([A-Za-z0-9_-]{1,128})\/remove$/);if(removeHighlight&&req.method==='POST'){send(200,await library.removeHighlight(user,id,removeHighlight[1]));return true;}
      if(action==='progress'&&req.method==='POST'){send(200,await library.saveProgress(user,id,body));return true;}
      if(action==='reading-sessions'&&req.method==='POST'){send(201,await library.saveReadingSession(user,id,body));return true;}
      if(action==='reading-milestones'&&req.method==='POST'){send(201,await library.recordReadingMilestone(user,id,body));return true;}
      if(action==='reading-goal'&&req.method==='POST'){send(200,await library.setReadingGoal(user,id,body));return true;}
      // Legacy callers send only passageId and stay compatible; batch callers
      // may pin the optional expected content version.
      if(action==='translate'&&req.method==='POST'){send(200,await library.translate(user,id,body.passageId,body?.contentVersion!==undefined?{expectedContentVersion:body.contentVersion}:{}));return true;}
      if(action==='experiences'&&req.method==='GET'){const book=await library.getBook(user,id);send(200,{bookId:id,contentVersion:book.contentVersion,xrays:[],cards:[],invitations:[],states:{},echoes:[],echoAvailable:false});return true;}
      if(action==='experience-events'&&req.method==='POST'){await library.getBook(user,id);send(200,{accepted:0,reason:'本书尚未开启探索体验统计'});return true;}
      if(action==='records/import'&&req.method==='POST'){const book=await library.getBook(user,id);if(body?.bookId!==id||body.kind!=='marginalia-personal-records')throw fail('请选择这本书的记录包');send(200,await library.restoreLibrary(user,{kind:'marginalia-library',schemaVersion:1,books:[{book,records:body}]}));return true;}
      if(['echo','explain','experiences/export','experiences/import'].includes(action))throw fail('这本书的探索体验尚未接入，可以按段翻译并保存自己的笔记',503);
    }
    if(p.startsWith('/api/agent/')){
      const action=p.slice('/api/agent/'.length),bookId=url.searchParams.get('bookId')||body?.bookId,agentToken=req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
      // The daily companion token is deliberately narrow: it can only connect,
      // claim and finish this account's plan, and never generic book routes.
      if(['daily-connect','daily-claim','daily-finish'].includes(action)){
        if(req.method!=='POST')throw fail('不支持这个请求',405);
        const identity=await library.authorizeDaily(agentToken),owner={id:identity.id};
        const result=action==='daily-connect'?await dailyReading.connect(owner,body,identity.grant):action==='daily-claim'?await dailyReading.claim(owner,body,identity.grant):await dailyReading.finish(owner,body,identity.grant);
        send(200,result);return true;
      }
      const scopes={manifest:'content',passage:'content',context:'content',chapter:'content',search:'content',notes:'notes',activity:'activity',comment:'comment:write','audio-prepare':'content','audio-generate':'audio:generate','audio-status':'audio:read','audio-cancel':'audio:generate','audio-clip':'audio:read'};if(!scopes[action])throw fail('找不到这个工具',404);
      const owner=await library.authorize(agentToken,bookId,scopes[action]),book=await library.getBook(owner,bookId),records=()=>library.records(owner,bookId);
      if(action.startsWith('audio-')){
        if(!audio)throw fail('此实例暂未开启听读，请在本机书房使用。',503);
        if(action==='audio-prepare'&&req.method==='POST'){send(200,await audio.prepare(owner,bookId,body));return true;}
        if(action==='audio-generate'&&req.method==='POST'){send(202,await audio.createSession(owner,bookId,body,{key:audioHash(agentToken),authorize:()=>library.authorize(agentToken,bookId,'audio:generate')}));return true;}
        if(action==='audio-status'&&req.method==='GET'){const resume=await library.authorize(agentToken,bookId,'audio:generate').then(()=>true).catch(()=>false),s=await audio.getSession(owner,bookId,url.searchParams.get('sessionId'),{key:audioHash(agentToken),resume,authorize:()=>library.authorize(agentToken,bookId,'audio:generate')});send(200,{...s,clips:s.clips.map(c=>({...c,uri:`reader://books/${bookId}/audio/clips/${c.id}`}))});return true;}
        if(action==='audio-cancel'&&req.method==='POST'){send(200,await audio.cancelSession(owner,bookId,body.sessionId));return true;}
        if(action==='audio-clip'&&req.method==='GET'){const {bytes,mimeType}=await audio.getClip(owner,bookId,url.searchParams.get('clipId'));res.statusCode=200;res.setHeader('Content-Type',mimeType);res.setHeader('Cache-Control','private, no-store');res.end(bytes);return true;}
        throw fail('不支持这个听读操作',405);
      }
      if(['manifest','context','chapter','passage','search','notes','activity'].includes(action)&&req.method==='GET'){const args=agentReadArgs(action,url.searchParams),activityAllowed=action==='context'&&await library.authorize(agentToken,bookId,'activity').then(()=>true).catch(()=>false);send(200,await scopedAgentRead({action,args,book,records,activityAllowed}));return true;}
      if(action==='comment'&&req.method==='POST'){if(body.origin!=='user')throw fail('只保存用户明确提供的原话');send(201,await library.addComment(owner,bookId,body));return true;}
      throw fail('不支持这个请求',405);
    }
    throw fail('找不到这个操作',404);
  }
  return {handle,library,portability,auth,profile,gifts,giftQuotes,audio,audioRoutes,chat,bookIntroductions,dailyReading,ingestionRunner,setLegacyBook:book=>{legacyBook=book;}};
}
