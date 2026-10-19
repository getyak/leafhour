import {t,onUiLocaleChange,uiReady,createUiLabels,createUiMessage} from './ui-locale.mjs';
// Account-wide reading defaults: one compact settings form and one quiet, skippable
// first-reading invitation. Both save the same strict full v1 snapshot through the
// account API's revision CAS; guests never write and per-book choices are untouched.
import {normalizeGlobalPreferences,globalPreferencesDefaults} from './reading-preferences.mjs';

const node=(tag,className,text)=>{const element=document.createElement(tag);if(className)element.className=className;if(text!==undefined)element.textContent=text;return element;};
// The compact form shows only basic fields; every other appearance field is
// retained by merging onto the full current snapshot before saving.
const newBookDefaults={...globalPreferencesDefaults,mode:'parallel'};

export function mountReadingPreferencesForm({root,api,getSession,onSaved=()=>{}}){
  const L=createUiLabels();
  const option=(select,value,id)=>{const element=L.text(node('option'),id);element.value=value;select.append(element);};
  const form=node('form','reading-preferences-form');
  const viewLabel=L.text(node('label','profile-field-label'),'prefs.newBook');viewLabel.htmlFor='habits-view';
  const view=node('select','profile-input');view.id='habits-view';option(view,'en','prefs.mode.original');option(view,'zh','prefs.mode.translation');option(view,'parallel','prefs.mode.parallel');
  const languageLabel=L.text(node('label','profile-field-label'),'prefs.target');languageLabel.htmlFor='habits-language';
  const language=node('select','profile-input');language.id='habits-language';option(language,'source','prefs.mode.original');option(language,'zh','prefs.target.zh');
  const fontLabel=node('label','profile-field-label');fontLabel.htmlFor='habits-font';const fontName=L.text(node('span',''),'prefs.font'),fontValue=node('output','','22');fontLabel.append(fontName,fontValue);
  const font=node('input','profile-input');font.id='habits-font';font.type='range';font.min='18';font.max='28';font.step='1';font.value='22';
  const themeLabel=L.text(node('label','profile-field-label'),'prefs.paper');themeLabel.htmlFor='habits-theme';
  const theme=node('select','profile-input');theme.id='habits-theme';for(const [value,label]of [['system','prefs.paper.system'],['paper','prefs.paper.paper'],['warm','prefs.paper.warm'],['mist','prefs.paper.mist'],['leaf','prefs.paper.sage'],['night','prefs.paper.night']])option(theme,value,label);
  const familyLabel=L.text(node('label','profile-field-label'),'prefs.typeface');familyLabel.htmlFor='habits-family';
  const family=node('select','profile-input');family.id='habits-family';option(family,'song','prefs.typeface.song');option(family,'kai','prefs.typeface.kai');option(family,'sans','prefs.typeface.sans');
  const help=L.text(node('p','settings-description'),'prefs.help');
  const save=node('button','primary profile-save');save.id='habits-save';save.type='submit';
  const recover=L.text(node('button','text-link habits-recover'),'prefs.reload');recover.id='habits-recover';recover.type='button';recover.hidden=true;
  const status=node('p','settings-status profile-status');status.id='habits-status';status.setAttribute('role','status');status.setAttribute('aria-live','polite');
  form.append(viewLabel,view,languageLabel,language,fontLabel,font,themeLabel,theme,familyLabel,family,help,save,recover,status);root.append(form);
  // Authored state: draft (what the form shows), dirty (explicit visible edits),
  // baseline/revision (last authoritative server snapshot for this owner). The
  // portal mutates one session object in place, so authoritative updates are
  // tracked by snapshot revision, never by enclosing session identity.
  let owner=null,revision=0,baseline={...newBookDefaults},draft={...newBookDefaults},dirty=new Set(),busy=false,busyToken=0,generation=0,disposed=false;
  const message=createUiMessage((text,error)=>{status.textContent=text;status.classList.toggle('error',!!error);status.setAttribute('role',error?'alert':'status');});
  const fields=()=>[view,language,font,theme,family];
  function paint(){view.value=draft.mode;language.value=draft.preferredLanguage;font.value=String(draft.font);theme.value=draft.theme;family.value=draft.fontFamily;fontValue.textContent=String(draft.font);}
  function controls(){const user=getSession()?.user;const blocked=busy||!user;for(const field of fields())field.disabled=blocked;save.disabled=blocked||typeof api!=='function';save.textContent=busy?t('prefs.saving'):t('prefs.save');recover.disabled=blocked;form.setAttribute('aria-busy',String(busy));}
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
    if(disposed)return;
    const session=getSession(),user=session?.user,view=session?.readingPreferences||{revision:0,preferences:null};
    if(!user){
      if(owner!==null){owner=null;revision=0;busy=false;busyToken=0;generation++;message.clear();recover.hidden=true;}
      // signOut can retain the old session envelope. Guests never adopt its
      // account snapshot, including on a later anonymous session refresh.
      dirty=new Set();adopt(null,{reset:true});
      paint();controls();return;
    }
    if(user.id!==owner){
      // A different account starts clean: pending work for the old account is
      // released and can never adopt into this one.
      owner=user.id;dirty=new Set();busy=false;busyToken=0;generation++;recover.hidden=true;
      adopt(view,{reset:true});message.clear();
    }else if(!busy){
      // Same owner: adopt newer authoritative snapshots without losing edits.
      adopt(view);
    }
    paint();controls();
  }
  for(const [field,key]of [[view,'mode'],[language,'preferredLanguage'],[theme,'theme'],[family,'fontFamily']])field.addEventListener('change',()=>{if(disposed)return;dirty.add(key);draft=normalizeGlobalPreferences({...draft,[key]:field.value});paint();});
  font.addEventListener('input',()=>{if(disposed)return;dirty.add('font');draft=normalizeGlobalPreferences({...draft,font:Number(font.value)});paint();});
  // Only the operation that currently owns busy may release it; a superseded
  // completion may refresh presentation but never frees another operation.
  const release=token=>{if(busyToken===token){busy=false;busyToken=0;}};
  form.addEventListener('submit',async event=>{
    event.preventDefault();const session=getSession(),user=session?.user;if(disposed||!user||busy)return;
    const expectedOwner=owner,token=++generation,snapshot=normalizeGlobalPreferences({...draft,onboarding:'completed'}),baseRevision=revision;
    busy=true;busyToken=token;controls();message.clear();recover.hidden=true;
    try{
      const saved=await api('/api/account/reading-preferences',{baseRevision,preferences:snapshot});
      if(disposed||generation!==token||getSession()?.user?.id!==expectedOwner)return; // a late save never adopts into another account
      revision=saved.revision;baseline=normalizeGlobalPreferences(saved.preferences);draft={...baseline};dirty=new Set();paint();
      message.set('prefs.saved');onSaved(saved);
    }catch(error){
      if(disposed||generation!==token||getSession()?.user?.id!==expectedOwner)return;
      if(error?.status===409){recover.hidden=false;message.set('prefs.conflict',null,true);}
      else message.set(error?.messageId||'prefs.saveFailed',null,true);
    }finally{
      release(token);update(); // presentation refresh; adopts only newer authoritative views
    }
  });
  // Conflict recovery is read-only and explicit: it never resubmits a write.
  recover.addEventListener('click',async()=>{
    const session=getSession(),user=session?.user;if(disposed||!user||busy)return;
    const expectedOwner=owner,token=++generation;
    busy=true;busyToken=token;controls();message.clear();
    try{
      const latest=await api('/api/account/reading-preferences');
      if(disposed||generation!==token||getSession()?.user?.id!==expectedOwner)return;
      adopt(latest,{force:true});paint();recover.hidden=true;message.set('prefs.reloaded');
    }catch(error){
      if(disposed||generation!==token||getSession()?.user?.id!==expectedOwner)return;
      message.set(error?.messageId||'prefs.reloadFailed',null,true);
    }finally{
      release(token);update();
    }
  });
  update();
  function updateLabels(){if(disposed)return;L.refresh();save.textContent=busy?t('prefs.saving'):t('prefs.save');message.refresh();}
  const offLocale=onUiLocaleChange(updateLabels);void uiReady.then(updateLabels);
  return {update,updateLabels,dispose(){if(disposed)return;disposed=true;generation++;offLocale();L.clear();}};
}

