import {digest,fail} from './document-import.mjs';
import {MAX_BOOK_BYTES} from './book-capacity.mjs';
export const BOOK_PART_BYTES=1048576;
export function bookTransfer(book,offset,snapshot){
 const bytes=Buffer.from(JSON.stringify(book));if(bytes.length>MAX_BOOK_BYTES)throw fail('这本书超过当前内容传输容量，原文件仍保留。',413);
 const hash=digest(bytes);
 if(offset===undefined)return {kind:'leafhour-book-transfer-v1',bookId:book.bookId,contentVersion:book.contentVersion,snapshot:hash,totalBytes:bytes.length,partBytes:BOOK_PART_BYTES};
 if(snapshot!==hash)throw fail('正文或译文刚刚更新，请重新载入这本书。',409);
 if(!Number.isSafeInteger(offset)||offset<0||offset>=bytes.length||offset%BOOK_PART_BYTES!==0)throw fail('正文分段位置无效。');
 const end=Math.min(bytes.length,offset+BOOK_PART_BYTES);
 return {kind:'leafhour-book-part-v1',snapshot:hash,totalBytes:bytes.length,offset,nextOffset:end<bytes.length?end:null,data:bytes.subarray(offset,end).toString('base64')};
}
