// Recent foreground presence only. This never records reading time, a book ID,
// a position or content, and it never gives an Agent permission to write it.
export function mountReaderPresence({api,getUserId,enabled=()=>true,document=globalThis.document,window=globalThis.window,crypto=globalThis.crypto,setInterval=globalThis.setInterval,clearInterval=globalThis.clearInterval}={}){
  if(!document||!window||typeof api!=='function'||typeof getUserId!=='function'||!crypto?.randomUUID)return {refresh:async()=>{},close:async()=>{}};
  const tabId=crypto.randomUUID();let owner=null,pagePresent=true,closed=false,desired=null,running=null,last=null,sequence=0;
  const active=()=>!closed&&pagePresent&&!document.hidden&&document.hasFocus()&&enabled();
  async function drain(){
    while(desired){
      const next=desired;desired=null;
      if(next.owner!==owner)continue;
      if(!next.owner||(!next.active&&last?.owner!==next.owner))continue;
      try{
        await api('/api/library/daily-reading/presence',{tabId,active:next.active,sequence:++sequence},{keepalive:true,signal:AbortSignal.timeout(8000),headers:{'X-Reader-Owner':next.owner}});
        // The response carries no UI state; owner changes never adopt it.
        if(owner===next.owner)last={owner:next.owner,active:next.active};
      }catch{/* Offline presence expires on the server; only a later tick retries. */}
    }
  }
  function startDrain(){
    if(!running)running=Promise.resolve().then(drain).finally(()=>{running=null;if(desired)return startDrain();});
    return running;
  }
  function refresh(){
    if(closed)return running||Promise.resolve();
    const current=getUserId();if(current!==owner){owner=current;last=null;desired=null;}
    if(!owner)return running||Promise.resolve();
    const next={owner,active:active()};
    // Inactive duplicates need no heartbeat; active leases are refreshed.
    if(!next.active&&last?.owner===owner&&last.active===false&&!running)return Promise.resolve();
    desired=next;
    return startDrain();
  }
  const events=[
    [document,'visibilitychange',refresh],
    [window,'focus',refresh],
    [window,'blur',refresh],
    [window,'pagehide',()=>{pagePresent=false;refresh();}],
    [window,'pageshow',()=>{pagePresent=true;refresh();}]
  ];
  for(const [target,name,handler]of events)target.addEventListener(name,handler);
  const timer=setInterval(refresh,30000);refresh();
  return {refresh,async close(){
    if(closed)return running;
    closed=true;pagePresent=false;clearInterval(timer);
    for(const [target,name,handler]of events)target.removeEventListener(name,handler);
    desired=owner&&getUserId()===owner?{owner,active:false}:null;
    return startDrain();
  }};
}
