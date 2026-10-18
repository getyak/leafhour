export async function ensureShareFonts(fonts,{family='Leafhour Serif',size=48}={}){
  const fallback={family,upright:false,italic:false,fallback:true};
  if(!fonts||typeof fonts.load!=='function')return fallback;
  try{
    const [upright,italic]=await Promise.all([fonts.load('normal '+size+'px "'+family+'"'),fonts.load('italic '+size+'px "'+family+'"')]);
    return {family,upright:!!upright?.length,italic:!!italic?.length,fallback:!(upright?.length&&italic?.length)};
  }catch{return fallback;}
}
// Canvas has no automatic glyph-triggered CSS font loading. Request only the
// actual card's unique CJK characters before measuring a new preview.
export async function ensureShareCjkFonts(fonts,text){
  const characters=[...new Set([...String(text)].filter(character=>/[\u2e80-\ua4cf\uac00-\ud7af\uf900-\ufaff\ufe10-\ufe6f\uff00-\uffef\u{20000}-\u{323af}]/u.test(character)))].join('');
  if(!characters)return {needed:false,failed:false};
  if(typeof fonts?.load!=='function')return {needed:true,failed:true};
  try{const loaded=await fonts.load('normal 48px "Leafhour CJK"',characters);return {needed:true,failed:!loaded?.length};}catch{return {needed:true,failed:true};}
}
export async function prepareShareFonts(fonts,model,previous){
  const latin=previous||await ensureShareFonts(fonts);
  const text=[model.title,model.author,model.location,model.before,model.after,...model.blocks.flatMap(block=>[block.primary.text,block.primary.label,block.secondary?.text,block.secondary?.label])].filter(Boolean).join('\n');
  return {latin,cjk:await ensureShareCjkFonts(fonts,text)};
}
