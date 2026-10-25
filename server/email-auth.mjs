import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import path from 'node:path';
import {randomBytes,randomInt,randomUUID} from 'node:crypto';
import {digest} from './document-import.mjs';
import {normalizeAuthEmail,OTP_POLICY,authFailure} from './auth-policy.mjs';

export async function smtpSender(env=process.env){
  if(!env.READER_SMTP_HOST||!env.READER_SMTP_FROM)return null;
  const {default:nodemailer}=await import('nodemailer');
  const transport=nodemailer.createTransport({host:env.READER_SMTP_HOST,port:Number(env.READER_SMTP_PORT||587),secure:env.READER_SMTP_SECURE==='true',requireTLS:env.READER_SMTP_SECURE!=='true',connectionTimeout:10000,socketTimeout:15000,...(env.READER_SMTP_USER?{auth:{user:env.READER_SMTP_USER,pass:env.READER_SMTP_PASSWORD}}:{})});
  return async(email,code)=>{await transport.sendMail({from:env.READER_SMTP_FROM,to:email,subject:'Leafhour · Your verification code / 邮箱验证码',text:`Your Leafhour verification code is ${code}.\n\nEnter it only in the Leafhour window where you requested this code. It expires in 10 minutes and can be used once. Keep it private.\nIf you didn't request this code, you can ignore this email.\n\n你的 Leafhour 邮箱验证码是 ${code}。\n请在你发起请求的 Leafhour 页面输入。验证码 10 分钟内有效，只能使用一次。请勿转发给他人。\n如果不是你发起的请求，可以忽略这封邮件。\n\nhttps://leafhour.com`});};
}

export async function createEmailAuth({dataDir,sendCode=null,clock=Date.now}={}){
  await mkdir(dataDir,{recursive:true,mode:0o700});const file=path.join(dataDir,'auth.json');let queue=Promise.resolve();
  const read=async()=>{try{return JSON.parse(await readFile(file,'utf8'));}catch(e){if(e.code==='ENOENT')return {codes:{},sessions:[]};throw e;}};
  const mutate=operation=>{const work=queue.catch(()=>{}).then(async()=>{const data=await read(),result=await operation(data);const pending=file+'.pending';await writeFile(pending,JSON.stringify(data),{mode:0o600});await rename(pending,file);return result;});queue=work;return work;};
  const emailOf=normalizeAuthEmail;
  const session=(data,user)=>{const token=randomBytes(32).toString('base64url');data.sessions=data.sessions.filter(s=>s.expiresAt>clock());data.sessions.push({tokenHash:digest(token),user,expiresAt:clock()+7*86400000});return {token,user};};
  async function requestCode(value){
    const email=emailOf(value);if(!sendCode)throw authFailure("auth.error.emailUnconfigured",'邮箱服务尚未配置。现在可以试读，或进入本机书房。',503);
    return mutate(async data=>{
      const key=digest(email),old=data.codes[key];if(old&&clock()-old.requestedAt<60000)throw authFailure("auth.error.codeWaitMinute",'请一分钟后再获取验证码',429);
      // A global hourly ceiling also prevents address-cycling mail floods.
      data.requests=(data.requests||[]).filter(time=>clock()-time<3600000);if(data.requests.length>=30)throw authFailure("auth.error.codeLimited",'验证码请求较多，请稍后再试',429);
      const code=String(randomInt(100000,1000000)),salt=randomBytes(16).toString('hex');
      try{await sendCode(email,code);}catch{throw authFailure("auth.error.mailFailed",'邮件暂时未能发出，请稍后再试',502);}
      for(const [id,row] of Object.entries(data.codes))if(row.expiresAt<clock())delete data.codes[id];
      data.codes[key]={salt,codeHash:digest(salt+code),requestedAt:clock(),expiresAt:clock()+600000,attempts:0};data.requests.push(clock());return {sent:true,expiresIn:600,retryAfter:60};
    });
  }
  async function verifyCode(value,code){
    const email=emailOf(value);if(typeof code!=='string'||!/^\d{6}$/.test(code))throw authFailure("auth.error.codeSixDigits",'请输入邮件里的六位验证码');
    // Persist failed attempts before returning an error, including across process restarts.
    const result=await mutate(data=>{const key=digest(email),row=data.codes[key];if(!row||row.expiresAt<=clock()||row.attempts>=5)return {error:true};row.attempts++;if(row.codeHash!==digest(row.salt+code))return {error:true};delete data.codes[key];return session(data,{id:'email-'+digest(email),email,kind:'email'});});
    if(result.error)throw authFailure("auth.error.codeInvalid",'验证码不正确或已过期，请重新获取');return result;
  }
  async function localSession(){return mutate(data=>session(data,{id:'local-owner',email:null,kind:'local'}));}
  async function userFor(token){if(typeof token!=='string'||token.length>128)return null;await queue.catch(()=>{});return (await read()).sessions.find(s=>s.tokenHash===digest(token)&&s.expiresAt>clock())?.user||null;}
  async function logout(token,{expectedOwner}={}){return mutate(data=>{const row=data.sessions.find(s=>s.tokenHash===digest(token||''));if(expectedOwner&&row?.user?.id&&row.user.id!==expectedOwner)throw Object.assign(authFailure("auth.error.generic",'账户已切换，请重新进入书房。原账户草稿仍留在原处。',409),{readerSessionChanged:true});data.sessions=data.sessions.filter(s=>s.tokenHash!==digest(token||''));});}
  return {requestCode,verifyCode,localSession,userFor,logout,capabilities:async()=>({email:!!sendCode,providers:{google:false,apple:false},otp:{...OTP_POLICY}}),emailAvailable:!!sendCode};
}
