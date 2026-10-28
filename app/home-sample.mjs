import {homeLocale} from './home-locale.mjs';

export const sampleInterpretations=[
  {code:'zh-Hans',name:'简体中文',labels:{
    'zh-Hans':'中文意译 · 页面示例',en:'Chinese interpretation · Reading example',
    'zh-Hant':'中文意譯 · 頁面範例',ja:'中国語の意訳 · ページ例'
  },text:'“一本书如果没有图画，也没有对话，那有什么用呢？”爱丽丝想。'},
  {code:'zh-Hant',name:'繁體中文',labels:{
    'zh-Hans':'中文意译（繁体） · 页面示例',en:'Chinese (Traditional) interpretation · Reading example',
    'zh-Hant':'中文意譯（繁體） · 頁面範例',ja:'中国語（繁体字）の意訳 · ページ例'
  },text:'「一本書如果沒有圖畫，也沒有對話，那有什麼用呢？」愛麗絲想。'},
  {code:'ja',name:'日本語',labels:{
    'zh-Hans':'日语意译 · 页面示例',en:'Japanese interpretation · Reading example',
    'zh-Hant':'日語意譯 · 頁面範例',ja:'日本語の意訳 · ページ例'
  },text:'「絵も会話もない本なんて、いったい何の役に立つのかしら」とアリスは思った。'},
  {code:'es',name:'Español',labels:{
    'zh-Hans':'西班牙语意译 · 页面示例',en:'Spanish interpretation · Reading example',
    'zh-Hant':'西班牙語意譯 · 頁面範例',ja:'スペイン語の意訳 · ページ例'
  },text:'«¿De qué sirve un libro —pensó Alicia— si no tiene dibujos ni diálogos?»'}
];

export const sampleLabel=(entry,uiLocale)=>entry?.labels?.[uiLocale]||entry?.labels?.['zh-Hans']||Object.values(entry?.labels||{}).find(Boolean)||'';
export const nextSampleIndex=(current,count)=>count>0?((current+1)%count+count)%count:0;

export function mountHomeSample(root,win=root?.ownerDocument?.defaultView){
  const block=root?.querySelector?.('.sample-sheet .sample-translation');
  const label=block?.querySelector?.('span'),text=block?.querySelector?.('p');
  const doc=root?.ownerDocument,card=block?.closest?.('.sample-sheet');
  if(root?.hidden||!label||!text||!card||!doc?.createElement||!win?.setTimeout||!block.prepend||!card.addEventListener)return ()=>{};
  const original={label:label.textContent,text:text.textContent,lang:text.getAttribute('lang')};
  const group=doc.createElement('div'),content=doc.createElement('div');
  const groupLabels={'zh-Hans':'译文语言',en:'Interpretation language','zh-Hant':'譯文語言',ja:'訳文の言語'};
  group.className='sample-languages';group.setAttribute('role','group');group.setAttribute('aria-label',groupLabels[homeLocale(doc)]||groupLabels.en);
  content.className='sample-interpretation';
  block.insertBefore(content,label);content.append(label,text);block.prepend(group);
  const preference=win.matchMedia?.('(prefers-reduced-motion: reduce)');
  let index=Math.max(0,sampleInterpretations.findIndex(entry=>entry.code===homeLocale(doc))),timer=0,disposed=false,manual=card.dataset?.rotation==='manual',hover=false,focused=card.contains(doc.activeElement);
  let visible=!win.IntersectionObserver,animations=[];
  const listeners=[];
  const listen=(target,type,handler)=>{target?.addEventListener?.(type,handler);listeners.push(()=>target?.removeEventListener?.(type,handler));};
  const clearTimer=()=>{win.clearTimeout(timer);timer=0;};
  const stopAnimation=()=>{for(const animation of animations)animation.cancel();animations=[];block.style.height='';};
  const select=(next,animate=true)=>{
    const before=block.getBoundingClientRect?.().height;
    stopAnimation();index=next;
    const entry=sampleInterpretations[index];
    label.textContent=sampleLabel(entry,homeLocale(doc));text.textContent=entry.text;text.setAttribute('lang',entry.code);
    buttons.forEach((button,i)=>button.setAttribute('aria-pressed',String(i===index)));
    if(!animate||preference?.matches||!content.animate||!block.animate)return;
    const after=block.getBoundingClientRect?.().height;
    const options={duration:380,easing:'cubic-bezier(.22,1,.36,1)'};
    animations.push(content.animate([{opacity:0,transform:'translateY(6px)'},{opacity:1,transform:'translateY(0)'}],options));
    if(Number.isFinite(before)&&Number.isFinite(after)){
      // Convert the measured border box to the CSS height's box model.
      const style=win.getComputedStyle?.(block);
      const extra=style&&style.boxSizing!=='border-box'
        ? ['paddingTop','paddingBottom','borderTopWidth','borderBottomWidth'].reduce((sum,key)=>sum+(parseFloat(style[key])||0),0):0;
      block.style.height=(after-extra)+'px';
      const height=block.animate([{height:(before-extra)+'px'},{height:(after-extra)+'px'}],options);
      animations.push(height);
      const finish=()=>{if(!disposed&&animations.includes(height))block.style.height='';};
      height.finished?.then(finish,finish);
    }
  };
  const schedule=(delay=5000)=>{
    clearTimer();
    if(disposed||manual||preference?.matches||hover||focused||doc.hidden||!visible)return;
    timer=win.setTimeout(()=>{select(nextSampleIndex(index,sampleInterpretations.length));schedule();},delay);
  };
  const buttons=sampleInterpretations.map((entry,i)=>{
    const button=doc.createElement('button');button.type='button';button.lang=entry.code;button.textContent=entry.name;
    listen(button,'click',()=>{manual=true;clearTimer();select(i);});
    group.append(button);return button;
  });
  listen(card,'pointerenter',()=>{hover=true;clearTimer();});
  listen(card,'pointerleave',()=>{hover=false;schedule(6000);});
  listen(card,'pointerdown',()=>schedule(6000));
  listen(card,'focusin',()=>{focused=true;clearTimer();});
  listen(card,'focusout',event=>{focused=card.contains(event.relatedTarget);schedule(6000);});
  listen(doc,'visibilitychange',()=>{if(doc.hidden)stopAnimation();schedule();});
  listen(preference,'change',()=>{stopAnimation();schedule();});
  let observer;
  if(win.IntersectionObserver){
    observer=new win.IntersectionObserver(entries=>{
      visible=entries.some(entry=>entry.isIntersecting);schedule();
    });observer.observe(card);
  }
  select(index,false);schedule();
  return ()=>{
    disposed=true;clearTimer();stopAnimation();observer?.disconnect();listeners.forEach(off=>off());
    group.remove();content.before(label,text);content.remove();
    label.textContent=original.label;text.textContent=original.text;
    if(original.lang===null)text.removeAttribute('lang');else text.setAttribute('lang',original.lang);
  };
}

if(typeof document!=='undefined')mountHomeSample(document.getElementById('home-view'));
