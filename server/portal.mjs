import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createLibraryService} from './library-service.mjs';
import {createEmailAuth,smtpSender} from './email-auth.mjs';
import {createTranslator} from './translation.mjs';
import {fail} from './document-import.mjs';
import {createAudioStore} from './audio-store.mjs';
import {createAudioService} from './audio-service.mjs';
import {createSpeechProvider} from './audio-provider.mjs';
import {createDialogueGenerator} from './dialogue-generator.mjs';
import {createAudioRoutes} from './audio-routes.mjs';
import {portalDocument} from './portal-document.mjs';
import {roomExcerpt} from '../app/library-workspace.mjs';
import {createReaderChatService} from './reader-chat.mjs';
import {createReaderChatGenerator} from './reader-chat-generator.mjs';
import {authPurpose} from './auth-policy.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const cookieToken=req=>(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith('marginalia_session='))?.slice('marginalia_session='.length);
const jsonBody=async(req,limit=29*1024*1024)=>{if(!req.headers['content-type']?.startsWith('application/json'))throw fail('请使用 JSON 请求',415);if(req.body&&typeof req.body==='object'){if(Buffer.byteLength(JSON.stringify(req.body))>limit)throw fail('这次导入内容过大，请分书恢复',413);return req.body;}let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>limit)throw fail('这次导入内容过大，请分书恢复',413);chunks.push(chunk);}try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw fail('请求格式不正确');}};
const passageList=book=>book.sections.flatMap(s=>s.paragraphs.map(p=>({...p,chapterId:s.chapterId})));
export async function createPortal({dataDir,publicOrigin=null,sendCode,translator,catalogDir=path.join(root,'catalog'),allowLocal=true,dataStore=null,authService=null,hostedMcp=false,speechProvider,dialogueGenerator,chatGenerator}={}){
  const auth=authService||await createEmailAuth({dataDir:path.join(dataDir,'auth'),sendCode:sendCode===undefined?await smtpSender():sendCode});
  const library=await createLibraryService({dataDir:path.join(dataDir,'library'),catalogDir,translator:translator===undefined?createTranslator():translator,dataStore});
  const chat=await createReaderChatService({library,dataDir:path.join(dataDir,'library'),dataStore,generator:chatGenerator===undefined?createReaderChatGenerator():chatGenerator});
  let legacyBook=null;
  const audioLibrary={getBook:(owner,id)=>owner?.id==='legacy-local'&&legacyBook?.bookId===id?Promise.resolve(legacyBook):library.getBook(owner,id)};
  const audio=allowLocal&&!publicOrigin&&!dataStore?await createAudioService({store:await createAudioStore({dataDir:path.join(dataDir,'audio')}),getBook:audioLibrary.getBook,speechProvider:speechProvider===undefined?createSpeechProvider():speechProvider,dialogueGenerator:dialogueGenerator===undefined?createDialogueGenerator():dialogueGenerator}):null;
  const audioRoutes=createAudioRoutes({audio,library:audioLibrary});
  async function handle({req,res,url,send}){
    const p=url.pathname,isAPI=p.startsWith('/api/auth/')||p.startsWith('/api/library')||p.startsWith('/api/agent/');
    const files={'/':'home.html','/library':'home.html','/privacy':'privacy.html','/auth.css':'auth.css','/auth-dialog.mjs':'auth-dialog.mjs','/auth-flow.mjs':'auth-flow.mjs','/auth-assets/google.png':'auth-assets/google.png','/auth-assets/apple.svg':'auth-assets/apple.svg','/portal.css':'portal.css','/portal.js':'portal.js','/owner-scope.mjs':'owner-scope.mjs','/paragraph-anchor.mjs':'paragraph-anchor.mjs','/source-language.mjs':'source-language.mjs','/upload-state.mjs':'upload-state.mjs','/library-backup.mjs':'library-backup.mjs','/reader-api.mjs':'reader-api.mjs','/reading-progress.mjs':'reading-progress.mjs','/progress-sync.mjs':'progress-sync.mjs','/reader-translation.js':'reader-translation.js'};
    files['/home-motion.css']='home-motion.css';files['/home-motion.mjs']='home-motion.mjs';
    files['/reading-session-record.mjs']='reading-session-record.mjs';
    files['/reading-toolbar.mjs']='reading-toolbar.mjs';
    files['/reading-flow.mjs']='reading-flow.mjs';files['/reading-load.mjs']='reading-load.mjs';
    files['/reading-flow.css']='reading-flow.css';
    for(const file of ['library-workspace.mjs','library-workspace.css','reading-calendar.mjs','reading-dashboard.mjs','library-restore.mjs','library-export.mjs','site-appearance.mjs','reading-clock.mjs','reading-outbox.mjs','reading-queue-store.mjs','reading-session-coordinator.mjs','reading-mark-actions.mjs','reading-mark-store.mjs','reading-draft-store.mjs','reading-retained-backup.mjs','reading-journey.mjs','reading-pending-backup.mjs','reading-ending-context.mjs','reading-session.js','reading-session.css','brand-assets/reading-window.webp','brand-assets/page-detail.webp','brand-assets/page-mark.svg'])files['/'+file]=file;
    for(const file of ['library-shell.mjs','library-shell.css','library-chat.mjs','library-chat-state.mjs','library-chat.css','icons.svg','icons-LICENSE.txt'])files['/'+file]=file;
    if(!isAPI&&!files[p])return false;
    if(!isAPI){if(req.method!=='GET'&&req.method!=='HEAD')throw fail('不支持这个请求',405);const type=p.endsWith('.webp')?'image/webp':p.endsWith('.png')?'image/png':p.endsWith('.svg')?'image/svg+xml':p.endsWith('.css')?'text/css':p.endsWith('.js')||p.endsWith('.mjs')?'text/javascript':'text/html';const file=await readFile(path.join(root,'app',files[p]));send(200,files[p]==='home.html'?portalDocument(file.toString('utf8'),p):file,type);return true;}
    if(req.method!=='GET'&&req.method!=='POST')throw fail('不支持这个请求',405);
    const origin='http://'+req.headers.host;
    if(req.headers.origin&&req.headers.origin!==origin&&req.headers.origin!==publicOrigin)throw fail('请求来源未授权',403);
    if(req.method==='POST'&&!p.startsWith('/api/agent/')&&req.headers.origin!==origin&&req.headers.origin!==publicOrigin)throw fail('请求来源未授权',403);
    const flowToken=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('marginalia_auth_flow='))?.slice('marginalia_auth_flow='.length);
    const setFlow=value=>`marginalia_auth_flow=${value}; HttpOnly; Secure; SameSite=Lax; Path=/api/auth; Max-Age=${value?600:0}`;
    if(p==='/api/auth/callback'&&req.method==='GET'){
      if(!publicOrigin||typeof auth.finishOAuth!=='function'){send(404,{error:'这个登录入口尚未开放'});return true;}
      let next,session,returnTo=null,errorCode='expired';
      try{
        if(url.searchParams.has('error')){returnTo=await auth.cancelOAuth(flowToken);errorCode='cancelled';}
        else{session=await auth.finishOAuth(flowToken,url.searchParams.get('code'));next=session.next;}
      }catch(error){errorCode=error.status>=500?'unavailable':'expired';returnTo=await auth.cancelOAuth(flowToken).catch(()=>null);}
      if(!session){const query=new URLSearchParams({login:'1',auth_error:errorCode});if(returnTo?.startsWith('/read?'))query.set('next',returnTo);else if(returnTo==='/library?upload=1')query.set('upload','1');next='/library?'+query;}
      const cookies=[setFlow('')];if(session)cookies.push(`marginalia_session=${session.token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800; Secure`);
      res.setHeader('Set-Cookie',cookies);res.setHeader('Cache-Control','private, no-store');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Location',new URL(next,publicOrigin).href);res.statusCode=303;res.end();return true;
    }
    const token=cookieToken(req);
    if(p==='/api/auth/logout'&&req.method==='POST'){await jsonBody(req,4096);await auth.logout(token);res.setHeader('Set-Cookie',`marginalia_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${publicOrigin?.startsWith('https:')?'; Secure':''}`);send(200,{signedOut:true});return true;}
    const user=await auth.userFor(token);
    if(p.startsWith('/api/library')&&req.headers['x-reader-owner']&&req.headers['x-reader-owner']!==(user?.id||'guest')){res.setHeader('X-Reader-Session-Changed','1');throw fail('账户已切换，请重新进入书房。原账户草稿仍留在原处。',409);}
    const body=req.method==='POST'?await jsonBody(req,p.startsWith('/api/auth/')?4096:p.endsWith('/audio/import')||p.endsWith('/audio/validate')?32*1024*1024:['/api/library/import','/api/library/validate'].includes(p)?200*1024*1024:29*1024*1024):null;
    const localAllowed=allowLocal&&['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress)&&!publicOrigin;
    const setSession=value=>res.setHeader('Set-Cookie',`marginalia_session=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${value?604800:0}${publicOrigin?.startsWith('https:')?'; Secure':''}`);
    if(p==='/api/auth/session'&&req.method==='GET'){const capabilities=auth.capabilities?await auth.capabilities():{email:auth.emailAvailable,providers:{google:false,apple:false},otp:{digits:6,expiresIn:600,retryAfter:60}};send(200,{user,emailAvailable:capabilities.email,passwordAvailable:capabilities.password===true,providers:capabilities.providers,otp:capabilities.otp,localAvailable:localAllowed,translationAvailable:library.translationAvailable,directUpload:!!dataStore?.beginUpload});return true;}
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
    if(p==='/api/library'&&req.method==='GET'){send(200,{books:await library.list(user),user});return true;}
    if(p==='/api/library/activity'&&req.method==='GET'){send(200,await library.readingActivity(user,{month:url.searchParams.get('month'),timeZone:url.searchParams.get('timeZone')}));return true;}
    if(p==='/api/library/mcp-setup'&&req.method==='GET'){
      if(!user)throw fail('请先进入自己的书房',401);
      if(hostedMcp){send(200,{hosted:true,serviceUrl:publicOrigin});return true;}
      if(!localAllowed)throw fail('本机接入配置只能在运行循页的电脑上读取。远程接入尚未支持。',403);
      const loopback=req.socket.localAddress==='::1'?'[::1]':'127.0.0.1';
      send(200,{command:process.execPath,args:[path.join(root,'server/mcp.mjs')],serviceUrl:'http://'+loopback+':'+req.socket.localPort});return true;
    }
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
    if(p==='/api/library/export'&&req.method==='GET'){res.setHeader('Content-Disposition','attachment; filename="marginalia-library.json"');send(200,await library.exportLibrary(user));return true;}
    if(p==='/api/library/export/manifest'&&req.method==='GET'){send(200,await library.exportManifest(user));return true;}
    if(p==='/api/library/import'&&req.method==='POST'){send(200,await library.restoreLibrary(user,body));return true;}
    if(p==='/api/library/validate'&&req.method==='POST'){send(200,await library.validateRestore(user,body));return true;}
    if(p==='/api/library/grants'){if(req.method==='GET')send(200,{grants:await library.grants(user)});else send(201,await library.createGrant(user,body));return true;}
    const revoke=p.match(/^\/api\/library\/grants\/([^/]+)\/revoke$/);if(revoke&&req.method==='POST'){send(200,await library.revokeGrant(user,revoke[1]));return true;}
    const match=p.match(/^\/api\/library\/books\/([^/]+)(?:\/(.+))?$/);
    if(match){const [,id,action]=match;
      if(action?.startsWith('audio/'))return audioRoutes.handle({req,res,url,user,bookId:id,action:action.slice(6),body,send});
      if(!action&&req.method==='GET'){send(200,await library.getBook(user,id));return true;}
      if(action==='preview'&&req.method==='GET'){const book=await library.getBook(user,id);send(200,roomExcerpt(book,url.searchParams.get('passageId')||undefined));return true;}
      if(action==='chat'&&req.method==='GET'){send(200,await chat.view(user,id,{passageId:url.searchParams.get('passageId')||undefined}));return true;}
      if(action==='chat'&&req.method==='POST'){send(200,await chat.send(user,id,body));return true;}
      const cancelChat=action?.match(/^chat\/([^/]+)\/cancel$/);if(cancelChat&&req.method==='POST'){send(200,await chat.cancel(user,id,cancelChat[1]));return true;}
      if(action==='export-part'&&req.method==='GET'){send(200,await library.exportBookPart(user,id,{offset:Number(url.searchParams.get('offset')||0),snapshot:url.searchParams.get('snapshot')}));return true;}
      if(action==='original/info'&&req.method==='GET'){send(200,await library.originalInfo(user,id));return true;}
      if(action==='original'&&req.method==='GET'){if(dataStore?.signedBlob){const file=await library.originalDownload(user,id);res.statusCode=302;res.setHeader('Location',file.url+'&download=original.'+(['pdf','txt','md'].includes(file.format)?file.format:'bin'));res.setHeader('Cache-Control','private, no-store');res.end();return true;}const file=await library.getOriginal(user,id);res.statusCode=200;res.setHeader('Content-Type','application/octet-stream');res.setHeader('Content-Disposition','attachment; filename="original.'+(['pdf','txt','md'].includes(file.format)?file.format:'bin')+'"');res.setHeader('Cache-Control','private, no-store');res.setHeader('Content-Length',file.bytes.length);res.end(file.bytes);return true;}
      if(['records','records/export'].includes(action)&&req.method==='GET'){send(200,await library.records(user,id));return true;}
      if(['comments','questions'].includes(action)&&req.method==='POST'){send(201,await library.addComment(user,id,body,action));return true;}
      if(action==='progress'&&req.method==='POST'){send(200,await library.saveProgress(user,id,body));return true;}
      if(action==='reading-sessions'&&req.method==='POST'){send(201,await library.saveReadingSession(user,id,body));return true;}
      if(action==='reading-milestones'&&req.method==='POST'){send(201,await library.recordReadingMilestone(user,id,body));return true;}
      if(action==='reading-goal'&&req.method==='POST'){send(200,await library.setReadingGoal(user,id,body));return true;}
      if(action==='translate'&&req.method==='POST'){send(200,await library.translate(user,id,body.passageId));return true;}
      if(action==='experiences'&&req.method==='GET'){const book=await library.getBook(user,id);send(200,{bookId:id,contentVersion:book.contentVersion,xrays:[],cards:[],invitations:[],states:{},echoes:[],echoAvailable:false});return true;}
      if(action==='experience-events'&&req.method==='POST'){await library.getBook(user,id);send(200,{accepted:0,reason:'本书尚未开启探索体验统计'});return true;}
      if(action==='records/import'&&req.method==='POST'){const book=await library.getBook(user,id);if(body?.bookId!==id||body.kind!=='marginalia-personal-records')throw fail('请选择这本书的记录包');send(200,await library.restoreLibrary(user,{kind:'marginalia-library',schemaVersion:1,books:[{book,records:body}]}));return true;}
      if(['echo','explain','experiences/export','experiences/import'].includes(action))throw fail('这本书的探索体验尚未接入，可以按段翻译并保存自己的笔记',503);
    }
    if(p.startsWith('/api/agent/')){
      const action=p.slice('/api/agent/'.length),bookId=url.searchParams.get('bookId')||body?.bookId,agentToken=req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
      const scopes={context:'content',chapter:'content',search:'content',notes:'notes',activity:'activity',comment:'comment:write','audio-prepare':'content','audio-generate':'audio:generate','audio-status':'audio:read','audio-cancel':'audio:generate','audio-clip':'audio:read'};if(!scopes[action])throw fail('找不到这个工具',404);
      const owner=await library.authorize(agentToken,bookId,scopes[action]),book=await library.getBook(owner,bookId),passages=passageList(book),records=()=>library.records(owner,bookId);
      if(action.startsWith('audio-')){
        if(!audio)throw fail('此实例暂未开启听读，请在本机书房使用。',503);
        if(action==='audio-prepare'&&req.method==='POST'){send(200,await audio.prepare(owner,bookId,body));return true;}
        if(action==='audio-generate'&&req.method==='POST'){send(202,await audio.createSession(owner,bookId,body,{authorize:()=>library.authorize(agentToken,bookId,'audio:generate')}));return true;}
        if(action==='audio-status'&&req.method==='GET'){const s=await audio.getSession(owner,bookId,url.searchParams.get('sessionId'));send(200,{...s,clips:s.clips.map(c=>({...c,uri:`reader://books/${bookId}/audio/clips/${c.id}`}))});return true;}
        if(action==='audio-cancel'&&req.method==='POST'){send(200,await audio.cancelSession(owner,bookId,body.sessionId));return true;}
        if(action==='audio-clip'&&req.method==='GET'){const {bytes,mimeType}=await audio.getClip(owner,bookId,url.searchParams.get('clipId'));res.statusCode=200;res.setHeader('Content-Type',mimeType);res.setHeader('Cache-Control','private, no-store');res.end(bytes);return true;}
        throw fail('不支持这个听读操作',405);
      }
      if(action==='context'&&req.method==='GET'){const activityAllowed=await library.authorize(agentToken,bookId,'activity').then(()=>true).catch(()=>false),saved=activityAllowed?await records():null,requested=url.searchParams.get('passageId');if(requested&&!passages.some(p=>p.id===requested))throw fail('找不到当前授权段落',404);const index=Math.max(0,passages.findIndex(p=>p.id===(requested||saved?.position?.passageId||book.readingStart?.passageId)));send(200,{bookId,contentVersion:book.contentVersion,title:book.title,chapters:book.chapters,position:saved?.position?{chapterId:saved.position.chapterId,passageId:saved.position.passageId}:null,passages:passages.slice(Math.max(0,index-1),index+2)});return true;}
      if(action==='chapter'&&req.method==='GET'){const chapterId=url.searchParams.get('chapterId');if(!book.chapters.some(c=>c.id===chapterId))throw fail('找不到这一章',404);const start=Number(url.searchParams.get('offset')||0),limit=Number(url.searchParams.get('limit')||10);if(!Number.isInteger(start)||start<0||!Number.isInteger(limit)||limit<1||limit>20)throw fail('分页范围无效');const chapter=passages.filter(p=>p.chapterId===chapterId);send(200,{bookId,contentVersion:book.contentVersion,passages:chapter.slice(start,start+limit),nextOffset:start+limit<chapter.length?start+limit:null});return true;}
      if(action==='search'&&req.method==='GET'){const query=url.searchParams.get('query');if(!query?.trim()||query.length>200)throw fail('请输入检索词');send(200,{bookId,results:passages.filter(p=>p.original.toLowerCase().includes(query.toLowerCase())).slice(0,20).map(p=>({id:p.id,chapterId:p.chapterId,excerpt:p.original.slice(0,800),source:p.source}))});return true;}
      if(action==='notes'&&req.method==='GET'){const data=await records(),offset=Number(url.searchParams.get('offset')||0);if(!Number.isInteger(offset)||offset<0)throw fail('分页范围无效');const rows=[...data.comments.map(r=>({...r,type:'comment'})),...data.questions.map(r=>({...r,type:'question'}))];send(200,{bookId,records:rows.slice(offset,offset+20),nextOffset:offset+20<rows.length?offset+20:null});return true;}
      if(action==='activity'&&req.method==='GET'){const data=await records();send(200,{bookId,position:data.position,readingSessions:data.readingSessions.slice(-20),readingMilestones:data.readingMilestones.slice(-20),readingGoal:data.readingGoal||null,meaning:'阅读记录只记录投入和用户自己的标记，Agent 访问不计入阅读时间，时长不证明理解'});return true;}
      if(action==='comment'&&req.method==='POST'){if(body.origin!=='user')throw fail('只保存用户明确提供的原话');send(201,await library.addComment(owner,bookId,body));return true;}
      throw fail('不支持这个请求',405);
    }
    throw fail('找不到这个操作',404);
  }
  return {handle,library,auth,audio,audioRoutes,chat,setLegacyBook:book=>{legacyBook=book;}};
}
