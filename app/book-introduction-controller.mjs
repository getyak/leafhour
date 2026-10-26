import {introductionFor} from './book-introduction.mjs';

// Metadata reads and explicit generation share one bounded foreground lifetime.
// Retrying a read never starts generation. Closing, owner/source changes and
// timeouts fence even a transport that ignores cancellation.
export function createIntroductionController({getBook,getOwner=()=>null,request,onChange=()=>{},onSaved=()=>{},timeoutMs=15000,generationTimeoutMs=65000}){
  let epoch=0,controller=null,pending=null,stamp=null;
  const initial=()=>({...introductionFor(getBook()),bookId:getBook()?.bookId,contentVersion:getBook()?.contentVersion,introduction:getBook()?.introduction||null,available:null,phase:'idle',error:'',errorKind:null});
  let state=initial();
  const publish=value=>{state=value;onChange({...state});};
  const current=s=>s===stamp&&s.epoch===epoch&&getBook()?.bookId===s.id&&getBook()?.contentVersion===s.version&&getOwner()===s.owner;
  function run(generating){
    const book=getBook();if(!book)return Promise.resolve();
    if(pending&&current(stamp))return generating?Promise.resolve():pending;
    if(generating&&introductionFor(book).source!=='missing'){publish(initial());return Promise.resolve();}
    controller?.abort();controller=new AbortController();const {signal}=controller;
    const captured=stamp={epoch:++epoch,id:book.bookId,version:book.contentVersion,owner:getOwner()};
    const available=state.bookId===book.bookId&&state.contentVersion===book.contentVersion?state.available:null;
    publish({...initial(),available,phase:generating?'generating':'loading'});
    const job=(async()=>{
      let timer,abort;
      const interrupted=new Promise((_,reject)=>{abort=()=>reject(signal.reason||new DOMException('Aborted','AbortError'));signal.addEventListener('abort',abort,{once:true});});
      const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{const error=new DOMException('Introduction timed out','TimeoutError');reject(error);controller?.abort(error);},generating?generationTimeoutMs:timeoutMs);});
      try{
        const data=await Promise.race([request(generating?{contentVersion:captured.version}:undefined,{signal}),interrupted,timeout]);
        if(!current(captured))return;
        if(!data||!['provided','ai','missing'].includes(data.source)||typeof data.text!=='string'||!data.text.isWellFormed()||(data.source==='missing'?!!data.text.trim():!data.text.trim()))throw Error('Invalid introduction metadata');
        if(data.introduction)onSaved(data.introduction);
        // The supplied catalogue description remains authoritative even if an
        // optional account overlay is absent or has failed to load.
        const provided=introductionFor(book);
        publish({...data,...(provided.source==='provided'?provided:{}),bookId:captured.id,contentVersion:captured.version,phase:'idle',error:'',errorKind:null});
      }catch(error){
        if(!current(captured)||signal.aborted&&error.name!=='TimeoutError')return;
        const kind=error.name==='TimeoutError'||error.status===504?'timeout':error.status===401||error.status===403?'access':error.status===429?'busy':error.status===409?'changed':generating?'generate':'load';
        publish({...initial(),available,phase:'error',error:'Introduction unavailable',errorKind:kind});
      }finally{clearTimeout(timer);signal.removeEventListener('abort',abort);if(stamp===captured)pending=null;}
    })();
    pending=job;return job;
  }
  return {open:()=>run(false),generate:()=>run(true),snapshot:()=>({...state}),close:()=>{epoch++;stamp=null;pending=null;controller?.abort();controller=null;state=initial();}};
}
