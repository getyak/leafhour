import {getUiLinkLocale,uiReady,t,onUiLocaleChange,uiHref,getUiLocale,createUiLabels} from './ui-locale.mjs';
import {sourceDescriptionMessages} from './document-source.mjs';
import {selectedBookId,readerSession,readerFetch} from './reader-api.mjs';
import {chineseOriginalOnly} from './source-language.mjs';
import {createTranslationPresentation,hasDualDrafts} from './translation-state.mjs';
import {readerLoginUrl} from './reader-return.mjs';
import {translationDisclosureMessage} from './catalog-sample.mjs';
import {creditActionLabel,creditErrorId} from './credit-labels.mjs';
import {readerTools} from './reader-tools.mjs';
import {focusableTrigger,overlayOpen} from './popover-controls.mjs';

export function mountReaderTranslation({bookId,session,document:doc=globalThis.document,getReader=()=>globalThis.window?.marginaliaReader,request=readerFetch,navigate=url=>globalThis.location.assign(url),urlApi=globalThis.URL,timers=globalThis,intentStorage,disclosureStorage,confirmDisclosure,getDisclosurePolicy,loadDisclosure=()=>import('./translation-first-use.mjs')}={}){
  if(!bookId||!doc)return null;
  const tools=doc.getElementById('paragraph-tools'),button=doc.createElement('button');button.id='translate-passage';button.type='button';tools.prepend(button);
  const scope=doc.createElement('small');scope.id='translation-action-scope';scope.className='translation-action-scope';scope.hidden=true;
  const hint=doc.createElement('p');hint.className='translation-notice';hint.hidden=true;hint.setAttribute('role','status');tools.append(scope,hint);
  const billingLink=doc.createElement('a');billingLink.className='billing-link';
  const sourceReview=doc.createElement('details');sourceReview.className='source-review';sourceReview.hidden=true;doc.getElementById('translation-details').append(sourceReview);
  const labels=createUiLabels(),links=new Map(),listeners=[],fileListeners=[],urls=new Map();
  let tasks=createTranslationPresentation(),book,bookVersion,epoch=0,disposed=false,controller=new AbortController(),cachedView,about,successTimer;
  const on=(target,name,handler)=>{target.addEventListener(name,handler);listeners.push(()=>target.removeEventListener(name,handler));};
  const active=ticket=>!disposed&&ticket===epoch;
  const message=value=>typeof value==='string'?value:value?.id?t(value.id,value.params):'';
  const sourceHref=(link,target)=>{links.set(link,target);link.href=uiHref(target);};
  const selectedPassage=()=>book?.sections.flatMap(s=>s.paragraphs).find(p=>p.id===tasks.selectedId());
  const capturedOwner=session?.user?.id,privacyLink=doc.getElementById('translation-privacy-link');
  const privacyHref=()=>uiHref(({'zh-Hans':'/zh-hans/privacy','zh-Hant':'/zh-hant/privacy',ja:'/ja/privacy'})[getUiLocale()]||'/privacy');
  let decisionRevision=0,pendingDecision=null;
  const invalidateDecision=()=>{decisionRevision++;const pending=pendingDecision;pendingDecision=null;pending?.abort();};
  function paintLabels(){
    if(disposed)return;
    if(cachedView){
      const priced=session?.billing?.enabled===true&&!cachedView.disabled&&!hasDualDrafts(selectedPassage())&&['translation.translate','translation.retry'].includes(cachedView.label?.id);
      // The sign-in gate explains an action, so it belongs beside that action. The
      // heading keeps reporting the passage itself instead of switching topics.
      const gate=cachedView.label?.id==='translation.login';
      button.textContent=message(cachedView.label)+(priced?' · '+creditActionLabel('translation',getUiLocale()):'');
      // Routine book facts belong in explicit details. Only passage decisions
      // and actual task outcomes enter the live region; hidden means no text,
      // accessible-name duplicate, margin, or collapsed guidance shell.
      const notices=gate?[{id:'translation.untranslated'}]:cachedView.notice.filter(value=>!/^translation\.(savedNotice|chineseNotice)$/.test(value?.id));
      const focused=doc.activeElement===billingLink,destination=notices.some(value=>/\.(background|translatingNotice|originalRemains)/.test(value?.id))?doc.getElementById('reading-session'):tools;
      if(hint.parentElement!==destination)destination.append(hint);
      hint.textContent=notices.map(message).join(' ');hint.hidden=!hint.textContent;
      scope.hidden=!(tasks.selectedId()&&gate);scope.textContent=scope.hidden?'':cachedView.notice.map(message).join('');
      if(scope.hidden)button.removeAttribute('aria-describedby');else button.setAttribute('aria-describedby',scope.id);
      if(notices.some(value=>value?.id==='credit.funds')){billingLink.textContent=t('billing.accountLink');billingLink.href=uiHref('/billing');hint.append(billingLink);if(focused)billingLink.focus({preventScroll:true});}
    }
    if(about)doc.getElementById('translation-about').textContent=message(about);
    if(privacyLink)privacyLink.href=privacyHref();
    labels.refresh();for(const [link,target]of links)link.href=uiHref(target);
  }
  function renderTranslation(){
    if(disposed)return;
    cachedView=tasks.view(selectedPassage(),{authenticated:!!session?.user,available:!!session?.translationAvailable,loginAvailable:!!(session?.passwordAvailable||session?.emailAvailable||session?.localAvailable||session?.providers?.google||session?.providers?.apple)});
    button.disabled=cachedView.disabled||!!pendingDecision;paintLabels();
  }
  // Every request belongs to the current book view. Cancelling this UI never
  // changes a server job or the saved result of an already authorized request.
  async function scopedRequest(ticket,target,options={}){
    if(!active(ticket))throw Error('Translation view disposed');
    return request(target,{...options,signal:options.signal||controller.signal});
  }
  async function originalFile(container,ticket){
    let policy;
    const current=()=>active(ticket)&&container.isConnected,read=(target,options)=>{if(!current())return Promise.reject(Error('Original view disposed'));return scopedRequest(ticket,target,options);};
    const checking=doc.createElement('span');container.replaceChildren(checking);labels.text(checking,'source.checking');
    try{
      const response=await read('/api/original/info'),info=await response.json();
      if(!current())return;
      if(!response.ok)throw Error('Original unavailable');container.replaceChildren();
      if(!info.available){
        // Keep the container free of a text binding before adding children.
        const notice=doc.createElement('span'),link=doc.createElement('a');labels.text(notice,'source.unavailable');labels.text(link,'source.restore');sourceHref(link,'/library');container.append(notice,doc.createElement('br'),link);return;
      }
      const resume={},download=doc.createElement('button'),status=doc.createElement('span');download.type='button';download.className='source-download';labels.text(download,'source.download');status.setAttribute('role','status');container.append(download,status);
      const onDownload=async()=>{
        if(!current()||download.disabled)return;download.disabled=true;labels.text(status,'source.downloading');
        try{
          let assembled;
          if(info.bytes>8*1024*1024&&session?.directUpload){
            const manifest=await read('/api/original/parts'),plan=await manifest.json();if(!current())return;if(!manifest.ok)throw Error('Original parts unavailable');
            const {downloadOriginalParts}=await import('./original-download.mjs');
            assembled=await downloadOriginalParts({parts:plan.parts,sha256:info.sha256,bytes:info.bytes,resume,
              rangeFetcher:({offset,length,signal})=>read('/api/original/range?sha256='+info.sha256+'&offset='+offset+'&length='+length,{signal}),
              refreshParts:async({signal})=>{const response=await read('/api/original/parts',{signal}),plan=await response.json();if(!current()||!response.ok)throw Error('Original parts unavailable');return plan.parts;},
              onBytes:(received,total)=>{if(current())labels.text(status,'source.downloadProgress',{percent:Math.round(received/total*100)});}});
          }
          const response=assembled?new Response(assembled):await read('/api/original');if(!current())return;if(!response.ok)throw Error('Original download unavailable');
          const blob=await response.blob();if(!current())return;
          const url=urlApi.createObjectURL(blob),anchor=doc.createElement('a');anchor.href=url;anchor.download=info.filename;anchor.click();
          const timer=timers.setTimeout(()=>{urlApi.revokeObjectURL(url);urls.delete(url);},1000);urls.set(url,timer);labels.text(status,'source.downloadReady');
        }catch{if(current())labels.text(status,'source.downloadFailed');}
        finally{if(current())download.disabled=false;}
      };download.addEventListener('click',onDownload);fileListeners.push(()=>download.removeEventListener('click',onDownload));
    }catch{if(current())labels.text(container,'source.checkFailed');}
  }
  function ready(){
    if(disposed)return;const next=getReader()?.getBook?.();if(!next)return;if(next.bookId!==bookId){dispose();return;}
    const changed=!book||bookVersion!==next.contentVersion;
    book=next;bookVersion=next.contentVersion;if(changed){invalidateDecision();epoch++;controller.abort();controller=new AbortController();tasks=createTranslationPresentation();}
    // This rebuild belongs to an explicit book-ready event, never to locale.
    const ticket=epoch;for(const remove of fileListeners.splice(0))remove();labels.clear();links.clear();sourceReview.replaceChildren();sourceReview.hidden=book.visibility!=='private';about=translationDisclosureMessage(book);
    if(!sourceReview.hidden){
      const summary=doc.createElement('summary'),filename=doc.createElement('p'),detail=doc.createElement('p'),original=doc.createElement('div'),reviewLink=doc.createElement('a');
      labels.text(summary,book.source?.review==='visually_checked'?'source.reviewed':book.source?.format==='epub'?'source.epubPending':book.source?.format==='pdf'?'source.pdfPending':'source.textPending');
      filename.className='source-filename';filename.textContent=book.source?.filename||'';
      for(const id of sourceDescriptionMessages(book)){const part=doc.createElement('span');labels.text(part,id);detail.append(part);}
      original.className='source-file-action';reviewLink.className='source-download';labels.text(reviewLink,'source.reviewLink');sourceHref(reviewLink,'/source-review?book='+encodeURIComponent(bookId));sourceReview.append(summary,filename,detail,reviewLink,original);void originalFile(original,ticket);
    }
    const onlyOriginal=chineseOriginalOnly(book);renderTranslation();for(const choice of doc.querySelectorAll('[data-passage-variant]'))choice.hidden=onlyOriginal;
    for(const id of ['show-xray','show-stance','show-echo','show-chat','chapter-invitations']){const node=doc.getElementById(id);if(node)node.hidden=true;}
    for(const link of doc.querySelectorAll('a[href^="/exports/"],a[href="/evals"],a[href="/api/experiences/export"]'))link.hidden=true;
    const invitation=doc.getElementById('chapter-invitations')?.closest('.settings-habit');if(invitation)invitation.hidden=true;
  }
  on(doc,'reader:ready',ready);
  on(doc,'reader:selection',()=>{if(disposed)return;invalidateDecision();tasks.select(getReader()?.getSelectedId?.()||null);renderTranslation();});
  for(const event of ['reader:chapter','reader:selection-end'])on(doc,event,()=>{if(disposed)return;invalidateDecision();tasks.select(null);renderTranslation();});
  on(button,'click',async()=>{
    if(disposed)return;const passage=selectedPassage();if(!passage)return;
    if(hasDualDrafts(passage)){doc.dispatchEvent(new CustomEvent('reader:translation',{detail:{...passage,reveal:true}}));renderTranslation();return;}
    if(!session?.user){if(!button.disabled)navigate(readerLoginUrl({bookId,passageId:passage.id,action:'translate',ui:getUiLinkLocale()}));return;}
    if(button.disabled||pendingDecision)return;
    const passageId=passage.id,ticket=epoch,version=bookVersion,revision=++decisionRevision,decision=new AbortController();
    let policy;
    const current=()=>active(ticket)&&revision===decisionRevision&&session?.user?.id===capturedOwner&&(policy===undefined||!getDisclosurePolicy||getDisclosurePolicy()===policy)&&tasks.selectedId()===passageId&&getReader()?.getBook?.()?.bookId===bookId&&getReader()?.getBook?.()?.contentVersion===version;
    pendingDecision=decision;renderTranslation();let dispatched=false;
    try{
      const disclosure=await loadDisclosure();if(!current())return;
      policy=getDisclosurePolicy?.()??disclosure.TRANSLATION_DISCLOSURE_POLICY;
      const acknowledged=await disclosure.acknowledgeTranslation({scope:{owner:capturedOwner,bookId,contentVersion:version,policy},storage:disclosureStorage,signal:decision.signal,isCurrent:current,
        document:doc,opener:button,t,onLocaleChange:onUiLocaleChange,privacyHref,readerTools,focusableTrigger,overlayOpen,confirmDisclosure});
      if(!acknowledged||!current())return;
      const intent=session?.billing?.enabled===true?disclosure.translationIntent({owner:capturedOwner,bookId,contentVersion:version,passageId,storage:intentStorage}):null;
      const response=await scopedRequest(ticket,'/api/translate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({passageId,contentVersion:version,...(intent?{id:intent.id}:{})}),
        onDispatch:()=>{if(!current())throw Object.assign(Error('Translation selection changed'),{preSubmit:true});dispatched=true;if(pendingDecision===decision)pendingDecision=null;tasks.begin(passageId);renderTranslation();}}),result=await response.json();if(!active(ticket))return;
      if(intent&&disclosure.knownTerminal(result))intent.clear();
      if(!response.ok)throw Object.assign(Error('Translation unavailable'),{status:response.status});
      if(result.id!==passageId||!hasDualDrafts(result)){tasks.fail(passageId,{id:'translation.incomplete'});return;}
      intent?.clear();
      doc.dispatchEvent(new CustomEvent('reader:translation',{detail:{...result,reveal:tasks.complete(passageId)}}));
      // The reader has now adopted the saved variants. Refresh their facts
      // immediately; this change does not emit a new reader:ready event.
      book=getReader()?.getBook?.()||book;about=translationDisclosureMessage(book);
      if(successTimer!=null)timers.clearTimeout(successTimer);
      successTimer=timers.setTimeout(()=>{successTimer=null;if(active(ticket)&&tasks.acknowledgeSaved(passageId))renderTranslation();},6000);
    }catch(error){if(active(ticket)&&(dispatched||current()))tasks.fail(passageId,{id:creditErrorId(error)||'translation.failed'});}
    finally{if(pendingDecision===decision)pendingDecision=null;if(active(ticket))renderTranslation();}
  });
  const unsubscribe=onUiLocaleChange(paintLabels);
  const dispose=()=>{if(disposed)return;disposed=true;invalidateDecision();epoch++;controller.abort();if(successTimer!=null)timers.clearTimeout(successTimer);unsubscribe();for(const remove of [...listeners,...fileListeners])remove();for(const [url,timer]of urls){timers.clearTimeout(timer);urlApi.revokeObjectURL(url);}urls.clear();labels.clear();links.clear();button.remove();scope.remove();hint.remove();billingLink.remove();sourceReview.remove();};
  on(doc,'reader:session-changed',dispose);renderTranslation();if(getReader()?.getBook?.())ready();
  return {dispose};
}

await uiReady;
if(selectedBookId&&globalThis.document){
 const translation=mountReaderTranslation({bookId:selectedBookId,session:readerSession});
 let automatic,automaticDisposed=false;
 const startAutomatic=()=>{
  if(automaticDisposed)return;
  void import('./reader-auto-translation.mjs').then(module=>{if(!automaticDisposed)automatic=module.mountReaderAutomaticTranslation({bookId:selectedBookId,session:readerSession,request:readerFetch,getLocale:getUiLocale,onLocaleChange:onUiLocaleChange});}).catch(()=>{});
 };
 if(window.marginaliaReader?.getBook?.())startAutomatic();else document.addEventListener('reader:ready',startAutomatic,{once:true});
 const pagehide=event=>{if(event.persisted)return;globalThis.removeEventListener?.('pagehide',pagehide);automaticDisposed=true;document.removeEventListener('reader:ready',startAutomatic);translation?.dispose();automatic?.dispose();};
 globalThis.addEventListener?.('pagehide',pagehide);
}
