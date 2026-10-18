import {createPaletteLibrary} from './palette-library.mjs';
import {readingBookUrl} from './library-workspace.mjs';
import {libraryViewDefaults,writeLibraryView,safeLibraryReturn} from './library-view-state.mjs';

// GET-178 one accessible command palette for every scoped page entry. This
// module loads on demand from palette-bootstrap.mjs and imports no unrelated
// page controller: per-page behaviour arrives through the explicit adapter.

// Explicit owning-component label dictionary (GET-192 locale extraction can swap
// this object without any global DOM translator).
export const PALETTE_TEXT=Object.freeze({
  title:'搜索与命令',
  placeholder:'搜索书名、作者或命令',
  close:'关闭命令面板',
  loading:'正在载入书目…',
  empty:'没有匹配的书目或命令',
  error:'书目暂时无法载入',
  count:(name,count)=>name+' · '+count+' 项结果',retry:'重新载入书目',
  library:'打开书房',settings:'打开设置',calendar:'打开阅读日历',home:'回到首页',
  themePaper:'纸白',themeNight:'夜色',fontLarger:'字号调大',fontSmaller:'字号调小',fullscreen:'全屏阅读'
});

const fold=value=>String(value||'').normalize('NFKC').toLowerCase();
const matches=(label,query)=>!query||fold(label).includes(fold(query));

// Settings and calendar destinations are produced by the exact GET-179 owned
// view codec and validated by its safe return codec; unknown keys never ride.
export function paletteLibraryUrl(overlay){
  const target='/library'+writeLibraryView('',{view:libraryViewDefaults(),overlay:overlay||null});
  return safeLibraryReturn(target)||'/library';
}

// Page command sets stay explicit per page. A fixed console without a working
// appearance adapter offers navigation to the validated appearance settings
// instead of dead theme actions.
export function paletteCommands(page,adapter=null,navigate=url=>location.assign(url),{fullscreen=adapter?.fullscreen||(()=>{})}={}){
  const commands=[
    {id:'library',label:PALETTE_TEXT.library,handoff:true,run:()=>navigate('/library')},
    {id:'settings',label:PALETTE_TEXT.settings,handoff:true,run:()=>navigate(paletteLibraryUrl({kind:'settings',tab:'appearance'}))},
    {id:'calendar',label:PALETTE_TEXT.calendar,handoff:true,run:()=>navigate(paletteLibraryUrl({kind:'calendar'}))},
    {id:'home',label:PALETTE_TEXT.home,handoff:true,run:()=>navigate('/')}
  ];
  const appearance=adapter?.appearance;
  if(page==='reader'){
    if(appearance?.setTheme){
      commands.push({id:'theme-paper',label:PALETTE_TEXT.themePaper,run:()=>appearance.setTheme('paper')});
      commands.push({id:'theme-night',label:PALETTE_TEXT.themeNight,run:()=>appearance.setTheme('night')});
    }
    if(appearance?.adjustFont){
      commands.push({id:'font-larger',label:PALETTE_TEXT.fontLarger,run:()=>appearance.adjustFont(1)});
      commands.push({id:'font-smaller',label:PALETTE_TEXT.fontSmaller,run:()=>appearance.adjustFont(-1)});
    }
    commands.push({id:'fullscreen',label:PALETTE_TEXT.fullscreen,handoff:true,run:()=>fullscreen()});
  }
  return commands;
}

export function openCommandPalette({document=globalThis.document,page='home',adapter=null,navigate=url=>location.assign(url),request=fetch,getOwner=null,opener=null,library=null,fullscreen=null}={}){
  const owner=getOwner??adapter?.getOwner??null;
  const books=library||createPaletteLibrary({request,getOwner:owner,subscribe:adapter?.subscribe});
  books.watch?.(()=>refresh());
  if(!document.getElementById('command-palette')&&document.head?.append){const link=document.createElement('link');link.rel='stylesheet';link.href='/command-palette.css';document.head.append(link);}
  let dialog=document.getElementById('command-palette');
  if(!dialog){
    dialog=document.createElement('dialog');dialog.id='command-palette';dialog.className='command-palette';dialog.setAttribute('aria-label',PALETTE_TEXT.title);
    const input=document.createElement('input');input.id='command-palette-input';input.type='text';input.autocomplete='off';input.setAttribute('role','combobox');input.setAttribute('aria-controls','command-palette-list');input.setAttribute('aria-expanded','true');input.placeholder=PALETTE_TEXT.placeholder;
    const status=document.createElement('p');status.id='command-palette-status';status.setAttribute('role','status');
    const list=document.createElement('ul');list.id='command-palette-list';list.setAttribute('role','listbox');list.setAttribute('aria-label',PALETTE_TEXT.title);
    const close=document.createElement('button');close.type='button';close.className='command-palette-close';close.setAttribute('aria-label',PALETTE_TEXT.close);close.textContent='×';
    dialog.append(close,input,status,list);
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
  let results=[],activeIndex=0,launchPoint=null;
  function visibleEntries(){
    const query=input.value.trim();
    const commands=paletteCommands(page,adapter,navigate,fullscreen?{fullscreen}:{}).filter(command=>matches(command.label,query));
    const found=query?books.search(query).map(book=>({id:'book:'+book.bookId,label:book.title?.zh||book.title?.en||book.bookId,hint:book.author||'',handoff:true,run:()=>navigate(readingBookUrl(book))})):[];
    const retry=books.view?.().phase==='error'?[{id:'palette-retry',label:PALETTE_TEXT.retry,handoff:false,run:()=>{void Promise.resolve(books.load?.()).then(()=>refresh(),()=>refresh());}}]:[];
    return [...commands,...found,...retry];
  }
  function refresh(){
    results=visibleEntries();
    if(activeIndex>=results.length)activeIndex=Math.max(0,results.length-1);
    list.replaceChildren();
    results.forEach((entry,index)=>{
      const item=document.createElement('li');item.id='command-palette-option-'+index;item.setAttribute('role','option');item.setAttribute('aria-selected',String(index===activeIndex));item.textContent=entry.label+(entry.hint?' · '+entry.hint:'');
      item.addEventListener('click',()=>{activeIndex=index;runActive();});
      list.append(item);
    });
    // The library state is announced even when page commands also matched.
    const view=books.view?books.view():{phase:'ready'},query=input.value.trim();
    const marker=view.phase==='loading'?PALETTE_TEXT.loading:view.phase==='error'?PALETTE_TEXT.error:query&&!results.length?PALETTE_TEXT.empty:'';
    if(results.length){const active=results[activeIndex];status.textContent=PALETTE_TEXT.count(active?.label||'',results.length)+(marker?' · '+marker:'');input.setAttribute('aria-activedescendant','command-palette-option-'+activeIndex);}
    else{status.textContent=marker||PALETTE_TEXT.empty;input.removeAttribute('aria-activedescendant');}
  }
  function closePalette({restoreFocus=true}={}){
    if(dialog.open)dialog.close();
    if(restoreFocus&&launchPoint&&typeof launchPoint.focus==='function'&&launchPoint.isConnected!==false)launchPoint.focus();
  }
  function runActive(){
    const entry=results[activeIndex];if(!entry)return;
    closePalette({restoreFocus:!entry.handoff});
    entry.run();
  }
  function open(at=opener){
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
  refresh();
  return {dialog,open,close:closePalette,refresh};
}
