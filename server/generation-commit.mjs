// Only a trusted domain save can mark a commit outcome as uncertain. Provider
// errors, request JSON and serialized/replayed errors cannot manufacture it.
const uncertainCommits=new WeakMap();
export function markUncertainGenerationCommit(error,receipt){
 const failure=error!==null&&(typeof error==='object'||typeof error==='function')?error:new Error('生成结果仍在核对',{cause:error});
 uncertainCommits.set(failure,{operationId:receipt.operationId,requestId:receipt.requestId});
 return failure;
}
export function hasUncertainGenerationCommit(error,operationId){
 return error!==null&&(typeof error==='object'||typeof error==='function')&&uncertainCommits.get(error)?.operationId===operationId;
}
