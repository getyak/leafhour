// Browser persistence contains dates/preferences only, never the recap itself.
export function createLibraryArrivalState({getOwner,getAccount,dateKey,timeZone,storage,load,canShow,onShow,onHide,locks=null}){
 const memory=new Map(),volatile=new Set();
 let owner=null,revision=0,pending=null,ready=null,disposed=false,shown=false;
 const prefix=()=> 'marginalia:library-arrival:'+encodeURIComponent(getAccount()||'guest');
 const get=key=>{if(volatile.has(key))return memory.get(key);try{return storage?.getItem?storage.getItem(key):memory.get(key);}catch{return memory.get(key);}};
 const put=(key,value)=>{memory.set(key,value);try{storage?.setItem(key,value);}catch{volatile.add(key);}};
 const enabled=()=>!!getAccount()&&get(prefix()+':enabled')!=='false';
 const marker=()=>prefix()+':shown:'+encodeURIComponent(timeZone);
 const stamp=()=>dateKey();
 async function reveal(){
  const value=ready,token=revision,expected=owner,date=stamp();
  if(!value||shown||!enabled()||value.date!==date||!canShow())return;
  const claim=()=>{
   if(disposed||token!==revision||expected!==getOwner()||value!==ready||date!==stamp()||!enabled()||get(marker())===date||!canShow())return;
   put(marker(),date);shown=true;onShow(value);
  };
  if(locks?.request)await locks.request(marker(),claim);else claim();
 }
 function update(){
  if(disposed)return;
  const next=getOwner();if(next!==owner){owner=next;revision++;pending=null;ready=null;shown=false;onHide();}
  if(!owner||!enabled())return;
  const date=stamp();if(get(marker())===date)return;
  if(ready?.date===date){void reveal();return;}
  if(pending?.date===date)return;
  const request={owner,date,revision};pending=request;
  let work;try{work=load();}catch{pending=null;return;}
  Promise.resolve(work).then(value=>{
   if(disposed||request.revision!==revision||request.owner!==getOwner()||request.date!==stamp()||value.date!==stamp()||value.timeZone!==timeZone)return;
   ready=value;shown=false;void reveal();
  }).catch(()=>{}).finally(()=>{if(pending===request)pending=null;});
 }
 return {update,enabled,dismiss(){ready=null;shown=false;onHide();},setEnabled(value){put(prefix()+':enabled',String(!!value));revision++;pending=null;ready=null;shown=false;onHide();if(value)update();},clear(){revision++;owner=null;pending=null;ready=null;shown=false;onHide();},dispose(){disposed=true;revision++;ready=null;pending=null;onHide();}};
}
