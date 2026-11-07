// Only the public resolver's exact, source-bound original locator may leave the app.
export function verifiedExcerptUrl(receipt,snapshot){
 if(receipt?.schemaVersion!==1||receipt.bookId!==snapshot.bookId||receipt.contentVersion!==snapshot.contentVersion||receipt.passageId!==snapshot.parts?.[0]?.passageId||receipt.chapterId!==snapshot.chapterId)return null;
 if(typeof receipt.readUrl!=='string'||!receipt.readUrl.startsWith('/read?'))return null;
 const url=new URL(receipt.readUrl,'https://leafhour.com');
 if(url.origin!=='https://leafhour.com'||url.pathname!=='/read'||url.hash||url.username||url.password)return null;
 const expected={book:snapshot.bookId,passage:snapshot.parts[0].passageId,contentVersion:snapshot.contentVersion,layer:'original'};
 if([...url.searchParams].length!==4||Object.entries(expected).some(([k,v])=>url.searchParams.getAll(k).length!==1||url.searchParams.get(k)!==v))return null;
 return url.href;
}
