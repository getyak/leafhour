import {validateLibraryBackup} from './library-backup.mjs';

const PART_BYTES=1048576,MAX_BOOK_BYTES=512*1024*1024;
const invalid=()=>Error('备份分段未通过校验，尚未生成备份，请重试。');
const hash=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
export async function exportLibraryInParts({api,assertCurrent=()=>{},onProgress=()=>{}}){
  if(!globalThis.crypto?.subtle?.digest)throw Error('当前连接无法校验备份，请使用HTTPS或本机localhost打开书房后再导出。');
  assertCurrent();const manifest=await api('/api/library/export/manifest');assertCurrent();
  if(manifest?.kind!=='marginalia-export-manifest'||manifest.schemaVersion!==1||!Number.isFinite(Date.parse(manifest.exportedAt))||!Array.isArray(manifest.books)||manifest.books.length>100)throw invalid();
  const seen=new Set();for(const book of manifest.books){if(!/^[A-Za-z0-9_-]{1,128}$/.test(book?.bookId)||seen.has(book.bookId)||typeof book.contentVersion!=='string'||!book.contentVersion||book.contentVersion.length>256)throw invalid();seen.add(book.bookId);}
  const backup={kind:'marginalia-library',schemaVersion:1,exportedAt:manifest.exportedAt,books:[],includesOriginalFiles:false};
  for(const [index,book]of manifest.books.entries()){
    let entry;
    for(let attempt=0;attempt<3;attempt++){
      assertCurrent();let offset=0,snapshot=null,total=null;const chunks=[];
      try{
        do{
          assertCurrent();const part=await api('/api/library/books/'+encodeURIComponent(book.bookId)+'/export-part?offset='+offset+(snapshot?'&snapshot='+snapshot:''));assertCurrent();
          if(part?.kind!=='marginalia-book-export-part'||part.schemaVersion!==1||part.bookId!==book.bookId||part.contentVersion!==book.contentVersion||part.offset!==offset||!Number.isSafeInteger(part.totalBytes)||part.totalBytes<1||part.totalBytes>MAX_BOOK_BYTES||!/^[a-f0-9]{64}$/.test(part.snapshot)||snapshot&&snapshot!==part.snapshot||total!==null&&total!==part.totalBytes||typeof part.data!=='string'||part.data.length>Math.ceil(PART_BYTES/3)*4||part.data.length%4||!/^[A-Za-z0-9+/]*={0,2}$/.test(part.data))throw invalid();
          snapshot=part.snapshot;total=part.totalBytes;let binary;try{binary=atob(part.data);}catch{throw invalid();}
          const bytes=Uint8Array.from(binary,c=>c.charCodeAt(0)),expected=Math.min(PART_BYTES,total-offset),next=offset+bytes.length;
          if(bytes.length!==expected||part.nextOffset!==(next<total?next:null))throw invalid();
          chunks.push(bytes);offset=next;onProgress({bookIndex:index+1,bookCount:manifest.books.length,receivedBytes:offset,totalBytes:total,attempt});assertCurrent();
        }while(offset<total);
        const bytes=new Uint8Array(total);let cursor=0;for(const chunk of chunks){bytes.set(chunk,cursor);cursor+=chunk.length;}
        const actualHash=await hash(bytes);assertCurrent();if(actualHash!==snapshot)throw invalid();
        try{entry=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw invalid();}
        if(entry?.book?.bookId!==book.bookId||entry.book.contentVersion!==book.contentVersion)throw invalid();
        validateLibraryBackup({kind:'marginalia-library',schemaVersion:1,books:[entry]});break;
      }catch(error){assertCurrent();if(error.status===409&&attempt<2)continue;if(error.status===409)throw Error('这本书的记录仍在更新，尚未生成备份。请先结束阅读，再重试导出。');throw error;}
    }
    backup.books.push(entry);
  }
  assertCurrent();validateLibraryBackup(backup);return backup;
}
