// GET-273-only parent state machine. External process/device/file boundaries are
// injected so failure tests cannot acquire a lease, load an addon or operate UI.
const UDID='02B4F0C1-A92F-469D-9DCC-5ED13F119507';
const loopbackOrigin=value=>{try{const u=new URL(value);return u.protocol==='http:'&&u.hostname==='127.0.0.1'&&Number(u.port)>1023&&u.pathname==='/'&&!u.search&&!u.hash&&!u.username&&!u.password&&u.origin===value;}catch{return false;}};
export function installSafariParentSignals(parent,signals=process){
  signals.on('SIGTERM',()=>{void parent.stop('signal');});signals.on('SIGINT',()=>{void parent.stop('signal');});
}
export function createSafariParent({entryExpected,assertOwner,device,createFixture,spawnMirror,waitReady,readMirrorReceipt,contextEvidence,writeReceipt,hold}){
  let phase='new',pending=null,entry=null,ownedBoot=false,fixture=null,child=null,childExit=null;
  let fixtureOrigin=null,mirrorOrigin=null,termSent=false,advertised=false,contextClaimed=false,restored=null,entryProof=null;
  let startPromise,mirrorPromise,stopPromise;
  const status=()=>({phase,pending,entryState:entry,ownedBoot,mirrorPID:child?.pid??null,childExit,
    childStopRequested:termSent,uiAdvertised:advertised,contextClaimed,contextRestored:restored!==null,
    cleanupComplete:phase==='stopped',handoffReady:phase==='stopped',nativeAcceptance:'unrun',osReleaseVerified:false});
  function termOnce(){if(child&&!termSent&&!childExit){termSent=true;try{child.signalTerm();}catch{/* Unconfirmed signal is not exit evidence. */}}}
  function block(reason){
    if(phase==='blocked')return status();phase='blocked';hold(true);termOnce();
    try{writeReceipt('blocked',{...status(),reason,cleanupComplete:false,handoffReady:false});}catch{/* Hold even if evidence cannot be written. */}
    return status();
  }
  async function stage(name,fn){
    pending=name;
    try{const value=await fn();if(phase==='blocked')throw Error('Parent blocked');return value;}
    finally{pending=null;}
  }
  async function own(){await assertOwner();if(phase==='blocked')throw Error('Blocked');}
  function cleanStopped(receipt){
    return receipt?.pid===child.pid&&receipt.udid===UDID&&receipt.phase==='stopped'&&receipt.cleanupComplete===true&&
      receipt.activeTouch===false&&receipt.nativePending===false&&receipt.commandPending===false&&receipt.framePending===false&&
      receipt.startupPending===false&&receipt.nativeCleanupPending===false&&receipt.operationsQuiescent===true&&receipt.osReleaseVerified===false;
  }
  function stop(reason='request'){
    if(phase==='blocked')return Promise.resolve(status());if(stopPromise)return stopPromise;
    if(pending)return Promise.resolve(block('parent-operation-pending'));
    if(contextClaimed&&!restored)return Promise.resolve(block('own-context-not-restored'));
    phase='closing';
    stopPromise=(async()=>{
      try{
        if(child){
          termOnce();const exit=await stage('child-exit',()=>child.waitExit());
          if(exit?.pending||!Number.isInteger(exit?.code)||exit.signal!==null)return block('child-exit-unconfirmed');
          childExit={code:exit.code,signal:null};
          if(readMirrorReceipt('blocked')||!cleanStopped(readMirrorReceipt('stopped')))return block('child-receipt-unconfirmed');
          if(advertised&&exit.code!==0)return block('child-exit-failed');
        }
        if(fixture){
          writeReceipt('fixture-observations',fixture.report());
          await stage('fixture-close',()=>fixture.close());
        }
        if(entry){
          await stage('owner-before-restore',own);
          let state=await stage('device-readback',()=>device.state());
          if(ownedBoot&&state==='Booted'){
            await stage('owner-before-shutdown',own);await stage('own-shutdown',()=>device.shutdown());
            await stage('owner-after-shutdown',own);state=await stage('shutdown-readback',()=>device.state());
          }
          if(state!==entry)return block('device-restore-unconfirmed');
        }
        writeReceipt('stopped',{...status(),phase:'stopped',reason,cleanupComplete:true,handoffReady:true,
          contextEvidence:restored??null,contextRestoration:contextClaimed?'operator-attested-own-private-blank':'context-setup-not-admitted'});
        phase='stopped';hold(false);return status();
      }catch{return block('close-failed-or-unconfirmed');}
    })();return stopPromise;
  }
  function start(){
    if(startPromise)return startPromise;hold(true);phase='starting';
    startPromise=(async()=>{
      try{
        if(!['Booted','Shutdown'].includes(entryExpected))throw Error('Unknown wrapper entry');
        await stage('owner-before-start',own);
        const state=await stage('entry-state',()=>device.state());
        if(state!==entryExpected)throw Error('Entry state changed');entry=state;
        if(entry==='Shutdown'){
          ownedBoot=true;await stage('owner-before-boot',own);
          try{await stage('own-boot',()=>device.boot());}catch{return block('own-boot-unconfirmed');}
          await stage('owner-after-boot',own);if(await stage('boot-readback',()=>device.state())!=='Booted')throw Error('Boot unconfirmed');
        }
        fixture=await stage('fixture-create',createFixture);
        fixtureOrigin=await stage('fixture-listen',()=>fixture.listen());if(!loopbackOrigin(fixtureOrigin))throw Error('Fixture origin');
        // Publishing setup availability creates an obligation even if mirror
        // startup later fails: the operator may already have created the own tab.
        contextClaimed=true;phase='awaiting-context';writeReceipt('awaiting-context',{...status(),fixtureOrigin});
        return {fixtureOrigin,...status()};
      }catch{if(phase==='blocked')return status();return stop('initialization-failed');}
    })();return startPromise;
  }
  function openMirror(){
    if(mirrorPromise)return mirrorPromise;
    if(phase!=='awaiting-context')return Promise.resolve(block('context-entry-out-of-order'));
    mirrorPromise=(async()=>{
      try{
        entryProof=await stage('own-context-entry',()=>contextEvidence('entry'));
        await stage('owner-before-mirror',own);
        // Synchronous creation returns only the exact ChildProcess handle owned here.
        child=spawnMirror();if(!Number.isInteger(child?.pid)||child.pid<=0)throw Error('Child identity');
        const ready=await stage('mirror-ready',()=>waitReady(child));
        if(ready?.pid!==child.pid||ready.udid!==UDID||!loopbackOrigin(ready.origin)||JSON.stringify(ready.scope)!=='["frame","touch"]')throw Error('Readiness rejected');
        mirrorOrigin=ready.origin;phase='ready';
        advertised=true;writeReceipt('ready',{...status(),fixtureOrigin,mirrorOrigin,entryEvidence:entryProof});
        return {fixtureOrigin,mirrorOrigin,...status()};
      }catch{if(phase==='blocked')return status();return stop('mirror-initialization-failed');}
    })();return mirrorPromise;
  }
  async function confirmRestored(){
    if(!['ready','awaiting-context'].includes(phase))return block('context-restore-out-of-order');
    try{await stage('owner-before-context-restore',own);restored=await stage('own-context-restored',()=>contextEvidence('restored'));return status();}
    catch{return block('own-context-restore-unconfirmed');}
  }
  function childFault(){return block('unexpected-child-or-blocked-receipt');}
  return{start,openMirror,confirmRestored,stop,status,childFault};
}
