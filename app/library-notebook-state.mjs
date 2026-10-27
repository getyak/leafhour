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
export function createNotebookLoader({api,getOwner,onUpdate=()=>{},concurrency=3}){
  let generation=0,owner=null,disposed=false,state={entries:[],failed:[],loading:false,completed:0,total:0,books:[],archiveFailed:false};
  const snapshot=()=>({...state,entries:[...state.entries],failed:[...state.failed]});
  const current=(stamp,identity)=>!disposed&&generation===stamp&&getOwner()===identity;
  const publish=(stamp,identity)=>{if(current(stamp,identity))onUpdate(snapshot());};
  return {
    view(){return getOwner()===owner?snapshot():{entries:[],failed:[],loading:false,completed:0,total:0};},
    clear(){generation++;owner=getOwner();state={entries:[],failed:[],loading:false,completed:0,total:0,books:[],archiveFailed:false};if(!disposed)onUpdate(snapshot());},
    async load(books,{includeArchived=false}={}){
      if(disposed)return snapshot();const stamp=++generation,identity=getOwner();owner=identity;
      let unique=[...new Map(rows(books).filter(book=>text(book?.bookId)).map(book=>[book.bookId,book])).values()];
      state={entries:[],failed:[],loading:unique.length>0||includeArchived,completed:0,total:unique.length,books:unique,archiveFailed:false};publish(stamp,identity);
      if(includeArchived){try{const archived=await api('/api/library/trash');if(!current(stamp,identity))return this.view();if(!Array.isArray(archived?.books))throw Error('Archived books unavailable');const combined=new Map(unique.map(book=>[book.bookId,book]));for(const book of archived.books)if(text(book?.bookId)&&!combined.has(book.bookId))combined.set(book.bookId,book);unique=[...combined.values()];state.books=unique;state.total=unique.length;}catch{if(!current(stamp,identity))return this.view();state.archiveFailed=true;}publish(stamp,identity);}
      let cursor=0;
      async function worker(){
        while(current(stamp,identity)&&cursor<unique.length){const book=unique[cursor++];try{
          const records=await api('/api/library/books/'+encodeURIComponent(book.bookId)+'/records');if(!current(stamp,identity))return;
          if(records?.bookId!==book.bookId)throw Error('Unmatched personal records');state.entries.push(...collectNotebookEntries(book,records));
        }catch{if(!current(stamp,identity))return;state.failed.push(book);}
        state.completed++;publish(stamp,identity);
        }
      }
      await Promise.all(Array.from({length:Math.min(Math.max(1,Math.min(3,concurrency)),unique.length)},worker));
      if(current(stamp,identity)){state.loading=false;publish(stamp,identity);}return getOwner()===owner?snapshot():{entries:[],failed:[],loading:false,completed:0,total:0};
    },
    dispose(){disposed=true;generation++;state={entries:[],failed:[],loading:false,completed:0,total:0,books:[],archiveFailed:false};}
  };
}
