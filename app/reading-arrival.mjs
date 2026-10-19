import {t,getUiLocale,onUiLocaleChange,uiReady} from './ui-locale.mjs';
import {arrivalExcerpt} from './arrival-excerpt.mjs';
import {arrivalCatalog} from './arrival-catalog.mjs';
// Short, locally bundled excerpts. Translations retain the catalog's draft status.
const quotes=[
  {bookId:'gutenberg-alice',title:'爱丽丝梦游仙境',author:'刘易斯·卡罗尔',chapter:'第一章',sourceUrl:'https://www.gutenberg.org/ebooks/11',original:'“and what is the use of a book,” thought Alice “without pictures or conversations?”',translation:'书里连图画和对话都没有，读它有什么意思？',variant:'interpretive',status:'draft',passageId:'01b38ea4c710a84b-p00008',contentVersion:'01b38ea4c710a84bc18d0bd41271a5a1a92b94e97b2812f4dece97d4a694725e'},
  {bookId:'gutenberg-walden',title:'瓦尔登湖',author:'亨利·戴维·梭罗',chapter:'经济篇',sourceUrl:'https://www.gutenberg.org/ebooks/205',original:'I should not talk so much about myself if there were anybody else whom I knew as well.',translation:'若我同样了解另一个人，就不会说这么多自己的事。',variant:'literal',status:'draft',passageId:'2d9a76a2e3e8195c-p00013',contentVersion:'2d9a76a2e3e8195c69430516ebd33c4d0757a53ad432ff6186b7b794e6fe99f9'},
  {bookId:'gutenberg-meditations',title:'沉思录',author:'马可·奥勒留',chapter:'卷一 · 第一节',sourceUrl:'https://www.gutenberg.org/ebooks/2680',original:'Of my grandfather Verus I have learned to be gentle and meek, and to refrain from all anger and passion.',translation:'祖父维鲁斯教我待人温和、保持谦逊，不任由怒气和激情支配自己。',variant:'interpretive',status:'draft',passageId:'6977474f82a39dd8-p00055',contentVersion:'6977474f82a39dd88a4af31a59504821658174d33c177732c54357e4d680b96c'}
];

export function arrivalQuote(bookId){
  const match=quotes.find(quote=>quote.bookId===bookId)||(Object.hasOwn(arrivalCatalog,bookId)?arrivalCatalog[bookId]:null);
  return match?{...match,context:match.context||'书中一句',contextId:quotes.includes(match)?'arrival.context.sentence':'arrival.context.paragraph',sourceLanguage:'en'}:null;
}

// Only the already-authorized reading response may supply private content.
// No storage, extra request, generated translation or unrelated-book fallback.
export function arrivalBookQuote(book,{bookId,passageId}={}){
  if(!book||typeof book.bookId!=='string'||bookId&&book.bookId!==bookId)return null;
  const text=value=>typeof value==='string'?value.trim():'';
  const title=text(book.title?.zh)||text(book.title?.en)||text(book.title)||'当前书籍';
  const rows=(book.sections||[]).flatMap(section=>(section.paragraphs||[]).map(paragraph=>({...paragraph,chapterId:section.chapterId})));
  const prepared=arrivalQuote(book.bookId);
  if(prepared&&prepared.contentVersion===book.contentVersion&&rows.some(row=>row.id===prepared.passageId&&row.original?.includes(prepared.original)))return prepared;
  const requested=rows.find(row=>row.id===passageId),start=rows.find(row=>row.id===book.readingStart?.passageId);
  const paragraph=[requested,start,...rows].find(row=>text(row?.original).length>=20);
  const original=paragraph?text(paragraph.original):null;
  const chapter=book.chapters?.find(row=>row.id===paragraph?.chapterId);
  return {bookId:book.bookId,title,author:text(book.author),chapter:text(chapter?.title?.zh)||text(chapter?.title?.en)||text(chapter?.title),original:original?arrivalExcerpt(original):null,translation:null,sourceLanguage:text(book.sourceLanguage)||'und',context:'书中一段',contextId:'arrival.context.paragraph',passageId:paragraph?.id||null,contentVersion:book.contentVersion||null};
}

// Completion never waits for an animation. Tickets isolate retries from late work.
export function createArrivalLifecycle({render,schedule=setTimeout,cancel=clearTimeout,slowAfter=8000}){
  let sequence=0,pending=false,timer;
  const stopTimer=()=>{if(timer!==undefined)cancel(timer);timer=undefined;};
  return {
    get pending(){return pending;},
    start(){
      stopTimer();const ticket=++sequence;pending=true;
      render({phase:'loading',slow:false});
      timer=schedule(()=>{if(pending&&ticket===sequence)render({phase:'loading',slow:true});},slowAfter);
      return ticket;
    },
    finish(ticket){
      if(ticket!==sequence||!pending)return false;
      pending=false;stopTimer();render({phase:'hidden',slow:false});return true;
    },
    dispose(){pending=false;stopTimer();}
  };
}

