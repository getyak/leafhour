// Each panel answers a different reading decision; hidden preferences retain their values.
import {globalPreferencesDefaults,normalizeGlobalPreferences} from './reading-preferences.mjs';
import {t,onUiLocaleChange} from './ui-locale.mjs';

// The Aa choices load only on an explicit drawer open. Native selects remain
// usable until that module mounts, including a network/module failure.
export function mountReaderSettings({document,loadChoices=()=>import('./reader-settings-choices.mjs')}){
  const tabs=[...document.querySelectorAll('[data-settings-tab]')],content=document.getElementById('settings-content');
  function activate(index,{focus=false}={}){
    tabs.forEach((tab,i)=>{const selected=i===index;tab.setAttribute('aria-selected',String(selected));tab.tabIndex=selected?0:-1;document.getElementById('settings-'+tab.dataset.settingsTab).hidden=!selected;});
    content.scrollTop=0;if(focus)tabs[index].focus({preventScroll:true});
  }
  tabs.forEach((tab,index)=>{
    tab.addEventListener('click',()=>activate(index));
    tab.addEventListener('keydown',event=>{
      const next=event.key==='ArrowRight'?(index+1)%tabs.length:event.key==='ArrowLeft'?(index+tabs.length-1)%tabs.length:event.key==='Home'?0:event.key==='End'?tabs.length-1:null;
      if(next===null)return;event.preventDefault();activate(next,{focus:true});
    });
  });
  activate(0);
  const choices={};let pending,syncChoices=()=>{},disposeChoices=()=>{},disposed=false;
  const sync=()=>syncChoices();
  const enhance=()=>pending??=(loadChoices().then(module=>{
    if(disposed)return false;
    const enhanced=module.mountReaderSettingsChoices({document,choices});
    Object.assign(choices,enhanced.choices);syncChoices=enhanced.sync;disposeChoices=()=>enhanced.unmount?.();sync();
    return Object.keys(choices).length>0;
  }).catch(()=>false));
  return {choices,sync,enhance,unmount(){disposed=true;disposeChoices();syncChoices=()=>{};},update({mode}){
    if(disposed)return;
    const translated=mode==='zh'||mode==='parallel';
    document.getElementById('translation-settings').hidden=!translated;
    document.getElementById('translation-details').hidden=!translated;
    document.getElementById('parallel-settings').hidden=mode!=='parallel';
    sync();
  }};
}

// Explicit "设为新书默认": saves the current normalized view to the account
// snapshot through strict CAS. It never touches this book's chapter, anchor or
// records, and a failed or 409 save keeps the visible values with an honest error.
export function mountReadingDefaults({document,api,getState,getSession,onSaved=()=>{},onAnnounce=()=>{}}){
  const button=document.getElementById('save-reading-defaults'),status=document.getElementById('reading-defaults-status'),section=document.getElementById('reading-defaults-setting');
  if(!button||!status)return {update(){},unmount(){}};
  let owner=null,epoch=0,pending=null,notice=null,disposed=false;
  const updateLabels=()=>{
    if(disposed)return;
    button.textContent=t(pending?'reader.defaults.saving':'reader.defaults.save');
    status.textContent=notice?t(notice):'';
  };
  const offLocale=onUiLocaleChange(updateLabels);
  const message=(id,error=false)=>{notice=id;updateLabels();status.classList.toggle('error',error);status.setAttribute('role',error?'alert':'status');if(error)onAnnounce(t(id));};
  const update=()=>{
    if(disposed)return;
    const user=getSession()?.user||null;
    if(user!==owner){owner=user;epoch++;pending=null;notice=null;status.classList.toggle('error',false);status.setAttribute('role','status');}
    if(section)section.hidden=!user;button.disabled=!!pending||!user;updateLabels();
  };
  const current=(ticket,user,stamp)=>!disposed&&pending===ticket&&epoch===stamp&&getSession()?.user===user;
  async function save(){
    if(disposed)return;update();
    const session=getSession(),user=session?.user;if(!user||pending)return;
    const baseRevision=session?.readingPreferences?.revision||0,onboarding=session?.readingPreferences?.preferences?.onboarding||globalPreferencesDefaults.onboarding;
    let snapshot;try{snapshot=normalizeGlobalPreferences({...getState(),onboarding});}catch{message('reader.defaults.invalid',true);return;}
    const ticket=Symbol(),stamp=epoch;pending=ticket;update();message(null);
    try{
      const saved=await api('/api/account/reading-preferences',{baseRevision,preferences:snapshot});
      if(!current(ticket,user,stamp))return;
      onSaved(saved);message('reader.defaults.saved');
    }catch(error){
      if(!current(ticket,user,stamp))return;
      message(error?.status===409?'reader.defaults.conflict':'reader.defaults.failed',true);
    }finally{if(!disposed&&pending===ticket){pending=null;update();}}
  }
  button.addEventListener('click',save);update();
  return {update,unmount(){if(disposed)return;disposed=true;epoch++;pending=null;offLocale();button.removeEventListener('click',save);}};
}
