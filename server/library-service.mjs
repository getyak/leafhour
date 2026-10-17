import {mkdir,readFile,writeFile,rename,stat} from 'node:fs/promises';
import path from 'node:path';
import {randomBytes,randomUUID} from 'node:crypto';
import {extractDocument,makeBook,digest,fail,MAX_FILE_BYTES} from './document-import.mjs';
import {normalizeAppearance} from '../app/reading-preferences.mjs';
import {applyCatalogChapters,alignReadingPosition} from './catalog-chapters.mjs';
import {resumeSummary} from '../app/reading-progress.mjs';
import {validateLibraryBackup} from '../app/library-backup.mjs';
import {saveHighlight,findHighlight,mergeHighlights} from '../app/highlights.mjs';
import {inferSourceLanguage} from '../app/source-language.mjs';
import {validParagraphAnchor} from '../app/paragraph-anchor.mjs';
import {applyCatalogReadingMetadata} from './catalog-reading-metadata.mjs';
import {structuredCatalogBook} from './structured-catalog.mjs';
import {applyCatalogSample} from './catalog-sample.mjs';
import {normalizeReadingSession,mergeReadingSession,normalizeReadingMilestone,normalizeReadingGoal,readingJourney,buildReadingCalendar} from './reading-activity.mjs';

