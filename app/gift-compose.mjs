import {createGiftPreview,giftUiLocaleMessage} from './gift-preview.mjs';
import {uiHref,getUiLocale,onUiLocaleChange,t,uiReady} from './ui-locale.mjs';
import {createGiftDrafts} from './gift-compose-state.mjs';
import {publicGiftSender} from './gift-identity.mjs';
import {readGiftQuote} from './gift-quote.mjs';
import {trackActionFocus} from './action-focus.mjs';
import {paintBookIdentity} from './book-cover-ui.mjs';
import {bookCoverLabel} from './book-binding.mjs';
const node=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
const button=(text,cls='')=>{const n=node('button',cls,text);n.type='button';return n;};
let localeInitialized=false;void uiReady.then(()=>{localeInitialized=true;});
const title=book=>bookCoverLabel(book,getUiLocale()).title||t('giftCompose.book');

export function mountGiftComposer({api,dialog,body,getSession,getOwner,show,current,message,cover}){
  const state=createGiftDrafts();let lifecycle=null;
  dialog.addEventListener('close',()=>lifecycle?.abort());
  function clear(){lifecycle?.abort();state.clear();}
  async function open(book){
    lifecycle?.abort();lifecycle=new AbortController();const instance=lifecycle,signal=instance.signal;
    if(!localeInitialized)await uiReady;if(signal.aborted)return;
    const ticket=show(book,{id:'giftCompose.write'}),owner=getOwner(),key=owner+'\n'+book.bookId,active=()=>{if(signal.aborted)return false;if(owner!==getOwner()){instance.abort();return false;}return current(ticket);};
    // Per-opening leaf ownership: no account, book, draft or native-input
    // reads on a language commit. Actual callbacks retain active()'s owner
    // check and permanent abort; parent clear/close is the real owner boundary.
    const labels=new Map(),frameworks=new Set(),links=new Map();let noticeState=null;
    const label=(n,id,params,attribute)=>{const item={id:'giftCompose.'+id,params:params?Object.freeze({...params}):undefined,attribute};if(!labels.has(n))labels.set(n,new Map());labels.get(n).set(attribute||'text',item);if(attribute)n.setAttribute(attribute,t(item.id,item.params));else{n.textContent=t(item.id,item.params);n.setAttribute('lang',getUiLocale());}return n;};
    const uiNode=(tag,cls,id,params)=>label(node(tag,cls),id,params),uiButton=(id,cls='')=>label(button('',cls),id);
    const attr=(n,name,id)=>label(n,id,undefined,name);
    // The two framework leaves may change order/wording; the literal name's
    // node is never rewritten, preserving selection and attribution.
    const mixed=(container,id,param,value)=>{const before=node('span'),literal=node('span','',value),after=node('span');literal.setAttribute('lang','und');container.append(before,literal,after);const paint=()=>{const parts=t('giftCompose.'+id,{[param]:'\uE000'}).split('\uE000');before.textContent=parts[0];after.textContent=parts[1]||'';};frameworks.add({container,paint});paint();return container;};
    const release=container=>{for(const a of links.keys())if(a===container||container.contains(a))links.delete(a);for(const n of labels.keys())if(n===container||container.contains(n))labels.delete(n);for(const item of frameworks)if(item.container===container||container.contains(item.container))frameworks.delete(item);};
    const notice=(id,error=false)=>{noticeState=id?{id,error}:null;message(id?t('giftCompose.'+id):'',error);};
    dialog.classList.add('gift-compose-dialog');
    const intro=uiNode('p','gift-writing-intro','intro'),steps=node('ol','gift-writing-steps');attr(steps,'aria-label','steps');
    for(const id of ['stepWrite','stepPreview','stepSeal'])steps.append(uiNode('li','',id));
    const writing=node('section','gift-writing-stage'),preview=node('section','gift-preview-stage'),result=node('section','gift-sealed-stage');preview.hidden=result.hidden=true;
    const bookName=(tag,cls='')=>{if(!book.title?.zh&&!book.title?.en)return uiNode(tag,cls,'book');return paintBookIdentity(node(tag,cls),book);};
    const paper=node('div','gift-writing-paper'),bookSlip=node('div','gift-writing-book'),bookCopy=node('div');bookCopy.append(bookName('strong'));if(book.author)bookCopy.append(paintBookIdentity(node('small'),book,'author'));bookSlip.append(cover(book),bookCopy);
    const address=node('label','gift-writing-address'),recipient=node('input');recipient.id='gift-recipient';recipient.maxLength=80;attr(recipient,'placeholder','recipient');attr(recipient,'aria-label','recipient');recipient.autocomplete='off';address.htmlFor=recipient.id;address.append(uiNode('span','','to'),recipient);
    const wordsLabel=uiNode('label','sr-only','words'),words=node('textarea','gift-writing-words');words.id='gift-message';words.maxLength=500;words.rows=5;attr(words,'placeholder','wordsPlaceholder');wordsLabel.htmlFor=words.id;words.setAttribute('aria-describedby','gift-message-help');
    const sender=publicGiftSender(getSession().user),signature=node('div','gift-writing-signature');const senderNode=node('span','',sender),dateNode=node('small'),createdDay=Date.now();senderNode.setAttribute('lang','und');const paintDate=()=>{dateNode.textContent=new Intl.DateTimeFormat(getUiLocale(),{year:'numeric',month:'long',day:'numeric'}).format(new Date(createdDay));};paintDate();signature.append(senderNode,dateNode);
    recipient.setAttribute('lang','und');words.setAttribute('lang','und');bookCopy.setAttribute('lang','und');paper.append(bookSlip,address,wordsLabel,words);
    // The optional quotation is prepared from this book's original only. The
    // statement is visible before any result arrives; removing or retrying it
    // never touches the handwritten message or recipient.
    const quoteBox=node('div','gift-quote-block'),quoteIntro=uiNode('p','gift-quote-intro','quoteIntro'),quoteStatus=node('p','gift-quote-status'),quoteFigure=node('figure','gift-quote-figure'),quoteText=node('blockquote','gift-quote-text'),quoteMeta=node('figcaption','gift-quote-meta'),quoteSource=node('span','gift-quote-source'),quoteLabel=node('small','gift-quote-label'),quoteActions=node('div','gift-quote-actions');
    const quoteRemove=uiButton('quoteRemove','text-link'),quoteRetry=uiButton('quoteRetry','text-link'),quoteNote=uiNode('p','gift-quote-note','quoteNote');
    quoteText.setAttribute('lang','und');quoteStatus.setAttribute('aria-live','polite');quoteMeta.append(quoteSource,quoteLabel);quoteFigure.append(quoteText,quoteMeta);quoteActions.append(quoteRemove,quoteRetry);quoteBox.append(quoteIntro,quoteStatus,quoteFigure,quoteActions,quoteNote);paper.append(quoteBox,signature);
    const options=node('div','gift-writing-options'),included=node('label'),translations=node('input');translations.type='checkbox';translations.checked=true;included.append(translations,uiNode('span','','translations'));options.append(included,uiNode('p','gift-writing-scope','scope'));
    const help=uiNode('p','gift-writing-help','help');help.id='gift-message-help';
    const previewButton=uiButton('preview','primary'),writeActions=node('div','gift-writing-actions');writeActions.append(help,previewButton);writing.append(paper,options,writeActions);
    const previewBar=node('div','gift-preview-bar'),back=uiButton('back','text-link');previewBar.append(back,uiNode('span','','previewCaption'));
    const frame=node('iframe','gift-preview-frame');attr(frame,'title','frameTitle');frame.src=uiHref('/gift-preview');frame.referrerPolicy='no-referrer';
    const previewActions=node('div','gift-preview-actions'),seal=uiButton('seal','primary');previewActions.append(uiNode('p','','previewNote'),seal);preview.append(previewBar,frame,previewActions);
    const history=node('details','gift-compose-history'),historyRows=node('div');history.append(uiNode('summary','','history'),historyRows);history.hidden=true;
    body.append(intro,steps,writing,preview,result,history);
    let stage='writing',ready=false,publishing=false,quote=null,quotePhase='pending',quoteTicket=0,removedQuote=null;
    const values=()=>({recipient:recipient.value.trim(),message:words.value.trim(),includeTranslations:translations.checked});
    const currentQuote=()=>quotePhase==='ready'&&quote?quote:null;
    function renderQuote(){
      const showing=currentQuote();quoteFigure.hidden=!showing;
      if(showing){if(quoteText.textContent!==showing.text)quoteText.textContent=showing.text;labels.delete(quoteSource);if(showing.chapterTitle){quoteSource.textContent=showing.chapterTitle;quoteSource.setAttribute('lang','und');}else label(quoteSource,'quoteSource');label(quoteLabel,showing.selection==='ai-selected'?'quoteAi':'quoteExcerpt');}
      else{for(const n of [quoteText,quoteSource,quoteLabel]){labels.delete(n);n.textContent='';}}
      quoteIntro.hidden=!!showing;
      quoteRemove.disabled=!showing;quoteRetry.disabled=quotePhase==='pending';
      // Recovery wording: a retry restores a failed selection and may return
      // the very same original excerpt. It is never a promise of new text.
      label(quoteRetry,quotePhase==='removed'&&removedQuote?'quoteRestore':'quoteRetry');
      labels.delete(quoteStatus);if(showing)quoteStatus.textContent='';else label(quoteStatus,quotePhase==='pending'?'quotePending':quotePhase==='none'?'quoteNone':quotePhase==='removed'?'quoteRemoved':'quoteFailed');
    }
    async function loadQuote(){
      const attempt=++quoteTicket;quote=null;quotePhase='pending';renderQuote();
      try{
        const data=await api('/api/library/books/'+encodeURIComponent(book.bookId)+'/gift-quote',{});
        // A slow answer for another dialog, account, book or revision must never
        // replace this composer's state or feed a share.
        if(!active()||attempt!==quoteTicket)return;
        if(data?.bookId!==book.bookId||(book.contentVersion&&data?.contentVersion&&data.contentVersion!==book.contentVersion)){quotePhase='failed';renderQuote();return;}
        if(data?.quote==null){quotePhase='none';renderQuote();return;}
        const normalized=readGiftQuote(data.quote,{requireReceipt:true});
        if(!normalized){quotePhase='failed';renderQuote();return;}
        quote=normalized;quotePhase='ready';renderQuote();if(stage==='preview')sendPreview();
      }catch{if(!active()||attempt!==quoteTicket)return;quotePhase='failed';renderQuote();}
    }
    function remember(){if(active())state.remember(key,values());}
    const existing=state.draft(key);if(existing){recipient.value=existing.recipient;words.value=existing.message;translations.checked=existing.includeTranslations;}
    function setStage(next){stage=next;writing.hidden=next!=='writing';preview.hidden=next!=='preview';result.hidden=next!=='sealed';intro.hidden=next!=='writing';for(const [index,item]of [...steps.children].entries()){if(index===['writing','preview','sealed'].indexOf(next))item.setAttribute('aria-current','step');else item.removeAttribute('aria-current');}notice('');}
    function sendPreview(){if(active()&&ready)frame.contentWindow?.postMessage(createGiftPreview(book,getSession().user,{...values(),...(currentQuote()?{quote:currentQuote()}:{})}),location.origin);}
    // The library can hand the still-open shared dialog to another view
    // without a close/clear event. Observe this instance's retained DOM only;
    // losing ownership is terminal even if those nodes are later reattached.
    const ownsView=()=>{if(signal.aborted)return false;if(!dialog.open||intro.parentElement!==body||!intro.isConnected||!body.isConnected||!dialog.contains(body)){instance.abort();return false;}return true;};
    function sendUi(){if(ownsView()&&ready)frame.contentWindow?.postMessage(giftUiLocaleMessage(getUiLocale()),location.origin);}
    const updateUi=()=>{if(!ownsView())return;for(const [n,slots]of labels)for(const item of slots.values()){if(item.attribute)n.setAttribute(item.attribute,t(item.id,item.params));else{n.textContent=t(item.id,item.params);n.setAttribute('lang',getUiLocale());}}for(const item of frameworks)item.paint();for(const [a,path]of links)a.href=uiHref(path);paintDate();if(noticeState)message(t('giftCompose.'+noticeState.id),noticeState.error);sendUi();};
    const unsubscribeUi=onUiLocaleChange(updateUi);signal.addEventListener('abort',()=>{unsubscribeUi();labels.clear();frameworks.clear();links.clear();noticeState=null;},{once:true});
    for(const input of [recipient,words,translations])input.addEventListener('input',remember,{signal});
    quoteRemove.addEventListener('click',()=>{if(!currentQuote())return;removedQuote=quote;quote=null;quotePhase='removed';renderQuote();if(stage==='preview')sendPreview();quoteRetry.focus({preventScroll:true});},{signal});
    quoteRetry.addEventListener('click',()=>{
      if(quotePhase==='pending')return;
      // After an explicit removal the same prepared selection is restored with
      // its receipt; any other state is an explicit recovery request that may
      // ask the provider again and may return the same original excerpt.
      if(quotePhase==='removed'&&removedQuote){quote=removedQuote;quotePhase='ready';renderQuote();if(stage==='preview')sendPreview();return;}
      loadQuote();
    },{signal});
    loadQuote();
    frame.addEventListener('load',()=>{ready=true;sendPreview();sendUi();},{signal});
    window.addEventListener('message',event=>{
      if(!active()||event.origin!==location.origin||event.source!==frame.contentWindow)return;
      if(event.data?.kind==='marginalia-gift-preview-ready'){ready=true;sendPreview();sendUi();}
      if(event.data?.kind==='marginalia-gift-preview-close'&&!publishing){setStage('writing');previewButton.focus({preventScroll:true});}
    },{signal});
    previewButton.addEventListener('click',()=>{remember();setStage('preview');sendPreview();back.focus({preventScroll:true});},{signal});
    back.addEventListener('click',()=>{if(!publishing){setStage('writing');previewButton.focus({preventScroll:true});}},{signal});
    function linkRow(gift){
      const row=node('div','gift-history-row');row.dataset.token=gift.token;const label=gift.recipient?mixed(node('span'),'historyTo','recipient',gift.recipient):uiNode('span','','letter'),open=uiNode('a','','openLetter');links.set(open,'/gift/'+gift.token);open.href=uiHref('/gift/'+gift.token);open.target='_blank';open.rel='noopener noreferrer';const revoke=uiButton('revoke','text-link');
      revoke.addEventListener('click',()=>{
        revoke.disabled=true;
        const confirm=uiButton('confirmRevoke','danger-action'),cancel=uiButton('keep','text-link'),text=uiNode('small','','revokeNote');
        row.append(text,confirm,cancel);confirm.focus({preventScroll:true});
        cancel.addEventListener('click',()=>{for(const n of [text,confirm,cancel])release(n);text.remove();confirm.remove();cancel.remove();revoke.disabled=false;revoke.focus({preventScroll:true});},{signal});
        confirm.addEventListener('click',async()=>{
          if(confirm.disabled)return;
          const focus=trackActionFocus(document,confirm);let nextFocus=confirm;
          confirm.disabled=cancel.disabled=true;row.setAttribute('aria-busy','true');
          try{
            await api('/api/book-gifts/'+gift.token+'/revoke',{});if(!active())return;
            release(row);row.replaceChildren(uiNode('span','','revoked'));row.tabIndex=-1;nextFocus=row;
            if(state.sealed(key)?.token===gift.token)state.forgetSealed(key);
            if(result.dataset.token===gift.token){
              release(result);result.replaceChildren(uiNode('p','gift-sealed-title','revoked'));
              const again=uiButton('rewrite','primary');
              again.addEventListener('click',()=>{setStage('writing');recipient.focus({preventScroll:true});},{signal});result.append(again);
            }
          }catch(error){if(active())notice('failure',true);}
          finally{if(active()){confirm.disabled=cancel.disabled=false;row.removeAttribute('aria-busy');focus.restore(nextFocus);}else focus.stop();}
        },{signal});
      },{signal});
      row.append(label,open,revoke);return row;
    }
    function showSealed(gift,{focus=true}={}){
      if(typeof gift.token!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(gift.token))throw Error(t('giftCompose.invalid'));
      const url=new URL('/gift/'+gift.token,location.origin).href;
      setStage('sealed');result.dataset.token=gift.token;release(result);result.replaceChildren();const envelope=node('div','gift-sealed-envelope'),sealMark=node('span','gift-sealed-mark','Leafhour');envelope.append(sealMark,gift.recipient?mixed(node('p','gift-sealed-to'),'sealedTo','recipient',gift.recipient):uiNode('p','gift-sealed-to','toRecipient'),bookName('p','gift-sealed-book'),mixed(node('p','gift-sealed-from'),'sealedFrom','sender',sender));
      const actions=node('div','gift-sealed-actions'),copy=uiButton('copy','primary'),open=uiNode('a','text-link','open');links.set(open,'/gift/'+gift.token);open.href=uiHref('/gift/'+gift.token);open.target='_blank';open.rel='noopener noreferrer';actions.append(copy,open);
      const linkDetails=node('details','gift-sealed-link'),input=node('input','gift-share-url');linkDetails.append(uiNode('summary','','viewLink'),input);input.value=url;input.readOnly=true;attr(input,'aria-label','linkLabel');
      copy.addEventListener('click',async()=>{label(copy,'copy');try{await navigator.clipboard.writeText(url);if(active()){label(copy,'copied');notice('copyNote');}}catch{if(active()){linkDetails.open=true;input.focus();input.select();notice('copyManual');}}},{signal});
      if(typeof navigator.share==='function'&&(!navigator.canShare||navigator.canShare({url}))){const share=uiButton('share','text-link');actions.append(share);share.addEventListener('click',async()=>{try{await navigator.share({title:t('giftCompose.shareTitle',{book:title(book)}),url});if(active())notice('shared');}catch(error){if(active())notice(error.name==='AbortError'?'shareCancelled':'shareFailed',error.name!=='AbortError');}},{signal});}
      const another=uiButton('another','gift-write-another');another.addEventListener('click',()=>{state.reset(key);recipient.value='';words.value='';translations.checked=true;setStage('writing');recipient.focus({preventScroll:true});},{signal});
      result.append(envelope,uiNode('h3','gift-sealed-title','sealed'),uiNode('p','gift-sealed-note','sealedNote'),actions,linkDetails,another);if(focus)copy.focus({preventScroll:true});return copy;
    }
    seal.addEventListener('click',async()=>{
      if(publishing||!active()||stage!=='preview')return;const focus=trackActionFocus(document,seal);publishing=true;seal.disabled=back.disabled=true;preview.setAttribute('aria-busy','true');label(seal,'sealing');notice('');const request=state.begin(key);let nextFocus=seal;
      try{const gift=await api('/api/library/books/'+encodeURIComponent(book.bookId)+'/gifts',{...values(),quoteReceipt:currentQuote()?.receipt||null});if(owner!==getOwner()||!state.commit(key,request,gift))return;if(!active())return;nextFocus=showSealed(gift,{focus:false});history.hidden=false;if(![...historyRows.children].some(row=>row.dataset.token===gift.token))historyRows.prepend(linkRow(gift));}
      catch(error){if(active())notice('failure',true);}
      finally{publishing=false;if(active()){seal.disabled=back.disabled=false;preview.removeAttribute('aria-busy');label(seal,'seal');focus.restore(nextFocus);}else focus.stop();}
    },{signal});
    setStage('writing');if(state.sealed(key))showSealed(state.sealed(key));
    api('/api/library/books/'+encodeURIComponent(book.bookId)+'/gifts').then(data=>{if(!active())return;const gifts=Array.isArray(data)?data:data.gifts||[],shown=new Set([...historyRows.children].map(row=>row.dataset.token));for(const gift of gifts.filter(g=>!g.revoked))if(!shown.has(gift.token))historyRows.append(linkRow(gift));history.hidden=!historyRows.children.length;}).catch(error=>{if(active())notice('historyFailure',true);});
  }
  return {open,clear};
}
