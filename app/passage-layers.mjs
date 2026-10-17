const variantLabel=variant=>variant==='literal'?'直译':'意译';
const translatedText=(passage,variant)=>{const text=passage.translations?.[variant]?.text;return typeof text==='string'&&text.trim()?text:null;};

// Missing versions never borrow another translation or relabel the original.
export function visibleQuoteLanguage(passage,{mode,variant='interpretive',translationHidden=false}={},selectedLayer=null){
  if(selectedLayer==='en'||selectedLayer==='zh')return selectedLayer;
  return mode==='en'||translationHidden||!translatedText(passage,variant)?'en':'zh';
}
export function passagePresentation(passage,{mode='zh',variant='interpretive',sourceLanguage='en'}={}){
  const original={kind:'original',text:passage.original,lang:sourceLanguage==='zh'?'zh-Hans':sourceLanguage||'und',label:'原文',...(Array.isArray(passage.source?.lineBreaks)?{lineBreaks:passage.source.lineBreaks}:{})};
  if(mode==='en'||passage.kind==='source_heading')return {layers:[original],notice:null};
  const text=translatedText(passage,variant),label=variantLabel(variant);
  const translation=text?{kind:'translation',text,lang:'zh-Hans',label}:{kind:'missing',text:null,lang:null,label:label+' · 尚未翻译',message:'这份'+label+'尚未准备好。可继续阅读原文。'};
  if(mode==='parallel')return {layers:[original,translation],notice:null};
  return text?{layers:[translation],notice:null}:{layers:[{...original,fallback:true}],notice:label+'尚未翻译 · 显示原文'};
}

// A BR adds a visual line boundary without inserting characters into quoted text.
// Selection/highlight offsets continue to address the immutable original string.
const sourceLineation=new WeakMap();
// Render any highlight segment with its position in the immutable source string.
export function sourceLineatedNodes(node,text,start=0,document=node.ownerDocument){
 const children=[];let offset=0;
 for(const end of sourceLineation.get(node)||[]){
  if(end<=start||end>start+text.length)continue;
  children.push(document.createTextNode(text.slice(offset,end-start)),document.createElement('br'));offset=end-start;
 }
 if(offset<text.length||!children.length)children.push(document.createTextNode(text.slice(offset)));
 return children;
}
export function applySourceLineation(node,offsets,document=node.ownerDocument){
 const text=node.textContent;
 if(!Array.isArray(offsets)||!offsets.length||offsets.length>1000||offsets.some((n,i)=>!Number.isSafeInteger(n)||n<=0||n>=text.length||i>0&&n<=offsets[i-1]||/[\uD800-\uDBFF]/.test(text[n-1])&&/[\uDC00-\uDFFF]/.test(text[n])))return;
 sourceLineation.set(node,[...offsets]);node.replaceChildren(...sourceLineatedNodes(node,text,0,document));
}
