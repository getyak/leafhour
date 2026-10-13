const variantLabel=variant=>variant==='literal'?'直译':'意译';
const translatedText=(passage,variant)=>{const text=passage.translations?.[variant]?.text;return typeof text==='string'&&text.trim()?text:null;};

// Missing versions never borrow another translation or relabel the original.
export function visibleQuoteLanguage(passage,{mode,variant='interpretive'}={},selectedLayer=null){
  if(selectedLayer==='en'||selectedLayer==='zh')return selectedLayer;
  return mode==='en'||!translatedText(passage,variant)?'en':'zh';
}
export function passagePresentation(passage,{mode='zh',variant='interpretive',sourceLanguage='en'}={}){
  const original={kind:'original',text:passage.original,lang:sourceLanguage==='zh'?'zh-Hans':'en',label:'原文'};
  if(mode==='en')return {layers:[original],notice:null};
  const text=translatedText(passage,variant),label=variantLabel(variant);
  const translation=text?{kind:'translation',text,lang:'zh-Hans',label}:{kind:'missing',text:null,lang:null,label:label+' · 尚未翻译',message:'这份'+label+'尚未准备好。可继续阅读原文。'};
  if(mode==='parallel')return {layers:[original,translation],notice:null};
  return text?{layers:[translation],notice:null}:{layers:[{...original,fallback:true}],notice:label+'尚未翻译 · 显示原文'};
}
