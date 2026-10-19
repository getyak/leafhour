// Both the generated radio view and the native Aa fallback use this exact
// status presentation. The four-code runtime remains the state authority.
function renderLocaleStatus({state,text,current,notice,retryButton,reloadButton}){
 const languageName=code=>text('ui.language.option.'+code);
    current.textContent=text('ui.language.current').replace(/\{language\}/g,languageName(state.effective||'en'));
    if(state.phase==='pending'){
      notice.hidden=false;
      notice.textContent=text('ui.locale.loading');
      retryButton.hidden=true;reloadButton.hidden=true;
    }else if(state.phase==='error'){
      notice.hidden=false;
      const target=languageName(state.retryTarget||state.requested||'en');
      const effective=languageName(state.effective||'en');
      if(state.fallbackReason==='history')notice.textContent=text('ui.locale.historyError');
      else if(state.initialFallback)notice.textContent=text('ui.locale.fallback.notice').replace(/\{language\}/g,target);
      else notice.textContent=text('ui.locale.loadFailed').replace(/\{language\}/g,target).replace(/\{effective\}/g,effective);
      retryButton.hidden=!!state.offerReload;
      reloadButton.hidden=!state.offerReload;
    }else if(state.persistence==='session-only'){
      notice.hidden=false;notice.textContent=text('ui.locale.sessionOnly');
      retryButton.hidden=true;reloadButton.hidden=true;
    }else{
      notice.hidden=true;retryButton.hidden=true;reloadButton.hidden=true;
    }
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
  const list=Array.isArray(options)&&options.length?options:['en','zh-Hans','zh-Hant','ja'];
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
      if(state.phase==='pending'&&state.requested===code){render();return;}
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
      input.checked=code===state.effective;
      input.disabled=state.phase==='pending'&&state.requested===code&&doc.activeElement!==input;
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
  for(const option of select.options){option.textContent=text('ui.language.option.'+option.value);option.disabled=state.phase==='pending'&&state.requested===option.value&&focusedValue!==option.value;}
  const value=state.effective||'en';if(select.value!==value)select.value=value;
  retryButton.textContent=text('ui.locale.retry');reloadButton.textContent=text('ui.locale.reload');
  renderLocaleStatus({state,text,current,notice,retryButton,reloadButton});
  if(notify)onState();
 };
 const choose=()=>{const code=select.value,state=getState()||{};if(state.phase==='pending'&&state.requested===code){render();return;}Promise.resolve(setLocale(code)).catch(()=>{});};
 const again=()=>{if(typeof retry==='function')Promise.resolve(retry()).catch(()=>{});};
 const reload=()=>globalThis.location?.reload?.();
 select.addEventListener('change',choose);retryButton.addEventListener('click',again);reloadButton.addEventListener('click',reload);
 render(false);const off=subscribeState(()=>render());
 return {render,unmount(){if(disposed)return;disposed=true;off();select.removeEventListener('change',choose);retryButton.removeEventListener('click',again);reloadButton.removeEventListener('click',reload);}};
}
