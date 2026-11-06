import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {encodeData,decodeData,LOCAL_EXECUTION_TYPES} from '../../packages/contracts/execution.mjs';
import {withProviderMeter} from '../../server/provider-metering.mjs';
export function createAgentWorker({client,handlers,pollMs=500,heartbeatMs=5000,paused=false}={}){
 let closed=false,active=null,loop=null,controller=null,completed=0,lastError=null;
 const workerId=randomUUID();
 async function run(lease){
  const taskController=new AbortController();controller=taskController;let heartbeat;const call=(method,value)=>client.call(method,{lease,...value});
  try{
   const context=await call('context',{});if(context.protocol!==1)throw Error('Unsupported execution protocol');heartbeat=setInterval(()=>{call('heartbeat',{}).catch(()=>taskController.abort());},heartbeatMs);heartbeat.unref?.();
   let sources=[],recommendations=[];
   const tools={definitions:context.toolDefinitions,async execute(name,args,runtime={}){controller.signal.throwIfAborted();let webResult;if(name==='reader_search_web'){if(!handlers['web-search'])throw Error('Web search provider unavailable');await call('tool-check',{name,args});webResult=await handlers['web-search']({query:args.query,signal:controller.signal,reserveRequest:runtime.reserveRequest});}const result=await call('tool',{name,args,...(webResult?{webResult}:{})});sources=result.sources;recommendations=result.recommendations;return result.value;},sources:()=>sources,recommendations:()=>recommendations};
   const job={...decodeData(context.payload),signal:controller.signal,tools,...(context.progress?{onProgress:progress=>call('progress',progress)}:{})};
   const meter={ownerId:'task-bound',feature:context.meter?.feature||context.type,funding:context.meter?.funding||'sponsored',...(context.meter?.maxCostUsd?{maxCostUsd:context.meter.maxCostUsd}:{}),record:facts=>call('meter',{facts})};
   // Each job gets one durable outer intent; instrumented DSH/translation paths
   // additionally obtain a fenced permit for every actual provider request.
   if(!LOCAL_EXECUTION_TYPES.includes(context.type))await call('dispatch',{stepId:'invocation',provider:'configured-'+context.type,model:'task-adapter',inputDigest:context.inputDigest});controller.signal.throwIfAborted();
   const result=await withProviderMeter(meter,()=>handlers[context.type](job));controller.signal.throwIfAborted();await call('complete',{result:encodeData(result)});completed++;
  }catch(error){lastError=['lease_lost','cancelled','authority_revoked','provider_outcome_unknown'].includes(error.code)?error.code:'execution_failed';try{await call('fail',{code:lastError});}catch{}}
  finally{clearInterval(heartbeat);controller?.abort();controller=null;}
 }
 const status=()=>({paused,inflight:active?1:0,completed,lastError});
 return {status,start(){if(loop)return;loop=(async()=>{while(!closed){if(!paused){try{const lease=await client.call('claim',{workerId,types:Object.keys(handlers)});if(lease){active=run(lease);await active;active=null;continue;}}catch{lastError='gateway_unavailable';}}try{await delay(pollMs,undefined,{signal:controller?.signal});}catch{}}})();},async close(){closed=true;controller?.abort();await loop;},setPaused(value){paused=!!value;}};
}
