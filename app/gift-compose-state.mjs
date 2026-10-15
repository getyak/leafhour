// Draft revisions survive a closed window; stale asynchronous responses do not.
export function createGiftDrafts(){
  const drafts=new Map(),letters=new Map(),pending=new Map();
  function remember(key,value){
    const previous=drafts.get(key);
    if(previous&&JSON.stringify(previous)===JSON.stringify(value))return;
    drafts.set(key,{...value});pending.delete(key);letters.delete(key);
  }
  function begin(key){const request={draft:drafts.get(key)};pending.set(key,request);return request;}
  function commit(key,request,gift){
    if(pending.get(key)!==request||drafts.get(key)!==request.draft)return false;
    pending.delete(key);drafts.delete(key);letters.set(key,gift);return true;
  }
  return {remember,begin,commit,draft:key=>drafts.get(key),sealed:key=>letters.get(key),forgetSealed:key=>letters.delete(key),
    reset(key){drafts.delete(key);letters.delete(key);pending.delete(key);},
    clear(){drafts.clear();letters.clear();pending.clear();}};
}
