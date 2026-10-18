import {hasShelfFilters,shelfLanguage} from './library-workspace.mjs';
import {mountChoiceControl} from './choice-control.mjs';
import {LIBRARY_TOPICS,normalizeLibraryQuery} from './library-view-state.mjs';

// GET-176 current-view summary + GET-177 fiction topic. All three filter
// dropdowns are enhanced by the shared choice primitive: up to six choices are
// immediate segmented chips, larger groups get the searchable combobox. Every
// choice commits immediately (no Done step) and mirrors the native select so
// existing change side effects stay identical; option/value writes go through
// the explicit sync() call only.
const topics=new Map([['philosophy','哲学与自我'],['science','科学与技术'],['literature','文学与想象'],['history','历史与社会'],['fiction','小说与故事']]);
const sources=new Map([['all','全部来源'],['public','内置书'],['private','我上传的']]);
const statuses=new Map([['all','全部'],['reading','在读'],['unread','未读'],['finished','读完']]);
const defaults=()=>({scope:'all',status:'all',topic:'all',language:'all'});
const languageName=value=>{
  if(value==='unknown')return '未识别';
  if(value==='en')return '英文';
  if(value==='zh')return '中文';
  try{return new Intl.DisplayNames(['zh-Hans'],{type:'language'}).of(value)||value;}catch{return value;}
};

