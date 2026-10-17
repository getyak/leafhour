import {mergeHighlights} from './highlights.mjs';
import {personalRecordRevision} from './personal-records.mjs';
export function startReadingLoad({readBook,readRecords}) {
  let settled;
  const book=readBook();
  const records=readRecords().then(value=>{settled=value;return value;},()=>{settled=null;return null;});
  return {book,records,peekRecords:()=>settled};
}

// A slow read must not erase notes acknowledged while it was in flight.
export function mergeLoadedReadingRecords(fresh,current) {
  const result={...fresh};
  result.highlights=mergeHighlights(fresh.highlights||[],current?.highlights||[]);
  for(const field of ['comments','questions','readingSessions','readingMilestones']){
    const rows=new Map((fresh[field]||[]).map(row=>[row.id,row]));
    for(const row of current?.[field]||[])if(!rows.has(row.id)||['comments','questions'].includes(field)&&personalRecordRevision(row)>personalRecordRevision(rows.get(row.id)))rows.set(row.id,row);
    result[field]=[...rows.values()];
  }
  return result;
}
