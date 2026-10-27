// Bump this when the paragraph/context or notes policy changes. An
// acknowledgement records an explanation, never billing or model authority.
export const TRANSLATION_DISCLOSURE_POLICY='paragraph-neighbors-no-notes:v1';
const defaultStorage=()=>{try{return globalThis.localStorage;}catch{return null;}};
export async function confirmTranslationFirstUse({scope,signal,isCurrent=()=>true,storage=defaultStorage(),confirm}={}){
  const current=()=>!signal?.aborted&&isCurrent();
  if(!current())return false;
  const fields=[scope?.owner,scope?.bookId,scope?.contentVersion,scope?.policy];
  // Unknown identities/versions can acknowledge this click, but never share a
  // persistent anonymous record or inherit another account's explanation.
  const key=fields.every(value=>typeof value==='string'&&value.trim())&&scope.owner!=='guest'
    ? 'marginalia-translation-disclosure:v1:'+JSON.stringify(fields):null;
  try{if(key&&storage?.getItem(key)==='acknowledged'&&current())return true;}catch{}
  if(typeof confirm!=='function'||!await confirm({signal,isCurrent:current})||!current())return false;
  // Failure to persist is not remembered in a global fallback: explain again
  // next time. No passage text, notes, credentials or results enter storage.
  try{if(key)storage?.setItem(key,'acknowledged');}catch{}
  return true;
}

export function showTranslationFirstUse({document:doc,signal,isCurrent=()=>true,opener,labels,
  onLocaleChange=()=>()=>{},prepareOverlay=()=>null,getOverlayRevision=()=>null,
  canFocus=node=>!!node?.isConnected&&!node.hidden,privacyHref=()=>'/privacy'}={}){
  if(!doc?.body||signal?.aborted||!isCurrent())return Promise.resolve(false);
  const trigger=prepareOverlay()||opener,revision=getOverlayRevision();
  if(signal?.aborted||!isCurrent())return Promise.resolve(false);
  if(!doc.getElementById('translation-first-use-style')){const style=doc.createElement('link');style.id='translation-first-use-style';style.rel='stylesheet';style.href='/translation-first-use.css';(doc.head||doc.body).append(style);}
  const dialog=doc.createElement('dialog');dialog.id='translation-first-use';dialog.className='translation-first-use';
  const title=doc.createElement('h2'),body=doc.createElement('p'),privacy=doc.createElement('a'),actions=doc.createElement('div');
  const cancel=doc.createElement('button'),accept=doc.createElement('button');cancel.type=accept.type='button';
  title.id='translation-first-use-title';body.id='translation-first-use-body';
  dialog.setAttribute('aria-labelledby',title.id);dialog.setAttribute('aria-describedby',body.id);dialog.setAttribute('aria-modal','true');
  privacy.target='_blank';privacy.rel='noopener noreferrer';actions.className='translation-first-use-actions';
  actions.append(cancel,accept);dialog.append(title,body,privacy,actions);
  const paint=()=>{const text=labels();title.textContent=text.title;body.textContent=text.body;cancel.textContent=text.cancel;accept.textContent=text.accept;privacy.textContent=text.privacy;privacy.href=privacyHref();};
  paint();
  return new Promise(resolve=>{
    let settled=false,offLocale=()=>{};
    const current=()=>!signal?.aborted&&isCurrent()&&getOverlayRevision()===revision;
    const finish=(confirmed,focus=true)=>{
      if(settled)return;settled=true;
      const ownedFocus=doc.activeElement===doc.body||dialog.contains?.(doc.activeElement);
      const valid=current();
      signal?.removeEventListener('abort',abort);offLocale();
      if(dialog.open&&typeof dialog.close==='function')dialog.close();dialog.remove();
      if(focus&&valid&&ownedFocus&&canFocus(trigger))trigger.focus({preventScroll:true});
      resolve(Boolean(confirmed&&valid));
    };
    const abort=()=>finish(false,false);
    cancel.addEventListener('click',()=>finish(false));accept.addEventListener('click',()=>finish(true));
    dialog.addEventListener('cancel',event=>{event.preventDefault();event.stopPropagation();finish(false);});
    dialog.addEventListener('close',()=>finish(false));
    dialog.addEventListener('keydown',event=>{
      if(event.key==='Escape'){event.preventDefault();event.stopPropagation();finish(false);}
      if(event.key==='Tab'){
        const order=[privacy,cancel,accept],at=order.indexOf(doc.activeElement);
        event.preventDefault();order[(at+(event.shiftKey?-1:1)+order.length)%order.length].focus();
      }
    });
    signal?.addEventListener('abort',abort,{once:true});offLocale=onLocaleChange(paint);
    doc.body.append(dialog);
    try{
      if(typeof dialog.showModal==='function')dialog.showModal();else dialog.setAttribute('open','');
      cancel.focus({preventScroll:true});
      if(!current())finish(false,false);
    }catch{finish(false,false);}
  });
}


// The original paid retry identity stays separate from explanation and point
// consent, and is created only after this explicit translation decision.
export function translationIntent({owner,bookId,contentVersion,passageId,storage}={}){
  if(typeof owner!=='string'||!owner)throw Error('Translation request owner unavailable');
  const key='marginalia-translation-intent:v1:'+JSON.stringify([owner,bookId,contentVersion,passageId]);
  try{if(storage===undefined)storage=globalThis.sessionStorage;}catch{}
  if(!storage||typeof storage.getItem!=='function'||typeof storage.setItem!=='function')throw Error('Translation request identity unavailable');
  let id=storage.getItem(key);if(typeof id!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(id)){id=globalThis.crypto.randomUUID();storage.setItem(key,id);}
  return {id,clear:()=>{try{storage.removeItem(key);}catch{}}};
}
export const knownTerminal=result=>/^credit-[a-f0-9]{64}$/.test(result?.billingOperation?.id||'')&&['released','cancelled','reversed','not_started'].includes(result.billingOperation.status);

export function acknowledgeTranslation({scope,storage,signal,isCurrent,document,opener,t,onLocaleChange,privacyHref,readerTools,focusableTrigger,overlayOpen,confirmDisclosure}={}){
  return confirmTranslationFirstUse({scope,storage,signal,isCurrent,
    confirm:options=>(confirmDisclosure||showTranslationFirstUse)({...options,document,opener,onLocaleChange,
      prepareOverlay:()=>readerTools()?.prepareOverlay('translation-first-use'),getOverlayRevision:()=>readerTools()?.getOverlayRevision(),canFocus:node=>focusableTrigger(node)&&!overlayOpen(document),privacyHref,
      labels:()=>({title:t('translation.firstUse.title'),body:t('translation.firstUse.body'),accept:t('translation.firstUse.accept'),cancel:t('translation.firstUse.cancel'),privacy:t('translation.firstUse.privacy')})})});
}
