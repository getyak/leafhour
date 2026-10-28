// GET-198 second bounded batch: the account UI-preferences client bridge.
// This module synchronizes ONE thing: the account `ui-preferences` record's
// interface-language choice with the single ui-locale runtime. It is wired by
// a trusted entry that injects everything external:
//
// - runtime: the raw ui-locale singleton's thin interface (manual intent
//   tokens, manual success commits, account-actor recovery). The bridge never
//   owns a second active language and never re-translates or remounts UI.
// - read(owner)/write(owner,{baseRevision,uiLocale}): trusted entry IO that
//   returns the strict backend snapshot or throws a status error. The bridge
//   itself never fetches auth, never guesses an owner and never touches
//   private config, models or reading records.
// - getLocation/onStatus: the page URL for deep-link/authored-path precedence
//   and the fixed phase feedback for the existing notice + explicit retry.
//
// Ownership and fencing rules (normative): every request captures its owner;
// adoptOwner(ownerId|null) may only follow a verified session and synchronously
// invalidates the old owner's reads, writes and success feedback; switching to
// a different owner (or the guest) clears a previous owner's account-restored
// language through the runtime's write-free device/browser/route path BEFORE
// the new owner's read settles; a manual selection binds owner+intent at intent
// start and saves exactly once through read-then-write CAS whose ACK must
// confirm the same language and exactly baseRevision+1; consecutive selections
// serialize and merge by intent fencing so a late old response can never
// report the new selection as saved; every recovery status publication is
// fenced by the capture's owner AND intent/commit; dispose() invalidates every
// late result. A 409 never auto-overwrites another device: the usable revision
// is read back, the local choice stays and only an explicit retry writes
// again. Corrupt snapshots are rejected outright and never open a
// baseRevision-0 CAS window over existing data. Every read/write call is
// bounded to one explicit action: no polling and no automatic retry.
import {isUiPreference} from './ui-locale-codec.mjs';

// Fixed phase and reason vocabularies: independent of catalogue loading, safe
// for the existing UI notice, and never raw backend errors or account data.
export const ACCOUNT_UI_PHASES=Object.freeze(['idle','reading','saving','saved','conflict','error','disposed']);
export const ACCOUNT_UI_REASONS=Object.freeze([null,'network','auth','record']);

const SNAPSHOT_KEYS=Object.freeze(['revision','updatedAt','uiLocale']);
const MAX_TIMESTAMP_LENGTH=64;

// The strict backend snapshot is the only accepted document shape: exactly
// {revision,updatedAt,uiLocale} with a safe revision, a null-or-code uiLocale
// and a timestamp that exists exactly when the record left revision zero.
// Anything else is corrupt data and must be rejected, never "repaired" into an
// empty value that would open a CAS window.
export function isAccountUiSnapshot(value){
  if(!value||typeof value!=='object'||Array.isArray(value))return false;
  const keys=Object.keys(value);
  if(keys.length!==SNAPSHOT_KEYS.length||keys.some(key=>!SNAPSHOT_KEYS.includes(key)))return false;
  if(!Number.isSafeInteger(value.revision)||value.revision<0)return false;
  if(value.uiLocale!==null&&!isUiPreference(value.uiLocale))return false;
  if(value.revision===0)return value.updatedAt===null&&value.uiLocale===null;
  return typeof value.updatedAt==='string'&&!!value.updatedAt&&value.updatedAt.length<=MAX_TIMESTAMP_LENGTH&&Number.isFinite(Date.parse(value.updatedAt));
}

const reasonOf=error=>{
  const status=Number.isInteger(error?.status)?error.status:null;
  return status===401||status===403?'auth':status===400||status===409?'record':'network';
};

