import {personCopy} from './people-copy.mjs';
export const displayPersonLocator=value=>String(value||'').split(/;\s*(?:bookId|chapterId|passageId|catalogSha256)=/)[0];
const language=(map,locale)=>typeof map==='string'?map:map?.[locale]||map?.en||Object.values(map||{}).find(v=>typeof v==='string')||'';
export function publicPersonShare(person,{excerptId,locale='en',publicUrl,previewOnly=false}={}){
  if(person?.visibility!=='public')return null;
  let url;try{url=new URL(publicUrl);}catch{if(!previewOnly)return null;url=null;}
  if(url&&(url.origin!=='https://leafhour.com'||!/^\/(?:people|p)\/[A-Za-z0-9_-]+$/.test(url.pathname)||[...url.searchParams.keys()].some(k=>!['ui','work'].includes(k))))return null;
  if(url){for(const key of ['ui','work'])if(url.searchParams.getAll(key).length>1)return null;const ui=url.searchParams.get('ui'),work=url.searchParams.get('work');if(ui&&!['en','zh-Hans','zh-Hant','ja'].includes(ui)||work&&!person.works?.some(item=>item.id===work))return null;}
  const excerpt=excerptId?person.excerpts?.find(item=>item.id===excerptId):null;if(excerptId&&!excerpt)return null;
  const work=person.works?.find(item=>item.id===excerpt?.workId);
  return {name:language(person.names,locale)||person.originalName,originalName:person.originalName||'',years:[person.birth?.value,person.death?.value].filter(Boolean).join('–'),text:excerpt?.text||language(person.intro,locale),textLanguage:excerpt?.language||locale,work:language(work?.title,locale)||work?.originalTitle||'',locator:displayPersonLocator(excerpt?.locator),url:url?.href||'',portrait:person.portrait?{url:person.portrait.url,credit:person.portrait.credit,license:person.portrait.license}:null,source:person.sources?.find(s=>s.id===excerpt?.sourceId)||null};
}
// Each line keeps the exact source slice. No ellipsis, truncation or hidden character loss.
export function wrapShareText(text,{width,size,measure}){
  const segments=typeof Intl.Segmenter==='function'?[...new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(text)].map(item=>({text:item.segment,start:item.index})):[...text].reduce((items,char)=>{items.push({text:char,start:items.length?items.at(-1).start+items.at(-1).text.length:0});return items;},[]);
  const position=index=>index<segments.length?segments[index].start:text.length;
  const lines=[];let index=0;
  while(index<segments.length){const source=position(index);let end=index,lastBreak=null;
    while(end<segments.length){const char=segments[end].text,next=end+1;if(char.includes('\n')){end=next;break;}if(measure(text.slice(source,position(next)),size)>width&&end>index){if(lastBreak!==null)end=lastBreak;break;}end=next;if(/\s/.test(char))lastBreak=end;}
    if(end===index)end=index+1;const stop=position(end),slice=text.slice(source,stop);lines.push({text:slice,width:measure(slice.replace(/\n$/,''),size),start:source,end:stop});index=end;
  }
  return lines;
}
export function layoutPersonShare({person,excerpt=null,locale='en',ratio='portrait',measure=(text,size)=>[...text].length*size*.56,publicUrl,previewOnly=false,includePortrait=false}={}){
  const data=publicPersonShare(person,{excerptId:excerpt?.id,locale,publicUrl:previewOnly?null:publicUrl||'https://leafhour.com/people/'+person.id,previewOnly});if(!data)throw Error('Invalid public share');
  const width=1080,height=ratio==='square'?1080:1440,padding=72;
  let nameSize=76,nameLines=wrapShareText(data.name,{width:width-padding*2,size:nameSize,measure});while(nameLines.length>3&&nameSize>24){nameSize-=4;nameLines=wrapShareText(data.name,{width:width-padding*2,size:nameSize,measure});}
  const nameHeight=nameLines.length*nameSize*1.1,baseTop=Math.ceil(152+nameHeight+(data.originalName!==data.name?45:0)+50),portrait=includePortrait?{x:padding,y:baseTop,width:width-padding*2,height:ratio==='square'?210:420}:null,bodyTop=baseTop+(portrait?portrait.height+38:0),bodyBottom=height-154,size=42,lineHeight=65;
  if(bodyTop+lineHeight>bodyBottom)throw Error('Share heading exceeds available space');
  const lines=wrapShareText(data.text,{width:width-padding*2,size,measure}),perPage=Math.max(1,Math.floor((bodyBottom-bodyTop)/lineHeight)),pages=[];
  for(let start=0;start<Math.max(1,lines.length);start+=perPage)pages.push({width,height,bodyTop,bodyBottom,footerY:height-102,portrait,nameLines,nameSize,lines:lines.slice(start,start+perPage).map((line,index)=>({...line,y:bodyTop+index*lineHeight,height:lineHeight})),size,lineHeight,padding});
  return {data,pages};
}
export async function renderPersonShare(options={}){
  const document=options.document||globalThis.document;await document.fonts?.ready;
  const probe=document.createElement('canvas'),context=probe.getContext('2d');if(!context)throw Error('Canvas unavailable');
  const family='"Leafhour Serif", "Songti SC", "Leafhour CJK", serif';
  let portraitImage=null;if(!options.excerpt&&options.person?.portrait?.url&&options.person.portrait.license){try{const url=new URL(options.person.portrait.url,document.location?.origin||globalThis.location?.origin);if(url.origin===(document.location?.origin||globalThis.location?.origin)){portraitImage=await new Promise(resolve=>{const img=document.createElement('img'),timer=setTimeout(()=>resolve(null),4000);img.onload=()=>{clearTimeout(timer);resolve(img);};img.onerror=()=>{clearTimeout(timer);resolve(null);};img.src=url.href;});}}catch{}}
  const result=layoutPersonShare({...options,includePortrait:!!portraitImage,measure:(text,size)=>{context.font=`${size}px ${family}`;return context.measureText(text).width;}}),blobs=[];
  for(const [index,page] of result.pages.entries()){
    const canvas=document.createElement('canvas');canvas.width=page.width;canvas.height=page.height;const ctx=canvas.getContext('2d');ctx.fillStyle='#f7f5ed';ctx.fillRect(0,0,page.width,page.height);ctx.fillStyle='#42614d';ctx.font='22px sans-serif';ctx.fillText('Leafhour',page.padding,64);ctx.fillStyle='#77796d';ctx.textAlign='right';ctx.fillText(result.data.years,page.width-page.padding,64);ctx.textAlign='left';ctx.fillStyle='#232b24';ctx.textBaseline='top';ctx.font=`${page.nameSize}px ${family}`;result.pages[index].nameLines.forEach((line,n)=>ctx.fillText(line.text,page.padding,128+n*page.nameSize*1.1));
    if(result.data.originalName!==result.data.name){ctx.font=`27px ${family}`;ctx.fillStyle='#62695e';ctx.fillText(result.data.originalName,page.padding,(page.portrait?.y||page.bodyTop)-88);}
    if(page.portrait&&portraitImage){const box=page.portrait;ctx.fillStyle='#e8e9de';ctx.fillRect(box.x,box.y,box.width,box.height);const scale=Math.min(box.width/portraitImage.naturalWidth,box.height/portraitImage.naturalHeight),w=portraitImage.naturalWidth*scale,h=portraitImage.naturalHeight*scale;ctx.drawImage(portraitImage,box.x+(box.width-w)/2,box.y+(box.height-h)/2,w,h);}
    if(options.excerpt){ctx.font='18px sans-serif';ctx.fillStyle='#62695e';ctx.fillText(personCopy(options.locale||'en','original')+' · '+result.data.textLanguage,page.padding,page.bodyTop-48);}
    ctx.strokeStyle='#bdc6b9';ctx.beginPath();ctx.moveTo(page.padding,page.bodyTop-25);ctx.lineTo(page.width-page.padding,page.bodyTop-25);ctx.stroke();ctx.fillStyle='#232b24';ctx.font=`${page.size}px ${family}`;for(const line of page.lines)ctx.fillText(line.text.replace(/\n$/,''),page.padding,line.y);
    ctx.font=`22px ${family}`;ctx.fillStyle='#62695e';const attribution=[result.data.work,result.data.locator].filter(Boolean).join(' · ');const creditLines=wrapShareText(attribution,{width:page.width-page.padding*2-90,size:22,measure:(text,size)=>{ctx.font=`${size}px ${family}`;return ctx.measureText(text).width;}});if(creditLines.length>2)throw Error('Share citation exceeds available space');creditLines.forEach((line,n)=>ctx.fillText(line.text,page.padding,page.footerY+n*25));
    ctx.font='19px sans-serif';ctx.fillText(result.data.url?result.data.url.replace('https://',''):'Leafhour',page.padding,page.height-42);ctx.textAlign='right';ctx.fillText(`${index+1} / ${result.pages.length}`,page.width-page.padding,page.footerY);ctx.textAlign='left';const blob=await new Promise((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(Error('Image export failed')),'image/png'));blobs.push(blob);
  }
  return {...result,blobs};
}
export async function shareSystemFiles({navigator=globalThis.navigator,files,title,url}={}){if(!navigator?.share||!navigator.canShare?.({files}))return {status:'unsupported'};try{await navigator.share({files,title,...(url?{url}:{})});return {status:'shared'};}catch(error){if(error?.name==='AbortError')return {status:'cancelled'};throw error;}}
