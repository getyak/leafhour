export const chineseTrialUrl=book=>'/read?'+new URLSearchParams({book:book.bookId,sample:'zh'});
export function chineseSampleEntry(book,query){
  if(query.get('book')!==book.bookId||query.get('sample')!=='zh'||book.visibility!=='public'||!book.chineseSample)return null;
  return {...book.readingStart,mode:'zh',variant:'interpretive',offset:160};
}
export const chineseSampleNotice=book=>book.chineseSample?'中文试读 · '+book.chineseSample.paragraphs+' 段':'';
export const translationDisclosure=book=>book.chineseSample?'本书开篇 '+book.chineseSample.paragraphs+' 段的直译与意译由 '+book.chineseSample.translator+' 分别编写，均为 AI 草稿，尚未人工审定。试读译文采用 CC0-1.0，可随时核对原文；其余正文仅有英文。英文底本的出处与许可见书房中的来源链接。':'译文按段独立保存，未译内容保留原文。AI 生成结果标为草稿，可以核对原文；不会把缺失译文补成另一种译法。';

// UI-only descriptors. Sample content, translator attribution and the number of
// prepared passages retain their source values independently of UI language.
export const sampleNoticeMessage=book=>book.chineseSample?{id:'sample.notice',params:{count:book.chineseSample.paragraphs}}:null;
export function translationDisclosureMessage(book){
  // A personal translation can override a public sample. Never infer its
  // authorship or review state from the original sample's summary alone.
  const translations=book.sections?.flatMap(section=>section.paragraphs||[]).flatMap(passage=>Object.values(passage.translations||{})).filter(value=>typeof value?.text==='string'&&value.text.trim());
  const sample=book.chineseSample;
  const unchangedSample=sample&&(!translations||translations.length===sample.paragraphs*2&&translations.every(value=>value.status==='draft'&&value.origin==='ai'&&value.translator===sample.translator&&value.license==='CC0-1.0'));
  if(unchangedSample)return {id:'sample.disclosure',params:{count:sample.paragraphs,translator:sample.translator}};
  if(!translations?.length)return {id:'sample.disclosureNone'};
  const reviewed=translations.filter(value=>value.status==='reviewed').length,draft=translations.filter(value=>value.status==='draft').length;
  const facts=key=>{const values=translations.map(value=>value[key]).filter(value=>typeof value==='string'&&value.trim());return [[...new Set(values)].join(' · ')||'—',translations.length-values.length];};
  const [translators,uncredited]=facts('translator'),[models]=facts('model'),[licenses,unlicensed]=facts('license');
  return {id:'sample.disclosureMetadata',params:{count:translations.length,reviewed,draft,unknown:translations.length-reviewed-draft,ai:translations.filter(value=>value.origin==='ai').length,translators,uncredited,models,licenses,unlicensed}};
}