export function mountReadingSetupInvite({root,api,getSession,onSaved=()=>{},openSettings=()=>{},onError=()=>{}}){
  const open=root.querySelector?root.querySelector('#reading-setup-open'):null,skip=root.querySelector?root.querySelector('#reading-setup-skip'):null,status=root.querySelector?root.querySelector('#reading-setup-status'):null;
  if(!open||!skip)return {update(){},updateLabels(){},dispose(){}}; // static markup missing: never block the library
  const labels=createUiLabels();labels.attr(root,'aria-label','shell.settings.tab.reading-habits');
  const heading=root.querySelector('h2'),description=root.querySelector('p:not([id])');
  if(heading)labels.text(heading,'prefs.setup.open');if(description)labels.text(description,'prefs.setup.description');
  labels.text(open,'prefs.setup.open');labels.text(skip,'prefs.setup.skip');
  const message=createUiMessage((text,error)=>{if(!status)return;status.textContent=text;status.classList.toggle('error',!!error);status.setAttribute('role',error?'alert':'status');});
  let busy=false,busyToken=0,owner=null,generation=0,disposed=false;
  const dismissible=()=>{const prefs=getSession()?.readingPreferences;return !!(prefs?.preferences&&['completed','dismissed'].includes(prefs.preferences.onboarding));};
  function update(){
    if(disposed)return;
    const user=getSession()?.user;
    if((user?.id??null)!==owner){owner=user?.id??null;busy=false;busyToken=0;generation++;message.clear();} // pending work for another account is released
    root.hidden=Boolean(!user||dismissible());open.disabled=busy||!user;skip.disabled=busy||!user;
  }
  open.addEventListener('click',()=>{if(!disposed)openSettings('reading-habits');});
  skip.addEventListener('click',async()=>{
    const session=getSession(),user=session?.user;if(disposed||!user||busy)return;
    const expectedOwner=owner,token=++generation,baseRevision=session?.readingPreferences?.revision||0,snapshot=normalizeGlobalPreferences({...(session?.readingPreferences?.preferences||{}),onboarding:'dismissed'});
    busy=true;busyToken=token;update();message.clear();
    try{
      const saved=await api('/api/account/reading-preferences',{baseRevision,preferences:snapshot});
      if(disposed||generation!==token||getSession()?.user?.id!==expectedOwner)return;
      onSaved(saved);message.set('prefs.skipRecorded');
    }catch(error){
      if(disposed||generation!==token||getSession()?.user?.id!==expectedOwner)return;
      const id=error?.status===409?'prefs.conflictReload':error?.messageId||'prefs.skipFailed';
      message.set(id,null,true);onError(t(id));
    }finally{if(busyToken===token){busy=false;busyToken=0;}update();}
  });
  update();
  function updateLabels(){if(disposed)return;labels.refresh();message.refresh();}
  const offLocale=onUiLocaleChange(updateLabels);void uiReady.then(updateLabels);updateLabels();
  return {update,updateLabels,dispose(){if(disposed)return;disposed=true;generation++;offLocale();labels.clear();}};
}
