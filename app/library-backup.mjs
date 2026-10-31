import {validatePendingAnchors} from './source-revisions.mjs';
import {normalizeAppearance,validateGlobalPreferencesMetadata} from './reading-preferences.mjs';
import {validParagraphAnchor} from './paragraph-anchor.mjs';
import {normalizeReadingSession,normalizeReadingMilestone,normalizeReadingGoal} from './reading-session-record.mjs';
import {isReadingTimeSource} from './reading-time-policy.mjs';
import {validateReadingDraftBackup} from './reading-draft-store.mjs';
import {normalizeHighlight} from './highlights.mjs';
import {validatePersonalRecordMetadata} from './personal-records.mjs';
import {validateBookIntroduction} from './book-introduction.mjs';
import {validateAnnotationArchive} from './reader-annotation-records.mjs';

const object=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const text=(value,max=12000)=>typeof value==='string'&&value.trim().length>0&&value.length<=max;
const id=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(value);
const date=value=>typeof value==='string'&&Number.isFinite(Date.parse(value));
const invalid=(where,message)=>{throw Object.assign(Error(where+'：'+message+'。未开始恢复，请检查备份。'),{status:400});};

// Used before browser batching and again at the server boundary. Never repairs source data silently.
export function validateLibraryBackup(backup){
  if(!object(backup)||backup.kind!=='marginalia-library'||backup.schemaVersion!==1||!Array.isArray(backup.books)||backup.books.length>100)invalid('备份','请选择 Leafhour 书房备份，最多 100 本');
  // Optional account-wide reading defaults: strict v1 metadata, nothing unknown or unbounded.
  if(backup.readingPreferences!==undefined){try{validateGlobalPreferencesMetadata(backup.readingPreferences);}catch{invalid('备份','阅读习惯信息不完整');}}
  const bookIds=new Set();let paragraphs=0,notes=0;
  for(const [index,entry] of backup.books.entries()){
    const where='第 '+(index+1)+' 本书',b=entry?.book,r=entry?.records;
    if(entry.shelf!==undefined){
      const shelf=entry.shelf;if(!object(shelf)||Object.keys(shelf).some(key=>!['order','archivedAt','pinned'].includes(key))||shelf.pinned!==undefined&&typeof shelf.pinned!=='boolean'||shelf.archivedAt!==undefined&&!date(shelf.archivedAt)||shelf.order!==undefined&&(!Array.isArray(shelf.order)||shelf.order.length>1000||shelf.order.some(value=>!id(value))||new Set(shelf.order).size!==shelf.order.length))invalid(where,'书架信息不完整');
    }
    if(!object(b)||!id(b.bookId)||bookIds.has(b.bookId)||!text(b.contentVersion,256)||!object(b.title)||!text(b.title.zh,500)||b.title.en!==undefined&&typeof b.title.en!=='string'||b.author!==undefined&&typeof b.author!=='string'||!object(b.source)||!text(b.source.format,20)||!Array.isArray(b.chapters)||!b.chapters.length||!Array.isArray(b.sections)||!b.sections.length||!Array.isArray(b.annotations)||!Array.isArray(b.glossary))invalid(where,'书籍信息不完整或书籍标识重复');
    if(b.source.url!==null&&b.source.url!==undefined){let url;try{url=new URL(b.source.url);}catch{invalid(where,'来源链接不正确');}if(!['https:','http:'].includes(url.protocol))invalid(where,'来源链接只能使用网页地址');}
    bookIds.add(b.bookId);const chapterIds=new Set(),occupiedChapters=new Set(),passageIds=new Map();
    for(const c of b.chapters){if(!object(c)||!id(c.id)||chapterIds.has(c.id)||!Number.isInteger(c.number)||c.number<0||c.number===0&&!['frontmatter','appendix'].includes(c.kind)||!object(c.title)||!text(c.title.zh,500)||c.title.en!==undefined&&typeof c.title.en!=='string')invalid(where,'章节标题或标识不完整');chapterIds.add(c.id);}
    const sectionNumbers=new Set();
    for(const s of b.sections){
      if(!object(s)||!chapterIds.has(s.chapterId)||!Number.isInteger(s.number)||s.number<1||sectionNumbers.has(s.number)||!Array.isArray(s.paragraphs)||!s.paragraphs.length)invalid(where,'章节段落不完整');sectionNumbers.add(s.number);
      for(const p of s.paragraphs){
        if(!object(p)||!id(p.id)||passageIds.has(p.id)||!text(p.original,100000)||!object(p.translations)||!Array.isArray(p.annotationIds)||!Array.isArray(p.termIds))invalid(where,'原文锚点缺失或重复');
        passageIds.set(p.id,s.chapterId);occupiedChapters.add(s.chapterId);paragraphs++;
        for(const [variant,t] of Object.entries(p.translations))if(!['literal','interpretive'].includes(variant)||!object(t)||!text(t.text)||t.origin!=='ai'||!['draft','reviewed'].includes(t.status)||t.variant!==undefined&&t.variant!==variant||t.sourceVersion!==undefined&&t.sourceVersion!==b.contentVersion||t.createdAt!==undefined&&!date(t.createdAt))invalid(where,'译文内容、归属或来源版本不正确');
      }
    }
    if([...chapterIds].some(chapter=>!occupiedChapters.has(chapter)))invalid(where,'存在没有原文的章节');
    if(b.introduction!==undefined)try{validateBookIntroduction(b.introduction,b);}catch{invalid(where,'AI 简介的来源、状态或原文版本不正确');}
    if(b.readingStart!==undefined&&(!object(b.readingStart)||!chapterIds.has(b.readingStart.chapterId)||passageIds.get(b.readingStart.passageId)!==b.readingStart.chapterId))invalid(where,'正文起点无法对应原文');
    for(const c of b.chapters)if(c.startPassageId!==undefined&&passageIds.get(c.startPassageId)!==c.id)invalid(where,'章节起点无法对应原文');
    const annotationIds=new Set(),termIds=new Set();
    for(const n of b.annotations){if(!object(n)||!id(n.id)||annotationIds.has(n.id)||!text(n.title,500)||!text(n.text)||!['editorial','author','source'].includes(n.attribution))invalid(where,'原书注释或编辑注解不完整');annotationIds.add(n.id);}
    for(const n of b.glossary){if(!object(n)||!id(n.id)||termIds.has(n.id)||!text(n.en,500)||!text(n.zh,500)||!text(n.definition))invalid(where,'术语解释不完整');termIds.add(n.id);}
    for(const s of b.sections)for(const p of s.paragraphs)if(p.annotationIds.some(key=>!annotationIds.has(key))||p.termIds.some(key=>!termIds.has(key)))invalid(where,'注解无法对应原文段落');
    if(object(r)&&r.contentVersion!==b.contentVersion)throw Object.assign(Error(where+'：备份的原文版本与个人记录冲突，未覆盖原书或记录。'),{status:409});
    if(!object(r)||r.bookId!==b.bookId||r.contentVersion!==b.contentVersion||r.kind!=='marginalia-personal-records'||![1,2,3].includes(r.schemaVersion)||!['comments','questions','readingSessions'].every(key=>Array.isArray(r[key])&&r[key].length<=10000))invalid(where,'个人记录无法对应原文');
    for(const key of ['comments','questions']){
      const ids=new Set();for(const n of r[key]){
        if(!object(n)||!text(n.id,128)||ids.has(n.id)||!passageIds.has(n.passageId)||n.origin!=='user'||!text(n.text,2000)||!date(n.createdAt)||n.bookId!==undefined&&n.bookId!==b.bookId||n.contentVersion!==undefined&&n.contentVersion!==b.contentVersion||n.quote!==undefined&&(typeof n.quote!=='string'||n.quote.length>4000))invalid(where,'个人笔记的标识、时间或归属不正确');
        try{validatePersonalRecordMetadata(n);}catch{invalid(where,'个人笔记的修改时间或版本不正确');}
        ids.add(n.id);notes++;
      }
    }
    if(r.highlights!==undefined){
      if(!Array.isArray(r.highlights)||r.highlights.length>10000)invalid(where,'高亮记录不完整');
      const ids=new Set();for(const row of r.highlights){try{normalizeHighlight(row,b,{stored:true});for(const id of [row.id,...row.requestIds||[]]){if(ids.has(id))invalid(where,'高亮标识重复');ids.add(id);}}catch{invalid(where,'高亮记录无法对应原文位置');}}
    }
    const sessionIds=new Set();for(const s of r.readingSessions){
      if(!object(s)||!text(s.id,128)||sessionIds.has(s.id)||s.bookId!==b.bookId||!date(s.startedAt)||!date(s.endedAt)||Date.parse(s.endedAt)<Date.parse(s.startedAt)||!Number.isFinite(s.durationSeconds)||s.durationSeconds<0||s.durationSeconds>86400)invalid(where,'阅读时段的时间或来源不正确');
      if(isReadingTimeSource(s.source)){try{const normalized=normalizeReadingSession(s,b);if(normalized.durationSeconds!==s.durationSeconds)invalid(where,'阅读时段与实际区间不一致');}catch{invalid(where,'阅读时段无法对应当前原文或实际时间');}}
      else if(s.source!=='design_preview_focus_timer')invalid(where,'阅读时段的来源不正确');sessionIds.add(s.id);
    }
    if(r.schemaVersion===3||r.readingMilestones!==undefined){if(!Array.isArray(r.readingMilestones)||r.readingMilestones.length>10000)invalid(where,'阅读标记不完整');const marks=new Set();for(const mark of r.readingMilestones){try{if(marks.has(mark?.id)||mark?.origin!=='user'||mark.bookId!==b.bookId||mark.contentVersion!==b.contentVersion)invalid(where,'阅读标记归属不正确');normalizeReadingMilestone(mark,b);marks.add(mark.id);}catch{invalid(where,'阅读标记无法对应原文');}}}
    if(r.readingGoal!==undefined){try{if(!date(r.readingGoal?.updatedAt))invalid(where,'阅读目标时间不正确');normalizeReadingGoal(r.readingGoal);}catch{invalid(where,'阅读目标不正确');}}
    if(entry.localReadingDrafts!==undefined){try{validateReadingDraftBackup(entry.localReadingDrafts,b);}catch{invalid(where,'本机阅读草稿无法对应原文或待确认提交');}}
    try{validatePendingAnchors(r,b);}catch{invalid(where,'待确认私人记录无法恢复');}
    if(Object.hasOwn(entry,'readerAnnotations'))validateAnnotationArchive(entry.readerAnnotations,b,{historical:true});
    if(r.position!==null&&r.position!==undefined){const p=r.position;if(!object(p)||passageIds.get(p.passageId)!==p.chapterId||!validParagraphAnchor(p)||!['zh','en','parallel'].includes(p.mode)||!['literal','interpretive'].includes(p.variant)||p.contentVersion!==undefined&&p.contentVersion!==b.contentVersion||p.revision!==undefined&&(!Number.isInteger(p.revision)||p.revision<0)||p.updatedAt!==undefined&&!date(p.updatedAt))invalid(where,'阅读位置不完整');try{normalizeAppearance(p,true);}catch{invalid(where,'阅读排版设置不正确');}}
  }
  return {books:backup.books.length,paragraphs,notes};
}
