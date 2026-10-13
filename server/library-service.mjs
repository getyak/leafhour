import {mkdir,readFile,writeFile,rename,stat} from 'node:fs/promises';
import path from 'node:path';
import {randomBytes,randomUUID} from 'node:crypto';
import {extractDocument,makeBook,digest,fail,MAX_FILE_BYTES} from './document-import.mjs';
import {normalizeAppearance} from '../app/reading-preferences.mjs';
import {applyCatalogChapters,alignReadingPosition} from './catalog-chapters.mjs';
import {resumeSummary} from '../app/reading-progress.mjs';
import {validateLibraryBackup} from '../app/library-backup.mjs';
import {inferSourceLanguage} from '../app/source-language.mjs';
import {validParagraphAnchor} from '../app/paragraph-anchor.mjs';

const requireUser=user=>{if(!user?.id)throw fail('请先进入自己的书房',401);return user;};
const emptyRecords=book=>({kind:'marginalia-personal-records',schemaVersion:2,bookId:book.bookId,contentVersion:book.contentVersion,comments:[],questions:[],readingSessions:[],position:null});
const allPassages=book=>book.sections.flatMap(s=>s.paragraphs.map(p=>({...p,chapterId:s.chapterId})));
const brief=book=>({bookId:book.bookId,title:book.title,author:book.author,visibility:book.visibility,source:book.source,cover:book.cover,description:book.description,paragraphs:allPassages(book).length,chapters:book.chapters.length,createdAt:book.createdAt});

