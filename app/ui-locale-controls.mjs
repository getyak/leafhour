// Both the generated radio view and the native Aa fallback use this exact
// status presentation. The four-code runtime remains the state authority.
const pendingLocale=state=>state.phase==='pending'&&(state.pendingPreference||state.requested);
function renderLocaleStatus({state,text,current,notice,retryButton,reloadButton}){
 const name=code=>text('ui.language.option.'+code);
 current.textContent=text('ui.language.current').replace(/\{language\}/g,name(state.effective||'en'))+(state.source==='page'?' · '+text('ui.language.pageOverride'):'');
 let message='',retry=false,reload=false;
 if(state.phase==='pending')message=text('ui.locale.loading');
 else if(state.phase==='error'){
  const target=name(state.retryTarget||state.requested||'en');
  message=state.fallbackReason==='history'?text('ui.locale.historyError'):state.initialFallback?text('ui.locale.fallback.notice').replace(/\{language\}/g,target):text('ui.locale.loadFailed').replace(/\{language\}/g,target).replace(/\{effective\}/g,name(state.effective||'en'));
  reload=!!state.offerReload;retry=!reload;
 }else if(state.persistence==='session-only'){
  message=text(state.persistenceScope==='page'?'ui.locale.pageOnly':'ui.locale.sessionOnly');retry=true;
 }else{
  const phase=state.account?.phase;
  if(['reading','saving','saved','error','conflict'].includes(phase))message=text('ui.accountLocale.'+phase);
  retry=phase==='error'||phase==='conflict';
 }
 notice.textContent=message;notice.hidden=!message;retryButton.hidden=!retry;reloadButton.hidden=!reload;
}

// GET-192 optional presentation helper for the Interface language choice.
// It takes explicit injected runtime callbacks and data and never imports the
// mutable ui-locale singleton itself, so it stays a view helper rather than a
// second API owner. It owns only its own labels, radios, notices and retry/
// reload affordances: no business update, reload, preference rewrite or
// focus reset happens here. Visible names and ARIA are written directly (the
// data-ui markers are ownership markers, not a dependency on global binding).
export function mountUiLocaleControls({
  root,
  options,
  getState,
  setLocale,
  retry,
  subscribeState=()=>()=>{},
  labels={}
}={}){
  if(!root||typeof getState!=='function'||typeof setLocale!=='function')return null;
  const text=typeof labels==='function'?labels:(id=>labels&&labels[id]||id);
  const list=['system',...(Array.isArray(options)&&options.length?options:['en','zh-Hans','zh-Hant','ja']).filter(code=>code!=='system')];
  const doc=root.ownerDocument||globalThis.document;
  if(!doc?.createElement)return null;
  const group=doc.createElement('fieldset');
  group.className='ui-locale-choices';
  const legend=doc.createElement('legend');
  legend.className='sr-only';
  legend.dataset.ui='ui.language.label';
  group.append(legend);
  const radios=[];
  for(const code of list){
    const choice=doc.createElement('label');
    choice.className='ui-locale-choice';
    const input=doc.createElement('input');
    input.type='radio';input.name='ui-locale-choice';input.value=code;
    const name=doc.createElement('span');
    name.dataset.ui='ui.language.option.'+code;
    choice.append(input,name);
    input.addEventListener('change',()=>{
      if(!input.checked)return;
      const state=getState()||{};
      if(pendingLocale(state)===code){render();return;}
      setLocale(code);
    });
    radios.push({code,input,name});
    group.append(choice);
  }
  const current=doc.createElement('p');
  current.className='ui-locale-current';current.setAttribute('role','status');
  const notice=doc.createElement('p');
  notice.className='ui-locale-notice';notice.setAttribute('role','status');
  const retryButton=doc.createElement('button');
  retryButton.type='button';retryButton.className='text-link ui-locale-retry';
  retryButton.dataset.ui='ui.locale.retry';
  const reloadButton=doc.createElement('button');
  reloadButton.type='button';reloadButton.className='text-link ui-locale-reload';
  reloadButton.dataset.ui='ui.locale.reload';
  retryButton.addEventListener('click',()=>{typeof retry==='function'&&retry();});
  reloadButton.addEventListener('click',()=>{globalThis.location?.reload?.();});
  root.append(group,current,notice,retryButton,reloadButton);
  const languageName=code=>text('ui.language.option.'+code);
  const render=()=>{
    const state=getState()||{};
    legend.textContent=text('ui.language.label');
    for(const {code,input,name}of radios){
      name.textContent=languageName(code);
      input.checked=code===(state.preference||state.effective);
      input.disabled=pendingLocale(state)===code&&doc.activeElement!==input;
    }
    retryButton.textContent=text('ui.locale.retry');
    reloadButton.textContent=text('ui.locale.reload');
    renderLocaleStatus({state,text,current,notice,retryButton,reloadButton});
  };
  render();
  const unsubscribe=typeof subscribeState==='function'?subscribeState(render):()=>{};
  return {render,unmount(){unsubscribe();root.replaceChildren();}};
}

// The reader's existing Aa enhancement may fail or arrive while a native
// chooser has focus. This real select stays authoritative in either case.
// Only an explicit Aa drawer open can load its existing choice enhancement.
export function mountNativeUiLocaleControl({root,getState,setLocale,retry,subscribeState=()=>()=>{},labels={},onState=()=>{}}={}){
 const select=root?.querySelector('select');
 if(!select||typeof getState!=='function'||typeof setLocale!=='function')return null;
 const text=typeof labels==='function'?labels:id=>labels?.[id]||id;
 const current=root.querySelector('.ui-locale-current'),notice=root.querySelector('.ui-locale-notice'),retryButton=root.querySelector('.ui-locale-retry'),reloadButton=root.querySelector('.ui-locale-reload');
 let disposed=false;
 const render=(notify=true)=>{
  if(disposed)return;
  const state=getState()||{};
  // Disabling the focused enhanced button makes the browser blur it; the
  // choice controller would then restore focus to a different enabled chip.
  const active=root.ownerDocument?.activeElement;
  const focusedValue=root.contains?.(active)?active?.dataset?.value:null;
  for(const option of select.options){option.textContent=text('ui.language.option.'+option.value);option.disabled=pendingLocale(state)===option.value&&focusedValue!==option.value;}
  const value=state.preference||'system';if(select.value!==value)select.value=value;
  retryButton.textContent=text('ui.locale.retry');reloadButton.textContent=text('ui.locale.reload');
  renderLocaleStatus({state,text,current,notice,retryButton,reloadButton});
  if(notify)onState();
 };
 // The singleton binds and deduplicates pending picker intents.
 const choose=()=>{if(pendingLocale(getState()||{})===select.value)return render();Promise.resolve(setLocale(select.value)).catch(()=>{});};
 const again=()=>Promise.resolve(retry?.()).catch(()=>{});
 const reload=()=>globalThis.location?.reload?.();
 select.addEventListener('change',choose);retryButton.addEventListener('click',again);reloadButton.addEventListener('click',reload);
 render(false);const off=subscribeState(()=>render());
 return {render,unmount(){if(disposed)return;disposed=true;off();select.removeEventListener('change',choose);retryButton.removeEventListener('click',again);reloadButton.removeEventListener('click',reload);}};
}
