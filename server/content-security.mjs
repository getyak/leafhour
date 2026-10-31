import {createHash} from 'node:crypto';
import {READER_CRITICAL_CSS} from './reader-shell.mjs';
import {UI_FIRST_PAINT_SCRIPT} from './ui-first-paint-script.mjs';
import {canonicalUiEntryPath} from '../app/ui-first-paint-codec.mjs';
const base="default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data: https: blob:; media-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'";
const checkout=base.replace("script-src 'self'","script-src 'self' https://www.creem.io").replace("style-src 'self'","style-src 'self' 'unsafe-inline'")+"; frame-src 'self' https://creem.io https://*.creem.io";

const firstPaint=base.replace("script-src 'self'", "script-src 'self' 'sha256-"+createHash('sha256').update(UI_FIRST_PAINT_SCRIPT).digest('base64')+"'");
const reader=firstPaint.replace("style-src 'self'", "style-src 'self' 'sha256-"+createHash('sha256').update(READER_CRITICAL_CSS).digest('base64')+"'");

// Other pages keep the existing self-only script/style policy. Card fields and
// bank authentication live in the payment provider's cross-origin frame.
function uploadConnections(policy,env){
 try{
  const url=new URL(env?.SUPABASE_URL);
  if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||url.pathname!=='/'||url.hostname.includes('*'))return policy;
  return policy.replace("connect-src 'self'", "connect-src 'self' "+url.origin);
 }catch{return policy;}
}
export function contentSecurityPolicy(pathname='',env=process.env){
 pathname=canonicalUiEntryPath(pathname)||pathname;
 if(pathname==='/read'||pathname==='/read.html')return uploadConnections(reader,env);
 if(pathname==='/'||pathname==='/library'||pathname==='/library.html')return uploadConnections(firstPaint,env);
 return /^\/(?:(?:en|zh-hans|zh-hant|ja)\/)?pricing(?:\.html|\/index\.html|\/)?$/.test(pathname)||/^\/billing(?:\.html|\/)?$/.test(pathname)?checkout:base;
}
