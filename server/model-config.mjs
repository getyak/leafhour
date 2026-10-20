// All DeepSeek text paths share one default. Existing pricing guards remain
// authoritative; speech and image keep their provider-specific model IDs.
export const DEFAULT_MODELS=Object.freeze({reading:'deepseek-flash',translation:'deepseek-flash',audioScript:'deepseek-flash',speech:'gemini-3.8-flash-tts',image:'google/gemini-nano-banana-2.1'});

export function modelConfiguration(env=process.env){
 return {translation:env.READER_TRANSLATION_MODEL||DEFAULT_MODELS.translation,audioScript:env.READER_AUDIO_SCRIPT_MODEL||env.READER_DIALOGUE_MODEL||DEFAULT_MODELS.audioScript,speech:(env.READER_SPEECH_MODEL||DEFAULT_MODELS.speech).replace(/^google\//,''),image:env.READER_IMAGE_MODEL||DEFAULT_MODELS.image};
}

// Only disclose fixed labels and credential presence. No model request or
// balance check runs here, so configured credentials are explicitly unverified.
export function configurationSummary({env=process.env,speechSupported=false}={}){
 const text=env.DEEPSEEK_API_KEY?'已配置，待验证':'未配置（可填写 DEEPSEEK_API_KEY）';
 const speech=speechSupported?(env.GEMINI_API_KEY?'已配置，待验证':'未配置（可填写 GEMINI_API_KEY）'):'当前部署尚未支持'+(env.GEMINI_API_KEY?'（Key 已配置）':'');
 return ['Leafhour 配置：','  阅读：无需 AI Key','  AI 文字：'+text,'  语音：'+speech].join('\n');
}
