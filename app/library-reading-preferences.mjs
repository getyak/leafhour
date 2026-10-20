import {t,onUiLocaleChange,uiReady,createUiLabels,createUiMessage} from './ui-locale.mjs';
// Account-wide reading defaults: one compact settings form and one quiet, skippable
// first-reading invitation. Both save the same strict full v1 snapshot through the
// account API's revision CAS; guests never write and per-book choices are untouched.
import {normalizeGlobalPreferences,globalPreferencesDefaults} from './reading-preferences.mjs';
import {mountChoiceControl} from './choice-control.mjs';
import {settingGroup,settingRow} from './settings-controls.mjs';

const node=(tag,className,text)=>{const element=document.createElement(tag);if(className)element.className=className;if(text!==undefined)element.textContent=text;return element;};
// The compact form shows only basic fields; every other appearance field is
// retained by merging onto the full current snapshot before saving.
const newBookDefaults={...globalPreferencesDefaults,mode:'parallel'};

// GET-201 meaningful autosave. Only explicit visible edits (a real change or
// input event on one of the five controls) schedule a write; hydration, label
// refreshes, session adoption and programmatic updates never save, reset or
// move focus. A burst of deliberate input coalesces into one full snapshot
// write, a newer edit during a pending write queues exactly one serialized
// follow-up, an owner change cancels the pending dispatch and drops late
// results, and a failure or CAS conflict keeps the draft and stops: retrying
// is always one explicit action (the save/retry control or the form submit).
export function mountReadingPreferencesForm({root,api,getSession,onSaved=()=>{},timers=globalThis,debounceMs=400}){
  const L=createUiLabels();
  const option=(select,value,id)=>{const element=L.text(node('option'),id);element.value=value;select.append(element);};
  const form=node('form','reading-preferences-form');
  const group=titleId=>{
    const section=settingGroup({document,title:''});
    L.text(section.title,titleId);
    section.description.hidden=true;
    return section;
  };
  const row=({labelId,control,labelFor,descriptionId=null})=>{
    const entry=settingRow({document,label:'',description:'',control,labelFor});
    L.text(entry.label,labelId);
    if(descriptionId)L.text(entry.description,descriptionId);else entry.description.hidden=true;
    return entry;
  };
  // New books: how a book opens and which language it aims at.
  const opening=group('prefs.group.opening');
  const view=node('select','profile-input');view.id='habits-view';option(view,'en','prefs.mode.original');option(view,'zh','prefs.mode.translation');option(view,'parallel','prefs.mode.parallel');
  const language=node('select','profile-input');language.id='habits-language';option(language,'source','prefs.mode.original');option(language,'zh','prefs.target.zh');
  opening.body.append(row({labelId:'prefs.newBook',control:view,labelFor:view.id}).root,row({labelId:'prefs.target',control:language,labelFor:language.id}).root);
  // Typography: size with a real preview and output, plus the typeface.
  const typography=group('prefs.group.typography');
  const font=node('input','profile-input');font.id='habits-font';font.type='range';font.min='18';font.max='28';font.step='1';font.value='22';
  const fontValue=node('output','','22');fontValue.id='habits-font-value';
  const fontControl=node('div','settings-slider');fontControl.append(font,fontValue);
  const family=node('select','profile-input');family.id='habits-family';option(family,'song','prefs.typeface.song');option(family,'kai','prefs.typeface.kai');option(family,'sans','prefs.typeface.sans');
  const preview=node('p','settings-preview habits-preview');preview.id='habits-preview';
  typography.body.append(row({labelId:'prefs.font',control:fontControl,labelFor:font.id}).root,row({labelId:'prefs.typeface',control:family,labelFor:family.id}).root);
  // Page tone.
  const page=group('prefs.group.page');
  const theme=node('select','profile-input');theme.id='habits-theme';for(const [value,label]of [['system','prefs.paper.system'],['paper','prefs.paper.paper'],['warm','prefs.paper.warm'],['mist','prefs.paper.mist'],['leaf','prefs.paper.sage'],['night','prefs.paper.night']])option(theme,value,label);
  page.body.append(row({labelId:'prefs.paper',control:theme,labelFor:theme.id}).root);
  const help=L.text(node('p','settings-description'),'prefs.help');
  const guestHint=L.text(node('p','settings-description habits-guest'),'prefs.guest');guestHint.id='habits-guest';
  const save=node('button','primary profile-save');save.id='habits-save';save.type='button';save.hidden=true;
  const recover=L.text(node('button','text-link habits-recover'),'prefs.reload');recover.id='habits-recover';recover.type='button';recover.hidden=true;
  const status=node('p','settings-status profile-status');status.id='habits-status';status.setAttribute('role','status');status.setAttribute('aria-live','polite');
  form.append(opening.root,typography.root,page.root,preview,help,guestHint,save,recover,status);root.append(form);
  // Authored state: draft (what the form shows), dirty (explicit visible edits),
  // baseline/revision (last authoritative server snapshot for this owner). The
  // portal mutates one session object in place, so authoritative updates are
  // tracked by snapshot revision, never by enclosing session identity.
  let owner=null,revision=0,baseline={...newBookDefaults},draft={...newBookDefaults},dirty=new Set(),busy=false,busyToken=0,generation=0,disposed=false;
  // Autosave queue state: one coalescing timer, one queued follow-up marker and
  // one explicit retry surface for a failed or conflicting write.
  let scheduled=null,queued=false,retryNeeded=false;
  const message=createUiMessage((text,error)=>{status.textContent=text;status.classList.toggle('error',!!error);status.setAttribute('role',error?'alert':'status');});
  const fields=()=>[view,language,font,theme,family];
  const saveLabel=()=>busy?t('prefs.saving'):retryNeeded?t('prefs.retry'):t('prefs.save');
  const paintPreview=()=>{
    preview.textContent=t('prefs.preview.sample',{size:draft.font});
    if(preview.style)preview.style.fontSize=draft.font+'px';
    fontValue.textContent=String(draft.font);
  };
  const choices={};
  // Presentation mirrors the native value and disabled state through the
  // explicit sync path after every state change (success, failure, guest and
  // owner change), so custom chrome can never diverge from its backing node.
  const syncChoices=()=>{for(const select of [view,language,theme,family])choices[select.id]?.sync();};
  function paint(){
    view.value=draft.mode;language.value=draft.preferredLanguage;font.value=String(draft.font);theme.value=draft.theme;family.value=draft.fontFamily;
    paintPreview();
    syncChoices();
  }
  function controls(){
    const user=getSession()?.user;const blocked=!user;
    for(const field of fields())field.disabled=blocked;
    save.disabled=blocked||busy||typeof api!=='function';
    save.textContent=saveLabel();
    save.hidden=!retryNeeded;
    recover.disabled=blocked;
    guestHint.hidden=!!user;
    form.setAttribute('aria-busy',String(busy));
    syncChoices();
  }
  const edited=()=>Object.fromEntries([...dirty].map(key=>[key,draft[key]]));
  // Adopt an authoritative snapshot: keep the explicitly edited visible fields,
  // take untouched and hidden fields (and the revision) from the server. Edited
  // choices stay unconfirmed until they are saved. Session views are only
  // adopted forward; an explicit "read the latest" result is forced.
  function adopt(view,{reset=false,force=false}={}){
    const incoming=Number.isSafeInteger(view?.revision)&&view.revision>=0?view.revision:0;
    if(!reset&&!force&&(incoming<=revision))return; // a stale view never regresses an adopted newer result
    const next=view?.preferences?normalizeGlobalPreferences(view.preferences):{...newBookDefaults};
    revision=incoming;baseline=next;draft=dirty.size?normalizeGlobalPreferences({...next,...edited()}):{...next};
  }
  function cancelScheduled(){if(scheduled!==null){timers.clearTimeout(scheduled);scheduled=null;}}
  function scheduleSave(){
    if(disposed)return;
    if(!getSession()?.user){cancelScheduled();queued=false;return;}
    // A failed or conflicting write pauses the queue: new edits stay drafts
    // and only an explicit retry/submit may resume writing.
    if(retryNeeded)return;
    if(busy){queued=true;return;} // one serialized follow-up, never a parallel write
    queued=true;
    cancelScheduled();
    scheduled=timers.setTimeout(()=>{scheduled=null;void flush();},debounceMs);
  }
  function update(){
    if(disposed)return;
    const session=getSession(),user=session?.user,view=session?.readingPreferences||{revision:0,preferences:null};
    if(!user){
      if(owner!==null){owner=null;revision=0;busy=false;busyToken=0;generation++;message.clear();recover.hidden=true;}
      // signOut can retain the old session envelope. Guests never adopt its
      // account snapshot, including on a later anonymous session refresh.
      dirty=new Set();cancelScheduled();queued=false;retryNeeded=false;adopt(null,{reset:true});
      paint();controls();return;
    }
    if(user.id!==owner){
      // A different account starts clean: pending work for the old account is
      // released and can never adopt into this one.
      owner=user.id;dirty=new Set();busy=false;busyToken=0;generation++;recover.hidden=true;
      cancelScheduled();queued=false;retryNeeded=false;
      adopt(view,{reset:true});message.clear();
    }else if(!busy){
      // Same owner: adopt newer authoritative snapshots without losing edits.
      adopt(view);
    }
    paint();controls();
  }
  // Only explicit visible edits schedule the autosave.
  for(const [field,key]of [[view,'mode'],[language,'preferredLanguage'],[theme,'theme'],[family,'fontFamily']])field.addEventListener('change',()=>{if(disposed||!getSession()?.user)return;dirty.add(key);draft=normalizeGlobalPreferences({...draft,[key]:field.value});paint();scheduleSave();});
  font.addEventListener('input',()=>{if(disposed||!getSession()?.user)return;dirty.add('font');draft=normalizeGlobalPreferences({...draft,font:Number(font.value)});paint();scheduleSave();});
  // Only the operation that currently owns busy may release it; a superseded
  // completion may refresh presentation but never frees another operation.
  const release=token=>{if(busyToken===token){busy=false;busyToken=0;}};
  async function flush(){
    const session=getSession(),user=session?.user;
    if(disposed||!user||busy||typeof api!=='function')return;
    // The dispatch itself re-verifies the live session owner. A queued draft
    // from a previous account is never written under the current one, even if
    // the host has not called update() yet.
    if(user.id!==owner){
      update();return;
    }
    cancelScheduled();queued=false;retryNeeded=false;
    const expectedOwner=owner,token=++generation,sent=normalizeGlobalPreferences({...draft,onboarding:'completed'}),baseRevision=revision;
    busy=true;busyToken=token;controls();message.clear();recover.hidden=true;
    let ok=false;
    try{
      const saved=await api('/api/account/reading-preferences',{baseRevision,preferences:sent});
      if(disposed||generation!==token||getSession()?.user?.id!==expectedOwner)return; // a late save never adopts into another account
      revision=saved.revision;baseline=normalizeGlobalPreferences(saved.preferences);
      // Edits made while this write was in flight are newer than its result —
      // including a later value for the same field or a revert — so they stay
      // dirty and become the one serialized follow-up below.
      const late={};
      for(const key of dirty)if(draft[key]!==sent[key])late[key]=draft[key];
      dirty=new Set(Object.keys(late));
      draft=normalizeGlobalPreferences({...baseline,...late});
      paint();
      message.set('prefs.saved');onSaved(saved);ok=true;
    }catch(error){
      if(disposed||generation!==token||getSession()?.user?.id!==expectedOwner)return;
      // Errors and conflicts keep the visible draft and stop: retry is explicit.
      retryNeeded=true;queued=false;
      if(error?.status===409){recover.hidden=false;message.set('prefs.conflict',null,true);}
      else message.set(error?.messageId||'prefs.saveFailed',null,true);
    }finally{
      release(token);update(); // presentation refresh; adopts only newer authoritative views
    }
    if(ok&&queued&&dirty.size&&!disposed)void flush(); // exactly one serialized follow-up
  }
  // Enter and the explicit retry control both mean one deliberate write.
  form.addEventListener('submit',event=>{event.preventDefault();void flush();});
  save.addEventListener('click',()=>void flush());
  // Conflict recovery is read-only and explicit: it never resubmits a write.
  recover.addEventListener('click',async()=>{
    const session=getSession(),user=session?.user;if(disposed||!user||busy)return;
    // The read is explicit and read-only; it also re-checks the live owner so a
    // stale account can never trigger it.
    if(user.id!==owner){update();return;}
    const expectedOwner=owner,token=++generation;
    busy=true;busyToken=token;controls();message.clear();
    try{
      const latest=await api('/api/account/reading-preferences');
      if(disposed||generation!==token||getSession()?.user?.id!==expectedOwner)return;
      adopt(latest,{force:true});paint();recover.hidden=true;retryNeeded=true;message.set('prefs.reloaded');
    }catch(error){
      if(disposed||generation!==token||getSession()?.user?.id!==expectedOwner)return;
      message.set(error?.messageId||'prefs.reloadFailed',null,true);
    }finally{
      release(token);update();
    }
  });
  // Progressive enhancement: the shared choice primitive turns the small
  // selects into chips (or a searchable combobox). Native selects stay the
  // value owners and remain visible if mounting ever fails.
  const choiceLabels=[[view,'prefs.newBook'],[language,'prefs.target'],[theme,'prefs.paper'],[family,'prefs.typeface']];
  for(const [select,labelId]of choiceLabels)choices[select.id]=mountChoiceControl({document,select,label:t(labelId)})||null;
  update();
  function updateLabels(){
    if(disposed)return;
    L.refresh();paintPreview();message.refresh();
    for(const [select,labelId]of choiceLabels)choices[select.id]?.updateLabels({label:t(labelId)});
    save.textContent=saveLabel();
  }
  const offLocale=onUiLocaleChange(updateLabels);void uiReady.then(updateLabels);
  return {update,updateLabels,dispose(){
    if(disposed)return;disposed=true;generation++;cancelScheduled();queued=false;offLocale();L.clear();
    for(const select of fields())choices[select.id]?.destroy?.();
  }};
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
