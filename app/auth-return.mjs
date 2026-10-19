// Shared, server-safe auth destinations. No browser runtime or user data is
// consulted here; callers explicitly supply the effective UI locale.
import {safeReaderReturn,safeGiftReturn} from './reader-return.mjs';
import {safeLibraryReturn} from './library-view-state.mjs';
import {parseUiParam,readUiParam,withUiParam} from './ui-locale-codec.mjs';

export function safeAuthReturn(value){
  if(typeof value!=='string'||value.length>1500||/[\u0000-\u001f\u007f\\]/.test(value)||!value.startsWith('/')||value.startsWith('//'))return null;
  if(!['absent','valid'].includes(readUiParam(value).status))return null;
  return safeReaderReturn(value)||safeGiftReturn(value)||safeLibraryReturn(value);
}

export function authEntryReturn(search){
  const query=new URLSearchParams(search),outer=parseUiParam(query);
  if(!['absent','valid'].includes(outer.status)||query.getAll('next').length!==1)return null;
  const next=safeAuthReturn(query.get('next'));if(!next)return null;
  const inner=readUiParam(next);
  if(outer.code&&inner.code&&outer.code!==inner.code)return null;
  return outer.code?withUiParam(next,outer.code):next;
}

export function authFailureReturn(value,errorCode){
  const next=safeAuthReturn(value),query=new URLSearchParams({login:'1',auth_error:['cancelled','expired','unavailable'].includes(errorCode)?errorCode:'expired'});
  if(next){
    const ui=readUiParam(next).code;if(ui)query.set('ui',ui);
    const parsed=new URL(next,'https://auth-return.invalid');
    // Keep the existing upload-entry shape, including its one explicit ui.
    if(parsed.pathname==='/library'&&parsed.searchParams.get('upload')==='1'&&[...parsed.searchParams.keys()].every(key=>['upload','ui'].includes(key)))query.set('upload','1');
    else if(next!=='/library')query.set('next',next);
  }
  return '/library?'+query;
}
