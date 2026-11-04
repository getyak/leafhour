const invalid=(message,status=400)=>{throw Object.assign(Error(message),{status});};
const normalizeChatReplyTarget=value=>{if(!value||!['user','assistant'].includes(value.role)||typeof value.turnId!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value.turnId))invalid('消息表情归属不正确');return {turnId:value.turnId,role:value.role};};
const normalizeChatReplyReference=value=>{const target=normalizeChatReplyTarget(value);if(typeof value.text!=='string'||!value.text.trim()||!value.text.isWellFormed())invalid('消息表情内容不完整');return {...target,text:value.text};};
function resolveChatReplyReference(target,turn,version){
 if(!turn)invalid('找不到所标记的消息，请重新选择',404);
 if(turn.contentVersion!==version)invalid('所标记消息属于其他原文版本，请重新选择',409);
 const text=target.role==='user'&&turn.kind!=='companion'?turn.text:target.role==='assistant'&&turn.status==='completed'?turn.answer?.summary:null;
 if(typeof text!=='string'||!text.trim())invalid('这条消息尚不可标记，请重新选择',409);
 return {...target,text};
}
export const CHAT_REACTIONS=Object.freeze(['❤️','👍','💡','🤔','🌱','🎉']);
const fail=()=>{throw Object.assign(Error('消息表情格式不正确'),{status:400});};
// Targets never carry client-supplied message text. The service resolves within
// the authenticated owner's captured conversation before a model sees them.
export function normalizeChatReactionTargets(value){
 if(!Array.isArray(value))fail();
 const keys=new Set();return value.map(row=>{
  if(!row||typeof row!=='object'||Object.keys(row).some(k=>!['turnId','role','emoji'].includes(k))||!CHAT_REACTIONS.includes(row.emoji))fail();
  const target=normalizeChatReplyTarget({turnId:row.turnId,role:row.role}),key=target.turnId+':'+target.role;if(keys.has(key))fail();keys.add(key);
  return {...target,emoji:row.emoji};
 });
}
export function normalizeResolvedChatReactions(value){
 if(!Array.isArray(value))fail();
 return value.map(row=>{if(!CHAT_REACTIONS.includes(row?.emoji))fail();return {...normalizeChatReplyReference({turnId:row.turnId,role:row.role,text:row.text}),emoji:row.emoji};});
}
export async function resolveChatReactions(value,find,version){
 const out=[];for(const row of normalizeChatReactionTargets(value)){const source=await find(row.turnId);out.push({...resolveChatReplyReference({turnId:row.turnId,role:row.role},source,version),emoji:row.emoji});}return out;
}
