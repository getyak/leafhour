import {modelConfiguration} from './model-config.mjs';
export function mediaConfiguration(env=process.env){
 const models=modelConfiguration(env);
 return {public:{textModel:models.audioScript,speechModel:models.speech,imageModel:models.image,speechAvailable:!!env.OPENROUTER_API_KEY,dialogueAvailable:!!env.DEEPSEEK_API_KEY,voices:[{id:'Sulafat',label:'温暖',description:'平静地读，适合长一些的段落'},{id:'Charon',label:'清晰',description:'条理清楚，适合讲解'},{id:'Puck',label:'轻快',description:'语气轻松，适合对话'},{id:'Kore',label:'沉稳',description:'声音坚定，节奏从容'}]},credentials:{openRouterKey:env.OPENROUTER_API_KEY,deepseekKey:env.DEEPSEEK_API_KEY}};
}
