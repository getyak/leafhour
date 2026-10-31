const translationFields=['sourceLanguage','translationLanguages','supportsParallel','translatedParagraphs','translationCoverage'];
const sameSource=(a,b)=>typeof a?.contentVersion==='string'&&!!a.contentVersion&&a.contentVersion===b?.contentVersion;
function retainTranslations(row,loaded){
 const next={...row};
 if(sameSource(row,loaded)&&loaded.personalizationPending!==true){
  for(const key of translationFields)if(Object.hasOwn(loaded,key))next[key]=loaded[key];
  next.personalizationPending=false;
 }
 return next;
}
export function mergeAccountShelf(current,snapshot,owner){
 if(snapshot?.kind!=='leafhour-account-shelf-v1'||snapshot.user?.id!==owner||!Array.isArray(snapshot.books)||!Array.isArray(snapshot.archivedBooks)||!Number.isSafeInteger(snapshot.shelfRevision))throw Error('Account shelf could not be verified');
 const loaded=new Map(current.map(row=>[row.bookId,row]));
 return snapshot.books.map(row=>retainTranslations(row,loaded.get(row.bookId)));
}
export function hydrateAccountBooks(current,rows,{stale=false}={}){
 if(!stale){const previous=new Map(current.map(row=>[row.bookId,row]));return rows.map(row=>{const next={...row},old=previous.get(row.bookId);if(sameSource(row,old))for(const key of ['pinned','readingStateReady'])if(!Object.hasOwn(next,key)&&Object.hasOwn(old,key))next[key]=old[key];return next;});}
 const loaded=new Map(rows.map(row=>[row.bookId,row]));
 return current.map(row=>row.personalizationPending===false?{...row}:retainTranslations(row,loaded.get(row.bookId)));
}
export function applyShelfPins(books,shelf){
 if(!Array.isArray(shelf?.pinned)||!Number.isSafeInteger(shelf.revision))throw Error('Shelf pins could not be verified');
 const pinned=new Set(shelf.pinned);return books.map(book=>({...book,pinned:pinned.has(book.bookId)}));
}
// Event bursts share one request. Each completion is fenced by both the owner
// token and this controller's generation; failed reads leave rendered state alone.
export function createForegroundRefresh({capture,isCurrent,read,apply}){
 const running=new Map();let generation=0;
 return {invalidate(){generation++;},refresh(){
  const ticket=capture(),at=generation,key=JSON.stringify([at,ticket]);
  if(running.has(key))return running.get(key);
  const work=Promise.resolve().then(()=>{if(!isCurrent(ticket))return null;return read(ticket);}).then(async value=>{if(value!==null&&generation===at&&isCurrent(ticket)){await apply(value,ticket);return value;}return null;});
  running.set(key,work);work.finally(()=>{if(running.get(key)===work)running.delete(key);}).catch(()=>{});return work;
 }};
}
// This controller is loaded after an account is confirmed. Its outbox codec
// waits until that owner's lightweight shelf metadata has been verified.
export function createAccountShelfRefresh({scope,current,api,storage,begin,apply,loadDrain=()=>import('./account-reading-drain.mjs')}){
 return createForegroundRefresh({
  capture:()=>({...scope.capture(),generation:current().generation}),
  isCurrent:ticket=>{const state=current();return scope.isCurrent(ticket)&&ticket.generation===state.generation&&!!state.accountID&&state.accountID===ticket.owner&&!state.busy;},
  read:async ticket=>{
   begin();let snapshot=await api('/api/library?view=account',undefined,ticket);
   mergeAccountShelf(current().books,snapshot,ticket.owner);let drained={sent:0};
   if(storage)try{const {drainAccountReading}=await loadDrain();drained=await drainAccountReading({storage,owner:ticket.owner,books:[...snapshot.books,...snapshot.archivedBooks],isCurrent:()=>scope.isCurrent(ticket)&&ticket.generation===current().generation,send:(id,row)=>api('/api/library/books/'+encodeURIComponent(id)+'/reading-sessions',row,ticket)});}catch{}
   if(drained.sent&&scope.isCurrent(ticket))snapshot=await api('/api/library?view=account',undefined,ticket);
   return snapshot;
  },apply:(snapshot,ticket)=>apply(snapshot,mergeAccountShelf(current().books,snapshot,ticket.owner))
 });
}
