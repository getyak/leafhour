const identity=s=>JSON.stringify([s?.ownerId,s?.bookId,s?.contentVersion,s?.chapterId]);
const canRun=s=>s?.ownerId&&s.bookId&&s.contentVersion&&s.chapterId&&s.visible!==false&&s.enabled!==false&&s.mode!=='en'&&!s.offline;
export function mergeReadingTranslationReceipt(book,receipt){
 if(book?.contentVersion!==receipt?.contentVersion)return false;
 const incoming=receipt.passage,passage=book.sections.flatMap(s=>s.paragraphs).find(p=>p.id===incoming?.id);
 if(!passage||passage.unloaded||passage.original!==incoming.original||!['literal','interpretive'].every(k=>typeof incoming.translations?.[k]?.text==='string'&&incoming.translations[k].text.trim()))return false;
 passage.translations=Object.fromEntries(['literal','interpretive'].map(k=>[k,typeof passage.translations?.[k]?.text==='string'&&passage.translations[k].text.trim()?passage.translations[k]:incoming.translations[k]]));return true;
}

export function automaticTranslationCopy(locale='en'){
 const messages={
  en:{label:'Prepare translations automatically',cost:'Current chapter and only the next chapter. Each new paragraph uses 1 reading point; saved translations are free.',free:'Current chapter and only the next chapter. This instance uses its configured translation service.',preparing:'Preparing translations…',next:'Preparing the next chapter…',ready:'Translations are ready.',paused:'Automatic preparation is paused.',failed:'Preparation stopped. The original remains available.',funds:'Not enough reading points. The original remains available.',retry:'Try again',source:'Read original'},
  'zh-Hans':{label:'自动准备译文',cost:'仅准备当前章与紧接的下一章。新译每段使用 1 阅读点，已有译文不收费。',free:'仅准备当前章与紧接的下一章，使用此实例已配置的翻译服务。',preparing:'正在准备译文…',next:'正在准备下一章译文…',ready:'译文已就绪。',paused:'自动准备已暂停。',failed:'准备已停止，仍可阅读原文。',funds:'阅读点数不足，仍可阅读原文。',retry:'重试',source:'阅读原文'},
  'zh-Hant':{label:'自動準備譯文',cost:'僅準備目前章節與緊接的下一章。新譯每段使用 1 閱讀點，已有譯文不收費。',free:'僅準備目前章節與緊接的下一章，使用此實例已設定的翻譯服務。',preparing:'正在準備譯文…',next:'正在準備下一章譯文…',ready:'譯文已就緒。',paused:'自動準備已暫停。',failed:'準備已停止，仍可閱讀原文。',funds:'閱讀點數不足，仍可閱讀原文。',retry:'重試',source:'閱讀原文'},
  ja:{label:'訳文を自動で準備',cost:'現在の章と直後の章だけを準備します。新しい段落ごとに1読書ポイントを使い、保存済みの訳文は無料です。',free:'現在の章と直後の章だけを、このインスタンスに設定された翻訳サービスで準備します。',preparing:'訳文を準備中…',next:'次の章の訳文を準備中…',ready:'訳文の準備ができました。',paused:'自動準備は一時停止中です。',failed:'準備を停止しました。原文は引き続き読めます。',funds:'読書ポイントが不足しています。原文は引き続き読めます。',retry:'再試行',source:'原文を読む'}
 };return messages[locale]||messages.en;
}

