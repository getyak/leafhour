// Reading activity is an instant. Upload receipt time is only a legacy fallback;
// importing/downloading a book never makes it a recently read book.
export const finiteReadingTimestamp=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))?Date.parse(value):null;
export function lastReadingTimestamp(book){
 const position=finiteReadingTimestamp(book?.resume?.observedAt)??finiteReadingTimestamp(book?.resume?.updatedAt);
 const values=[position,finiteReadingTimestamp(book?.journey?.lastReadAt),finiteReadingTimestamp(book?.lastReadAt)].filter(value=>value!==null);
 return values.length?Math.max(...values):null;
}
export const compareReadingRecency=(a,b)=>(lastReadingTimestamp(b)??-Infinity)-(lastReadingTimestamp(a)??-Infinity)||0;
