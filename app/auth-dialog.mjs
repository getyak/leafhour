import {createAuthFlow,createAuthRequestGuard} from './auth-flow.mjs';
import {t,onUiLocaleChange,uiReady,bindUi,uiHref,getUiLocale} from './ui-locale.mjs';

export function mountAuthDialog({dialog,api,getSession,onAuthenticated,onSessionSettled=async()=>{},getReturnTo}){
  const $=id=>dialog.querySelector('#'+id);
  const requestGuard=createAuthRequestGuard();let flow=createAuthFlow({requestGuard}),timer=null,provisional=null,disposed=false;
  const listeners=[];const listen=(node,event,handler)=>{node.addEventListener(event,handler);listeners.push(()=>node.removeEventListener(event,handler));};
  const unbind=bindUi(dialog);
  function passwordLabels(){for(const button of dialog.querySelectorAll('[data-password-toggle]')){const visible=$(button.dataset.passwordToggle).type==='text';button.textContent=t(visible?'auth.password.hide':'auth.password.show');button.setAttribute('aria-pressed',String(visible));button.setAttribute('aria-label',t('auth.password.'+(visible?'hide':'show')+(button.dataset.passwordToggle==='new-password'?'New':'Login')));}}
  function clearPasswords(){for(const id of ['auth-password','new-password']){$(id).value='';$(id).type='password';}passwordLabels();}
  // Presentation only: no flow mutation, input writes, focus, request or timer
  // restart on a language commit. Deadlines remain owned by the existing flow.
  function updateLabels(){
    if(disposed)return;
    dialog.setAttribute('lang',getUiLocale());
    const v=flow.view(),codeStep=v.step==='code',setup=v.step==='set-password',password=v.method==='password',login=v.purpose==='login';
    $('auth-title').textContent=t('auth.title.'+(setup?'setup':codeStep?'code':v.purpose));
    $('auth-intro').textContent=t('auth.intro.'+(setup?'setup':codeStep?'code':!login?v.purpose:password?'password':'email'));
    $('send-code').textContent=t(v.action==='password'?'auth.entering':v.action==='send'?'auth.sending':password?(v.passwordCooldownSeconds?'auth.password.wait':'auth.enter'):(v.cooldownSeconds?'auth.code.wait':'auth.code.send'),{seconds:password?v.passwordCooldownSeconds:v.cooldownSeconds});
    $('verify-code').textContent=t(v.action==='verify'?'auth.verifying':login?'auth.enter':'auth.email.verify');
    $('save-password').textContent=t(v.action==='save-password'?'auth.password.saving':'auth.password.save');
    $('resend-code').textContent=t(v.action==='send'?'auth.sending':v.cooldownSeconds?'auth.code.resendWait':'auth.code.resend',{seconds:v.cooldownSeconds});
    $('auth-expiry').textContent=v.expired?t('auth.code.expired'):v.delivered?t('auth.code.valid'):'';
    $('auth-availability').textContent=t('auth.availability');
    $('auth-status').textContent=v.error?t(v.error.id):v.action==='send'?t('auth.code.sending'):codeStep&&v.expired?t('auth.code.expiredHelp'):'';
    const sample=dialog.querySelector('.auth-skip');if(sample)sample.href=uiHref('/read?book=gutenberg-alice');
    passwordLabels();
  }
  function render(){
    if(disposed)return;
    const v=flow.view(),session=getSession()||{},codeStep=v.step==='code',setup=v.step==='set-password',password=v.method==='password',login=v.purpose==='login';
    $('auth-email-step').hidden=codeStep||setup;$('auth-code-step').hidden=!codeStep;$('auth-setup-step').hidden=!setup;
    $('auth-password-field').hidden=!password;$('auth-password').required=password&&!codeStep&&!setup;
    $('auth-alternatives').hidden=codeStep||setup||!login;
    $('auth-entry-actions').hidden=setup;
    $('use-code').hidden=!password||!login||codeStep;
    $('use-password').hidden=password&&!codeStep&&login;
    $('forgot-password').hidden=!password||!login||codeStep;
    $('auth-signup').hidden=codeStep||setup||!login||!session.passwordAvailable;
    $('auth-recipient').textContent=v.email;
    if($('email').value.trim().toLowerCase()!==v.email)$('email').value=v.email;
    if($('email-code').value!==v.code)$('email-code').value=v.code;
    for(const id of ['email','email-code','auth-password','new-password'])$(id).disabled=v.busy;
    $('change-email').disabled=!!requestGuard.current();
    $('send-code').disabled=v.busy||!$('email').validity.valid||password&&!$('auth-password').value||(password?!session.passwordAvailable||v.passwordCooldownSeconds>0:!session.emailAvailable||v.cooldownSeconds>0);
    $('verify-code').disabled=v.busy||v.code.length!==v.digits||v.expired;
    $('save-password').disabled=v.busy;
    $('resend-code').disabled=v.busy||!session.emailAvailable||v.cooldownSeconds>0;
    for(const id of ['use-code','forgot-password','create-account'])$(id).disabled=v.busy||!session.emailAvailable;
    $('create-account').disabled||=!session.passwordAvailable;
    $('use-password').disabled=!!requestGuard.current();
    for(const button of dialog.querySelectorAll('[data-password-toggle]'))button.disabled=v.busy;
    for(const provider of ['google','apple']){
      const button=$('login-'+provider),enabled=!!session.providers?.[provider];button.disabled=!enabled||v.busy;
      button.querySelector('.provider-state').hidden=enabled;
    }
    $('auth-availability').hidden=!!(session.emailAvailable||session.passwordAvailable||session.localAvailable||session.providers?.google||session.providers?.apple);
    $('local-entry').hidden=!session.localAvailable;$('local-login').disabled=v.busy;
    dialog.setAttribute('aria-busy',String(v.busy));dialog.dataset.step=v.step;
    $('auth-status').classList.toggle('error',!!v.error);$('auth-status').setAttribute('role',v.error?'alert':'status');
    $('email').setAttribute('aria-invalid',String(!!v.error&&!codeStep&&!setup&&!password));
    $('email-code').setAttribute('aria-invalid',String(!!v.error&&codeStep));
    $('auth-password').setAttribute('aria-invalid',String(!!v.error&&password));
    updateLabels();
  }
  function choose(method,purpose='login'){
    if(disposed)return;
    flow.setEmail($('email').value);if(!flow.choose(method,purpose))return;clearPasswords();render();$('email').focus();
  }
  async function send(){
    if(disposed)return;
    const operation=flow;operation.setEmail($('email').value);const ticket=operation.begin('send');if(!ticket)return;render();
    try{const result=await api('/api/auth/code',{email:ticket.email,purpose:ticket.purpose});if(flow===operation&&operation.sent(ticket,result)){render();$('email-code').focus();}}
    catch(error){if(flow===operation&&operation.failed(ticket,error)){render();if(dialog.open)$(operation.view().step==='code'?'email-code':'email').focus();}}
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
  listen($('email-form'),'submit',e=>{
    e.preventDefault();flow.setEmail($('email').value);
    if(flow.view().method==='code'){send();return;}
    const ticket=flow.begin('password');if(ticket)finish(ticket,'/api/auth/password',{email:ticket.email,password:$('auth-password').value});
  });
  listen($('email'),'input',()=>{flow.setEmail($('email').value);render();});
  listen($('auth-password'),'input',render);
  listen($('email-code'),'input',()=>{flow.setCode($('email-code').value);render();});
  listen($('verify-form'),'submit',e=>{e.preventDefault();const ticket=flow.begin('verify');if(ticket)finish(ticket,'/api/auth/verify',{email:ticket.email,code:ticket.code,purpose:ticket.purpose});});
  listen($('password-setup-form'),'submit',e=>{e.preventDefault();const ticket=flow.begin('save-password');if(ticket)finish(ticket,'/api/auth/password/setup',{password:$('new-password').value,setupToken:provisional?.setupToken});});
  listen($('resend-code'),'click',send);
  listen($('change-email'),'click',()=>{if(flow.changeEmail()){clearPasswords();render();$('email').focus();}});
  listen($('use-code'),'click',()=>choose('code'));
  listen($('use-password'),'click',()=>choose('password'));
  listen($('forgot-password'),'click',()=>choose('code','recovery'));
  listen($('create-account'),'click',()=>choose('code','signup'));
  for(const button of dialog.querySelectorAll('[data-password-toggle]'))listen(button,'click',()=>{const input=$(button.dataset.passwordToggle);input.type=input.type==='password'?'text':'password';passwordLabels();});
  listen($('local-login'),'click',()=>{const ticket=flow.begin('local');if(ticket)finish(ticket,'/api/auth/local',{});});
  for(const provider of ['google','apple'])listen($('login-'+provider),'click',async()=>{
    if(!getSession()?.providers?.[provider])return;const operation=flow,ticket=operation.begin('oauth');if(!ticket)return;render();
    try{const {url}=await api('/api/auth/oauth',{provider,next:getReturnTo()});if(flow===operation&&operation.isCurrent(ticket))location.assign(url);}
    catch(error){if(flow===operation&&operation.failed(ticket,error))render();}
    finally{operation.settled(ticket);render();}
  });
  listen(dialog,'close',()=>{const reconcile=provisional;provisional=null;clearPasswords();flow.close();clearInterval(timer);timer=null;render();if(reconcile)onSessionSettled();});
  const offLocale=onUiLocaleChange(updateLabels);void uiReady.then(updateLabels);updateLabels();
  return {
    open(message){if(disposed)return;flow.open();if(!getSession()?.passwordAvailable&&getSession()?.emailAvailable)flow.choose('code');if(message)flow.notice(message);render();if(!dialog.open)dialog.showModal();clearInterval(timer);timer=setInterval(render,1000);$('email').focus();},
    close(){if(dialog.open)dialog.close();else{clearPasswords();flow.close();}},
    reset(){provisional=null;clearPasswords();flow.close();flow=createAuthFlow({requestGuard});if(dialog.open)dialog.close();render();},
    isSettingPasswordFor:userId=>!!userId&&provisional?.userId===userId&&flow.view().step==='set-password',
    hasPendingSessionChange:()=>!!requestGuard.current(),
    updateCapabilities:render,updateLabels,
    dispose(){if(disposed)return;disposed=true;offLocale();unbind();clearInterval(timer);timer=null;for(const off of listeners)off();clearPasswords();flow.close();if(dialog.open)dialog.close();provisional=null;}
  };
}
