import {fail} from './document-import.mjs';
import {authMessageId} from '../app/auth-errors.mjs';
export const authFailure=(messageId,message,status=400)=>Object.assign(fail(message,status),{messageId:authMessageId(messageId)||'auth.error.generic'});

export const OTP_POLICY=Object.freeze({digits:6,expiresIn:600,retryAfter:60});
export function authPurpose(value='login'){
  if(!['login','signup','recovery'].includes(value))throw authFailure("auth.error.generic",'这个邮箱验证用途无效');
  return value;
}
export function validateAuthPassword(value,newPassword=false){
  if(typeof value!=='string'||value.length<(newPassword?8:1)||value.length>1024||value.includes('\u0000'))throw authFailure((newPassword?"auth.error.passwordLength":"auth.error.passwordMissing"),newPassword?'请设置至少 8 个字符的密码':'请输入密码');
  return value;
}
export function normalizeAuthEmail(value){
  if(typeof value!=='string'||value.length>254||/[\u0000-\u001f\u007f]/.test(value)||! /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()))throw authFailure("auth.error.emailInvalid",'请输入有效的邮箱地址');
  return value.trim().toLowerCase();
}
export {safeAuthReturn} from '../app/auth-return.mjs';
