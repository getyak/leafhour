import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import path from 'node:path';
import {randomBytes,randomInt,randomUUID} from 'node:crypto';
import {digest,fail} from './document-import.mjs';

export async function smtpSender(env=process.env){
  if(!env.READER_SMTP_HOST||!env.READER_SMTP_FROM)return null;
  const {default:nodemailer}=await import('nodemailer');
  const transport=nodemailer.createTransport({host:env.READER_SMTP_HOST,port:Number(env.READER_SMTP_PORT||587),secure:env.READER_SMTP_SECURE==='true',requireTLS:env.READER_SMTP_SECURE!=='true',connectionTimeout:10000,socketTimeout:15000,...(env.READER_SMTP_USER?{auth:{user:env.READER_SMTP_USER,pass:env.READER_SMTP_PASSWORD}}:{})});
  return async(email,code)=>{await transport.sendMail({from:env.READER_SMTP_FROM,to:email,subject:'旁读 · 你的登录验证码',text:`你的旁读验证码是 ${code}。\n\n10 分钟内有效，只能使用一次。首次验证后会建立你的私人书房。\n如果不是你发起的请求，可以忽略这封邮件。`});};
}

export async function createEmailAuth({dataDir,sendCode=null,clock=Date.now}={}){
  await mkdir(dataDir,{recursive:true,mode:0o700});const file=path.join(dataDir,'auth.json');let queue=Promise.resolve();
  const read=async()=>{try{return JSON.parse(await readFile(file,'utf8'));}catch(e){if(e.code==='ENOENT')return {codes:{},sessions:[]};throw e;}};
  const mutate=operation=>{const work=queue.catch(()=>{}).then(async()=>{const data=await read(),result=await operation(data);const pending=file+'.pending';await writeFile(pending,JSON.stringify(data),{mode:0o600});await rename(pending,file);return result;});queue=work;return work;};
  const emailOf=value=>{if(typeof value!=='string'||value.length>254||!/^\S+@[^\s@]+\.[^\s@]+$/.test(value.trim()))throw fail('请输入有效的邮箱地址');return value.trim().toLowerCase();};
  const session=(data,user)=>{const token=randomBytes(32).toString('base64url');data.sessions=data.sessions.filter(s=>s.expiresAt>clock());data.sessions.push({tokenHash:digest(token),user,expiresAt:clock()+7*86400000});return {token,user};};
  async function requestCode(value){
    const email=emailOf(value);if(!sendCode)throw fail('邮箱服务尚未配置。现在可以试读，或进入本机书房。',503);
    return mutate(async data=>{
      const key=digest(email),old=data.codes[key];if(old&&clock()-old.requestedAt<60000)throw fail('请一分钟后再获取验证码',429);
      // A global hourly ceiling also prevents address-cycling mail floods.
      data.requests=(data.requests||[]).filter(time=>clock()-time<3600000);if(data.requests.length>=30)throw fail('验证码请求较多，请稍后再试',429);
      const code=String(randomInt(100000,1000000)),salt=randomBytes(16).toString('hex');
      try{await sendCode(email,code);}catch{throw fail('邮件暂时未能发出，请稍后再试',502);}
      for(const [id,row] of Object.entries(data.codes))if(row.expiresAt<clock())delete data.codes[id];
      data.codes[key]={salt,codeHash:digest(salt+code),requestedAt:clock(),expiresAt:clock()+600000,attempts:0};data.requests.push(clock());return {sent:true,expiresIn:600};
    });
  }
  async function verifyCode(value,code){
    const email=emailOf(value);if(typeof code!=='string'||!/^\d{6}$/.test(code))throw fail('请输入邮件里的六位验证码');
    // Persist failed attempts before returning an error, including across process restarts.
    const result=await mutate(data=>{const key=digest(email),row=data.codes[key];if(!row||row.expiresAt<=clock()||row.attempts>=5)return {error:true};row.attempts++;if(row.codeHash!==digest(row.salt+code))return {error:true};delete data.codes[key];return session(data,{id:'email-'+digest(email),email,kind:'email'});});
    if(result.error)throw fail('验证码不正确或已过期，请重新获取');return result;
  }
  async function localSession(){return mutate(data=>session(data,{id:'local-owner',email:null,kind:'local'}));}
  async function userFor(token){if(typeof token!=='string'||token.length>128)return null;await queue.catch(()=>{});return (await read()).sessions.find(s=>s.tokenHash===digest(token)&&s.expiresAt>clock())?.user||null;}
  async function logout(token){return mutate(data=>{data.sessions=data.sessions.filter(s=>s.tokenHash!==digest(token||''));});}
  return {requestCode,verifyCode,localSession,userFor,logout,emailAvailable:!!sendCode};
}
