import {exportLibraryInParts,readExportResource} from './library-export.mjs';
import {portableHash,MAX_ARCHIVE_BYTES,PART_BYTES} from './library-portability.mjs';

export function exportBrowserRecords({storage,owner}){
 if(typeof owner!=='string'||!owner||owner.includes('|'))throw Error('Authenticated owner required');
 const reading=['marginalia-focus-drafts-v1','marginalia-focus-drafts-v2','marginalia-record-edit-drafts-v1','marginalia-focus-position-v1','marginalia-reading-outbox-v1','marginalia-reading-marks-v1','marginalia-reading-ending-drafts-v1','marginalia-reading-ending-context-v1'];
 const chat=['chat-draft','chat-quote','chat-quote-ack','chat-pending'].map(name=>'marginalia:'+name+':'+encodeURIComponent(owner)+':');
 const prefixes=[...reading.map(name=>name+'|'+owner+'|'),...chat],entries=[];
 for(let index=0;index<storage.length;index++){
  const key=storage.key(index);let annotation=false;
  if(key?.startsWith('marginalia-annotation-pending-v1|'))try{const scope=JSON.parse(key.slice('marginalia-annotation-pending-v1|'.length));annotation=Array.isArray(scope)&&scope.length===3&&scope[0]===owner&&scope.slice(1).every(value=>typeof value==='string'&&value.length>0);}catch{}
  if(annotation||prefixes.some(prefix=>key?.startsWith(prefix)))entries.push({key,value:storage.getItem(key)});
 }
 return {kind:'leafhour-browser-records',schemaVersion:1,entries};
}

// Every request and final download belongs to one captured account/session.
// Failure of any selected component rejects the entire export, never a partial
// file labelled as complete. This is an open JSON export, not a restore command.
export async function exportAccountData({api,assertCurrent=()=>{},includeOriginals=false,includeAudio=false,onProgress=()=>{}}){
 const read=url=>readExportResource({api,url,assertCurrent});
 const account=await read('/api/account/export');
 const library=await exportLibraryInParts({api,assertCurrent,partAction:'portability-part',manifestURL:'/api/account/export/manifest',maxBooks:1000,onProgress});
 library.kind='leafhour-account-library';
 const originals=[],listening=[];let total=new TextEncoder().encode(JSON.stringify({account,library})).length;
 const reserve=bytes=>{total+=bytes;if(total>MAX_ARCHIVE_BYTES)throw Error('Export exceeds 512 MiB');};
 reserve(0);
 for(const entry of library.books){
  const id=encodeURIComponent(entry.book.bookId);
  if(includeOriginals&&entry.book.visibility==='private'){
   const info=await read('/api/library/books/'+id+'/original/info');
   if(!info.available)throw Error('Original unavailable: '+entry.book.bookId);
   if(!Number.isSafeInteger(info.bytes)||info.bytes<1||info.bytes>256*1024*1024||!/^[a-f0-9]{64}$/.test(info.sha256))throw Error('Invalid original manifest');
   reserve(Math.ceil(info.bytes/3)*4);const chunks=[],bytes=new Uint8Array(info.bytes);let offset=0;
   while(offset<info.bytes){const part=await read('/api/library/books/'+id+'/portability-original?offset='+offset+'&sha256='+info.sha256),raw=Uint8Array.from(atob(part.data),c=>c.charCodeAt(0)),next=offset+raw.length;
    if(part.offset!==offset||part.totalBytes!==info.bytes||part.sha256!==info.sha256||raw.length!==Math.min(PART_BYTES,info.bytes-offset)||part.nextOffset!==(next<info.bytes?next:null))throw Error('Invalid original part');
    bytes.set(raw,offset);chunks.push(part.data);offset=next;
   }
   if(await portableHash(bytes)!==info.sha256)throw Error('Original checksum mismatch');
   // Parts retain independent base64 padding and explicit offsets.
   originals.push({bookId:entry.book.bookId,filename:entry.book.source.filename,sha256:info.sha256,bytes:info.bytes,partBytes:PART_BYTES,base64Parts:chunks});
  }
  if(includeAudio){const backup=await read('/api/library/books/'+id+'/audio/export');reserve(new TextEncoder().encode(JSON.stringify(backup)).length);listening.push({bookId:entry.book.bookId,backup});}
 }
 assertCurrent();return {kind:'leafhour-personal-data',schemaVersion:1,exportedAt:new Date().toISOString(),account,library,originals,listening,includes:{originals:includeOriginals,listening:includeAudio},excludes:['login-credentials','access-grants','data-on-other-devices']};
}
