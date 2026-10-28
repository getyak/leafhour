import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createCanvas,loadImage,GlobalFonts} from '@napi-rs/canvas';
const root=process.cwd(),args=process.argv.slice(2),partial=args.includes('--partial');
const inputArg=args.indexOf('--originals');
if(inputArg<0||!args[inputArg+1])throw Error('Provide --originals /path/to/preserved/artwork');
const input=path.resolve(args[inputArg+1]);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const plan=JSON.parse(await fs.readFile(path.join(root,'docs/design/2026-10-28-book-covers/prompts.json'),'utf8'));
const catalog=JSON.parse(await fs.readFile(path.join(root,'catalog/manifest.json'),'utf8'));
if(JSON.stringify(plan.entries.map(r=>r.id).sort())!==JSON.stringify(catalog.map(r=>r.id).sort()))throw Error('Prompt and public catalog IDs differ');
const out=path.join(root,'app/book-covers');await fs.mkdir(out,{recursive:true});
const map={},entries=[],missing=[];
for(const row of plan.entries){
 const descriptor={src:'/book-covers/'+row.slug+'-640.webp?v=000000000000',srcSet:'/book-covers/'+row.slug+'-320.webp?v=000000000000 320w, /book-covers/'+row.slug+'-640.webp?v=000000000000 640w',ink:row.ink,paper:row.paper};
 map[row.id]=descriptor;
 let original;
 try{original=await fs.readFile(path.join(input,row.slug+'.png'));}catch(error){if(error.code!=='ENOENT')throw error;missing.push(row.id);continue;}
 const image=await loadImage(original);
 if(Math.abs(image.width/image.height-2/3)>.001)throw Error('Unexpected artwork aspect ratio '+row.id);
 const variants=[];
 for(const width of [320,640]){
  const height=width*1.5,canvas=createCanvas(width,height),ctx=canvas.getContext('2d');ctx.drawImage(image,0,0,width,height);
  const bytes=await canvas.encode('webp',82),hash=sha(bytes),file=row.slug+'-'+width+'.webp';
  if(bytes.length>(width===320?100000:260000))throw Error('Cover exceeds byte budget '+row.id);
  await fs.writeFile(path.join(out,file),bytes);
  variants.push({url:'/book-covers/'+file+'?v='+hash.slice(0,12),width,height,bytes:bytes.length,sha256:hash});
 }
 descriptor.src=variants[1].url;descriptor.srcSet=variants.map(v=>v.url+' '+v.width+'w').join(', ');
 entries.push({id:row.id,title:row.title,originalSha256:sha(original),originalWidth:image.width,originalHeight:image.height,origin:row.approvedSample?'user-approved-sample':'built-in-image_gen',approvedSample:row.approvedSample,variants});
}
if(missing.length&&!partial)throw Error('Cannot export incomplete cover set: '+missing.join(', '));
await fs.writeFile(path.join(root,'app/book-cover-artwork.mjs'),'// Original Leafhour public-edition artwork. Exact IDs; native text is localized separately.\nexport const bookCoverArtwork = '+JSON.stringify(map,null,2)+';\n');
const manifest={version:1,createdAt:'2026-10-28',complete:missing.length===0,expected:plan.entries.length,mode:'built-in-image_gen',promptSet:'docs/design/2026-10-28-book-covers/prompts.json',entries};
await fs.writeFile(path.join(root,'catalog/book-cover-artwork.json'),JSON.stringify(manifest,null,2)+'\n');
const releasePath=path.join(root,'release-files.json'),release=JSON.parse(await fs.readFile(releasePath,'utf8'));
const files=['app/book-cover-artwork.mjs','app/book-cover-labels.mjs','app/book-cover-ui.mjs','app/book-binding.css','catalog/book-cover-artwork.json','tests/book-cover-assets.test.mjs','tests/book-cover-localization.test.mjs','tools/export-book-covers.mjs','tools/prepare-book-cover-prompts.mjs'];
for(const entry of entries)for(const asset of entry.variants)files.push('app'+new URL(asset.url,'https://leafhour.com').pathname);
await fs.writeFile(releasePath,JSON.stringify([...new Set([...release,...files])],null,2)+'\n');
if(args.includes('--contact-sheets')){
 const evidenceArg=args.indexOf('--evidence'),evidence=evidenceArg<0?path.join(input,'../contact-sheets'):path.resolve(args[evidenceArg+1]);await fs.mkdir(evidence,{recursive:true});
 for(const font of ['/System/Library/Fonts/Supplemental/Songti.ttc'])try{GlobalFonts.registerFromPath(font,'Cover Review')}catch{}
 for(let page=0;page<Math.ceil(entries.length/16);page++){
  const batch=entries.slice(page*16,page*16+16),board=createCanvas(1440,1980),ctx=board.getContext('2d');ctx.fillStyle='#efede7';ctx.fillRect(0,0,1440,1980);ctx.fillStyle='#26372e';ctx.font='24px "Cover Review",serif';ctx.fillText('Leafhour / '+(page*16+1)+'–'+(page*16+batch.length),40,44);
  for(let i=0;i<batch.length;i++){
   const entry=batch[i],x=40+(i%4)*350,y=80+Math.floor(i/4)*470;
   const artwork=await loadImage(path.join(input,plan.entries.find(r=>r.id===entry.id).slug+'.png'));
   ctx.drawImage(artwork,x,y,264,396);ctx.fillStyle='#27382e';ctx.font='18px "Cover Review",serif';ctx.fillText(entry.title.slice(0,16),x,y+425);ctx.font='12px sans-serif';ctx.fillText(entry.id.replace('gutenberg-','').slice(0,44),x,y+448);
  }
  await fs.writeFile(path.join(evidence,'artwork-contact-'+(page+1)+'.png'),board.toBuffer('image/png'));
 }
}
console.log(JSON.stringify({saved:entries.length,total:plan.entries.length,missing:missing.length,complete:manifest.complete,webpBytes:entries.flatMap(e=>e.variants).reduce((n,a)=>n+a.bytes,0)}));
