import {createAuthFlow,createAuthRequestGuard} from './auth-flow.mjs';

export function mountAuthDialog({dialog,api,getSession,onAuthenticated,onSessionSettled=async()=>{},getReturnTo}){
  const $=id=>dialog.querySelector('#'+id);
  const requestGuard=createAuthRequestGuard();let flow=createAuthFlow({requestGuard}),timer=null,provisional=null;
  function clearPasswords(){for(const id of ['auth-password','new-password']){$(id).value='';$(id).type='password';}for(const button of dialog.querySelectorAll('[data-password-toggle]')){button.textContent='显示';button.setAttribute('aria-pressed','false');}}
  function render(){
    const v=flow.view(),session=getSession()||{},codeStep=v.step==='code',setup=v.step==='set-password',password=v.method==='password',login=v.purpose==='login';
    $('auth-email-step').hidden=codeStep||setup;$('auth-code-step').hidden=!codeStep;$('auth-setup-step').hidden=!setup;
    $('auth-password-field').hidden=!password;$('auth-password').required=password&&!codeStep&&!setup;
    $('auth-alternatives').hidden=codeStep||setup||!login;
    $('auth-entry-actions').hidden=setup;
    $('use-code').hidden=!password||!login||codeStep;
    $('use-password').hidden=password&&!codeStep&&login;
    $('forgot-password').hidden=!password||!login||codeStep;
    $('auth-signup').hidden=codeStep||setup||!login||!session.passwordAvailable;
    $('auth-title').textContent=setup?'设置登录密码':codeStep?'验证你的邮箱':v.purpose==='signup'?'创建你的书房':v.purpose==='recovery'?'找回密码':'回到你的书房';
    $('auth-intro').textContent=setup?'下次，直接用密码进入。':codeStep?'输入邮件中的 6 位验证码。':v.purpose==='signup'?'验证邮箱后，设置你的登录密码。':v.purpose==='recovery'?'验证邮箱后，重新设置密码。':password?'从上次停下的地方继续。':'不用密码，也能接着读。';
    $('auth-recipient').textContent=v.email;
    if($('email').value.trim().toLowerCase()!==v.email)$('email').value=v.email;
    if($('email-code').value!==v.code)$('email-code').value=v.code;
    for(const id of ['email','email-code','auth-password','new-password'])$(id).disabled=v.busy;
    $('change-email').disabled=!!requestGuard.current();
    $('send-code').disabled=v.busy||(password?!session.passwordAvailable||v.passwordCooldownSeconds>0:!session.emailAvailable||v.cooldownSeconds>0);
    $('send-code').textContent=v.action==='password'?'正在进入…':v.action==='send'?'正在发送…':password?(v.passwordCooldownSeconds?v.passwordCooldownSeconds+' 秒后重试':'进入书房'):(v.cooldownSeconds?v.cooldownSeconds+' 秒后可发送':'发送验证码');
    $('verify-code').disabled=v.busy||v.code.length!==v.digits||v.expired;
    $('verify-code').textContent=v.action==='verify'?'正在验证…':login?'进入书房':'验证邮箱';
    $('save-password').disabled=v.busy;
    $('save-password').textContent=v.action==='save-password'?'正在保存…':'保存并进入书房';
    $('resend-code').disabled=v.busy||!session.emailAvailable||v.cooldownSeconds>0;
    $('resend-code').textContent=v.action==='send'?'正在发送…':v.cooldownSeconds?v.cooldownSeconds+' 秒后重发':'重新发送';
    $('auth-expiry').textContent=v.expired?'验证码已过期':v.delivered?'10 分钟内有效':'';
    for(const id of ['use-code','forgot-password','create-account'])$(id).disabled=v.busy||!session.emailAvailable;
    $('create-account').disabled||=!session.passwordAvailable;
    $('use-password').disabled=!!requestGuard.current();
    for(const button of dialog.querySelectorAll('[data-password-toggle]'))button.disabled=v.busy;
    for(const provider of ['google','apple']){
      const button=$('login-'+provider),enabled=!!session.providers?.[provider];button.disabled=!enabled||v.busy;
      button.querySelector('.provider-state').hidden=enabled;
    }
    $('auth-availability').hidden=!!(session.emailAvailable||session.passwordAvailable||session.localAvailable||session.providers?.google||session.providers?.apple);
    $('auth-availability').textContent='登录服务暂时不可用，可以先试读。';
    $('local-entry').hidden=!session.localAvailable;$('local-login').disabled=v.busy;
    dialog.setAttribute('aria-busy',String(v.busy));dialog.dataset.step=v.step;
    $('auth-status').classList.toggle('error',!!v.error);
    $('auth-status').textContent=v.error||(v.action==='send'?'正在发送验证码…':codeStep&&v.expired?'验证码已过期，请重新发送。':'');
    $('email-code').setAttribute('aria-invalid',String(!!v.error&&codeStep));
    $('auth-password').setAttribute('aria-invalid',String(!!v.error&&password));
  }
  function choose(method,purpose='login'){
    flow.setEmail($('email').value);if(!flow.choose(method,purpose))return;clearPasswords();render();$('email').focus();
  }
  async function send(){
    const operation=flow;operation.setEmail($('email').value);const ticket=operation.begin('send');if(!ticket)return;render();
    try{const result=await api('/api/auth/code',{email:ticket.email,purpose:ticket.purpose});if(flow===operation&&operation.sent(ticket,result)){render();$('email-code').focus();}}
    catch(error){if(flow===operation&&operation.failed(ticket,error)){render();if(dialog.open)$('email-code').focus();}}
  }
  async function finish(ticket,url,body){
    const operation=flow;render();
    try{
      const result=await api(url,body);
      if(flow!==operation||!operation.verified(ticket,result)){await onSessionSettled();return;}
      clearPasswords();
      if(operation.view().step==='set-password'){provisional={userId:result.user.id,setupToken:result.passwordSetupToken};render();await onSessionSettled();if(flow===operation&&dialog.open)$('new-password').focus();return;}
      provisional=null;dialog.close();await onAuthenticated();
    }catch(error){if(flow===operation&&operation.failed(ticket,error)){render();if(dialog.open)(ticket.action==='password'?$('auth-password'):ticket.action==='save-password'?$('new-password'):$('email-code')).focus();}else await onSessionSettled();}
    finally{operation.settled(ticket);render();if(flow===operation&&dialog.open){const v=operation.view();if(v.step==='set-password')$('new-password').focus();else if(v.error)(ticket.action==='password'?$('auth-password'):$('email-code')).focus();}}
  }
  $('email-form').addEventListener('submit',e=>{
    e.preventDefault();flow.setEmail($('email').value);
    if(flow.view().method==='code'){send();return;}
    const ticket=flow.begin('password');if(ticket)finish(ticket,'/api/auth/password',{email:ticket.email,password:$('auth-password').value});
  });
  $('email').addEventListener('input',()=>flow.setEmail($('email').value));
  $('email-code').addEventListener('input',()=>{flow.setCode($('email-code').value);render();});
  $('verify-form').addEventListener('submit',e=>{e.preventDefault();const ticket=flow.begin('verify');if(ticket)finish(ticket,'/api/auth/verify',{email:ticket.email,code:ticket.code,purpose:ticket.purpose});});
  $('password-setup-form').addEventListener('submit',e=>{e.preventDefault();const ticket=flow.begin('save-password');if(ticket)finish(ticket,'/api/auth/password/setup',{password:$('new-password').value,setupToken:provisional?.setupToken});});
  $('resend-code').addEventListener('click',send);
  $('change-email').addEventListener('click',()=>{if(flow.changeEmail()){clearPasswords();render();$('email').focus();}});
  $('use-code').addEventListener('click',()=>choose('code'));
  $('use-password').addEventListener('click',()=>choose('password'));
  $('forgot-password').addEventListener('click',()=>choose('code','recovery'));
  $('create-account').addEventListener('click',()=>choose('code','signup'));
  for(const button of dialog.querySelectorAll('[data-password-toggle]'))button.addEventListener('click',()=>{const input=$(button.dataset.passwordToggle),visible=input.type==='password';input.type=visible?'text':'password';button.textContent=visible?'隐藏':'显示';button.setAttribute('aria-pressed',String(visible));});
  $('local-login').addEventListener('click',()=>{const ticket=flow.begin('local');if(ticket)finish(ticket,'/api/auth/local',{});});
  for(const provider of ['google','apple'])$('login-'+provider).addEventListener('click',async()=>{
    if(!getSession()?.providers?.[provider])return;const operation=flow,ticket=operation.begin('oauth');if(!ticket)return;render();
    try{const {url}=await api('/api/auth/oauth',{provider,next:getReturnTo()});if(flow===operation&&operation.isCurrent(ticket))location.assign(url);}
    catch(error){if(flow===operation&&operation.failed(ticket,error))render();}
    finally{operation.settled(ticket);render();}
  });
  dialog.addEventListener('close',()=>{const reconcile=provisional;provisional=null;clearPasswords();flow.close();clearInterval(timer);timer=null;render();if(reconcile)onSessionSettled();});
  return {
    open(message){flow.open();if(!getSession()?.passwordAvailable&&getSession()?.emailAvailable)flow.choose('code');if(message)flow.notice(message);render();if(!dialog.open)dialog.showModal();clearInterval(timer);timer=setInterval(render,1000);$('email').focus();},
    close(){if(dialog.open)dialog.close();else{clearPasswords();flow.close();}},
    reset(){provisional=null;clearPasswords();flow.close();flow=createAuthFlow({requestGuard});if(dialog.open)dialog.close();render();},
    isSettingPasswordFor:userId=>!!userId&&provisional?.userId===userId&&flow.view().step==='set-password',
    hasPendingSessionChange:()=>!!requestGuard.current(),
    updateCapabilities:render
  };
}
