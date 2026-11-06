
export const SYNTHETIC_IDS=Object.freeze(['synthetic-a','synthetic-b','guest']);
export const MEMORY_ROUTES=Object.freeze({
 '/api/account/profile':['GET','POST'],
 '/api/account/reading-preferences':['GET','POST'],
 '/api/account/ui-preferences':['GET','POST'],
 '/api/account/preference-memory':['GET'],
 '/api/account/observability':['GET'],
 '/api/account/mcp-connectors':['GET'],
 '/api/account/mcp-server':['GET'],
 '/api/library/daily-reading':['GET'],
 '/api/library/daily-reading/pause':['POST'],
 '/api/library/daily-reading/resume':['POST'],
});
const copy=value=>structuredClone(value);
const denied=reason=>Object.assign(Error('Fixture denied: '+reason),{status:403});

// No persistence, credential loader, transport, real account ID or book input.
export function createSettingsFixture({defaults,normalizePreferences,initialMemory}={}){
 if(!defaults||typeof normalizePreferences!=='function'||typeof initialMemory!=='function')throw Error('Product codecs must be supplied after the network fence');
 let identity='synthetic-a',generation=0;
 const history=[],faults=new Map(),rooms=new Map();
 const record=(route,method,outcome)=>history.push({route:typeof route==='string'&&Object.hasOwn(MEMORY_ROUTES,route)?route:'denied',method,generation,outcome});
 function makeSession(id){return {user:{id,email:id+'@example.invalid',displayName:'Synthetic Reader '+(id==='synthetic-a'?'A':'B'),kind:'local'},readingPreferences:{revision:1,preferences:{...defaults}},preferenceMemory:{revision:1,preferences:{...defaults},memory:initialMemory()}};}
 for(const id of SYNTHETIC_IDS.filter(id=>id!=='guest'))rooms.set(id,{session:makeSession(id),ui:{revision:0,uiLocale:null,updatedAt:null},plan:{id:'synthetic-plan-'+id,bookId:'synthetic-book',bookTitle:'Synthetic Book',revision:1,status:'active',time:'20:00',timeZone:'Asia/Shanghai',channel:'library',hostLabel:'Synthetic host',connectedAt:'2026-11-01T12:00:00Z',grantExpiresAt:'2026-12-01T12:00:00Z'}});
 const getSession=()=>identity==='guest'?{user:null}:rooms.get(identity).session;
 async function api(route,payload,options={}){
  const method=payload===undefined?'GET':'POST',captured=generation,id=identity;
  if(!Object.hasOwn(MEMORY_ROUTES,route)||!MEMORY_ROUTES[route].includes(method)||id==='guest'||options.owner!==undefined&&options.owner!==id){record(route,method,'denied');throw denied('route, method or owner');}
  const fault=faults.get(route);faults.delete(route);
  if(fault?.delayMs)await new Promise(resolve=>setTimeout(resolve,fault.delayMs));
  if(captured!==generation||id!==identity){record(route,method,'stale');throw denied('stale generation');}
  if(fault?.status){record(route,method,'fault');throw Object.assign(Error('Synthetic HTTP fault'),{status:fault.status});}
  const room=rooms.get(id);let result;
  if(route==='/api/account/profile'){
   if(payload!==undefined){if(!payload||Object.keys(payload).some(k=>k!=='displayName')||typeof payload.displayName!=='string'||!payload.displayName.startsWith('Synthetic')||payload.displayName.length>80)throw denied('synthetic profile only');room.session.user.displayName=payload.displayName;}
   result=room.session.user;
  }else if(route==='/api/account/reading-preferences'){
   if(payload!==undefined){if(!payload||Object.keys(payload).some(k=>!['baseRevision','preferences'].includes(k)))throw denied('preference schema');if(payload.baseRevision!==room.session.readingPreferences.revision)throw Object.assign(Error('Synthetic conflict'),{status:409});const preferences=normalizePreferences(payload.preferences,true);room.session.readingPreferences={revision:payload.baseRevision+1,preferences};}
   result=room.session.readingPreferences;
  }else if(route==='/api/account/ui-preferences'){
   if(payload!==undefined){if(!payload||Object.keys(payload).some(k=>!['baseRevision','uiLocale'].includes(k))||!['system','en','zh-Hans','zh-Hant','ja',null].includes(payload.uiLocale))throw denied('UI preference schema');if(payload.baseRevision!==room.ui.revision)throw Object.assign(Error('Synthetic conflict'),{status:409});room.ui={revision:payload.baseRevision+1,uiLocale:payload.uiLocale,updatedAt:'2026-11-01T12:00:00Z'};}
   result=room.ui;
  }else if(route==='/api/account/preference-memory')result=room.session.preferenceMemory;
  else if(route==='/api/account/observability')result={enabled:false,analytics:false,diagnostics:false,excluded:true};
  else if(route==='/api/account/mcp-connectors')result={connections:[]};
  else if(route==='/api/account/mcp-server')result={url:null,grants:[]};
  else{
   if(method==='POST'){if(!payload||Object.keys(payload).length!==1||payload.baseRevision!==room.plan.revision)throw denied('plan revision');room.plan={...room.plan,status:route.endsWith('/pause')?'paused':'active',revision:room.plan.revision+1};}
   result={plan:room.plan,inbox:[]};
  }
  record(route,method,'memory-only');return copy(result);
 }
 return {api,getSession,ledger:()=>copy(history),generation:()=>generation,setIdentity(id){if(!SYNTHETIC_IDS.includes(id))throw denied('identity');identity=id;generation++;},setFault(route,{status=0,delayMs=0}={}){if(!Object.hasOwn(MEMORY_ROUTES,route)||![0,409,503].includes(status)||!Number.isInteger(delayMs)||delayMs<0||delayMs>1500)throw denied('fault');faults.set(route,{status,delayMs});},block(reason){record('denied','BLOCK','denied');throw denied(reason);}};
}