export function mountShelfFilters({root,onChange,onOpenChange=()=>{}}){
  const doc=root.ownerDocument;
  const find=id=>root.querySelector('#'+id),search=find('book-search'),panel=find('shelf-filter-panel'),trigger=find('shelf-filter-button');
  const fields={scope:find('shelf-source'),topic:find('shelf-topic'),language:find('shelf-language')};
  const states=[...root.querySelectorAll('[data-reading-status]')],chips=find('shelf-filter-chips'),clearButton=find('shelf-filter-clear'),selection=find('shelf-filter-selection'),count=find('shelf-filter-count');
  let values=defaults(),optionsKey='',lastBooks=null;
  const read=()=>({...values,query:normalizeLibraryQuery(search.value)});
  const close=()=>{if(panel.matches(':popover-open'))panel.hidePopover();};
  const open=()=>{if(!panel.matches(':popover-open'))panel.showPopover();};
  const set=patch=>{
    const changed={};
    for(const [key,value] of Object.entries(patch||{})){
      if(key==='query'){search.value=String(value||'');values={...values};changed.query=String(value||'');continue;}
      if(!['scope','status','topic','language'].includes(key))continue;
      values={...values,[key]:value};changed[key]=value;
    }
    if(lastBooks)update(lastBooks);
    onChange({patch:changed});
  };
  const clear=key=>{
    if(key==='query'){search.value='';values={...values};}
    else if(['scope','status','topic','language'].includes(key))values={...values,[key]:'all'};
    if(lastBooks)update(lastBooks);
    onChange({clear:key});
    focusAfterClear(key);
  };
  const clearAll=()=>{
    values=defaults();search.value='';
    if(lastBooks)update(lastBooks);
    onChange({clearAll:true});
    search.focus?.();
  };
  for(const button of states)button.addEventListener('click',()=>set({status:button.dataset.readingStatus}));
  for(const [key,field] of Object.entries(fields))field.addEventListener('change',()=>set({[key]:field.value}));
  clearButton.addEventListener('click',()=>clearAll());

  // GET-177: the three dropdowns become the shared progressive choice
  // primitive; the native selects stay as fallback until a mount succeeds.
  const option=(value,label)=>{const node=doc.createElement('option');node.value=value;node.textContent=label;return node;};
  const writeOptions=(topicChoices,languageChoices)=>{
    fields.topic.replaceChildren(option('all','全部主题'),...topicChoices.slice(1).map(id=>option(id,topics.get(id))));
    fields.language.replaceChildren(option('all','全部原文语言'),...languageChoices.slice(1).map(id=>option(id,languageName(id))));
  };
  writeOptions([...LIBRARY_TOPICS],['all','zh','en']);
  const choiceLabel={scope:'来源',topic:'主题',language:'原文语言'};
  const choices={};
  for(const [key,field] of Object.entries(fields))choices[key]=mountChoiceControl({document:doc,select:field,label:choiceLabel[key]});
  const choiceFocusTarget=control=>!control?null:control.mode==='chips'?control.chips[0]:control.input;
  function focusAfterClear(key){
    let target=key==='query'?search:key==='status'?states[0]:panel.matches(':popover-open')?choiceFocusTarget(choices[key]):null;
    if(!target||target.hidden===true)target=trigger;
    target?.focus?.();
  }

  function position(){
    if(typeof window==='undefined')return;
    const bounds=trigger.getBoundingClientRect(),width=Math.min(320,window.innerWidth-32),top=Math.max(16,Math.min(bounds.bottom+8,window.innerHeight-180));
    panel.style.left=Math.max(16,Math.min(bounds.right-width,window.innerWidth-width-16))+'px';
    panel.style.top=top+'px';panel.style.maxHeight=Math.max(150,window.innerHeight-top-16)+'px';
  }
  panel.addEventListener('beforetoggle',event=>{if(event.newState==='open')position();});
  panel.addEventListener('toggle',event=>{trigger.setAttribute('aria-expanded',String(event.newState==='open'));onOpenChange(event.newState==='open');});
  const reposition=()=>{if(panel.matches(':popover-open'))position();};
  if(typeof window!=='undefined'){window.addEventListener('resize',reposition);window.addEventListener('scroll',reposition,{passive:true});}

  const summaryEntries=()=>{
    const list=[],query=normalizeLibraryQuery(search.value);
    if(query)list.push(['query','搜索：'+query]);
    if(values.status!=='all')list.push(['status',statuses.get(values.status)]);
    if(values.scope!=='all')list.push(['scope',sources.get(values.scope)]);
    if(values.topic!=='all')list.push(['topic',topics.get(values.topic)]);
    if(values.language!=='all')list.push(['language',languageName(values.language)]);
    return list;
  };

  function update(books){
    lastBooks=books;
    // Chinese and English shortcuts stay selectable even without matching books;
    // every remaining loaded source language stays reachable and searchable.
    const availableLanguages=[...new Set(books.map(shelfLanguage))];
    const extras=[...new Set([...availableLanguages,...(values.language==='all'?[]:[values.language])])].filter(id=>!['zh','en'].includes(id)).sort();
    const languageChoices=['all','zh','en',...extras];
    const topicChoices=[...LIBRARY_TOPICS];
    const key=JSON.stringify([topicChoices,languageChoices]);
    if(key!==optionsKey){
      optionsKey=key;
      writeOptions(topicChoices,languageChoices);
    }
    for(const [key,field] of Object.entries(fields))field.value=values[key];
    // Programmatic options/value writes above always sync explicitly.
    for(const choice of Object.values(choices))choice?.sync();
    for(const button of states)button.setAttribute('aria-pressed',String(button.dataset.readingStatus===values.status));
    for(const button of doc.querySelectorAll('[data-shelf]'))button.setAttribute('aria-pressed',String(button.dataset.shelf===values.scope));
    const entries=summaryEntries();
    chips.replaceChildren(...entries.map(([key,label])=>{
      const button=doc.createElement('button');button.type='button';button.className='shelf-filter-chip';button.textContent=label+' ×';
      button.setAttribute('aria-label','取消筛选：'+label);
      button.addEventListener('click',()=>clear(key));
      return button;
    }));
    const active=hasShelfFilters(read());
    clearButton.hidden=!active;
    selection.hidden=!entries.length;
    count.textContent=entries.length?String(entries.length):'';
    trigger.classList.toggle('is-filtered',active);
    trigger.setAttribute('aria-label',active?'筛选书籍，已选 '+entries.length+' 项':'筛选书籍');
  }
  return {
    read,set,clear,clearAll,update,close,open,choices,
    apply(view){
      values={scope:view.scope||'all',status:view.status||'all',topic:view.topic||'all',language:view.language||'all'};
      search.value=view.query||'';
      if(lastBooks)update(lastBooks);
    },
    reset(){values=defaults();search.value='';optionsKey='';close();if(lastBooks)update(lastBooks);}
  };
}
