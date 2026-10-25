import {PDFDocument,rgb} from './vendor/pdf-lib.mjs';
import fontkit from './vendor/pdf-fontkit.mjs';

const asset=async file=>{const response=await fetch('/'+file);if(!response.ok)throw Error('PDF font unavailable');return new Uint8Array(await response.arrayBuffer());};
// Embedded, static OFL fonts are loaded only on an explicit PDF download.
// No book text leaves the browser; unsupported glyphs fail visibly.
export async function documentPdf(document,{readAsset=asset,assertCurrent=()=>{},onProgress=()=>{},yieldControl=()=>new Promise(r=>setTimeout(r,0))}={}){
 assertCurrent();const pdf=await PDFDocument.create();pdf.registerFontkit(fontkit);pdf.setTitle(document.title);pdf.setProducer('Leafhour');pdf.setCreator('Leafhour local export');
 const manifest=JSON.parse(new TextDecoder().decode(await readAsset('fonts/document-export/manifest.json')));assertCurrent();
 const chars=new Set(document.blocks.flatMap(b=>Array.from(b.text.replace(/[\n\r\t]/g,' ')))),fonts=[],byChar=new Map();
 for(const entry of manifest.fonts){
  const ranges=entry.ranges.map(([start,end])=>[start,end]);
  const needed=[...chars].filter(c=>!byChar.has(c)&&ranges.some(([a,b])=>c.codePointAt(0)>=a&&c.codePointAt(0)<=b));if(!needed.length)continue;
  const bytes=await readAsset('fonts/document-export/'+entry.file);assertCurrent();const font=await pdf.embedFont(bytes,{subset:true}),supported=new Set(font.getCharacterSet());fonts.push(font);
  for(const c of needed)if(supported.has(c.codePointAt(0)))byChar.set(c,font);
  await yieldControl();assertCurrent();
 }
 for(const c of chars)if(!byChar.has(c))throw Object.assign(Error('PDF font does not contain '+c),{code:'PDF_GLYPH_UNAVAILABLE'});
 let page,y,pageNumber=0,lineCount=0;const width=499,margin=48;
 const newPage=()=>{page=pdf.addPage([595.28,841.89]);y=787;pageNumber++;};newPage();
 const drawLine=(line,size)=>{
  if(y<size+48)newPage();let x=margin,run='',held=null;
  const flush=()=>{if(!run)return;page.drawText(run,{x,y,size,font:held,color:rgb(.12,.14,.13)});x+=held.widthOfTextAtSize(run,size);run='';};
  for(const c of line){const f=byChar.get(c);if(f!==held){flush();held=f;}run+=c;}flush();y-=size*1.65;lineCount++;
 };
 for(const [index,block]of document.blocks.entries()){
  assertCurrent();const size=block.kind==='heading'?22:block.kind==='subheading'?17:block.kind==='paragraph'?11.5:9;
  for(const raw of block.text.replace(/\r\n?/g,'\n').replace(/\t/g,'    ').split('\n')){
   let line='',lineWidth=0;
   // Tokenize Latin words and individual CJK glyphs. Long URLs/words wrap at
   // code points, never at UTF-16 halves, and cannot disappear off the page.
   for(const token of raw.match(/[^\s\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]+|\s+|[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu)||[]){
    const tokenWidth=[...token].reduce((n,c)=>n+byChar.get(c).widthOfTextAtSize(c,size),0);
    if(line&&lineWidth+tokenWidth>width){drawLine(line,size);line='';lineWidth=0;}
    for(const c of token){const w=byChar.get(c).widthOfTextAtSize(c,size);if(line&&lineWidth+w>width){drawLine(line,size);line='';lineWidth=0;}line+=c;lineWidth+=w;}
   }
   if(line)drawLine(line,size);else y-=size;
  }
  y-=block.kind==='paragraph'?9:6;
  if(index%16===0){onProgress({blocks:index+1,total:document.blocks.length,pages:pageNumber});await yieldControl();assertCurrent();}
 }
 if(!lineCount)throw Error('No PDF content');
 assertCurrent();const bytes=await pdf.save();assertCurrent();return bytes;
}
