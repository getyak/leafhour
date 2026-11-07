// Layout, QR and export code wait for an explicit Share action.
const triggers=['show-share','share-passage'].map(id=>document.getElementById(id)).filter(Boolean);
let loading;
async function open(event){
 const trigger=event.currentTarget;
 if(loading)return;
 let intent;
 try{const reader=window.marginaliaReader;intent={snapshot:structuredClone(reader.getShareIntent(trigger.id==='share-passage')),owner:reader.getOwner?.()??'guest',anchor:reader.getAnchor(),trigger};}
 catch{return;}
 trigger.disabled=true;
 const styles=new Promise((resolve,reject)=>{const link=document.createElement('link');link.rel='stylesheet';link.href='/share.css';link.onload=resolve;link.onerror=()=>{link.remove();reject(Error('share styles'));};document.head.append(link);});
 loading=Promise.all([import('./share.js'),styles]);
 try{const [panel]=await loading;for(const button of triggers)button.removeEventListener('click',open);trigger.disabled=false;panel.openShareIntent(intent);}
 catch{loading=null;trigger.disabled=false;trigger.focus();}
}
for(const button of triggers)button.addEventListener('click',open);
