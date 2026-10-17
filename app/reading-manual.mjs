import {normalizeReadingSession} from './reading-session-record.mjs';

export function localReadingTimestamp(value){
 const match=typeof value==='string'&&value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
 if(!match)throw Error('请填写完整的本地开始与结束时间。');
 const [year,month,day,hour,minute]=match.slice(1).map(Number),date=new Date(0);date.setFullYear(year,month-1,day);date.setHours(hour,minute,0,0);
 if(year<1||date.getFullYear()!==year||date.getMonth()!==month-1||date.getDate()!==day||date.getHours()!==hour||date.getMinutes()!==minute)throw Error('这个本地日期或时间不存在，请核对日期与夏令时。');
 return date.toISOString();
}
export function manualReadingSession({id,book,anchor,timeZone,startedAt,endedAt},now=Date.now()){
 return normalizeReadingSession({id,bookId:book.bookId,contentVersion:book.contentVersion,source:'manual',status:'finished',sequence:1,timeZone,startedAt,endedAt,start:anchor,end:anchor,segments:[{startedAt,endedAt}]},book,now);
}
// The frozen request also survives a failed local write in memory. The caller
// includes pending() in its recovery export; only an exact receipt releases it.
export function createManualReadingAction({build,own,enqueue,flush,confirmed}){
 let pending=null,owned=false,durable=false,running=null;
 const acknowledge=()=>{if(!pending||!confirmed(pending))return null;const saved=structuredClone(pending);pending=null;owned=false;durable=false;return saved;};
 function retry(){
  if(running)return running;
  const work=async()=>{
   if(!pending)throw Error('没有待确认的手动补记。');
   const already=acknowledge();if(already)return already;
   if(!owned){own(pending.id);owned=true;}
   enqueue(pending);durable=true;
   const result=await flush(),saved=acknowledge();if(saved)return saved;
   throw result?.error||Error('服务尚未确认这次手动补记，请重试同一次提交。');
  };
  running=work();const active=running;active.finally(()=>{if(running===active)running=null;}).catch(()=>{});return active;
 }
 return {pending:()=>pending?structuredClone(pending):null,durable:()=>durable,reconcile:()=>running?null:acknowledge(),retry,submit(input){if(!pending){pending=structuredClone(build(input));owned=false;durable=false;}return retry();}};
}
