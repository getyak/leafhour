import {t,getUiLocale,onUiLocaleChange,uiReady,bindUi} from './ui-locale.mjs';
import {hasShelfFilters} from './library-workspace.mjs';
import {shelfReadingLanguages} from './book-reading-languages.mjs';
import {mountChoiceControl} from './choice-control.mjs';
import {LIBRARY_TOPICS,normalizeLibraryQuery} from './library-view-state.mjs';
import {mountPopover} from './popover-controls.mjs';

// GET-176 current-view summary + GET-177 fiction topic. All four filter
// dropdowns are enhanced by the shared choice primitive: up to six choices are
// immediate segmented chips, larger groups get the searchable combobox. Every
// choice commits immediately (no Done step) and mirrors the native select so
// existing change side effects stay identical; option/value writes go through
// the explicit sync() call only.
const defaults=()=>({scope:'all',status:'all',topic:'all',language:'all',form:'all'});
const languageName=value=>{
  if(['all','unknown','en','zh'].includes(value))return t('filter.language.'+value);
  try{return new Intl.DisplayNames([getUiLocale()],{type:'language'}).of(value)||value;}catch{return value;}
};

export function mountShelfFilters({root,onChange,onOpenChange=()=>{}}){
  const doc=root.ownerDocument;
  const find=id=>root.querySelector('#'+id),search=find('book-search'),panel=find('shelf-filter-panel'),trigger=find('shelf-filter-button');
  const fields={scope:find('shelf-source'),topic:find('shelf-topic'),language:find('shelf-language'),form:find('shelf-form')};
  const states=[...root.querySelectorAll('[data-reading-status]')],chips=find('shelf-filter-chips'),clearButton=find('shelf-filter-clear'),selection=find('shelf-filter-selection'),count=find('shelf-filter-count');
  let values=defaults(),optionsKey='',lastBooks=null,disposed=false,summaryRows=[];
  const unbind=bindUi(root),listeners=[];const listen=(node,event,handler)=>{node.addEventListener(event,handler);listeners.push(()=>node.removeEventListener(event,handler));};
  const read=()=>({...values,query:normalizeLibraryQuery(search.value)});
  const popover=mountPopover({document:doc,element:panel,trigger}),offPopover=popover.subscribe({beforeOpen:position,onChange:onOpenChange});
  const close=()=>popover.close();
  const open=()=>popover.open();
  const set=(patch,{source='user'}={})=>{
    const changed={};
    for(const [key,value] of Object.entries(patch||{})){
      if(key==='query'){search.value=String(value||'');values={...values};changed.query=String(value||'');continue;}
      if(!['scope','status','topic','language','form'].includes(key))continue;
      values={...values,[key]:value};changed[key]=value;
    }
    if(lastBooks)update(lastBooks);
    onChange({patch:changed,source});
  };
  const clear=key=>{
    if(key==='query'){search.value='';values={...values};}
    else if(['scope','status','topic','language','form'].includes(key))values={...values,[key]:'all'};
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
  for(const button of states)listen(button,'click',()=>{if(!disposed)set({status:button.dataset.readingStatus});});
  for(const [key,field] of Object.entries(fields))listen(field,'change',()=>{if(!disposed)set({[key]:field.value});});
  listen(clearButton,'click',()=>{if(!disposed)clearAll();});

  // GET-177: the four dropdowns become the shared progressive choice
  // primitive; the native selects stay as fallback until a mount succeeds.
  const option=(value,label)=>{const node=doc.createElement('option');node.value=value;node.textContent=label;return node;};
  const writeOptions=(topicChoices,languageChoices)=>{
    fields.topic.replaceChildren(option('all',t('filter.topic.all')),...topicChoices.slice(1).map(id=>option(id,t('filter.topic.'+id))));
    fields.language.replaceChildren(option('all',t('filter.language.all')),...languageChoices.slice(1).map(id=>option(id,languageName(id))));
  };
  writeOptions([...LIBRARY_TOPICS],['all','zh','en']);
  const choiceLabel=key=>t('filter.'+key);
  const choices={};
  for(const [key,field] of Object.entries(fields))choices[key]=mountChoiceControl({document:doc,select:field,label:choiceLabel(key)});
  const choiceFocusTarget=control=>!control?null:control.mode==='chips'?control.chips[0]:control.input;
  function focusAfterClear(key){
    let target=key==='query'?search:key==='status'?states[0]:popover.isOpen()?choiceFocusTarget(choices[key]):null;
    if(!target||target.hidden===true)target=trigger;
    target?.focus?.();
  }

  function position(){
    if(typeof window==='undefined')return;
    const bounds=trigger.getBoundingClientRect(),width=Math.min(320,window.innerWidth-32),top=Math.max(16,Math.min(bounds.bottom+8,window.innerHeight-180));
    panel.style.left=Math.max(16,Math.min(bounds.right-width,window.innerWidth-width-16))+'px';
    panel.style.top=top+'px';panel.style.maxHeight=Math.max(150,window.innerHeight-top-16)+'px';
  }
  const reposition=()=>{if(popover.isOpen())position();};
  if(typeof window!=='undefined'){window.addEventListener('resize',reposition);window.addEventListener('scroll',reposition,{passive:true});}

  const summaryEntries=()=>{
    const list=[],query=normalizeLibraryQuery(search.value);
    if(query)list.push(['query',query]);
    if(values.status!=='all')list.push(['status',values.status]);
    if(values.scope!=='all')list.push(['scope',values.scope]);
    if(values.topic!=='all')list.push(['topic',values.topic]);
    if(values.language!=='all')list.push(['language',values.language]);
    if(values.form!=='all')list.push(['form',values.form]);
    return list;
  };

  function update(books){
    lastBooks=books;
    // Chinese and English shortcuts stay selectable even without matching books;
    // every remaining loaded content language stays reachable and searchable.
    const availableLanguages=[...new Set(books.flatMap(shelfReadingLanguages))];
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
    // A same-view background refresh keeps the keyboard's actual button.
    // Rebuild only after the reader changes a filter or follows another view.
    if(entries.length!==summaryRows.length||entries.some(([key,value],index)=>summaryRows[index].key!==key||summaryRows[index].value!==value)){
      summaryRows=entries.map(([key,value])=>{
        const button=doc.createElement('button');button.type='button';button.className='shelf-filter-chip';
        button.addEventListener('click',()=>{if(!disposed)clear(key);});
        return {key,value,button};
      });
      chips.replaceChildren(...summaryRows.map(row=>row.button));
    }
    const active=hasShelfFilters(read());
    clearButton.hidden=!active;
    selection.hidden=!entries.length;
    count.textContent=entries.length?String(entries.length):'';
    trigger.classList.toggle('is-filtered',active);
    updateLabels();
  }
  function updateLabels(){
    if(disposed)return;
    root.setAttribute('lang',getUiLocale());
    for(const [key,field] of Object.entries(fields)){
      for(const option of field.options)option.textContent=key==='language'?languageName(option.value):t('filter.'+key+'.'+option.value);
      choices[key]?.updateLabels({label:choiceLabel(key)});
    }
    for(const button of states)button.textContent=t('filter.status.'+button.dataset.readingStatus);
    for(const {key,value,button} of summaryRows){
      const label=key==='query'?t('filter.search.summary',{query:value}):key==='language'?languageName(value):t('filter.'+key+'.'+value);
      button.textContent=label+' ×';button.setAttribute('aria-label',t('filter.clearOne',{label}));
    }
    trigger.setAttribute('aria-label',hasShelfFilters(read())?t('filter.active',{count:summaryRows.length}):t('filter.open'));
  }
  const offLocale=onUiLocaleChange(updateLabels);void uiReady.then(updateLabels);updateLabels();
  return {
    read,set,clear,clearAll,update,updateLabels,close,open,choices,
    dispose(){if(disposed)return;disposed=true;offLocale();unbind();for(const off of listeners)off();for(const choice of Object.values(choices))choice?.destroy();offPopover();popover.close({focus:false});if(typeof window!=='undefined'){window.removeEventListener('resize',reposition);window.removeEventListener('scroll',reposition);}},
    apply(view){
      values={scope:view.scope||'all',status:view.status||'all',topic:view.topic||'all',language:view.language||'all',form:view.form||'all'};
      search.value=view.query||'';
      if(lastBooks)update(lastBooks);
    },
    reset(){values=defaults();search.value='';optionsKey='';close();if(lastBooks)update(lastBooks);}
  };
}