export function mountReaderAutomaticTranslation({bookId,session,request,document:doc=globalThis.document,getReader=()=>globalThis.window?.marginaliaReader,getLocale=()=> 'en',onLocaleChange=()=>()=>{},storage=globalThis.localStorage}={}){
 const details=doc?.getElementById('translation-details');if(!details||!bookId)return null;
 const root=doc.createElement('section'),label=doc.createElement('label'),toggle=doc.createElement('input'),title=doc.createElement('span'),cost=doc.createElement('p'),status=doc.createElement('p'),retry=doc.createElement('button'),source=doc.createElement('button');
 root.className='settings-section';toggle.type='checkbox';toggle.id='automatic-reading-translation';label.htmlFor=toggle.id;label.append(toggle,title);cost.className='setting-hint';status.setAttribute('role','status');retry.type=source.type='button';root.append(label,cost,status,retry,source);details.parentElement.insertBefore(root,details);
 const ownerId=session?.user?.id,key='marginalia-reading-translation-v1|'+(ownerId||'guest')+'|'+bookId,listeners=[],repaints=new Set();
 let enabled=true,disposed=false,view={status:'paused'};try{enabled=storage?.getItem(key)!=='false';}catch{}
 const on=(target,event,handler)=>{target.addEventListener(event,handler);listeners.push(()=>target.removeEventListener(event,handler));};
 const scope=()=>{const reader=getReader(),book=reader?.getBook?.();return {ownerId,bookId:book?.bookId,contentVersion:book?.contentVersion,chapterId:reader?.getChapterId?.(),passageId:reader?.getAnchor?.()?.passageId,mode:reader?.getState?.()?.mode,visible:!doc.hidden,enabled:enabled&&!!session?.translationAvailable&&book?.sourceLanguage!=='zh',offline:!!book?.reading?.offlineFallback};};
 const paint=()=>{
  const copy=automaticTranslationCopy(getLocale()),reader=getReader(),book=reader?.getBook?.();root.hidden=!ownerId||book?.sourceLanguage==='zh';toggle.checked=enabled;title.textContent=copy.label;cost.textContent=session?.billing?.enabled?copy.cost:copy.free;status.textContent=view.status==='preparing'?(view.phase==='next'?copy.next:copy.preparing):view.status==='failed'?(view.error?.status===402?copy.funds:copy.failed):copy[view.status]||copy.paused;retry.textContent=copy.retry;retry.hidden=view.status!=='failed';source.textContent=copy.source;
  const state=reader?.getState?.(),passages=new Map((book?.sections||[]).flatMap(s=>s.paragraphs.map(p=>[p.id,{...p,chapterId:s.chapterId}])));
  for(const node of doc.querySelectorAll?.('#chapter-text .passage')||[]){
   const p=passages.get(node.dataset.id),show=p&&state?.mode!=='en'&&book.sourceLanguage!=='zh'&&p.kind!=='source_heading'&&!p.translations?.[state?.variant||'interpretive']?.text&&p.chapterId===view.chapterId&&['preparing','failed'].includes(view.status);
   let hint=node.querySelector('.translation-preparation');if(!show){hint?.remove();continue;}
   if(!hint){hint=doc.createElement('small');hint.className='translation-preparation setting-hint';hint.setAttribute('aria-hidden','true');node.append(hint);}hint.textContent=view.status==='preparing'?copy.preparing:view.error?.status===402?copy.funds:copy.failed;
  }
 };
 const flush=()=>{
  const reader=getReader();if(disposed||doc.hidden||doc.getSelection?.()?.isCollapsed===false||reader?.isSelectionActive?.()||!repaints.size||!reader?.repaintTranslationReceipts)return;
  const ids=[...repaints];repaints.clear();reader.repaintTranslationReceipts(ids);
 };
 const coordinator=createReaderAutoTranslation({getScope:scope,step:async(input,{signal})=>{
  const response=await request('/api/library/books/'+encodeURIComponent(bookId)+'/reading-translation',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input),signal}),receipt=await response.json();
  if(!response.ok)throw Object.assign(Error('Translation preparation stopped'),{status:response.status,code:receipt.code});return receipt;
 },onPassage:async(receipt,readingScope)=>{
  const reader=getReader(),book=reader?.getBook?.(),index=book?.chapters.findIndex(c=>c.id===readingScope.chapterId),expected=receipt.phase==='current'?readingScope.chapterId:book?.chapters[index+1]?.id;
  if(receipt.chapterId!==expected||!expected)throw Error('Translation chapter cannot be verified');
  await reader?.ensureChapter?.(receipt.chapterId);
  const fresh=scope();if(disposed||!canRun(fresh)||identity(fresh)!==identity(readingScope))return;
  if(!mergeReadingTranslationReceipt(reader.getBook(),receipt))throw Error('Translation source cannot be verified');
  repaints.add(receipt.passage.id);flush();
  doc.dispatchEvent(new CustomEvent('reader:translation',{detail:{...receipt.passage,contentVersion:receipt.contentVersion,automatic:true,reveal:false}}));
 },onState:value=>{view=value;paint();}});
 on(toggle,'change',()=>{enabled=toggle.checked;try{storage?.setItem(key,String(enabled));}catch{}coordinator.refresh();paint();});on(retry,'click',()=>coordinator.retry());
 on(source,'click',()=>{const select=doc.getElementById('view-mode');select.value='en';select.dispatchEvent(new Event('change',{bubbles:true}));});
 for(const event of ['reader:ready','reader:chapter','reader:layout','reader:content','visibilitychange'])on(doc,event,()=>{coordinator.refresh();paint();flush();});
 for(const event of ['reader:selection-end','selectionchange'])on(doc,event,()=>queueMicrotask(flush));
 const offLocale=onLocaleChange(paint),dispose=()=>{if(disposed)return;disposed=true;coordinator.dispose();root.remove();offLocale();for(const off of listeners)off();};on(doc,'reader:session-changed',dispose);
 paint();coordinator.refresh();return {dispose};
}
// Web and packaged Android use the same foreground, serial stepper. No timer
// retries: a rejection stays visible in tools until retry or a new scope.
export function createReaderAutoTranslation({getScope,step,onPassage=()=>{},onState=()=>{}}={}){
 let currentKey=null,controller=null,disposed=false,finished=false,status='paused',lastState={status};
 const publish=(value,scope)=>{status=value.status;lastState={...value,chapterId:scope?.chapterId};onState(lastState);};
 function stop(){controller?.abort();controller=null;}
 function refresh({retry=false}={}){
  if(disposed)return;
  const scope=getScope(),key=identity(scope),changed=key!==currentKey;
  if(changed){stop();currentKey=key;finished=false;status='paused';}
  if(!canRun(scope)){stop();if(status!=='failed')publish({status:'paused'},scope);return;}
  if(controller||finished&&!retry||status==='failed'&&!retry)return;
  finished=false;const activeController=new AbortController();controller=activeController;
  const active=()=>!disposed&&controller===activeController&&!activeController.signal.aborted&&identity(getScope())===key&&canRun(getScope());
  void(async()=>{
   try{
    const seen=new Set();
    for(const phase of ['current','next']){
     let done=false;
     while(active()&&!done){
      publish({status:'preparing',phase},scope);
      const receipt=await step({chapterId:scope.chapterId,contentVersion:scope.contentVersion,phase,...(phase==='current'&&seen.size===0&&scope.passageId?{passageId:scope.passageId}:{})},{signal:activeController.signal,scope});
      if(!active())return;
      if(receipt?.contentVersion!==scope.contentVersion||receipt.phase!==phase||typeof receipt.done!=='boolean'||phase==='current'&&receipt.chapterId!==scope.chapterId||phase==='next'&&receipt.chapterId===scope.chapterId||receipt.chapterId===null&&!receipt.done||!receipt.done&&!receipt.passage)throw Error('Translation receipt cannot be verified');
      if(receipt.passage){
       if(typeof receipt.passage.id!=='string'||seen.has(receipt.passage.id))throw Error('Translation preparation made no progress');
       seen.add(receipt.passage.id);await onPassage(receipt,scope);
      }
      done=receipt.done;
     }
    }
    if(active()){finished=true;publish({status:'ready'},scope);}
   }catch(error){if(active()){finished=true;publish({status:'failed',error},scope);}}
   finally{if(controller===activeController)controller=null;}
  })();
 }
 return {refresh,retry:()=>refresh({retry:true}),getState:()=>lastState,dispose(){disposed=true;stop();}};
}
