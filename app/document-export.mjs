// Explicit book content only. Personal records and executable metadata are
// never traversed, even when an older book object happens to contain them.
const titleOf=(value,locale='en')=>typeof value==='string'?value:value?.[locale]||value?.[locale.startsWith('zh')?'zh':'en']||value?.zh||value?.en||'';
export function documentFilename(title,format){
 const extension={markdown:'md',pdf:'pdf',json:'json'}[format];if(!extension)throw Error('Unknown document format');
 const stem=Array.from(String(title).normalize('NFC').replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g,' ').replace(/[\u202a-\u202e\u2066-\u2069]/g,'').trim().replace(/[. ]+$/g,'')).slice(0,70).join('')||'leafhour-export';
 return stem+'.'+extension;
}
export function bookExportDocument(book,{chapterId='',layers=['original'],locale='en',labels={}}={}){
 if(!Array.isArray(layers)||!layers.length||layers.some(l=>!['original','literal','interpretive'].includes(l)))throw Error('Choose a content layer');
 if(chapterId&&!book.chapters?.some(c=>c.id===chapterId))throw Error('Unknown chapter');
 const sections=book.sections?.filter(s=>!chapterId||s.chapterId===chapterId);
 if(!sections?.length||sections.some(s=>s.paragraphs.some(p=>p.unloaded||typeof p.original!=='string')))throw Error('Book content is not complete');
 const title=titleOf(book.title,locale)||book.bookId,blocks=[],add=(kind,text)=>{if(text)blocks.push({kind,text:String(text)});};
 add('heading',title);add('metadata',book.author);add('metadata',book.bookId+' @ '+book.contentVersion);
 for(const value of [book.edition,book.scopeNote,book.source?.edition,book.source?.scopeNote,book.source?.credits,book.source?.url,book.source?.copyright,book.source?.license,book.source?.attribution,book.copyright,book.license])if(typeof value==='string')add('metadata',value);
 if(book.source?.sha256)add('metadata','SHA-256: '+book.source.sha256);
 let chapter=null;
 for(const section of sections){
  if(section.chapterId!==chapter){chapter=section.chapterId;const c=book.chapters.find(c=>c.id===chapter);add('subheading',titleOf(c?.title,locale)||chapter);}
  for(const p of section.paragraphs){
   add('anchor',p.id+(p.source?.page?' · '+p.source.page:''));
   // Translation-only exports still keep the source for missing translations.
   const missing=layers.some(l=>l!=='original'&&!p.translations?.[l]?.text);
   for(const layer of ['original','literal','interpretive'].filter(l=>layers.includes(l)||l==='original'&&missing)){
    const translation=p.translations?.[layer];
    add('label',(labels[layer]||layer)+(layer==='original'?'':translation?.text?' · '+(translation.status||'draft'):' · '+(labels.missing||'Not translated')));
    if(layer==='original')add('paragraph',p.original);else if(translation?.text)add('paragraph',translation.text);
   }
  }
 }
 if(typeof book.licenseNotices==='string'&&book.licenseNotices){add('subheading',labels.notices||'Source and copyright notices');add('paragraph',book.licenseNotices);}
 return {title,blocks};
}
const escape=value=>String(value).replace(/[\\`*_[\]<>#]/g,'\\$&');
export function documentMarkdown(document){return document.blocks.map(({kind,text})=>(kind==='heading'?'# ':kind==='subheading'?'## ':kind==='label'?'### ':'')+escape(text)).join('\n\n')+'\n';}
export function textExportDocument(text,title){return {title,blocks:String(text).split(/\n\n+/).map(text=>({kind:'paragraph',text}))};}
export function downloadDocument(bytes,name,type,{document=globalThis.document,URL=globalThis.URL}={}){
 const blob=new Blob([bytes],{type}),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=name;
 try{document.body.append(link);link.click();}finally{link.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);}
}
