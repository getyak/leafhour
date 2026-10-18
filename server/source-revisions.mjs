import {digest,fail,makeBook} from './document-import.mjs';
import {portableSourceNote} from '../app/source-revisions.mjs';
const paragraphs=book=>book.sections.flatMap(s=>s.paragraphs);
const text=(value,max)=>typeof value==='string'&&value.trim().length>0&&value.length<=max;
const ownKeys=(value,allowed)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).every(key=>allowed.includes(key));
const pageLabel=value=>value===null||typeof value==='string'&&value.length<=64&&!/[\u0000-\u001f]/u.test(value);

export function buildSourceRevision({book,input,userId,pdfPages=null,extracted=null,now=new Date().toISOString()}){
 if(!ownKeys(input,['baseContentVersion','operation','changes','chapterTitles'])||input.baseContentVersion!==book.contentVersion)throw fail('原文版本已变化，请重新打开后校对',409);
 if(!['correct','reextract'].includes(input.operation)||!Array.isArray(input.changes??[])||(input.changes?.length||0)>200)throw fail('校对操作或修改数量无效');
 if(input.operation==='reextract'&&(input.changes?.length||input.chapterTitles?.length))throw fail('重提取与人工修改须分别生成修订');
 const original=paragraphs(book),byId=new Map(original.map(p=>[p.id,p])),changes=[],seen=new Set();
 for(const change of input.changes||[]){
  if(!ownKeys(change,['passageId','before','replacement','reason','evidence','printedPage','pdfPage','visuallyChecked'])||seen.has(change.passageId)||!text(change.reason,1000))throw fail('请为每个修改保留唯一段落和校对原因');seen.add(change.passageId);
  const old=byId.get(change.passageId);if(!old||change.before!==old.original)throw fail('校对前原文与当前段落不一致，未覆盖',409);
  const replacement=change.replacement??[old.original];if(!Array.isArray(replacement)||replacement.length>20||replacement.some(v=>!text(v,100000)||!v.isWellFormed()))throw fail('每次可拆分为最多 20 个非空段落');
  if(change.printedPage!==undefined&&!pageLabel(change.printedPage)||change.visuallyChecked!==undefined&&typeof change.visuallyChecked!=='boolean')throw fail('印刷页码或复核状态不正确');
  const evidence=change.evidence;if(!ownKeys(evidence,['sha256','page','pages','href'])||evidence.sha256!==book.source.sha256)throw fail('校对证据与原件哈希不一致',409);
  const pdf=book.source.format==='pdf',epub=book.source.format==='epub',page=change.pdfPage??old.source?.pdfPage;
  if(pdf&&(!Number.isSafeInteger(page)||page<1||page>pdfPages||evidence.page!==page))throw fail('请选择实际原件范围内的 PDF 页作为图像证据');
  const evidencePages=evidence.pages??[page];if(pdf&&(!Array.isArray(evidencePages)||evidencePages.length>50||new Set(evidencePages).size!==evidencePages.length||evidencePages.some(n=>!Number.isSafeInteger(n)||n<1||n>pdfPages)))throw fail('PDF 图像证据页码不正确');
  if(pdf&&change.visuallyChecked&&[...new Set([page,...(old.source?.pdfPages||[]).filter(n=>n!==old.source?.pdfPage)])].some(n=>!evidencePages.includes(n)))throw fail('跨页段落需要核对全部来源页面');
  if(!pdf&&change.pdfPage!==undefined||!pdf&&evidence.page!==undefined)throw fail('此来源没有 PDF 页码');
  if(epub&&evidence.href!==old.source?.href||!pdf&&!epub&&evidence.href!==book.source.filename)throw fail('校对证据无法定位当前源文件');
  if(change.visuallyChecked&&!pdf&&!epub)throw fail('文本文件不能冒充图像视觉复核');
  changes.push({passageId:old.id,before:old.original,replacement,reason:change.reason,evidence:{sha256:evidence.sha256,...(pdf?{page:evidence.page,pages:[...evidencePages].sort((a,b)=>a-b)}:{href:evidence.href})},...(change.printedPage!==undefined?{printedPage:change.printedPage}:{}),...(pdf?{pdfPage:page}:{}),visuallyChecked:change.visuallyChecked===true});
 }
 let titles=input.chapterTitles||[];if(!Array.isArray(titles)||titles.length>200||new Set(titles.map(c=>c?.id)).size!==titles.length||titles.some(c=>!ownKeys(c,['id','title'])||!book.chapters.some(ch=>ch.id===c.id)||!text(c.title,500)))throw fail('章节标题无法对应原目录');
 titles=titles.map(c=>({id:c.id,title:c.title}));
 if(input.operation==='correct'&&!changes.length&&!titles.length)throw fail('请先选择需要校对的段落或章节');
 let revised=input.operation==='reextract'?makeBook({bookId:book.bookId,filename:book.source.filename,sourceHash:book.source.sha256,extracted}):structuredClone(book);
 const identity=digest(JSON.stringify({parentBookId:book.bookId,parentVersion:book.contentVersion,operation:input.operation,changes,titles,...(extracted?{extracted:revised.sections.map(s=>s.paragraphs.map(p=>[p.original,p.source]))}:{})})),revisionId='private-'+digest(userId+identity).slice(0,24);
 if(input.operation==='correct')for(const section of revised.sections){section.paragraphs=section.paragraphs.flatMap(p=>{
  const change=changes.find(c=>c.passageId===p.id);if(!change)return [p];
  return change.replacement.map((original,i)=>({...p,id:change.replacement.length===1?p.id:'rev-'+identity.slice(0,16)+'-'+digest(p.id+':'+i).slice(0,16),original,source:{...p.source,review:change.visuallyChecked?'visually_checked':'extracted_unreviewed',...(change.pdfPage?{pdfPage:change.pdfPage,pdfPages:[...new Set([change.pdfPage,...(p.source?.pdfPages||[]).filter(n=>n!==p.source?.pdfPage)])].sort((a,b)=>a-b)}:{}),...(change.printedPage!==undefined?{printedPage:change.printedPage}:{}),corrections:[...(p.source?.corrections||[]),{before:p.original,after:original,reason:change.reason,evidence:change.evidence,checkedAt:now,review:change.visuallyChecked?'visually_checked':'extracted_unreviewed'}]}}));
 });}
 revised.sections=revised.sections.filter(s=>s.paragraphs.length);revised.chapters=revised.chapters.filter(c=>revised.sections.some(s=>s.chapterId===c.id));if(!revised.sections.length)throw fail('不能移除整本书的全部原文');
 for(const update of titles)revised.chapters.find(c=>c.id===update.id).title={zh:update.title,en:''};
 const ps=paragraphs(revised);
 if(input.operation==='reextract'){const oldCounts=new Map(),newCounts=new Map();for(const p of original){const rows=oldCounts.get(p.original)||[];rows.push(p);oldCounts.set(p.original,rows);}for(const p of ps)newCounts.set(p.original,(newCounts.get(p.original)||0)+1);for(const [i,p]of ps.entries())p.id=oldCounts.get(p.original)?.length===1&&newCounts.get(p.original)===1?oldCounts.get(p.original)[0].id:'rev-'+identity.slice(0,16)+'-p'+i;}
 for(const p of ps){p.translations={};p.annotationIds=[];p.termIds=[];}revised.annotations=[];revised.glossary=[];
 revised.bookId=revisionId;revised.contentVersion=identity;revised.visibility='private';revised.title=structuredClone(book.title);revised.author=book.author;revised.createdAt=now;
 revised.source={...revised.source,filename:book.source.filename,sha256:book.source.sha256,processor:'source-review-v1',review:ps.every(p=>p.source?.review==='visually_checked')?'visually_checked':'extracted_unreviewed',revision:{kind:'leafhour-source-revision',schemaVersion:1,parentBookId:book.bookId,parentContentVersion:book.contentVersion,operation:input.operation,changes,chapterTitles:titles,createdAt:now}};
 delete revised.introduction;delete revised.legacyReadingResources;delete revised.readingStart;for(const chapter of revised.chapters)delete chapter.startPassageId;
 // Only unique exact text on BOTH sides is evidence for automatic migration.
 const counts=rows=>{const map=new Map();for(const p of rows){const entries=map.get(p.original)||[];entries.push(p);map.set(p.original,entries);}return map;},oldByText=counts(original),newByText=counts(ps),anchorMap=new Map();
 for(const p of original)if(oldByText.get(p.original).length===1&&newByText.get(p.original)?.length===1)anchorMap.set(p.id,newByText.get(p.original)[0].id);
 return {book:revised,anchorMap,identity};
}

