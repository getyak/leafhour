import {t,getUiLocale,onUiLocaleChange,uiHref} from './ui-locale.mjs';
import {createNotebookLoader,filterNotebookEntries,notebookMarkdown} from './library-notebook-state.mjs';

export function mountLibraryNotebook({api,getSession,getOwner,getBooks,openAuth,onOpen=()=>{},onClose=()=>{},document=globalThis.document}){
  const labels=new Map(),links=new Map(),rowNodes=new Map(),knownBooks=new Map();let disposed=false,opener=null,owner=null,view={entries:[],failed:[],loading:false,completed:0,total:0},shown=50,filtered=[],searchTimer,bookOptionsKey='';
  const el=(tag,cls)=>{const n=document.createElement(tag);if(cls)n.className=cls;return n;};
  const own=(node,key,params,attr)=>{const render=typeof key==='function'?key:()=>t(key,params);labels.set(node,{render,attr});if(attr)node.setAttribute(attr,render());else node.textContent=render();return node;};
  const ui=(tag,cls,key,params)=>own(el(tag,cls),key,params);
  const button=(cls,key)=>{const node=ui('button',cls,key);node.type='button';return node;};
  const count=value=>new Intl.NumberFormat(getUiLocale()).format(value);
  const dialog=el('dialog','library-notebook-dialog');dialog.id='library-notebook';dialog.setAttribute('aria-labelledby','library-notebook-title');
  const header=el('header','notebook-heading'),heading=el('div'),title=ui('h2','','notebook.title');title.id='library-notebook-title';
  const subtitle=ui('p','notebook-intro','notebook.intro'),close=button('notebook-close','notebook.close');close.textContent='×';own(close,'notebook.close',null,'aria-label');heading.append(title,subtitle);header.append(heading,close);
  const controls=el('div','notebook-controls'),searchLabel=ui('label','sr-only','notebook.search'),search=el('input','notebook-search');search.id='notebook-search';search.type='search';search.maxLength=120;searchLabel.htmlFor=search.id;own(search,'notebook.search',null,'placeholder');
  const bookLabel=ui('label','sr-only','notebook.bookFilter'),bookChoice=el('select','notebook-book-filter');bookChoice.id='notebook-book-filter';bookLabel.htmlFor=bookChoice.id;
  const kindLabel=ui('label','sr-only','notebook.kindFilter'),kindChoice=el('select','notebook-kind-filter');kindChoice.id='notebook-kind-filter';kindLabel.htmlFor=kindChoice.id;
  for(const kind of ['','comment','question','highlight']){const option=ui('option','',kind?'notebook.kind.'+kind:'notebook.allKinds');option.value=kind;kindChoice.append(option);}
  controls.append(searchLabel,search,bookLabel,bookChoice,kindLabel,kindChoice);
  const summary=el('div','notebook-summary'),total=el('p','notebook-count'),exportButton=button('notebook-export','notebook.export');summary.append(total,exportButton);
  const status=el('div','notebook-status'),message=el('p'),retry=button('notebook-retry','notebook.retry'),login=button('notebook-login','notebook.signIn');message.setAttribute('role','status');status.append(message,retry,login);
  const list=el('div','notebook-list'),empty=el('div','notebook-empty'),emptyTitle=el('h3'),emptyBody=el('p'),clearFilter=button('notebook-clear','notebook.clearFilters');empty.append(emptyTitle,emptyBody,clearFilter);
  const more=button('notebook-more','notebook.more'),footer=el('footer','notebook-footer');footer.append(more);
  const fixed=el('div','notebook-fixed'),results=el('div','notebook-results');fixed.append(header,controls,summary);results.append(status,list,empty,footer);dialog.append(fixed,results);document.body.append(dialog);
  const loader=createNotebookLoader({api,getOwner,paged:true,onUpdate:next=>{if(disposed)return;view=next;const signature=JSON.stringify((view.books||[]).map(book=>book.bookId));if(signature!==bookOptionsKey){bookOptionsKey=signature;populateBooks(view.books||getBooks());}render();}});
  const prune=()=>{for(const n of labels.keys())if(!dialog.contains(n))labels.delete(n);for(const n of links.keys())if(!dialog.contains(n))links.delete(n);};
  function sourceLink(row){const link=ui('a','notebook-source',row.sourceAvailable?'notebook.source':'notebook.openBook');link.href=uiHref(row.href);links.set(link,row.href);return link;}
  function rowNode(row){
    const article=el('article','notebook-entry');article.dataset.kind=row.kind;const meta=el('header','notebook-entry-meta'),kind=ui('span','notebook-entry-kind','notebook.kind.'+row.kind),time=el('time');
    if(row.createdAt){time.dateTime=row.createdAt;own(time,()=>new Intl.DateTimeFormat(getUiLocale(),{year:'numeric',month:'short',day:'numeric'}).format(new Date(row.createdAt)));}else own(time,'notebook.dateUnknown');
    const bookTitle=el('p','notebook-entry-book');bookTitle.textContent=row.title;
    meta.append(kind,time);article.append(meta,bookTitle);
    if(row.text){const body=el('p','notebook-entry-text');body.textContent=row.text;article.append(body);}
    if(row.quote){
      // Source quotations stay a distinct object, never styled as the reader's words.
      const quotation=el(row.kind==='highlight'?'div':'details','notebook-quotation');
      const quoteKey=['original','translation'].includes(row.quoteOrigin)?'notebook.quote.'+row.quoteOrigin:'notebook.quote';if(row.kind!=='highlight')quotation.append(ui('summary','',quoteKey));else quotation.append(ui('p','notebook-quote-label',quoteKey));const quote=el('blockquote');quote.textContent=row.quote;quotation.append(quote);article.append(quotation);
    }
    const bottom=el('div','notebook-entry-bottom');bottom.append(sourceLink(row));if(!row.sourceAvailable)bottom.append(ui('span','notebook-source-unavailable','notebook.sourceUnavailable'));if(row.updatedAt&&row.updatedAt!==row.createdAt){const edited=el('time','notebook-edited');edited.dateTime=row.updatedAt;own(edited,()=>t('notebook.edited',{date:new Intl.DateTimeFormat(getUiLocale(),{month:'short',day:'numeric'}).format(new Date(row.updatedAt))}));bottom.append(edited);}article.append(bottom);return article;
  }
  function render(){
    if(disposed)return;
    // Caller clears synchronously at owner adoption; this additional check also
    // keeps an independently mounted notebook from painting an earlier account.
    if(owner!==getOwner()){list.replaceChildren();rowNodes.clear();view={entries:[],failed:[],loading:false,completed:0,total:0};filtered=[];}
    const signedIn=!!getSession()?.user,query=search.value,bookId=bookChoice.value,kind=kindChoice.value;
    filtered=signedIn?filterNotebookEntries(view.entries,{query,bookId,kind}):[];
    const visible=filtered.slice(0,shown),keys=new Set(visible.map(row=>row.key));
    for(const [key,node] of rowNodes)if(!keys.has(key)){node.remove();rowNodes.delete(key);}
    visible.forEach((row,index)=>{
      let node=rowNodes.get(row.key);
      const signature=JSON.stringify(row);
      if(node&&node.dataset.record!==signature){node.remove();rowNodes.delete(row.key);node=null;}
      if(!node){node=rowNode(row);node.dataset.record=signature;rowNodes.set(row.key,node);}
      // Leave unchanged rows attached: focused links and expanded quotations survive progress.
      if(list.children[index]!==node)list.insertBefore(node,list.children[index]||null);
    });prune();
    own(total,()=>t('notebook.count',{count:count(filtered.length),books:count(new Set(filtered.map(row=>row.bookId)).size)}));
    exportButton.disabled=!filtered.length;exportButton.hidden=!signedIn;
    login.hidden=signedIn;retry.hidden=!signedIn||!view.failed.length&&!view.archiveFailed;
    message.hidden=signedIn&&!view.loading&&!view.failed.length&&!view.archiveFailed;
    own(message,()=>!signedIn?t('notebook.guest'):view.failed.length?t('notebook.partial',{count:count(view.failed.length)}):view.archiveFailed?t('notebook.archiveFailed'):view.loading?t('notebook.loading',{done:count(view.completed),total:count(view.total)}):'');
    empty.hidden=!signedIn||view.loading||filtered.length>0||view.failed.length>0||view.archiveFailed;
    const hasFilter=!!query||!!bookId||!!kind;
    own(emptyTitle,hasFilter?'notebook.noMatch':'notebook.empty');own(emptyBody,hasFilter?'notebook.noMatchHelp':'notebook.emptyHelp');clearFilter.hidden=!hasFilter;
    more.hidden=filtered.length<=shown;own(more,()=>t('notebook.moreCount',{count:count(Math.min(50,Math.max(0,filtered.length-shown)))}));
    list.setAttribute('aria-busy',String(view.loading));
  }
  function populateBooks(available=getBooks()){
    // Page inventories are incomplete during refresh; retain known same-owner options.
    // Only an explicit owner clear discards their metadata and selected filter.
    for(const book of available)knownBooks.set(book.bookId,book);
    const previous=bookChoice.value,all=ui('option','','notebook.allBooks');all.value='';
    bookChoice.replaceChildren(all,...[...knownBooks.values()].map(book=>{const option=el('option');option.value=book.bookId;option.textContent=typeof book.title==='string'?book.title:book.title?.zh||book.title?.en||book.bookId;return option;}));bookChoice.value=[...bookChoice.options].some(option=>option.value===previous)?previous:'';
  }
  async function load(){if(disposed||!dialog.open||!getSession()?.user)return;owner=getOwner();await loader.load(getBooks(),{includeArchived:true});}
  function open(){
    if(disposed||dialog.open&&owner===getOwner())return;
    if(owner!==getOwner())clear();populateBooks();
    if(!dialog.open){opener=document.activeElement;dialog.showModal();onOpen();search.focus({preventScroll:true});}
    render();void load();
  }
  function clear(){
    clearTimeout(searchTimer);owner=getOwner();knownBooks.clear();bookOptionsKey='';search.value='';bookChoice.value='';kindChoice.value='';shown=50;loader.clear();
    if(dialog.open)dialog.close();render();
  }
  close.addEventListener('click',()=>dialog.close());
  dialog.addEventListener('close',()=>{onClose();if(opener?.isConnected)opener.focus({preventScroll:true});opener=null;});
  search.addEventListener('input',()=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>{shown=50;render();},100);});
  for(const control of [bookChoice,kindChoice])control.addEventListener('change',()=>{clearTimeout(searchTimer);shown=50;render();});
  clearFilter.addEventListener('click',()=>{search.value='';bookChoice.value='';kindChoice.value='';shown=50;render();search.focus();});
  more.addEventListener('click',()=>{shown+=50;render();list.children[Math.max(0,shown-50)]?.querySelector('a')?.focus({preventScroll:true});});
  retry.addEventListener('click',()=>void load());
  login.addEventListener('click',()=>{dialog.close();openAuth();});
  exportButton.addEventListener('click',()=>{
    if(disposed||getOwner()!==owner||!getSession()?.user||!filtered.length)return;
    const content=notebookMarkdown(filtered,{title:t('notebook.title'),baseUrl:document.defaultView?.location?.origin||'https://leafhour.com',labels:{comment:t('notebook.kind.comment'),question:t('notebook.kind.question'),highlight:t('notebook.kind.highlight'),quote:t('notebook.quote'),'quote.original':t('notebook.quote.original'),'quote.translation':t('notebook.quote.translation'),openBook:t('notebook.openBook'),sourceUnavailable:t('notebook.sourceUnavailable'),created:t('notebook.created'),updated:t('notebook.updated'),source:t('notebook.source')}});
    const blob=new Blob([content],{type:'text/markdown;charset=utf-8'}),url=URL.createObjectURL(blob),download=el('a');download.href=url;download.download='leafhour-notebook.md';document.body.append(download);download.click();download.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  });
  function updateLabels(){if(disposed)return;prune();for(const [node,{render,attr}] of labels){if(attr)node.setAttribute(attr,render());else node.textContent=render();}for(const [link,href] of links)link.href=uiHref(href);}
  const offLocale=onUiLocaleChange(updateLabels);populateBooks();render();
  return {open,close(){if(dialog.open)dialog.close();},clear,updateLabels,isOpen:()=>dialog.open,dispose(){if(disposed)return;disposed=true;clearTimeout(searchTimer);loader.dispose();offLocale();dialog.remove();labels.clear();links.clear();rowNodes.clear();knownBooks.clear();}};
}
