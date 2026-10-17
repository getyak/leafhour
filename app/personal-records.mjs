const fail=(message,status=400)=>Object.assign(Error(message),{status});
const editId=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(value);
const date=value=>typeof value==='string'&&Number.isFinite(Date.parse(value));
export const personalRecordRevision=record=>Number.isSafeInteger(record?.revision)&&record.revision>=0?record.revision:0;
export function decodePersonalRecordId(value){try{return decodeURIComponent(value);}catch{throw fail('记录标识不正确');}}

export function validatePersonalRecordMetadata(record){
  if(record.revision!==undefined&&(!Number.isSafeInteger(record.revision)||record.revision<0)||record.updatedAt!==undefined&&!date(record.updatedAt)||personalRecordRevision(record)>0&&(!date(record.updatedAt)||!editId(record.lastEditId))||record.lastEditId!==undefined&&(!editId(record.lastEditId)||personalRecordRevision(record)<1||!date(record.updatedAt)))throw fail('个人记录的修改版本或时间不正确');
  return {revision:personalRecordRevision(record),updatedAt:record.updatedAt||record.createdAt};
}

export function personalRecordAnchor(record,book){
  if(!record||!book||record.bookId!==undefined&&record.bookId!==book.bookId||record.contentVersion!==book.contentVersion)return null;
  const section=book.sections.find(s=>s.paragraphs.some(p=>p.id===record.passageId));
  return section?{passageId:record.passageId,chapterId:section.chapterId,section:section.number}:null;
}

// A separate edit command preserves create/retry idempotence and immutable sources.
export function applyPersonalRecordEdit(record,input,book,now=new Date().toISOString()){
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>!['text','contentVersion','baseRevision','editId'].includes(key))||typeof input.text!=='string'||!input.text.trim()||input.text.length>2000||!input.text.isWellFormed()||typeof input.contentVersion!=='string'||!input.contentVersion||!Number.isSafeInteger(input.baseRevision)||input.baseRevision<0||!editId(input.editId))throw fail('请提交不超过 2,000 字的原话与当前修改版本');
  if(!record||record.origin!=='user')throw fail('找不到自己的这条记录',404);
  if(!personalRecordAnchor(record,book)||input.contentVersion!==record.contentVersion)throw fail('原文位置待确认，原话与引用已保留',409);
  const {revision}=validatePersonalRecordMetadata(record);
  if(record.lastEditId===input.editId){
    if(input.baseRevision+1===revision&&record.text===input.text)return record;
    throw fail('这次修改标识已被使用，请重新读取原话',409);
  }
  if(input.baseRevision!==revision)throw fail('这条原话已在另一处修改，请先读取较新版本；当前草稿仍保留',409);
  if(revision>=Number.MAX_SAFE_INTEGER)throw fail('修改版本已超过可保存范围，请先导出记录',409);
  if(!date(now))throw fail('修改时间不正确');
  Object.assign(record,{text:input.text,revision:revision+1,updatedAt:now,lastEditId:input.editId});
  return record;
}
