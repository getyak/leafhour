// Bounded parallel reads keep large originals within signed-link lifetimes.
// Completion order never changes source order, and no download is offered until
// the entire original matches the recorded byte count and SHA-256.
export async function downloadOriginalParts({parts,sha256,bytes,fetcher=fetch,onProgress=()=>{}}){
 const chunks=new Array(parts.length);let next=0,done=0;
 await Promise.all(Array.from({length:Math.min(6,parts.length)},async()=>{while(next<parts.length){const i=next++,response=await fetcher(parts[i].url);if(!response.ok)throw Error('原文件下载链接已过期，请重试');chunks[i]=await response.arrayBuffer();onProgress(++done,parts.length);}}));
 const blob=new Blob(chunks);if(blob.size!==bytes)throw Error('原文件校验失败，请重新下载');
 const sum=[...new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))].map(n=>n.toString(16).padStart(2,'0')).join('');
 if(sum!==sha256)throw Error('原文件校验失败，请重新下载');return blob;
}
