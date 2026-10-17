export const READING_CHAT_SCOPES=['book','library'];
const fail=(message,status=400)=>Object.assign(Error(message),{status});
const revision=value=>Number.isSafeInteger(value)&&value>=0;
export function readChatScope(value){
  if(value===undefined)return {mode:'book',revision:0};
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!['mode','revision'].includes(key))||!READING_CHAT_SCOPES.includes(value.mode)||!revision(value.revision))throw fail('查阅范围设置暂时无法安全读取，请先保留已有对话。',409);
  return {mode:value.mode,revision:value.revision};
}
export function checkChatScopeRevision(scope,input){
  const value=input.scopeRevision===undefined?0:input.scopeRevision;
  if(!revision(value))throw fail('请先读取当前查阅范围，再发送问题。');
  if(value!==scope.revision||input.scopeRevision===undefined&&scope.mode!=='book')throw fail('查阅范围已在另一处改变，请重新读取并确认当前范围；你的问题仍保留。',412);
  return value;
}
export function changeChatScope(scope,input,{running=false}={}){
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>!['mode','baseRevision'].includes(key))||!READING_CHAT_SCOPES.includes(input.mode)||!revision(input.baseRevision))throw fail('请选择当前书或书房与网络，并确认当前设置。');
  if(input.baseRevision!==scope.revision)throw fail('查阅范围已在另一处改变，请重新读取后再选择；草稿仍保留。',412);
  if(input.mode===scope.mode)return scope;
  if(running)throw fail('请先停止正在处理的提问，再修改查阅范围。',409);
  if(scope.revision===Number.MAX_SAFE_INTEGER)throw fail('查阅范围版本无法继续安全更新，请先保留对话。',409);
  return {mode:input.mode,revision:scope.revision+1};
}
