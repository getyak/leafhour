import {createBrowserObservability,createReaderObservabilitySignals,findVisibleReaderContent,safeErrorKind} from './observability.mjs';

// Imported after the reader's first usable paint and idle. Before this mount,
// the reader keeps operational opening state, never an analytics event queue.
export function mountReaderObservability({facade,getOwner,document,window,getRoot,getViewport,isPaginated,getStatus,isInteracted,fetcher,operationId=facade.operationId}={}){
  if(operationId!==facade.operationId||!getOwner())return null;
  let disposed=false,reportedFailure=null;
  const collector=createBrowserObservability({getOwner,document,window,page:'reader',initialOperationId:operationId,...(fetcher?{fetcher}:{})});
  const signals=createReaderObservabilitySignals({collector,document,window,isPaginated,getInteractionRoot:getRoot,getContent:()=>findVisibleReaderContent({root:getRoot(),viewport:getViewport(),document,window})});
  const listeners=[];
  const listen=(name,callback)=>{document.addEventListener(name,callback);listeners.push(()=>document.removeEventListener(name,callback));};
  function currentResume(){
    const value=getStatus();if(!value)return;
    const {position,explicitEntry,skipped,failed,hadSaved}=value;
    if(explicitEntry||skipped){signals.resumeResult({resume:'none'});return;}
    if(position){const node=getRoot().querySelector('[data-id="'+position.passageId+'"]'),bounds=getViewport()?.getBoundingClientRect(),rects=node?.getClientRects()||[];
      const restored=[...rects].some(rect=>rect.bottom>Math.max(0,bounds?.top||0)&&rect.top<Math.min(window.innerHeight,bounds?.bottom||window.innerHeight)&&rect.right>Math.max(0,bounds?.left||0)&&rect.left<Math.min(window.innerWidth,bounds?.right||window.innerWidth));signals.resumeResult(restored?{resume:'restored',restored:true}:{resume:'failed'});return;}
    signals.resumeResult({resume:failed?'failed':hadSaved?'missing':'fresh'});
  }
  function reportFailure(){const failure=getStatus()?.failure;if(!failure||failure.expected||failure===reportedFailure)return;if(collector.event('reader_load_failed',{stage:'reader_load',outcome:'failure',errorKind:safeErrorKind(failure)}))reportedFailure=failure;}
  listen('reader:opening',()=>{reportedFailure=null;signals.start();});
  listen('reader:ready',()=>signals.contentReady());
  listen('reader:resume',currentResume);listen('reader:failed',reportFailure);
  listen('reader:page',event=>signals.pageTurned({trusted:event.detail?.trusted===true}));
  facade.requestFailed=collector.requestFailed;facade.refresh=collector.refresh;facade.flush=collector.flush;
  facade.dispose=()=>{if(disposed)return;disposed=true;signals.dispose();collector.dispose();for(const off of listeners)off();};
  if(!getStatus()?.failure){signals.start();if(document.body?.dataset.ready==='true')signals.contentReady();if(!isInteracted())currentResume();}
  void collector.refresh().then(()=>{if(disposed)return;if(getStatus()?.failure)reportFailure();else signals.observeCurrentOpening();});
  return {collector,signals};
}
