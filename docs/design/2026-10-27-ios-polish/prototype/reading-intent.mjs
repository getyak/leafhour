export const CHROME_IDLE_MS=3000;
export const HOLD_MS=420;
export const HOLD_SLOP=8;
export const initialIntent=()=>({kind:'pure',expiresAt:null,pinned:false});
export function transitionIntent(state,event,now){
  if(event.type==='pure')return initialIntent();
  if(['top','progress'].includes(event.type))return {kind:event.type,expiresAt:now+CHROME_IDLE_MS,pinned:false};
  if(['sheet','selection'].includes(event.type))return {kind:event.type,expiresAt:null,pinned:false};
  if(event.type==='pin'&&['top','progress'].includes(state.kind))return {...state,pinned:true};
  if(event.type==='unpin'&&['top','progress'].includes(state.kind))return {...state,pinned:false,expiresAt:now+CHROME_IDLE_MS};
  if(event.type==='read'&&['top','progress'].includes(state.kind))return initialIntent();
  if(event.type==='tick'&&!state.pinned&&state.expiresAt!==null&&now>=state.expiresAt)return initialIntent();
  return state;
}
export function startHold({id,pointerType,x,y,passageId,isPrimary=true,button=0},now){
  if(!['touch','pen'].includes(pointerType)||!isPrimary||button!==0||!passageId)return null;
  return {id,x,y,passageId,startedAt:now,cancelled:false};
}
export function moveHold(hold,{id,x,y}){
  if(!hold||hold.id!==id)return hold;
  return {...hold,cancelled:hold.cancelled||Math.hypot(x-hold.x,y-hold.y)>HOLD_SLOP};
}
export const holdReady=(hold,now)=>!!hold&&!hold.cancelled&&now-hold.startedAt>=HOLD_MS;
