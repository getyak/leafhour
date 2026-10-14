import {createAuthFlow,createAuthRequestGuard} from './auth-flow.mjs';

export function mountAuthDialog({dialog,api,getSession,onAuthenticated,onSessionSettled=async()=>{},getReturnTo}){
  const $=id=>dialog.querySelector('#'+id);
  const requestGuard=createAuthRequestGuard();let flow=createAuthFlow({requestGuard}),timer=null;
  function render(){
    const v=flow.view(),session=getSession()||{},codeStep=v.step==='code';
    $('auth-email-step').hidden=codeStep;$('auth-code-step').hidden=!codeStep;
    $('auth-title').textContent=codeStep?'查看你的邮箱':'进入你的书房';
    $('auth-intro').textContent=codeStep?'输入邮件里的 6 位验证码。':'保存自己的书，接着上次读。';
    $('auth-recipient').textContent=v.email;
    if($('email').value.trim().toLowerCase()!==v.email)$('email').value=v.email;
    if($('email-code').value!==v.code)$('email-code').value=v.code;
    $('email').disabled=v.busy;$('email-code').disabled=v.busy;
    $('change-email').disabled=!!requestGuard.current();
    $('send-code').disabled=v.busy||!session.emailAvailable||v.cooldownSeconds>0;
    $('send-code').textContent=v.cooldownSeconds&&!v.busy?v.cooldownSeconds+' 秒后可发送':'继续';
    $('verify-code').disabled=v.busy||v.code.length!==v.digits||v.expired;
    $('verify-code').textContent=v.action==='verify'?'正在进入…':'进入书房';
    $('resend-code').disabled=v.busy||!session.emailAvailable||v.cooldownSeconds>0;
    $('resend-code').textContent=v.action==='send'?'正在发送…':v.cooldownSeconds?'重新发送 · '+v.cooldownSeconds+' 秒':'重新发送验证码';
    for(const provider of ['google','apple']){
      const button=$('login-'+provider),enabled=!!session.providers?.[provider];button.disabled=!enabled||v.busy;
      button.querySelector('.provider-state').hidden=enabled;
      button.setAttribute('aria-describedby',enabled?'':'auth-availability');
    }
    $('auth-availability').hidden=!!session.emailAvailable&&!!session.providers?.google&&!!session.providers?.apple;
    $('auth-availability').textContent=session.emailAvailable?'标注“准备中”的登录方式暂未开放。':session.localAvailable?'邮箱登录准备中，也可以进入本机书房。':'登录服务准备中，可以先试读。';
    $('local-entry').hidden=!session.localAvailable;$('local-login').disabled=v.busy;
    dialog.setAttribute('aria-busy',String(v.busy));
    $('auth-status').classList.toggle('error',!!v.error);
    $('auth-status').textContent=v.error||(v.action==='send'?'正在发送验证码…':v.expired?'验证码已过期，请重新发送。':codeStep&&v.delivered?'验证码已发送，10 分钟内有效。':'');
    $('email-code').setAttribute('aria-invalid',String(!!v.error&&codeStep));
  }
  async function send(){
    flow.setEmail($('email').value);const ticket=flow.begin('send');if(!ticket)return;render();
    try{const result=await api('/api/auth/code',{email:ticket.email});if(flow.sent(ticket,result)){render();$('email-code').focus();}}
    catch(error){if(flow.failed(ticket,error)){render();if(dialog.open)$('email-code').focus();}}
  }
  async function finish(ticket,url,body){
    const operation=flow;render();
    try{await api(url,body);if(!operation.verified(ticket)){await onSessionSettled();return;}dialog.close();await onAuthenticated();}
    catch(error){if(operation.failed(ticket,error)){render();if(dialog.open&&ticket.action==='verify')$('email-code').focus();}else await onSessionSettled();}
    finally{operation.settled(ticket);render();if(flow===operation&&dialog.open&&flow.view().error&&ticket.action==='verify')$('email-code').focus();}
  }
  $('email-form').addEventListener('submit',e=>{e.preventDefault();send();});
  $('email').addEventListener('input',()=>flow.setEmail($('email').value));
  $('email-code').addEventListener('input',()=>{flow.setCode($('email-code').value);render();});
  $('verify-form').addEventListener('submit',e=>{e.preventDefault();const ticket=flow.begin('verify');if(ticket)finish(ticket,'/api/auth/verify',{email:ticket.email,code:ticket.code});});
  $('resend-code').addEventListener('click',send);
  $('change-email').addEventListener('click',()=>{if(flow.changeEmail()){render();$('email').focus();}});
  $('local-login').addEventListener('click',()=>{const ticket=flow.begin('local');if(ticket)finish(ticket,'/api/auth/local',{});});
  for(const provider of ['google','apple'])$('login-'+provider).addEventListener('click',async()=>{
    if(!getSession()?.providers?.[provider])return;const operation=flow,ticket=operation.begin('oauth');if(!ticket)return;render();
    try{const {url}=await api('/api/auth/oauth',{provider,next:getReturnTo()});if(operation.isCurrent(ticket))location.assign(url);}
    catch(error){if(operation.failed(ticket,error))render();}
    finally{operation.settled(ticket);render();}
  });
  dialog.addEventListener('close',()=>{flow.close();clearInterval(timer);timer=null;render();});
  return {
    open(message){flow.open();if(message)flow.notice(message);render();if(!dialog.open)dialog.showModal();clearInterval(timer);timer=setInterval(render,1000);(flow.view().step==='code'?$('email-code'):$('email')).focus();},
    close(){if(dialog.open)dialog.close();else flow.close();},
    reset(){flow.close();flow=createAuthFlow({requestGuard});if(dialog.open)dialog.close();render();},
    updateCapabilities:render
  };
}
