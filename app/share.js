import {t,getUiLocale,onUiLocaleChange,uiReady} from './ui-locale.mjs';
import {buildShareModel,normaliseShareOptions,paragraphSnapshot,shareThemes,shareFonts,shareFontFallbacks,displayQuoteText} from './share-model.mjs';
import {verifiedExcerptUrl} from './share-link.mjs';
import {chineseOriginalOnly} from './source-language.mjs';

await uiReady;

const $=id=>document.getElementById(id),bridge=()=>window.marginaliaReader;
const dialog=$('share-dialog'),canvas=$('share-canvas'),context=canvas.getContext('2d');
const preferenceKey='marginalia-share-preferences-v1';let saved={},snapshot=null,anchor=null,returnFocus=null,layout=null,model=null,renderVersion=0,renderedVersion=0,pending=false,fontState=null;
try{saved=JSON.parse(localStorage.getItem(preferenceKey)||'{}')||{};if(typeof saved!=='object'||Array.isArray(saved))saved={};}catch{}
const fields={language:'share-language',variant:'share-variant',theme:'share-theme',ratio:'share-ratio',layout:'share-layout',above:'share-above',below:'share-below',size:'share-size',source:'share-source'};
const options=()=>normaliseShareOptions(Object.fromEntries(Object.entries(fields).map(([key,id])=>[key,key==='source'?$(id).checked:$(id).value])));
let announcementLabel=null;
let statusIds=[],statusError=false,dimensions=null,originalLabelId='share.artifact.originalEn',artifactLocale=getUiLocale();
let trialUrl=null,shareOwner=null,linkController=null,qrFactory=null,trialPending=false,trialFailed=false;
function updateShareLabels(){
 if(announcementLabel?.parentElement===$('announcement'))announcementLabel.textContent=t('share.chooseFirst');
 for(const option of $('share-language').options)if(option.value==='en')option.textContent=t(originalLabelId);
 $('share-status').textContent=statusIds.map(id=>t(id)).join(' ');$('share-status').setAttribute('role',statusError?'alert':'status');
 if(dimensions)$('share-dimensions').textContent=dimensions.width+' × '+dimensions.height+' · PNG'+(dimensions.extended?t('share.extendedSuffix'):'');
}
function status(ids,error=false){statusIds=Array.isArray(ids)?ids.filter(Boolean):[ids];statusError=error;updateShareLabels();}
const offLocale=onUiLocaleChange(updateShareLabels);
window.addEventListener('pagehide',event=>{if(!event.persisted)offLocale();});
function controlsBusy(busy){busy=busy||trialPending;dialog.setAttribute('aria-busy',String(busy));for(const id of ['share-download','share-copy','share-system'])$(id).disabled=busy;}
function hexAlpha(hex,alpha){const n=parseInt(hex.slice(1),16);return 'rgba('+((n>>16)&255)+','+((n>>8)&255)+','+(n&255)+','+alpha+')';}
function setFont(size,language,italic=false){const families=fontState?.fallback?shareFontFallbacks:shareFonts;context.font=(italic?'italic ':'')+size+'px '+families[language==='ui'?'ui':language==='en'?'en':'zh'];}
function validScope(){const book=bridge()?.getBook();return dialog.open&&book?.bookId===snapshot?.bookId&&book?.contentVersion===snapshot?.contentVersion&&(bridge()?.getOwner?.()??'guest')===shareOwner;}
function drawQR(url,x,y,maxSize){
 const qr=qrFactory(0,'M');qr.addData(url);qr.make();const count=qr.getModuleCount(),scale=Math.floor(maxSize/(count+8)),size=(count+8)*scale;
 context.fillStyle='#fff';context.fillRect(x,y,size,size);context.fillStyle='#183e2d';
 for(let row=0;row<count;row++)for(let col=0;col<count;col++)if(qr.isDark(row,col))context.fillRect(x+(col+4)*scale,y+(row+4)*scale,scale,scale);
}
function draw(){
 const colors=shareThemes[layout.options.theme];canvas.width=layout.width;canvas.height=layout.height;context.fillStyle=colors.paper;context.fillRect(0,0,canvas.width,canvas.height);context.textBaseline='top';
 for(const item of layout.items){
  if(item.kind==='rule'){context.fillStyle=colors.line;context.fillRect(item.x,item.y,item.width,1);continue;}
  setFont(item.fontSize,item.language);context.fillStyle=item.kind==='translation'||item.kind==='label'?colors.muted:colors.ink;
  if(item.kind==='context'){
   if(item.mode==='fade'){const fade=context.createLinearGradient(0,item.y,0,item.y+item.height);fade.addColorStop(0,hexAlpha(colors.ink,item.side==='above'?.015:.22));fade.addColorStop(1,hexAlpha(colors.ink,item.side==='above'?.22:.015));context.fillStyle=fade;}else context.fillStyle=hexAlpha(colors.ink,.5);
   context.save();context.beginPath();context.rect(item.x,item.y,item.width,item.height+5);context.clip();
  }
  item.lines.forEach((line,i)=>{if(item.runs){let x=item.x;for(const run of item.runs[i]){setFont(item.fontSize,item.language,run.italic);context.fillText(run.text,x,item.y+i*item.lineHeight);x+=context.measureText(run.text).width;}return;}context.fillText(line,item.x,item.y+i*item.lineHeight);});if(item.kind==='context')context.restore();
 }
 context.fillStyle=colors.line;context.fillRect(104,layout.footerY-30,layout.width-208,1);
 const citationWidth=trialUrl?600:layout.width-208;
 setFont(18,'ui');context.fillStyle=colors.muted;context.fillText('Leafhour · '+model.attribution,104,layout.footerY);
 if(layout.options.source){
  setFont(27,'zh');context.fillStyle=colors.ink;
  layout.citationLines.forEach((line,i)=>context.fillText(line,104,layout.footerY+42+i*39));
  setFont(17,'ui');context.fillStyle=colors.muted;context.fillText(model.location,104,layout.footerY+52+layout.citationLines.length*39);
 }
 if(trialUrl){drawQR(trialUrl,layout.width-104-216,layout.footerY-4,216);setFont(18,'ui');context.fillStyle=colors.muted;context.fillText(t('share.scanRead'),104,layout.height-65);}
 dimensions={width:layout.width,height:layout.height,extended:layout.extended};updateShareLabels();
 $('share-preview-description').lang=artifactLocale;
 $('share-preview-description').textContent=model.blocks.map(b=>displayQuoteText(b.primary.text,b.primary.emphasis)+(b.secondary?'\n'+b.secondary.label+'：'+displayQuoteText(b.secondary.text,b.secondary.emphasis):'')).join('\n\n');
}
async function render(){
 const version=++renderVersion;controlsBusy(true);
 try{
  const opts=options();artifactLocale=getUiLocale();if(!validScope())throw Error('share.stale');
  model=buildShareModel(bridge().getBook(),snapshot,opts,t);
  const part=snapshot.parts[0];$('share-layout-field').hidden=opts.language!=='bilingual';$('share-variant-field').hidden=opts.language==='en'||opts.language==='bilingual'&&part.language==='zh';$('share-size-label').value=String(opts.size);
  await document.fonts.ready;// Canvas text does not start face loads; load/check both faces before the first measure.
  const {prepareShareFonts}=await import('./share-fonts.mjs');
  const loaded=await prepareShareFonts(document.fonts,model,fontState);fontState=loaded.latin;const cjkState=loaded.cjk;
  const {layoutShareCard}=await import('./share-model.mjs');
  if(version!==renderVersion||!validScope())return;
  layout=layoutShareCard(model,{...opts,trialUrl},(text,size,language,italic=false)=>{setFont(size,language,italic);return context.measureText(text).width;});draw();renderedVersion=version;controlsBusy(false);
  const counterpart=model.blocks.some(b=>b.primary.wholeCounterpart||b.secondary?.wholeCounterpart);
  status([fontState?.fallback?'share.font.latinFallback':null,cjkState.failed?'share.font.cjkFallback':null,trialFailed?'share.linkUnavailable':'share.localPreview']);
  saved={...opts};try{localStorage.setItem(preferenceKey,JSON.stringify(saved));}catch{}
 }catch(error){renderedVersion=0;dialog.setAttribute('aria-busy','false');status('share.renderFailed',true);}
}
function openShare(whole=false,intent=null){
 if(!bridge()?.getBook())return;
 try{
  const selected=bridge().getExcerpt?.();const book=bridge().getBook(),state=bridge().getState(),p=book.sections.flatMap(s=>s.paragraphs).find(p=>p.id===bridge().getSelectedId());
  if(intent&&(intent.snapshot?.bookId!==book.bookId||intent.snapshot?.contentVersion!==book.contentVersion||intent.owner!==(bridge()?.getOwner?.()??'guest')))throw Error('share.stale');
  snapshot=intent?structuredClone(intent.snapshot):bridge().getShareIntent?bridge().getShareIntent(whole):!whole&&selected?selected:paragraphSnapshot(book,p,bridge().getChapterId(),selected?.parts[0]?.language||(state.mode==='en'?'en':'zh'),selected?.parts[0]?.variant||state.variant);
  const source=snapshot.parts[0],onlyOriginal=chineseOriginalOnly(book),opts=normaliseShareOptions({...saved,language:onlyOriginal?'en':source.language,variant:source.variant,source:book.visibility==='public',above:'hide',below:'hide'});
  originalLabelId=book.sourceLanguage==='zh'?'share.artifact.originalZh':'share.artifact.originalEn';
  for(const choice of $('share-language').options)choice.disabled=onlyOriginal&&choice.value!=='en';updateShareLabels();
  for(const [key,id]of Object.entries(fields)){if(key==='source')$(id).checked=opts.source;else $(id).value=String(opts[key]);}
  shareOwner=bridge()?.getOwner?.()??'guest';trialUrl=null;trialFailed=false;trialPending=book.visibility==='public';linkController?.abort();$('share-trial').hidden=true;
  anchor=intent?.anchor??bridge().getAnchor();returnFocus=intent?.trigger??document.activeElement;bridge().dismissTools();document.body.classList.add('is-sharing');document.dispatchEvent(new CustomEvent('reader:sharing',{detail:{active:true}}));
  $('share-settings').open=false;dialog.showModal();$('share-close').focus();render();void loadTrial(book);
 }catch(error){announcementLabel=document.createElement('span');announcementLabel.textContent=t('share.chooseFirst');$('announcement').replaceChildren(announcementLabel);}
}
function png(){if(trialPending||!validScope()||!layout||renderedVersion!==renderVersion)return Promise.reject(Error('share.wait'));const capturedVersion=renderVersion,capturedSnapshot=snapshot;return new Promise((resolve,reject)=>canvas.toBlob(blob=>blob&&validScope()&&renderVersion===capturedVersion&&snapshot===capturedSnapshot?resolve(blob):reject(Error('share.saveFailed')),'image/png'));}
function filename(){return (layout.options.source?model.title.replace(/[\\/:*?"<>|]/g,'').slice(0,40)||'Leafhour':'Leafhour')+t('share.filenameSuffix');}
async function download(){const blob=await png(),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=filename();if(!validScope())throw Error('share.wait');document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),5000);status('share.downloaded');}
$('share-download').addEventListener('click',async()=>{if(pending)return;pending=true;controlsBusy(true);try{await download();}catch(e){status(e.message==='share.wait'?'share.wait':'share.saveFailed',true);}finally{pending=false;if(renderedVersion===renderVersion)controlsBusy(false);}});
$('share-copy').hidden=!window.ClipboardItem||!navigator.clipboard?.write;
$('share-copy').addEventListener('click',async()=>{if(pending)return;pending=true;controlsBusy(true);try{const item=new ClipboardItem({'image/png':png()});await navigator.clipboard.write([item]);status('share.copied');}catch{status('share.copyFailed',true);}finally{pending=false;if(renderedVersion===renderVersion)controlsBusy(false);}});
$('share-system').hidden=!navigator.canShare||!navigator.canShare({files:[new File([''], 'excerpt.png',{type:'image/png'})]});
$('share-system').addEventListener('click',async()=>{if(pending)return;pending=true;controlsBusy(true);try{const file=new File([await png()],filename(),{type:'image/png'});if(!validScope())throw Error('share.wait');await navigator.share({files:[file],title:layout.options.source?model.title:t('share.artifact.title'),...(trialUrl?{url:trialUrl}:{})});status('share.shared');}catch(e){status(e.name==='AbortError'?'share.cancelled':'share.systemFailed',e.name!=='AbortError');}finally{pending=false;if(renderedVersion===renderVersion)controlsBusy(false);}});
for(const id of Object.values(fields))$(id).addEventListener('input',render);
$('share-close').addEventListener('click',()=>dialog.close());
dialog.addEventListener('close',()=>{linkController?.abort();trialUrl=null;renderVersion++;document.body.classList.remove('is-sharing');document.dispatchEvent(new CustomEvent('reader:sharing',{detail:{active:false}}));bridge().restoreAnchor(anchor);if(returnFocus?.isConnected&&returnFocus.getClientRects().length)returnFocus.focus({preventScroll:true});else document.getElementById(snapshot?.parts[0]?.passageId)?.focus({preventScroll:true});});
$('show-share').addEventListener('click',()=>openShare());$('share-passage').addEventListener('click',()=>openShare(true));

async function loadTrial(book){
 if(book.visibility!=='public'||!snapshot?.parts?.length)return;
 const captured=structuredClone(snapshot),controller=new AbortController();linkController=controller;const timer=setTimeout(()=>controller.abort(),10000);
 try{
  const response=await fetch('/api/public-excerpts/'+encodeURIComponent(captured.bookId)+'/'+encodeURIComponent(captured.parts[0].passageId)+'?'+new URLSearchParams({contentVersion:captured.contentVersion}),{credentials:'omit',cache:'no-store',signal:controller.signal});
  if(!response.ok)return;const url=verifiedExcerptUrl(await response.json(),captured);
  const qrModule=url?await import('./vendor/share-qr.mjs'):null;
  if(!url||controller.signal.aborted||linkController!==controller||!validScope()||snapshot.bookId!==captured.bookId||snapshot.contentVersion!==captured.contentVersion||snapshot.chapterId!==captured.chapterId||snapshot.parts[0].passageId!==captured.parts[0].passageId)return;
  qrFactory=qrModule.default;trialUrl=url;$('share-trial-open').href=url;$('share-trial').hidden=false;await render();
 }catch{/* Offline local export remains available, without an unverified link. */}
 finally{
  clearTimeout(timer);
  if(linkController===controller){trialPending=false;trialFailed=!trialUrl;if(validScope()){if(!pending&&renderedVersion===renderVersion)controlsBusy(false);if(trialFailed)status('share.linkUnavailable');}}
 }
}
$('share-link-copy').addEventListener('click',async()=>{if(!trialUrl||!validScope())return;try{await navigator.clipboard.writeText(trialUrl);status('share.linkCopied');}catch{status('share.copyFailed',true);}});

for(const event of ['reader:session-changed','reader:chapter'])document.addEventListener(event,()=>{if(dialog.open&&!validScope())dialog.close();});

function openShareIntent(intent){openShare(false,intent);}
export {openShareIntent};
