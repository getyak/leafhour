import {introductionFor} from './book-introduction.mjs';

// Closing or switching the source invalidates callbacks even if fetch ignores
// cancellation. A metadata read never implicitly starts a paid generation.
export function createIntroductionController({getBook,request,onChange=()=>{},onSaved=()=>{}}){
  let epoch=0,controller=null,busy=false,active=false;
  const initial=()=>({...introductionFor(getBook()),bookId:getBook()?.bookId,contentVersion:getBook()?.contentVersion,introduction:getBook()?.introduction||null,available:true,phase:'idle',error:''});
  let state=initial();
  function publish(value){state=value;onChange({...state});}
  async function run(generating){
    const book=getBook();if(!book)return;
    if(generating&&busy)return;
    if(generating&&introductionFor(book).source!=='missing'){publish(initial());return;}
    controller?.abort();controller=new AbortController();const signal=controller.signal,ticket=++epoch,id=book.bookId,version=book.contentVersion;
    active=true;busy=generating;
    const current=()=>active&&ticket===epoch&&getBook()?.bookId===id&&getBook()?.contentVersion===version;
    publish({...initial(),phase:generating?'generating':'loading'});
    try{
      const data=await request(generating?{contentVersion:version}:undefined,{signal});
      if(!current())return;
      if(data.introduction)onSaved(data.introduction);
      publish({...data,bookId:id,contentVersion:version,phase:'idle',error:''});
    }catch(error){if(current()&&!signal.aborted)publish({...initial(),phase:'error',error:error.message||'暂时无法读取简介，可以稍后重试。'});}
    finally{if(ticket===epoch)busy=false;}
  }
  return {open:()=>run(false),generate:()=>run(true),snapshot:()=>({...state}),close:()=>{active=false;epoch++;busy=false;controller?.abort();controller=null;state=initial();}};
}
