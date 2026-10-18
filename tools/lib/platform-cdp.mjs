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
  async close(){if(this.socket.readyState===3)return;await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('CDP close timeout')),5000);this.socket.addEventListener('close',()=>{clearTimeout(timer);resolve();},{once:true});this.socket.close();});}
}
