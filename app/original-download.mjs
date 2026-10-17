// Bounded parallel reads keep large originals within signed-link lifetimes.
// Completion order never changes source order, and no download is offered until
// the entire original matches the recorded byte count and SHA-256.
export async function downloadOriginalParts({parts,sha256,bytes,fetcher=fetch,onProgress=()=>{},onBytes=()=>{}}){
 const chunks=new Array(parts.length),controller=new AbortController();let next=0,done=0,received=0,failure=null;
 const account=length=>{if(failure)return;received+=length;if(received>bytes)throw Error('原文件校验失败，请重新下载');onBytes(received,bytes);};
 async function readPart(response){
  if(!response.body?.getReader){const buffer=await response.arrayBuffer();account(buffer.byteLength);return buffer;}
  const reader=response.body.getReader(),segments=[];let length=0;
  const cancel=()=>{reader.cancel().catch(()=>{});};controller.signal.addEventListener('abort',cancel,{once:true});
  try{while(!failure){const item=await reader.read();if(item.done)break;if(failure)break;account(item.value.byteLength);segments.push(item.value);length+=item.value.byteLength;}}
  catch(error){await reader.cancel().catch(()=>{});throw error;}
  finally{controller.signal.removeEventListener('abort',cancel);reader.releaseLock();}
  const buffer=new Uint8Array(length);let offset=0;for(const segment of segments){buffer.set(segment,offset);offset+=segment.byteLength;}return buffer.buffer;
 }
 await Promise.all(Array.from({length:Math.min(6,parts.length)},async()=>{while(!failure&&next<parts.length){try{const i=next++,response=await fetcher(parts[i].url,{signal:controller.signal});if(!response.ok)throw Error('原文件下载链接已过期，请重试');chunks[i]=await readPart(response);if(!failure)onProgress(++done,parts.length);}catch(error){if(!failure){failure=error;controller.abort();}}}}));
 if(failure)throw failure;
 const blob=new Blob(chunks);if(blob.size!==bytes)throw Error('原文件校验失败，请重新下载');
 const sum=[...new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))].map(n=>n.toString(16).padStart(2,'0')).join('');
 if(sum!==sha256)throw Error('原文件校验失败，请重新下载');return blob;
}
