const invalid=()=>Error('正文传输未完整通过校验，请重新载入；原文件仍保留。');
export async function assembleBookTransfer(manifest,readPart){
 if(manifest?.kind!=='leafhour-book-transfer-v1'||typeof manifest.bookId!=='string'||typeof manifest.contentVersion!=='string'||!/^[a-f0-9]{64}$/.test(manifest.snapshot)||!Number.isSafeInteger(manifest.totalBytes)||manifest.totalBytes<1||manifest.totalBytes>96*1024*1024||manifest.partBytes!==1048576)throw invalid();
 const bytes=new Uint8Array(manifest.totalBytes);let offset=0;
 while(offset<bytes.length){
  const part=await readPart(offset,manifest.snapshot),size=Math.min(manifest.partBytes,bytes.length-offset),end=offset+size;
  if(part?.kind!=='leafhour-book-part-v1'||part.snapshot!==manifest.snapshot||part.totalBytes!==bytes.length||part.offset!==offset||part.nextOffset!==(end<bytes.length?end:null)||typeof part.data!=='string'||part.data.length>Math.ceil(size/3)*4||!/^[A-Za-z0-9+/]*={0,2}$/.test(part.data))throw invalid();
  let decoded;try{decoded=atob(part.data);}catch{throw invalid();}if(decoded.length!==size)throw invalid();
  for(let i=0;i<size;i++)bytes[offset+i]=decoded.charCodeAt(i);offset=end;
 }
 const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');if(hash!==manifest.snapshot)throw invalid();
 const book=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));if(book.bookId!==manifest.bookId||book.contentVersion!==manifest.contentVersion)throw invalid();return book;
}
