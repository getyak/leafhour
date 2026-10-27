// Resource controls live outside reading-layer text, preserving quote offsets.
export function sourceResourceHref(value,base){
 if(typeof value!=='string'||!/^\/book-assets\/[a-z0-9][a-z0-9_.-]*\.(?:png|jpe?g|gif|webp)$/.test(value))return null;
 try{const origin=new URL(base);if(!['https:','http:'].includes(origin.protocol)||origin.username||origin.password)return null;return new URL(value,origin).href;}catch{return null;}
}
export function sourceResourcesNode(document,resources,base){
 if(!Array.isArray(resources)||!resources.length)return null;
 const node=document.createElement('div');node.className='source-resource-links';
 for(const resource of resources){
  const href=sourceResourceHref(resource?.url,base);if(!href||typeof resource.title!=='string'||!resource.title.trim())continue;
  const link=document.createElement('a');link.href=href;link.textContent=resource.title;link.target='_blank';link.rel='noopener noreferrer';node.append(link);
 }
 return node.children.length?node:null;
}
export function applySourceFormat(node,layer){
 if(layer.kind==='original'&&layer.preformatted){node.classList.add('source-preformatted');node.tabIndex=0;}
 return node;
}

const styles=new WeakMap();
export function loadSourceStyles(document){
 if(styles.has(document))return styles.get(document);
 const link=document.createElement('link');link.rel='stylesheet';link.href='/source-resources.css';
 const pending=new Promise((resolve,reject)=>{
  const finish=error=>{clearTimeout(timer);link.onload=link.onerror=null;if(error){styles.delete(document);link.remove();reject(Error('Source styles could not load'));}else resolve();};
  const timer=setTimeout(()=>finish(true),15000);link.onload=()=>finish(false);link.onerror=()=>finish(true);
 });
 styles.set(document,pending);document.head.append(link);return pending;
}
