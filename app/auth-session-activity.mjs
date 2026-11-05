// Explicit foreground activity only: there is deliberately no heartbeat timer.
export function mountSessionActivity({document=globalThis.document,window=globalThis.window,getOwner,request=globalThis.fetch,clock=Date.now}={}){
  let owner=null,revision=0,lastAttempt=-Infinity,blocked=false,pending=null,disposed=false;
  const listeners=[];
  const adopt=()=>{const next=getOwner()||null;if(next===owner)return false;owner=next;revision++;lastAttempt=-Infinity;blocked=false;return true;};
  async function record(){
    if(disposed||document.hidden)return false;
    adopt();if(!owner||blocked||clock()-lastAttempt<300000||pending?.revision===revision)return false;
    const ticket={owner,revision};pending=ticket;lastAttempt=clock();
    try{
      const response=await request('/api/auth/session/activity',{method:'POST',headers:{'Content-Type':'application/json','X-Reader-Owner':ticket.owner},body:JSON.stringify({client:'web'}),signal:AbortSignal.timeout(15000)});
      if(disposed||ticket.revision!==revision||ticket.owner!==(getOwner()||null))return false;
      if([401,409].includes(response.status))blocked=true;
      return response.ok;
    }catch{return false;}
    finally{if(pending===ticket)pending=null;}
  }
  const onActivity=event=>{if(event?.isTrusted===false)return;void record();};
  const listen=(target,event)=>{target.addEventListener(event,onActivity,{passive:true,capture:true});listeners.push(()=>target.removeEventListener(event,onActivity,true));};
  // Programmatic scrolling/focus can also be trusted browser events. Listen
  // to the user's input instead, including input inside nested scroll views.
  for(const event of ['pointerdown','keydown','wheel','touchmove'])listen(document,event);
  listen(window,'pageshow');
  listen(document,'visibilitychange');
  const update=async({reset=false}={})=>{const changed=adopt();if(reset){revision++;lastAttempt=-Infinity;blocked=false;}return changed||reset?record():false;};
  void update();
  return {update,dispose(){disposed=true;revision++;for(const off of listeners)off();}};
}
