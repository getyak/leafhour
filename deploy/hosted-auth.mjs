import {randomBytes} from 'node:crypto';
import {digest,fail} from '../server/document-import.mjs';

export function createHostedAuth({store,env=process.env,fetcher=fetch,clock=Date.now}={}){
  const base=env.SUPABASE_URL?.replace(/\/$/,''),key=env.SUPABASE_PUBLISHABLE_KEY;
  if(!base||!key)throw fail('邮箱登录尚未配置',503);
  const emailOf=value=>{if(typeof value!=='string'||value.length>254||!/^\S+@[^\s@]+\.[^\s@]+$/.test(value.trim()))throw fail('请输入有效的邮箱地址');return value.trim().toLowerCase();};
  async function request(route,body,access){
    const response=await fetcher(base+'/auth/v1/'+route,{method:body?'POST':'GET',headers:{apikey:key,'Content-Type':'application/json',...(access?{Authorization:'Bearer '+access}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(15000)});
    const data=await response.json();if(!response.ok)throw fail(response.status===429?'验证码请求较多，请稍后再试':route==='otp'?'验证码邮件未能发出，请稍后重试':'登录已失效，请重新验证邮箱',response.status===429?429:400);return data;
  }
  const sessionKey=token=>'auth/sessions/'+digest(token);
  const visible=user=>({id:user.id,email:user.email,kind:'email'});
  async function requestCode(value){if(env.READER_EMAIL_ENABLED!=='true')throw fail('邮箱登录正在准备中。你可以先试读公版书。',503);const email=emailOf(value);await request('otp',{email,create_user:true});return {sent:true,expiresIn:600};}
  async function verifyCode(value,code){
    const email=emailOf(value);if(typeof code!=='string'||!/^\d{6,8}$/.test(code))throw fail('请输入邮件里的验证码');
    const data=await request('verify',{email,token:code,type:'email'});
    if(!data.user?.id||!data.access_token||!data.refresh_token)throw fail('邮箱验证未完成，请重新获取验证码',502);
    const token=randomBytes(32).toString('base64url'),row={user:visible(data.user),access:data.access_token,refresh:data.refresh_token,accessExpiresAt:clock()+data.expires_in*1000,expiresAt:clock()+7*86400000};
    await store.mutate(sessionKey(token),{},saved=>Object.assign(saved,row));return {token,user:row.user};
  }
  async function userFor(token){
    if(typeof token!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(token))return null;
    let row=await store.read(sessionKey(token),null);if(!row||row.revoked||row.expiresAt<=clock())return null;
    if(row.accessExpiresAt<=clock()+60000){
      let refreshed;try{refreshed=await request('token?grant_type=refresh_token',{refresh_token:row.refresh});}catch{return null;}
      if(refreshed.user?.id!==row.user.id||!refreshed.access_token||!refreshed.refresh_token)return null;
      row=await store.mutate(sessionKey(token),{},saved=>{if(saved.revoked||saved.expiresAt<=clock())return null;Object.assign(saved,{access:refreshed.access_token,refresh:refreshed.refresh_token,accessExpiresAt:clock()+refreshed.expires_in*1000});return saved;});if(!row)return null;
    }
    try{const user=await request('user',null,row.access);return user.id===row.user.id?visible(user):null;}catch{return null;}
  }
  async function logout(token){if(typeof token!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(token))return;await store.mutate(sessionKey(token),{},saved=>{saved.revoked=true;delete saved.access;delete saved.refresh;});}
  return {requestCode,verifyCode,userFor,logout,emailAvailable:env.READER_EMAIL_ENABLED==='true'};
}
