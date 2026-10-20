// The browser entry supplies an owner from its verified session. This transport
// knows one same-origin resource; it never discovers an account or sends books,
// reading settings, credentials or raw server errors to another service.
const locales=new Set(['en','zh-Hans','zh-Hant','ja']);
const failure=status=>Object.assign(Error('Interface language could not be synchronized.'),{status});
const validOwner=owner=>typeof owner==='string'&&owner.length>0&&owner.length<=512&&!/[\u0000-\u001f\u007f]/.test(owner);
const validWrite=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===2&&Object.hasOwn(value,'baseRevision')&&Object.hasOwn(value,'uiLocale')&&Number.isSafeInteger(value.baseRevision)&&value.baseRevision>=0&&(value.uiLocale===null||locales.has(value.uiLocale));
export function createAccountUiPreferencesTransport({request=globalThis.fetch,timeoutMs=6000,onSessionChanged=()=>{}}={}){
 const duration=Number.isFinite(timeoutMs)?Math.max(1,Math.min(15000,timeoutMs)):6000;
 async function send(owner,body){
  if(!validOwner(owner))throw failure(401);
  if(body!==undefined&&!validWrite(body))throw failure(400);
  const controller=new AbortController();let timer;
  const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(failure(0));},duration);});
  try{
   return await Promise.race([deadline,(async()=>{
    let response;
    try{response=await request('/api/account/ui-preferences',{method:body===undefined?'GET':'POST',credentials:'same-origin',cache:'no-store',redirect:'error',signal:controller.signal,headers:{'Content-Type':'application/json','X-Reader-Owner':owner},...(body===undefined?{}:{body:JSON.stringify({baseRevision:body.baseRevision,uiLocale:body.uiLocale})})});}catch{throw failure(0);}
    if(controller.signal.aborted)throw failure(0);
    if(response.headers?.get('X-Reader-Session-Changed')==='1'){
     try{onSessionChanged(owner);}catch{}
     throw failure(401);
    }
    if(!response.ok)throw failure(Number.isInteger(response.status)&&response.status>=400&&response.status<=599?response.status:0);
    let snapshot;try{snapshot=await response.json();}catch{throw failure(0);}
    if(controller.signal.aborted)throw failure(0);
    return snapshot;
   })()]);
  }finally{clearTimeout(timer);controller.abort();}
 }
 return {read:owner=>send(owner),write:(owner,body)=>body===undefined?Promise.reject(failure(400)):send(owner,body)};
}
