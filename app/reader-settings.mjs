// Each panel answers a different reading decision; hidden preferences retain their values.
import {globalPreferencesDefaults,normalizeGlobalPreferences} from './reading-preferences.mjs';
export function mountReaderSettings({document}){
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
  return {update({mode}){
    const translated=mode==='zh'||mode==='parallel';
    document.getElementById('translation-settings').hidden=!translated;
    document.getElementById('translation-details').hidden=!translated;
    document.getElementById('parallel-settings').hidden=mode!=='parallel';
  }};
}

// Explicit "设为新书默认": saves the current normalized view to the account
// snapshot through strict CAS. It never touches this book's chapter, anchor or
// records, and a failed or 409 save keeps the visible values with an honest error.
export function mountReadingDefaults({document,api,getState,getSession,onSaved=()=>{},onAnnounce=()=>{}}){
  const button=document.getElementById('save-reading-defaults'),status=document.getElementById('reading-defaults-status'),section=document.getElementById('reading-defaults-setting');
  if(!button||!status)return {update(){}};
  let busy=false;
  const message=(text,error=false)=>{status.textContent=text;status.classList.toggle('error',error);status.setAttribute('role',error?'alert':'status');if(error)onAnnounce(text);};
  const update=()=>{const user=getSession()?.user;if(section)section.hidden=!user;button.disabled=busy||!user;};
  button.addEventListener('click',async()=>{
    const session=getSession(),user=session?.user;if(!user||busy)return;
    const owner=user.id,baseRevision=session?.readingPreferences?.revision||0,onboarding=session?.readingPreferences?.preferences?.onboarding||globalPreferencesDefaults.onboarding;
    let snapshot;try{snapshot=normalizeGlobalPreferences({...getState(),onboarding});}catch{message('当前阅读方式无法保存，请重新调整后再试。',true);return;}
    busy=true;update();button.textContent='正在保存…';message('');
    try{
      const saved=await api('/api/account/reading-preferences',{baseRevision,preferences:snapshot});
      if(getSession()?.user?.id!==owner)return;
      onSaved(saved);message('已设为新书默认。当前书的章节位置与记录保持不变。');
    }catch(error){
      if(getSession()?.user?.id!==owner)return;
      message('新书默认暂未保存。'+(error?.message||'服务暂时无法连接，请稍后重试'),true);
    }finally{busy=false;update();button.textContent='设为新书默认';}
  });
  update();
  return {update};
}
