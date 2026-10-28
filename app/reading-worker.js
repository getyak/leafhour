/* Replaced only by the public offline-resource build. Never cache API data. */
const OFFLINE_RELEASE=null/* LEAFHOUR_OFFLINE_RELEASE */;
const GROUP_PREFIX='leafhour-reading-static-v1:',PIN_CACHE='leafhour-reading-client-pins-v1';
const DESCRIPTOR='/__leafhour-offline__/release';
const UNKNOWN_CLIENT_POLICY='/__leafhour-offline__/unknown-clients';
const livePins=new Map();
const readerRoutes=new Set(['/read','/read.html','/_ui/read','/en/read','/zh-hans/read','/zh-hant/read','/ja/read']);
const shelfRoutes=new Set(['/offline','/offline.html']);
const libraryRoutes=new Set(['/library','/_ui/library','/library.html']);
const absolute=url=>new URL(url,self.location.origin).href;
const groupName=version=>GROUP_PREFIX+version;
const pinUrl=clientId=>absolute('/__leafhour-offline__/client/'+encodeURIComponent(clientId));
const hex=buffer=>Array.from(new Uint8Array(buffer),byte=>byte.toString(16).padStart(2,'0')).join('');
const validResource=entry=>entry&&typeof entry.url==='string'&&/^\/(?!\/|api(?:\/|$))[^?#]*$/.test(entry.url)&&!entry.url.includes('..')&&Number.isSafeInteger(entry.bytes)&&entry.bytes>=0&&/^[a-f0-9]{64}$/.test(entry.sha256);
const validRelease=release=>release&&/^[a-f0-9]{64}$/.test(release.version)&&['/offline-reader','/offline-reader.html'].includes(release.readerShell)&&['/offline','/offline.html'].includes(release.offlineShelf)&&Array.isArray(release.readerEntries)&&release.readerEntries.every(url=>/^\/reader-web\/reader-[a-f0-9]{16}\.js$/.test(url))&&Array.isArray(release.resources)&&release.resources.length>0&&release.resources.every(validResource)&&new Set(release.resources.map(entry=>entry.url)).size===release.resources.length;

async function verified(response,entry){
 if(!response||!response.ok||response.type==='opaque'||response.redirected)return false;
 const bytes=await response.clone().arrayBuffer();return bytes.byteLength===entry.bytes&&hex(await crypto.subtle.digest('SHA-256',bytes))===entry.sha256;
}
async function publicResponse(response){
 // Recreate the reviewed public bytes with only their media type. Session,
 // account, redirect, Vary and cookie headers never enter the static cache.
 return new Response(await response.arrayBuffer(),{status:200,headers:{'Content-Type':response.headers.get('Content-Type')||'application/octet-stream'}});
}
async function prepared(release){
 if(!validRelease(release)||!(await caches.keys()).includes(groupName(release.version)))return false;
 const cache=await caches.open(groupName(release.version)),descriptor=await cache.match(absolute(DESCRIPTOR));if(!descriptor)return false;
 let saved;try{saved=await descriptor.json();}catch{return false;}
 if(JSON.stringify(saved)!==JSON.stringify(release))return false;
 for(const entry of release.resources)if(!await verified(await cache.match(absolute(entry.url)),entry))return false;
 return true;
}
async function readRelease(version){
 if(!/^[a-f0-9]{64}$/.test(version||''))return null;
 if(version===OFFLINE_RELEASE?.version)return OFFLINE_RELEASE;
 if(!(await caches.keys()).includes(groupName(version)))return null;
 try{const response=await (await caches.open(groupName(version))).match(absolute(DESCRIPTOR));const release=await response?.json();return validRelease(release)&&release.version===version?release:null;}catch{return null;}
}
async function pin(clientId,version){if(!clientId)return false;livePins.set(clientId,version);try{await (await caches.open(PIN_CACHE)).put(pinUrl(clientId),new Response(version));return true;}catch{return false;}}
async function clientPin(clientId){
 if(livePins.has(clientId))return livePins.get(clientId);
 const value=clientId?await (await caches.open(PIN_CACHE)).match(pinUrl(clientId)):null;return value?value.text():null;
}
async function clientRelease(clientId){
 try{const value=await clientPin(clientId);if(value)return readRelease(value);const fenced=await (await caches.open(PIN_CACHE)).match(absolute(UNKNOWN_CLIENT_POLICY));return fenced?null:OFFLINE_RELEASE;}catch{return null;}
}
async function releaseForEntry(entry){
 if(typeof entry!=='string'||!/^\/reader-web\/reader-[a-f0-9]{16}\.js$/.test(entry))return null;
 if(OFFLINE_RELEASE?.readerEntries.includes(entry)&&await prepared(OFFLINE_RELEASE))return OFFLINE_RELEASE;
 for(const name of await caches.keys())if(name.startsWith(GROUP_PREFIX)&&name!==groupName(OFFLINE_RELEASE?.version)){
  const release=await readRelease(name.slice(GROUP_PREFIX.length));if(release?.readerEntries.includes(entry)&&await prepared(release))return release;
 }
 return null;
}
async function compatibleClient(source,entry,claimUncontrolled){
 try{
  if(!source?.id||new URL(source.url).origin!==self.location.origin)return null;
  const release=await releaseForEntry(entry);if(!release||!await pin(source.id,release.version))return null;
  if(claimUncontrolled){
   if(!self.clients?.matchAll||!self.clients?.claim)return null;
   // New windows can appear between enumeration and claim. Unknown clients
   // remain network-only even after a worker restart until explicitly pinned.
   await (await caches.open(PIN_CACHE)).put(absolute(UNKNOWN_CLIENT_POLICY),new Response('network'));
   const [all,controlled]=await Promise.all([self.clients.matchAll({type:'window',includeUncontrolled:true}),self.clients.matchAll({type:'window'})]),controlledIds=new Set(controlled.map(client=>client.id));
   for(const client of all){
    if(client.id===source.id||controlledIds.has(client.id)||new URL(client.url).origin!==self.location.origin)continue;
    // Claim affects all matching windows. Preserve known version pins and
    // durably fence every other older, unknown graph before taking control.
    const value=await clientPin(client.id);if(!await pin(client.id,value||'network'))return null;
   }
   await self.clients.claim();
  }
  return release;
 }catch{return null;}
}
async function navigationRelease(response,clientId){
 if(!clientId)return;
 await pin(clientId,'network');
 const html=await response.clone().text(),entry=/<script\b[^>]*\bsrc=["'](\/reader-web\/reader-[a-f0-9]{16}\.js)["'][^>]*>/i.exec(html)?.[1];
 if(!entry){await pin(clientId,'network');return;}
 const release=await releaseForEntry(entry);if(release){await pin(clientId,release.version);return;}
 // A fresh network document can use its own fresh graph. It must not silently
 // borrow an older worker's unversioned modules or claim offline readiness.
 await pin(clientId,'network');
}
async function staticResponse(request,release,entry){
 const cache=await caches.open(groupName(release.version)),cached=await cache.match(absolute(entry.url));
 if(await verified(cached,entry))return cached;
 // Repair only this release's expected public bytes. A newer deployment cannot
 // substitute its raw modules into an old, still-open document.
 const response=await fetch(absolute(entry.url),{credentials:'omit',cache:'no-store',redirect:'error'});
 if(!await verified(response,entry))throw Error('Offline resource integrity mismatch: '+entry.url);
 const sanitized=await publicResponse(response);await cache.put(absolute(entry.url),sanitized.clone());return sanitized;
}

self.addEventListener('install',event=>{
 event.waitUntil((async()=>{
  if(!validRelease(OFFLINE_RELEASE))throw Error('Offline release is not built');
  const cache=await caches.open(groupName(OFFLINE_RELEASE.version));
  try{
   // No completion descriptor is written until every resource has passed SHA-256.
   await cache.delete(absolute(DESCRIPTOR));
   let cursor=0,failure=null;
   const prepare=async()=>{
    while(!failure&&cursor<OFFLINE_RELEASE.resources.length){
     const entry=OFFLINE_RELEASE.resources[cursor++];
     try{
      const response=await fetch(absolute(entry.url),{credentials:'omit',cache:'no-store',redirect:'error'});
      if(!await verified(response,entry))throw Error('Offline resource digest mismatch: '+entry.url);
      await cache.put(absolute(entry.url),await publicResponse(response));
     }catch(error){failure||=error;}
    }
   };
   // Stop scheduling on the first failure, but settle every already-started
   // fetch and cache write before deleting this incomplete release group.
   await Promise.allSettled(Array.from({length:Math.min(6,OFFLINE_RELEASE.resources.length)},()=>prepare()));
   if(failure)throw failure;
   await cache.put(absolute(DESCRIPTOR),new Response(JSON.stringify(OFFLINE_RELEASE),{headers:{'Content-Type':'application/json'}}));
  }catch(error){await caches.delete(groupName(OFFLINE_RELEASE.version));throw error;}
 })());
});
// Cleanup happens only on natural activation. Enumerate live clients before
// removing stale pins, and keep any release one of those pages still uses.
// A concurrently installing/waiting worker owns a group we cannot identify
// safely here, so defer cleanup to its eventual natural activation.
self.addEventListener('activate',event=>{event.waitUntil((async()=>{
 if(!OFFLINE_RELEASE||!self.clients?.matchAll||self.registration?.installing||self.registration?.waiting)return;
 const clients=await self.clients.matchAll({type:'window',includeUncontrolled:true}),live=new Set(clients.filter(client=>{try{return new URL(client.url).origin===self.location.origin;}catch{return false;}}).map(client=>client.id));
 const keep=new Set([groupName(OFFLINE_RELEASE.version)]),pins=await caches.open(PIN_CACHE);
 for(const request of await pins.keys()){
  if(new URL(request.url).pathname===UNKNOWN_CLIENT_POLICY)continue;
  const clientId=decodeURIComponent(new URL(request.url).pathname.slice('/__leafhour-offline__/client/'.length));
  if(live.has(clientId)){
   const version=await (await pins.match(request)).text();if(/^[a-f0-9]{64}$/.test(version))keep.add(groupName(version));
  }else {await pins.delete(request);livePins.delete(clientId);}
 }
 if(self.registration?.installing||self.registration?.waiting)return;
 for(const name of await caches.keys())if(name.startsWith(GROUP_PREFIX)&&!keep.has(name))await caches.delete(name);
})());});
self.addEventListener('message',event=>{
 if(event.data?.type!=='LEAFHOUR_OFFLINE_STATUS')return;
 event.waitUntil((async()=>{
  const checksEntry=Object.hasOwn(event.data,'readerEntry')||event.data.claimUncontrolled===true;
  const release=checksEntry?await compatibleClient(event.source,event.data.readerEntry,event.data.claimUncontrolled===true):await clientRelease(event.source?.id),ready=Boolean(release&&await prepared(release));
  const reply={type:'LEAFHOUR_OFFLINE_STATUS',requestId:event.data.requestId,ready,...(release?{version:release.version}:{})};
  (event.ports?.[0]||event.source)?.postMessage(reply);
 })());
});
self.addEventListener('fetch',event=>{
 const request=event.request,url=new URL(request.url);
 if(request.method!=='GET'||url.origin!==self.location.origin||/^\/api(?:\/|$)/.test(url.pathname))return;
 const isReader=readerRoutes.has(url.pathname),isShelf=shelfRoutes.has(url.pathname),isLibrary=libraryRoutes.has(url.pathname);
 if(request.mode==='navigate'){
  if(!isReader&&!isShelf&&!isLibrary)return;
  event.respondWith((async()=>{
   const clientId=event.resultingClientId||event.clientId;
   // The shelf reads current IndexedDB data, so it can keep its static shell
   // paired with this worker even while a newer deployment is online.
   if(isShelf&&await prepared(OFFLINE_RELEASE)){
    await pin(clientId,OFFLINE_RELEASE.version);
    const entry=OFFLINE_RELEASE.resources.find(resource=>resource.url===OFFLINE_RELEASE.offlineShelf),response=await staticResponse(request,OFFLINE_RELEASE,entry),headers=new Headers(response.headers);headers.set('Cache-Control','no-store');return new Response(await response.arrayBuffer(),{status:200,headers});
   }
   let response;
   try{response=await fetch(request);}catch(error){
    if(!await prepared(OFFLINE_RELEASE))throw error;
    await pin(clientId,OFFLINE_RELEASE.version);
    const entry=OFFLINE_RELEASE.resources.find(resource=>resource.url===(isReader?OFFLINE_RELEASE.readerShell:OFFLINE_RELEASE.offlineShelf));
    if(!entry)throw error;
    const response=await staticResponse(request,OFFLINE_RELEASE,entry),headers=new Headers(response.headers);
    headers.delete('Set-Cookie');headers.set('Cache-Control','no-store');
    if(isReader&&OFFLINE_RELEASE.readerPolicy)headers.set('Content-Security-Policy',OFFLINE_RELEASE.readerPolicy);
    return new Response(await response.arrayBuffer(),{status:200,headers});
   }
   if(isReader&&response.ok){try{await navigationRelease(response,clientId);}catch{await pin(clientId,'network');}}
   else if(isLibrary||isShelf&&response.ok)await pin(clientId,'network');
   return response;
  })());return;
 }
 // Async persisted pins must be read before exact membership is tested: a
 // stopped worker has no memory of a newer page's unique lazy modules.
 // Only public static file kinds enter that lookup; APIs and page routes
 // above remain untouched. An unlisted candidate goes straight to network.
 if(!/\.(?:m?js|css|woff2|svg|png|jpe?g|webp)$/.test(url.pathname)&&!['/offline-reader.html','/offline.html'].includes(url.pathname))return;
 event.respondWith((async()=>{
  const release=await clientRelease(event.clientId),entry=release?.resources.find(resource=>resource.url===url.pathname);
  return entry?staticResponse(request,release,entry):fetch(request);
 })());
});
