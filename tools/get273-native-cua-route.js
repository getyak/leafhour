// Paste this frozen literal into cua_repl after the genuine controller admits bind.
// No SDK call on load. Only fixed GET-273 scene operations; never reset mid-run.
if(typeof get273NativeRoute!=='undefined')throw Error('GET-273 route already installed; retain existing live handle');
var get273NativeRoute=(()=>{
 let app=null,session=null,sequence=0,lastID=null,pending=null,phase='new',readerURL=null,sdkInFlight=0,methodBusy=false;
 let inputState='none',holdAttempts=0,lastObservationOK=false;
 const check=ok=>{if(!ok)throw Error('GET-273 native route rejected');};
 const live=()=>check(phase!=='blocked'&&phase!=='closed');
 const id=x=>typeof x==='string'&&/^[a-f0-9]{32}$/.test(x);
 const point=p=>Array.isArray(p)&&p.length===2&&p.every(n=>Number.isFinite(n)&&n>=0&&n<=20000);
 const target=p=>Number.isInteger(p)&&p>=0&&p<=1000000||point(p);
 const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).every(k=>keys.includes(k));
 const clicks=['safari-open','safari-more','new-private-tab','private-not-now','entry-focus-address','entry-save-screen','reader-focus-address','reader-show-original','restore-focus-address','restored-save-screen'];
 function admit(t){
  live();check(!pending&&sdkInFlight===0&&exact(t,['session','id','sequence','afterAction','action','payload','stage','kind']));
  check(id(t.session)&&id(t.id)&&t.sequence===sequence+1&&t.afterAction===lastID&&(session===null||session===t.session));
  if(t.action==='bind')check(phase==='new');else check(app!==null);
  session=t.session;sequence=t.sequence;pending=t;
 }
 const receipt=(t,stage)=>({session:t.session,id:t.id,sequence:t.sequence,action:t.action,stage,methodReturned:true,osReleaseVerified:false});
 async function sdk(fn){sdkInFlight++;try{return await fn();}finally{sdkInFlight--;}}
 async function report(v){live();await nodeRepl.write(v);live();return v;}
 async function method(t){
  let inputStarted=false,ownsExecution=false;
  try{
   check(!methodBusy);methodBusy=true;ownsExecution=true;admit(t);check(t.stage==='method-inflight');const p=t.payload??{};phase='method-inflight';
   if(t.action==='bind'){
    check(exact(p,['readerURL']));const u=new URL(p.readerURL);
    check(u.protocol==='http:'&&u.hostname==='127.0.0.1'&&Number(u.port)>1023&&!u.username&&!u.password&&u.pathname==='/read'&&u.search==='?book=touch-fixture&ui=en'&&!u.hash);
    readerURL=p.readerURL;app=await sdk(()=>cua.getApp('com.apple.iphonesimulator'));
   }else if(t.action==='close'){
    check(exact(p,[]));app=null;
    const r={...receipt(t,'closed'),sdkResourcesClosed:false};await report(r);live();pending=null;lastID=t.id;phase='closed';return r;
   }else{
    let action;
    if(t.action==='hold'){check(holdAttempts===0&&exact(p,['point'])&&point(p.point));holdAttempts++;action=()=>app.click(p.point,{durationMs:700});}
    else if(clicks.includes(t.action)){check(exact(p,['target'])&&target(p.target));action=()=>app.click(p.target,{durationMs:120});}
    else if(/^(setup|reader|restore)-address$/.test(t.action)){
     check(exact(p,['index','value'])&&Number.isInteger(p.index)&&p.index>=0&&p.index<=1000000&&p.value===(t.action==='reader-address'?readerURL:'about:blank'));
     action=()=>app.setValue(p.index,p.value);
    }else if(/^(setup|reader|restore)-submit$/.test(t.action)){check(exact(p,[]));action=()=>app.pressKey('Return');}
    else throw Error('Unsupported fixed action');
    inputState='inflight';inputStarted=true;await sdk(action);inputState='returned';
   }
   live();phase='observation-required';return await report(receipt(t,'method-returned'));
  }catch(error){if(inputStarted&&inputState==='inflight')inputState='unknown';phase='blocked';throw error;}finally{if(ownsExecution)methodBusy=false;}
 }
 async function observe(t){
  // Read-only failures do not turn a fulfilled input into an unknown HID call.
  // A still-unresolved read prevents another SDK call; retain the same App.
  if(sdkInFlight!==0)throw Error('Previous SDK call still pending');
  let readAdmitted=false;
  try{
   live();check(!methodBusy);
   if(!pending){check(t.action==='observe');admit(t);}
   else check(phase==='observation-required'&&['session','id','sequence','action'].every(k=>pending[k]===t[k]));
   check(t.stage==='observation-inflight');readAdmitted=true;phase='observation-inflight';lastObservationOK=false;
   const result=await sdk(()=>app.getAXStateAndScreenshot({emit:false,disableDiffing:true}));live();
   check(result&&(typeof result.state==='string'&&result.state.length>0||result.screenshot||result.screenshots?.length));
   // Only fixed labels, never unknown Safari page/URL values or a raw AX dump.
   const allowed=['iPhone 17 Pro','Primary iPhone','Simulator','Safari','New Private Tab','Private','Not Now','Address','Search','Go','Save Screen','Copy','grows','Synthetic selection fixture'];
   const labels=[];for(const line of String(result.state??'').split('\n'))for(const label of allowed)if(line.includes(label)){
    const m=line.match(/^\s*(?:\[)?(\d+)(?:\])?\s/);labels.push({label,index:m?Number(m[1]):null});if(labels.length>=80)break;
   }
   await report({kind:'fixed-native-labels',id:t.id,labels:labels.slice(0,80)});live();
   if(result.screenshot){await nodeRepl.emitImage(result.screenshot);live();}
   if(result.screenshots)for(const r of result.screenshots){
    await report({kind:'actual-image-region',id:t.id,region:r.id,originX:r.originX,originY:r.originY,width:r.width,height:r.height});
    await nodeRepl.emitImage(r.bytes);live();
   }
   const r={...receipt(t,'observed'),observationReturned:true};await report(r);live();
   lastObservationOK=true;lastID=t.id;pending=null;phase='open';return r;
  }catch(error){
   if(!readAdmitted)phase='blocked';
   else if(phase!=='blocked'){lastID=t.id;pending=null;phase='read-failed';}
   throw error;
  }
 }
 return {method,observe,status:()=>({phase,sequence,lastID,pendingID:pending?.id??null,sdkInFlight,methodBusy,inputState,holdAttempts,lastObservationOK,appBound:app!==null,osReleaseVerified:false})};
})();