export function migrateSourceNotes(before,after,records,anchorMap){
 const result={kind:'marginalia-personal-records',schemaVersion:3,bookId:after.bookId,contentVersion:after.contentVersion,comments:[],questions:[],readingSessions:[],readingMilestones:[],highlights:[],position:null,pendingAnchors:structuredClone((records.pendingAnchors||[]).filter(row=>row.state==='pending'))},passages=new Map(paragraphs(before).map(p=>[p.id,p]));
 for(const type of ['comments','questions'])for(const raw of records[type]||[]){const record={...portableSourceNote(raw),bookId:before.bookId,contentVersion:before.contentVersion},target=anchorMap.get(record.passageId);
  if(target)result[type].push({...record,bookId:after.bookId,contentVersion:after.contentVersion,passageId:target});
  else{const passage=passages.get(record.passageId);if(!passage)throw fail('旧版私人记录的来源段落缺失，请先导出核对',409);result.pendingAnchors.push({id:'anchor-'+digest(before.bookId+':'+type+':'+record.id).slice(0,32),type,state:'pending',record,source:{bookId:before.bookId,contentVersion:before.contentVersion,passageId:passage.id,original:passage.original}});}
 }
 if(records.position&&anchorMap.has(records.position.passageId)){const passageId=anchorMap.get(records.position.passageId),section=after.sections.find(s=>s.paragraphs.some(p=>p.id===passageId));result.position={...records.position,passageId,chapterId:section.chapterId,contentVersion:after.contentVersion};}
 return result;
}
