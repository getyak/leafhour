import {localReadingTimestamp} from './reading-manual.mjs';

const localMinute=stamp=>{const d=new Date(stamp),pad=n=>String(n).padStart(2,'0');return String(d.getFullYear()).padStart(4,'0')+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate())+'T'+pad(d.getHours())+':'+pad(d.getMinutes());};
const actualRange=row=>{const f=new Intl.DateTimeFormat('zh-CN',{timeZone:row.timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',timeZoneName:'shortOffset'});return f.format(new Date(row.startedAt))+' → '+f.format(new Date(row.endedAt));};
export function mountManualReading({root,getContext,getAction,onOpen=()=>{},onSaved=()=>{},onFailure=()=>{},now=Date.now}){
 const $=selector=>root.querySelector(selector),start=$('#manual-reading-start'),end=$('#manual-reading-end'),save=$('#manual-reading-save'),status=$('#manual-reading-status'),preview=$('#manual-reading-preview'),close=$('[data-manual-close]');let context=null,busy=false,done=false;
 function refresh(){const pending=getAction()?.pending();start.disabled=end.disabled=busy||!!pending||done;save.disabled=busy||done;save.textContent=busy?'正在保存…':pending?'重试同一次补记':'保存补记';if(pending)preview.textContent=actualRange(pending);}
 function confirm(row){if(!row)return;done=true;status.textContent='手动补记（自报）已保存到自己的书房。';preview.textContent=actualRange(row);refresh();onSaved(row);}
 const ui={confirm,refresh,open(){
  if(!getAction())return false;onOpen();context=getContext();done=false;status.textContent='';const pending=getAction().pending(),at=Math.floor(now()/60000)*60000;
  start.value=localMinute(pending?.startedAt||at-15*60000);end.value=localMinute(pending?.endedAt||at);$('#manual-reading-zone').textContent='设备时区：'+context.timeZone+' · 记录到《'+(context.book.title.zh||context.book.title.en)+'》当前原文位置。';
  preview.textContent=pending?actualRange(pending):'提交前会核对实际时刻；夏令时重复时间采用设备选定的偏移。';if(pending)status.textContent='上次补记尚未确认，重试会保留原时间与标识。';refresh();root.showModal();(pending?save:start).focus();return true;
 }};
 close.addEventListener('click',()=>root.close());
 $('form').addEventListener('submit',async event=>{
  event.preventDefault();if(busy||done)return;busy=true;
  try{
   const current=getContext();if(!context||current.book.bookId!==context.book.bookId||current.book.contentVersion!==context.book.contentVersion)throw Error('书籍已经变化，请重新打开补记。');
   const action=getAction();let input;
   if(!action.pending()){
    if(context.timeZone!==Intl.DateTimeFormat().resolvedOptions().timeZone)throw Error('设备时区已变化，请核对输入后重新打开补记。');
    input={...context,id:crypto.randomUUID(),startedAt:localReadingTimestamp(start.value),endedAt:localReadingTimestamp(end.value)};
    preview.textContent=actualRange(input);
   }
   refresh();const row=await action.submit(input);confirm(row);
  }catch(error){const action=getAction(),pending=action?.pending();status.textContent=(pending?'手动补记尚未确认。'+(action.durable()?'时段已留本机，刷新后可续传。':'时段仅在当前页面，请重试或另存待同步记录。')+' 重试保留同一次提交。 ':'')+error.message;onFailure(error);
  }finally{busy=false;refresh();if(root.open&&root.ownerDocument.activeElement===root.ownerDocument.body)(done?close:save).focus();}
 });
 return ui;
}
