// GET-273 single-scene ledger. External owner/device/files are the only test seams.
// Tickets and operator-reported CUA results are NOT authenticated OS evidence.
import {randomBytes} from 'node:crypto';
const ID=()=>randomBytes(16).toString('hex');
const check=(ok)=>{if(!ok)throw Error('Native protocol rejected');};
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).every(k=>keys.includes(k));
const point=p=>Array.isArray(p)&&p.length===2&&p.every(n=>Number.isFinite(n)&&n>=0&&n<=20000);
const target=p=>Number.isInteger(p)&&p>=0&&p<=1000000||point(p);
const CLICKS={setup:['safari-open','safari-more','new-private-tab','private-not-now','entry-focus-address','entry-save-screen'],reader:['reader-focus-address','reader-show-original'],restore:['restore-focus-address','restored-save-screen']};
export function createNativeSession({entryExpected,assertOwner,assertAdmission,device,createFixture,contextProof,persist,hold,now=Date.now}){
 const session=ID(),started=now();let phase='new',section='setup',pending=null,busy=false,sequence=0,lastID=null,lastView=null;
 let fixture=null,origin=null,entryState=null,ownedBoot=false,contextObligation=false,entryProof=null,restoredProof=null,routeBound=false,routeClosed=false;
 const usedActions=new Set();
 let inputState='none',holdAttempts=0,readerReady=false,observationFailures=0,reason=null;
 const status=()=>({session,phase,section,pending:pending?structuredClone(pending):null,sequence,lastID,inputState,holdAttempts,readerReady,observationFailures,
  entryState,ownedBoot,contextObligation,contextRestored:restoredProof!==null,routeBound,routeClosed,cleanupComplete:phase==='stopped',handoffReady:phase==='stopped',osReleaseVerified:false,nativeAcceptance:'unrun',reason});
 function journal(kind,detail={}){persist({kind,...status(),...detail});}
 function block(code){if(phase==='stopped'||phase==='blocked')return status();phase='blocked';reason=code;hold(true);try{journal('blocked');}catch{}return status();}
 function live(){check(!['blocked','stopped'].includes(phase));}
 async function own(){await assertOwner();live();}
 async function windowOwn(){await own();check(await device.state()==='Booted');live();}
 async function run(fn){try{live();return await fn();}catch{return block('operation-rejected-or-unconfirmed');}}
 function issue(action,payload,kind='method'){
  const ticket={session,id:ID(),sequence:++sequence,afterAction:lastID,action,payload,stage:kind==='method'?'method-inflight':'observation-inflight'};
  pending={...ticket,kind};journal('admitted');return structuredClone(ticket);
 }
 function match(r,stage){check(exact(r,['session','id','sequence','action','stage','methodReturned','osReleaseVerified','observationReturned','sdkResourcesClosed']));check(pending&&r.session===session&&r.id===pending.id&&r.sequence===pending.sequence&&r.action===pending.action&&r.stage===stage&&r.methodReturned===true&&r.osReleaseVerified===false);}
 async function start(){
  check(phase==='new');hold(true);phase='starting';busy=true;
  try{
   await assertAdmission();live();await own();check(['Booted','Shutdown'].includes(entryExpected));entryState=await device.state();live();check(entryState===entryExpected);
   if(entryState==='Shutdown'){ownedBoot=true;await own();await device.boot();live();await own();check(await device.state()==='Booted');live();}
   fixture=await createFixture();live();origin=await fixture.listen();live();const u=new URL(origin);check(u.protocol==='http:'&&u.hostname==='127.0.0.1'&&Number(u.port)>1023&&u.origin===origin&&!u.username&&!u.password);
   contextObligation=true;phase='setup';journal('awaiting-owned-private-context',{fixtureOrigin:origin});return {...status(),fixtureOrigin:origin};
  }catch{return block('initialization-unconfirmed');}finally{busy=false;}
 }
 function admit(action,payload={}){return run(async()=>{
  check(!busy&&!pending&&phase===section);busy=true;
  try{
   if(action==='bind')check(!routeBound&&section==='setup'&&exact(payload,[]));
   else {check(routeBound&&!routeClosed&&lastView?.id===lastID&&lastView.primaryWindow&&lastView.desktopFocus);}
   if(section==='reader'&&holdAttempts>0)check(action==='close');
   if(action!=='bind'&&action!=='close'&&action!=='hold')check(!usedActions.has(action));
   if(action==='close')check(restoredProof&&section==='restore');
   else if(action==='hold'){check(section==='reader'&&readerReady&&holdAttempts===0&&lastView.view==='owned-reader'&&lastView.targetVisible&&exact(payload,['point'])&&point(payload.point));}
   else if(CLICKS[section]?.includes(action))check(exact(payload,['target'])&&target(payload.target));
   else if(action===section+'-address')check(['setup','reader','restore'].includes(section)&&exact(payload,['index'])&&Number.isInteger(payload.index)&&payload.index>=0&&payload.index<=1000000&&lastView.view==='owned-address');
   else if(action===section+'-submit')check(exact(payload,[])&&lastView.view==='owned-address');
   else check(action==='bind'||action==='close');
   if(section!=='restore'){await assertAdmission();live();}
   await windowOwn();check(!pending);
   if(action==='hold')holdAttempts++;else if(action!=='bind'&&action!=='close')usedActions.add(action);
   if(action!=='bind'&&action!=='close')inputState='inflight';
   const sent=action==='bind'?{readerURL:origin+'/read?book=touch-fixture&ui=en'}:{...payload};if(action.endsWith('-address'))sent.value=section==='reader'?origin+'/read?book=touch-fixture&ui=en':'about:blank';
   return issue(action,sent);
  }finally{busy=false;}
 });}
 function methodOK(r){return run(async()=>{
  check(!busy);match(r,'method-returned');check(pending.kind==='method'&&r.action!=='close');busy=true;
  try{
   if(r.action==='bind')routeBound=true;else inputState='returned';
   pending={...pending,kind:'observation',stage:'observation-inflight'};phase='observing';lastView=null;
   journal('method-returned');await windowOwn();journal('observation-admitted');return structuredClone({...pending});
  }finally{busy=false;}
 });}
 function observe(){return run(async()=>{
  check(!busy&&!pending&&routeBound&&!routeClosed);busy=true;
  try{await windowOwn();lastView=null;phase='observing';return issue('observe',{},'observation');}finally{busy=false;}
 });}
 function observed(r){return run(async()=>{
  check(!busy);match(r,'observed');check(pending.kind==='observation'&&r.observationReturned===true);busy=true;
  try{await windowOwn();lastID=pending.id;pending=null;phase=section;journal('observed');return {id:lastID,...status()};}finally{busy=false;}
 });}
 function view(v){return run(async()=>{
  check(!busy&&!pending&&phase===section&&v.id===lastID&&exact(v,['id','primaryWindow','desktopFocus','view','privateContext','targetVisible']));
  check(v.primaryWindow===true&&v.desktopFocus===true&&['primary-home','owned-private-blank','owned-reader','owned-address'].includes(v.view));
  check(typeof v.privateContext==='boolean'&&typeof v.targetVisible==='boolean');lastView={...v};journal('operator-view');return status();
 });}
 function entry(){return run(async()=>{
  check(!busy&&!pending&&phase==='setup'&&lastView?.id===lastID&&lastView.view==='owned-private-blank'&&lastView.privateContext);busy=true;
  try{await windowOwn();entryProof=await contextProof('entry');live();section='reader';phase='reader';journal('entry-proof',{entryProof});return status();}finally{busy=false;}
 });}
 function ready(){return run(async()=>{
  check(!busy&&!pending&&phase==='reader'&&entryProof&&lastView?.id===lastID&&lastView.view==='owned-reader'&&lastView.privateContext&&lastView.targetVisible);busy=true;
  try{await windowOwn();const report=fixture.report(),docs=new Set(report.events.filter(e=>e.kind==='observer-ready'&&e.seq===0).map(e=>e.documentId));
   check(report.violations.length===0&&report.events.some(e=>e.kind==='reader-ready'&&docs.has(e.documentId)));readerReady=true;journal('reader-ready');return status();
  }finally{busy=false;}
 });}
 function restore(){return run(async()=>{
  check(!busy&&!pending&&routeBound&&!routeClosed&&inputState!=='inflight');busy=true;
  try{await windowOwn();section='restore';phase='restore';lastView=null;journal('restore-admitted');return status();}finally{busy=false;}
 });}
 function restored(){return run(async()=>{
  check(!busy&&!pending&&phase==='restore'&&lastView?.id===lastID&&lastView.view==='owned-private-blank'&&lastView.privateContext);busy=true;
  try{await windowOwn();restoredProof=await contextProof('restored');live();journal('restored-proof',{restoredProof});return status();}finally{busy=false;}
 });}
 function closed(r){return run(async()=>{
  match(r,'closed');check(!busy&&pending.kind==='method'&&r.action==='close'&&r.sdkResourcesClosed===false&&restoredProof);busy=true;
  try{await windowOwn();lastID=pending.id;pending=null;routeClosed=true;journal('route-closed');return status();}finally{busy=false;}
 });}
 function inputError(v){if(!pending||v.id!==pending.id)return Promise.resolve(block('input-error-id'));inputState='unknown';return Promise.resolve(block('input-error-or-timeout'));}
 function observationError(v){return run(async()=>{check(!busy&&pending?.kind==='observation'&&v.id===pending.id);lastID=pending.id;pending=null;observationFailures++;lastView=null;phase='observing';journal('observation-failed-input-unchanged');return status();});}
 function finish(){return run(async()=>{
  check(!busy&&!pending&&inputState!=='inflight'&&inputState!=='unknown'&&(!contextObligation||restoredProof)&&(!routeBound||routeClosed));busy=true;phase='closing';
  try{
   await own();if(fixture){journal('fixture-observations',{report:fixture.report()});await fixture.close();live();}
   await own();let state=await device.state();live();
   if(ownedBoot&&state==='Booted'){await own();await device.shutdown();live();await own();state=await device.state();live();}
   check(state===entryState);journal('stopped',{phase:'stopped',cleanupComplete:true,handoffReady:true,entryProof,restoredProof});phase='stopped';hold(false);return status();
  }finally{busy=false;}
 });}
 function expire(){if(now()-started>=600000)return Promise.resolve(block('window-ended-hold'));return Promise.resolve(status());}
 return {start,status,admit,methodOK,observe,observed,view,entry,ready,restore,restored,closed,inputError,observationError,finish,expire,block};
}
