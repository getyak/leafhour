import {publicGiftSender} from './gift-identity.mjs';
import {readGiftQuote} from './gift-quote.mjs';
// The local preview carries stationery metadata, never a reading package or token.
const object=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const text=(value,max)=>typeof value==='string'?value.slice(0,max).replace(/[\uD800-\uDBFF]$/u,''):'';
export function createGiftPreview(book,user,draft={}, {now=new Date()}={}){
  // A preview quotation needs its prepared receipt: without one it fails closed
  // instead of inventing an AI attribution for the recipient view.
  const quote=readGiftQuote(draft.quote,{requireReceipt:true});
  return {kind:'marginalia-gift-preview',version:1,gift:{bookId:text(book.bookId,200),title:{zh:text(book.title?.zh,300),en:text(book.title?.en,300)},author:text(book.author,300),description:text(book.description,2000),sender:publicGiftSender(user),recipient:text(draft.recipient,80),message:text(draft.message,500),includeTranslations:draft.includeTranslations!==false,createdAt:now.toISOString(),publicRead:book.visibility==='public',...(quote?{quote}:{})}};
}
export function readGiftPreview(event,{origin,source}){
  const data=event?.data,gift=data?.gift;
  if(!source||event.origin!==origin||event.source!==source||data?.kind!=='marginalia-gift-preview'||data.version!==1||!object(gift)||!object(gift.title)||typeof gift.bookId!=='string'||!gift.bookId||gift.bookId.length>200||typeof gift.createdAt!=='string'||gift.createdAt.length>40||!Number.isFinite(Date.parse(gift.createdAt)))return null;
  for(const [value,limit]of [[gift.title.zh,300],[gift.title.en,300],[gift.author,300],[gift.description,2000],[gift.sender,80],[gift.recipient,80],[gift.message,500]])if(value!==undefined&&(typeof value!=='string'||value.length>limit))return null;
  if(!gift.title.zh&&!gift.title.en)return null;
  const quote=readGiftQuote(gift.quote,{requireReceipt:true});
  return {bookId:gift.bookId,title:{zh:text(gift.title.zh,300),en:text(gift.title.en,300)},author:text(gift.author,300),description:text(gift.description,2000),sender:text(gift.sender,80)||'一位读者',recipient:text(gift.recipient,80),message:text(gift.message,500),includeTranslations:gift.includeTranslations===true,createdAt:gift.createdAt,publicRead:gift.publicRead===true,...(quote?{quote}:{})};
}
