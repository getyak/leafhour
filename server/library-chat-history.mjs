import path from 'node:path';
import {createHash} from 'node:crypto';
import {invalid} from './experience-validation.mjs';
import {valueEqual} from '../app/portable-chat.mjs';
import {LIBRARY_CHAT_ID,LIBRARY_CHAT_VERSION,LIBRARY_CHAT_PASSAGE} from '../app/library-chat-context.mjs';

const digest=value=>createHash('sha256').update(value).digest('hex');
const safeId=value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/.test(value);
const failed=()=>{throw invalid('对话归档暂时无法安全读取，请保留已有记录后重试',409);};

// Each terminal receipt is immutable. The small owner index contains IDs only;
// message payloads remain in separate files while the active window stays bounded.
export function createLibraryChatHistory({read,mutate,ownerDir,publicTurn}){
 const directory=user=>path.join(ownerDir(user),'account-history');
 const receiptPath=(user,id)=>path.join(directory(user),digest(id)+'.json');
 const indexPath=user=>path.join(directory(user),'index.json');
 const emptyIndex=user=>({kind:'leafhour-library-chat-index',schemaVersion:1,ownerId:user.id,conversationId:LIBRARY_CHAT_ID,ids:[]});
 function validateTurn(turn,id){
  if(!turn||turn.id!==id||!safeId(id)||turn.origin!=='user'||!['completed','failed','cancelled'].includes(turn.status)||turn.contentVersion!==LIBRARY_CHAT_VERSION||turn.passageId!==LIBRARY_CHAT_PASSAGE||turn.scopeRevision!==0||typeof turn.text!=='string'||!turn.text.trim()||turn.text.length>2000||!turn.text.isWellFormed()||!Number.isFinite(Date.parse(turn.createdAt))||turn.quote!==undefined||turn.peopleWrites===true||turn.preferenceWrites===true)failed();
  if(turn.status==='completed'?turn.answer?.kind!=='conversation'||typeof turn.answer.summary!=='string'||!turn.answer.summary.trim()||turn.answer.summary.length>12000:turn.answer!==null)failed();
  if(!valueEqual(publicTurn(turn),turn))failed();
  return turn;
 }
 function validateReceipt(user,id,data){
  if(!data||data.kind!=='leafhour-library-chat-receipt'||data.schemaVersion!==1||data.ownerId!==user.id||data.conversationId!==LIBRARY_CHAT_ID||Object.keys(data).some(k=>!['kind','schemaVersion','ownerId','conversationId','turn'].includes(k)))failed();
  return validateTurn(data.turn,id);
 }
 function validateIndex(user,data){
  if(!data||data.kind!=='leafhour-library-chat-index'||data.schemaVersion!==1||data.ownerId!==user.id||data.conversationId!==LIBRARY_CHAT_ID||!Array.isArray(data.ids)||data.ids.some(id=>!safeId(id))||new Set(data.ids).size!==data.ids.length||Object.keys(data).some(k=>!['kind','schemaVersion','ownerId','conversationId','ids'].includes(k)))failed();
  return data;
 }
 async function find(user,id){
  if(!safeId(id))throw invalid('提问标识不正确');
  const saved=await read(receiptPath(user,id),null);
  return saved===null?null:structuredClone(validateReceipt(user,id,saved));
 }
 async function archive(user,turns){
  for(const turn of turns){
   validateTurn(turn,turn.id);
   const envelope={kind:'leafhour-library-chat-receipt',schemaVersion:1,ownerId:user.id,conversationId:LIBRARY_CHAT_ID,turn};
   // No writes occur inside a CAS callback except its own transaction. A retry
   // can only confirm the exact same receipt, never replace an existing one.
   await mutate(receiptPath(user,turn.id),envelope,data=>{const old=validateReceipt(user,turn.id,data);if(!valueEqual(old,turn))failed();return null;});
  }
  // Receipts precede the index, which precedes removal from the active window.
  // Every crash leaves either an active copy or an indexed immutable receipt.
  await mutate(indexPath(user),emptyIndex(user),data=>{validateIndex(user,data);for(const turn of turns)if(!data.ids.includes(turn.id))data.ids.push(turn.id);return null;});
 }
 async function all(user){
  const index=validateIndex(user,await read(indexPath(user),emptyIndex(user))),turns=[];
  for(const id of index.ids){const turn=await find(user,id);if(!turn)failed();turns.push(turn);}
  return turns;
 }
 return {find,archive,all};
}
