// A small Chinese/Latin heuristic, not a claim that multilingual books have one language.
export function inferSourceLanguage(text){
  const han=(text.match(/\p{Script=Han}/gu)||[]).length,latinWords=(text.match(/[A-Za-z]+/g)||[]).length;
  return han>0&&han>=latinWords?'zh':'en';
}
export function chineseOriginalOnly(book){return book.sourceLanguage==='zh'&&!book.reading?.hasTranslations&&!book.sections.some(s=>s.paragraphs.some(p=>Object.keys(p.translations||{}).length));}
