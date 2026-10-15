export const name='reading-chat';
export const inject=['tools','llm'];
export function apply(ctx,config){
 const names=new Set(config.definitions.map(d=>d.name));let failed=false;
 const live=()=>{if(failed||Date.now()>config.expiresAt)throw Error('Reading run cancelled or expired');};
 async function request(route,body){
  live();try{
   const encoded=JSON.stringify(body);if(Buffer.byteLength(encoded)>8192)throw Error('Bridge request too large');
   const res=await fetch(config.bridgeUrl+route,{method:'POST',headers:{Authorization:'Bearer '+config.token,'Content-Type':'application/json'},body:encoded,signal:AbortSignal.timeout(Math.max(1,config.expiresAt-Date.now()))});
   if(!res.ok)throw Error('Reading bridge unavailable');const text=await res.text();if(Buffer.byteLength(text)>24576)throw Error('Bridge result too large');live();return JSON.parse(text);
  }catch{failed=true;throw Error('Reading runtime request failed');}
 }
 ctx.tools.guard(exec=>{if(!names.has(exec.name))return 'Tool unavailable in this reading run';try{live();}catch{return 'Reading run cancelled or expired';}});
 ctx.on('llm/stream',async function*(options,next){
  live();const inputBytes=Buffer.byteLength(JSON.stringify(options,(key,value)=>['signal'].includes(key)?undefined:value));
  await request('/reserve',{inputBytes,maxTokens:options.maxTokens||3072,kind:'main'});
  live();for await(const chunk of next()){live();yield chunk;}
 });
 for(const definition of config.definitions)ctx.tools.register({...definition,output:{schema:{type:'object'},render:(_,value)=>[{type:'text',text:JSON.stringify(value)}]},execute:args=>request('/tool',{name:definition.name,args})});
}
