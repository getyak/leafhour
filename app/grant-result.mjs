const scopeNames={content:'原文与译文',notes:'我的评论与问题',activity:'阅读位置与时段','comment:write':'写入明确提供的评论'};
export const grantScopeSummary=scopes=>scopes.map(scope=>scopeNames[scope]||scope).join(' / ');
// This receipt is memory-only; dismissing it does not revoke the server grant.
export function createGrantResult(){
  let result=null,revision=0,listSequence=0;
  const clear=()=>{result=null;revision++;};
  const current=(now=Date.now())=>{if(result&&(result.revoked||!Number.isFinite(Date.parse(result.expiresAt))||Date.parse(result.expiresAt)<=now))clear();return result?{...structuredClone(result),revision}:null;};
  return {
    show(grant){revision++;result=structuredClone(grant);},clear,current,
    revoke(id){if(result?.id===id)clear();},
    beginList(){return {revision,sequence:++listSequence};},
    isListCurrent(snapshot){return snapshot?.revision===revision&&snapshot.sequence===listSequence;},
    reconcile(grants,now=Date.now(),snapshot=null){if(snapshot&&(snapshot.revision!==revision||snapshot.sequence!==listSequence))return false;if(result){const saved=grants.find(g=>g.id===result.id);if(!saved||saved.revoked||Date.parse(saved.expiresAt)<=now)clear();else current(now);}return true;},
    isCurrent(receipt,now=Date.now()){const active=current(now);return !!active&&receipt?.id===active.id&&receipt.revision===active.revision;}
  };
}
