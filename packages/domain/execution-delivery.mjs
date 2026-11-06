import {AsyncLocalStorage} from 'node:async_hooks';
const candidates=new WeakMap(),delivery=new AsyncLocalStorage();
// Kept out of serialized provider/domain data. Only API-created candidates can
// authorize a receipt; callers cannot smuggle a receipt through JSON.
export function attachExecutionCandidate(value,receipt){if(value&&typeof value==='object')candidates.set(value,Object.freeze(receipt));return value;}
export function transferExecutionCandidate(source,target){const receipt=candidates.get(source);return receipt?attachExecutionCandidate(target,receipt):target;}
export const executionDeliveryContext=()=>delivery.getStore();
export function withCandidateDelivery(candidate,operation,{accept=()=>true}={}){const receipt=candidates.get(candidate);return receipt?delivery.run({...receipt,accept},operation):operation();}