export function createPaperCompanion(doc,{pose='loading'}={}){
  const node=(tag,className)=>{const element=doc.createElement(tag);element.className=className;return element;};
  const scene=node('div','arrival-scene paper-companion paper-companion-'+pose);scene.setAttribute('aria-hidden','true');
  const floor=node('i','arrival-floor'),person=node('div','arrival-person'),face=node('div','arrival-face');
  for(const part of ['fold','eye eye-left','eye eye-right','smile','cheek cheek-left','cheek cheek-right'])face.append(node('i','arrival-'+part.replaceAll(' ',' arrival-')));
  person.append(face,node('i','arrival-shirt'),node('i','arrival-arm arrival-arm-left'),node('i','arrival-arm arrival-arm-right'),node('i','arrival-leg arrival-leg-left'),node('i','arrival-leg arrival-leg-right'));
  const book=node('div','arrival-book');for(const part of pose==='bookmark'?['left','right']:['left','right','turn'])book.append(node('i','arrival-page arrival-page-'+part));person.append(book);
  if(pose==='bookmark')book.append(node('i','arrival-bookmark'));
  scene.append(floor,person);if(pose!=='bookmark')scene.append(node('i','arrival-leaf arrival-leaf-one'),node('i','arrival-leaf arrival-leaf-two'));
  return scene;
}

const mounted=new WeakMap();
export function mountReadingArrival(root){
  if(mounted.has(root))return mounted.get(root);
  const doc=root.ownerDocument,win=doc.defaultView,library=root.dataset.readingArrival==='library';
  const node=(tag,className,text)=>{const element=doc.createElement(tag);element.className=className;if(text!==undefined)element.textContent=text;return element;};
  const query=new URLSearchParams(win.location.search),selectedBookId=query.get('book');
  const initialQuote=library?{...arrivalQuote('gutenberg-alice'),context:'书房拾句',contextId:'arrival.context.library'}:arrivalQuote(selectedBookId);
  root.classList.add('reading-arrival');root.classList.toggle('arrival-library',library);
  root.removeAttribute('role');
  const scene=createPaperCompanion(doc);
  const greeting=node('p','arrival-greeting'),context=node('p','arrival-context'),text=node('blockquote','arrival-quote');
  const original=node('p','arrival-original'),source=node('p','arrival-source');
  // Semantic UI state: language commits relabel only the owned chrome from
  // these caches. They never call showQuote, never touch the literal source
  // descendants and never restart or reset the arrival lifecycle or timers.
  const model={quote:initialQuote,view:{phase:'loading',slow:false},disposed:false};
  let provenanceNode=null;
  function paintChrome(){
    root.setAttribute('lang',getUiLocale());
    greeting.textContent=t('arrival.greeting.'+(library?'library':'reader'));
    retry.textContent=t('arrival.retry');
    const view=model.view;
    status.textContent=view.phase==='hidden'?'':view.slow?t('arrival.slow',{target:t('arrival.target.'+(library?'library':'reader'))}):t('arrival.status.'+(library?'library':'reader'));
    const quote=model.quote,opening=quote?.title&&!quote.original;
    if(opening)context.textContent=t('arrival.context.opening',{title:quote.title});
    else context.textContent=t(quote?.contextId||'arrival.context.book');
    if(provenanceNode)provenanceNode.textContent=quote.translation?t('arrival.provenance.'+(quote.variant==='literal'?'literal':'interpretive')):t('arrival.provenance.original');
  }
  function showQuote(quote){
    model.quote=quote||null;provenanceNode=null;
    text.hidden=!quote?.original;text.textContent=quote?.original?'“'+(quote.translation||quote.original)+'”':'';text.lang=quote?.translation?'zh':quote?.sourceLanguage||'und';
    original.hidden=!quote?.translation;original.textContent=quote?.translation?quote.original:'';original.lang=quote?.sourceLanguage||'und';
    source.hidden=!quote?.original;source.textContent=quote?.original?(quote.author?quote.author+' ':'')+'《'+quote.title+'》'+(quote.chapter?' · '+quote.chapter:''):'';
    if(quote?.original){const provenance=node('span','arrival-provenance');provenanceNode=provenance;source.append(provenance);}
    paintChrome();
  }
  const status=node('p','arrival-status');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
  const retry=node('button','arrival-retry');retry.type='button';retry.hidden=true;const onRetry=()=>win.location.reload();retry.addEventListener('click',onRetry);
  root.replaceChildren(scene,greeting,context,text,original,source,status,retry);showQuote(initialQuote);
  const lifecycle=createArrivalLifecycle({render:view=>{
    model.view=view;root.hidden=view.phase==='hidden';root.dataset.arrivalState=view.phase;
    retry.hidden=!view.slow||view.phase==='hidden';
    if(!model.disposed)paintChrome();
  }});
  function updateLabels(){if(!model.disposed)paintChrome();}
  const offLocale=onUiLocaleChange(updateLabels);void uiReady.then(updateLabels);
  paintChrome();
  let current;
  const controller={
    start(){showQuote(initialQuote);current=lifecycle.start();return current;},
    setBook(book,ticket=current){if(library||ticket!==current||!lifecycle.pending)return false;const quote=arrivalBookQuote(book,{bookId:selectedBookId,passageId:query.get('passage')});if(!quote)return false;showQuote(quote);return true;},
    finish(ticket=current){return lifecycle.finish(ticket);},
    updateLabels,
    dispose(){if(model.disposed)return;model.disposed=true;offLocale();lifecycle.dispose();retry.removeEventListener('click',onRetry);mounted.delete(root);}
  };
  mounted.set(root,controller);controller.start();return controller;
}

// Independent of reader-api's session request: the companion appears during auth too.
if(typeof document!=='undefined'){
  for(const root of document.querySelectorAll('[data-reading-arrival]'))mountReadingArrival(root);
  const pause=()=>document.documentElement.classList.toggle('arrival-paused',document.hidden);
  document.addEventListener('visibilitychange',pause);window.addEventListener('pagehide',()=>document.documentElement.classList.add('arrival-paused'));window.addEventListener('pageshow',pause);pause();
}
