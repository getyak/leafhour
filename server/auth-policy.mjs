import {fail} from './document-import.mjs';
import {safeReaderReturn} from '../app/reader-return.mjs';

export const OTP_POLICY=Object.freeze({digits:6,expiresIn:600,retryAfter:60});
export function normalizeAuthEmail(value){
  if(typeof value!=='string'||value.length>254||/[\u0000-\u001f\u007f]/.test(value)||! /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()))throw fail('请输入有效的邮箱地址');
  return value.trim().toLowerCase();
}
export function safeAuthReturn(value){
  if(typeof value!=='string'||value.length>1500||/[\u0000-\u001f\u007f\\]/.test(value)||!value.startsWith('/')||value.startsWith('//'))return null;
  const reader=safeReaderReturn(value);if(reader)return reader;
  let url;try{url=new URL(value,'https://reader.invalid');}catch{return null;}
  if(url.origin!=='https://reader.invalid'||url.pathname!=='/library'||value.split('?')[0]!=='/library')return null;
  return url.searchParams.get('upload')==='1'?'/library?upload=1':'/library';
}
