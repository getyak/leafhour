// Node22 built-in WebSocket; no browser package or extra driver dependency.
// Shared remote CDP transport for the platform acceptance paths.
export class CDP {
  constructor(socket){this.socket=socket;this.next=0;this.pending=new Map();this.listeners=new Map();
    socket.addEventListener('message',event=>{const message=JSON.parse(event.data);if(message.id){const pending=this.pending.get(message.id);if(!pending)return;this.pending.delete(message.id);clearTimeout(pending.timer);message.error?pending.reject(Error(pending.method+': '+JSON.stringify(message.error))):pending.resolve(message.result);}else for(const handler of this.listeners.get(message.method)||[])handler(message.params);});
    socket.addEventListener('close',()=>{for(const item of this.pending.values()){clearTimeout(item.timer);item.reject(Error('CDP disconnected'));}this.pending.clear();});
  }
  static async connect(url){const socket=new WebSocket(url);await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{socket.close();reject(Error('CDP open timeout'));},10000);socket.addEventListener('open',()=>{clearTimeout(timer);resolve();},{once:true});socket.addEventListener('error',()=>{clearTimeout(timer);reject(Error('CDP socket error'));},{once:true});});return new CDP(socket);}
  send(method,params={}){return new Promise((resolve,reject)=>{const id=++this.next,timer=setTimeout(()=>{this.pending.delete(id);reject(Error('CDP timeout '+method));},30000);this.pending.set(id,{resolve,reject,timer,method});this.socket.send(JSON.stringify({id,method,params}));});}
  on(method,handler){const set=this.listeners.get(method)||new Set();set.add(handler);this.listeners.set(method,set);return()=>set.delete(handler);}
  async evaluate(expression){const result=await this.send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw Error(result.exceptionDetails.text+': '+JSON.stringify(result.exceptionDetails.exception));return result.result.value;}
  get connected(){return this.socket.readyState===1;}
  waitForDisconnect(timeoutMs=5000){
    return new Promise((resolve,reject)=>{
      const finish=error=>{clearTimeout(timer);this.socket.removeEventListener('close',closed);error?reject(error):resolve();};
      const closed=()=>finish(),timer=setTimeout(()=>finish(Error('Owned CDP natural disconnect timeout')),timeoutMs);
      this.socket.addEventListener('close',closed,{once:true});
      if(this.socket.readyState===3)finish();
    });
  }
  async close(){if(this.socket.readyState===3)return;await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('CDP close timeout')),5000);this.socket.addEventListener('close',()=>{clearTimeout(timer);resolve();},{once:true});this.socket.close();});}
}

function ownedLauncherExit(child,timeoutMs){
  return new Promise((resolve,reject)=>{
    const facts=()=>({pid:child.pid,exitCode:child.exitCode,signalCode:child.signalCode});
    const finish=error=>{clearTimeout(timer);child.off('exit',exited);error?reject(error):resolve(facts());};
    const exited=()=>finish(),timer=setTimeout(()=>finish(Error('Owned Chrome launcher exit timeout')),timeoutMs);
    child.once('exit',exited);
    if(child.exitCode!=null||child.signalCode!=null)finish();
  });
}
// Refusal by this exact loopback server is positive shutdown evidence. A timeout,
// HTTP error, reset or generic fetch failure never counts as a closed browser.
export async function probeOwnedDebugServer(endpoint,{fetcher=fetch}={}){
  try{
    const response=await fetcher(endpoint+'/json/version',{signal:AbortSignal.timeout(500),redirect:'error'});
    await response.body?.cancel();return {state:'reachable',status:response.status};
  }catch(error){return error?.cause?.code==='ECONNREFUSED'||error?.code==='ECONNREFUSED'?{state:'refused'}:{state:'unconfirmed',error:error.message};}
}
// Remote runner only. Browser.close is the official graceful browser shutdown:
// https://chromedevtools.github.io/devtools-protocol/tot/Browser/#method-close
// The page WS can close while Chrome lives, so require the owned debug server
// to refuse connections as well as ACK, natural disconnect and launcher exit.
export async function closeOwnedDesktopChrome({cdp,child,endpoint,probe=probeOwnedDebugServer,sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),timeoutMs=5000}){
  const url=new URL(endpoint);
  if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||!url.port||url.pathname!=='/'||url.search||url.hash||url.username||url.password||endpoint!==url.origin)throw Error('Exact owned loopback debug endpoint required');
  if(!Number.isInteger(child?.pid)||child.pid<=0||!cdp?.connected)throw Error('Live owned desktop transport and launcher required');
  if(!Number.isFinite(timeoutMs)||timeoutMs<=0||timeoutMs>5000)throw Error('Bounded desktop cleanup timeout required');
  const result={method:'Browser.close + natural disconnect + launcher exit + debug-server refusal',complete:false,closeAcknowledged:false,transportDisconnected:false,launcher:null,debugServer:null,errors:[]};
  // Register BOTH event waits before sending the close request. allSettled also
  // consumes every rejection even when one boundary fails first.
  const disconnected=cdp.waitForDisconnect(timeoutMs),exited=ownedLauncherExit(child,timeoutMs);
  const results=await Promise.allSettled([cdp.send('Browser.close'),disconnected,exited]);
  for(const [index,label]of ['Browser.close acknowledgement','natural CDP disconnect','owned launcher exit'].entries()){
    const item=results[index];if(item.status==='rejected'){result.errors.push(label+': '+item.reason.message);continue;}
    if(index===0)result.closeAcknowledged=true;else if(index===1)result.transportDisconnected=true;else result.launcher=item.value;
  }
  const started=Date.now();let attempts=0,last;
  do{
    attempts++;
    try{last=await probe(endpoint);}catch(error){last={state:'unconfirmed',error:error.message};}
    if(last?.state==='refused')break;
    await sleep(Math.max(0,Math.min(50,timeoutMs-(Date.now()-started))));
  }while(attempts<100&&Date.now()-started<timeoutMs);
  result.debugServer={...last,attempts};
  if(last?.state!=='refused')result.errors.push('owned debug server shutdown unconfirmed');
  result.complete=result.errors.length===0;
  return result;
}
