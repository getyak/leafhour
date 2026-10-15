const node=(tag,className,text)=>{const element=document.createElement(tag);if(className)element.className=className;if(text!==undefined)element.textContent=text;return element;};
const MAX_AVATAR_BYTES=100*1024;
export function profileInitials(user){
  if(!user)return '访';
  const name=(user.displayName||'').trim(),words=name.split(/\s+/).filter(Boolean);
  if(words.length>1)return (Array.from(words[0])[0]+Array.from(words.at(-1))[0]).toLocaleUpperCase();
  return (Array.from(name||user.email||'读')[0]||'读').toLocaleUpperCase();
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
  if(!file||!['image/jpeg','image/png','image/webp'].includes(file.type))throw Error('请选择 JPG、PNG 或 WebP 图片。');
  if(file.size>8*1024*1024)throw Error('请选择 8 MB 以内的图片。');
  const objectUrl=URL.createObjectURL(file),image=new Image();
  try{
    await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=()=>reject(Error('这张图片无法打开，请换一张。'));image.src=objectUrl;});
    if(!image.naturalWidth||!image.naturalHeight||image.naturalWidth*image.naturalHeight>40000000)throw Error('图片尺寸过大，请换一张较小的图片。');
    const canvas=document.createElement('canvas'),context=canvas.getContext('2d');if(!context)throw Error('浏览器暂时无法处理图片，请稍后重试。');
    const crop=Math.min(image.naturalWidth,image.naturalHeight),x=(image.naturalWidth-crop)/2,y=(image.naturalHeight-crop)/2;
    for(const size of [256,192,128]){
      canvas.width=canvas.height=size;context.fillStyle='#f6f3eb';context.fillRect(0,0,size,size);context.drawImage(image,x,y,crop,crop,0,0,size,size);
      const data=canvas.toDataURL('image/jpeg',.86);if(data.startsWith('data:image/jpeg;base64,')&&(data.length-data.indexOf(',')-1)*3/4<=MAX_AVATAR_BYTES)return data;
    }
    throw Error('图片仍然太大，请换一张简单些的图片。');
  }finally{URL.revokeObjectURL(objectUrl);}
}
export function mountLibraryProfile({root,getSession,api,onProfileUpdated=()=>{}}){
  const form=node('form','account-profile');form.id='account-profile-form';
  const avatarRow=node('div','profile-avatar-editor'),avatar=node('span','profile-avatar sidebar-avatar'),avatarActions=node('div','profile-avatar-actions');
  const uploadLabel=node('label','profile-avatar-upload text-link','更换头像'),file=node('input','sr-only');file.type='file';file.id='profile-avatar-file';file.accept='image/jpeg,image/png,image/webp';uploadLabel.htmlFor=file.id;
  const reset=node('button','profile-avatar-reset text-link','恢复默认头像');reset.type='button';reset.id='profile-avatar-reset';
  const avatarHelp=node('p','profile-help','选择一张自己的照片，预览后保存。');avatarActions.append(uploadLabel,file,reset,avatarHelp);avatarRow.append(avatar,avatarActions);
  const nameLabel=node('label','profile-field-label','怎么称呼你'),name=node('input','profile-input');name.id='profile-display-name';name.name='displayName';name.maxLength=80;name.autocomplete='nickname';name.placeholder='写一个自己喜欢的称呼';nameLabel.htmlFor=name.id;
  const emailLabel=node('label','profile-field-label','登录邮箱'),email=node('input','profile-input');email.id='profile-email';email.type='text';email.readOnly=true;email.autocomplete='email';emailLabel.htmlFor=email.id;
  const identityHelp=node('p','profile-help','书籍与阅读记录，保存在这个登录账户。'),save=node('button','primary profile-save','保存个人资料');save.id='profile-save';save.type='submit';
  const status=node('p','settings-status profile-status');status.id='profile-status';status.setAttribute('role','status');status.setAttribute('aria-live','polite');
  form.append(avatarRow,nameLabel,name,emailLabel,email,identityHelp,save,status);root.append(form);
  let sourceSession=null,sourceOwner=null,revision=0,busy=false,preparing=false,pendingAvatar;
  const current=ticket=>revision===ticket.revision&&getSession()===ticket.session&&getSession()?.user?.id===ticket.owner;
  const capture=()=>({revision,session:getSession(),owner:getSession()?.user?.id});
  function message(text,error=false){status.textContent=text;status.classList.toggle('error',error);}
  function controls(){const blocked=busy||preparing;name.disabled=file.disabled=reset.disabled=blocked;save.disabled=blocked||!getSession()?.user||typeof api!=='function';save.textContent=busy?'正在保存…':preparing?'正在处理图片…':'保存个人资料';form.setAttribute('aria-busy',String(blocked));}
  function preview(user=getSession()?.user){renderProfileAvatar(avatar,user?{...user,...(pendingAvatar===undefined?{}:{avatarUrl:pendingAvatar})}:null);}
  function update(){
    const session=getSession(),user=session?.user;
    if(sourceSession!==session||sourceOwner!==user?.id){sourceSession=session;sourceOwner=user?.id;revision++;busy=preparing=false;pendingAvatar=undefined;name.value=user?.displayName||'';email.value=user?.email||(user?.kind==='local'?'本机书房':'');file.value='';message('');preview(user);}
    form.hidden=!user;controls();
  }
  file.addEventListener('change',async()=>{
    const selected=file.files?.[0];if(!selected||busy||preparing||!getSession()?.user)return;
    const ticket=capture();preparing=true;message('正在准备头像预览…');controls();
    try{const data=await prepareAvatarFile(selected);if(!current(ticket))return;pendingAvatar=data;preview();message('头像已准备好，保存后会出现在书房。');}
    catch(error){if(current(ticket))message(error.message,true);}
    finally{if(current(ticket)){preparing=false;file.value='';controls();}}
  });
  reset.addEventListener('click',()=>{if(busy||preparing)return;pendingAvatar=null;preview({...getSession()?.user,avatarUrl:null});message('保存后恢复登录服务提供的头像；没有头像时显示称呼首字。');});
  form.addEventListener('submit',async event=>{
    event.preventDefault();if(busy||preparing||!getSession()?.user||typeof api!=='function')return;
    const ticket=capture(),displayName=name.value.trim();if([...displayName].length>80||/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/.test(displayName)){message('称呼请使用 80 字以内的单行文字。',true);name.focus();return;}
    busy=true;message('');controls();
    try{
      const profile=await api('/api/account/profile',{displayName,...(pendingAvatar===undefined?{}:{avatarData:pendingAvatar})});if(!current(ticket))return;
      onProfileUpdated(profile,ticket.owner);
      if(revision!==ticket.revision||getSession()?.user?.id!==ticket.owner)return;
      name.value=profile.displayName||'';pendingAvatar=undefined;preview({...getSession().user,...profile});message('个人资料已保存。');
    }catch(error){if(current(ticket))message(error.message||'个人资料暂未保存，请重试。',true);}
    finally{if(current(ticket)){busy=false;controls();}}
  });
  update();return {update,clear(){sourceSession=null;update();}};
}
