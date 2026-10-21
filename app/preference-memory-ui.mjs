import {trackActionFocus} from './action-focus.mjs';
import {t,onUiLocaleChange,uiHref} from './ui-locale.mjs';
import {memoryChoices,onboardingChoices} from './preference-memory-codec.mjs';
// The caller owns session adoption and the home filter. Responses are accepted
// only for the exact owner/generation; uncertain writes are recovered by GET.
export function mountPreferenceMemory({root,kind='settings',api,getSession,getBooks=()=>[],isReady=()=>true,open=()=>{},onSaved=()=>{}}){
 const doc=root.ownerDocument;let owner=null,generation=0,busy=false,disposed=false,startedOwner=null,error=false,signature='',view=null,labelPaints=[],queuedRefresh=null;
 const n=(tag,text,cls)=>{const el=doc.createElement(tag);if(text!==undefined)el.textContent=text;if(cls)el.className=cls;return el;};
 const translated=(tag,id,cls,params)=>{const el=n(tag,undefined,cls),paint=()=>{el.textContent=t(id,params);};labelPaints.push(paint);paint();return el;};
 const btn=(id,fn)=>{const el=translated('button',id,'library-chat-button');el.type='button';el.disabled=busy||error&&id!=='memory.readLatest';el.addEventListener('click',fn);return el;};
 const labelValue=(key,value)=>t(key==='topic'?'filter.topic.'+value:'memory.value.'+value);
 function current(token,expected){return !disposed&&generation===token&&getSession()?.user?.id===expected;}
 function adopt(value,options={changed:false}){if(value.revision<Math.max(view?.revision||0,getSession()?.preferenceMemory?.revision||0,getSession()?.readingPreferences?.revision||0))return;view=value;onSaved(value,options);}
 async function refresh(options={changed:false}){
  const expected=getSession()?.user?.id;if(!expected||disposed)return;if(busy){if(options.changed)queuedRefresh=options;return;}
  const trigger=root.contains(doc.activeElement)?doc.activeElement:null,focusedId=trigger?.id,focus=trackActionFocus(doc,trigger);
  const token=++generation;busy=true;paint();
  try{const value=await api('/api/account/preference-memory');if(current(token,expected)){adopt(value,options);error=false;}}
  catch{if(current(token,expected))error=true;}
  finally{if(current(token,expected)){busy=false;paint();focus.restore(focusedId?root.querySelector('#'+focusedId):null);drainRefresh();}else focus.stop();}
 }
 async function change(patch){
  if(disposed||busy||error||!owner||owner!==getSession()?.user?.id||!view)return;
  const focus=trackActionFocus(doc,root.contains(doc.activeElement)?doc.activeElement:null),key=patch.key==='language'?'mode':patch.key==='style'?'theme':patch.key;
  const expected=owner,token=++generation;busy=true;error=false;paint();
  try{const value=await api('/api/account/preference-memory',{baseRevision:view.revision,...patch});if(current(token,expected))adopt(value,{changed:true,keys:patch.action==='onboarding'?(key?[key]:[]):[key]});}
  catch{if(current(token,expected))error=true;}
  finally{if(current(token,expected)){busy=false;paint();const target=kind==='settings'?root.querySelector('#memory-setting-'+key):root.hidden?root.closest?.('.library-chat-dialog')?.querySelector('textarea'):root.querySelector('[data-memory-choice]');focus.restore(target);drainRefresh();}else focus.stop();}
 }
 function drainRefresh(){const queued=queuedRefresh;queuedRefresh=null;if(queued)void refresh(queued);}
 function paint(){
  if(disposed)return;signature='';labelPaints=[];root.replaceChildren();root.classList.add('preference-memory');root.setAttribute('aria-busy',String(busy));
  if(!owner||!view?.memory){root.hidden=true;if(kind==='onboarding')root.closest?.('.library-chat-dialog')?.classList.remove('has-preference-onboarding');return;}
  const memory=view.memory,o=memory.onboarding;root.hidden=kind==='onboarding'&&o.status!=='pending';if(kind==='onboarding')root.closest?.('.library-chat-dialog')?.classList.toggle('has-preference-onboarding',!root.hidden);if(root.hidden)return;
  root.append(translated('h3',kind==='onboarding'?'memory.welcome':'memory.title'));
  if(kind==='onboarding'){
   const book=getBooks().find(b=>b.visibility==='public')||getBooks()[0];
   root.append(translated('p',book?'memory.tryBook':'memory.noBook'));
   if(book){const link=n('a',book.title?.zh||book.title?.en||book.title||t('bk'),'library-chat-source-link');const updateLink=()=>{link.href=uiHref('/read?book='+encodeURIComponent(book.bookId));};labelPaints.push(updateLink);updateLink();root.append(link);}
   root.append(translated('p','memory.noGeneration','settings-description'));
   const key=o.order[o.answers.length];if(!key)return;
   const progress=translated('p','memory.progress','settings-description',{step:o.answers.length+1});root.append(progress,translated('p','memory.question.'+key));
   const choices=n('div',undefined,'preference-memory-choices');
   for(const value of onboardingChoices[key]){const b=btn(key==='topic'?'filter.topic.'+value:'memory.value.'+value,()=>change({action:'onboarding',event:'answered',key,choice:value}));b.setAttribute('data-memory-choice',value);choices.append(b);}
   choices.append(btn('memory.skipQuestion',()=>change({action:'onboarding',event:'skipped',key})));root.append(choices,btn('memory.skipAll',()=>change({action:'onboarding',event:'dismissed'})));
  }else{
   root.append(translated('p','memory.explanation','settings-description'));
   for(const key of Object.keys(memoryChoices)){
    const row=n('div',undefined,'preference-memory-row'),label=translated('label','memory.key.'+key),select=n('select');select.id='memory-setting-'+key;select.disabled=busy||error;label.htmlFor=select.id;const aria=()=>select.setAttribute('aria-label',t('memory.key.'+key));labelPaints.push(aria);aria();
    if(key==='topic'){const opt=translated('option','filter.topic.all');opt.value='';select.append(opt);}
    for(const value of memoryChoices[key]){const opt=translated('option',key==='topic'?'filter.topic.'+value:'memory.value.'+value);opt.value=value;select.append(opt);}
    select.value=key==='topic'?memory.topic||'':view.preferences?.[key]||memoryChoices[key][0];
    select.addEventListener('change',()=>change(select.value?{action:'update',key,value:select.value}:{action:'delete',key}));
    row.append(label,select);if(memory.sources[key]){const source=n('small'),paint=()=>{source.textContent=t('memory.source.'+memory.sources[key].source)+' · '+new Date(memory.sources[key].at).toLocaleDateString();};labelPaints.push(paint);paint();row.append(source);}
    if(memory.sources[key]||key==='topic'&&memory.topic)row.append(btn('memory.delete',()=>change({action:'delete',key})));
    const suggestion=memory.suggestions[key];
    if(suggestion){const pending=n('div',undefined,'preference-memory-suggestion');const text=n('p'),paint=()=>{text.textContent=t('memory.inferred',{value:labelValue(key,suggestion.value)});};labelPaints.push(paint);paint();pending.append(text,btn('memory.confirm',()=>change({action:'confirm',key})),btn('memory.reject',()=>change({action:'reject',key})));row.append(pending);}
    root.append(row);
   }
  }
  const status=error?translated('p','memory.failed','settings-status'):busy?translated('p','memory.saving','settings-status'):n('p','','settings-status');status.setAttribute('role',error?'alert':'status');root.append(status);
  if(error)root.append(btn('memory.readLatest',refresh));
  signature=JSON.stringify([owner,view,busy,error,getBooks().map(b=>b.bookId)]);
 }
 function update(){
  if(disposed)return;const session=getSession(),next=session?.user?.id||null;
  if(next!==owner){owner=next;generation++;busy=false;error=false;queuedRefresh=null;startedOwner=null;view=null;signature='';}
  if(session?.preferenceMemory&&session.preferenceMemory.revision>=(view?.revision||0))view=session.preferenceMemory;
  const nextSignature=JSON.stringify([owner,view,busy,error,getBooks().map(b=>b.bookId)]);if(signature!==nextSignature)paint();
  if(kind==='onboarding'&&isReady()&&owner&&view?.memory.onboarding.status==='pending'&&startedOwner!==owner){
   startedOwner=owner;open();if(!view.memory.onboarding.events.some(e=>e.event==='started'))void change({action:'onboarding',event:'started'});
  }
 }
 const relabel=()=>{for(const paint of labelPaints)paint();};
 const off=onUiLocaleChange(relabel);
 return {update,refresh,updateLabels:relabel,dispose(){disposed=true;generation++;off();root.replaceChildren();}};
}
