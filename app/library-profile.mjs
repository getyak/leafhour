import {t,onUiLocaleChange,uiReady,createUiLabels,createUiMessage} from './ui-locale.mjs';
import {trackActionFocus} from './action-focus.mjs';
const node=(tag,className,text)=>{const element=document.createElement(tag);if(className)element.className=className;if(text!==undefined)element.textContent=text;return element;};
const MAX_AVATAR_BYTES=100*1024;
export function profileInitials(user){
  if(!user)return t('profile.initials.guest');
  const name=(user.displayName||'').trim(),words=name.split(/\s+/).filter(Boolean);
  if(words.length>1)return (Array.from(words[0])[0]+Array.from(words.at(-1))[0]).toLocaleUpperCase();
  return (Array.from(name||user.email||t('profile.initials.reader'))[0]||t('profile.initials.reader')).toLocaleUpperCase();
}
function safeAvatar(value){
  if(typeof value!=='string')return null;
  if(value.length<140000&&/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value))return value;
  if(value.length>2048||/[\s\u0000-\u001f\u007f]/.test(value))return null;
  try{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password?url.href:null;}catch{return null;}
}
export function renderProfileAvatar(holder,user){
  const initials=profileInitials(user),url=safeAvatar(user?.avatarUrl);holder.replaceChildren();holder.textContent=initials;holder.setAttribute('aria-hidden','true');
  if(!url)return;
  const image=node('img');image.alt='';image.referrerPolicy='no-referrer';image.decoding='async';image.src=url;
  image.addEventListener('error',()=>{if(holder.children[0]===image){holder.replaceChildren();holder.textContent=initials;}},{once:true});holder.textContent='';holder.append(image);
}
export async function prepareAvatarFile(file){
  if(!file||!['image/jpeg','image/png','image/webp'].includes(file.type))throw Object.assign(Error(t('profile.error.imageType')),{messageId:'profile.error.imageType'});
  if(file.size>8*1024*1024)throw Object.assign(Error(t('profile.error.imageSize')),{messageId:'profile.error.imageSize'});
  const objectUrl=URL.createObjectURL(file),image=new Image();
  try{
    await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=()=>reject(Error(t('profile.error.imageOpen')));image.src=objectUrl;});
    if(!image.naturalWidth||!image.naturalHeight||image.naturalWidth*image.naturalHeight>40000000)throw Object.assign(Error(t('profile.error.imageDimensions')),{messageId:'profile.error.imageDimensions'});
    const canvas=document.createElement('canvas'),context=canvas.getContext('2d');if(!context)throw Object.assign(Error(t('profile.error.canvas')),{messageId:'profile.error.canvas'});
    const crop=Math.min(image.naturalWidth,image.naturalHeight),x=(image.naturalWidth-crop)/2,y=(image.naturalHeight-crop)/2;
    for(const size of [256,192,128]){
      canvas.width=canvas.height=size;context.fillStyle='#f6f3eb';context.fillRect(0,0,size,size);context.drawImage(image,x,y,crop,crop,0,0,size,size);
      const data=canvas.toDataURL('image/jpeg',.86);if(data.startsWith('data:image/jpeg;base64,')&&(data.length-data.indexOf(',')-1)*3/4<=MAX_AVATAR_BYTES)return data;
    }
    throw Object.assign(Error(t('profile.error.imageLarge')),{messageId:'profile.error.imageLarge'});
  }finally{URL.revokeObjectURL(objectUrl);}
}
export function mountLibraryProfile({root,getSession,api,onProfileUpdated=()=>{}}){
  const L=createUiLabels();
  const form=node('form','account-profile');form.id='account-profile-form';
  const avatarRow=node('div','profile-avatar-editor'),avatar=node('span','profile-avatar sidebar-avatar'),avatarActions=node('div','profile-avatar-actions');
  const uploadLabel=L.text(node('label','profile-avatar-upload text-link'),'profile.avatar.upload'),file=node('input','sr-only');file.type='file';file.id='profile-avatar-file';file.accept='image/jpeg,image/png,image/webp';uploadLabel.htmlFor=file.id;
  const reset=L.text(node('button','profile-avatar-reset text-link'),'profile.avatar.reset');reset.type='button';reset.id='profile-avatar-reset';
  const avatarHelp=L.text(node('p','profile-help'),'profile.avatar.help');avatarActions.append(uploadLabel,file,reset,avatarHelp);avatarRow.append(avatar,avatarActions);
  const nameLabel=L.text(node('label','profile-field-label'),'profile.name.label'),name=node('input','profile-input');name.id='profile-display-name';name.name='displayName';name.maxLength=80;name.autocomplete='nickname';L.attr(name,'placeholder','profile.name.placeholder');nameLabel.htmlFor=name.id;
  const emailLabel=L.text(node('label','profile-field-label'),'profile.email.label'),email=node('input','profile-input');email.id='profile-email';email.type='text';email.readOnly=true;email.autocomplete='email';emailLabel.htmlFor=email.id;
  const identityHelp=L.text(node('p','profile-help'),'profile.identity.help'),save=node('button','primary profile-save');save.id='profile-save';save.type='submit';
  const status=node('p','settings-status profile-status');status.id='profile-status';status.setAttribute('role','status');status.setAttribute('aria-live','polite');
  form.append(avatarRow,nameLabel,name,emailLabel,email,identityHelp,save,status);root.append(form);
  let localRoomEmail=false;
  let sourceSession=null,sourceOwner=null,revision=0,busy=false,preparing=false,pendingAvatar,disposed=false;
  const current=ticket=>!disposed&&revision===ticket.revision&&getSession()===ticket.session&&getSession()?.user?.id===ticket.owner;
  const capture=()=>({revision,session:getSession(),owner:getSession()?.user?.id});
  const message=createUiMessage((text,error)=>{status.textContent=text;status.classList.toggle('error',!!error);});
  function controls(){const blocked=busy||preparing;name.disabled=file.disabled=reset.disabled=blocked;save.disabled=blocked||!getSession()?.user||typeof api!=='function';save.textContent=busy?t('profile.saving'):preparing?t('profile.preparing'):t('profile.save');form.setAttribute('aria-busy',String(blocked));}
  function preview(user=getSession()?.user){renderProfileAvatar(avatar,user?{...user,...(pendingAvatar===undefined?{}:{avatarUrl:pendingAvatar})}:null);}
  function update(){
    if(disposed)return;
    const session=getSession(),user=session?.user;localRoomEmail=user?.kind==='local'&&!user.email;
    if(sourceSession!==session||sourceOwner!==user?.id){sourceSession=session;sourceOwner=user?.id;revision++;busy=preparing=false;pendingAvatar=undefined;name.value=user?.displayName||'';email.value=user?.email||(user?.kind==='local'?t('profile.localRoom'):'');file.value='';message.clear();preview(user);}
    form.hidden=!user;controls();
  }
  file.addEventListener('change',async()=>{
    const selected=file.files?.[0];if(disposed||!selected||busy||preparing||!getSession()?.user)return;
    const ticket=capture();preparing=true;message.set('profile.avatar.preparing');controls();
    try{const data=await prepareAvatarFile(selected);if(!current(ticket))return;pendingAvatar=data;preview();message.set('profile.avatar.ready');}
    catch(error){if(current(ticket))message.set(error.messageId||'ui.generic.error',null,true);}
    finally{if(current(ticket)){preparing=false;file.value='';controls();}}
  });
  reset.addEventListener('click',()=>{if(disposed||busy||preparing)return;pendingAvatar=null;preview({...getSession()?.user,avatarUrl:null});message.set('profile.avatar.resetNote');});
  form.addEventListener('submit',async event=>{
    event.preventDefault();if(disposed||busy||preparing||!getSession()?.user||typeof api!=='function')return;
    const ticket=capture(),displayName=name.value.trim();if([...displayName].length>80||/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/.test(displayName)){message.set('profile.name.invalid',null,true);name.focus();return;}
    const focus=trackActionFocus(document,document.activeElement);busy=true;message.clear();controls();
    try{
      const profile=await api('/api/account/profile',{displayName,...(pendingAvatar===undefined?{}:{avatarData:pendingAvatar})});if(!current(ticket))return;
      onProfileUpdated(profile,ticket.owner);
      if(revision!==ticket.revision||getSession()?.user?.id!==ticket.owner)return;
      name.value=profile.displayName||'';pendingAvatar=undefined;preview({...getSession().user,...profile});message.set('profile.saved');
    }catch(error){if(current(ticket))message.set(error.messageId||'profile.saveFailed',null,true);}
    finally{if(current(ticket)){busy=false;controls();focus.restore(save);}else focus.stop();}
  });
  function updateLabels(){
    if(disposed)return;
    L.refresh();message.refresh();
    save.textContent=busy?t('profile.saving'):preparing?t('profile.preparing'):t('profile.save');
    if(localRoomEmail)email.value=t('profile.localRoom');
  }
  update();const offLocale=onUiLocaleChange(updateLabels);void uiReady.then(updateLabels);
  return {update,updateLabels,clear(){if(disposed)return;sourceSession=null;update();},dispose(){if(disposed)return;disposed=true;revision++;offLocale();L.clear();}};
}
