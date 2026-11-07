// The map is the bundled public catalogue, never an account library or request body.
import {fail} from './document-import.mjs';
export function publicExcerpt(catalog,{bookId,passageId,contentVersion}){
 const book=catalog.get(bookId);
 if(!book||book.visibility!=='public')throw fail('没有可试读的公版段落',404);
 if(typeof contentVersion!=='string'||contentVersion!==book.contentVersion)throw fail('公版版本已变化，请重新选择段落',409);
 const section=book.sections.find(s=>s.paragraphs.some(p=>p.id===passageId));
 const passage=section?.paragraphs.find(p=>p.id===passageId);
 if(!passage||typeof passage.original!=='string'||!passage.original.trim())throw fail('没有可试读的公版段落',404);
 const query=new URLSearchParams({book:book.bookId,passage:passage.id,contentVersion:book.contentVersion,layer:'original'});
 return {schemaVersion:1,bookId:book.bookId,passageId:passage.id,contentVersion:book.contentVersion,chapterId:section.chapterId,readUrl:'/read?'+query};
}
