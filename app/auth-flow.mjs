// The clock owns cooldowns; request tickets keep delayed responses out of a new flow.
export function createAuthRequestGuard(){
  let pending=null;
  return {current:()=>pending,reserve(ticket){if(pending)return false;pending=ticket;return true;},release(ticket){if(pending===ticket)pending=null;}};
}
export function createAuthFlow({clock=Date.now,digits=6,requestGuard=createAuthRequestGuard()}={}){
  let email='',code='',step='email',busy=false,action=null,error='',delivered=false,expiresAt=0,serial=0;
  const cooldowns=new Map();
  const wait=seconds=>Math.max(0,Math.min(3600,Number.isFinite(Number(seconds))?Number(seconds):60));
  const deadline=seconds=>{cooldowns.set(email,clock()+wait(seconds)*1000);if(cooldowns.size>128)cooldowns.delete(cooldowns.keys().next().value);};
  const current=ticket=>!!ticket&&busy&&ticket.serial===serial&&ticket.email===email;
  const view=()=>({email,code,step,busy:busy||!!requestGuard.current(),action:action||requestGuard.current()?.action||null,error,delivered,digits,expired:!!expiresAt&&clock()>=expiresAt,cooldownSeconds:Math.max(0,Math.ceil(((cooldowns.get(email)||0)-clock())/1000))});
  return {
    view,
    isCurrent:current,
    settled:ticket=>requestGuard.release(ticket),
    setEmail(value){if(!view().busy&&step==='email')email=String(value).trim().toLowerCase();},
    setCode(value){if(!view().busy&&step==='code')code=String(value).replace(/\D/g,'').slice(0,digits);},
    begin(kind){
      if(view().busy||step==='success')return null;
      if(kind==='send'){
        if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||view().cooldownSeconds)return null;
        deadline(60);step='code';delivered=false;code='';expiresAt=0;
      }else if(kind==='verify'&&(step!=='code'||code.length!==digits||view().expired))return null;
      const ticket={serial:++serial,email,code,action:kind};if(['verify','local','oauth'].includes(kind)&&!requestGuard.reserve(ticket))return null;
      busy=true;action=kind;error='';return ticket;
    },
    sent(ticket,result){if(!current(ticket)||ticket.action!=='send')return false;deadline(result.retryAfter??60);expiresAt=clock()+wait(result.expiresIn??600)*1000;busy=false;action=null;delivered=true;return true;},
    failed(ticket,cause){if(!current(ticket))return false;if(cause.retryAfter)deadline(cause.retryAfter);busy=false;action=null;error=cause.message||'暂时无法完成，请稍后重试。';return true;},
    verified(ticket){if(!current(ticket))return false;serial++;busy=false;action=null;step='success';code='';error='';return true;},
    changeEmail(){if(requestGuard.current())return false;serial++;busy=false;action=null;step='email';code='';error='';delivered=false;expiresAt=0;return true;},
    close(){serial++;busy=false;action=null;code='';},
    open(){},
    notice(message){error=message;}
  };
}
