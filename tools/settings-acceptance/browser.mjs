import {createSettingsFixture,installNetworkFence,installNavigationFence} from './model.mjs';

let fixture;
const bootstrapDenied=[];
const block=reason=>{if(fixture)return fixture.block(reason);bootstrapDenied.push({route:'denied',method:'BLOCK',generation:0,outcome:'denied-before-product-bootstrap'});throw Error('Fixture denied: '+reason);};
installNetworkFence(globalThis,{api:(...args)=>fixture?fixture.api(...args):block('request before fixture ready'),block},location.origin);
// Asset imports use the browser's module loader, restricted by the host CSP;
// all fetch/XHR/beacon/worker business paths have already been disabled.
const objectURLs=new Set(),nativeCreate=URL.createObjectURL.bind(URL),nativeRevoke=URL.revokeObjectURL.bind(URL);
Object.defineProperty(URL,'createObjectURL',{value:blob=>{const url=nativeCreate(blob);objectURLs.add(url);return url;},writable:false,configurable:false});
Object.defineProperty(URL,'revokeObjectURL',{value:url=>{objectURLs.delete(url);nativeRevoke(url);},writable:false,configurable:false});
const {sanitizeLinks}=installNavigationFence(globalThis,{block},{allowedDownload:a=>objectURLs.has(a.href)&&['leafhour-settings.json','leafhour-personal-data.json'].includes(a.download)});
const [{mountLibraryShell,roomIcons},locale,{setSiteAppearance},preferences,memory]=await Promise.all([
 import('../../app/library-shell.mjs'),import('../../app/ui-locale.mjs'),import('../../app/site-appearance.mjs'),import('../../app/reading-preferences.mjs'),import('../../app/preference-memory-codec.mjs')
]);
fixture=createSettingsFixture({defaults:preferences.globalPreferencesDefaults,normalizePreferences:preferences.normalizeGlobalPreferences,initialMemory:memory.initialPreferenceMemory});
await locale.uiReady;
const params=new URLSearchParams(location.search);
const language=params.get('ui')||params.get('locale')||'en',theme=params.get('theme')||'paper',panel=params.get('panel')||'appearance';
if(!['system','en','zh-Hans','zh-Hant','ja'].includes(language)||!['paper','night'].includes(theme)||!['account','reading-habits','daily-reading','appearance','data','about'].includes(panel))throw Error('Unknown fixture view');
fixture.setIdentity(params.get('identity')||'synthetic-a');
await locale.adoptUiOwner(fixture.getSession().user?.id||null);
await locale.setUiLocale(language);setSiteAppearance(theme);
const book=Object.freeze({bookId:'synthetic-book',title:{zh:'Synthetic Book',en:'Synthetic Book'},visibility:'private'});
const shell=mountLibraryShell({getSession:fixture.getSession,api:fixture.api,getBooks:()=>[book],getCurrentBook:()=>book,inboxRoot:document.createElement('section'),openAuth:()=>fixture.block('login'),onLogout:async()=>{fixture.setIdentity('guest');await locale.adoptUiOwner(null);},onHistory:()=>fixture.block('history'),onOpenChat:()=>fixture.block('chat')});
roomIcons();shell.openSettings(panel);sanitizeLinks();
Object.defineProperty(window,'get201Fixture',{value:Object.freeze({
 ready:true,source:document.documentElement.dataset.sourceCommit,
 ledger:()=>[...bootstrapDenied,...fixture.ledger()],
 openPanel:name=>{if(!['account','reading-habits','daily-reading','appearance','data','about'].includes(name))throw Error('Unknown panel');shell.openSettings(name);},
 setIdentity:async id=>{fixture.setIdentity(id);shell.update();await locale.adoptUiOwner(fixture.getSession().user?.id||null);},setFault:fixture.setFault,
 snapshot:()=>({source:document.documentElement.dataset.sourceCommit,viewport:{width:innerWidth,height:innerHeight},panel:document.querySelector('[role=tab][aria-selected=true]')?.dataset.setting,geometry:document.querySelector('#library-settings-dialog').getBoundingClientRect().toJSON(),ledger:fixture.ledger()})
}),writable:false});
document.documentElement.dataset.fixtureReady='true';
