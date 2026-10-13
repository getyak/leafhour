// Published excerpts belong to the bundled public edition, never to an uploaded book.
export function applyCatalogSample(book,sample){
  if(book.visibility!=='public'||sample.bookId!==book.bookId||sample.contentVersion!==book.contentVersion)return book;
  const rows=book.sections.flatMap(s=>s.paragraphs),start=rows.findIndex(p=>p.id===book.readingStart?.passageId);
  if(sample.schemaVersion!==1||sample.language!=='zh'||sample.license!=='CC0-1.0'||start<0||!Array.isArray(sample.passages)||!sample.passages.length||sample.passages.length>12)throw Error('Invalid public Chinese sample: '+book.bookId);
  for(const [i,entry]of sample.passages.entries()){
    if(entry.id!==rows[start+i]?.id||rows[start+i].kind==='source_heading')throw Error('Chinese sample does not match the original: '+book.bookId);
    for(const variant of ['literal','interpretive']){
      const draft=entry.translations?.[variant];
      if(!draft||typeof draft.text!=='string'||!draft.text.trim()||draft.text.length>12000||draft.variant!==variant||draft.status!=='draft'||draft.origin!=='ai'||!draft.translator||!draft.model||draft.license!==sample.license||draft.sourceVersion!==book.contentVersion||!Number.isFinite(Date.parse(draft.createdAt)))throw Error('Invalid independent Chinese draft: '+entry.id);
    }
  }
  const overlays=new Map(sample.passages.map(p=>[p.id,p.translations]));
  return {...book,chineseSample:{paragraphs:sample.passages.length,startPassageId:sample.passages[0].id,endPassageId:sample.passages.at(-1).id,chapterId:book.readingStart.chapterId,status:'draft',origin:'ai',translator:sample.passages[0].translations.literal.translator,license:sample.license},sections:book.sections.map(s=>({...s,paragraphs:s.paragraphs.map(p=>({...p,translations:structuredClone(overlays.get(p.id)||p.translations)}))}))};
}
