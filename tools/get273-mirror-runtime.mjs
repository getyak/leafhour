// Fixed adapter lifecycle. Dependencies are the external native/lease/file boundaries;
// fault tests import this module without loading any native code or device state.
import {createMirrorControl} from './get273-mirror-control.mjs';

export function installMirrorSignals(runtime,signals=process){
  // Keep handlers for the whole blocked lifetime, including repeated stop attempts.
  signals.on('SIGTERM',()=>{void runtime.stop();});signals.on('SIGINT',()=>{void runtime.stop();});
}

export function createMirrorRuntime({assertOwner,createNative,createServer,writeReceipt,hold,
  onCleanStop=()=>{},setTimer=setTimeout,clearTimer=clearTimeout,setWatch=setInterval,clearWatch=clearInterval}) {
  const resources={};let control,mirror,phase='new',startupPending=false,nativeCleanupPending=false;
  let watch=null,startPromise,stopPromise,origin;
  const status=()=>({phase,startupPending,nativeCleanupPending,...(control?.receipt()??{
    activeTouch:false,nativePending:false,commandPending:false,framePending:false,
    operationsQuiescent:!startupPending&&!nativeCleanupPending,
  }),osReleaseVerified:false});
  function block(reason){
    phase='blocked';hold(true);if(watch!==null)clearWatch(watch);watch=null;
    control?.abort('shutdown');
    try{writeReceipt('blocked',{...status(),reason,cleanupComplete:false});}catch{/* Keep held even when evidence storage fails. */}
    return status();
  }
  async function boundedClose(fn){
    let timer;nativeCleanupPending=true;
    const operation=Promise.resolve().then(fn);
    const settled=operation.finally(()=>{nativeCleanupPending=false;clearTimer(timer);});
    const expired=new Promise((_,reject)=>{timer=setTimer(()=>reject(Error('Close unconfirmed')),2000);});
    // Race expiry never cancels the underlying handle operation or clears pending state.
    await Promise.race([settled,expired]);
  }
  function stop(reason='shutdown'){
    if(phase==='blocked')return Promise.resolve(status());
    if(stopPromise)return stopPromise;
    if(startupPending)return Promise.resolve(block('startup-unconfirmed'));
    phase='closing';if(watch!==null)clearWatch(watch);watch=null;
    stopPromise=(async()=>{
      try{
        if(mirror)await boundedClose(()=>mirror.close());
        if(control){const receipt=await control.stop();if(!receipt.operationsQuiescent)return block('input-release-unconfirmed');}
        if(resources.hid)await boundedClose(()=>resources.hid.close());
        if(resources.capture)await boundedClose(()=>resources.capture.stop());
        writeReceipt('stopped',{...status(),phase:'stopped',reason,cleanupComplete:true});
        phase='stopped';hold(false);
        // A native addon can retain event-loop references after close promises.
        // Only this confirmed, synchronously receipted path may end the child.
        onCleanStop(reason==='startup-failed'?1:0);return status();
      }catch{return block('cleanup-unconfirmed');}
    })();return stopPromise;
  }
  async function stage(fn){
    startupPending=true;
    try{const value=await fn();if(phase==='blocked')throw Error('Startup stopped');return value;}
    finally{startupPending=false;}
  }
  function start(){
    if(startPromise)return startPromise;
    hold(true);phase='starting';
    startPromise=(async()=>{
      try{
        await stage(assertOwner);
        createNative(resources);
        if(await stage(()=>resources.hid.isFoldable())!==false)throw Error('Unsupported device');
        await stage(assertOwner);await stage(()=>resources.capture.start());
        control=createMirrorControl({hid:resources.hid,capture:resources.capture,assertOwner});
        mirror=createServer(control);origin=await stage(()=>mirror.listen());await stage(assertOwner);
        writeReceipt('ready',{origin,scope:['frame','touch'],nativeAcceptance:'unrun',osReleaseVerified:false});
        phase='ready';
        watch=setWatch(()=>{if(phase==='ready')void assertOwner().catch(()=>{control.abort('lease-lost');void stop('lease-lost');});},10000);
        return {origin,...status()};
      }catch{if(phase==='blocked')return status();return stop('startup-failed');}
    })();return startPromise;
  }
  return {start,stop,status};
}
