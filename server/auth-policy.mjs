import {fail} from './document-import.mjs';
import {safeReaderReturn,safeGiftReturn} from '../app/reader-return.mjs';
import {safeLibraryReturn} from '../app/library-view-state.mjs';

export const OTP_POLICY=Object.freeze({digits:6,expiresIn:600,retryAfter:60});
export function authPurpose(value='login'){
  if(!['login','signup','recovery'].includes(value))throw fail('这个邮箱验证用途无效');
  return value;
}
export function validateAuthPassword(value,newPassword=false){
  if(typeof value!=='string'||value.length<(newPassword?8:1)||value.length>1024||value.includes('\u0000'))throw fail(newPassword?'请设置至少 8 个字符的密码':'请输入密码');
  return value;
}
export function normalizeAuthEmail(value){
  if(typeof value!=='string'||value.length>254||/[\u0000-\u001f\u007f]/.test(value)||! /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()))throw fail('请输入有效的邮箱地址');
  return value.trim().toLowerCase();
}
export function safeAuthReturn(value){
  if(typeof value!=='string'||value.length>1500||/[\u0000-\u001f\u007f\\]/.test(value)||!value.startsWith('/')||value.startsWith('//'))return null;
  const reader=safeReaderReturn(value)||safeGiftReturn(value);if(reader)return reader;
  // GET-179: the bounded library return codec keeps owned safe view/overlay
  // keys through OAuth; unknown parameters are dropped, never approved.
  return safeLibraryReturn(value);
}
