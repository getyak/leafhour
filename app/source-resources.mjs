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
