// The notebook is a view of existing personal records, never another store.
const text=value=>typeof value==='string'?value:'';
const date=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))?value:'';
const rows=value=>Array.isArray(value)?value:[];
export function collectNotebookEntries(book,records){
  if(!book?.bookId||records?.bookId!==book.bookId)return [];
  const entries=[],title=typeof book.title==='string'?book.title:book.title?.zh||book.title?.en||book.bookId;
  for(const [field,kind] of [['comments','comment'],['questions','question'],['highlights','highlight']])for(const record of rows(records[field])){
    if(record?.origin!=='user'||record.deletedAt||record.bookId!==undefined&&record.bookId!==book.bookId||!text(record.id))continue;
    const passageId=text(record.passageId)||text(record.parts?.[0]?.passageId),body=kind==='highlight'?'':text(record.text),quote=kind==='highlight'?rows(record.parts).map(part=>text(part?.text)).filter(Boolean).join('\n\n'):text(record.quote);
    if(!body&&!quote)continue;
    const version=text(record.contentVersion)||text(records.contentVersion),sourceAvailable=!!passageId&&(!version||!book.contentVersion||version===book.contentVersion);
    const params=new URLSearchParams({book:book.bookId});if(sourceAvailable){params.set('passage',passageId);if(kind!=='highlight')params.set('note',kind);if(version)params.set('contentVersion',version);}
    entries.push({key:JSON.stringify([book.bookId,kind,record.id]),id:record.id,bookId:book.bookId,title,titleEn:typeof book.title==='object'?text(book.title?.en):'',author:text(book.author),kind,text:body,quote,quoteOrigin:kind==='highlight'?(record.parts?.[0]?.language==='en'?'original':record.parts?.[0]?.language==='zh'?'translation':'selection'):text(record.quoteOrigin),createdAt:date(record.createdAt),updatedAt:date(record.updatedAt),passageId,sourceAvailable,href:'/read?'+params,origin:'user'});
  }
  return entries;
}
const searchable=value=>String(value||'').normalize('NFKC').toLocaleLowerCase();
export function filterNotebookEntries(entries,{query='',bookId='',kind=''}={}){
  const needle=searchable(query.trim());return entries.filter(entry=>(!bookId||entry.bookId===bookId)&&(!kind||entry.kind===kind)&&(!needle||searchable([entry.text,entry.quote,entry.title,entry.titleEn,entry.author].join('\n')).includes(needle))).sort((a,b)=>Date.parse(b.updatedAt||b.createdAt||0)-Date.parse(a.updatedAt||a.createdAt||0)||a.key.localeCompare(b.key));
}
const markdownTitle=value=>String(value).replace(/\r?\n/g,' ').replace(/[\\`*_[\]<>#]/g,'\\$&');
export function notebookMarkdown(entries,{title='My notebook',labels={},baseUrl='https://leafhour.com'}={}){
  let base;try{base=new URL(baseUrl);if(!['http:','https:'].includes(base.protocol))base=new URL('https://leafhour.com');}catch{base=new URL('https://leafhour.com');}
  return '# '+markdownTitle(title)+'\n\n'+entries.map(entry=>[
    '## '+markdownTitle(entry.title),
    labels[entry.kind]||entry.kind,
    entry.createdAt?(labels.created||'Created')+': '+entry.createdAt:'',
    entry.updatedAt?(labels.updated||'Updated')+': '+entry.updatedAt:'',
    entry.text,
    entry.quote?(labels['quote.'+entry.quoteOrigin]||labels.quote||'Quotation')+'\n\n'+entry.quote.split('\n').map(line=>'> '+line).join('\n'):'',
    entry.sourceAvailable===false?(labels.sourceUnavailable||'Source position unavailable. Your note is kept.'):'',
    '['+(entry.sourceAvailable===false?(labels.openBook||'Open book'):(labels.source||'Open source'))+']('+new URL(entry.href,base).href.replace(/\(/g,'%28').replace(/\)/g,'%29')+')'
  ].filter(Boolean).join('\n\n')).join('\n\n---\n\n')+(entries.length?'\n':'');
}

// At most three record documents in flight. Every publication rechecks both
// the request generation and the caller's identity; owner IDs never enter URLs.
export function createNotebookLoader({api,getOwner,onUpdate=()=>{},concurrency=3,paged=false}){
  let generation=0,owner=null,disposed=false,inflight=null,pendingPublication=null,state={entries:[],failed:[],loading:false,completed:0,total:0,books:[],archiveFailed:false};
  const snapshot=()=>({...state,entries:[...state.entries],failed:[...state.failed]});
  const current=(stamp,identity)=>!disposed&&generation===stamp&&getOwner()===identity;
  const publish=(stamp,identity)=>{if(current(stamp,identity))onUpdate(snapshot());};
  const schedulePublish=(stamp,identity)=>{
    if(pendingPublication?.stamp===stamp)return;
    const pending={stamp};pendingPublication=pending;
    queueMicrotask(()=>{if(pendingPublication!==pending)return;pendingPublication=null;publish(stamp,identity);});
  };
  return {
    view(){return getOwner()===owner?snapshot():{entries:[],failed:[],loading:false,completed:0,total:0};},
    clear(){inflight=null;pendingPublication=null;generation++;owner=getOwner();state={entries:[],failed:[],loading:false,completed:0,total:0,books:[],archiveFailed:false};if(!disposed)onUpdate(snapshot());},
    load(books,{includeArchived=false}={}){
      const identity=getOwner(),key=JSON.stringify([includeArchived,rows(books)]);
      if(inflight&&inflight.identity===identity&&inflight.key===key)return inflight.promise;
      const operation={identity,key,promise:null};
      operation.promise=this.run(books,{includeArchived}).finally(()=>{if(inflight===operation)inflight=null;});
      inflight=operation;return operation.promise;
    },
    async run(books,{includeArchived=false}={}){
      if(disposed)return snapshot();const stamp=++generation,identity=getOwner();owner=identity;
      let unique=[...new Map(rows(books).filter(book=>text(book?.bookId)).map(book=>[book.bookId,book])).values()];
      state={entries:[],failed:[],loading:unique.length>0||includeArchived,completed:0,total:unique.length,books:unique,archiveFailed:false};publish(stamp,identity);
      if(paged){
        state.loading=true;state.books=[];state.total=0;state.completed=0;publish(stamp,identity);
        let cursor=null;const seen=new Set();
        try{do{
          const page=await api('/api/library/notebook?limit=12'+(cursor?'&cursor='+encodeURIComponent(cursor):''));if(!current(stamp,identity))return this.view();
          if(!Array.isArray(page?.books)||!Array.isArray(page.entries)||!Array.isArray(page.failed)||!Number.isSafeInteger(page.completed)||!Number.isSafeInteger(page.total)||page.completed<state.completed||page.total<page.completed||page.nextCursor!==null&&(typeof page.nextCursor!=='string'||page.nextCursor.length>256||seen.has(page.nextCursor)))throw Error('Invalid notebook page');
          state.books.push(...page.books);state.total=page.total;
          for(const {book,records} of page.entries)state.entries.push(...collectNotebookEntries(book,records));
          const fallback=page.failed.filter(book=>book.fallback===true);state.failed.push(...page.failed.filter(book=>book.fallback!==true));let next=0;
          async function recover(){while(current(stamp,identity)&&next<fallback.length){const book=fallback[next++];try{const records=await api('/api/library/books/'+encodeURIComponent(book.bookId)+'/records');if(!current(stamp,identity))return;if(records?.bookId!==book.bookId)throw Error('Unmatched personal records');state.entries.push(...collectNotebookEntries(book,records));}catch{if(!current(stamp,identity))return;state.failed.push(book);}}}
          await Promise.all(Array.from({length:Math.min(3,fallback.length)},recover));if(!current(stamp,identity))return this.view();
          state.completed=page.completed;cursor=page.nextCursor;if(cursor)seen.add(cursor);publish(stamp,identity);
        }while(cursor);}catch{
          if(!current(stamp,identity))return this.view();
          const failedIds=new Set(state.failed.map(book=>book.bookId));for(const book of unique)if(!failedIds.has(book.bookId)){state.failed.push(book);failedIds.add(book.bookId);}
          if(!state.failed.length)state.archiveFailed=true;
        }
        if(current(stamp,identity)){state.loading=false;publish(stamp,identity);}return this.view();
      }
      if(includeArchived){try{const archived=await api('/api/library/trash');if(!current(stamp,identity))return this.view();if(!Array.isArray(archived?.books))throw Error('Archived books unavailable');const combined=new Map(unique.map(book=>[book.bookId,book]));for(const book of archived.books)if(text(book?.bookId)&&!combined.has(book.bookId))combined.set(book.bookId,book);unique=[...combined.values()];state.books=unique;state.total=unique.length;}catch{if(!current(stamp,identity))return this.view();state.archiveFailed=true;}publish(stamp,identity);}
      let cursor=0;
      async function worker(){
        while(current(stamp,identity)&&cursor<unique.length){const book=unique[cursor++];try{
          const records=await api('/api/library/books/'+encodeURIComponent(book.bookId)+'/records');if(!current(stamp,identity))return;
          if(records?.bookId!==book.bookId)throw Error('Unmatched personal records');state.entries.push(...collectNotebookEntries(book,records));
        }catch{if(!current(stamp,identity))return;state.failed.push(book);}
        state.completed++;schedulePublish(stamp,identity);
        }
      }
      await Promise.all(Array.from({length:Math.min(Math.max(1,Math.min(3,concurrency)),unique.length)},worker));
      if(current(stamp,identity)){state.loading=false;pendingPublication=null;publish(stamp,identity);}return getOwner()===owner?snapshot():{entries:[],failed:[],loading:false,completed:0,total:0};
    },
    dispose(){inflight=null;pendingPublication=null;disposed=true;generation++;state={entries:[],failed:[],loading:false,completed:0,total:0,books:[],archiveFailed:false};}
  };
}
