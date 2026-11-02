// Content languages are independent of the interface locale. Chinese keeps
// its legacy pair; other targets are retained in translationsByLanguage.
export function contentLanguage(value){
  return typeof value==='string'&&/^[a-z]{2,3}(?:[-_][a-z0-9]{2,8})*$/i.test(value)?value.toLowerCase().split(/[-_]/)[0]:'unknown';
}

export function bookReadingLanguages(book,overlay={}){
  const sourceLanguage=contentLanguage(book.sourceLanguage),languages=new Set();
  let translatedParagraphs=0,total=0;
  for(const section of book.sections||[])for(const passage of section.paragraphs||[]){
    if(typeof passage.original!=='string'||!passage.original.trim())continue;
    total++;
    const saved=Object.hasOwn(overlay,passage.id)?overlay[passage.id]:null;
    const value=saved?.contentVersion===book.contentVersion?saved:passage;
    let available=false;
    for(const [language,pair]of Object.entries({zh:value.translations,...value.translationsByLanguage})){
      const present=['literal','interpretive'].some(variant=>{const t=pair?.[variant];return typeof t?.text==='string'&&!!t.text.trim()&&(!t.sourceVersion||t.sourceVersion===book.contentVersion);});
      if(present&&language!==sourceLanguage){languages.add(language);available=true;}
    }
    if(available)translatedParagraphs++;
  }
  return {sourceLanguage,translationLanguages:[...languages],supportsParallel:translatedParagraphs>0,translatedParagraphs,translationCoverage:!translatedParagraphs?'none':translatedParagraphs===total?'complete':'partial'};
}

export function shelfReadingLanguages(book){
  return [...new Set([contentLanguage(book.sourceLanguage),...(Array.isArray(book.translationLanguages)?book.translationLanguages.map(contentLanguage).filter(language=>language!=='unknown'):[])])];
}

export function matchesReadingLanguage(book,{language='all',form='all'}={}){
  const source=contentLanguage(book.sourceLanguage),translations=shelfReadingLanguages(book).filter(value=>value!==source&&value!=='unknown');
  if(form==='translated')return translations.length>0&&(language==='all'||translations.includes(language));
  if(form==='bilingual'&&book.supportsParallel!==true)return false;
  if(form==='original')return language==='all'||source===language;
  return language==='all'||shelfReadingLanguages(book).includes(language);
}
