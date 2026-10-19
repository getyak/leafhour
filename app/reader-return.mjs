import {parseUiParam,isUiLocale} from './ui-locale-codec.mjs';

const bookKey=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(value);
const passageKey=value=>typeof value==='string'&&/^[A-Za-z0-9_.:-]{1,256}$/.test(value);
const versionKey=value=>typeof value==='string'&&value.length>0&&value.length<=256&&value.isWellFormed()&&!/[\u0000-\u001f\u007f]/.test(value);
const layerKey=value=>['original','literal','interpretive'].includes(value);
const citationError=message=>Object.assign(Error(message),{code:'READER_CITATION_INVALID'});
const noteKey=value=>['comment','question','records'].includes(value);
export function safeGiftReturn(value){
  if(typeof value!=='string'||value.length>1500||!/^\/gift\/[A-Za-z0-9_-]{43}(?:\?[^?#\u0000-\u0020\u007f\\]*)?$/.test(value))return null;
  const queryAt=value.indexOf('?'),pathname=queryAt<0?value:value.slice(0,queryAt),search=queryAt<0?'':value.slice(queryAt+1),query=new URLSearchParams(search),ui=parseUiParam(query);
  if([...query.keys()].some(key=>key!=='ui')||!['absent','valid'].includes(ui.status))return null;
  return pathname+(ui.code?'?'+new URLSearchParams({ui:ui.code}):'');
}
export function safeReaderReturn(value){
  if(typeof value!=='string'||value.length>1500||!value.startsWith('/')||value.startsWith('//'))return null;
  let url;try{url=new URL(value,'http://reader.local');}catch{return null;}
  const book=url.searchParams.get('book');if(url.origin!=='http://reader.local'||url.pathname!=='/read'||!bookKey(book))return null;
  for(const key of ['book','passage','contentVersion','layer'])if(url.searchParams.getAll(key).length>1)return null;
  if(url.searchParams.has('contentVersion')&&!versionKey(url.searchParams.get('contentVersion'))||url.searchParams.has('layer')&&!layerKey(url.searchParams.get('layer')))return null;
  // GET-192: the safe reader return carries exactly one validated ui. Duplicate,
  // conflicting or unsupported values reject the whole target instead of
  // broadening it; book/passage/version/layer semantics stay untouched.
  const ui=parseUiParam(url.searchParams);
  if(['duplicate','conflict','unsupported','invalid'].includes(ui.status))return null;
  const query=new URLSearchParams({book}),passage=url.searchParams.get('passage'),note=url.searchParams.get('note');
  if(passageKey(passage)){query.set('passage',passage);if(noteKey(note))query.set('note',note);else if(url.searchParams.get('action')==='translate')query.set('action','translate');}
  if(passageKey(passage))for(const key of ['contentVersion','layer'])if(url.searchParams.has(key))query.set(key,url.searchParams.get(key));
  if(ui.status==='valid')query.set('ui',ui.code);
  return '/read?'+query;
}
export function readerLoginUrl({bookId,passageId,note,action,contentVersion,layer,ui}={}){
  const query=new URLSearchParams({book:bookId});if(passageId)query.set('passage',passageId);if(note)query.set('note',note);if(action)query.set('action',action);
  if(contentVersion!==undefined)query.set('contentVersion',contentVersion);if(layer!==undefined)query.set('layer',layer);
  const code=isUiLocale(ui)?ui:null;
  if(code)query.set('ui',code);
  const next=safeReaderReturn('/read?'+query),login=new URLSearchParams({login:'1'});
  // The outer login URL and the inner safe next carry the same one validated ui.
  if(next){login.set('next',next);if(code)login.set('ui',code);}
  return '/library?'+login;
}
export function resolveReaderEntry(book,query){
  if(query.get('book')!==book.bookId)return null;const id=query.get('passage'),version=query.get('contentVersion'),layer=query.get('layer'),cited=query.has('contentVersion')||query.has('layer');
  if(cited){for(const key of ['book','passage','contentVersion','layer'])if(query.getAll(key).length>1)throw citationError('引用参数重复，请从 Agent 重新打开引用。');if(query.has('contentVersion')&&(!versionKey(version)||version!==book.contentVersion))throw citationError('引用的来源版本与当前书籍不同，请让 Agent 重新读取当前目录后打开引用。');if(query.has('layer')&&!layerKey(layer))throw citationError('引用的文本层无效，请从 Agent 重新打开引用。');}
  for(const section of book.sections)if(section.paragraphs.some(p=>p.id===id)){const note=noteKey(query.get('note'))?query.get('note'):null;return {chapterId:section.chapterId,passageId:id,offset:160,note,...(version?{contentVersion:version}:{}),...(layer?{layer,mode:layer==='original'?'en':'zh',...(layer==='original'?{}:{variant:layer})}:{}),...(!note&&query.get('action')==='translate'?{action:'translate'}:{})};}
  if(cited)throw citationError('引用段落已无法对应当前书籍，请让 Agent 重新读取当前目录。');
  return null;
}
