// Small range requests survive slow links without discarding completed ranges.
// Resume data lives only in this reader tab, scoped to the original hash.
export async function downloadOriginalParts(options){
 if(!options.parts.every(p=>Number.isSafeInteger(p.size)&&p.size>0))return downloadLegacyParts(options);
 const {sha256,bytes,fetcher=fetch,onProgress=()=>{},onBytes=()=>{},rangeFetcher,refreshParts,refreshTimeoutMs=30000,resume={}}=options;let parts=options.parts;
 if(parts.reduce((n,p)=>n+p.size,0)!==bytes)throw Error('原文件分块大小无法核验');
 const rangeBytes=rangeFetcher?1048576:256*1024,signature=sha256+':'+rangeBytes+':'+parts.map(p=>p.size).join(',');
 if(resume.signature!==signature){resume.signature=signature;resume.chunks=new Map();}
 const ranges=[];let globalOffset=0;
 for(let part=0;part<parts.length;part++){for(let start=0;start<parts[part].size;start+=rangeBytes)ranges.push({part,start,end:Math.min(parts[part].size,start+rangeBytes)-1,offset:globalOffset+start});globalOffset+=parts[part].size;}
 const chunks=resume.chunks,inflight=new Map(),controller=new AbortController();let next=0,failure=null,refreshing=null;
 const report=()=>{onBytes([...chunks.values()].reduce((n,b)=>n+b.byteLength,0)+[...inflight.values()].reduce((n,b)=>n+b,0),bytes);onProgress(chunks.size,ranges.length);};
 const renew=()=>{if(!refreshParts)return Promise.reject(Error('原文件下载链接已过期，请重试'));return refreshing??=(async()=>{const own=new AbortController(),abort=()=>own.abort();let rejectAbort;const cancelled=new Promise((_,reject)=>{rejectAbort=()=>reject(Error('原文件下载链接刷新中断'));own.signal.addEventListener('abort',rejectAbort,{once:true});});controller.signal.addEventListener('abort',abort,{once:true});const timer=setTimeout(abort,Math.max(1,Math.min(60000,refreshTimeoutMs)));try{if(controller.signal.aborted)abort();const renewed=await Promise.race([Promise.resolve().then(()=>refreshParts({signal:own.signal})),cancelled]);if(renewed.length!==parts.length||renewed.some((p,i)=>p.size!==parts[i].size||p.sha256!==parts[i].sha256))throw Error('原文件分块信息已改变，请重新打开书籍');parts=renewed;}finally{clearTimeout(timer);controller.signal.removeEventListener('abort',abort);own.signal.removeEventListener('abort',rejectAbort);own.abort();refreshing=null;}})();};
 async function readRange(range){
  for(let attempt=0;attempt<5;attempt++){
   const own=new AbortController(),abort=()=>own.abort();controller.signal.addEventListener('abort',abort,{once:true});let timer=setTimeout(()=>own.abort(),60000);
   try{
    const response=rangeFetcher?await rangeFetcher({offset:range.offset,length:range.end-range.start+1,signal:own.signal}):await fetcher(parts[range.part].url,{headers:{Range:'bytes='+range.start+'-'+range.end},signal:own.signal,cache:'no-store'});
    if(!rangeFetcher&&[401,403].includes(response.status)){await renew();throw Error('下载链接已更新，正在重试');}
    if(response.status!==206)throw Error('原文件分段暂时无法读取，请重试');
    const expected=range.end-range.start+1,contentRange=response.headers.get('Content-Range');
    if(contentRange&&contentRange!==(rangeFetcher?'bytes '+range.offset+'-'+(range.offset+expected-1)+'/'+bytes:'bytes '+range.start+'-'+range.end+'/'+parts[range.part].size))throw Error('原文件分段校验失败');
    const buffer=new Uint8Array(expected);let length=0;
    if(response.body?.getReader){const reader=response.body.getReader();try{while(true){const item=await reader.read();if(item.done)break;if(length+item.value.length>expected)throw Error('原文件分段校验失败');buffer.set(item.value,length);length+=item.value.length;inflight.set(range.offset,length);report();clearTimeout(timer);timer=setTimeout(()=>own.abort(),30000);}}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}}
    else{const raw=new Uint8Array(await response.arrayBuffer());if(raw.length!==expected)throw Error('原文件分段校验失败');buffer.set(raw);length=raw.length;}
    if(length!==expected)throw Error('原文件分段未完整传输');chunks.set(range.offset,buffer);inflight.delete(range.offset);report();return;
   }catch(error){inflight.delete(range.offset);if(controller.signal.aborted||attempt===4)throw error;}
   finally{clearTimeout(timer);controller.signal.removeEventListener('abort',abort);own.abort();}
  }
 }
 report();await Promise.all(Array.from({length:Math.min(12,ranges.length)},async()=>{while(!failure&&next<ranges.length){const range=ranges[next++];if(chunks.has(range.offset))continue;try{await readRange(range);}catch(error){if(!failure){failure=error;controller.abort();}}}}));
 if(failure)throw Error('网络中断，已完成的部分保留在当前页面，点击下载可继续。');
 const blob=new Blob(ranges.map(r=>chunks.get(r.offset)));if(blob.size!==bytes)throw Error('原文件校验失败，请重新下载');
 const sum=[...new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))].map(n=>n.toString(16).padStart(2,'0')).join('');if(sum!==sha256){chunks.clear();throw Error('原文件校验失败，请重新下载');}return blob;
}

// Bounded parallel reads keep large originals within signed-link lifetimes.
// Completion order never changes source order, and no download is offered until
// the entire original matches the recorded byte count and SHA-256.
async function downloadLegacyParts({parts,sha256,bytes,fetcher=fetch,onProgress=()=>{},onBytes=()=>{}}){
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
