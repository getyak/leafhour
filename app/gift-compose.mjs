import {createGiftPreview} from './gift-preview.mjs';
import {createGiftDrafts} from './gift-compose-state.mjs';
import {publicGiftSender} from './gift-identity.mjs';
const node=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
const button=(text,cls='')=>{const n=node('button',cls,text);n.type='button';return n;};
const title=book=>book.title?.zh||book.title?.en||'这本书';

export function mountGiftComposer({api,dialog,body,getSession,getOwner,show,current,message,cover}){
  const state=createGiftDrafts();let lifecycle=null;
  dialog.addEventListener('close',()=>lifecycle?.abort());
  function clear(){lifecycle?.abort();state.clear();}
  async function open(book){
    lifecycle?.abort();lifecycle=new AbortController();const signal=lifecycle.signal;
    const ticket=show(book,'写一封赠书信'),owner=getOwner(),key=owner+'\n'+book.bookId,active=()=>current(ticket)&&owner===getOwner();
    dialog.classList.add('gift-compose-dialog');
    const intro=node('p','gift-writing-intro','写几句想说的话，和这本书一起送出。'),steps=node('ol','gift-writing-steps');steps.setAttribute('aria-label','赠书流程');
    for(const text of ['写赠言','看拆信','封好分享'])steps.append(node('li','',text));
    const writing=node('section','gift-writing-stage'),preview=node('section','gift-preview-stage'),result=node('section','gift-sealed-stage');preview.hidden=result.hidden=true;
    const paper=node('div','gift-writing-paper'),bookSlip=node('div','gift-writing-book'),bookCopy=node('div');bookCopy.append(node('strong','',title(book)));if(book.author)bookCopy.append(node('small','',book.author));bookSlip.append(cover(book),bookCopy);
    const address=node('label','gift-writing-address'),recipient=node('input');recipient.id='gift-recipient';recipient.maxLength=80;recipient.placeholder='收信人的称呼';recipient.autocomplete='off';address.htmlFor=recipient.id;address.append(node('span','','致'),recipient);
    const wordsLabel=node('label','sr-only','想留给对方的话'),words=node('textarea','gift-writing-words');words.id='gift-message';words.maxLength=500;words.rows=5;words.placeholder='读到这本书的时候，想起了你。';wordsLabel.htmlFor=words.id;words.setAttribute('aria-describedby','gift-message-help');
    const sender=publicGiftSender(getSession().user),signature=node('div','gift-writing-signature');signature.append(node('span','',sender),node('small','',new Intl.DateTimeFormat('zh-CN',{year:'numeric',month:'long',day:'numeric'}).format(new Date())));
    paper.append(bookSlip,address,wordsLabel,words,signature);
    const options=node('div','gift-writing-options'),included=node('label'),translations=node('input');translations.type='checkbox';translations.checked=true;included.append(translations,node('span','','附上寄信时已有的译文'));options.append(included,node('p','gift-writing-scope','整本原文会随信送出。持有链接的人可以打开和下载；你的笔记与阅读记录留在自己的书房。'));
    const help=node('p','gift-writing-help','称呼和赠言都可以留空。先看看收信的样子，喜欢了再封好。');help.id='gift-message-help';
    const previewButton=button('看看收信时的样子','primary'),writeActions=node('div','gift-writing-actions');writeActions.append(help,previewButton);writing.append(paper,options,writeActions);
    const previewBar=node('div','gift-preview-bar'),back=button('返回修改','text-link');previewBar.append(back,node('span','','朋友会这样收到这本书'));
    const frame=node('iframe','gift-preview-frame');frame.title='赠书信的拆信预览';frame.src='/gift-preview';frame.referrerPolicy='no-referrer';
    const previewActions=node('div','gift-preview-actions'),seal=button('封好这封信，生成链接','primary');previewActions.append(node('p','','预览不会公开内容。封好后，你再把链接交给对方。'),seal);preview.append(previewBar,frame,previewActions);
    const history=node('details','gift-compose-history'),historyRows=node('div');history.append(node('summary','','已封好的信'),historyRows);history.hidden=true;
    body.append(intro,steps,writing,preview,result,history);
    let stage='writing',ready=false,publishing=false;
    const values=()=>({recipient:recipient.value.trim(),message:words.value.trim(),includeTranslations:translations.checked});
    function remember(){if(active())state.remember(key,values());}
    const existing=state.draft(key);if(existing){recipient.value=existing.recipient;words.value=existing.message;translations.checked=existing.includeTranslations;}
    function setStage(next){stage=next;writing.hidden=next!=='writing';preview.hidden=next!=='preview';result.hidden=next!=='sealed';intro.hidden=next!=='writing';for(const [index,item]of [...steps.children].entries()){if(index===['writing','preview','sealed'].indexOf(next))item.setAttribute('aria-current','step');else item.removeAttribute('aria-current');}message('');}
    function sendPreview(){if(active()&&ready)frame.contentWindow?.postMessage(createGiftPreview(book,getSession().user,values()),location.origin);}
    for(const input of [recipient,words,translations])input.addEventListener('input',remember,{signal});
    frame.addEventListener('load',()=>{ready=true;sendPreview();},{signal});
    window.addEventListener('message',event=>{
      if(!active()||event.origin!==location.origin||event.source!==frame.contentWindow)return;
      if(event.data?.kind==='marginalia-gift-preview-ready'){ready=true;sendPreview();}
      if(event.data?.kind==='marginalia-gift-preview-close'&&!publishing){setStage('writing');previewButton.focus({preventScroll:true});}
    },{signal});
    previewButton.addEventListener('click',()=>{remember();setStage('preview');sendPreview();back.focus({preventScroll:true});},{signal});
    back.addEventListener('click',()=>{if(!publishing){setStage('writing');previewButton.focus({preventScroll:true});}},{signal});
    function linkRow(gift){
      const row=node('div','gift-history-row');row.dataset.token=gift.token;const label=node('span','',gift.recipient?'给 '+gift.recipient:'一封赠书信'),open=node('a','','打开信笺');open.href='/gift/'+gift.token;open.target='_blank';open.rel='noopener noreferrer';const revoke=button('收回','text-link');
      revoke.addEventListener('click',()=>{revoke.disabled=true;const confirm=button('确认收回','danger-action'),cancel=button('保留','text-link'),text=node('small','','收回后，链接将无法继续打开。已下载或已收下的书会保留。');row.append(text,confirm,cancel);cancel.addEventListener('click',()=>{text.remove();confirm.remove();cancel.remove();revoke.disabled=false;},{signal});confirm.addEventListener('click',async()=>{confirm.disabled=true;try{await api('/api/book-gifts/'+gift.token+'/revoke',{});if(!active())return;row.replaceChildren(node('span','','这封信已收回。'));if(state.sealed(key)?.token===gift.token)state.forgetSealed(key);if(result.dataset.token===gift.token){result.replaceChildren(node('p','gift-sealed-title','这封信已收回。'));const again=button('重新写一封','primary');again.addEventListener('click',()=>setStage('writing'),{signal});result.append(again);}}catch(error){if(active()){message(error.message,true);confirm.disabled=false;}}},{signal});},{signal});
      row.append(label,open,revoke);return row;
    }
    function showSealed(gift){
      if(typeof gift.token!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(gift.token))throw Error('赠书链接未能核验，请从已封好的信中重新打开。');
      const url=new URL('/gift/'+gift.token,location.origin).href;
      setStage('sealed');result.dataset.token=gift.token;result.replaceChildren();const envelope=node('div','gift-sealed-envelope'),sealMark=node('span','gift-sealed-mark','循页');envelope.append(sealMark,node('p','gift-sealed-to',gift.recipient?'致 '+gift.recipient:'致 收信人'),node('p','gift-sealed-book',title(book)),node('p','gift-sealed-from',sender+' 寄'));
      const actions=node('div','gift-sealed-actions'),copy=button('复制赠书链接','primary'),open=node('a','text-link','打开这封信');open.href=url;open.target='_blank';open.rel='noopener noreferrer';actions.append(copy,open);
      const linkDetails=node('details','gift-sealed-link'),input=node('input','gift-share-url');linkDetails.append(node('summary','','查看链接'),input);input.value=url;input.readOnly=true;input.setAttribute('aria-label','赠书信链接');
      copy.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(url);if(active()){copy.textContent='链接已复制';message('信已封好，把链接交给你想送书的人。');}}catch{if(active()){linkDetails.open=true;input.focus();input.select();message('请复制这里的赠书链接。');}}},{signal});
      if(typeof navigator.share==='function'&&(!navigator.canShare||navigator.canShare({url}))){const share=button('分享给朋友','text-link');actions.append(share);share.addEventListener('click',async()=>{try{await navigator.share({title:'一封赠书信 · '+title(book),url});if(active())message('已交给系统分享。');}catch(error){if(active()&&error.name!=='AbortError')message('暂时无法打开分享，可以复制链接。',true);}},{signal});}
      const another=button('再写一封','gift-write-another');another.addEventListener('click',()=>{state.reset(key);recipient.value='';words.value='';translations.checked=true;setStage('writing');recipient.focus({preventScroll:true});},{signal});
      result.append(envelope,node('h3','gift-sealed-title','这封信已封好。'),node('p','gift-sealed-note','它还没有发给任何人。把链接交给对方，等他亲手拆开。'),actions,linkDetails,another);copy.focus({preventScroll:true});
    }
    seal.addEventListener('click',async()=>{
      if(publishing||!active()||stage!=='preview')return;publishing=true;seal.disabled=back.disabled=true;seal.textContent='正在封好这封信…';message('');const request=state.begin(key);
      try{const gift=await api('/api/library/books/'+encodeURIComponent(book.bookId)+'/gifts',values());if(owner!==getOwner()||!state.commit(key,request,gift))return;if(!current(ticket))return;showSealed(gift);history.hidden=false;if(![...historyRows.children].some(row=>row.dataset.token===gift.token))historyRows.prepend(linkRow(gift));}
      catch(error){if(active())message(error.message,true);}
      finally{publishing=false;if(active()){seal.disabled=back.disabled=false;seal.textContent='封好这封信，生成链接';}}
    },{signal});
    setStage('writing');if(state.sealed(key))showSealed(state.sealed(key));
    api('/api/library/books/'+encodeURIComponent(book.bookId)+'/gifts').then(data=>{if(!active())return;const gifts=Array.isArray(data)?data:data.gifts||[],shown=new Set([...historyRows.children].map(row=>row.dataset.token));for(const gift of gifts.filter(g=>!g.revoked))if(!shown.has(gift.token))historyRows.append(linkRow(gift));history.hidden=!historyRows.children.length;}).catch(error=>{if(active())message('已封好的信暂未载入。'+error.message,true);});
  }
  return {open,clear};
}