export function createAccountUiPreferencesBridge({runtime,read,write,getLocation,onStatus=()=>{},initialAccount=null}={}){
  if(!runtime||typeof runtime.onUiLocaleManualIntent!=='function'||typeof runtime.onUiLocaleManualCommit!=='function'||typeof runtime.requestAccountUiLocale!=='function')throw Error('Account UI preferences bridge requires the runtime manual intent, manual commit and account recovery interfaces');
  if(typeof read!=='function'||typeof write!=='function'||typeof getLocation!=='function')throw Error('Account UI preferences bridge requires injected read, write and getLocation');
  if(typeof onStatus!=='function')throw Error('Account UI preferences bridge requires an onStatus sink');

  const listeners=new Set();
  let phase='idle',reason=null;
  let owner=null,epoch=0,disposed=false;
  let initialOwner=typeof initialAccount?.ownerId==='string'&&initialAccount.ownerId&&isUiPreference(initialAccount.preference)?initialAccount.ownerId:null;
  let restoredCode=initialOwner?initialAccount.preference:null,adoptionCapture=null;
  let latestIntent=0,latestCommit=0;
  let binding=null,conflict=null,lastAttempt=null;
  let chain=Promise.resolve(),queued=null;

  const getState=()=>Object.freeze({phase,reason});
  const notify=()=>{
    const state=getState();
    for(const sink of [onStatus,...listeners]){try{sink(state);}catch{}}
  };
  const setPhase=(next,nextReason=null)=>{
    if(phase===next&&reason===nextReason)return;
    if(!ACCOUNT_UI_PHASES.includes(next)||!ACCOUNT_UI_REASONS.includes(nextReason))throw Error('Account UI preferences phase is outside the fixed vocabulary');
    phase=next;reason=nextReason;notify();
  };

  // Every async step captures owner+epoch+intent at its start and rechecks
  // before any further IO or status feedback. A late result for a previous
  // owner, a superseded intent or a disposed bridge only disappears.
  const ownerCurrent=capture=>!disposed&&capture.epoch===epoch&&capture.owner===owner;
  const isCurrentFor=target=>ownerCurrent(target)&&target.token===latestIntent;
  const restoreCurrent=capture=>ownerCurrent(capture)&&capture.intent===latestIntent&&capture.commit===latestCommit;

  // A valid ui deep link or an explicit authored language path is the page's
  // own choice and always outranks account recovery.

  // One bounded serial chain: consecutive selections queue behind each other
  // and a superseded queued selection merges into the newest one.
  const schedule=task=>{const running=chain.then(()=>task());chain=running.catch(()=>{});return running;};

  const writeOnce=(target,baseRevision)=>Promise.resolve().then(async()=>{
    if(!isCurrentFor(target))return;
    let result;
    try{result=await write(target.owner,{baseRevision,uiLocale:target.code});}
    catch(error){
      if(!isCurrentFor(target))return;
      if(Number.isInteger(error?.status)&&error.status===409)return conflictFlow(target);
      setPhase('error',reasonOf(error));
      return;
    }
    // A late old response never reports the new selection as saved.
    if(!isCurrentFor(target))return;
    // The ACK must confirm exactly this write: the same language and the
    // exact next revision, with no safe-integer overflow. Anything else is a
    // corrupt confirmation — never saved, never an automatic rewrite, never a
    // false "the other device is in sync" claim.
    const expected=baseRevision+1;
    if(!isAccountUiSnapshot(result)||result.uiLocale!==target.code||!Number.isSafeInteger(expected)||result.revision!==expected){setPhase('error','record');return;}
    conflict=null;
    setPhase('saved');
  });

  const conflictFlow=target=>Promise.resolve().then(async()=>{
    if(!isCurrentFor(target))return;
    // A CAS conflict never auto-overwrites another device: read back the
    // usable revision, keep the local choice and report the conflict. Only an
    // explicit retry writes again, once, with that revision.
    let back;
    try{back=await read(target.owner);}
    catch(error){if(!isCurrentFor(target))return;setPhase('error',reasonOf(error));return;}
    if(!isCurrentFor(target))return;
    if(!isAccountUiSnapshot(back)){setPhase('error','record');return;}
    conflict={owner:target.owner,epoch:target.epoch,token:target.token,code:target.code,revision:back.revision};
    setPhase('conflict');
  });

  const saveSelection=target=>Promise.resolve().then(async()=>{
    if(!isCurrentFor(target))return;
    lastAttempt=target;
    setPhase('saving');
    let snapshot;
    try{snapshot=await read(target.owner);}
    catch(error){if(!isCurrentFor(target))return;setPhase('error',reasonOf(error));return;}
    if(!isCurrentFor(target))return;
    if(!isAccountUiSnapshot(snapshot)){setPhase('error','record');return;}
    await writeOnce(target,snapshot.revision);
  });

  const runSave=()=>{
    const target=queued;queued=null;
    return target?saveSelection(target):Promise.resolve();
  };

  const restore=(capture,code)=>Promise.resolve().then(()=>{
    // The owner/intent guard is captured here and handed to the runtime as the
    // isCurrent recheck; the deep-link/authored-path precedence is checked at
    // result time so a page's explicit choice always stays authoritative.
    if(!restoreCurrent(capture))return {applied:false};
    return runtime.requestAccountUiLocale(code==null?null:code,{isCurrent:()=>restoreCurrent(capture)});
  }).then(result=>{
    const applied=!!result&&String(result.kind).startsWith('committed');
    // Only an actually applied restore changes the account-restored bookkeeping
    // the next owner switch has to clear.
    if(applied)restoredCode=code==null?null:code;
    return {applied};
  },()=>({applied:false}));

  // One adoption read: strictly read-only, and every status publication or
  // restore is fenced by the capture's owner AND intent/commit, so a late
  // read result can never erase a newer manual saved/error/conflict state.
  const adoptPipeline=capture=>(async()=>{
    if(!restoreCurrent(capture))return {applied:false};
    let snapshot;
    try{snapshot=await read(capture.owner);}
    catch(error){if(!restoreCurrent(capture))return {applied:false};setPhase('error',reasonOf(error));return {applied:false};}
    if(!restoreCurrent(capture))return {applied:false};
    if(!isAccountUiSnapshot(snapshot)){
      // Corrupt data is rejected outright and never opens a CAS window with
      // empty values; the adoption clearing already protects the language.
      setPhase('error','record');
      return {applied:false};
    }
    setPhase('idle');
    if(snapshot.uiLocale===null)return restoredCode!==null?restore(capture,null):{applied:false};
    return restore(capture,snapshot.uiLocale);
  })();

  const offIntent=runtime.onUiLocaleManualIntent(payload=>{
    if(disposed)return;
    latestIntent=payload.token;
    // Owner and intent are bound together at the start of the manual choice.
    binding={token:payload.token,code:payload.code,owner,epoch};
  });
  const offCommit=runtime.onUiLocaleManualCommit(payload=>{
    if(disposed)return;
    latestCommit=payload.token;
    const target=binding;
    // Only the intent captured at start may save, and only to the owner bound
    // at that start: a failed picker emits nothing, an older intent finishing
    // late is dropped, and a mid-flight owner change never saves anywhere.
    if(!target||target.token!==payload.token)return;
    if(target.owner===null||target.epoch!==epoch||target.owner!==owner)return;
    queued={owner:target.owner,epoch:target.epoch,token:target.token,code:payload.code};
    schedule(runSave);
  });

  const adoptOwner=ownerId=>{
    if(ownerId!==null&&(typeof ownerId!=='string'||!ownerId))throw Error('adoptOwner requires a verified owner id or null');
    if(disposed)return Promise.resolve({applied:false});
    // Adopting synchronously invalidates the old owner's reads, writes and
    // pending success feedback before any new IO starts.
    const previousOwner=owner,matchingInitialOwner=initialOwner!==null&&initialOwner===ownerId;initialOwner=null;
    epoch++;owner=ownerId;conflict=null;queued=null;lastAttempt=null;
    if(previousOwner!==null&&previousOwner!==ownerId)void runtime.invalidateUiOwner?.();
    const capture={epoch,owner:ownerId,intent:latestIntent,commit:latestCommit};
    adoptionCapture=capture;
    // A previous owner's account-restored language must never become the new
    // owner's (or the guest's) default: the write-free device/browser/route
    // path clears it BEFORE the new owner's read settles — or fails. A first
    // adoption and a same-owner refresh have nothing to clear and therefore
    // never add extra catalogue work or flicker.
    const clearing=restoredCode!==null&&(!matchingInitialOwner&&previousOwner!==ownerId||ownerId===null)
      ?restore(capture,null)
      :Promise.resolve({applied:false});
    if(ownerId===null){
      setPhase('idle');
      return clearing;
    }
    setPhase('reading');
    return Promise.all([clearing,adoptPipeline(capture)]).then(([,result])=>result);
  };

  const retry=()=>{
    if(disposed)return Promise.resolve({retried:false});
    if(phase==='conflict'&&conflict&&isCurrentFor(conflict)){
      // The explicit conflict retry writes once, for the same owner and still
      // the same intent, with the revision read back at conflict time.
      const target={owner:conflict.owner,epoch:conflict.epoch,token:conflict.token,code:conflict.code};
      const baseRevision=conflict.revision;
      return schedule(async()=>{
        if(!isCurrentFor(target))return;
        setPhase('saving');
        await writeOnce(target,baseRevision);
      }).then(()=>({retried:true}),()=>({retried:false}));
    }
    if(phase==='error'){
      if(lastAttempt&&isCurrentFor(lastAttempt)){
        // An explicit retry of a failed save is one bounded read-then-write; a
        // network failure is never rewritten automatically.
        const target=lastAttempt;
        return schedule(()=>saveSelection(target)).then(()=>({retried:true}),()=>({retried:false}));
      }
      // A failed adoption read offers exactly one bounded READ-ONLY recovery
      // for the still-same owner and intent: never a write, never a CAS
      // window, and never an override of a newer manual intent.
      if(adoptionCapture&&restoreCurrent(adoptionCapture)){
        const capture=adoptionCapture;
        return schedule(()=>adoptPipeline(capture)).then(()=>({retried:true}),()=>({retried:false}));
      }
    }
    return Promise.resolve({retried:false});
  };

  const dispose=()=>{
    if(disposed)return;
    // Leaving or logging out invalidates every late read, write and success.
    disposed=true;epoch++;owner=null;binding=null;conflict=null;queued=null;lastAttempt=null;
    restoredCode=null;adoptionCapture=null;
    offIntent();offCommit();
    setPhase('disposed');
  };

  return {
    adoptOwner,
    dispose,
    retry,
    getState,
    onStatus(fn){if(typeof fn!=='function')return()=>{};listeners.add(fn);return()=>{listeners.delete(fn);};}
  };
}
