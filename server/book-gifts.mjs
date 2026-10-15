import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import path from 'node:path';
import {randomBytes,randomUUID} from 'node:crypto';
import {digest,fail,MAX_FILE_BYTES} from './document-import.mjs';
import {validateLibraryBackup} from '../app/library-backup.mjs';

const TOKEN=/^[A-Za-z0-9_-]{43}$/;
const CHUNK_BYTES=700*1024;
const localQueues=new Map(),receivingQueues=new Map();
const missing=()=>fail('这封赠书信已收回，或链接不存在',404);
const requireUser=user=>{if(typeof user?.id!=='string'||!user.id)throw fail('请先进入自己的书房',401);return user;};
const object=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const primitives=(value,keys)=>Object.fromEntries(keys.filter(key=>['string','number','boolean'].includes(typeof value?.[key])||value?.[key]===null).map(key=>[key,value[key]]));
const title=value=>primitives(value,['zh','en']);
const readUrl=id=>'/read?book='+encodeURIComponent(id);
const emptyRecords=book=>({kind:'marginalia-personal-records',schemaVersion:3,bookId:book.bookId,contentVersion:book.contentVersion,comments:[],questions:[],readingSessions:[],readingMilestones:[],position:null});
const originals=book=>JSON.stringify(book.sections.flatMap(section=>section.paragraphs.map(p=>[p.id,p.original])));
function publicSourceUrl(raw){try{const value=new URL(raw);if(['https:','http:'].includes(value.protocol)&&!value.username&&!value.password)return value.origin+value.pathname;}catch{}return null;}

// An allowlist is intentional: a book may acquire new private fields later. Those
// fields must never become public simply because sharing clones the book object.
function snapshotBook(raw,includeTranslations){
  if(!object(raw)||!Array.isArray(raw.sections)||!Array.isArray(raw.chapters))throw fail('书籍内容不完整，未生成赠书信',409);
  const annotations=(raw.annotations||[]).filter(n=>object(n)&&['editorial','author','source'].includes(n.attribution)&&n.origin!=='user').map(n=>primitives(n,['id','title','text','attribution','type','origin','license']));
  const glossary=(raw.glossary||[]).filter(n=>object(n)&&n.origin!=='user'&&n.attribution!=='user').map(n=>primitives(n,['id','en','zh','definition','attribution','license']));
  const annotationIds=new Set(annotations.map(n=>n.id)),termIds=new Set(glossary.map(n=>n.id));
  const source=primitives(raw.source,['sha256','format','license','review','structure']);
  if(raw.visibility==='public'){const url=publicSourceUrl(raw.source?.url);if(url)source.url=url;}
  const book={...primitives(raw,['bookId','contentVersion','author','sourceLanguage','targetLanguage','createdAt','description']),title:title(raw.title),visibility:raw.visibility==='public'?'public':'private',source,
    chapters:raw.chapters.map(c=>({...primitives(c,['id','number','kind','startPassageId']),title:title(c.title)})),
    sections:raw.sections.map(s=>({...primitives(s,['number','chapterId','title']),paragraphs:s.paragraphs.map(p=>{
      const translations={};if(includeTranslations)for(const variant of ['literal','interpretive'])if(object(p.translations?.[variant]))translations[variant]=primitives(p.translations[variant],['text','status','variant','origin','model','translator','sourceVersion','createdAt','reviewedAt','license']);
      return {...primitives(p,['id','original','kind']),source:primitives(p.source,['pdfPage','printedPage','review']),translations,annotationIds:(p.annotationIds||[]).filter(id=>annotationIds.has(id)),termIds:(p.termIds||[]).filter(id=>termIds.has(id))};
    })})),annotations,glossary};
  // Cover values identify bundled bindings; external image URLs can disclose a
  // private upload location and are never needed to render this letter.
  if(typeof raw.cover==='string'&&/^[a-z0-9_-]{1,80}$/i.test(raw.cover))book.cover=raw.cover;
  if(object(raw.readingStart))book.readingStart=primitives(raw.readingStart,['chapterId','passageId']);
  if(includeTranslations&&object(raw.chineseSample))book.chineseSample=primitives(raw.chineseSample,['paragraphs','startPassageId','endPassageId','chapterId','status','origin','translator','license']);
  return book;
}
function optionsOf(input){
  if(!object(input))throw fail('请检查赠书留言');
  const {message='',recipient='',includeTranslations=true}=input;
  if(typeof message!=='string'||message.length>500||typeof recipient!=='string'||recipient.length>80||typeof includeTranslations!=='boolean'||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(message+recipient))throw fail('留言最多 500 字，收信人最多 80 字');
  return {message:message.trim(),recipient:recipient.trim(),includeTranslations};
}
function senderName(profile,user){
  const name=profile?.displayName||profile?.name;
  if(typeof name==='string'&&name.trim()&&name.length<=80&&!/[\u0000-\u001f@]/u.test(name))return name.trim();
  const local=typeof user.email==='string'?user.email.split('@')[0]:'';
  return local&&local.length<=80&&!/[\u0000-\u001f]/u.test(local)?local:'一位读者';
}

