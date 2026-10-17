import {audioError} from './audio-content.mjs';
import {mediaConfiguration} from './media-config.mjs';

// Official schema: https://ai.google.dev/gemini-api/docs/speech-generation
const endpoint='https://generativelanguage.googleapis.com/v1beta/interactions';
const invalidAudio=()=>audioError('声音格式无效，没有开始播放。',502,'invalid_audio');
function validateWave(bytes){
 if(bytes.length<46||bytes.length>4000000||bytes.toString('ascii',0,4)!=='RIFF'||bytes.toString('ascii',8,12)!=='WAVE'||bytes.readUInt32LE(4)!==bytes.length-8)throw invalidAudio();
 let format=false,data=false,offset=12;
 while(offset+8<=bytes.length){
  const tag=bytes.toString('ascii',offset,offset+4),size=bytes.readUInt32LE(offset+4),start=offset+8,end=start+size;
  if(end>bytes.length)throw invalidAudio();
  if(tag==='fmt '){if(size<16||bytes.readUInt16LE(start)!==1||bytes.readUInt16LE(start+2)!==1||bytes.readUInt32LE(start+4)!==24000||bytes.readUInt32LE(start+8)!==48000||bytes.readUInt16LE(start+12)!==2||bytes.readUInt16LE(start+14)!==16)throw invalidAudio();format=true;}
  if(tag==='data'){if(!size||size%2)throw invalidAudio();data=true;}
  offset=end+(size%2);
 }
 if(!format||!data||offset!==bytes.length)throw invalidAudio();
}
export function createSpeechProvider({env=process.env,fetcher=fetch}={}){
 const config=mediaConfiguration(env),key=config.credentials.geminiKey;
 return {available:!!key,model:config.public.speechModel,async synthesize({turns,signal}){
  if(!key)throw audioError('声音服务尚未配置，请填写 GEMINI_API_KEY。',503,'not_configured');
  if(!Array.isArray(turns)||!turns.length||turns.length>24||turns.reduce((n,t)=>n+(t?.text?.length||0),0)>4000||turns.some(t=>typeof t?.text!=='string'||!t.text.trim()||!config.public.voices.some(v=>v.id===t.voice)||t.instructions!==undefined&&(typeof t.instructions!=='string'||t.instructions.length>500)))throw audioError('朗读文字或声音无效。');
  const voices=[...new Set(turns.map(t=>t.voice))];if(voices.length>2)throw audioError('一次最多使用两个声音。');
  const speakers=voices.map((voice,i)=>({voice,speaker:'speaker_'+(i+1)}));
  const content=turns.map(t=>({type:'text',text:t.text,annotations:[{type:'speech_metadata',...(t.instructions?{style:t.instructions}:{}),...(voices.length>1?{speaker:speakers.find(s=>s.voice===t.voice).speaker}:{})}]}));
  const payload={model:config.public.speechModel,store:false,input:[{type:'user_input',content}],response_format:{type:'audio',mime_type:'audio/wav',sample_rate:24000},generation_config:{max_output_tokens:2000,speech_config:voices.length===1?[{voice:voices[0]}]:{speakers}}};
  const combined=signal?AbortSignal.any([signal,AbortSignal.timeout(45000)]):AbortSignal.timeout(45000);combined.throwIfAborted();
  let response;
  try{response=await fetcher(endpoint,{method:'POST',redirect:'error',headers:{'x-goog-api-key':key,'Content-Type':'application/json'},signal:combined,body:JSON.stringify(payload)});}
  catch{if(signal?.aborted)throw signal.reason;throw audioError('Gemini 声音服务连接失败或超时，请稍后重试。',502,'provider_unavailable');}
  if(!response.ok){
   await response.body?.cancel();const status=response.status;
   throw audioError(status===402?'Gemini 声音服务额度不足，请检查 Google 配置。':status===429?'Gemini 额度已用完或请求较多，请检查配额后重试。':[401,403].includes(status)?'Gemini API Key 无效或没有模型权限，请检查 Google 官方配置。':status===400?'Gemini 模型或语音配置无效，请检查服务配置。':'Gemini 声音生成失败，文字仍已保留。',status===402?402:status===429?429:502,status===402?'insufficient_credits':status===429?'rate_limited':'provider_unavailable');
  }
  combined.throwIfAborted();
  if(response.headers.get('content-type')?.split(';')[0]!=='application/json'){await response.body?.cancel();throw invalidAudio();}
  const chunks=[];let size=0;
  try{for await(const chunk of response.body){combined.throwIfAborted();size+=chunk.length;if(size>5500000)throw invalidAudio();chunks.push(Buffer.from(chunk));}}
  catch(error){if(signal?.aborted)throw signal.reason;if(error.code==='invalid_audio')throw error;throw audioError('Gemini 声音接收中断，请重新生成这一段。',502,'provider_unavailable');}
  combined.throwIfAborted();let interaction;
  try{interaction=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw invalidAudio();}
  if(interaction?.status!=='completed'||!Array.isArray(interaction.steps))throw invalidAudio();
  const audio=interaction.steps.filter(step=>step?.type==='model_output').flatMap(step=>Array.isArray(step.content)?step.content:[]).findLast(part=>part?.type==='audio');
  if(audio?.mime_type!=='audio/wav'||typeof audio.data!=='string'||!audio.data.length||audio.data.length>5333336||audio.data.length%4||!/^[A-Za-z0-9+/]+={0,2}$/.test(audio.data))throw invalidAudio();
  const bytes=Buffer.from(audio.data,'base64');if(bytes.toString('base64')!==audio.data)throw invalidAudio();validateWave(bytes);combined.throwIfAborted();
  return {bytes,mimeType:'audio/wav',generationId:typeof interaction.id==='string'&&interaction.id.length<=256&&!interaction.id.includes(key)?interaction.id:null};
 }};
}