const requireUser=user=>{if(!user?.id)throw fail('请先进入自己的书房',401);return user;};
const emptyRecords=book=>({kind:'marginalia-personal-records',schemaVersion:3,bookId:book.bookId,contentVersion:book.contentVersion,comments:[],questions:[],readingSessions:[],readingMilestones:[],position:null});
const readingDefaults=data=>Object.assign(data,{schemaVersion:3,readingMilestones:data.readingMilestones||[],readingSessions:data.readingSessions||[],highlights:data.highlights||[]});
function mergedPersonalRecords(book,current,incoming){
  const data=readingDefaults(structuredClone(current));
  data.highlights=mergeHighlights(data.highlights,incoming.highlights||[]);
  for(const key of ['comments','questions']){const map=new Map(data[key].map(r=>[r.id,r]));for(const row of incoming[key])if(!map.has(row.id))map.set(row.id,row);data[key]=[...map.values()];}
  const sessions=new Map(data.readingSessions.map(r=>[r.id,r]));
  for(const session of incoming.readingSessions){const old=sessions.get(session.id);if(session.source==='reader_focus')sessions.set(session.id,mergeReadingSession(old,normalizeReadingSession(session,book)));else if(old&&old.source!==session.source)throw fail('备份中的阅读时段标识冲突，未覆盖记录',409);else if(!old)sessions.set(session.id,session);}
  data.readingSessions=[...sessions.values()];
  const marks=new Map(data.readingMilestones.map(r=>[r.id,r]));
  for(const mark of incoming.readingMilestones||[]){const old=marks.get(mark.id);if(old&&(old.type!==mark.type||old.chapterId!==mark.chapterId||old.contentVersion!==mark.contentVersion))throw fail('备份中的阅读标记标识冲突，未覆盖记录',409);if(!old)marks.set(mark.id,normalizeReadingMilestone(mark,book));}
  data.readingMilestones=[...marks.values()];
  if(incoming.readingGoal&&(!data.readingGoal||Date.parse(incoming.readingGoal.updatedAt)>Date.parse(data.readingGoal.updatedAt)))data.readingGoal=normalizeReadingGoal(incoming.readingGoal);
  if(incoming.position)data.position={...incoming.position,contentVersion:book.contentVersion,revision:(data.position?.revision||0)+1,updatedAt:new Date().toISOString()};
  return data;
}
const allPassages=book=>book.sections.flatMap(s=>s.paragraphs.map(p=>({...p,chapterId:s.chapterId})));
const brief=book=>({bookId:book.bookId,contentVersion:book.contentVersion,title:book.title,author:book.author,visibility:book.visibility,sourceLanguage:book.sourceLanguage,topics:book.topics||[],source:book.source,cover:book.cover,description:book.description,chineseSample:book.chineseSample,paragraphs:allPassages(book).length,chapters:book.chapters.length,chapterIndex:book.chapters.map(c=>({id:c.id,kind:c.kind,number:c.number,title:c.title})),createdAt:book.createdAt});
const emptyShelf=()=>({revision:0,order:[],archived:{}});
const shelfLimit=1000;
const shelfId=id=>typeof id==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(id);
function validateShelfOrder(order){
  if(!Array.isArray(order)||order.length>shelfLimit||order.some(id=>!shelfId(id))||new Set(order).size!==order.length)throw fail('书架顺序不正确，请刷新后重新排列');
}
function validateShelfBackup(entry){
  const shelf=entry.shelf;if(shelf===undefined)return;
  if(!shelf||typeof shelf!=='object'||Array.isArray(shelf)||Object.keys(shelf).some(key=>!['order','archivedAt'].includes(key)))throw fail('备份中的书架信息不完整');
  if(shelf.order!==undefined)validateShelfOrder(shelf.order);
  if(shelf.archivedAt!==undefined&&(typeof shelf.archivedAt!=='string'||!Number.isFinite(Date.parse(shelf.archivedAt))))throw fail('备份中的移除时间不正确');
}

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
    for(const entry of entries){const bytes=await readFile(path.join(catalogDir,entry.file));if(entry.format==='structured'){publicBooks.set(entry.id,structuredCatalogBook(entry,bytes));continue;}const extracted=await extractDocument({filename:entry.file,bytes});
      // Keep the complete licensed original in the source file; remove only the Gutenberg wrapper from the reading view.
      const body=extracted.pages[0].text,match=body.match(/\*\*\* START OF THE PROJECT GUTENBERG EBOOK[^\n]*\*\*\*([\s\S]*?)\*\*\* END OF THE PROJECT GUTENBERG EBOOK/);
      if(match)extracted.pages[0].text=match[1].trim();
      const book=makeBook({bookId:entry.id,filename:entry.file,sourceHash:digest(bytes),extracted,title:entry.title,author:entry.author,visibility:'public',sourceUrl:entry.sourceUrl,license:'Project Gutenberg · Public domain in the USA; check your local law and the included Gutenberg license.'});
      book.title.en=entry.originalTitle;book.description=entry.description;book.cover=entry.cover;book.topics=entry.topics||[];book.sourceLanguage=entry.sourceLanguage||book.sourceLanguage;
      let prepared=applyCatalogChapters(book),sample;try{sample=JSON.parse(await readFile(path.join(catalogDir,'translations',entry.id+'.zh.json'),'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
      if(sample)prepared=applyCatalogSample(prepared,sample);publicBooks.set(book.bookId,prepared);
    }
    let metadata={};try{metadata=JSON.parse(await readFile(path.join(catalogDir,'reading-metadata.json'),'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
    for(const entry of entries){const book=publicBooks.get(entry.id);for(const key of ['scopeNote','scope','translation','originalLanguage','edition','credits'])if(entry[key]!==undefined)book.source[key]=entry[key];if(metadata[entry.id])applyCatalogReadingMetadata(book,metadata[entry.id]);}
    for(const id of Object.keys(metadata))if(!publicBooks.has(id))throw Error('Unknown catalog reading metadata: '+id);
  }
  const bookFile=(user,id)=>path.join(userDir(user),'books',digest(id)+'.json');
  const recordFile=(user,id)=>path.join(userDir(user),'records',digest(id)+'.json');
  async function getBook(user,id){
    if(typeof id!=='string'||id.length>128)throw fail('找不到这本书',404);
    let book=publicBooks.get(id);
    if(!book){if(!user)throw fail('找不到这本书',404);book=await read(bookFile(user,id),null);}
    if(!book)throw fail('找不到这本书',404);
    book=structuredClone(book);
    delete book._giftReceive;
    if(book.visibility==='private')book.sourceLanguage=inferSourceLanguage(book.sections.flatMap(s=>s.paragraphs).slice(0,10).map(p=>p.original).join('\n'));
    if(user){const overlay=await read(path.join(userDir(user),'translations',digest(id)+'.json'),{});for(const p of book.sections.flatMap(s=>s.paragraphs))if(overlay[p.id]?.contentVersion===book.contentVersion)p.translations=overlay[p.id].translations;}
    return book;
  }
  const shelfFile=user=>path.join(userDir(user),'shelf.json');
  async function allShelfRows(user){const index=user?await read(path.join(userDir(user),'index.json'),{books:[]}):{books:[]};return [...publicBooks.values()].map(brief).concat(index.books);}
  const activeOrder=(shelf,rows)=>{const visible=rows.filter(row=>!Object.hasOwn(shelf.archived,row.bookId)).map(row=>row.bookId),available=new Set(visible);return [...shelf.order.filter(id=>available.has(id)),...visible.filter(id=>!shelf.order.includes(id))];};
  function visibleShelf(shelf,rows){const available=new Set(rows.map(row=>row.bookId));return {revision:shelf.revision,order:shelf.order.length?activeOrder(shelf,rows):[],archived:Object.fromEntries(Object.entries(shelf.archived).filter(([id])=>available.has(id)))};}
  async function shelfState(user){if(!user)return emptyShelf();const [shelf,rows]=await Promise.all([read(shelfFile(user),emptyShelf()),allShelfRows(user)]);return visibleShelf(shelf,rows);}
  const requireShelfRevision=input=>{if(!Number.isSafeInteger(input?.baseRevision)||input.baseRevision<0)throw fail('请先读取当前书架版本，再保存调整');return input.baseRevision;};
  const checkShelfRevision=(shelf,revision)=>{if(shelf.revision!==revision)throw fail('书架已在另一处更新，请刷新后再试',409);if(shelf.revision>=Number.MAX_SAFE_INTEGER)throw fail('书架版本已超过可保存范围',409);};
  async function reorderShelf(user,input){
    requireUser(user);const revision=requireShelfRevision(input);validateShelfOrder(input?.bookIds);
    return mutate(shelfFile(user),emptyShelf(),async shelf=>{
      checkShelfRevision(shelf,revision);const rows=await allShelfRows(user),available=new Set(rows.map(row=>row.bookId)),active=activeOrder(shelf,rows);
      if(input.bookIds.some(id=>!available.has(id)||Object.hasOwn(shelf.archived,id)))throw fail('找不到要排列的书籍',404);
      if(input.bookIds.length!==active.length)throw fail('书架已有变化，请刷新后重新排列',409);
      // Keep archived slots so restoring a book returns it to its former place.
      const next=[...input.bookIds];shelf.order=shelf.order.filter(id=>available.has(id)).map(id=>Object.hasOwn(shelf.archived,id)?id:next.shift()).filter(Boolean).concat(next);
      if(shelf.order.length>shelfLimit)throw fail('书架最多支持排列 1000 本书，请先导出整理',413);
      shelf.revision++;return visibleShelf(shelf,rows);
    });
  }
  async function changeArchive(user,id,input,restore){
    requireUser(user);const revision=requireShelfRevision(input);await getBook(user,id);
    return mutate(shelfFile(user),emptyShelf(),async shelf=>{
      checkShelfRevision(shelf,revision);const rows=await allShelfRows(user);
      if(!rows.some(row=>row.bookId===id))throw fail('找不到这本书',404);
      const archived=Object.hasOwn(shelf.archived,id);
      if(restore){if(archived)delete shelf.archived[id];}
      else if(!archived){if(Object.keys(shelf.archived).length>=shelfLimit)throw fail('已移除的书较多，请先导出整理',413);shelf.archived={...shelf.archived,[id]:new Date().toISOString()};}
      if(archived===restore)shelf.revision++;
      return visibleShelf(shelf,rows);
    });
  }
  const archiveBook=(user,id,input)=>changeArchive(user,id,input,false);
  const restoreBook=(user,id,input)=>changeArchive(user,id,input,true);
  async function trash(user){if(!user)return [];const [shelf,rows]=await Promise.all([read(shelfFile(user),emptyShelf()),allShelfRows(user)]);return rows.filter(row=>Object.hasOwn(shelf.archived,row.bookId)).map(row=>({...row,archivedAt:shelf.archived[row.bookId]}));}
  async function list(user){
    const [all,shelf]=await Promise.all([allShelfRows(user),user?read(shelfFile(user),emptyShelf()):emptyShelf()]),order=shelf.order.length?activeOrder(shelf,all):null,positions=order&&new Map(order.map((id,index)=>[id,index])),rows=all.filter(row=>!Object.hasOwn(shelf.archived,row.bookId));
    if(positions)rows.sort((a,b)=>positions.get(a.bookId)-positions.get(b.bookId));
    return Promise.all(rows.map(async row=>{
      if(!user)return {...row,resume:null,journey:null};
      const data=await read(recordFile(user,row.bookId),{position:null});
      // Older indexes lack language metadata. Derive it without rewriting the account's files.
      const book=publicBooks.get(row.bookId)||(!data.position&&row.chapterIndex&&row.contentVersion&&row.sourceLanguage?{bookId:row.bookId,contentVersion:row.contentVersion,chapters:row.chapterIndex}:await read(bookFile(user,row.bookId),null));
      const sourceLanguage=row.sourceLanguage||book?.sourceLanguage||(book?.sections?inferSourceLanguage(book.sections.flatMap(s=>s.paragraphs).slice(0,10).map(p=>p.original).join('\n')):null);
      return {...row,sourceLanguage,topics:row.topics||book?.topics||[],...(positions?{shelfPosition:positions.get(row.bookId)}:{}),resume:book&&data.position?resumeSummary(book,data.position):null,journey:book?readingJourney(book,data):null};
    }));
  }
  async function importDocument(user,input){requireUser(user);return importExtracted(user,{...input,extracted:await extractDocument(input)});}
  async function importExtracted(user,input){
    requireUser(user);const extracted=input.extracted,hash=digest(input.bytes);let id='private-'+digest(user.id+hash).slice(0,24),existing=await read(bookFile(user,id),null);
    if(!existing){const index=await read(path.join(userDir(user),'index.json'),{books:[]});for(const row of index.books.filter(b=>b.source?.sha256===hash)){const candidate=await read(bookFile(user,row.bookId),null);if(candidate?.contentVersion===hash&&candidate.source?.sha256===hash){existing=candidate;id=candidate.bookId;break;}}}
    if(existing&&existing.source?.sha256!==hash)throw fail('已保存的原文版本与此文件不一致，未覆盖书籍或记录',409);
    const book=existing||makeBook({bookId:id,filename:input.filename,sourceHash:hash,extracted});
    if(dataStore&&!extracted.processor&&Buffer.byteLength(JSON.stringify(book))>3500000)throw fail('这本书提取后的文字过多，请按章节拆分后上传到云端；原文件尚未加入书房',413);
    const originals=path.join(userDir(user),'originals');
    if(dataStore)await dataStore.putBlob(path.join(originals,hash),input.bytes);
    else {await mkdir(originals,{recursive:true,mode:0o700});const temporary=path.join(originals,hash+'.'+randomUUID()+'.pending');await writeFile(temporary,input.bytes,{mode:0o600});await rename(temporary,path.join(originals,hash));}
    if(!existing)await mutate(bookFile(user,id),{},data=>Object.assign(data,book));
    await mutate(path.join(userDir(user),'index.json'),{books:[]},data=>{if(!data.books.some(b=>b.bookId===id))data.books.push(brief(book));});return getBook(user,id);
  }
  async function originalInfo(user,id){
    requireUser(user);const book=await getBook(user,id);if(book.visibility!=='private')throw fail('公版书请使用书籍出处查看底本',404);
    const hash=book.source?.sha256;if(typeof hash!=='string'||!/^[a-f0-9]{64}$/.test(hash)||hash!==book.contentVersion&&book.source?.processor!=='PaddleOCR-VL-1.6')throw fail('原文件信息不完整，请保留提取原文并重新上传原文件',409);
    const filename=typeof book.source.filename==='string'?book.source.filename:'original.'+book.source.format;
    try{const file=dataStore?await dataStore.blobInfo(path.join(userDir(user),'originals',hash)):await stat(path.join(userDir(user),'originals',hash));if(!file)throw Object.assign(new Error('Missing original'),{code:'ENOENT'});if((file.isFile&&!file.isFile())||file.size>MAX_FILE_BYTES)throw fail('原文件不完整，请重新上传',409);return {available:true,filename,format:book.source.format,bytes:file.size,sha256:hash};}
    catch(error){if(error.code!=='ENOENT')throw error;return {available:false,filename,format:book.source.format,reason:'此书房没有原文件。JSON 备份只包含提取文字与记录；重新上传同一原文件即可补回。'};}
  }
  async function getOriginal(user,id){
    const info=await originalInfo(user,id);if(!info.available)throw fail(info.reason,404);const book=await getBook(user,id),bytes=await (dataStore?dataStore.blob(path.join(userDir(user),'originals',book.source.sha256)):readFile(path.join(userDir(user),'originals',book.source.sha256)));
    if(bytes.length>MAX_FILE_BYTES||digest(bytes)!==book.source.sha256)throw fail('原文件校验失败，未提供损坏的文件，请重新上传',409);
    return {...info,bytes};
  }
  async function originalParts(user,id){const original=await getOriginal(user,id),book=await getBook(user,id);if(!dataStore?.blobDownloads)throw fail('本机原件使用直接下载',404);return {...original,bytes:original.bytes.length,parts:await dataStore.blobDownloads(path.join(userDir(user),'originals',book.source.sha256))};}
  async function originalDownload(user,id){
    const file=await getOriginal(user,id),book=await getBook(user,id);if(file.bytes.length>8*1024*1024)throw fail('大原件请在阅读页使用“下载原文件校对”，分块校验后下载',413);
    return {...file,bytes:undefined,url:await dataStore.signedBlob(path.join(userDir(user),'originals',book.source.sha256))};
  }
  async function recordsForBook(user,book){if(!user)return emptyRecords(book);const data=readingDefaults(await read(recordFile(user,book.bookId),emptyRecords(book)));data.position=alignReadingPosition(book,data.position);return data;}
  async function records(user,id){return recordsForBook(user,await getBook(user,id));}
  const guardRecordSize=data=>{if(dataStore&&Buffer.byteLength(JSON.stringify(data))>3500000)throw fail('阅读记录已超过云端单书容量，请保留导出备份并在本机继续',413);};
  async function saveReadingSession(user,id,input){
    requireUser(user);const book=await getBook(user,id),next=normalizeReadingSession(input,book);
    return mutate(recordFile(user,id),emptyRecords(book),raw=>{const data=readingDefaults(raw),index=data.readingSessions.findIndex(s=>s.id===next.id),previous=index>=0?data.readingSessions[index]:null;if(!previous&&data.readingSessions.length>=10000)throw fail('阅读时段较多，请保留导出备份',413);const merged=mergeReadingSession(previous,next),saved=merged===previous?previous:{...merged,recordedAt:new Date().toISOString()};if(index>=0)data.readingSessions[index]=saved;else data.readingSessions.push(saved);guardRecordSize(data);return saved;});
  }
  async function recordReadingMilestone(user,id,input){
    requireUser(user);const book=await getBook(user,id),mark=normalizeReadingMilestone(input,book);
    return mutate(recordFile(user,id),emptyRecords(book),raw=>{const data=readingDefaults(raw),old=data.readingMilestones.find(r=>r.id===mark.id);if(old){if(old.type!==mark.type||old.chapterId!==mark.chapterId||old.contentVersion!==mark.contentVersion)throw fail('阅读标记标识冲突，原标记已保留',409);return old;}if(data.readingMilestones.length>=10000)throw fail('阅读标记较多，请保留导出备份',413);data.readingMilestones.push(mark);guardRecordSize(data);return mark;});
  }
  async function setReadingGoal(user,id,input){
    requireUser(user);const book=await getBook(user,id),goal=normalizeReadingGoal({minutes:input?.minutes});return mutate(recordFile(user,id),emptyRecords(book),raw=>{const data=readingDefaults(raw);data.readingGoal=goal;guardRecordSize(data);return goal;});
  }
  async function readingActivity(user,query){
    requireUser(user);buildReadingCalendar([],query);const index=await read(path.join(userDir(user),'index.json'),{books:[]}),ids=[...new Set([...publicBooks.keys(),...index.books.map(b=>b.bookId)])];
    const entries=await Promise.all(ids.map(async id=>{const book=publicBooks.get(id)||await read(bookFile(user,id),null);if(!book)return null;return {book,records:await read(recordFile(user,id),emptyRecords(book))};}));return buildReadingCalendar(entries.filter(Boolean),query);
  }
  async function addHighlight(user,id,input){
    requireUser(user);const book=await getBook(user,id);
    return mutate(recordFile(user,id),emptyRecords(book),raw=>{
      const data=readingDefaults(raw),saved=saveHighlight(data.highlights,input,book);guardRecordSize(data);return saved;
    });
  }
  async function removeHighlight(user,id,highlightId){
    requireUser(user);const book=await getBook(user,id);
    return mutate(recordFile(user,id),emptyRecords(book),raw=>{const data=readingDefaults(raw),row=findHighlight(data.highlights,highlightId);if(!row)throw fail('找不到这条高亮',404);row.deletedAt??=new Date().toISOString();guardRecordSize(data);return row;});
  }
  async function addComment(user,id,input,type='comments'){
    requireUser(user);const book=await getBook(user,id);
    if(!['comments','questions'].includes(type)||typeof input?.id!=='string'||!input.id||input.id.length>128||typeof input.text!=='string'||!input.text.trim()||input.text.length>2000||!allPassages(book).some(p=>p.id===input.passageId)||input.origin&&input.origin!=='user'||input.contentVersion&&input.contentVersion!==book.contentVersion)throw fail('记录无法对应当前原文');
    const record={id:input.id,bookId:id,contentVersion:book.contentVersion,passageId:input.passageId,text:input.text,origin:'user',createdAt:new Date().toISOString(),...(type==='questions'?{status:'open'}:{})};
    if(typeof input.quote==='string'&&input.quote.length<=4000){record.quote=input.quote;record.quoteLanguage=input.quoteLanguage==='en'?'en':'zh';if(['original','translation'].includes(input.quoteOrigin))record.quoteOrigin=input.quoteOrigin;}
    return mutate(recordFile(user,id),emptyRecords(book),data=>{const old=data[type].find(r=>r.id===record.id);if(old){if(old.passageId!==record.passageId||old.text!==record.text)throw fail('记录标识冲突',409);return old;}if(data[type].length>=10000)throw fail('请先导出记录',413);data[type].push(record);guardRecordSize(data);return record;});
  }
  async function saveProgress(user,id,input){
    requireUser(user);const book=await getBook(user,id),passage=allPassages(book).find(p=>p.id===input.passageId);
    if(!passage||passage.chapterId!==input.chapterId||!validParagraphAnchor(input)||!['zh','en','parallel'].includes(input.mode)||!['literal','interpretive'].includes(input.variant))throw fail('阅读位置无法对应原文');
    let appearance;try{appearance=normalizeAppearance(input,true);}catch{throw fail('阅读设置不正确');}
    if(input.baseRevision!==undefined&&(!Number.isInteger(input.baseRevision)||input.baseRevision<0))throw fail('阅读位置版本不正确');
    const position={chapterId:input.chapterId,passageId:input.passageId,contentVersion:book.contentVersion,offset:input.offset,...(input.withinParagraph!==undefined?{withinParagraph:input.withinParagraph}:{}),mode:input.mode,variant:input.variant,...appearance};
    return mutate(recordFile(user,id),emptyRecords(book),data=>{const revision=data.position?.revision||0;if(input.baseRevision!==undefined&&input.baseRevision!==revision)throw fail('阅读位置已在另一处更新，请选择从哪里继续',409);data.position={...position,revision:revision+1,updatedAt:new Date().toISOString()};guardRecordSize(data);return data.position;});
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
      await mutate(path.join(userDir(user),'translations',digest(id)+'.json'),{},data=>{
        const next={...data,[passageId]:{contentVersion:book.contentVersion,translations}};
        if(dataStore){const projected={...book,sections:book.sections.map(s=>({...s,paragraphs:s.paragraphs.map(p=>next[p.id]?.contentVersion===book.contentVersion?{...p,translations:next[p.id].translations}:p)}))};if(Buffer.byteLength(JSON.stringify(projected))>3500000)throw fail('这本书的文字量已接近云端容量，请先导出备份并在本机继续。本次新译文未保存，已有原文与译文仍保留。',413);}
        data[passageId]=next[passageId];
      });return {...passages[i],translations};
    }finally{translationsRunning.delete(key);if(ticket)await dataStore.releaseTranslation(ticket).catch(()=>{});}
  }
  const grantsFile=path.join(dataDir,'grants.json');
  async function createGrant(user,{bookId,scopes}){
    requireUser(user);await getBook(user,bookId);if(!Array.isArray(scopes)||!scopes.length||scopes.some(s=>!['content','notes','activity','comment:write','audio:read','audio:generate'].includes(s)))throw fail('请选择授权范围');
    const token=randomBytes(32).toString('base64url'),grant={id:randomUUID(),ownerId:user.id,bookId,scopes:[...new Set(scopes)],tokenHash:digest(token),createdAt:new Date().toISOString(),expiresAt:new Date(Date.now()+7*86400000).toISOString(),revoked:false};
    await mutate(grantsFile,{grants:[]},data=>{if(data.grants.filter(g=>g.ownerId===user.id&&!g.revoked).length>=50)throw fail('请先撤回不再使用的授权',413);data.grants.push(grant);});
    const {tokenHash,ownerId,...visible}=grant;return {...visible,token};
  }
  async function authorize(token,id,scope){const data=await read(grantsFile,{grants:[]}),grant=typeof token==='string'&&data.grants.find(g=>g.tokenHash===digest(token));if(!grant||grant.revoked||Date.parse(grant.expiresAt)<=Date.now()||grant.bookId!==id||!grant.scopes.includes(scope))throw fail('Agent 授权无效或范围不足',403);return {id:grant.ownerId};}
  async function grants(user){requireUser(user);return (await read(grantsFile,{grants:[]})).grants.filter(g=>g.ownerId===user.id).map(({ownerId,tokenHash,...g})=>g);}
  async function revokeGrant(user,id){requireUser(user);return mutate(grantsFile,{grants:[]},data=>{const grant=data.grants.find(g=>g.id===id&&g.ownerId===user.id);if(!grant)throw fail('找不到这条授权',404);grant.revoked=true;return {revoked:true};});}
  async function shelfBackup(user,id){
    const shelf=await read(shelfFile(user),emptyShelf());if(!shelf.order.length&&!Object.hasOwn(shelf.archived,id))return {};
    const available=new Set((await allShelfRows(user)).map(row=>row.bookId));
    return {shelf:{...(shelf.order.length?{order:shelf.order.filter(key=>available.has(key))}:{}),...(Object.hasOwn(shelf.archived,id)?{archivedAt:shelf.archived[id]}:{})}};
  }
  async function exportLibrary(user){requireUser(user);const books=[];for(const row of await allShelfRows(user)){const book=await getBook(user,row.bookId);books.push({book,records:await records(user,row.bookId),...await shelfBackup(user,row.bookId)});}return {kind:'marginalia-library',schemaVersion:1,exportedAt:new Date().toISOString(),books,includesOriginalFiles:false};}
  async function exportManifest(user){
    requireUser(user);const rows=await allShelfRows(user);if(rows.length>100)throw fail('单份备份最多容纳100本书，请在本机按书整理后导出。',413);
    return {kind:'marginalia-export-manifest',schemaVersion:1,exportedAt:new Date().toISOString(),books:rows.map(({bookId,contentVersion})=>({bookId,contentVersion}))};
  }
  async function exportBookPart(user,id,{offset=0,snapshot=null}={}){
    requireUser(user);
    if(!Number.isSafeInteger(offset)||offset<0||offset>512*1024*1024||snapshot!==null&&(typeof snapshot!=='string'||!/^[a-f0-9]{64}$/.test(snapshot))||offset>0&&!snapshot)throw fail('备份分段范围不正确。');
    const book=await getBook(user,id),personal=await recordsForBook(user,book);
    // Bundled editions are rebuilt on each instance; its start time is not source metadata.
    if(book.visibility==='public')delete book.createdAt;
    const bytes=Buffer.from(JSON.stringify({book,records:personal,...await shelfBackup(user,id)})),hash=digest(bytes);
    if(bytes.length>512*1024*1024)throw fail('这本书的备份过大，请在本机导出。',413);
    if(snapshot&&snapshot!==hash)throw fail('这本书刚刚有新记录，请重试导出。',409);
    if(offset>=bytes.length)throw fail('备份分段范围不正确。');
    const next=Math.min(bytes.length,offset+1048576);
    return {kind:'marginalia-book-export-part',schemaVersion:1,bookId:book.bookId,contentVersion:book.contentVersion,offset,totalBytes:bytes.length,nextOffset:next<bytes.length?next:null,snapshot:hash,data:bytes.subarray(offset,next).toString('base64')};
  }
  async function validateRestore(user,backup){
    requireUser(user);const summary=validateLibraryBackup(backup);
    for(const entry of backup.books)validateShelfBackup(entry);
    const shelf=await read(shelfFile(user),emptyShelf()),incomingOrders=backup.books.flatMap(entry=>entry.shelf?.order||[]),incomingArchived=backup.books.filter(entry=>entry.shelf?.archivedAt).map(entry=>entry.book.bookId);
    if(new Set([...shelf.order,...incomingOrders]).size>shelfLimit||new Set([...Object.keys(shelf.archived),...incomingArchived]).size>shelfLimit)throw fail('备份中的书架超过 1000 本，请在本机整理后恢复',413);
    // Validate the entire package before changing any persisted data.
    for(const entry of backup.books){const b=entry?.book,r=entry?.records;if(!b||typeof b.bookId!=='string'||!b.bookId||b.bookId.length>128||typeof b.contentVersion!=='string'||!Array.isArray(b.chapters)||!b.chapters.length||!Array.isArray(b.sections)||b.sections.some(s=>!Array.isArray(s?.paragraphs))||!Array.isArray(b.annotations)||!Array.isArray(b.glossary)||!b.title||typeof b.title.zh!=='string'||!b.source||typeof b.source.format!=='string')throw fail('书籍格式不完整');
      if(dataStore&&Buffer.byteLength(JSON.stringify(b))>3500000)throw fail('这本备份的文字量超过云端限制，请在本机恢复',413);
      const existing=publicBooks.get(b.bookId)||await read(bookFile(user,b.bookId),null);if(existing&&(existing.contentVersion!==b.contentVersion||JSON.stringify(allPassages(existing).map(p=>[p.id,p.original]))!==JSON.stringify(allPassages(b).map(p=>[p.id,p.original]))))throw fail('备份的原文版本与书房已有内容冲突，未覆盖原书或记录',409);
      const passages=allPassages(b),ids=new Set(passages.map(p=>p.id));if(!passages.length||ids.size!==passages.length||passages.some(p=>typeof p.id!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(p.id)||typeof p.original!=='string'||!p.translations||Array.isArray(p.translations)||!b.chapters.some(c=>c.id===p.chapterId)))throw fail('原文锚点不完整');
      if(!r||r.bookId!==b.bookId||!Array.isArray(r.comments)||!Array.isArray(r.questions)||!Array.isArray(r.readingSessions)||[...r.comments,...r.questions].some(n=>!ids.has(n.passageId)||n.origin!=='user'||typeof n.text!=='string'||n.text.length>2000))throw fail('个人记录无法对应原文');
      if(r.position&&!passages.some(p=>p.id===r.position.passageId&&p.chapterId===r.position.chapterId))throw fail('阅读位置无法恢复');
      const saved=existing?await read(recordFile(user,b.bookId),emptyRecords(b)):emptyRecords(b);guardRecordSize(mergedPersonalRecords(b,saved,r));
    }
    return summary;
  }
  async function restoreLibrary(user,backup){
    await validateRestore(user,backup);
    for(const {book,records:incoming}of backup.books){
      if(!publicBooks.has(book.bookId)){const privateBook={...book,visibility:'private'};await mutate(bookFile(user,book.bookId),{},data=>Object.assign(data,privateBook));await mutate(path.join(userDir(user),'index.json'),{books:[]},data=>{data.books=data.books.filter(b=>b.bookId!==book.bookId);data.books.push(brief(privateBook));});}
      const overlay={};for(const p of allPassages(book))if(Object.keys(p.translations).length)overlay[p.id]={contentVersion:book.contentVersion,translations:p.translations};
      await mutate(path.join(userDir(user),'translations',digest(book.bookId)+'.json'),{},data=>Object.assign(data,overlay));
      await mutate(recordFile(user,book.bookId),emptyRecords(book),raw=>{const data=mergedPersonalRecords(book,raw,incoming);guardRecordSize(data);Object.assign(raw,data);});
    }
    if(backup.books.some(entry=>entry.shelf))await mutate(shelfFile(user),emptyShelf(),shelf=>{
      const order=[...new Set([...shelf.order,...backup.books.flatMap(entry=>entry.shelf?.order||[])])],archived={...shelf.archived};
      for(const entry of backup.books)if(entry.shelf?.archivedAt&&!Object.hasOwn(archived,entry.book.bookId))Object.defineProperty(archived,entry.book.bookId,{value:entry.shelf.archivedAt,enumerable:true,writable:true,configurable:true});
      if(order.length>shelfLimit||Object.keys(archived).length>shelfLimit)throw fail('书架正在另一处更新，请刷新后重新恢复',409);
      if(JSON.stringify(order)!==JSON.stringify(shelf.order)||JSON.stringify(archived)!==JSON.stringify(shelf.archived)){checkShelfRevision(shelf,shelf.revision);shelf.order=order;shelf.archived=archived;shelf.revision++;}
    });
    return {restored:backup.books.length};
  }
  async function receiveGift(user,backup){
    requireUser(user);validateLibraryBackup(backup);
    if(backup.books.length!==1||Buffer.byteLength(JSON.stringify(backup))>MAX_FILE_BYTES)throw fail('请选择一份 20 MB 以内的单书阅读包',413);
    const entry=backup.books[0],incoming=entry.book,personal=entry.records;
    if(entry.shelf!==undefined||entry.localReadingDrafts!==undefined||['comments','questions','readingSessions','readingMilestones','highlights'].some(key=>personal[key]?.length)||personal.position||personal.readingGoal)throw fail('赠书阅读包不能包含个人记录');
    const unreadable=()=>fail('这份阅读包的原文与译文合计超过云端阅读容量，请下载后在本机接收',413);
    if(dataStore&&Buffer.byteLength(JSON.stringify(incoming))>3500000)throw unreadable();
    const original=structuredClone(incoming),overlay={},fingerprint=digest(JSON.stringify(incoming));original.visibility='private';delete original._giftReceive;
    for(const paragraph of allPassages(original))if(Object.keys(paragraph.translations).length)overlay[paragraph.id]={contentVersion:original.contentVersion,translations:paragraph.translations};
    for(const section of original.sections)for(const paragraph of section.paragraphs)paragraph.translations={};
    const pendingOriginal={...original,_giftReceive:{fingerprint}};
    if(dataStore&&[pendingOriginal,overlay].some(document=>Buffer.byteLength(JSON.stringify(document))>3500000))throw fail('阅读包的原文或译文超过云端单份容量，请在本机接收',413);
    const guardOverlay=(source,next)=>{
      if(!dataStore)return;
      if(Buffer.byteLength(JSON.stringify(next))>3500000)throw fail('译文已超过云端单份容量，已有记录已保留',413);
      const projected=structuredClone(source);
      for(const section of projected.sections)for(const paragraph of section.paragraphs)if(next[paragraph.id]?.contentVersion===source.contentVersion)paragraph.translations=next[paragraph.id].translations;
      if(Buffer.byteLength(JSON.stringify(projected))>3500000)throw unreadable();
    };
    const sameOriginal=book=>book.contentVersion===incoming.contentVersion&&JSON.stringify(allPassages(book).map(p=>[p.id,p.original]))===JSON.stringify(allPassages(incoming).map(p=>[p.id,p.original]));
    if(publicBooks.has(incoming.bookId)){
      const catalog=publicBooks.get(incoming.bookId);if(!sameOriginal(catalog))throw fail('书架已有同标识的另一版本，原书和记录已保留',409);
      if(Object.keys(overlay).length){
        const paragraphs=new Map(allPassages(catalog).map(paragraph=>[paragraph.id,paragraph]));
        await mutate(path.join(userDir(user),'translations',digest(incoming.bookId)+'.json'),{},current=>{
          for(const [id,translation]of Object.entries(overlay)){
            const saved=current[id];if(saved&&saved.contentVersion!==catalog.contentVersion)throw fail('译文来源版本已变化，已有译文已保留',409);
            const existing=saved?.translations||paragraphs.get(id)?.translations||{},missing=Object.fromEntries(Object.entries(translation.translations).filter(([variant])=>!Object.hasOwn(existing,variant)));
            if(Object.keys(missing).length)current[id]={...saved,contentVersion:catalog.contentVersion,translations:{...missing,...existing}};
          }
          guardOverlay(catalog,current);
        });
      }
      return {bookId:incoming.bookId,alreadyOwned:true};
    }
    // Claim the original with CAS. A concurrent import wins intact; accepting a
    // letter must never replace that copy, its translations or personal records.
    const claim=await mutate(bookFile(user,incoming.bookId),{},current=>{
      if(Object.keys(current).length){
        if(!sameOriginal(current))throw fail('书架已有同标识的另一版本，原书和记录已保留',409);
        if(current._giftReceive&&current._giftReceive.fingerprint!==fingerprint)throw fail('另一封赠书尚未收好，请先重试原来的赠书链接',409);
        return {created:false,pending:!!current._giftReceive};
      }
      Object.assign(current,pendingOriginal);return {created:true,pending:true};
    });
    if(claim.pending&&Object.keys(overlay).length)await mutate(path.join(userDir(user),'translations',digest(incoming.bookId)+'.json'),{},current=>{
      for(const [id,translation]of Object.entries(overlay)){
        if(current[id]&&current[id].contentVersion!==original.contentVersion)throw fail('译文来源版本已变化，已有译文已保留',409);
        current[id]={...translation,translations:{...translation.translations,...current[id]?.translations}};
      }
      guardOverlay(original,current);
    });
    await mutate(path.join(userDir(user),'index.json'),{books:[]},current=>{if(!current.books.some(row=>row.bookId===incoming.bookId))current.books.push(brief(original));});
    if(claim.pending)await mutate(bookFile(user,incoming.bookId),{},current=>{if(current._giftReceive?.fingerprint===fingerprint)delete current._giftReceive;});
    return {bookId:incoming.bookId,alreadyOwned:!claim.created};
  }
  return {list,shelfState,reorderShelf,archiveBook,restoreBook,trash,getBook,importDocument,importExtracted,originalInfo,getOriginal,originalDownload,originalParts,records,addComment,addHighlight,removeHighlight,saveProgress,saveReadingSession,recordReadingMilestone,setReadingGoal,readingActivity,translate,createGrant,authorize,grants,revokeGrant,exportLibrary,exportManifest,exportBookPart,validateRestore,restoreLibrary,receiveGift,translationAvailable:!!translator};
}
