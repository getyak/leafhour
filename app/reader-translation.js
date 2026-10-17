import {importSourceDescription} from './document-source.mjs';
import {selectedBookId,readerSession,readerFetch} from './reader-api.mjs';
import {chineseOriginalOnly} from './source-language.mjs';
import {createTranslationState,hasDualDrafts} from './translation-state.mjs';
import {readerLoginUrl} from './reader-return.mjs';
import {chineseSampleNotice,translationDisclosure} from './catalog-sample.mjs';
import {downloadOriginalParts} from './original-download.mjs';
if(selectedBookId){
  const button=document.createElement('button');button.id='translate-passage';button.type='button';button.textContent='翻译这段';document.getElementById('paragraph-tools').prepend(button);
  const hint=document.createElement('p');hint.className='translation-notice';hint.setAttribute('role','status');document.getElementById('chapter-heading').append(hint);
  const sourceReview=document.createElement('details');sourceReview.className='source-review';sourceReview.hidden=true;document.getElementById('chapter-heading').insertBefore(sourceReview,hint);
  const bridge=()=>window.marginaliaReader;
  const tasks=createTranslationState();
  const selectedPassage=()=>bridge()?.getBook()?.sections.flatMap(s=>s.paragraphs).find(p=>p.id===tasks.selectedId());
  const defaultNotice=()=>chineseSampleNotice(bridge()?.getBook()||{})||(bridge()?.getBook()&&chineseOriginalOnly(bridge().getBook())?'这本书原文为中文，无需翻译。可以选择原句，留下自己的想法或摘录。':readerSession?.translationAvailable?'点击段落可按需翻译。只向已配置的云模型发送当前及前后各一段；双译保存为 AI 草稿。':'翻译服务尚未配置，仍可阅读原文并保留自己的想法。');
  function renderTranslation(){const view=tasks.view(selectedPassage(),{authenticated:!!readerSession?.user,available:!!readerSession?.translationAvailable,loginAvailable:!!(readerSession?.emailAvailable||readerSession?.localAvailable||readerSession?.providers?.google||readerSession?.providers?.apple),defaultNotice:defaultNotice()});button.textContent=view.label;button.disabled=view.disabled;hint.textContent=view.notice;}
  async function originalFile(container){
    container.textContent='正在检查原文件…';
    try{
      const response=await readerFetch('/api/original/info'),info=await response.json();if(!response.ok)throw Error(info.error||'原文件暂时无法读取');if(!container.isConnected)return;container.replaceChildren();
      if(!info.available){container.textContent=info.reason;const link=document.createElement('a');link.href='/library';link.textContent='去书房补回原文件 →';container.append(document.createElement('br'),link);return;}
      const resume={};const download=document.createElement('button'),status=document.createElement('span');download.type='button';download.className='source-download';download.textContent='下载原文件校对 ↗';status.setAttribute('role','status');container.append(download,status);
      download.addEventListener('click',async()=>{download.disabled=true;status.textContent='正在取回原文件…';try{let assembled;if(info.bytes>8*1024*1024&&readerSession.directUpload){const manifest=await readerFetch('/api/original/parts');const plan=await manifest.json();if(!manifest.ok)throw Error(plan.error);assembled=await downloadOriginalParts({parts:plan.parts,sha256:info.sha256,bytes:info.bytes,resume,rangeFetcher:({offset,length,signal})=>readerFetch('/api/original/range?sha256='+info.sha256+'&offset='+offset+'&length='+length,{signal}),refreshParts:async({signal})=>{const r=await readerFetch('/api/original/parts',{signal}),p=await r.json();if(!r.ok)throw Error(p.error);return p.parts;},onBytes:(received,total)=>{status.textContent='正在取回原文件… '+Math.round(received/total*100)+'%';}});}const response=assembled?new Response(assembled):await readerFetch('/api/original');if(!response.ok){const body=await response.json();throw Error(body.error||'原文件暂时无法下载');}const url=URL.createObjectURL(await response.blob()),a=document.createElement('a');a.href=url;a.download=info.filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);status.textContent='原文件已准备，可在浏览器下载中查看。';}catch(error){status.textContent=error.message||'原文件暂时无法下载，请重试';}finally{download.disabled=false;}});
    }catch(error){if(container.isConnected)container.textContent=error.message||'原文件暂时无法确认，请刷新后重试。';}
  }
  document.addEventListener('reader:ready',()=>{
    const book=bridge().getBook();sourceReview.replaceChildren();sourceReview.hidden=book.visibility!=='private';
    document.getElementById('translation-about').textContent=translationDisclosure(book);
    if(!sourceReview.hidden){const summary=document.createElement('summary'),filename=document.createElement('p'),detail=document.createElement('p'),original=document.createElement('div');summary.textContent=book.source.review==='visually_checked'?'原文已有视觉复核记录':book.source.format==='epub'?'EPUB 已导入 · 待校对':book.source.format==='pdf'?'PDF 文字已提取 · 待校对':'文字已导入 · 待校对';filename.className='source-filename';filename.textContent=book.source.filename;detail.textContent=importSourceDescription(book);original.className='source-file-action';const reviewLink=document.createElement('a');reviewLink.className='source-download';reviewLink.href='/source-review?book='+encodeURIComponent(selectedBookId);reviewLink.textContent='校对原文、页码与评论位置 →';sourceReview.append(summary,filename,detail,reviewLink,original);void originalFile(original);}
    const onlyOriginal=chineseOriginalOnly(book);renderTranslation();for(const choice of document.querySelectorAll('[data-passage-variant]'))choice.hidden=onlyOriginal;for(const id of ['show-xray','show-stance','show-echo','show-chat','chapter-invitations'])document.getElementById(id).hidden=true;for(const link of document.querySelectorAll('a[href^="/exports/"],a[href="/evals"],a[href="/api/experiences/export"]'))link.hidden=true;const invitation=document.getElementById('chapter-invitations').closest('.setting-row');if(invitation)invitation.hidden=true;
  });
  document.addEventListener('reader:selection',()=>{tasks.select(bridge().getSelectedId());renderTranslation();});
  document.addEventListener('reader:chapter',()=>{tasks.select(null);renderTranslation();});
  document.addEventListener('reader:selection-end',()=>{tasks.select(null);renderTranslation();});
  button.addEventListener('click',async()=>{
    const passage=selectedPassage();if(!passage)return;
    if(hasDualDrafts(passage)){document.dispatchEvent(new CustomEvent('reader:translation',{detail:{...passage,reveal:true}}));renderTranslation();return;}
    if(!readerSession?.user){if(!button.disabled)location.href=readerLoginUrl({bookId:selectedBookId,passageId:passage.id,action:'translate'});return;}
    if(button.disabled)return;const passageId=passage.id;tasks.begin(passageId);renderTranslation();
    try{const response=await readerFetch('/api/translate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({passageId})}),result=await response.json();if(!response.ok)throw Object.assign(Error(result.error||'翻译暂时无法完成'),{status:response.status});if(result.id!==passageId||!hasDualDrafts(result))throw Object.assign(Error('翻译结果未对应完整双译，请重试。'),{status:502});document.dispatchEvent(new CustomEvent('reader:translation',{detail:{...result,reveal:tasks.complete(passageId)}}));}
    catch(error){tasks.fail(passageId,error.status?error.message:'翻译暂时无法连接，请重试。');}finally{renderTranslation();}
  });
}
