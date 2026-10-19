import {t} from './ui-locale.mjs';
// GET-178 full-library palette data. One exact call to /api/library (never the
// readerFetch path remap) with a captured owner, request-generation fence and
// session bootstrap/invalidation. Private book names are never persisted to a
// cache, the URL query or cross-owner recents: results live only in this
// instance and are cleared synchronously on sign-out, owner change or session
// invalidation. The owner fence runs in view/search/load/adoption — not only
// when a request settles — so a late or silent owner transition can never keep
// another owner's names visible or cached.

export const PALETTE_QUERY_LIMIT=80;
export const PALETTE_RESULT_LIMIT=8;

export function normalizePaletteQuery(value){
  if(typeof value!=='string')return '';
  const trimmed=value.trim();
  if(!trimmed||/[\u0000-\u001f\u007f]/.test(trimmed)||!trimmed.isWellFormed())return '';
  const bounded=trimmed.slice(0,PALETTE_QUERY_LIMIT);
  return /[\uD800-\uDBFF]$/.test(bounded)?bounded.slice(0,-1):bounded;
}

const fold=value=>String(value||'').normalize('NFKC').toLowerCase();

// Modest, bounded matching: cheap folded substring hits on title and author,
// title prefixes rank first, and the result list never exceeds the limit.
export function matchPaletteBooks(books,query,{limit=PALETTE_RESULT_LIMIT}={}){
  const needle=normalizePaletteQuery(query);
  if(!needle||!Array.isArray(books))return [];
  const target=fold(needle),hits=[];
  for(const book of books){
    const zh=fold(book?.title?.zh),en=fold(book?.title?.en),author=fold(book?.author);
    let score=-1;
    if(zh.startsWith(target)||en.startsWith(target))score=0;
    else if(zh.includes(target)||en.includes(target))score=1;
    else if(author.includes(target))score=2;
    if(score>=0)hits.push({book,score});
  }
  return hits.sort((a,b)=>a.score-b.score).slice(0,limit).map(hit=>hit.book);
}

const instances=new Set();

// Pages with an account lifecycle (home/library) invalidate every open palette
// library synchronously at the exact owner transition point.
export function invalidatePaletteLibraries(){for(const library of instances)library.invalidate();}

export function createPaletteLibrary({request=fetch,getOwner=null,subscribe=null,onChange=()=>{}}={}){
  // getOwner=null means "unknown identity" (support pages with no owner source):
  // the session identity is authoritative. A getter means a known owner —
  // including known guest (getter returning null) — and any incompatible
  // session identity is rejected before /api/library and again at adoption.
  const ownerOf=typeof getOwner==='function'?getOwner:()=>null;
  const identityKnown=typeof getOwner==='function';
  let generation=0,phase='idle',books=[],error=null,loadedOwner=ownerOf();
  const watchers=new Set();
  const notify=()=>{onChange();for(const watcher of watchers)watcher();};
  const clear=()=>{books=[];error=null;phase='idle';notify();};
  const invalidate=()=>{generation++;loadedOwner=ownerOf();clear();};
  const fence=()=>{if(loadedOwner!==ownerOf()){invalidate();return false;}return true;};
  const changed=response=>response?.headers?.get?.('X-Reader-Session-Changed')==='1';
  const requireOk=response=>{if(response?.ok===false)throw Object.assign(Error(t('palette.library.unavailable')),{status:response.status,messageId:'palette.library.unavailable'});return response;};
  const compatible=identity=>!identityKnown||(ownerOf()||'guest')===(identity?.owner||'guest');
  async function sessionIdentity(){
    const response=requireOk(await request('/api/auth/session',{cache:'no-store'}));
    if(changed(response))return {changed:true};
    const body=await response.json();
    return {owner:body?.user?.id||'guest'};
  }
  const library={
    view(){fence();return {phase,books:[...books],error,owner:loadedOwner,count:books.length};},
    invalidate(){invalidate();},
    search(query){fence();return matchPaletteBooks(books,query);},
    watch(fn){watchers.add(fn);return ()=>watchers.delete(fn);},
    dispose(){instances.delete(library);release?.();},
    async load(){
      fence();
      const captured=ownerOf(),ticket=++generation,stale=()=>ticket!==generation;
      phase='loading';error=null;
      try{
        const identity=await sessionIdentity();
        if(stale())return library.view();
        if(identity.changed||!compatible(identity)){invalidate();return library.view();}
        const response=requireOk(await request('/api/library',{cache:'no-store',headers:{'X-Reader-Owner':identity.owner||'guest'}}));
        if(stale())return library.view();
        if(ownerOf()!==captured||!compatible(identity)){invalidate();return library.view();}
        if(changed(response)){invalidate();return library.view();}
        const data=await response.json();
        if(stale())return library.view();
        if(ownerOf()!==captured||!compatible(identity)){invalidate();return library.view();}
        const list=Array.isArray(data?.books)?data.books:[];
        // Without an owner subscription the only safe adoption gate for private
        // results is a fresh session check against the captured identity.
        if(list.some(item=>item?.visibility!=='public')){
          const recheck=await sessionIdentity();
          if(stale())return library.view();
          if(recheck.changed||!compatible(recheck)||recheck.owner!==(identity.owner||'guest')){invalidate();return library.view();}
        }
        if(stale()||ownerOf()!==captured||!compatible(identity))return library.view();
        books=list;loadedOwner=captured;phase='ready';notify();
      }catch(error_){if(ticket===generation){phase='error';error=error_?.messageId?{id:error_.messageId}:{id:'palette.library.failed'};books=[];notify();}}
      return library.view();
    }
  };
  const release=subscribe?subscribe(()=>invalidate()):null;
  instances.add(library);
  return library;
}
