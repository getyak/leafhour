import {bookExportDocument,documentMarkdown,documentFilename,downloadDocument} from './document-export.mjs';
import {assembleBookTransfer} from './book-transfer.mjs';
import {readExportResource} from './library-export.mjs';

// The host supplies its existing owner/revision guard and locale formatter.
// Closing the host, changing owner or cancelling makes all late work inert.
export async function mountBookExport({document,body,book,api,current,t,locale,notice,loadPdf=()=>import('./document-pdf.mjs'),label:write=(el,key)=>{el.textContent=t(key);return el;}}){
 const make=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n;};
 const ui=(tag,key)=>write(make(tag),'export.'+key);
 const label=(key,input)=>{const row=make('label');row.className='schedule-field';row.append(ui('span',key),input);return row;};
 const intro=ui('p','help'),form=make('form'),fields=make('div');fields.className='schedule-fields';
 const format=make('select');format.setAttribute('aria-label',t('data.format'));for(const [value,text]of [['markdown','Markdown (.md)'],['pdf','PDF (.pdf)']]){const option=make('option',text);option.value=value;format.append(option);}
 const chapter=make('select');chapter.setAttribute('aria-label',t('export.range'));const whole=ui('option','whole');whole.value='';chapter.append(whole);
 const layers=make('select');layers.setAttribute('aria-label',t('export.layers'));for(const value of ['original','literal','interpretive','all']){const option=ui('option',value);option.value=value;layers.append(option);}
 const save=write(make('button'),'export.download');save.type='submit';save.className='primary';save.disabled=true;
 const cancel=write(make('button'),'data.cancel');cancel.type='button';cancel.className='outline';cancel.hidden=true;
 fields.append(label('format',format),label('range',chapter),label('layers',layers));form.append(fields,save,cancel);body.append(intro,form);
 let full=null,revision=0,busy=false;
 const assert=()=>{if(!current())throw Error('Export cancelled');};
 const read=url=>readExportResource({api,url,assertCurrent:assert});
 const load=async()=>{
  try{notice('export.loading');const manifest=await read('/api/library/books/'+encodeURIComponent(book.bookId)+'/document-export');
   full=await assembleBookTransfer(manifest,(offset,snapshot)=>read('/api/library/books/'+encodeURIComponent(book.bookId)+'/content-part?offset='+offset+'&snapshot='+snapshot));assert();
   for(const c of full.chapters){const option=make('option',c.title?.[locale()]||c.title?.[locale().startsWith('zh')?'zh':'en']||c.title?.zh||c.title?.en||c.id);option.value=c.id;chapter.append(option);}save.disabled=false;notice('export.ready');
  }catch{if(current()){notice('export.error',null,true);save.disabled=false;}}
 };
 cancel.addEventListener('click',()=>{revision++;busy=false;cancel.hidden=true;save.disabled=false;for(const field of [format,chapter,layers])field.disabled=false;notice('export.cancelled');});
 form.addEventListener('submit',async event=>{
  event.preventDefault();if(!current()||busy)return;if(!full){save.disabled=true;await load();return;}
  const ticket=++revision,valid=()=>{assert();if(ticket!==revision)throw Error('Export cancelled');};busy=true;save.disabled=true;cancel.hidden=false;for(const field of [format,chapter,layers])field.disabled=true;
  try{
   notice('export.preparing');const doc=bookExportDocument(full,{chapterId:chapter.value,layers:layers.value==='all'?['original','literal','interpretive']:[layers.value],locale:locale(),labels:Object.fromEntries(['original','literal','interpretive','missing','notices'].map(key=>[key,t('export.'+key)]))});
   const type=format.value,bytes=type==='pdf'?await (await loadPdf()).documentPdf(doc,{assertCurrent:valid}):documentMarkdown(doc);valid();
   downloadDocument(bytes,documentFilename(doc.title+(chapter.value?'-'+chapter.value:''),type),type==='pdf'?'application/pdf':'text/markdown;charset=utf-8',{document});notice('export.downloadRequested');
  }catch(error){if(current()&&ticket===revision)notice(error.code==='PDF_GLYPH_UNAVAILABLE'?'export.glyphError':'export.error',null,true);}
  finally{if(current()&&ticket===revision){busy=false;save.disabled=false;cancel.hidden=true;for(const field of [format,chapter,layers])field.disabled=false;}}
 });
 await load();
}
