export function mediaConfiguration(env=process.env){
 const speechModel=env.READER_SPEECH_MODEL||'google/gemini-3.8-flash-tts',imageModel=env.READER_IMAGE_MODEL||'google/gemini-nano-banana-2.1';
 return {public:{textModel:env.READER_DIALOGUE_MODEL||'deepseek-chat',speechModel,imageModel,speechAvailable:!!env.OPENROUTER_API_KEY,dialogueAvailable:!!env.DEEPSEEK_API_KEY,voices:[{id:'Sulafat',label:'温暖',description:'平静地读，适合长一些的段落'},{id:'Charon',label:'清晰',description:'条理清楚，适合讲解'},{id:'Puck',label:'轻快',description:'语气轻松，适合对话'},{id:'Kore',label:'沉稳',description:'声音坚定，节奏从容'}]},credentials:{openRouterKey:env.OPENROUTER_API_KEY,deepseekKey:env.DEEPSEEK_API_KEY}};
}
