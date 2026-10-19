import {t,onUiLocaleChange,uiReady,uiHref,getUiLocale} from './ui-locale.mjs';
import {uiAuthoredPath} from './ui-locale-codec.mjs';
import {createPaletteLibrary} from './palette-library.mjs';
import {readingBookUrl} from './library-workspace.mjs';
import {libraryViewDefaults,writeLibraryView,safeLibraryReturn} from './library-view-state.mjs';

// GET-178 one accessible command palette for every scoped page entry. This
// module loads on demand from palette-bootstrap.mjs and imports no unrelated
// page controller: per-page behaviour arrives through the explicit adapter.

// Explicit owning-component label dictionary: stable message IDs resolved
// through the shared locale runtime, never a global DOM translator.
export const PALETTE_TEXT=Object.freeze({
  title:'palette.title',
  placeholder:'palette.placeholder',
  close:'palette.close',
  loading:'palette.loading',
  empty:'palette.empty',
  error:'palette.library.failed',
  count:'palette.count',retry:'palette.retryBooks',
  library:'palette.library',settings:'palette.settings',calendar:'palette.calendar',home:'palette.home',
  themePaper:'palette.themePaper',themeNight:'palette.themeNight',fontLarger:'palette.fontLarger',fontSmaller:'palette.fontSmaller',fullscreen:'palette.fullscreen'
});
export const paletteLabels=()=>({
  title:t(PALETTE_TEXT.title),placeholder:t(PALETTE_TEXT.placeholder),close:t(PALETTE_TEXT.close),
  loading:t(PALETTE_TEXT.loading),empty:t(PALETTE_TEXT.empty),error:t(PALETTE_TEXT.error),
  count:(name,count)=>t(PALETTE_TEXT.count,{name,count}),retry:t(PALETTE_TEXT.retry),
  library:t(PALETTE_TEXT.library),settings:t(PALETTE_TEXT.settings),calendar:t(PALETTE_TEXT.calendar),home:t(PALETTE_TEXT.home),
  themePaper:t(PALETTE_TEXT.themePaper),themeNight:t(PALETTE_TEXT.themeNight),fontLarger:t(PALETTE_TEXT.fontLarger),fontSmaller:t(PALETTE_TEXT.fontSmaller),fullscreen:t(PALETTE_TEXT.fullscreen)
});

const fold=value=>String(value||'').normalize('NFKC').toLowerCase();
const matches=(label,query)=>!query||fold(label).includes(fold(query));

// Settings and calendar destinations are produced by the exact GET-179 owned
// view codec and validated by its safe return codec; unknown keys never ride.
export function paletteLibraryUrl(overlay){
  const target='/library'+writeLibraryView('',{view:libraryViewDefaults(),overlay:overlay||null,ui:getUiLocale()});
  return safeLibraryReturn(target)||'/library';
}

// Page command sets stay explicit per page. A fixed console without a working
// appearance adapter offers navigation to the validated appearance settings
// instead of dead theme actions.
export function paletteCommands(page,adapter=null,navigate=url=>location.assign(url),{fullscreen=adapter?.fullscreen||(()=>{})}={}){
  const PALETTE_LABELS=paletteLabels();
  const commands=[
    {id:'library',label:PALETTE_LABELS.library,handoff:true,run:()=>navigate(uiHref('/library'))},
    {id:'settings',label:PALETTE_LABELS.settings,handoff:true,run:()=>navigate(paletteLibraryUrl({kind:'settings',tab:'appearance'}))},
    {id:'calendar',label:PALETTE_LABELS.calendar,handoff:true,run:()=>navigate(paletteLibraryUrl({kind:'calendar'}))},
    {id:'home',label:PALETTE_LABELS.home,handoff:true,run:()=>navigate(uiAuthoredPath('/',getUiLocale()))}
  ];
  const appearance=adapter?.appearance;
  if(page==='reader'){
    if(appearance?.setTheme){
      commands.push({id:'theme-paper',label:PALETTE_LABELS.themePaper,run:()=>appearance.setTheme('paper')});
      commands.push({id:'theme-night',label:PALETTE_LABELS.themeNight,run:()=>appearance.setTheme('night')});
    }
    if(appearance?.adjustFont){
      commands.push({id:'font-larger',label:PALETTE_LABELS.fontLarger,run:()=>appearance.adjustFont(1)});
      commands.push({id:'font-smaller',label:PALETTE_LABELS.fontSmaller,run:()=>appearance.adjustFont(-1)});
    }
    commands.push({id:'fullscreen',label:PALETTE_LABELS.fullscreen,handoff:true,run:()=>fullscreen()});
  }
  return commands;
}

