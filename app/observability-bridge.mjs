import {createBrowserObservability,createReaderObservabilitySignals,findVisibleReaderContent,safeErrorKind} from './observability.mjs';

// Imported after the reader's first usable paint and idle. Before this mount,
// the reader keeps operational opening state, never an analytics event queue.
export function mountReaderObservability({facade,getOwner,document,window,getRoot,getViewport,isPaginated,getStatus,isInteracted,fetcher,operationId=facade.operationId}={}){
  if(operationId!==facade.operationId||!getOwner())return null;
  let disposed=false,reportedFailure=null,resumeObserved=false,resumeFrame=null,resumeEventPending=false,opening=0;
  const collector=createBrowserObservability({getOwner,document,window,page:'reader',initialOperationId:operationId,...(fetcher?{fetcher}:{})});
  const signals=createReaderObservabilitySignals({collector,document,window,isPaginated,getInteractionRoot:getRoot,getContent:()=>findVisibleReaderContent({root:getRoot(),viewport:getViewport(),document,window})});
  const listeners=[];
  const listen=(name,callback,target=document,options)=>{target.addEventListener(name,callback,options);listeners.push(()=>target.removeEventListener(name,callback,options));};
  function currentResume(currentEvent=false){
    if(disposed||resumeObserved||!collector.loaded||!collector.config().analytics||(!currentEvent&&isInteracted()))return;
    const value=getStatus();if(!value||value.failure)return;
    const report=result=>{resumeObserved=true;signals.resumeResult(result);};
    const {position,explicitEntry,skipped,failed,hadSaved}=value;
    if(explicitEntry||skipped){report({resume:'none'});return;}
    if(position){const node=getRoot().querySelector('[data-id="'+position.passageId+'"]'),bounds=getViewport()?.getBoundingClientRect(),rects=node?.getClientRects()||[];
      const restored=[...rects].some(rect=>rect.bottom>Math.max(0,bounds?.top||0)&&rect.top<Math.min(window.innerHeight,bounds?.bottom||window.innerHeight)&&rect.right>Math.max(0,bounds?.left||0)&&rect.left<Math.min(window.innerWidth,bounds?.right||window.innerWidth));
      // Optional page styling can still reflow and restore its scroll after
      // usable paint. Offscreen geometry remains unknown until a real pager
      // scroll/layout makes the saved fragment visible; it is not a failure.
      if(restored)report({resume:'restored',restored:true});return;}
    report({resume:failed?'failed':hadSaved?'missing':'fresh'});
  }
  function scheduleResume(currentEvent=false){if(disposed||resumeObserved||(!currentEvent&&isInteracted()))return;resumeEventPending||=currentEvent;if(resumeFrame!==null)return;const token=opening;resumeFrame=window.requestAnimationFrame(()=>{if(disposed||token!==opening)return;resumeFrame=null;const pending=resumeEventPending;resumeEventPending=false;currentResume(pending);});}
  function reportFailure(){const failure=getStatus()?.failure;if(!failure||failure.expected||failure===reportedFailure)return;if(collector.event('reader_load_failed',{stage:'reader_load',outcome:'failure',errorKind:safeErrorKind(failure)}))reportedFailure=failure;}
  listen('reader:opening',()=>{opening++;window.cancelAnimationFrame(resumeFrame);resumeFrame=null;resumeEventPending=false;resumeObserved=false;reportedFailure=null;signals.start();});
  listen('reader:ready',()=>{signals.contentReady();scheduleResume();});
  listen('reader:resume',()=>scheduleResume(true));listen('reader:failed',reportFailure);
  listen('reader:page',event=>{signals.pageTurned({trusted:event.detail?.trusted===true});scheduleResume();});
  for(const name of ['reader:layout','reader:chapter','reader:content'])listen(name,()=>scheduleResume());
  listen('scroll',()=>scheduleResume(),window,{passive:true,capture:true});listen('resize',()=>scheduleResume(),window,{passive:true});
  facade.requestFailed=collector.requestFailed;facade.refresh=collector.refresh;facade.flush=collector.flush;
  facade.dispose=()=>{if(disposed)return;disposed=true;window.cancelAnimationFrame(resumeFrame);signals.dispose();collector.dispose();for(const off of listeners)off();};
  if(!getStatus()?.failure){signals.start();if(document.body?.dataset.ready==='true')signals.contentReady();}
  void collector.refresh().then(()=>{if(disposed)return;if(getStatus()?.failure)reportFailure();else{signals.observeCurrentOpening();scheduleResume();}});
  return {collector,signals};
}
