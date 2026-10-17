import {fail} from './document-import.mjs';
export const MAX_BOOK_BYTES=32*1024*1024;
// Two 12,000-unit translations can each need six JSON bytes per UTF-16 unit.
export const TRANSLATION_RESERVE_BYTES=160000;
export function bookCapacity(book,reservedTranslationBytes=0){
 const bytes=Buffer.byteLength(JSON.stringify(book));
 if(bytes+reservedTranslationBytes>MAX_BOOK_BYTES)throw fail('这本书已达到单本内容容量，已有原文与译文仍保留；本次尚未提交新的翻译。',413);
 return bytes;
}
