import {randomBytes,createHash} from 'node:crypto';
import {digest,fail} from '../server/document-import.mjs';
import {normalizeAuthEmail,OTP_POLICY,safeAuthReturn,authPurpose,validateAuthPassword} from '../server/auth-policy.mjs';

const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const validToken=token=>typeof token==='string'&&/^[A-Za-z0-9_-]{43}$/.test(token);
// A store request may take 45s. Cover the provider (15s), then snapshot + CAS (90s).
const REFRESH_LEASE_MS=180000,REFRESH_DISPATCH_BUDGET_MS=110000;
export function createHostedAuth({store,env=process.env,fetcher=fetch,clock=Date.now}={}){
  const base=env.SUPABASE_URL?.replace(/\/$/,''),key=env.SUPABASE_PUBLISHABLE_KEY;
  if(!base?.startsWith('https://')||!key)throw fail('登录服务尚未配置',503);
  const sessionKey=token=>'auth/sessions/'+digest(token);
  const visible=user=>({id:user.id,email:user.email||null,kind:['google','apple'].includes(user.app_metadata?.provider)?user.app_metadata.provider:'email'});
  let settingsPromise,settingsExpire=0;
  async function request(route,body,access,method){
    let response,data;
    try{
      response=await fetcher(base+'/auth/v1/'+route,{method:method||(body?'POST':'GET'),headers:{apikey:key,'Content-Type':'application/json',...(access?{Authorization:'Bearer '+access}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(15000)});
      data=response.status===204?{}:await response.json();
    }catch{throw fail(route==='otp'?'邮件发送暂未确认，请稍后查看邮箱再重试':'登录服务暂时无法连接，请稍后重试',503);}
    if(response.ok)return data;
    if(response.status===429){const error=fail('请求较频繁，请稍后再试',429);error.retryAfter=Math.max(60,Math.min(3600,Number(response.headers.get('retry-after'))||60));throw error;}
    if(response.status>=500)throw fail('登录服务暂时不可用，请稍后重试',503);
    const code=data?.error_code||data?.code;
    if(route==='token?grant_type=password')throw fail(code==='email_not_confirmed'?'请先验证邮箱，也可以使用验证码登录':'邮箱或密码不正确，请重试或使用验证码登录',401);
    if(route==='user'&&method==='PUT'){const error=fail(code==='same_password'?'新密码与原密码相同，请换一个':code==='weak_password'?'这个密码不够安全，请换一个较长的密码':'密码暂未保存，请重试或重新验证邮箱',400);error.retryPasswordSetup=['same_password','weak_password','validation_failed'].includes(code);throw error;}
    if(route==='verify'&&['otp_expired','otp_disabled','validation_failed'].includes(code))throw fail('验证码不正确或已过期，请重新获取',400);
    if(route==='verify')throw fail('验证码未能验证，请核对邮件里的数字',400);
    if(route==='otp'||route==='recover')throw fail('验证码邮件暂时无法发出，请稍后重试',503);
    if(route.startsWith('token')||route==='user')throw fail('登录已失效，请重新进入',401);
    throw fail('登录未能完成，请重新尝试',400);
  }
  async function capabilities(){
    if(!settingsPromise||clock()>=settingsExpire){settingsExpire=clock()+60000;settingsPromise=request('settings').catch(error=>{settingsPromise=null;throw error;});}
    const settings=await settingsPromise;
    return {email:env.READER_EMAIL_ENABLED==='true'&&settings.external?.email!==false,password:settings.external?.email!==false,providers:{google:settings.external?.google===true,apple:settings.external?.apple===true},otp:{...OTP_POLICY}};
  }
  async function requestCode(value,purpose='login'){
    purpose=authPurpose(purpose);
    if(env.READER_EMAIL_ENABLED!=='true')throw fail('邮箱登录正在准备中。你可以先试读公版书。',503);
    const email=normalizeAuthEmail(value),emailKey=digest(email),now=clock();
    await store.mutate('auth/limits/mail',{requests:[]},row=>{
      row.requests=(row.requests||[]).filter(x=>now-x.time<3600000);
      const previous=row.requests.filter(x=>x.email===emailKey).at(-1);
      if(previous&&now-previous.time<60000){const error=fail('请稍后再获取验证码',429);error.retryAfter=Math.ceil((previous.time+60000-now)/1000);throw error;}
      if(row.requests.length>=30){const error=fail('邮件请求较多，请稍后再试',429);error.retryAfter=Math.ceil((row.requests[0].time+3600000-now)/1000);throw error;}
      row.requests.push({email:emailKey,time:now});
    });
    // Recovery deliberately does not create an account or reveal whether it exists.
    await request(purpose==='recovery'?'recover':'otp',purpose==='recovery'?{email}:{email,create_user:true});return {sent:true,expiresIn:OTP_POLICY.expiresIn,retryAfter:OTP_POLICY.retryAfter};
  }
  function providerTokens(data){
    if(typeof data?.user?.id!=='string'||!data.access_token||!data.refresh_token||!Number.isFinite(data.expires_in)||data.expires_in<=0)throw fail('登录信息未能确认，请重新尝试',502);
    return {user:visible(data.user),access:data.access_token,refresh:data.refresh_token,accessExpiresAt:clock()+data.expires_in*1000};
  }
  async function createSession(data,passwordSetup=false){
    const token=randomBytes(32).toString('base64url'),setupToken=passwordSetup?randomBytes(32).toString('base64url'):null,row={...providerTokens(data),expiresAt:clock()+7*86400000,...(passwordSetup?{passwordSetupUntil:clock()+600000,passwordSetupHash:digest(setupToken)}:{})};
    await store.mutate(sessionKey(token),{},saved=>Object.assign(saved,row));return {token,user:row.user,...(passwordSetup?{passwordSetup:true,passwordSetupToken:setupToken}:{})};
  }
  async function verifyCode(value,code,purpose='login'){
    purpose=authPurpose(purpose);
    const email=normalizeAuthEmail(value);if(typeof code!=='string'||!/^\d{6,8}$/.test(code))throw fail('请输入邮件里的验证码');
    return createSession(await request('verify',{email,token:code,type:purpose==='recovery'?'recovery':'email'}),purpose!=='login');
  }
  async function signInPassword(value,password){
    const email=normalizeAuthEmail(value);validateAuthPassword(password);const now=clock(),emailKey=digest(email);
    await store.mutate('auth/limits/password',{requests:[]},row=>{
      row.requests=(row.requests||[]).filter(r=>now-r.time<600000);
      const attempts=row.requests.filter(r=>r.email===emailKey),limited=attempts.length>=10?attempts:row.requests.length>=200?row.requests:null;
      if(limited){const error=fail('登录尝试较多，请稍后再试，也可以使用验证码登录',429);error.retryAfter=Math.max(1,Math.ceil((limited[0].time+600000-now)/1000));throw error;}
      row.requests.push({email:emailKey,time:now});
    });
    // Passwords go directly to Supabase; application documents never contain them.
    // https://supabase.com/docs/guides/auth/passwords
    return createSession(await request('token?grant_type=password',{email,password}));
  }
  async function setPassword(token,password,setupToken){
    validateAuthPassword(password,true);const user=await userFor(token);if(!user)throw fail('请重新验证邮箱后设置密码',401);
    const path=sessionKey(token),claimId=randomBytes(16).toString('hex');
    const claimed=await store.mutate(path,{},saved=>{
      if(saved.revoked||saved.expiresAt<=clock()||saved.user?.id!==user.id)throw fail('请重新验证邮箱后设置密码',401);
      if(!validToken(setupToken)||saved.passwordSetupHash!==digest(setupToken))throw fail('这次邮箱验证与当前账户不一致，请重新验证',403);
      if(saved.passwordSetupClaim)throw fail('这次验证已用于保存密码，请尝试密码登录或重新验证邮箱',409);
      if(!saved.passwordSetupUntil||saved.passwordSetupUntil<=clock())throw fail('邮箱验证已过期，请重新验证后设置密码',403);
      const setupUntil=saved.passwordSetupUntil;
      // Consume before dispatch. An uncertain response must never reopen this proof.
      saved.passwordSetupClaim={id:claimId,dispatchedAt:clock()};delete saved.passwordSetupUntil;
      return {access:saved.access,userId:saved.user.id,setupUntil};
    });
    try{
      const current=await store.read(path,null);if(!current||current.revoked||current.passwordSetupClaim?.id!==claimId)throw fail('请重新验证邮箱后设置密码',401);
      const updated=await request('user',{password},claimed.access,'PUT');
      if(updated.id!==claimed.userId)throw fail('密码更新身份未能确认，请重新登录',502);
      await store.mutate(path,{},saved=>{if(saved.passwordSetupClaim?.id===claimId){delete saved.passwordSetupHash;delete saved.passwordSetupClaim;}});
      return {user:visible(updated),passwordUpdated:true};
    }catch(error){if(error.retryPasswordSetup)await store.mutate(path,{},saved=>{if(!saved.revoked&&saved.passwordSetupClaim?.id===claimId&&claimed.setupUntil>clock()){saved.passwordSetupUntil=claimed.setupUntil;delete saved.passwordSetupClaim;}});throw error;}
  }
  const transactionKey=token=>'auth/oauth/'+digest(token);
  async function beginOAuth(provider,next='/library'){
    if(!['google','apple'].includes(provider))throw fail('不支持这个登录方式',400);
    const returnTo=safeAuthReturn(next);if(!returnTo)throw fail('登录返回地址无效',400);
    if(!(await capabilities()).providers[provider])throw fail('这个登录方式正在准备中，请使用其他方式',503);
    const origin=env.READER_PUBLIC_ORIGIN;
    if(!origin?.startsWith('https://')||new URL(origin).origin!==origin)throw fail('正式登录地址尚未配置',503);
    const transactionToken=randomBytes(32).toString('base64url'),verifier=randomBytes(32).toString('base64url');
    await store.mutate(transactionKey(transactionToken),{},row=>Object.assign(row,{provider,next:returnTo,verifier,expiresAt:clock()+600000,consumed:false}));
    const url=new URL(base+'/auth/v1/authorize');url.search=new URLSearchParams({provider,redirect_to:origin+'/api/auth/callback',code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'s256'}).toString();
    return {transactionToken,authorizeUrl:url.href,expiresIn:600};
  }
  async function cancelOAuth(token){
    if(!validToken(token))return null;
    return store.mutate(transactionKey(token),{},row=>{const next=safeAuthReturn(row.next);row.consumed=true;delete row.verifier;return next;});
  }
  async function finishOAuth(token,code){
    if(!validToken(token)||typeof code!=='string'||!code||code.length>4096||/[\s\u0000-\u001f\u007f]/.test(code))throw fail('登录请求已失效，请重新尝试',400);
    const flow=await store.mutate(transactionKey(token),{},row=>{
      if(row.consumed||!row.verifier||row.expiresAt<=clock())throw fail('登录请求已失效，请重新尝试',400);
      const flow={verifier:row.verifier,next:row.next};row.consumed=true;delete row.verifier;return flow;
    });
    const session=await createSession(await request('token?grant_type=pkce',{auth_code:code,code_verifier:flow.verifier}));
    return {...session,next:safeAuthReturn(flow.next)||'/library'};
  }
  async function freshSession(token){
    const path=sessionKey(token),leaseId=randomBytes(16).toString('hex'),deadline=Date.now()+18000;
    while(Date.now()<deadline){
      const row=await store.read(path,null);if(!row||row.revoked||row.expiresAt<=clock())return null;
      if(row.accessExpiresAt>clock()+60000)return row;
      if(row.refreshLease?.expiresAt>clock()){await wait(50);continue;}
      const claim=await store.mutate(path,{},saved=>{
        if(saved.revoked||saved.expiresAt<=clock()||!saved.refresh)return {kind:'revoked'};
        if(saved.accessExpiresAt>clock()+60000)return {kind:'fresh',row:saved};
        if(saved.refreshLease?.expiresAt>clock())return {kind:'wait'};
        saved.refreshLease={id:leaseId,expiresAt:clock()+REFRESH_LEASE_MS};return {kind:'claimed',refresh:saved.refresh,userId:saved.user.id};
      });
      if(claim.kind==='revoked')return null;
      if(claim.kind==='fresh')return claim.row;
      if(claim.kind==='wait'){await wait(50);continue;}
      const lease=await store.read(path,null);
      if(!lease||lease.revoked||lease.expiresAt<=clock())return null;
      if(lease.accessExpiresAt>clock()+60000||lease.refreshLease?.id!==leaseId)continue;
      if(lease.refreshLease.expiresAt<=clock()+REFRESH_DISPATCH_BUDGET_MS){
        await store.mutate(path,{},saved=>{if(saved.refreshLease?.id===leaseId)delete saved.refreshLease;});
        throw fail('登录更新暂时较慢，请稍后重试',503);
      }
      try{
        const updated=providerTokens(await request('token?grant_type=refresh_token',{refresh_token:claim.refresh}));
        if(updated.user.id!==claim.userId)throw fail('登录身份无法确认，请重新进入',401);
        return await store.mutate(path,{},saved=>{
          if(saved.revoked||saved.expiresAt<=clock()||saved.refreshLease?.id!==leaseId)return null;
          Object.assign(saved,updated);delete saved.refreshLease;return saved;
        });
      }catch(error){
        await store.mutate(path,{},saved=>{if(saved.refreshLease?.id===leaseId){delete saved.refreshLease;if(error.status===401){saved.revoked=true;delete saved.access;delete saved.refresh;}}});
        if(error.status===401)return null;throw error;
      }
    }
    throw fail('另一处正在更新登录，请稍后重试',503);
  }
  async function userFor(token){
    if(!validToken(token))return null;const row=await freshSession(token);if(!row)return null;
    try{
      const user=await request('user',null,row.access),current=await store.read(sessionKey(token),null);
      return current&&!current.revoked&&current.expiresAt>clock()&&user.id===current.user.id?visible(user):null;
    }catch(error){if(error.status===401)return null;throw error;}
  }
  async function logout(token){
    if(!validToken(token))return;
    const access=await store.mutate(sessionKey(token),{},saved=>{const access=saved.access;saved.revoked=true;delete saved.access;delete saved.refresh;delete saved.refreshLease;return access;});
    if(access)await request('logout?scope=local',{},access).catch(()=>{});
  }
  return {requestCode,verifyCode,signInPassword,setPassword,userFor,logout,capabilities,beginOAuth,finishOAuth,cancelOAuth,emailAvailable:env.READER_EMAIL_ENABLED==='true'};
}
