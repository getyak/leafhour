// Account-wide reading defaults: one compact settings form and one quiet, skippable
// first-reading invitation. Both save the same strict full v1 snapshot through the
// account API's revision CAS; guests never write and per-book choices are untouched.
import {normalizeGlobalPreferences,globalPreferencesDefaults} from './reading-preferences.mjs';

const node=(tag,className,text)=>{const element=document.createElement(tag);if(className)element.className=className;if(text!==undefined)element.textContent=text;return element;};
const option=(select,value,label)=>{const element=node('option');element.value=value;element.textContent=label;select.append(element);};
// The compact form shows only basic fields; every other appearance field is
// retained by merging onto the full current snapshot before saving.
const newBookDefaults={...globalPreferencesDefaults,mode:'parallel'};

export function mountReadingPreferencesForm({root,api,getSession,onSaved=()=>{}}){
  const form=node('form','reading-preferences-form');
  const viewLabel=node('label','profile-field-label','新书的阅读方式');viewLabel.htmlFor='habits-view';
  const view=node('select','profile-input');view.id='habits-view';option(view,'en','原文');option(view,'zh','译文');option(view,'parallel','对照（原文与译文）');
  const languageLabel=node('label','profile-field-label','深读优先语言');languageLabel.htmlFor='habits-language';
  const language=node('select','profile-input');language.id='habits-language';option(language,'source','原文');option(language,'zh','中文');
  const fontLabel=node('label','profile-field-label');fontLabel.htmlFor='habits-font';const fontName=node('span','','新书字号'),fontValue=node('output','','22');fontLabel.append(fontName,fontValue);
  const font=node('input','profile-input');font.id='habits-font';font.type='range';font.min='18';font.max='28';font.step='1';font.value='22';
  const themeLabel=node('label','profile-field-label','新书纸面');themeLabel.htmlFor='habits-theme';
  const theme=node('select','profile-input');theme.id='habits-theme';for(const [value,label]of [['system','跟随系统'],['paper','纸白'],['warm','暖纸'],['mist','雾灰'],['leaf','浅绿'],['night','夜读']])option(theme,value,label);
  const familyLabel=node('label','profile-field-label','新书正文字体');familyLabel.htmlFor='habits-family';
  const family=node('select','profile-input');family.id='habits-family';option(family,'song','宋体');option(family,'kai','楷体');option(family,'sans','无衬线');
  const help=node('p','settings-description','译文目前提供简体中文；只含原文的书仍显示原文，不会自动生成译文。显示译文不代表已经人工校对。精细排版（行距、留白、对照风格等）仍在书页的“阅读设置”里调整，并随这次保存一并保留。');
  const save=node('button','primary profile-save','保存阅读习惯');save.id='habits-save';save.type='submit';
  const recover=node('button','text-link habits-recover','读取最新版本');recover.id='habits-recover';recover.type='button';recover.hidden=true;
  const status=node('p','settings-status profile-status');status.id='habits-status';status.setAttribute('role','status');status.setAttribute('aria-live','polite');
  form.append(viewLabel,view,languageLabel,language,fontLabel,font,themeLabel,theme,familyLabel,family,help,save,recover,status);root.append(form);
  // Authored state: draft (what the form shows), dirty (explicit visible edits),
  // baseline/revision (last authoritative server snapshot for this owner). The
  // portal mutates one session object in place, so authoritative updates are
  // tracked by snapshot revision, never by enclosing session identity.
  let owner=null,revision=0,baseline={...newBookDefaults},draft={...newBookDefaults},dirty=new Set(),busy=false,busyToken=0,generation=0;
  const message=(text,error=false)=>{status.textContent=text;status.classList.toggle('error',error);status.setAttribute('role',error?'alert':'status');};
  const fields=()=>[view,language,font,theme,family];
  function paint(){view.value=draft.mode;language.value=draft.preferredLanguage;font.value=String(draft.font);theme.value=draft.theme;family.value=draft.fontFamily;fontValue.textContent=String(draft.font);}
  function controls(){const user=getSession()?.user;const blocked=busy||!user;for(const field of fields())field.disabled=blocked;save.disabled=blocked||typeof api!=='function';save.textContent=busy?'正在保存…':'保存阅读习惯';recover.disabled=blocked;form.setAttribute('aria-busy',String(busy));}
  const edited=()=>Object.fromEntries([...dirty].map(key=>[key,draft[key]]));
  // Adopt an authoritative snapshot: keep the explicitly edited visible fields,
  // take untouched and hidden fields (and the revision) from the server. Edited
  // choices stay unconfirmed until the user saves them again manually. Session
  // views are only adopted forward; an explicit "读取最新版本" result is forced.
  function adopt(view,{reset=false,force=false}={}){
    const incoming=Number.isSafeInteger(view?.revision)&&view.revision>=0?view.revision:0;
    if(!reset&&!force&&(incoming<=revision))return; // a stale view never regresses an adopted newer result
    const next=view?.preferences?normalizeGlobalPreferences(view.preferences):{...newBookDefaults};
    revision=incoming;baseline=next;draft=dirty.size?normalizeGlobalPreferences({...next,...edited()}):{...next};
  }
  function update(){
    const session=getSession(),user=session?.user,view=session?.readingPreferences||{revision:0,preferences:null};
    if(!user){
      if(owner!==null){owner=null;revision=0;busy=false;busyToken=0;generation++;message('');recover.hidden=true;}
      // signOut can retain the old session envelope. Guests never adopt its
      // account snapshot, including on a later anonymous session refresh.
      dirty=new Set();adopt(null,{reset:true});
      paint();controls();return;
    }
    if(user.id!==owner){
      // A different account starts clean: pending work for the old account is
      // released and can never adopt into this one.
      owner=user.id;dirty=new Set();busy=false;busyToken=0;generation++;recover.hidden=true;
      adopt(view,{reset:true});message('');
    }else if(!busy){
      // Same owner: adopt newer authoritative snapshots without losing edits.
      adopt(view);
    }
    paint();controls();
  }
  for(const [field,key]of [[view,'mode'],[language,'preferredLanguage'],[theme,'theme'],[family,'fontFamily']])field.addEventListener('change',()=>{dirty.add(key);draft=normalizeGlobalPreferences({...draft,[key]:field.value});paint();});
  font.addEventListener('input',()=>{dirty.add('font');draft=normalizeGlobalPreferences({...draft,font:Number(font.value)});paint();});
  // Only the operation that currently owns busy may release it; a superseded
  // completion may refresh presentation but never frees another operation.
  const release=token=>{if(busyToken===token){busy=false;busyToken=0;}};
  form.addEventListener('submit',async event=>{
    event.preventDefault();const session=getSession(),user=session?.user;if(!user||busy)return;
    const expectedOwner=owner,token=++generation,snapshot=normalizeGlobalPreferences({...draft,onboarding:'completed'}),baseRevision=revision;
    busy=true;busyToken=token;controls();message('');recover.hidden=true;
    try{
      const saved=await api('/api/account/reading-preferences',{baseRevision,preferences:snapshot});
      if(generation!==token||getSession()?.user?.id!==expectedOwner)return; // a late save never adopts into another account
      revision=saved.revision;baseline=normalizeGlobalPreferences(saved.preferences);draft={...baseline};dirty=new Set();paint();
      message('阅读习惯已保存，之后打开的新书从这里开始。');onSaved(saved);
    }catch(error){
      if(generation!==token||getSession()?.user?.id!==expectedOwner)return;
      if(error?.status===409){recover.hidden=false;message('阅读习惯已在另一处更新。你改过的选择仍保留在这里；点“读取最新版本”核对后，再手动保存一次确认。',true);}
      else message('阅读习惯暂未保存。'+(error?.message||'服务暂时无法连接，请稍后重试'),true);
    }finally{
      release(token);update(); // presentation refresh; adopts only newer authoritative views
    }
  });
  // Conflict recovery is read-only and explicit: it never resubmits a write.
  recover.addEventListener('click',async()=>{
    const session=getSession(),user=session?.user;if(!user||busy)return;
    const expectedOwner=owner,token=++generation;
    busy=true;busyToken=token;controls();message('');
    try{
      const latest=await api('/api/account/reading-preferences');
      if(generation!==token||getSession()?.user?.id!==expectedOwner)return;
      adopt(latest,{force:true});paint();recover.hidden=true;message('已读取最新版本。你改过的选择仍保留在这里，请再手动保存一次确认。');
    }catch(error){
      if(generation!==token||getSession()?.user?.id!==expectedOwner)return;
      message('最新版本暂时无法读取，你的选择仍保留在这里。'+(error?.message||'服务暂时无法连接，请稍后重试'),true);
    }finally{
      release(token);update();
    }
  });
  update();
  return {update};
}

