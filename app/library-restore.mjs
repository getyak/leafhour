// The full backup is validated before this generator is used. Every batch remains importable.
export function* libraryRestoreBatches(entry){
  const book={...entry.book,sections:entry.book.sections.map(s=>({...s,paragraphs:s.paragraphs.map(p=>({...p,translations:{}}))}))};
  const empty={...entry.records,comments:[],questions:[],readingSessions:[],position:null};delete empty.readingGoal;if(entry.records.schemaVersion===3||entry.records.readingMilestones)empty.readingMilestones=[];
  yield {book,records:empty};
  for(const key of ['comments','questions','readingSessions','readingMilestones'])for(let i=0;i<(entry.records[key]?.length||0);i+=50)yield {book,records:{...empty,[key]:entry.records[key].slice(i,i+50)}};
  const translated=entry.book.sections.flatMap(s=>s.paragraphs).filter(p=>Object.keys(p.translations||{}).length);
  for(let i=0;i<translated.length;i+=20){const updates=new Map(translated.slice(i,i+20).map(p=>[p.id,p.translations]));yield {book:{...book,sections:book.sections.map(s=>({...s,paragraphs:s.paragraphs.map(p=>({...p,translations:updates.get(p.id)||{}}))}))},records:empty};}
  if(entry.records.position||entry.records.readingGoal)yield {book,records:{...empty,...(entry.records.position?{position:entry.records.position}:{}),...(entry.records.readingGoal?{readingGoal:entry.records.readingGoal}:{})}};
}
