import {randomBytes,createHash,timingSafeEqual} from 'node:crypto';
import {digest} from '../server/document-import.mjs';
import {authFailure,normalizeAuthEmail} from '../server/auth-policy.mjs';

const CALLBACK='com.cubxxw.reader://auth/callback',FLOW_MS=600000,HANDOFF_MS=120000;
const CATEGORIES=new Set(['cancelled','expired','unavailable','conflict','linking_disabled','account_changed','unverified_email','failed']);
const random=()=>randomBytes(32).toString('base64url');
const proof=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{43}$/.test(value)&&Buffer.from(value,'base64url').toString('base64url')===value;
const equal=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.length===b.length&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
const keys=(value,allowed)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).every(key=>allowed.includes(key));
const verified=user=>{try{return typeof user?.id==='string'&&!!normalizeAuthEmail(user.email)&&typeof user.email_confirmed_at==='string'&&Number.isFinite(Date.parse(user.email_confirmed_at));}catch{return false;}};
const hasProvider=(user,provider)=>Array.isArray(user?.identities)&&user.identities.some(row=>row.provider===provider);
export function nativeOAuthFailure(category='failed',status=400){
 const messages={cancelled:'登录已取消，可以随时重新开始。',expired:'这次登录已过期，请重新开始。',unavailable:'登录服务暂时不可用，请稍后再试。',conflict:'这个登录身份已经绑定，请先使用原账号登录。',linking_disabled:'这个书房暂未开放账号绑定，可以继续使用现有方式登录。',account_changed:'账号已切换，请重新进入自己的书房。',unverified_email:'请先验证这个账号的邮箱，再继续登录。',failed:'登录未能完成，请重新尝试。'};
 if(!CATEGORIES.has(category))category='failed';
 return Object.assign(authFailure('auth.error.generic',messages[category],status),{nativeOAuthError:category});
}
const categoryOf=error=>CATEGORIES.has(error?.nativeOAuthError)?error.nativeOAuthError:error?.status>=500?'unavailable':'failed';
function callback(state,fields){const url=new URL(CALLBACK);url.search=new URLSearchParams({...fields,state}).toString();return {redirectURL:url.href};}
function secureOrigin(value){try{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password&&url.origin===value?url:null;}catch{return null;}}