export function mountReadingSetupInvite({root,api,getSession,onSaved=()=>{},openSettings=()=>{},onError=()=>{}}){
  const open=root.querySelector?root.querySelector('#reading-setup-open'):null,skip=root.querySelector?root.querySelector('#reading-setup-skip'):null,status=root.querySelector?root.querySelector('#reading-setup-status'):null;
  if(!open||!skip)return {update(){}}; // static markup missing: never block the library
  const message=(text,error=false)=>{if(!status)return;status.textContent=text;status.classList.toggle('error',error);status.setAttribute('role',error?'alert':'status');if(error)onError(text);};
  let busy=false,busyToken=0,owner=null,generation=0;
  const dismissible=()=>{const prefs=getSession()?.readingPreferences;return !!(prefs?.preferences&&['completed','dismissed'].includes(prefs.preferences.onboarding));};
  function update(){
    const user=getSession()?.user;
    if((user?.id??null)!==owner){owner=user?.id??null;busy=false;busyToken=0;generation++;} // pending work for another account is released
    root.hidden=Boolean(!user||dismissible());open.disabled=busy||!user;skip.disabled=busy||!user;
  }
  open.addEventListener('click',()=>{openSettings('reading-habits');});
  skip.addEventListener('click',async()=>{
    const session=getSession(),user=session?.user;if(!user||busy)return;
    const expectedOwner=owner,token=++generation,baseRevision=session?.readingPreferences?.revision||0,snapshot=normalizeGlobalPreferences({...(session?.readingPreferences?.preferences||{}),onboarding:'dismissed'});
    busy=true;busyToken=token;update();message('');
    try{
      const saved=await api('/api/account/reading-preferences',{baseRevision,preferences:snapshot});
      if(generation!==token||getSession()?.user?.id!==expectedOwner)return;
      onSaved(saved);message('已记录“暂不设置”，随时可以在设置里打开“阅读习惯”。');
    }catch(error){
      if(generation!==token||getSession()?.user?.id!==expectedOwner)return;
      message('暂不设置尚未记录。'+(error?.status===409?'阅读习惯已在另一处更新，请刷新后再试。':error?.message||'服务暂时无法连接，请稍后重试'),true);
    }finally{if(busyToken===token){busy=false;busyToken=0;}update();}
  });
  update();
  return {update};
}
