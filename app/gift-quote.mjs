// Client-side gift quotation helpers. The quotation is always rendered as
// text, bounded like the server selection, and an unknown or malformed receipt
// fails closed: the quote is dropped instead of forging an AI attribution.
export const GIFT_QUOTE_RECEIPT=/^[A-Za-z0-9_-]{32}$/;
export const GIFT_QUOTE_SELECTION_LABELS=Object.freeze({'ai-selected':'从这本书的原文中由 AI 选出','original-excerpt':'这本书的原文节选'});
const codePoints=text=>[...text];
const bounded=(value,max)=>typeof value==='string'&&value.length<=max;
const object=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
export function giftQuoteLabel(selection){return GIFT_QUOTE_SELECTION_LABELS[selection]||'';}
export function readGiftQuote(value,{requireReceipt=false}={}){
  if(!object(value))return null;
  const {receipt,selection,text,chapterTitle,passageId}=value;
  if(!Object.hasOwn(GIFT_QUOTE_SELECTION_LABELS,selection))return null;
  if(receipt!==undefined&&receipt!==null&&!GIFT_QUOTE_RECEIPT.test(receipt))return null;
  if(requireReceipt&&!GIFT_QUOTE_RECEIPT.test(receipt||''))return null;
  if(typeof text!=='string'||!text||text!==text.trim()||text.length>1000||codePoints(text).length>240)return null;
  if(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)||/<[a-z/!][^>]*>/i.test(text))return null;
  if(typeof text.isWellFormed==='function'&&!text.isWellFormed())return null;
  if(!bounded(chapterTitle,200)||!bounded(passageId,128))return null;
  return {receipt:GIFT_QUOTE_RECEIPT.test(receipt||'')?receipt:undefined,selection,text,chapterTitle:chapterTitle||'',passageId:passageId||''};
}
