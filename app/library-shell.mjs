import {mountPreferenceMemory} from './preference-memory-ui.mjs';
import {t,onUiLocaleChange,onUiLocaleStateChange,getUiLocale,getUiLocaleState,setUiLocale,retryUiLocale,uiReady,createUiMessage} from './ui-locale.mjs';
import {UI_LOCALES,uiAuthoredPath} from './ui-locale-codec.mjs';
import {mountLibraryDailyReading} from './library-daily-reading.mjs';
import {mountLibraryData} from './library-data.mjs';
import {getSiteAppearance,setSiteAppearance} from './site-appearance.mjs';
import {mountLibraryProfile,renderProfileAvatar} from './library-profile.mjs';
import {mountReadingPreferencesForm} from './library-reading-preferences.mjs';
import {mountSettingsAppearance} from './settings-appearance.mjs';
import {mountConfirm} from './settings-controls.mjs';
const $=id=>document.getElementById(id);
const node=(tag,className,text)=>{const n=document.createElement(tag);if(className)n.className=className;if(text!==undefined)n.textContent=text;return n;};
// P2 opener safety: the settings dialog captures its opener only on first open
// and returns focus only to a connected, visible, non-inert control outside the
// dialog; the sidebar settings entry is the explicit fallback.
export function settingsOpenerCandidate(document,dialog){
  const active=document.activeElement;
  return active&&active!==document.body&&!(dialog&&dialog.contains(active))?active:null;
}
export function settingsFocusTarget(dialog,candidate,fallback){
  for(const target of [candidate,fallback]){
    if(!target||typeof target.focus!=='function'||target.isConnected===false||target.hidden)continue;
    if(dialog&&dialog.contains(target))continue;
    if(typeof target.closest==='function'&&target.closest('[inert]'))continue;
    if(typeof target.getClientRects==='function'&&target.getClientRects().length===0)continue;
    return target;
  }
  return null;
}
export function roomIcons(root=document){for(const holder of root.querySelectorAll('[data-icon]')){const svg=document.createElementNS('http://www.w3.org/2000/svg','svg'),use=document.createElementNS(svg.namespaceURI,'use');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('aria-hidden','true');use.setAttribute('href','/icons.svg#'+holder.dataset.icon);svg.append(use);holder.replaceChildren(svg);}}
// GET-201: one stable paper window. The header carries the title and exactly
// one contextual description for the selected tab, the ~180px sidebar holds
// short single-line tabs with a quiet tonal selection, and the content region
// scrolls on its own so tab and language switches never resize the dialog. On
// narrow viewports the same tabs become a horizontally scrollable strip with
// edge fades, and the selected tab scrolls itself into view. URL/history
// semantics stay with library-view-state and the caller callbacks.
export function mountLibraryShell({getSession,openAuth,onLogout,onHistory,onOpenChat,api,onProfileUpdated,onRestored,onReadingPreferencesSaved=()=>{},onPreferenceMemorySaved=()=>{},getBooks=()=>[],getCurrentBook=()=>null,inboxRoot=null,onSettingsOpen=()=>{},onSettingsClose=()=>{},onSettingsTab=()=>{}}){
  const header=$('library-sidebar'),navigation=$('library-nav-dialog'),settings=$('library-settings-dialog'),media=matchMedia('(max-width:980px)'),key='marginalia-library-sidebar';let collapsed=false,opener=null,navigationReturn=null;
  for(const control of header.querySelectorAll('button[data-hint]'))if(!control.hasAttribute('aria-label'))control.setAttribute('aria-label',control.dataset.hint);
  const accountButton=node('button','sidebar-account');accountButton.id='library-account';accountButton.type='button';
  const accountAvatar=node('span','sidebar-avatar'),accountCopy=node('span','sidebar-account-copy'),accountName=node('span','sidebar-account-name'),accountEmail=node('span','sidebar-account-email');accountCopy.append(accountName,accountEmail);accountButton.append(accountAvatar,accountCopy);$('library-settings').insertAdjacentElement('afterend',accountButton);
  accountButton.addEventListener('click',()=>{if(getSession()?.user)openSettings('account');else{closeNavigation();openAuth();}});
  try{collapsed=localStorage.getItem(key)==='collapsed';}catch{}
  const close=node('button','dialog-close','×');close.type='button';close.setAttribute('aria-label',t('shell.settings.close'));
  close.addEventListener('click',()=>settings.close());
  const heading=node('h2','',t('shell.settings.title'));heading.id='settings-title';
  const description=node('p','settings-description settings-tab-description',t('shell.settings.tabDescription.account'));description.id='settings-description';
  const headingRow=node('div','settings-heading'),headingCopy=node('div','settings-heading-copy');headingCopy.append(heading,description);headingRow.append(headingCopy,close);
  const layout=node('div','settings-layout'),tabs=node('div','settings-tabs');tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label',t('shell.settings.categories'));
  const content=node('div','settings-content'),panels={},tabButtons=[];
  function select(name,focus=false){
    for(const b of tabButtons){const selected=b.dataset.setting===name;b.setAttribute('aria-selected',String(selected));b.tabIndex=selected?0:-1;panels[b.dataset.setting].hidden=!selected;
      if(selected){description.textContent=t('shell.settings.tabDescription.'+name);if(typeof b.scrollIntoView==='function')b.scrollIntoView({block:'nearest',inline:'center'});if(focus)b.focus();}}
    if(settings.open)onSettingsTab(name);
  }
  for(const name of ['account','reading-habits','daily-reading','appearance','data','about']){const b=node('button','',t('shell.settings.tab.'+name));b.type='button';b.dataset.setting=name;b.id='settings-tab-'+name;b.setAttribute('role','tab');b.setAttribute('aria-controls','settings-panel-'+name);b.addEventListener('click',()=>select(name));tabButtons.push(b);tabs.append(b);const p=node('section','settings-panel');p.id='settings-panel-'+name;p.setAttribute('role','tabpanel');p.setAttribute('aria-labelledby',b.id);panels[name]=p;content.append(p);}
  tabs.addEventListener('keydown',event=>{const current=tabButtons.indexOf(document.activeElement);if(current<0)return;let index;if(['ArrowRight','ArrowDown'].includes(event.key))index=(current+1)%tabButtons.length;else if(['ArrowLeft','ArrowUp'].includes(event.key))index=(current+tabButtons.length-1)%tabButtons.length;else if(event.key==='Home')index=0;else if(event.key==='End')index=tabButtons.length-1;else return;event.preventDefault();select(tabButtons[index].dataset.setting,true);});
  const accountTitle=node('h3'),accountDetail=node('p','settings-description'),login=node('button','primary',t('shell.account.login')),logout=node('button','outline',t('shell.account.logout')),accountStatus=node('p','settings-status');accountStatus.setAttribute('role','status');login.type=logout.type='button';
  const accountMessage=createUiMessage((text,error)=>{accountStatus.textContent=text;accountStatus.classList.toggle('error',!!error);});
  login.addEventListener('click',()=>{settings.close();openAuth();});
  // Signing out is a heavy action: one confirmation names the consequence, and
  // the existing owner guards, retry focus and late-response fences stay intact.
  const logoutConfirm=mountConfirm({document,labels:{cancel:t('shell.account.logoutConfirm.cancel'),confirm:t('shell.account.logoutConfirm.action')}});
  logoutConfirm.confirmButton.id='settings-confirm-action';logoutConfirm.cancelButton.id='settings-confirm-cancel';
  let logoutBusy=false,logoutEpoch=0,logoutOwner=getSession()?.user?.id||null;
  const withdrawLogout=()=>{logoutEpoch++;logoutConfirm.close({focus:false});};
  async function doLogout(){
    const hadFocus=document.activeElement===logout;let failed=false;logoutBusy=true;logout.disabled=true;logout.textContent=t('shell.account.loggingOut');accountMessage.clear();
    try{await onLogout();update();if(settings.open)login.focus();accountMessage.set('shell.account.loggedOut');}
    catch(error){failed=true;accountMessage.set('ui.generic.error',null,true);}
    finally{logoutBusy=false;logout.disabled=false;logout.textContent=t('shell.account.logout');if(failed&&hadFocus&&settings.open&&!logout.hidden&&(document.activeElement===document.body||document.activeElement===logout))logout.focus({preventScroll:true});}
  }
  logout.addEventListener('click',()=>{
    if(logoutBusy||logout.disabled||logout.hidden)return;
    // The confirmation is bound to the account it was opened for: a session
    // change in the waiting window withdraws it instead of signing out.
    const openedUser=getSession()?.user?.id||null,openedEpoch=logoutEpoch;
    logoutConfirm.open({title:t('shell.account.logoutConfirm.title'),consequence:t('shell.account.logoutConfirm.consequence'),confirmLabel:t('shell.account.logoutConfirm.action'),cancelLabel:t('shell.account.logoutConfirm.cancel'),opener:logout,onConfirm:()=>{
      if(!settings.open||logoutEpoch!==openedEpoch||(getSession()?.user?.id||null)!==openedUser){logoutConfirm.close();return;}
      void doLogout();
    }});
  });
  const accountActions=node('div','settings-actions'),profileRoot=node('div','account-profile-root');accountActions.append(login,logout);panels.account.append(accountTitle,accountDetail,profileRoot,accountActions,accountStatus);
  const profile=mountLibraryProfile({root:profileRoot,getSession,api,onProfileUpdated,onRestored});
  const memoryRoot=node('section','settings-preference-memory');panels['reading-habits'].append(memoryRoot);
  const memory=mountPreferenceMemory({root:memoryRoot,api,getSession,onSaved:onPreferenceMemorySaved});
  const habits=mountReadingPreferencesForm({root:panels['reading-habits'],api,getSession,onSaved:onReadingPreferencesSaved});
  const daily=mountLibraryDailyReading({root:panels['daily-reading'],inboxRoot,api,getSession,getBooks,getCurrentBook});
  const data=mountLibraryData({root:panels.data,getSession,api,onRestored});
  const appearance=mountSettingsAppearance({
    document,root:panels.appearance,t,getAppearance:getSiteAppearance,setAppearance:setSiteAppearance,
    locale:{options:UI_LOCALES,getState:getUiLocaleState,setLocale:code=>{setUiLocale(code).catch(()=>{});},retry:()=>{retryUiLocale().catch(()=>{});},subscribeState:onUiLocaleStateChange,labels:id=>t(id)}
  });
  const aboutTitle=node('h3','settings-brand-title'),about=node('p','settings-description',t('shell.about.tagline')),license=node('p','settings-description',t('shell.about.license')),links=node('div','settings-about-links'),source=node('a','text-link',t('shell.about.source')),privacy=node('a','text-link',t('shell.about.privacy'));source.href='https://github.com/getyak/leafhour';source.target='_blank';source.rel='noopener noreferrer';privacy.href=uiAuthoredPath('/privacy',getUiLocale());links.append(source,privacy);const aboutMark=node('span','settings-brand-mark');aboutMark.setAttribute('aria-hidden','true');aboutTitle.lang='en';aboutTitle.append(aboutMark,node('span','','Leafhour'));const promise=node('p','settings-brand-promise','Stay with a book.');promise.lang='en';
  const licenseLine=node('p','settings-description',t('shell.about.license.agpl'));
  panels.about.append(aboutTitle,promise,about,license,licenseLine,links);
  layout.append(tabs,content);settings.replaceChildren(headingRow,layout);settings.append(logoutConfirm.dialog);select('account');
  function appearanceSync(){appearance.sync();}
  // Label-only account refresh: never clears status, never touches in-flight
  // operations and never triggers a business update.
  let accountUser=null;
  function accountLabels(){const user=accountUser;accountTitle.textContent=user?t('shell.account.title.signedIn'):t('shell.account.title.guest');accountDetail.textContent=user?(user.kind==='local'?t('shell.account.detail.local'):t('shell.account.detail.email')):t('shell.account.detail.guest');accountName.textContent=user?.displayName||user?.email?.split('@')[0]||(user?t('shell.account.name.local'):t('shell.account.title.guest'));accountEmail.textContent=user?.email||(user?t('shell.account.email.local'):t('shell.account.login'));const accountLabel=user?t('shell.account.settingsLabel',{name:accountName.textContent}):t('shell.account.guestLabel');accountButton.setAttribute('aria-label',accountLabel);accountButton.dataset.hint=accountLabel;if(!logoutBusy)logout.textContent=t('shell.account.logout');}
  function update(){const user=accountUser=getSession()?.user;const nextOwner=user?.id||null;if(logoutOwner!==nextOwner){logoutOwner=nextOwner;withdrawLogout();}login.hidden=!!user;logout.hidden=!user;accountMessage.clear();renderProfileAvatar(accountAvatar,user);accountLabels();profile.update();habits.update();memory.update();daily.update();data.update();appearanceSync();}
  const sidebarToggle=$('sidebar-toggle');let sidebarLabelId=null,sidebarHintId=null;
  function sidebarLabels(){if(sidebarLabelId)sidebarToggle.setAttribute('aria-label',t(sidebarLabelId));if(sidebarHintId)sidebarToggle.dataset.hint=t(sidebarHintId);}
  function syncSidebar(){$('library-menu').setAttribute('aria-expanded',String(navigation.open));document.body.dataset.sidebarCollapsed=String(collapsed);sidebarToggle.setAttribute('aria-expanded',String(media.matches?navigation.open:!collapsed));sidebarLabelId=media.matches?'shell.sidebar.closeNav':collapsed?'shell.sidebar.expand':'shell.sidebar.collapse';sidebarHintId=collapsed?'shell.sidebar.expand':'shell.sidebar.collapse';sidebarLabels();}
  function closeNavigation(){if(navigation.open)navigation.close();}
  function adapt(){closeNavigation();if(media.matches)navigation.append(header);else document.body.insertBefore(header,$('main'));syncSidebar();}
  $('sidebar-toggle').addEventListener('click',()=>{if(media.matches){closeNavigation();return;}collapsed=!collapsed;try{localStorage.setItem(key,collapsed?'collapsed':'expanded');}catch{}syncSidebar();if(!collapsed)$('sidebar-toggle').focus();});
  $('library-menu').addEventListener('click',()=>{navigation.showModal();syncSidebar();$('sidebar-toggle').focus();});
  // GET-178: the sidebar entry is the single palette entry (the local
  // #book-search input stays a filter). Closing the navigation sheet hands focus
  // to the palette bootstrap without a stale restoration.
  $('sidebar-search-open').addEventListener('click',()=>{if(navigation.open){navigationReturn=null;closeNavigation();}});
  navigation.addEventListener('close',()=>{syncSidebar();if(media.matches)(navigationReturn||$('library-menu')).focus();navigationReturn=null;});media.addEventListener('change',adapt);adapt();
  function openSettings(name='account'){const opening=!settings.open,changing=tabButtons.find(b=>b.getAttribute('aria-selected')==='true')?.dataset.setting!==name;if(opening)opener=settingsOpenerCandidate(document,settings)||$('library-settings');closeNavigation();update();select(panels[name]?name:'account');if(name==='daily-reading')daily.refresh();if(name==='reading-habits'&&(opening||changing))void memory.refresh();if(opening){settings.showModal();onSettingsOpen(panels[name]?name:'account');}if(opening||changing)tabButtons.find(b=>b.getAttribute('aria-selected')==='true')?.focus();}
  settings.addEventListener('close',()=>{if(settings.open)return;withdrawLogout();daily.closeTransient?.();data.closeTransient?.();const target=settingsFocusTarget(settings,opener,$('library-settings'));opener=null;target?.focus({preventScroll:true});onSettingsClose();});
  $('library-settings').addEventListener('click',()=>openSettings('account'));
  $('library-calendar').addEventListener('click',()=>{closeNavigation();onHistory();});
  $('library-chat-open').addEventListener('click',()=>{closeNavigation();onOpenChat();});
  for(const button of document.querySelectorAll('[data-shelf]'))button.addEventListener('click',closeNavigation);
  document.addEventListener('site:appearance',appearanceSync);update();roomIcons();
  function updateLabels(){
    close.setAttribute('aria-label',t('shell.settings.close'));heading.textContent=t('shell.settings.title');tabs.setAttribute('aria-label',t('shell.settings.categories'));
    for(const b of tabButtons)b.textContent=t('shell.settings.tab.'+b.dataset.setting);
    description.textContent=t('shell.settings.tabDescription.'+(tabButtons.find(b=>b.getAttribute('aria-selected')==='true')?.dataset.setting||'account'));
    login.textContent=t('shell.account.login');logout.textContent=t(logoutBusy?'shell.account.loggingOut':'shell.account.logout');
    logoutConfirm.updateLabels({title:t('shell.account.logoutConfirm.title'),consequence:t('shell.account.logoutConfirm.consequence'),confirmLabel:t('shell.account.logoutConfirm.action'),cancelLabel:t('shell.account.logoutConfirm.cancel')});
    license.textContent=t('shell.about.license');licenseLine.textContent=t('shell.about.license.agpl');
    about.textContent=t('shell.about.tagline');source.textContent=t('shell.about.source');privacy.textContent=t('shell.about.privacy');privacy.href=uiAuthoredPath('/privacy',getUiLocale());
    appearance.updateLabels();
    profile.updateLabels?.();habits.updateLabels?.();memory.updateLabels();daily.updateLabels?.();data.updateLabels?.();
    accountLabels();sidebarLabels();accountMessage.refresh();
  }
  onUiLocaleChange(updateLabels);void uiReady.then(()=>updateLabels());
  return {openSettings,closeNavigation,update,updateLabels,refreshDaily:()=>daily.refresh(),clear(){withdrawLogout();daily.clear();data.clear();closeNavigation();if(settings.open)settings.close();update();}};
}