export function createBookGifts({library,dataDir,dataStore=null,getProfile=null}={}){
  if(!library?.getBook||typeof dataDir!=='string')throw Error('Gift service requires a library and data directory');
  const queues=localQueues,acceptQueues=receivingQueues;
  const bucket=token=>path.join(dataDir,'book-gifts',digest(token));
  const metadataFile=token=>path.join(bucket(token),'gift.json');
  const ownerIndex=user=>path.join(dataDir,'book-gift-senders',digest(requireUser(user).id)+'.json');
  const chunkFile=(token,index)=>path.join(bucket(token),'chunks',String(index).padStart(3,'0')+'.json');
  async function read(file,fallback){if(dataStore)return dataStore.read(file,fallback);try{return JSON.parse(await readFile(file,'utf8'));}catch(error){if(error.code==='ENOENT')return structuredClone(fallback);throw error;}}
  async function mutate(file,fallback,operation){
    if(dataStore)return dataStore.mutate(file,fallback,operation);
    const previous=queues.get(file)||Promise.resolve();
    const work=previous.catch(()=>{}).then(async()=>{const row=await read(file,fallback),result=await operation(row);await mkdir(path.dirname(file),{recursive:true,mode:0o700});const pending=file+'.'+randomUUID()+'.pending';await writeFile(pending,JSON.stringify(row),{mode:0o600});await rename(pending,file);return result;});
    queues.set(file,work);try{return await work;}finally{if(queues.get(file)===work)queues.delete(file);}
  }
  async function active(token){
    if(typeof token!=='string'||!TOKEN.test(token))throw missing();
    const row=await read(metadataFile(token),null);if(!row?.published||row.revokedAt)throw missing();return row;
  }
  function visible(row){
    const {token,title,author,description,cover,bookId,sender,message,recipient,createdAt,includeTranslations}=row;
    return {token,title,author,description,cover,bookId,sender,message,recipient,createdAt,includeTranslations,downloadUrl:'/api/book-gifts/'+token+'/download',...(row.publicBook?{readUrl:readUrl(bookId)}:{})};
  }
  async function create(user,bookId,input={}){
    requireUser(user);const options=optionsOf(input),book=snapshotBook(await library.getBook(user,bookId),options.includeTranslations),createdAt=new Date().toISOString();
    const backup={kind:'marginalia-library',schemaVersion:1,exportedAt:createdAt,books:[{book,records:emptyRecords(book)}],includesOriginalFiles:false};
    const bytes=Buffer.from(JSON.stringify(backup));if(bytes.length>MAX_FILE_BYTES)throw fail('阅读包超过 20 MB，请按章节分享',413);validateLibraryBackup(backup);
    const previousGifts=await read(ownerIndex(user),{gifts:[]});
    if(previousGifts.gifts.filter(gift=>!gift.revoked).length>=100)throw fail('已有 100 封仍可访问的赠书信，请先收回不用的链接',429);
    const profile=getProfile?await getProfile(user):null,token=randomBytes(32).toString('base64url'),chunks=Math.ceil(bytes.length/CHUNK_BYTES);
    // Every hosted document stays below one megabyte even after base64 encoding.
    // The public metadata is the commit marker and is written only when complete.
    for(let index=0;index<chunks;index++){
      const part=bytes.subarray(index*CHUNK_BYTES,Math.min(bytes.length,(index+1)*CHUNK_BYTES));
      await mutate(chunkFile(token,index),{},row=>{if(Object.keys(row).length)throw fail('赠书信保存冲突，请重试',409);Object.assign(row,{data:part.toString('base64'),sha256:digest(part)});});
    }
    const metadata={token,ownerId:user.id,published:true,revokedAt:null,bookId:book.bookId,title:book.title,author:book.author||'',description:typeof book.description==='string'?book.description.slice(0,2000):'',cover:book.cover||null,sender:senderName(profile,user),...options,createdAt,publicBook:book.visibility==='public',snapshot:{chunks,bytes:bytes.length,sha256:digest(bytes)}};
    const indexFile=ownerIndex(user);
    await mutate(indexFile,{gifts:[]},row=>{
      if(row.gifts.filter(gift=>!gift.revoked).length>=100)throw fail('已有 100 封仍可访问的赠书信，请先收回不用的链接',429);
      row.gifts=row.gifts.filter(gift=>!gift.revoked).concat(row.gifts.filter(gift=>gift.revoked).slice(-100),{token,bookId:book.bookId,createdAt,revoked:false});
    });
    try{await mutate(metadataFile(token),{},row=>{if(Object.keys(row).length)throw fail('赠书信保存冲突，请重试',409);Object.assign(row,metadata);});}
    catch(error){await mutate(indexFile,{gifts:[]},row=>{row.gifts=row.gifts.filter(gift=>gift.token!==token);}).catch(()=>{});throw error;}
    return {...visible(metadata),shareUrl:'/gift/'+token};
  }
  async function view(token){return visible(await active(token));}
  async function list(user,bookId){
    requireUser(user);if(bookId!==undefined)await library.getBook(user,bookId);
    const index=await read(ownerIndex(user),{gifts:[]}),rows=await Promise.all(index.gifts.filter(gift=>TOKEN.test(gift.token)&&(bookId===undefined||gift.bookId===bookId)).map(gift=>read(metadataFile(gift.token),null)));
    return rows.filter(row=>row?.published&&row.ownerId===user.id).map(row=>({...visible(row),shareUrl:'/gift/'+row.token,revoked:!!row.revokedAt})).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
  }
  function snapshotInfo(row){
    const info=row.snapshot;
    if(!Number.isInteger(info?.chunks)||info.chunks<1||info.chunks>Math.ceil(MAX_FILE_BYTES/CHUNK_BYTES)||!Number.isInteger(info.bytes)||info.bytes<1||info.bytes>MAX_FILE_BYTES||typeof info.sha256!=='string'||!/^[a-f0-9]{64}$/.test(info.sha256))throw fail('阅读包不完整，请联系赠书人重新分享',409);
    return info;
  }
  async function snapshotChunk(token,index){
    const part=await read(chunkFile(token,index),null);
    if(typeof part?.data!=='string'||part.data.length>Math.ceil(CHUNK_BYTES/3)*4||!/^[A-Za-z0-9+/]*={0,2}$/.test(part.data))throw fail('阅读包不完整，请联系赠书人重新分享',409);
    const bytes=Buffer.from(part.data,'base64');if(!bytes.length||bytes.length>CHUNK_BYTES||bytes.toString('base64')!==part.data||digest(bytes)!==part.sha256)throw fail('阅读包校验未通过，请联系赠书人重新分享',409);return bytes;
  }
  async function downloadPart(token,{offset=0,snapshot=null}={}){
    const row=await active(token),info=snapshotInfo(row);
    if(!Number.isInteger(offset)||offset<0||offset>=info.bytes)throw fail('阅读包分段位置无效');
    if((offset>0||snapshot!==null)&&snapshot!==info.sha256)throw fail('阅读包版本无法对应，请重新下载',409);
    const end=Math.min(info.bytes,offset+CHUNK_BYTES),first=Math.floor(offset/CHUNK_BYTES),last=Math.floor((end-1)/CHUNK_BYTES);
    const chunks=await Promise.all(Array.from({length:last-first+1},(_,index)=>snapshotChunk(token,first+index)));
    const bytes=Buffer.concat(chunks).subarray(offset-first*CHUNK_BYTES,end-first*CHUNK_BYTES);await active(token);
    return {kind:'marginalia-book-gift-part',schemaVersion:1,offset,totalBytes:info.bytes,nextOffset:end<info.bytes?end:null,snapshot:info.sha256,sha256:digest(bytes),data:bytes.toString('base64')};
  }
  async function download(token){
    const row=await active(token),info=snapshotInfo(row);
    const parts=await Promise.all(Array.from({length:info.chunks},(_,index)=>snapshotChunk(token,index)));
    await active(token);const bytes=Buffer.concat(parts);if(bytes.length!==info.bytes||digest(bytes)!==info.sha256)throw fail('阅读包校验未通过，请联系赠书人重新分享',409);
    let backup;try{backup=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw fail('阅读包无法读取，请联系赠书人重新分享',409);}validateLibraryBackup(backup);return backup;
  }
  async function restoreVisible(user,id){
    if(typeof library.restoreBook!=='function'||typeof library.shelfState!=='function')return;
    for(let attempt=0;attempt<3;attempt++){
      const shelf=await library.shelfState(user);if(!Object.hasOwn(shelf.archived||{},id))return;
      try{await library.restoreBook(user,id,{baseRevision:shelf.revision});return;}catch(error){if(error.status!==409||attempt===2)throw error;}
    }
  }
  async function existingCopy(user,book){
    let existing;try{existing=await library.getBook(user,book.bookId);}catch(error){if(error.status!==404)throw error;}
    if(existing){if(existing.contentVersion!==book.contentVersion||originals(existing)!==originals(book))throw fail('书架已有同标识的另一版本，原书和记录已保留',409);return existing;}
    if(typeof library.list==='function'&&book.source?.sha256){
      const rows=[...await library.list(user),...(typeof library.trash==='function'?await library.trash(user):[])];
      for(const row of rows)if(row.contentVersion===book.contentVersion&&row.source?.sha256===book.source.sha256){
        const candidate=await library.getBook(user,row.bookId);if(originals(candidate)===originals(book))return candidate;
      }
    }
    return null;
  }
  async function accept(user,token){
    requireUser(user);await active(token);
    // Serialize local duplicate clicks across different letters for the same user.
    // The existing library restore validates the original before its own CAS writes.
    const acceptKey=path.join(dataDir,'gift-accept',digest(user.id)),previous=acceptQueues.get(acceptKey)||Promise.resolve();
    const work=previous.catch(()=>{}).then(async()=>{
      const backup=await download(token),book=backup.books[0].book,existing=await existingCopy(user,book);
      await active(token);
      if(existing){
        // A matching pending receipt may need to finish an interrupted overlay
        // write. Fully owned copies are left untouched by receiveGift.
        if(existing.bookId===book.bookId&&typeof library.receiveGift==='function')await library.receiveGift(user,backup);
        await restoreVisible(user,existing.bookId);return {bookId:existing.bookId,alreadyOwned:true,readUrl:readUrl(existing.bookId)};
      }
      const receive=library.receiveGift||library.restoreLibrary;
      if(typeof receive!=='function')throw fail('书房暂时无法收书，请稍后重试',503);
      const received=await receive(user,backup),savedId=received?.bookId||book.bookId;await restoreVisible(user,savedId);
      return {bookId:savedId,alreadyOwned:received?.alreadyOwned===true,readUrl:readUrl(savedId)};
    });
    acceptQueues.set(acceptKey,work);try{return await work;}finally{if(acceptQueues.get(acceptKey)===work)acceptQueues.delete(acceptKey);}
  }
  async function revoke(user,token){
    requireUser(user);if(typeof token!=='string'||!TOKEN.test(token))throw missing();
    await mutate(metadataFile(token),{},row=>{if(!row.published||row.ownerId!==user.id)throw missing();row.revokedAt=row.revokedAt||new Date().toISOString();});
    await mutate(ownerIndex(user),{gifts:[]},row=>{const gift=row.gifts.find(gift=>gift.token===token);if(gift)gift.revoked=true;});
    return {revoked:true};
  }
  return {create,list,view,download,downloadPart,accept,revoke};
}
