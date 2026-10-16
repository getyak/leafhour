import {hasShelfFilters,shelfLanguage} from './library-workspace.mjs';

const topics=new Map([['philosophy','哲学与自我'],['science','科学与技术'],['literature','文学与想象'],['history','历史与社会']]);
const sources=new Map([['all','全部来源'],['public','内置书'],['private','我上传的']]);
const defaults=()=>({scope:'all',status:'all',topic:'all',language:'all'});
const languageName=value=>{
  if(value==='unknown')return '未识别';
  if(value==='en')return '英文';
  if(value==='zh')return '中文';
  try{return new Intl.DisplayNames(['zh-Hans'],{type:'language'}).of(value)||value;}catch{return value;}
};

export function mountShelfFilters({root,onChange}){
  const find=id=>root.querySelector('#'+id),search=find('book-search'),panel=find('shelf-filter-panel'),trigger=find('shelf-filter-button');
  const fields={scope:find('shelf-source'),topic:find('shelf-topic'),language:find('shelf-language')};
  const states=[...root.querySelectorAll('[data-reading-status]')],chips=find('shelf-filter-chips'),clear=find('shelf-filter-clear');
  let values=defaults(),optionsKey='';
  const read=()=>({...values,query:search.value});
  const close=()=>{if(panel.matches(':popover-open'))panel.hidePopover();};
  function set(patch){values={...values,...patch};onChange();}
  for(const button of states)button.addEventListener('click',()=>set({status:button.dataset.readingStatus}));
  for(const [key,field] of Object.entries(fields))field.addEventListener('change',()=>set({[key]:field.value}));
  clear.addEventListener('click',()=>{values=defaults();onChange();states[0].focus();});

  function position(){
    const bounds=trigger.getBoundingClientRect(),width=Math.min(320,innerWidth-32),top=Math.max(16,Math.min(bounds.bottom+8,innerHeight-180));
    panel.style.left=Math.max(16,Math.min(bounds.right-width,innerWidth-width-16))+'px';
    panel.style.top=top+'px';panel.style.maxHeight=Math.max(150,innerHeight-top-16)+'px';
  }
  panel.addEventListener('beforetoggle',event=>{if(event.newState==='open')position();});
  panel.addEventListener('toggle',event=>trigger.setAttribute('aria-expanded',String(event.newState==='open')));
  const reposition=()=>{if(panel.matches(':popover-open'))position();};
  window.addEventListener('resize',reposition);window.addEventListener('scroll',reposition,{passive:true});

  function update(books){
    const availableTopics=new Set(books.flatMap(book=>Array.isArray(book.topics)?book.topics:[]));
    const availableLanguages=[...new Set(books.map(shelfLanguage))].sort();
    const topicChoices=[...topics].filter(([id])=>availableTopics.has(id)||values.topic===id);
    const languageChoices=[...new Set([...availableLanguages,...(values.language==='all'?[]:[values.language])])];
    const key=JSON.stringify([topicChoices,languageChoices]);
    if(key!==optionsKey){
      optionsKey=key;
      const option=(value,label)=>{const node=document.createElement('option');node.value=value;node.textContent=label;return node;};
      fields.topic.replaceChildren(option('all','全部主题'),...topicChoices.map(([id,label])=>option(id,label)));
      fields.language.replaceChildren(option('all','全部原文语言'),...languageChoices.map(id=>option(id,languageName(id))));
    }
    for(const [key,field] of Object.entries(fields))field.value=values[key];
    for(const button of states)button.setAttribute('aria-pressed',String(button.dataset.readingStatus===values.status));
    for(const button of document.querySelectorAll('[data-shelf]'))button.setAttribute('aria-pressed',String(button.dataset.shelf===values.scope));
    const selected=Object.entries(values).filter(([key,value])=>key!=='status'&&value!=='all');
    chips.replaceChildren(...selected.map(([key,value])=>{
      const button=document.createElement('button'),label=key==='scope'?sources.get(value):key==='topic'?topics.get(value):languageName(value);
      button.type='button';button.className='shelf-filter-chip';button.textContent=label+' ×';button.setAttribute('aria-label','取消筛选：'+label);
      button.addEventListener('click',()=>{set({[key]:'all'});trigger.focus();});return button;
    }));
    clear.hidden=!hasShelfFilters(values);find('shelf-filter-selection').hidden=!selected.length&&clear.hidden;
    find('shelf-filter-count').textContent=selected.length?String(selected.length):'';
    trigger.classList.toggle('is-filtered',!!selected.length);
    trigger.setAttribute('aria-label',selected.length?'筛选书籍，已选 '+selected.length+' 项':'筛选书籍');
  }
  return {read,set,update,close,reset(){values=defaults();search.value='';optionsKey='';close();}};
}
