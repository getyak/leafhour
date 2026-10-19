import {zipSync,unzipSync,Unzip,UnzipInflate,strToU8} from './fflate.mjs';
import {validateLibraryBackup} from './library-backup.mjs';
import {portableChatTurns} from './portable-chat.mjs';

export const MAX_ARCHIVE_BYTES=512*1024*1024,PART_BYTES=1048576;
const fail=(m,status=400)=>{throw Object.assign(Error(m),{status});};
export const portableHash=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
const privateKeys=new Set(['token','accesstoken','refreshtoken','apikey','secret','password','credentials','authorization','cookie','sessiontoken','tokenhash','runid','lease','authoritykey','ownerid','userid','mcpgrants','grants','agentgrants','privatekey','secretkey','clientsecret','mcpconfig','auth','sessionid','expiresat','requestbudgets','giftreceive']);
const privateField=key=>privateKeys.has(key.toLowerCase().replaceAll(/[-_]/g,''));
// Outbound reading archives may retain old runtime metadata. Copy content while
// omitting authority; inbound packages still pass the strict rejection below.
export function portableExportContent(value,depth=0){
 if(depth>48)fail('备份内容嵌套过深');
 if(!value||typeof value!=='object')return value;
 if(Array.isArray(value))return value.map(child=>portableExportContent(child,depth+1));
 return Object.fromEntries(Object.entries(value).filter(([key])=>!privateField(key)).map(([key,child])=>[key,portableExportContent(child,depth+1)]));
}
const credentialParameter=name=>{const key=name.toLowerCase().replace(/[^a-z0-9]/g,'');return ['key','sig','auth','code','pass','pwd'].includes(key)||/token|secret|signature|credential|password|passwd|passphrase|authorization|apikey|accesskey/.test(key);};
export function assertPortableContent(value,depth=0){
 if(depth>48)fail('备份内容嵌套过深');
 if(!value||typeof value!=='object')return;
 for(const [key,child]of Object.entries(value)){
  if(privateField(key))fail('内容包不能包含凭据或访问令牌');
  if(/(?:url|uri|href)$/i.test(key)&&typeof child==='string'){let url;try{url=new URL(child,'https://relative.invalid');}catch{fail('备份来源链接无效');}const fragment=url.hash.includes('=')?new URLSearchParams(url.hash.slice(1)):new URLSearchParams();if(url.username||url.password||[...url.searchParams.keys(),...fragment.keys()].some(credentialParameter))fail('内容包不能包含带凭据的来源链接');}
  assertPortableContent(child,depth+1);
 }
}
function validateBackup(backup){
 assertPortableContent(backup);validateLibraryBackup(backup);for(const entry of backup.books)if(entry.chat)portableChatTurns(entry.chat,entry.book,backup.books.map(e=>e.book));
}
export async function createLibraryArchive(backup,{originals=[]}={}){
 validateBackup(backup);const files=Object.create(null),inventory=[],seen=new Set();let total=0;
 async function add(name,bytes){total+=bytes.length;if(total>MAX_ARCHIVE_BYTES)fail('备份超过 512 MiB，请分批在本机整理后备份',413);files[name]=bytes;inventory.push({path:name,bytes:bytes.length,sha256:await portableHash(bytes)});}
 for(const [i,entry]of backup.books.entries())await add('books/'+String(i).padStart(3,'0')+'.json',strToU8(JSON.stringify(entry)));
 for(const original of originals){const entry=backup.books.find(e=>e.book.bookId===original.bookId);if(!entry||seen.has(original.bookId)||!(original.bytes instanceof Uint8Array)||original.bytes.length>256*1024*1024||await portableHash(original.bytes)!==entry.book.source.sha256)fail('原文件校验失败');seen.add(original.bookId);await add('originals/'+String(backup.books.indexOf(entry)).padStart(3,'0')+'.bin',original.bytes);}
 const manifest={kind:'leafhour-reading-library',schemaVersion:1,exportedAt:backup.exportedAt||new Date().toISOString(),includesOriginalFiles:originals.length>0,books:backup.books.map((e,i)=>({bookId:e.book.bookId,contentVersion:e.book.contentVersion,path:'books/'+String(i).padStart(3,'0')+'.json',...(seen.has(e.book.bookId)?{original:'originals/'+String(i).padStart(3,'0')+'.bin'}:{})})),files:inventory,excludes:['credentials','agent-grants','runtime-jobs','unsynced-browser-drafts','listening-audio'],...(backup.readingPreferences!==undefined?{readingPreferences:structuredClone(backup.readingPreferences)}:{})};
 files['manifest.json']=strToU8(JSON.stringify(manifest,null,2));const zip=zipSync(files,{level:0});if(zip.length>MAX_ARCHIVE_BYTES)fail('备份超过 512 MiB',413);return zip;
}
export async function readLibraryArchive(bytes){
 if(!(bytes instanceof Uint8Array)||bytes.length>MAX_ARCHIVE_BYTES||bytes.length<22)fail('备份文件大小或格式不正确');
 let total=0;const names=new Set();let files;
 try{
  const inventory=new Map();unzipSync(bytes,{filter:file=>{if(!/^(manifest\.json|books\/\d{3}\.json|originals\/\d{3}\.bin)$/.test(file.name)||names.has(file.name))fail('备份路径重复或不在清单范围');names.add(file.name);total+=file.originalSize;if(names.size>201||!Number.isSafeInteger(file.originalSize)||file.originalSize<1||total>MAX_ARCHIVE_BYTES||![0,8].includes(file.compression))fail('备份解压容量或压缩方式超过限制');inventory.set(file.name,file.originalSize);return false;}});
  files=Object.create(null);const started=new Set(),unzip=new Unzip(file=>{const expected=inventory.get(file.name);if(!expected||started.has(file.name)||file.originalSize!==undefined&&file.originalSize!==expected)fail('备份目录与文件头不一致');started.add(file.name);let size=0;const chunks=[];file.ondata=(error,chunk,final)=>{if(error)throw error;size+=chunk.length;if(size>expected)fail('备份实际解压容量超过清单');chunks.push(chunk);if(final){if(size!==expected)fail('备份文件未完整解压');const out=new Uint8Array(size);let offset=0;for(const part of chunks){out.set(part,offset);offset+=part.length;}files[file.name]=out;}};file.start();});unzip.register(UnzipInflate);
  // Bounded compressed input also bounds each inflate callback. Claimed central
  // directory sizes never authorize an unbounded synchronous decompression.
  for(let offset=0;offset<bytes.length;offset+=16384)unzip.push(bytes.subarray(offset,offset+16384),offset+16384>=bytes.length);
  if(started.size!==names.size||Object.keys(files).length!==names.size)fail('备份文件未完整解压');
 }catch(error){fail('备份无法打开：'+error.message);}
 let manifest;try{manifest=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(files['manifest.json']));}catch{fail('备份缺少有效清单');}
 if(manifest?.kind!=='leafhour-reading-library'||manifest.schemaVersion!==1||!Array.isArray(manifest.books)||manifest.books.length>100||!Array.isArray(manifest.files)||manifest.files.length>200||manifest.files.length!==names.size-1||typeof manifest.includesOriginalFiles!=='boolean')fail('备份清单不完整');
 const listed=new Set();for(const row of manifest.files){const b=files[row?.path];if(!b||row.path==='manifest.json'||listed.has(row.path)||row.bytes!==b.length||await portableHash(b)!==row.sha256)fail('备份文件校验失败');listed.add(row.path);}
 const used=new Set(),books=[],originals=[];
 for(const row of manifest.books){if(!listed.has(row.path)||used.has(row.path)||!/^books\//.test(row.path))fail('备份书籍清单重复或缺失');used.add(row.path);let entry;try{entry=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(files[row.path]));}catch{fail('备份书籍 JSON 无效');}if(entry?.book?.bookId!==row.bookId||entry.book.contentVersion!==row.contentVersion)fail('备份来源版本与清单不符');books.push(entry);if(row.original!==undefined){const b=files[row.original];if(!b||!listed.has(row.original)||used.has(row.original)||!/^originals\//.test(row.original)||b.length>256*1024*1024||await portableHash(b)!==entry.book.source.sha256)fail('备份原文件校验失败');used.add(row.original);originals.push({bookId:row.bookId,bytes:b});}}
 if(used.size!==listed.size||manifest.includesOriginalFiles!==(originals.length>0))fail('备份清单包含未声明内容');
 const backup={kind:'marginalia-library',schemaVersion:1,books,includesOriginalFiles:manifest.includesOriginalFiles,...(manifest.exportedAt?{exportedAt:manifest.exportedAt}:{}),...(manifest.readingPreferences!==undefined?{readingPreferences:manifest.readingPreferences}:{})};validateBackup(backup);return {manifest,backup,originals};
}

export function personalExportItems(backup){
 validateBackup(backup);const items=[];
 for(const {book,records,chat}of backup.books){const anchor=passageId=>{const section=book.sections.find(s=>s.paragraphs.some(p=>p.id===passageId)),p=section?.paragraphs.find(p=>p.id===passageId);return {bookId:book.bookId,contentVersion:book.contentVersion,title:book.title.zh,...(p?{passageId,chapterId:section.chapterId,quote:p.original.slice(0,4000)}:{})};};
  for(const [key,category]of [['comments','comment'],['questions','question']])for(const row of records[key])items.push({key:JSON.stringify([book.bookId,category,row.id]),category,...anchor(row.passageId),...structuredClone(row)});
  for(const row of chat?.turns||[]){if(row.answer)items.push({key:JSON.stringify([book.bookId,'answer',row.id]),category:'answer',...anchor(row.passageId),id:row.id,text:row.answer.summary,origin:'ai',createdAt:row.createdAt,sourceRefs:structuredClone(row.answer.sourceRefs)});}
  for(const row of records.readingSessions)items.push({key:JSON.stringify([book.bookId,'time',row.id]),category:'time',...anchor(row.start?.passageId),...structuredClone(row)});
 }
 return items;
}
export function selectedRecordExport(items,{format='json',sharing=false,includeQuotes=false,labels=null}={}){
 if(!Array.isArray(items)||!items.length)fail('请先选择要导出的记录');if(sharing&&items.some(i=>i.category==='time'))fail('分享包不能包含阅读时间');
 const rows=items.map(i=>{const keys=['id','category','bookId','contentVersion','title','chapterId','passageId','text','origin','createdAt','updatedAt','revision',...(i.category==='time'?['source','startedAt','endedAt','durationSeconds','recordedAt','timeZone','segments','status','start','end']:[]),...(includeQuotes?['quote']:[])],row=Object.fromEntries(keys.filter(k=>i[k]!==undefined).map(k=>[k,structuredClone(i[k])]));if(i.sourceRefs)row.sourceRefs=i.sourceRefs.map(r=>Object.fromEntries(['bookId','contentVersion','chapterId','passageId','layer',...(includeQuotes?['quote']:[])].filter(k=>r[k]!==undefined).map(k=>[k,r[k]])));return row;});assertPortableContent(rows);
 if(format==='json')return JSON.stringify({kind:sharing?'leafhour-selected-share':'leafhour-selected-records',schemaVersion:1,items:rows},null,2)+'\n';
 if(format!=='markdown')fail('导出格式不正确');
 // Callers may format newly requested Markdown chrome. JSON and archive bytes,
 // stable categories, source identities and user/AI content never use labels.
 const text=(id,fallback)=>typeof labels?.[id]==='string'?labels[id]:fallback;
 return '# '+(sharing?text('share','选定分享'):text('personal','个人记录'))+'\n\n'+rows.map(i=>['## '+i.title, text('type','类型：')+i.category+' · '+text('origin','归属：')+(i.origin==='ai'?'AI':text('user','用户')),text('id','ID：')+i.id+' · '+text('version','来源版本：')+i.contentVersion,text('anchor','锚点：')+i.bookId+(i.passageId?' / '+i.chapterId+' / '+i.passageId:''),text('created','创建：')+(i.createdAt||i.startedAt||'')+(i.updatedAt?' · '+text('updated','修改：')+i.updatedAt:''),i.text||(text('timeSource','时间来源：')+i.source+' · '+i.startedAt+' → '+i.endedAt+' · '+i.durationSeconds+' '+text('seconds','秒（不能证明掌握）')),...(i.quote?[text('quote','原文引用：')+'\n'+i.quote]:[]),...(i.sourceRefs?.map(r=>text('aiQuote','AI 引用：')+r.bookId+' / '+r.passageId+' @ '+r.contentVersion+(r.quote?'\n'+r.quote:''))||[])].join('\n\n')).join('\n\n---\n\n')+'\n';
}
