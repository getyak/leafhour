// Only book metadata is scanned for capacity. Chapter bodies stay behind exact
// keys; the bookKey index supports deletion and completeness without loading text.
export function createOfflineIdb({indexedDB=globalThis.indexedDB,name='leafhour-offline-reading-v1'}={}){
 let opening=null;
 const request=value=>new Promise((resolve,reject)=>{value.onsuccess=()=>resolve(value.result);value.onerror=()=>reject(value.error||Error('IndexedDB request failed'));});
 function open(){
  if(opening)return opening;
  opening=new Promise((resolve,reject)=>{
   if(!indexedDB?.open){reject(Error('IndexedDB unavailable'));return;}
   let settled=false;const pending=indexedDB.open(name,1);
   pending.onupgradeneeded=()=>{const db=pending.result;if(!db.objectStoreNames.contains('books'))db.createObjectStore('books',{keyPath:'key'});if(!db.objectStoreNames.contains('chapters')){const chapters=db.createObjectStore('chapters',{keyPath:'key'});chapters.createIndex('bookKey','bookKey');}};
   pending.onerror=()=>{settled=true;reject(pending.error||Error('IndexedDB unavailable'));};
   pending.onblocked=()=>{settled=true;reject(Error('IndexedDB blocked'));};
   pending.onsuccess=()=>{const db=pending.result;if(settled){db.close();return;}db.onversionchange=()=>{db.close();opening=null;};resolve(db);};
  }).catch(error=>{opening=null;throw error;});return opening;
 }
 return {async run(mode,operation){
  const db=await open(),transaction=db.transaction(['books','chapters'],mode);
  const done=new Promise((resolve,reject)=>{transaction.oncomplete=()=>resolve();transaction.onerror=()=>reject(transaction.error||Error('IndexedDB transaction failed'));transaction.onabort=()=>reject(transaction.error||Error('IndexedDB transaction aborted'));});
  // A request can fail before the operation's catch runs.
  void done.catch(()=>{});
  const tx={get:(store,key)=>request(transaction.objectStore(store).get(key)),all:store=>request(transaction.objectStore(store).getAll()),keys:(store,index,key)=>request(index?transaction.objectStore(store).index(index).getAllKeys(key):transaction.objectStore(store).getAllKeys()),put:(store,row)=>request(transaction.objectStore(store).put(row)),delete:(store,key)=>request(transaction.objectStore(store).delete(key))};
  let value;try{value=await operation(tx);}catch(error){try{transaction.abort();}catch{}await done.catch(()=>{});throw error;}
  await done;return value;
 }};
}
