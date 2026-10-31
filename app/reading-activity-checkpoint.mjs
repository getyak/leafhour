import {finiteReadingTimestamp} from './reading-recency.mjs';
// A page may save preferences or retry a write without reading again. Only an
// actual trusted reading input advances this event; capturing it is read-only.
export function createReadingActivityCheckpoint({now=Date.now}={}){
 let observedAt=null,interacted=false;
 return {get observedAt(){return observedAt;},restore(position,{force=false}={}){
  if(force||!interacted){observedAt=finiteReadingTimestamp(position?.observedAt)!==null?position.observedAt:finiteReadingTimestamp(position?.updatedAt)!==null?position.updatedAt:null;if(force)interacted=false;}
 },interact(event){if(!event?.isTrusted)return false;const stamp=now();if(!Number.isFinite(stamp))return false;observedAt=new Date(stamp).toISOString();interacted=true;return true;}};
}
