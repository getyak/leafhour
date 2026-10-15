import {audioError} from './audio-content.mjs';
import {mediaConfiguration} from './media-config.mjs';
// Official request schema: https://openrouter.ai/docs/guides/overview/multimodal/tts
export function createSpeechProvider({env=process.env,fetcher=fetch}={}){
 const config=mediaConfiguration(env),key=config.credentials.openRouterKey;
 return {available:!!key,model:config.public.speechModel,async synthesize({turns,signal}){
  if(!key)throw audioError('声音服务尚未配置，正文仍可阅读。',503,'not_configured');
  if(!Array.isArray(turns)||!turns.length||turns.reduce((n,t)=>n+(t.text?.length||0),0)>4000||turns.some(t=>typeof t.text!=='string'||!t.text.trim()||!config.public.voices.some(v=>v.id===t.voice)))throw audioError('朗读文字或声音无效。');
  const combined=signal?AbortSignal.any([signal,AbortSignal.timeout(45000)]):AbortSignal.timeout(45000);combined.throwIfAborted();
  let response;try{response=await fetcher('https://openrouter.ai/api/v1/audio/speech',{method:'POST',redirect:'error',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},signal:combined,body:JSON.stringify({model:config.public.speechModel,input:turns.map(t=>({text:t.text,voice:t.voice,...(t.instructions?{instructions:t.instructions}:{})})),response_format:'mp3'})});}catch(error){if(signal?.aborted)throw signal.reason;throw audioError('准备声音超时或连接失败，请稍后重试。',502,'provider_unavailable');}
  if(!response.ok){await response.body?.cancel();const status=response.status;throw audioError(status===402?'声音服务余额不足，请检查服务配置。':status===429?'声音服务正在忙，请稍后再试。':'声音生成失败，文字仍已保留。',status===402?402:status===429?429:502,status===402?'insufficient_credits':status===429?'rate_limited':'provider_unavailable');}
  const mimeType=response.headers.get('content-type')?.split(';')[0];
  if(mimeType!=='audio/mpeg'){await response.body?.cancel();throw audioError('声音格式无效，没有开始播放。',502,'invalid_audio');}
  const chunks=[];let size=0;try{for await(const chunk of response.body){combined.throwIfAborted();size+=chunk.length;if(size>4000000)throw audioError('声音文件超过单段限制，请缩短选文。',502,'invalid_audio');chunks.push(Buffer.from(chunk));}}catch(error){if(error.code==='invalid_audio'||signal?.aborted)throw error;throw audioError('声音接收中断，请重新生成这一段。',502,'provider_unavailable');}
  const bytes=Buffer.concat(chunks),mp3=bytes.length>=4&&(bytes.subarray(0,3).toString()==='ID3'||bytes[0]===255&&(bytes[1]&224)===224);
  if(!mp3)throw audioError('声音格式无效，没有开始播放。',502,'invalid_audio');
  return {bytes,mimeType,generationId:response.headers.get('x-generation-id')||null};
 }};
}
