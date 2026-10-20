import {digest,fail,MAX_FILE_BYTES} from './document-import.mjs';
// Capabilities live only within this process. JSON bodies cannot mint or replay
// them, and the adoption closure never accepts a caller-supplied source path.
const sources=new WeakMap();
export function createVerifiedSource(user,{sha256,size,adopt}){
 if(!user?.id||!/^[a-f0-9]{64}$/.test(sha256)||!Number.isSafeInteger(size)||size<1||size>MAX_FILE_BYTES||typeof adopt!=='function')throw fail('原文件引用无法核验',403);
 const reference=Object.freeze({});sources.set(reference,{owner:digest(user.id),sha256,size,adopt});return reference;
}
export function resolveVerifiedSource(user,reference){
 const source=reference&&typeof reference==='object'?sources.get(reference):null;
 if(!user?.id||!source||source.owner!==digest(user.id))throw fail('原文件引用无法核验',403);
 return {sha256:source.sha256,size:source.size,adopt:source.adopt};
}
