// Verified public editorial excerpt, never a claim about the visitor's shelf.
export const libraryArrivalQuote=Object.freeze({bookId:'gutenberg-alice',title:'爱丽丝梦游仙境',author:'刘易斯·卡罗尔',chapter:'第一章',sourceUrl:'https://www.gutenberg.org/ebooks/11',original:'“and what is the use of a book,” thought Alice “without pictures or conversations?”',translation:'书里连图画和对话都没有，读它有什么意思？',variant:'interpretive',status:'draft',passageId:'01b38ea4c710a84b-p00008',contentVersion:'01b38ea4c710a84bc18d0bd41271a5a1a92b94e97b2812f4dece97d4a694725e'});
export function libraryArrivalPresentation(locale){
 const chinese=locale==='zh-Hans'||locale==='zh-Hant',traditional=locale==='zh-Hant';
 return {text:chinese?'“'+(traditional?'書裡連圖畫和對話都沒有，讀它有什麼意思？':libraryArrivalQuote.translation)+'”':libraryArrivalQuote.original,lang:chinese?locale:'en',original:chinese?libraryArrivalQuote.original:'',source:chinese?(traditional?'劉易斯·卡羅爾 《愛麗絲夢遊仙境》 · 第一章':libraryArrivalQuote.author+' 《'+libraryArrivalQuote.title+'》 · '+libraryArrivalQuote.chapter):'Lewis Carroll · Alice’s Adventures in Wonderland · Chapter I',provenanceId:'arrival.provenance.'+(chinese?'interpretive':'original')};
}
// A waiting screen carries one short source sentence, without paraphrasing it.
export function arrivalExcerpt(original){
 const text=typeof original==='string'?original.trim():'';
 for(const match of text.matchAll(/[。！？](?:["'”’])?|[.!?](?:["'”’])?(?=\s|$)/gu)){
  const end=match.index+match[0].length;
  if(end>160)break;
  if(end>=8&&!/\b(?:Mr|Mrs|Ms|Dr|Prof|St)\.$/.test(text.slice(0,end)))return text.slice(0,end);
 }
 if([...text].length<=160)return text;
 const prefix=[...text].slice(0,160).join(''),space=prefix.lastIndexOf(' ');
 return (space>=80?prefix.slice(0,space):prefix).trimEnd()+'…';
}
