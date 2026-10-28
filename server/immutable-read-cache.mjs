// This cache only holds validated, hash-addressed documents. Mutable manifests,
// authorization and write fences must still be read from their durable stores.
export function createImmutableReadCache({maxBytes=32*1024*1024}={}){
 if(!Number.isSafeInteger(maxBytes)||maxBytes<0)throw new RangeError('Invalid immutable cache byte budget');
 const entries=new Map(),inflight=new Map();let usedBytes=0;
 async function read(key,load){
  const cached=entries.get(key);
  if(cached){entries.delete(key);entries.set(key,cached);return structuredClone(cached.value);}
  let pending=inflight.get(key);
  if(!pending){
   pending=Promise.resolve().then(load).then(value=>{
    const isolated=structuredClone(value),bytes=Buffer.byteLength(JSON.stringify(isolated));
    if(bytes<=maxBytes){
     while(usedBytes+bytes>maxBytes){const oldest=entries.keys().next().value;usedBytes-=entries.get(oldest).bytes;entries.delete(oldest);}
     entries.set(key,{value:isolated,bytes});usedBytes+=bytes;
    }
    return isolated;
   });
   inflight.set(key,pending);
  }
  try{return structuredClone(await pending);}finally{if(inflight.get(key)===pending)inflight.delete(key);}
 }
 return {read};
}
