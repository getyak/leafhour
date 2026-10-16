export const COMPANION_TIMING=Object.freeze({warmupMs:90000,intervalMs:300000,passageMs:8000,chapterMs:45000,idleMs:60000,scrollQuietMs:6000,presentationMs:60000,bubbleMs:12000,maxAttempts:3});

// The clock describes foreground observations, never comprehension or progress.
export function createReaderCompanionState({clock=Date.now}={}){
  let enabled=false,revision=0,scope='',last=null,lastAction=-Infinity,lastScroll=-Infinity,activeMs=0,foregroundMs=0,chapterMs=0,chapterId=null,attempts=0,lastAttemptMs=null,lastAttemptCount=0,observedCount=0;
  const observed=new Map();let latest={};
  const live=value=>enabled&&value.visible&&value.focused&&!value.blocked&&value.eligiblePassage&&!!value.passageId;
  const reset=()=>{last=null;lastAction=-Infinity;lastScroll=-Infinity;activeMs=0;foregroundMs=0;chapterMs=0;chapterId=null;attempts=0;lastAttemptMs=null;lastAttemptCount=0;observedCount=0;observed.clear();latest={};};
  function view(){
    const now=clock(),reading=live(latest)&&now-lastAction<COMPANION_TIMING.idleMs;
    const eligible=!!reading&&chapterMs>=COMPANION_TIMING.chapterMs&&attempts<COMPANION_TIMING.maxAttempts&&(lastAttemptMs===null?activeMs>=COMPANION_TIMING.warmupMs&&observedCount>=2:activeMs-lastAttemptMs>=COMPANION_TIMING.intervalMs&&observedCount-lastAttemptCount>=3);
    return {enabled,revision,activeMs,foregroundMs,chapterMs,attempts,observedIds:[...observed].filter(([,v])=>v>=COMPANION_TIMING.passageMs).map(([id])=>id),eligible,safeToPresent:!!reading&&chapterMs>=COMPANION_TIMING.chapterMs&&now-lastScroll>=COMPANION_TIMING.scrollQuietMs};
  }
  return {
    configure(next){if(enabled===!!next.enabled&&revision===next.revision&&scope===next.scope)return;enabled=!!next.enabled;revision=next.revision;scope=next.scope;reset();},
    activity(kind='reading'){lastAction=clock();if(kind==='scroll')lastScroll=clock();},
    sample(value){
      const now=clock(),elapsed=last===null?0:Math.max(0,Math.min(2000,now-last.at,lastAction+COMPANION_TIMING.idleMs-(last?.at||0)));
      if(enabled&&last&&value.visible&&value.focused&&last.value.visible&&last.value.focused)foregroundMs+=Math.max(0,Math.min(2000,now-last.at));
      if(chapterId!==value.chapterId){chapterId=value.chapterId;chapterMs=0;}
      if(live(value)&&last&&live(last.value)&&now-lastAction<COMPANION_TIMING.idleMs){
        activeMs+=elapsed;if(last.value.chapterId===value.chapterId)chapterMs+=elapsed;
        if(last.value.passageId===value.passageId){const before=observed.get(value.passageId)||0,next=before+elapsed;observed.set(value.passageId,next);if(before<COMPANION_TIMING.passageMs&&next>=COMPANION_TIMING.passageMs)observedCount++;if(observed.size>48)observed.delete(observed.keys().next().value);}
      }
      latest={...value};last={at:now,value:latest};return view();
    },
    attempted(){lastAttemptMs=activeMs;lastAttemptCount=observedCount;attempts++;},
    suspend(){last=null;latest={};},
    view
  };
}
