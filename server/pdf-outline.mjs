// PDF.js explicit destinations may start with a zero-based page number or an
// indirect page reference. Bookmarks are optional: a broken one must not hide
// readable text or prevent resolving the remaining source destinations.
export async function resolvePdfOutline(document){
 let nodes;
 try{nodes=await document.getOutline();}catch{return [];}
 if(!Array.isArray(nodes))return [];
 const pending=[...nodes].reverse(),visited=new Set(),byPage=new Map();
 while(pending.length){
  const node=pending.pop();
  if(!node||typeof node!=='object'||visited.has(node))continue;
  visited.add(node);
  if(Array.isArray(node.items))for(let i=node.items.length-1;i>=0;i--)pending.push(node.items[i]);
  if(typeof node.title!=='string')continue;
  const title=node.title.trim();if(!title||title.length>120)continue;
  try{
   const dest=typeof node.dest==='string'?await document.getDestination(node.dest):node.dest;
   if(!Array.isArray(dest))continue;
   const target=dest[0];let index;
   if(Number.isSafeInteger(target))index=target;
   else if(target&&Number.isSafeInteger(target.num)&&Number.isSafeInteger(target.gen))index=await document.getPageIndex(target);
   else continue;
   if(!Number.isSafeInteger(index)||index<0||index>=document.numPages)continue;
   const page=index+1;if(!byPage.has(page))byPage.set(page,{page,title});
   if(byPage.size>200)return [];
  }catch{ /* Ignore an unresolved optional destination and keep its siblings. */ }
 }
 return [...byPage.values()].sort((a,b)=>a.page-b.page);
}
