// Short, locally bundled excerpts. Translations retain the catalog's draft status.
const quotes=[
  {bookId:'gutenberg-alice',title:'爱丽丝梦游仙境',author:'刘易斯·卡罗尔',chapter:'第一章',sourceUrl:'https://www.gutenberg.org/ebooks/11',original:'“and what is the use of a book,” thought Alice “without pictures or conversations?”',translation:'书里连图画和对话都没有，读它有什么意思？',variant:'interpretive',status:'draft',passageId:'01b38ea4c710a84b-p00008',contentVersion:'01b38ea4c710a84bc18d0bd41271a5a1a92b94e97b2812f4dece97d4a694725e'},
  {bookId:'gutenberg-walden',title:'瓦尔登湖',author:'亨利·戴维·梭罗',chapter:'经济篇',sourceUrl:'https://www.gutenberg.org/ebooks/205',original:'I should not talk so much about myself if there were anybody else whom I knew as well.',translation:'若我同样了解另一个人，就不会说这么多自己的事。',variant:'literal',status:'draft',passageId:'2d9a76a2e3e8195c-p00013',contentVersion:'2d9a76a2e3e8195c69430516ebd33c4d0757a53ad432ff6186b7b794e6fe99f9'},
  {bookId:'gutenberg-meditations',title:'沉思录',author:'马可·奥勒留',chapter:'卷一 · 第一节',sourceUrl:'https://www.gutenberg.org/ebooks/2680',original:'Of my grandfather Verus I have learned to be gentle and meek, and to refrain from all anger and passion.',translation:'祖父维鲁斯教我待人温和、保持谦逊，不任由怒气和激情支配自己。',variant:'interpretive',status:'draft',passageId:'6977474f82a39dd8-p00055',contentVersion:'6977474f82a39dd88a4af31a59504821658174d33c177732c54357e4d680b96c'}
];

export function arrivalQuote(bookId){
  const match=quotes.find(quote=>quote.bookId===bookId);
  return {...(match||quotes[0]),context:match?'书中一句':'书房拾句'};
}

// Completion never waits for an animation. Tickets isolate retries from late work.
export function createArrivalLifecycle({render,schedule=setTimeout,cancel=clearTimeout,slowAfter=8000}){
  let sequence=0,pending=false,timer;
  const stopTimer=()=>{if(timer!==undefined)cancel(timer);timer=undefined;};
  return {
    start(){
      stopTimer();const ticket=++sequence;pending=true;
      render({phase:'loading',slow:false});
      timer=schedule(()=>{if(pending&&ticket===sequence)render({phase:'loading',slow:true});},slowAfter);
      return ticket;
    },
    finish(ticket){
      if(ticket!==sequence||!pending)return false;
      pending=false;stopTimer();render({phase:'hidden',slow:false});return true;
    }
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
  const quote=arrivalQuote(library?null:new URLSearchParams(win.location.search).get('book'));
  root.classList.add('reading-arrival');root.classList.toggle('arrival-library',library);
  root.removeAttribute('role');
  const scene=createPaperCompanion(doc);
  const greeting=node('p','arrival-greeting',library?'我来把书页摊开。':'等我翻到你那一页。');
  const context=node('p','arrival-context',quote.context),text=node('blockquote','arrival-quote','“'+quote.translation+'”');
  const original=node('p','arrival-original',quote.original);original.lang='en';
  const source=node('p','arrival-source',quote.author+'《'+quote.title+'》 · '+quote.chapter);
  const provenance=node('span','arrival-provenance','中文'+(quote.variant==='literal'?'直译':'意译')+'节选 · AI 草稿');source.append(provenance);
  const status=node('p','arrival-status');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
  const retry=node('button','arrival-retry','重新打开');retry.type='button';retry.hidden=true;retry.addEventListener('click',()=>win.location.reload());
  root.replaceChildren(scene,greeting,context,text,original,source,status,retry);
  const lifecycle=createArrivalLifecycle({render:view=>{
    root.hidden=view.phase==='hidden';root.dataset.arrivalState=view.phase;
    status.textContent=view.slow?'这次打开得稍慢，仍在等待'+(library?'书房':'书页')+'。':library?'正在打开书房…':'正在展开书页…';
    retry.hidden=!view.slow||view.phase==='hidden';
  }});
  let current;
  const controller={start(){current=lifecycle.start();return current;},finish(ticket=current){return lifecycle.finish(ticket);}};
  mounted.set(root,controller);controller.start();return controller;
}

// Independent of reader-api's session request: the companion appears during auth too.
if(typeof document!=='undefined'){
  for(const root of document.querySelectorAll('[data-reading-arrival]'))mountReadingArrival(root);
  const pause=()=>document.documentElement.classList.toggle('arrival-paused',document.hidden);
  document.addEventListener('visibilitychange',pause);window.addEventListener('pagehide',()=>document.documentElement.classList.add('arrival-paused'));window.addEventListener('pageshow',pause);pause();
}
