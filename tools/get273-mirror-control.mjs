// GET-273-only lifecycle for the reviewed fixed-device frame/touch adapter.
// It has no device lookup, native loader, shell, HTTP, credentials or input synthesis.
export function createMirrorControl({hid,capture,assertOwner,setTimer=setTimeout,clearTimer=clearTimeout}) {
  let closing=false, active=null, commandPending=false, nativeTask=null, frameTask=null;
  let gestureTimer=null, releaseNeeded=false, releaseFailed=false, stopPromise=null, releaseWait=null;
  const watchers=new Set();
  const faults=new Set();
  const stats={frames:0,touchEvents:0,gestureTimeouts:0};
  const receipt=()=>({
    ...stats,closing,activeTouch:active!==null,nativePending:nativeTask!==null,
    commandPending,framePending:frameTask!==null,releaseFailed,faults:[...faults],
    // This is scheduling evidence, never an OS acknowledgement of a physical up.
    endEvidence:'native-promise-completion-only',osReleaseVerified:false,
    operationsQuiescent:closing&&!active&&!nativeTask&&!commandPending&&!frameTask,
  });
  const notify=()=>{for(const check of [...watchers])check();};
  const clearGesture=()=>{if(gestureTimer!==null)clearTimer(gestureTimer);gestureTimer=null;};
  function abort(code='client-disconnected') {
    faults.add(['client-disconnected','lease-lost','gesture-timeout','native-timeout','native-failed','frame-failed','frame-timeout','invalid-request','shutdown'].includes(code)?code:'invalid-request');
    closing=true;releaseNeeded=true;clearGesture();notify();pumpRelease();
  }
  function native(phase,x,y) {
    if(nativeTask)throw Error('Native operation in flight');
    let timer;
    const operation=Promise.resolve().then(()=>hid.touch(phase,x,y,1,1,0));
    nativeTask=operation;
    const settled=operation.then(()=>{
      stats.touchEvents++;
      if(phase==='end'){active=null;releaseNeeded=false;clearGesture();}
      else active={x,y};
    },()=>{
      if(phase==='end')releaseFailed=true;
      abort('native-failed');throw Error('Native operation failed');
    }).finally(()=>{
      clearTimer(timer);nativeTask=null;notify();pumpRelease();
    });
    const expired=new Promise((_,reject)=>{timer=setTimer(()=>{
      abort('native-timeout');reject(Error('Native operation timed out; cancellation unconfirmed'));
    },2000);});
    // The nativeTask stays tracked after this race expires. Never run a concurrent up.
    return Promise.race([settled,expired]);
  }
  function pumpRelease() {
    if(!releaseNeeded||!active||nativeTask||commandPending||releaseFailed)return;
    const {x,y}=active;
    // native() marks the operation synchronously; repeated stop/timer/error cannot enqueue another.
    void native('end',x,y).catch(()=>{});
  }
  async function touch(phase,x,y) {
    if(!['begin','move','end'].includes(phase)||!Number.isFinite(x)||!Number.isFinite(y)||x<0||x>1||y<0||y>1)throw Error('Invalid touch');
    if(phase==='end'){
      if(!active)throw Error('No active touch');
      releaseNeeded=true;pumpRelease();
      await waitForRelease();return;
    }
    if(closing)throw Error('Adapter closed to new input');
    // No move queue: at most one admitted command and one native call.
    if(commandPending||nativeTask)throw Error('Touch busy');
    if((phase==='begin'&&active)||(phase==='move'&&!active))throw Error('Invalid phase');
    commandPending=true;
    try {
      try{await assertOwner();}catch{abort('lease-lost');throw Error('Lease lost');}
      if(closing)throw Error('Adapter closing');
      if(phase==='begin'){
        active={x,y};
        gestureTimer=setTimer(()=>{stats.gestureTimeouts++;abort('gesture-timeout');},5000);
      }
      await native(phase,x,y);
    } catch(error) {
      abort(faults.has('lease-lost')?'lease-lost':'native-failed');throw error;
    } finally {commandPending=false;notify();pumpRelease();}
  }
  function waitForRelease() {
    if(releaseWait)return releaseWait;
    releaseWait=waitForReleaseOnce().finally(()=>{releaseWait=null;});return releaseWait;
  }
  async function waitForReleaseOnce() {
    // Bounded receipt wait. Expiry does not erase in-flight native state.
    let timer;
    const until=new Promise(resolve=>{
      const check=()=>{if(!active||releaseFailed){watchers.delete(check);resolve();}};
      watchers.add(check);check();timer=setTimer(()=>{watchers.delete(check);resolve();},3000);
    });
    await until;clearTimer(timer);
    if(active)throw Error('Release unconfirmed');
  }
  async function frame() {
    if(closing||frameTask)throw Error('Frame unavailable');
    let timer;
    const task=(async()=>{
      try {
        await assertOwner();if(closing)throw Error('Closing');
        const data=await capture.snapshotJpeg();
        await assertOwner();if(closing||!data)throw Error('Frame rejected');
        stats.frames++;return data;
      } catch {abort('frame-failed');throw Error('Frame rejected');}
    })();
    frameTask=task;
    const settled=task.finally(()=>{clearTimer(timer);frameTask=null;notify();});
    const expired=new Promise((_,reject)=>{timer=setTimer(()=>{abort('frame-timeout');reject(Error('Frame timed out'));},2000);});
    return Promise.race([settled,expired]);
  }
  function stop() {
    if(stopPromise)return stopPromise;
    closing=true;releaseNeeded=true;clearGesture();pumpRelease();
    stopPromise=(async()=>{
      let timer;
      await new Promise(resolve=>{
        const check=()=>{if((!active&&!nativeTask&&!commandPending&&!frameTask)||releaseFailed){watchers.delete(check);resolve();}};
        watchers.add(check);check();timer=setTimer(()=>{watchers.delete(check);resolve();},3000);
      });
      clearTimer(timer);return receipt();
    })();return stopPromise;
  }
  return {touch,frame,abort,stop,receipt};
}
