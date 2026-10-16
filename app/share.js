import {buildShareModel,normaliseShareOptions,paragraphSnapshot,layoutShareCard,shareThemes,shareFonts} from './share-model.mjs';
import {chineseOriginalOnly} from './source-language.mjs';

const $=id=>document.getElementById(id),bridge=()=>window.marginaliaReader;
const dialog=$('share-dialog'),canvas=$('share-canvas'),context=canvas.getContext('2d');
const preferenceKey='marginalia-share-preferences-v1';let saved={},snapshot=null,anchor=null,returnFocus=null,layout=null,model=null,renderVersion=0,renderedVersion=0,pending=false;
try{saved=JSON.parse(localStorage.getItem(preferenceKey)||'{}')||{};if(typeof saved!=='object'||Array.isArray(saved))saved={};}catch{}
const fields={language:'share-language',variant:'share-variant',theme:'share-theme',ratio:'share-ratio',layout:'share-layout',above:'share-above',below:'share-below',size:'share-size',source:'share-source'};
const options=()=>normaliseShareOptions(Object.fromEntries(Object.entries(fields).map(([key,id])=>[key,key==='source'?$(id).checked:$(id).value])));
function status(message,error=false){$('share-status').textContent=message;$('share-status').setAttribute('role',error?'alert':'status');}
function controlsBusy(busy){dialog.setAttribute('aria-busy',String(busy));for(const id of ['share-download','share-copy','share-system'])$(id).disabled=busy;}
function hexAlpha(hex,alpha){const n=parseInt(hex.slice(1),16);return 'rgba('+((n>>16)&255)+','+((n>>8)&255)+','+(n&255)+','+alpha+')';}
function setFont(size,language,italic=false){context.font=(italic?'italic ':'')+size+'px '+shareFonts[language==='ui'?'ui':language==='en'?'en':'zh'];}
function draw(){
 const colors=shareThemes[layout.options.theme];canvas.width=layout.width;canvas.height=layout.height;context.fillStyle=colors.paper;context.fillRect(0,0,canvas.width,canvas.height);context.textBaseline='top';
 for(const item of layout.items){
  if(item.kind==='rule'){context.fillStyle=colors.line;context.fillRect(item.x,item.y,item.width,1);continue;}
  setFont(item.fontSize,item.language,item.kind==='translation'&&item.language==='en');context.fillStyle=item.kind==='translation'||item.kind==='label'?colors.muted:colors.ink;
  if(item.kind==='context'){
   if(item.mode==='fade'){const fade=context.createLinearGradient(0,item.y,0,item.y+item.height);fade.addColorStop(0,hexAlpha(colors.ink,item.side==='above'?.015:.22));fade.addColorStop(1,hexAlpha(colors.ink,item.side==='above'?.22:.015));context.fillStyle=fade;}else context.fillStyle=hexAlpha(colors.ink,.5);
   context.save();context.beginPath();context.rect(item.x,item.y,item.width,item.height+5);context.clip();
  }
  item.lines.forEach((line,i)=>context.fillText(line,item.x,item.y+i*item.lineHeight));if(item.kind==='context')context.restore();
 }
 if(layout.options.source){
  setFont(27,'zh');context.fillStyle=colors.ink;context.fillText(model.title,104,layout.footerY);
  setFont(20,'en');context.fillStyle=colors.muted;context.fillText(model.author,104,layout.footerY+43);
  setFont(17,'ui');context.fillText(model.location+' · '+model.attribution,104,layout.footerY+81);
  context.textAlign='right';setFont(19,'en');context.fillText('Leafhour',layout.width-104,layout.footerY+3);context.textAlign='left';
 }
 $('share-dimensions').textContent=layout.width+' × '+layout.height+' · PNG'+(layout.extended?' · 已延展以保留全文':'');
 $('share-preview-description').textContent=model.blocks.map(b=>b.primary.text+(b.secondary?'\n'+b.secondary.label+'：'+b.secondary.text:'')).join('\n\n');
}
async function render(){
 const version=++renderVersion;controlsBusy(true);
 try{
  const opts=options();model=buildShareModel(bridge().getBook(),snapshot,opts);
  const part=snapshot.parts[0];$('share-layout-field').hidden=opts.language!=='bilingual';$('share-variant-field').hidden=opts.language==='en'||opts.language==='bilingual'&&part.language==='zh';$('share-size-label').value=String(opts.size);
  await document.fonts.ready;if(version!==renderVersion||!dialog.open)return;
  layout=layoutShareCard(model,opts,(text,size,language)=>{setFont(size,language);return context.measureText(text).width;});draw();renderedVersion=version;controlsBusy(false);
  const counterpart=model.blocks.some(b=>b.primary.wholeCounterpart||b.secondary?.wholeCounterpart);
  status(counterpart?'对照按整段显示，图片中已注明。':'预览与导出的图片一致，全部在本机生成。');
  saved={...opts};try{localStorage.setItem(preferenceKey,JSON.stringify(saved));}catch{}
 }catch(error){renderedVersion=0;dialog.setAttribute('aria-busy','false');status(error.message||'图片暂时无法生成，请缩小摘录范围。',true);}
}
function openShare(whole=false){
 if(!bridge()?.getBook())return;
 try{
  const selected=bridge().getExcerpt?.();const book=bridge().getBook(),state=bridge().getState(),p=book.sections.flatMap(s=>s.paragraphs).find(p=>p.id===bridge().getSelectedId());
  snapshot=!whole&&selected?selected:paragraphSnapshot(book,p,bridge().getChapterId(),selected?.parts[0]?.language||(state.mode==='en'?'en':'zh'),selected?.parts[0]?.variant||state.variant);
  const source=snapshot.parts[0],onlyOriginal=chineseOriginalOnly(book),opts=normaliseShareOptions({...saved,language:onlyOriginal?'en':saved.language==='bilingual'?'bilingual':source.language,variant:source.variant});
  for(const choice of $('share-language').options){choice.disabled=onlyOriginal&&choice.value!=='en';if(choice.value==='en')choice.textContent=book.sourceLanguage==='zh'?'中文原文':'英文原文';}
  for(const [key,id]of Object.entries(fields)){if(key==='source')$(id).checked=opts.source;else $(id).value=String(opts[key]);}
  anchor=bridge().getAnchor();returnFocus=document.activeElement;bridge().dismissTools();document.body.classList.add('is-sharing');document.dispatchEvent(new CustomEvent('reader:sharing',{detail:{active:true}}));
  $('share-settings').open=false;dialog.showModal();$('share-close').focus();render();
 }catch(error){$('announcement').textContent=error.message||'请先选择正文。';}
}
function png(){if(!dialog.open||!layout||renderedVersion!==renderVersion)return Promise.reject(Error('请等待预览生成。'));return new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(Error('图片暂时无法保存。')),'image/png'));}
function filename(){return (layout.options.source?model.title.replace(/[\\/:*?"<>|]/g,'').slice(0,40)||'Leafhour':'Leafhour')+'-摘录.png';}
async function download(){const blob=await png(),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=filename();document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),5000);status('图片已交给浏览器保存。');}
$('share-download').addEventListener('click',async()=>{if(pending)return;pending=true;controlsBusy(true);try{await download();}catch(e){status(e.message,true);}finally{pending=false;if(renderedVersion===renderVersion)controlsBusy(false);}});
$('share-copy').hidden=!window.ClipboardItem||!navigator.clipboard?.write;
$('share-copy').addEventListener('click',async()=>{if(pending)return;pending=true;controlsBusy(true);try{const item=new ClipboardItem({'image/png':png()});await navigator.clipboard.write([item]);status('图片已复制，可以粘贴到聊天或笔记里。');}catch{status('当前浏览器不能复制图片，请使用“保存图片”。',true);}finally{pending=false;if(renderedVersion===renderVersion)controlsBusy(false);}});
$('share-system').hidden=!navigator.canShare||!navigator.canShare({files:[new File([''], 'excerpt.png',{type:'image/png'})]});
$('share-system').addEventListener('click',async()=>{if(pending)return;pending=true;controlsBusy(true);try{const file=new File([await png()],filename(),{type:'image/png'});await navigator.share({files:[file],title:layout.options.source?model.title:'摘录'});status('已完成系统分享。');}catch(e){status(e.name==='AbortError'?'已取消分享，图片仍保留在预览里。':'当前系统不能分享图片，请先保存。',e.name!=='AbortError');}finally{pending=false;if(renderedVersion===renderVersion)controlsBusy(false);}});
for(const id of Object.values(fields))$(id).addEventListener('input',render);
$('share-close').addEventListener('click',()=>dialog.close());
dialog.addEventListener('close',()=>{renderVersion++;document.body.classList.remove('is-sharing');document.dispatchEvent(new CustomEvent('reader:sharing',{detail:{active:false}}));bridge().restoreAnchor(anchor);if(returnFocus?.isConnected&&returnFocus.getClientRects().length)returnFocus.focus({preventScroll:true});else document.getElementById(snapshot?.parts[0]?.passageId)?.focus({preventScroll:true});});
$('show-share').addEventListener('click',()=>openShare());$('share-passage').addEventListener('click',()=>openShare(true));