// Installed BEFORE importing any product module. There is deliberately no
// reference to native fetch: even a newly introduced product request fails shut.
export function installNetworkFence(target,fixture,origin){
 const replace=(object,key,value)=>Object.defineProperty(object,key,{value,writable:false,configurable:false});
 replace(target,'fetch',async(input,init={})=>{
  if(typeof input!=='string'||!input.startsWith('/api/')||input.startsWith('//'))return fixture.block('fetch URL');
  if(new URL(input,origin).origin!==origin)return fixture.block('origin');
  const method=init.method||'GET',headers=new Headers(init.headers);
  if(headers.has('Authorization')||headers.has('Cookie')||init.credentials==='include')return fixture.block('credentials');
  if(!['GET','POST'].includes(method)||method==='GET'&&init.body!==undefined||method==='POST'&&typeof init.body!=='string')return fixture.block('fetch method');
  const payload=method==='POST'?JSON.parse(init.body):undefined;
  const result=await fixture.api(input,payload,{owner:headers.get('X-Reader-Owner')||undefined});
  return Response.json(result);
 });
 replace(target.navigator,'sendBeacon',()=>fixture.block('beacon'));
 for(const key of ['XMLHttpRequest','WebSocket','EventSource','Worker','SharedWorker'])replace(target,key,class{constructor(){fixture.block(key);}});
 replace(target,'open',()=>fixture.block('window.open'));
 if(target.navigator.serviceWorker)replace(target.navigator.serviceWorker,'register',()=>Promise.reject(denied('service worker')));
}

export function installNavigationFence({document,MutationObserver},fixture,{allowedDownload=()=>false}={}){
 const sanitizeLinks=()=>{for(const a of document.querySelectorAll('a[href]')){
  if(allowedDownload(a))continue;
  if(a.getAttribute('href')!=='#fixture-navigation-disabled')a.setAttribute('href','#fixture-navigation-disabled');
  a.removeAttribute('target');a.setAttribute('data-fixture-navigation','blocked');
 }};
 document.addEventListener('submit',event=>event.preventDefault(),true);
 for(const type of ['click','auxclick'])document.addEventListener(type,event=>{
  const anchor=event.target.closest?.('a');if(anchor&&!allowedDownload(anchor)){event.preventDefault();fixture.block('navigation');}
 },true);
 const observer=new MutationObserver(sanitizeLinks);observer.observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['href','target','download']});sanitizeLinks();
 return {sanitizeLinks};
}
