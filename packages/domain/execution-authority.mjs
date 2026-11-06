import {AsyncLocalStorage} from 'node:async_hooks';
const storage=new AsyncLocalStorage();
export const executionAuthority=()=>storage.getStore();
export const withExecutionAuthority=(authority,operation)=>storage.run(authority,operation);
// Called only at backend domain boundaries after their existing ownership,
// grant, source and cancellation checks. Never exported as an HTTP operation.
export function withBackendExecutionAuthority(user,authorize,operation){
 const inherited=storage.getStore();if(!user?.id||user.is_anonymous||inherited?.ownerId&&inherited.ownerId!==user.id)throw Object.assign(Error('execution_owner_mismatch'),{status:403});
 return storage.run({...inherited,ownerId:user.id,authorize:async scope=>(inherited?.authorize?await inherited.authorize(scope):true)&&await authorize(scope)!==false},operation);
}
