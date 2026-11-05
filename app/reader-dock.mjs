import {mountSquirrelPosition,resolveUnobstructedPosition} from './squirrel-position.mjs';

const styles=new WeakMap();
export function loadReaderDockStyles(document){
 if(styles.has(document))return styles.get(document);
 const link=document.createElement('link');link.rel='stylesheet';link.href='/reader-dock.css';
 const pending=new Promise(resolve=>{
  const finish=ready=>{link.removeEventListener('load',loaded);link.removeEventListener('error',failed);if(!ready){link.remove();styles.delete(document);}resolve(ready);};
  const loaded=()=>finish(true),failed=()=>finish(false);link.addEventListener('load',loaded);link.addEventListener('error',failed);(document.head||document.querySelector('head')).append(link);
 });
 styles.set(document,pending);return pending;
}

// Presentation only: reuse the mounted conversation trigger and real settings.
export function mountReaderDock({document=globalThis.document,window=document.defaultView,onSettings=()=>{},onLayout=()=>{},labels=()=>({}),getSession=()=>null,getLoginReturn,mountPosition=mountSquirrelPosition}={}){
 const root=document.getElementById('reader-dock'),settings=document.getElementById('reader-dock-settings'),host=document.getElementById('reading-tools-chat-slot'),trigger=host?.querySelector('.library-chat-trigger');
 if(!root||!settings||!host||!trigger)return {unmount(){},updateLabels(){}};
 const original=host.parentElement,next=host.nextSibling,listeners=[];
 let disposed=false,frame=null,position,moving=false,login=null,loginReady=null;
 root.append(host);root.hidden=false;document.body.classList.add('has-reader-dock');
 const listen=(node,type,fn,options)=>{node?.addEventListener(type,fn,options);listeners.push(()=>node?.removeEventListener(type,fn,options));};
 const obstacles=()=>['book-page','audio-player','note-panel','reading-header','reading-tools-panel'].flatMap(id=>{
  const node=document.getElementById(id);if(!node||node.hidden||node.inert||id==='reading-header'&&node.getAttribute('aria-hidden')==='true'||id==='reading-tools-panel'&&node.getAttribute('aria-hidden')==='true')return [];
  const box=node.getBoundingClientRect();return box.width>0&&box.height>0?[box]:[];
 });
 const layout=()=>{frame=null;if(!disposed){position?.layout();if(moving)frame=window.requestAnimationFrame(layout);}};
 const schedule=()=>{if(!disposed&&frame===null)frame=window.requestAnimationFrame(layout);};
 position=mountPosition({launcher:root,handle:trigger,window,storageKey:'marginalia:reader-dock-position:v1',labels:labels(),resolvePosition:point=>resolveUnobstructedPosition({...point,obstacles:obstacles()}),onLayout});
 listen(settings,'click',()=>{if(!disposed)onSettings();});
 for(const type of ['reader:layout','reader:focus','reader:page','reader:chapter','reader:ready','reader:chat-layout','reader:tools-open'])listen(document,type,schedule);
 listen(window,'scroll',schedule,{passive:true});
 const page=document.getElementById('book-page');
 listen(page,'transitionrun',event=>{if(event.target===page&&event.propertyName==='transform'){moving=true;schedule();}});
 for(const type of ['transitionend','transitioncancel'])listen(page,type,event=>{if(event.target===page&&event.propertyName==='transform'){moving=false;schedule();}});
 const Resize=window.ResizeObserver,resize=Resize?new Resize(schedule):null;
 for(const id of ['book-page','reader-dock','audio-player']){const node=document.getElementById(id);if(node)resize?.observe(node);}
 const Observer=window.MutationObserver,observer=Observer?new Observer(()=>{const player=document.getElementById('audio-player');if(player)resize?.observe(player);schedule();}):null;
 observer?.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['hidden','class','aria-hidden']});
 layout();
 return {openLogin(){return (loginReady??=import('./reader-login.mjs').then(module=>{if(!disposed)login=module.mountReaderLogin({document,session:getSession(),getReturnTo:getLoginReturn});})).then(()=>{if(!disposed)return login.open();}).catch(error=>{loginReady=null;throw error;});},updateLabels(){if(!disposed)position.updateLabels(labels());},unmount(){if(disposed)return;disposed=true;login?.dispose();window.cancelAnimationFrame(frame);observer?.disconnect();resize?.disconnect();position.dispose();for(const off of listeners)off();if(original?.isConnected!==false)original.insertBefore(host,next?.parentElement===original?next:null);root.hidden=true;document.body.classList.remove('has-reader-dock');}};
}
