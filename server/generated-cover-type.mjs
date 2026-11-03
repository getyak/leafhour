import {readFile} from 'node:fs/promises';
import {createCanvas,loadImage,GlobalFonts} from '@napi-rs/canvas';

const fontRoot=new URL('../app/fonts/document-export/',import.meta.url);
const manifest=JSON.parse(await readFile(new URL('manifest.json',fontRoot),'utf8'));
const registered=new Set();
const fontIndex=character=>Math.max(0,manifest.fonts.findIndex(font=>font.ranges.some(([a,b])=>character.codePointAt(0)>=a&&character.codePointAt(0)<=b)));
const fontFor=character=>'LeafhourCover'+fontIndex(character);
const value=text=>String(text||'').replace(/[\u0000-\u001f]/g,' ').trim().slice(0,180);
export async function typesetGeneratedCover(bytes,book){
 const image=await loadImage(bytes),canvas=createCanvas(image.width,image.height),ctx=canvas.getContext('2d'),scale=canvas.width/640;
 ctx.drawImage(image,0,0);ctx.scale(scale,scale);
 const height=canvas.height/scale,title=value(book.title?.zh||book.title?.en||book.title),author=value(book.author),maxWidth=536;
 // Load only the checked-in subsets used here; no host fonts or new dependency.
 await Promise.all([...new Set([...(title+author+'leafhour')].map(fontIndex))].map(async key=>{if(!registered.has(key)){GlobalFonts.register(await readFile(new URL(manifest.fonts[key].file,fontRoot)),'LeafhourCover'+key);registered.add(key);}}));
 const textWidth=(text,size)=>[...text].reduce((width,char)=>{ctx.font=size+'px "'+fontFor(char)+'"';return width+ctx.measureText(char).width;},0);
 const linesFor=size=>{
  const rows=[''];for(const char of title){let last=rows.length-1;if(rows[last]&&textWidth(rows[last]+char,size)>maxWidth){rows.push(char);}else rows[last]+=char;}return rows;
 };
 let size=64,lines=linesFor(size);while(lines.length>3&&size>16){size-=2;lines=linesFor(size);}
 // Fade into the artwork's own paper instead of imposing a hard panel edge.
 const field=Math.max(height*.34,82+lines.length*size*1.18+(author?36:0));
 const pixel=ctx.getImageData(0,0,1,1).data,paper=pixel[0]+pixel[1]+pixel[2]>510?[pixel[0],pixel[1],pixel[2]]:[240,236,226],wash=ctx.createLinearGradient(0,0,0,Math.min(height*.6,field));
 wash.addColorStop(0,'rgba('+paper.join(',')+',1)');wash.addColorStop(.65,'rgba('+paper.join(',')+',.94)');wash.addColorStop(1,'rgba('+paper.join(',')+',0)');
 ctx.fillStyle=wash;ctx.fillRect(0,0,640,Math.min(height*.6,field));ctx.fillStyle='#243b32';ctx.textBaseline='top';
 const draw=(text,x,y,fontSize)=>{for(const char of text){ctx.font=fontSize+'px "'+fontFor(char)+'"';ctx.fillText(char,x,y);x+=ctx.measureText(char).width;}};
 draw('leafhour',52,30,18);lines.forEach((line,index)=>draw(line,52,78+index*size*1.18,size));
 if(author){let authorSize=20;while(textWidth(author,authorSize)>maxWidth&&authorSize>10)authorSize--;draw(author,52,88+lines.length*size*1.18,authorSize);}
 return canvas.encode('webp',84);
}
