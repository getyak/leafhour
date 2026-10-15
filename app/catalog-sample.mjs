export const chineseTrialUrl=book=>'/read?'+new URLSearchParams({book:book.bookId,sample:'zh'});
export function chineseSampleEntry(book,query){
  if(query.get('book')!==book.bookId||query.get('sample')!=='zh'||book.visibility!=='public'||!book.chineseSample)return null;
  return {...book.readingStart,mode:'zh',variant:'interpretive',offset:160};
}
export const chineseSampleNotice=book=>book.chineseSample?'已备开篇 '+book.chineseSample.paragraphs+' 段中文直译与意译 · AI 草稿，可核对原文。其余正文保留英文，尚未翻译。':'';
export const translationDisclosure=book=>book.chineseSample?'本书开篇 '+book.chineseSample.paragraphs+' 段的直译与意译由 '+book.chineseSample.translator+' 分别编写，均为 AI 草稿，尚未人工审定。试读译文采用 CC0-1.0，可随时核对原文；其余正文仅有英文。英文底本的出处与许可见书房中的来源链接。':'译文按段独立保存，未译内容保留原文。AI 生成结果标为草稿，可以核对原文；不会把缺失译文补成另一种译法。';
