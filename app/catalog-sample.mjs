export const catalogReadingMode=book=>book.chineseSample?'zh':'en';
export const chineseTrialUrl=book=>'/read?'+new URLSearchParams({book:book.bookId,sample:'zh'});
export function chineseSampleEntry(book,query){
  if(query.get('book')!==book.bookId||query.get('sample')!=='zh'||book.visibility!=='public'||!book.chineseSample)return null;
  return {...book.readingStart,mode:'zh',variant:'interpretive',offset:160};
}
export const chineseSampleNotice=book=>book.chineseSample?'已备开篇 '+book.chineseSample.paragraphs+' 段中文直译与意译 · AI 草稿，可核对原文。其余正文保留英文，尚未翻译。':'';