export async function createLibraryService({dataDir,catalogDir=path.resolve('catalog'),translator=null,dataStore=null}={}){
  if(!dataStore)await mkdir(dataDir,{recursive:true,mode:0o700});
  const publicBooks=new Map(),queues=new Map(),translationsRunning=new Set();
  const userDir=user=>path.join(dataDir,'users',digest(requireUser(user).id));
  const read=async(file,fallback)=>{if(dataStore)return dataStore.read(file,fallback);try{return JSON.parse(await readFile(file,'utf8'));}catch(e){if(e.code==='ENOENT')return structuredClone(fallback);throw e;}};
  const mutate=async(file,fallback,operation)=>{
    if(dataStore)return dataStore.mutate(file,fallback,operation);
    const prior=queues.get(file)||Promise.resolve();
    const work=prior.catch(()=>{}).then(async()=>{const data=await read(file,fallback),result=await operation(data);await mkdir(path.dirname(file),{recursive:true,mode:0o700});const pending=file+'.'+randomUUID()+'.pending';await writeFile(pending,JSON.stringify(data),{mode:0o600});await rename(pending,file);return result;});
    queues.set(file,work);try{return await work;}finally{if(queues.get(file)===work)queues.delete(file);}
  };
  if(catalogDir){
    const entries=JSON.parse(await readFile(path.join(catalogDir,'manifest.json'),'utf8'));
    for(const entry of entries){const bytes=await readFile(path.join(catalogDir,entry.file));const extracted=await extractDocument({filename:entry.file,bytes});
      // Keep the complete licensed original in the source file; remove only the Gutenberg wrapper from the reading view.
      const body=extracted.pages[0].text,match=body.match(/\*\*\* START OF THE PROJECT GUTENBERG EBOOK[^\n]*\*\*\*([\s\S]*?)\*\*\* END OF THE PROJECT GUTENBERG EBOOK/);
      if(match)extracted.pages[0].text=match[1].trim();
      const book=makeBook({bookId:entry.id,filename:entry.file,sourceHash:digest(bytes),extracted,title:entry.title,author:entry.author,visibility:'public',sourceUrl:entry.sourceUrl,license:'Project Gutenberg · Public domain in the USA; check your local law and the included Gutenberg license.'});
      book.title.en=entry.originalTitle;book.description=entry.description;book.cover=entry.cover;publicBooks.set(book.bookId,applyCatalogChapters(book));
    }
  }
  const bookFile=(user,id)=>path.join(userDir(user),'books',digest(id)+'.json');
  const recordFile=(user,id)=>path.join(userDir(user),'records',digest(id)+'.json');
  async function getBook(user,id){
    if(typeof id!=='string'||id.length>128)throw fail('找不到这本书',404);
    let book=publicBooks.get(id);
    if(!book){if(!user)throw fail('找不到这本书',404);book=await read(bookFile(user,id),null);}
    if(!book)throw fail('找不到这本书',404);
    book=structuredClone(book);
    if(book.visibility==='private')book.sourceLanguage=inferSourceLanguage(book.sections.flatMap(s=>s.paragraphs).slice(0,10).map(p=>p.original).join('\n'));
    if(user){const overlay=await read(path.join(userDir(user),'translations',digest(id)+'.json'),{});for(const p of book.sections.flatMap(s=>s.paragraphs))if(overlay[p.id]?.contentVersion===book.contentVersion)p.translations=overlay[p.id].translations;}
    return book;
  }
  async function list(user){
    const index=user?await read(path.join(userDir(user),'index.json'),{books:[]}):{books:[]},rows=[...publicBooks.values()].map(brief).concat(index.books);
    return Promise.all(rows.map(async row=>{if(!user)return {...row,resume:null};const data=await read(recordFile(user,row.bookId),{position:null});if(!data.position)return {...row,resume:null};const book=publicBooks.get(row.bookId)||await read(bookFile(user,row.bookId),null);return {...row,resume:book?resumeSummary(book,data.position):null};}));
  }
  async function importDocument(user,input){
    requireUser(user);const extracted=await extractDocument(input),hash=digest(input.bytes);let id='private-'+digest(user.id+hash).slice(0,24),existing=await read(bookFile(user,id),null);
    if(!existing){const index=await read(path.join(userDir(user),'index.json'),{books:[]});for(const row of index.books.filter(b=>b.source?.sha256===hash)){const candidate=await read(bookFile(user,row.bookId),null);if(candidate?.contentVersion===hash&&candidate.source?.sha256===hash){existing=candidate;id=candidate.bookId;break;}}}
    if(existing&&(existing.contentVersion!==hash||existing.source?.sha256!==hash))throw fail('已保存的原文版本与此文件不一致，未覆盖书籍或记录',409);
    const book=existing||makeBook({bookId:id,filename:input.filename,sourceHash:hash,extracted});
    if(dataStore&&Buffer.byteLength(JSON.stringify(book))>3500000)throw fail('这本书提取后的文字过多，请按章节拆分后上传到云端；原文件尚未加入书房',413);
    const originals=path.join(userDir(user),'originals');
    if(dataStore)await dataStore.putBlob(path.join(originals,hash),input.bytes);
    else {await mkdir(originals,{recursive:true,mode:0o700});const temporary=path.join(originals,hash+'.'+randomUUID()+'.pending');await writeFile(temporary,input.bytes,{mode:0o600});await rename(temporary,path.join(originals,hash));}
    if(!existing)await mutate(bookFile(user,id),{},data=>Object.assign(data,book));
    await mutate(path.join(userDir(user),'index.json'),{books:[]},data=>{if(!data.books.some(b=>b.bookId===id))data.books.push(brief(book));});return getBook(user,id);
  }
  async function originalInfo(user,id){
    requireUser(user);const book=await getBook(user,id);if(book.visibility!=='private')throw fail('公版书请使用书籍出处查看底本',404);
    const hash=book.source?.sha256;if(typeof hash!=='string'||!/^[a-f0-9]{64}$/.test(hash)||hash!==book.contentVersion)throw fail('原文件信息不完整，请保留提取原文并重新上传原文件',409);
    const filename=typeof book.source.filename==='string'?book.source.filename:'original.'+book.source.format;
    try{const file=dataStore?await dataStore.blobInfo(path.join(userDir(user),'originals',hash)):await stat(path.join(userDir(user),'originals',hash));if(!file)throw Object.assign(new Error('Missing original'),{code:'ENOENT'});if((file.isFile&&!file.isFile())||file.size>MAX_FILE_BYTES)throw fail('原文件不完整，请重新上传',409);return {available:true,filename,format:book.source.format,bytes:file.size};}
    catch(error){if(error.code!=='ENOENT')throw error;return {available:false,filename,format:book.source.format,reason:'此书房没有原文件。JSON 备份只包含提取文字与记录；重新上传同一原文件即可补回。'};}
  }
  async function getOriginal(user,id){
    const info=await originalInfo(user,id);if(!info.available)throw fail(info.reason,404);const book=await getBook(user,id),bytes=await (dataStore?dataStore.blob(path.join(userDir(user),'originals',book.source.sha256)):readFile(path.join(userDir(user),'originals',book.source.sha256)));
    if(bytes.length>MAX_FILE_BYTES||digest(bytes)!==book.contentVersion)throw fail('原文件校验失败，未提供损坏的文件，请重新上传',409);
    return {...info,bytes};
  }
  async function originalDownload(user,id){
    const file=await getOriginal(user,id),book=await getBook(user,id);
    return {...file,bytes:undefined,url:await dataStore.signedBlob(path.join(userDir(user),'originals',book.source.sha256))};
  }
  async function records(user,id){const book=await getBook(user,id);if(!user)return emptyRecords(book);const data=await read(recordFile(user,id),emptyRecords(book));data.position=alignReadingPosition(book,data.position);return data;}
  async function addComment(user,id,input,type='comments'){
    requireUser(user);const book=await getBook(user,id);
    if(!['comments','questions'].includes(type)||typeof input?.id!=='string'||!input.id||input.id.length>128||typeof input.text!=='string'||!input.text.trim()||input.text.length>2000||!allPassages(book).some(p=>p.id===input.passageId)||input.origin&&input.origin!=='user'||input.contentVersion&&input.contentVersion!==book.contentVersion)throw fail('记录无法对应当前原文');
    const record={id:input.id,bookId:id,contentVersion:book.contentVersion,passageId:input.passageId,text:input.text,origin:'user',createdAt:new Date().toISOString(),...(type==='questions'?{status:'open'}:{})};
    if(typeof input.quote==='string'&&input.quote.length<=4000){record.quote=input.quote;record.quoteLanguage=input.quoteLanguage==='en'?'en':'zh';if(['original','translation'].includes(input.quoteOrigin))record.quoteOrigin=input.quoteOrigin;}
    return mutate(recordFile(user,id),emptyRecords(book),data=>{const old=data[type].find(r=>r.id===record.id);if(old){if(old.passageId!==record.passageId||old.text!==record.text)throw fail('记录标识冲突',409);return old;}if(data[type].length>=10000)throw fail('请先导出记录',413);data[type].push(record);return record;});
  }
  async function saveProgress(user,id,input){
    requireUser(user);const book=await getBook(user,id),passage=allPassages(book).find(p=>p.id===input.passageId);
    if(!passage||passage.chapterId!==input.chapterId||!validParagraphAnchor(input)||!['zh','en','parallel'].includes(input.mode)||!['literal','interpretive'].includes(input.variant))throw fail('阅读位置无法对应原文');
    let appearance;try{appearance=normalizeAppearance(input,true);}catch{throw fail('阅读设置不正确');}
    if(input.baseRevision!==undefined&&(!Number.isInteger(input.baseRevision)||input.baseRevision<0))throw fail('阅读位置版本不正确');
    const position={chapterId:input.chapterId,passageId:input.passageId,contentVersion:book.contentVersion,offset:input.offset,...(input.withinParagraph!==undefined?{withinParagraph:input.withinParagraph}:{}),mode:input.mode,variant:input.variant,...appearance};
    return mutate(recordFile(user,id),emptyRecords(book),data=>{const revision=data.position?.revision||0;if(input.baseRevision!==undefined&&input.baseRevision!==revision)throw fail('阅读位置已在另一处更新，请选择从哪里继续',409);data.position={...position,revision:revision+1,updatedAt:new Date().toISOString()};return data.position;});
  }
  async function translate(user,id,passageId){
    requireUser(user);const book=await getBook(user,id),passages=allPassages(book),i=passages.findIndex(p=>p.id===passageId);
    if(i<0)throw fail('找不到当前段落',404);
    if(passages[i].translations.literal&&passages[i].translations.interpretive)return passages[i];
    if(inferSourceLanguage(passages[i].original)==='zh')throw fail('这段原文为中文，无需生成中文译文；原文与个人记录仍可使用');
    if(!translator)throw fail('翻译服务尚未配置，原文仍可继续阅读',503);
    const key=user.id+'|'+id+'|'+passageId;if(translationsRunning.has(key))throw fail('这一段正在翻译，请稍后查看',409);if(translationsRunning.size>=2)throw fail('翻译服务正在处理其他段落，请稍后再试',429);
    translationsRunning.add(key);let ticket;
    try{
      if(dataStore?.reserveTranslation)ticket=await dataStore.reserveTranslation(user,id,passageId);
      const result=await translator({passageId,sourceLanguage:inferSourceLanguage(passages[i].original),targetLanguage:'zh',passages:passages.slice(Math.max(0,i-1),i+2).map(p=>({id:p.id,original:p.original})),sourceVersion:book.contentVersion});
      if(!result||!['literal','interpretive'].every(k=>typeof result[k]==='string'&&result[k].trim()&&result[k].length<=12000))throw fail('翻译结果不完整，请重试；原文已保留',502);
      const translations=Object.fromEntries(['literal','interpretive'].map(variant=>[variant,{text:result[variant],status:'draft',variant,origin:'ai',model:result.model||'configured-provider',sourceVersion:book.contentVersion,createdAt:new Date().toISOString()}]));
      await mutate(path.join(userDir(user),'translations',digest(id)+'.json'),{},data=>{data[passageId]={contentVersion:book.contentVersion,translations};});return {...passages[i],translations};
    }finally{translationsRunning.delete(key);if(ticket)await dataStore.releaseTranslation(ticket).catch(()=>{});}
  }
  const grantsFile=path.join(dataDir,'grants.json');
  async function createGrant(user,{bookId,scopes}){
    requireUser(user);await getBook(user,bookId);if(!Array.isArray(scopes)||!scopes.length||scopes.some(s=>!['content','notes','activity','comment:write'].includes(s)))throw fail('请选择授权范围');
    const token=randomBytes(32).toString('base64url'),grant={id:randomUUID(),ownerId:user.id,bookId,scopes:[...new Set(scopes)],tokenHash:digest(token),createdAt:new Date().toISOString(),expiresAt:new Date(Date.now()+7*86400000).toISOString(),revoked:false};
    await mutate(grantsFile,{grants:[]},data=>{if(data.grants.filter(g=>g.ownerId===user.id&&!g.revoked).length>=50)throw fail('请先撤回不再使用的授权',413);data.grants.push(grant);});
    const {tokenHash,ownerId,...visible}=grant;return {...visible,token};
  }
  async function authorize(token,id,scope){const data=await read(grantsFile,{grants:[]}),grant=typeof token==='string'&&data.grants.find(g=>g.tokenHash===digest(token));if(!grant||grant.revoked||Date.parse(grant.expiresAt)<=Date.now()||grant.bookId!==id||!grant.scopes.includes(scope))throw fail('Agent 授权无效或范围不足',403);return {id:grant.ownerId};}
  async function grants(user){requireUser(user);return (await read(grantsFile,{grants:[]})).grants.filter(g=>g.ownerId===user.id).map(({ownerId,tokenHash,...g})=>g);}
  async function revokeGrant(user,id){requireUser(user);return mutate(grantsFile,{grants:[]},data=>{const grant=data.grants.find(g=>g.id===id&&g.ownerId===user.id);if(!grant)throw fail('找不到这条授权',404);grant.revoked=true;return {revoked:true};});}
  async function exportLibrary(user){requireUser(user);const books=[];for(const row of await list(user)){const book=await getBook(user,row.bookId);books.push({book,records:await records(user,row.bookId)});}return {kind:'marginalia-library',schemaVersion:1,exportedAt:new Date().toISOString(),books,includesOriginalFiles:false};}
  async function validateRestore(user,backup){
    requireUser(user);const summary=validateLibraryBackup(backup);
    // Validate the entire package before changing any persisted data.
    for(const entry of backup.books){const b=entry?.book,r=entry?.records;if(!b||typeof b.bookId!=='string'||!b.bookId||b.bookId.length>128||typeof b.contentVersion!=='string'||!Array.isArray(b.chapters)||!b.chapters.length||!Array.isArray(b.sections)||b.sections.some(s=>!Array.isArray(s?.paragraphs))||!Array.isArray(b.annotations)||!Array.isArray(b.glossary)||!b.title||typeof b.title.zh!=='string'||!b.source||typeof b.source.format!=='string')throw fail('书籍格式不完整');
      if(dataStore&&Buffer.byteLength(JSON.stringify(b))>3500000)throw fail('这本备份的文字量超过云端限制，请在本机恢复',413);
      const existing=publicBooks.get(b.bookId)||await read(bookFile(user,b.bookId),null);if(existing&&(existing.contentVersion!==b.contentVersion||JSON.stringify(allPassages(existing).map(p=>[p.id,p.original]))!==JSON.stringify(allPassages(b).map(p=>[p.id,p.original]))))throw fail('备份的原文版本与书房已有内容冲突，未覆盖原书或记录',409);
      const passages=allPassages(b),ids=new Set(passages.map(p=>p.id));if(!passages.length||ids.size!==passages.length||passages.some(p=>typeof p.id!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(p.id)||typeof p.original!=='string'||!p.translations||Array.isArray(p.translations)||!b.chapters.some(c=>c.id===p.chapterId)))throw fail('原文锚点不完整');
      if(!r||r.bookId!==b.bookId||!Array.isArray(r.comments)||!Array.isArray(r.questions)||!Array.isArray(r.readingSessions)||[...r.comments,...r.questions].some(n=>!ids.has(n.passageId)||n.origin!=='user'||typeof n.text!=='string'||n.text.length>2000))throw fail('个人记录无法对应原文');
      if(r.position&&!passages.some(p=>p.id===r.position.passageId&&p.chapterId===r.position.chapterId))throw fail('阅读位置无法恢复');
    }
    return summary;
  }
  async function restoreLibrary(user,backup){
    await validateRestore(user,backup);
    for(const {book,records:incoming}of backup.books){
      if(!publicBooks.has(book.bookId)){const privateBook={...book,visibility:'private'};await mutate(bookFile(user,book.bookId),{},data=>Object.assign(data,privateBook));await mutate(path.join(userDir(user),'index.json'),{books:[]},data=>{data.books=data.books.filter(b=>b.bookId!==book.bookId);data.books.push(brief(privateBook));});}
      const overlay={};for(const p of allPassages(book))if(Object.keys(p.translations).length)overlay[p.id]={contentVersion:book.contentVersion,translations:p.translations};
      await mutate(path.join(userDir(user),'translations',digest(book.bookId)+'.json'),{},data=>Object.assign(data,overlay));
      await mutate(recordFile(user,book.bookId),emptyRecords(book),data=>{for(const key of ['comments','questions','readingSessions']){const map=new Map(data[key].map(r=>[r.id,r]));for(const r of incoming[key])if(!map.has(r.id))map.set(r.id,r);data[key]=[...map.values()];}if(incoming.position)data.position={...incoming.position,contentVersion:book.contentVersion,revision:(data.position?.revision||0)+1,updatedAt:new Date().toISOString()};});
    }return {restored:backup.books.length};
  }
  return {list,getBook,importDocument,originalInfo,getOriginal,originalDownload,records,addComment,saveProgress,translate,createGrant,authorize,grants,revokeGrant,exportLibrary,validateRestore,restoreLibrary,translationAvailable:!!translator};
}