// This adapter shares the existing opaque session store. Provider credentials
// never cross the native HTTP boundary or appear in browser callback URLs.
export function createHostedNativeAuth({store,env,clock,request,capabilities,createSession,freshSession,freshSessionAt,userFor,visible,sessionKey,validToken}){
 const transactionKey=id=>'auth/native/transactions/'+digest(id),launchKey=ticket=>'auth/native/launch/'+digest(ticket),handoffKey=code=>'auth/native/handoffs/'+digest(code);
 const active=row=>row&&!row.revoked&&row.expiresAt>clock()&&typeof row.user?.id==='string';
 const live=row=>row?.schemaVersion===1&&!row.cancelled&&row.expiresAt>clock();
 function providerURL(value,provider){
  let url;
  try{url=new URL(value);}catch{throw nativeOAuthFailure('unavailable',503);}
  const allowed=provider==='google'?url.hostname==='accounts.google.com'&&['/o/oauth2/v2/auth','/o/oauth2/auth'].includes(url.pathname):url.hostname==='appleid.apple.com'&&url.pathname==='/auth/authorize';
  if(!allowed||url.protocol!=='https:'||url.username||url.password||url.hash||url.port||[...url.searchParams.keys()].some(key=>/^(?:access_token|refresh_token|id_token|authorization)$/i.test(key)))throw nativeOAuthFailure('unavailable',503);
  return url.href;
 }
 async function readParent(flow,{provider=false}={}){
  const row=await freshSessionAt(flow.parentSessionKey);
  if(!active(row)||row.user.id!==flow.ownerID)throw nativeOAuthFailure('account_changed',409);
  const raw=await request('user',null,row.access),current=await store.read(flow.parentSessionKey,null);
  if(!active(current)||current.user.id!==flow.ownerID||raw.id!==flow.ownerID||raw.email!==flow.parentEmail)throw nativeOAuthFailure('account_changed',409);
  if(!verified(raw))throw nativeOAuthFailure('unverified_email',403);
  if(provider&&!hasProvider(raw,flow.provider))throw nativeOAuthFailure('failed',409);
  return raw;
 }
 async function identitiesFor(token,expectedOwner){
  if(!validToken(token))throw nativeOAuthFailure('account_changed',401);
  const row=await freshSession(token);
  if(!active(row))throw nativeOAuthFailure('account_changed',401);
  if(!expectedOwner||expectedOwner!==row.user.id)throw nativeOAuthFailure('account_changed',409);
  const raw=await request('user',null,row.access),current=await store.read(sessionKey(token),null);
  if(!active(current)||raw.id!==row.user.id||current.user.id!==row.user.id)throw nativeOAuthFailure('account_changed',409);
  const emailVerified=verified(raw),identities=(Array.isArray(raw.identities)?raw.identities:[]).filter(identity=>['email','google','apple'].includes(identity.provider)).map(identity=>{
   const email=typeof identity.identity_data?.email==='string'&&identity.identity_data.email.length<=254?identity.identity_data.email:null;
   return {provider:identity.provider,email,emailVerified:identity.identity_data?.email_verified===true||identity.provider==='email'&&email===raw.email&&emailVerified};
  });
  return {user:{...visible(raw),emailVerified},identities,providers:(await capabilities()).providers};
 }
 async function beginNativeOAuth(token,input,expectedOwner){
  if(!keys(input,['provider','mode','state','codeChallenge'])||!['google','apple'].includes(input.provider)||!['sign-in','link'].includes(input.mode)||!proof(input.state)||!proof(input.codeChallenge))throw nativeOAuthFailure('failed',400);
  const origin=secureOrigin(env.READER_PUBLIC_ORIGIN),base=secureOrigin(env.SUPABASE_URL?.replace(/\/$/,''));
  if(!origin||!base)throw nativeOAuthFailure('unavailable',503);
  if(!(await capabilities()).providers[input.provider])throw nativeOAuthFailure('unavailable',503);
  const current=validToken(token)?await userFor(token):null;
  let ownerID=null,parentSessionKey=null,parentEmail=null;
  if(input.mode==='link'){
   if(!current)throw nativeOAuthFailure('account_changed',401);
   if(expectedOwner!==current.id)throw nativeOAuthFailure('account_changed',409);
   ownerID=current.id;parentSessionKey=sessionKey(token);parentEmail=current.email;
  }else if(current||expectedOwner&&expectedOwner!=='guest')throw nativeOAuthFailure('account_changed',409);
  const transactionId=random(),ticket=random(),verifier=random(),row={schemaVersion:1,provider:input.provider,mode:input.mode,state:input.state,codeChallenge:input.codeChallenge,verifier,ownerID,parentSessionKey,parentEmail,launchHash:digest(ticket),status:'started',expiresAt:clock()+FLOW_MS};
  let url;
  if(row.mode==='link'){
   await readParent(row);
   const parent=await freshSessionAt(parentSessionKey);
   if(!active(parent)||parent.user.id!==ownerID)throw nativeOAuthFailure('account_changed',409);
   const route='user/identities/authorize?'+new URLSearchParams({provider:row.provider,redirect_to:origin.origin+'/api/auth/callback',code_challenge:challenge(verifier),code_challenge_method:'s256',skip_http_redirect:'true'});
   const result=await request(route,null,parent.access,'GET');url=providerURL(result?.url,row.provider);
  }else{
   const target=new URL(base.origin+'/auth/v1/authorize');target.search=new URLSearchParams({provider:row.provider,redirect_to:origin.origin+'/api/auth/callback',code_challenge:challenge(verifier),code_challenge_method:'s256'});url=target.href;
  }
  row.authorizeUrl=url;
  await store.mutate(transactionKey(transactionId),{},saved=>Object.assign(saved,row));
  await store.mutate(launchKey(ticket),{},saved=>Object.assign(saved,{transactionId,expiresAt:row.expiresAt}));
  return {url:origin.origin+'/api/auth/native/authorize?ticket='+ticket,transactionId,expiresIn:600};
 }
 async function launchNativeOAuth(ticket){
  if(!proof(ticket))throw nativeOAuthFailure('expired');
  const pointer=await store.read(launchKey(ticket),null);
  if(!pointer||pointer.expiresAt<=clock()||!proof(pointer.transactionId))throw nativeOAuthFailure('expired');
  const pending=await store.read(transactionKey(pointer.transactionId),null);
  if(!live(pending)||pending.status!=='started')throw nativeOAuthFailure(pending?.cancelled?'cancelled':'expired');
  if(pending.mode==='link')await readParent(pending);
  const authorizeUrl=await store.mutate(transactionKey(pointer.transactionId),{},row=>{
   if(!live(row)||row.status!=='started'||!equal(row.launchHash,digest(ticket)))throw nativeOAuthFailure(row.cancelled?'cancelled':'expired');
   const url=row.authorizeUrl;row.status='launched';delete row.launchHash;delete row.authorizeUrl;return url;
  });
  return {authorizeUrl,transactionId:pointer.transactionId};
 }
 async function finishNativeOAuth(transactionId,{code,error}={}){
  if(!proof(transactionId))throw nativeOAuthFailure('expired');
  const path=transactionKey(transactionId),initial=await store.read(path,null);
  if(!initial||!proof(initial.state))throw nativeOAuthFailure('expired');
  const marker=random();let flow;
  try{
   flow=await store.mutate(path,{},row=>{
    if(!live(row)||row.status!=='launched'||!row.verifier)throw nativeOAuthFailure(row.cancelled?'cancelled':'expired');
    const snapshot={...row};row.status='callback';row.callbackMarker=marker;delete row.verifier;return snapshot;
   });
   if(error){const category=error==='access_denied'?'cancelled':error==='identity_already_exists'?'conflict':error==='manual_linking_disabled'?'linking_disabled':'failed';throw nativeOAuthFailure(category);}
   if(typeof code!=='string'||!code||code.length>4096||/[\s\u0000-\u001f\u007f]/.test(code))throw nativeOAuthFailure('expired');
   const data=await request('token?grant_type=pkce',{auth_code:code,code_verifier:flow.verifier});
   if(!data?.access_token||!data.refresh_token||!Number.isFinite(data.expires_in)||data.expires_in<=0||typeof data.user?.id!=='string')throw nativeOAuthFailure('failed',502);
   const raw=await request('user',null,data.access_token);
   if(raw.id!==data.user.id)throw nativeOAuthFailure('account_changed',409);
   if(!verified(raw))throw nativeOAuthFailure('unverified_email',403);
   if(!hasProvider(raw,flow.provider))throw nativeOAuthFailure('failed',409);
   if(flow.mode==='link'){
    if(raw.id!==flow.ownerID)throw nativeOAuthFailure('account_changed',409);
    await readParent(flow,{provider:true});
   }
   const handoff=random(),handoffExpiresAt=Math.min(clock()+HANDOFF_MS,flow.expiresAt);
   await store.mutate(handoffKey(handoff),{},row=>Object.assign(row,{transactionId,expiresAt:handoffExpiresAt}));
   await store.mutate(path,{},row=>{
    if(!live(row)||row.status!=='callback'||row.callbackMarker!==marker)throw nativeOAuthFailure(row.cancelled?'cancelled':'expired');
    row.status='ready';row.handoffHash=digest(handoff);row.handoffExpiresAt=handoffExpiresAt;delete row.callbackMarker;
    // Linking keeps the parent's independent provider session untouched.
    if(row.mode==='sign-in')row.providerSession={user:raw,access_token:data.access_token,refresh_token:data.refresh_token,expires_in:data.expires_in};
   });
   return callback(flow.state,{code:handoff});
  }catch(failure){
   const category=categoryOf(failure),current=await store.read(path,null);
   if(current?.callbackMarker===marker)await store.mutate(path,{},row=>{if(row.callbackMarker===marker){row.status='failed';row.failure=category;delete row.callbackMarker;delete row.providerSession;}});
   return callback(initial.state,{error:current?.cancelled?'cancelled':category});
  }
 }
 async function exchangeNativeOAuth(token,input,expectedOwner){
  if(!keys(input,['code','state','codeVerifier'])||!proof(input.code)||!proof(input.state)||!proof(input.codeVerifier))throw nativeOAuthFailure('expired');
  const pointer=await store.read(handoffKey(input.code),null);
  if(!pointer||pointer.expiresAt<=clock()||!proof(pointer.transactionId))throw nativeOAuthFailure('expired');
  const path=transactionKey(pointer.transactionId),initial=await store.read(path,null);
  if(!live(initial)||initial.status!=='ready'||initial.handoffExpiresAt<=clock()||!equal(initial.handoffHash,digest(input.code))||!equal(initial.state,input.state)||!equal(initial.codeChallenge,challenge(input.codeVerifier)))throw nativeOAuthFailure('expired');
  let linkedUser;
  if(initial.mode==='link'){
   if(!validToken(token)||sessionKey(token)!==initial.parentSessionKey||expectedOwner!==initial.ownerID)throw nativeOAuthFailure('account_changed',409);
   linkedUser=await readParent(initial,{provider:true});
  }else if(validToken(token)&&await userFor(token)||expectedOwner&&expectedOwner!=='guest')throw nativeOAuthFailure('account_changed',409);
  const marker=random(),claimed=await store.mutate(path,{},row=>{
   if(!live(row)||row.status!=='ready'||row.handoffExpiresAt<=clock()||!equal(row.handoffHash,digest(input.code))||!equal(row.state,input.state)||!equal(row.codeChallenge,challenge(input.codeVerifier)))throw nativeOAuthFailure('expired');
   const snapshot={...row};row.status='exchanging';row.exchangeMarker=marker;delete row.providerSession;delete row.handoffHash;return snapshot;
  });
  let result;
  try{
   if(claimed.mode==='link'){
    const current=await store.read(path,null);if(!live(current)||current.exchangeMarker!==marker)throw nativeOAuthFailure('cancelled');
    const user=await store.mutate(claimed.parentSessionKey,{},row=>{
     if(!active(row)||row.user.id!==claimed.ownerID||row.user.email!==claimed.parentEmail)throw nativeOAuthFailure('account_changed',409);
     row.user=visible(linkedUser);return row.user;
    });result={token,user};
   }else result=await createSession(claimed.providerSession);
   await store.mutate(path,{},row=>{
    if(!live(row)||row.status!=='exchanging'||row.exchangeMarker!==marker)throw nativeOAuthFailure(row.cancelled?'cancelled':'expired');
    row.status='complete';delete row.exchangeMarker;delete row.codeChallenge;
   });
   return result;
  }catch(error){
   // A cancelled/uncertain sign-in must not leave an undisclosed usable opaque session.
   if(result&&claimed.mode==='sign-in')await store.mutate(sessionKey(result.token),{},row=>{row.revoked=true;delete row.access;delete row.refresh;delete row.refreshLease;}).catch(()=>{});
   throw error;
  }
 }
 async function cancelNativeOAuth(transactionId){
  if(!proof(transactionId))throw nativeOAuthFailure('expired');
  const path=transactionKey(transactionId),existing=await store.read(path,null);
  if(!existing||existing.schemaVersion!==1)return {cancelled:true};
  await store.mutate(path,{},row=>{if(row.status==='complete')return;row.cancelled=true;row.status='cancelled';for(const key of ['verifier','authorizeUrl','launchHash','providerSession','handoffHash','callbackMarker','exchangeMarker'])delete row[key];});
  return {cancelled:true};
 }
 const challenge=verifier=>createHash('sha256').update(verifier).digest('base64url');
 return {beginNativeOAuth,launchNativeOAuth,finishNativeOAuth,exchangeNativeOAuth,cancelNativeOAuth,identitiesFor};
}