export function openCommandPalette({document=globalThis.document,page='home',adapter=null,navigate=url=>location.assign(url),request=fetch,getOwner=null,opener=null,library=null,fullscreen=null}={}){
  const owner=getOwner??adapter?.getOwner??null;
  // GET-188 one real transaction boundary: a setup that throws anywhere rolls
  // back only this call's own partial DOM and listeners, so a retried open can
  // never inherit a poisoned half-built palette or stack a second controller.
  const created=[];let unwatch=null,unLocale=null,ownedLibrary=null;
  try{
    return build();
  }catch(error){
    // Owned cleanup stays secondary to the original failure: DOM, listeners and
    // the watcher roll back, and a library this factory created itself is
    // disposed (subscription released, global instance removed). An externally
    // injected library keeps its own ownership and is never disposed here.
    for(const node of created)node.remove?.();
    try{unLocale?.();}catch{}
    try{unwatch?.();}catch{}
    try{ownedLibrary?.dispose?.();}catch{}
    throw error;
  }
  function build(){
  const books=library||(ownedLibrary=createPaletteLibrary({request,getOwner:owner,subscribe:adapter?.subscribe}));
  unwatch=books.watch?.(()=>refresh())??null;
  if(!document.getElementById('command-palette')&&document.head?.append){const link=document.createElement('link');link.rel='stylesheet';link.href='/command-palette.css';created.push(link);document.head.append(link);}
  let dialog=document.getElementById('command-palette');
  if(!dialog){
    dialog=document.createElement('dialog');dialog.id='command-palette';dialog.className='command-palette';dialog.setAttribute('aria-label',paletteLabels().title);
    const input=document.createElement('input');input.id='command-palette-input';input.type='text';input.autocomplete='off';input.setAttribute('role','combobox');input.setAttribute('aria-controls','command-palette-list');input.setAttribute('aria-expanded','true');input.placeholder=paletteLabels().placeholder;
    const status=document.createElement('p');status.id='command-palette-status';status.setAttribute('role','status');
    const list=document.createElement('ul');list.id='command-palette-list';list.setAttribute('role','listbox');list.setAttribute('aria-label',paletteLabels().title);
    const close=document.createElement('button');close.type='button';close.className='command-palette-close';close.setAttribute('aria-label',paletteLabels().close);close.textContent='×';
    dialog.append(close,input,status,list);
    created.push(dialog);
    document.body?.append?.(dialog);
    dialog.addEventListener('cancel',event=>{event.preventDefault();closePalette({restoreFocus:true});});
    close.addEventListener('click',()=>closePalette({restoreFocus:true}));
    input.addEventListener('input',()=>{activeIndex=0;refresh();});
    input.addEventListener('keydown',event=>{
      if(!results.length)return;
      if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();activeIndex=(activeIndex+(event.key==='ArrowDown'?1:-1)+results.length)%results.length;refresh();}
      else if(event.key==='Home'){event.preventDefault();activeIndex=0;refresh();}
      else if(event.key==='End'){event.preventDefault();activeIndex=results.length-1;refresh();}
      else if(event.key==='Enter'){event.preventDefault();runActive();}
    });
    input.addEventListener('keyup',event=>{if(event.key==='Escape'){event.preventDefault();closePalette({restoreFocus:true});}});
  }
  const input=document.getElementById('command-palette-input')||dialog.querySelector('#command-palette-input');
  const status=document.getElementById('command-palette-status')||dialog.querySelector('#command-palette-status');
  const list=document.getElementById('command-palette-list')||dialog.querySelector('#command-palette-list');
  const closeControl=dialog.querySelector('.command-palette-close');
  let results=[],activeIndex=0,launchPoint=null,disposed=false;
  function visibleEntries(){
    const query=input.value.trim();
    const commands=paletteCommands(page,adapter,navigate,fullscreen?{fullscreen}:{}).filter(command=>matches(command.label,query));
    const found=query?books.search(query).map(book=>({id:'book:'+book.bookId,label:book.title?.zh||book.title?.en||book.bookId,hint:book.author||'',handoff:true,run:()=>navigate(uiHref(readingBookUrl(book)))})):[];
    const labels=paletteLabels();const retry=books.view?.().phase==='error'?[{id:'palette-retry',label:labels.retry,handoff:false,run:()=>{void Promise.resolve(books.load?.()).then(()=>refresh(),()=>refresh());}}]:[];
    return [...commands,...found,...retry];
  }
  function refresh(){
    if(disposed)return;
    results=visibleEntries();
    if(activeIndex>=results.length)activeIndex=Math.max(0,results.length-1);
    list.replaceChildren();
    results.forEach((entry,index)=>{
      const item=document.createElement('li');item.id='command-palette-option-'+index;item.setAttribute('role','option');item.setAttribute('aria-selected',String(index===activeIndex));item.textContent=entry.label+(entry.hint?' · '+entry.hint:'');
      item.addEventListener('click',()=>{activeIndex=index;runActive();});
      list.append(item);
    });
    paintStatus();
  }
  function paintStatus(){
    // Reading the owner-fenced view can clear a genuine identity transition;
    // a locale refresh itself never searches or rebuilds the result list.
    const view=books.view?books.view():{phase:'ready'},query=input.value.trim();
    const labels=paletteLabels();const marker=view.phase==='loading'?labels.loading:view.phase==='error'?(view.error?.id?t(view.error.id):labels.error):query&&!results.length?labels.empty:'';
    if(results.length){const active=results[activeIndex];status.textContent=labels.count(active?.label||'',results.length)+(marker?' · '+marker:'');input.setAttribute('aria-activedescendant','command-palette-option-'+activeIndex);}
    else{status.textContent=marker||labels.empty;input.removeAttribute('aria-activedescendant');}
  }
  function closePalette({restoreFocus=true}={}){
    if(dialog.open)dialog.close();
    if(restoreFocus&&launchPoint&&typeof launchPoint.focus==='function'&&launchPoint.isConnected!==false)launchPoint.focus();
  }
  function runActive(){
    if(disposed)return;
    const entry=results[activeIndex];if(!entry)return;
    closePalette({restoreFocus:!entry.handoff});
    entry.run();
  }
  function open(at=opener){
    if(disposed)return;
    launchPoint=at&&typeof at.focus==='function'?at:document.activeElement;
    activeIndex=0;
    if(dialog.showModal&&!dialog.open)dialog.showModal();else if(!dialog.open&&dialog.show)dialog.show();
    if(typeof input.focus==='function')input.focus();
    refresh();
    // Safe no-adapter revalidation: clear any cached private results before the
    // fresh session check so a previous owner's titles cannot flash back.
    if(!adapter?.getOwner&&!adapter?.subscribe)books.invalidate?.();
    if(books.view?.().phase==='idle')void Promise.resolve(books.load?.()).then(()=>refresh(),()=>refresh());
  }
  const updateLabels=()=>{
    if(disposed||!dialog)return;
    const labels=paletteLabels();
    dialog.setAttribute('aria-label',labels.title);
    input.placeholder=labels.placeholder;
    list.setAttribute('aria-label',labels.title);
    closeControl?.setAttribute('aria-label',labels.close);
    const commands=new Map(paletteCommands(page,adapter,navigate,fullscreen?{fullscreen}:{}).map(entry=>[entry.id,entry]));
    for(let index=0;index<results.length;index++){
      const entry=results[index],command=commands.get(entry.id);
      if(command)entry.label=command.label;
      else if(entry.id==='palette-retry')entry.label=labels.retry;
      // Keep the same option, active identity and scroll position. Actual book
      // titles/authors remain data, even when equal to an interface label.
      const item=list.children[index];if(item)item.textContent=entry.label+(entry.hint?' · '+entry.hint:'');
    }
    paintStatus();
  };
  const offLocale=unLocale=onUiLocaleChange(updateLabels);void uiReady.then(()=>{if(!disposed)updateLabels();});
  refresh();
  return {dialog,open,close:closePalette,refresh,updateLabels,dispose(){if(disposed)return;disposed=true;offLocale();unwatch?.();ownedLibrary?.dispose?.();closePalette({restoreFocus:false});for(const node of created)node.remove?.();}};
  }
}
