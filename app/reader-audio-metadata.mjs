// Read-only capabilities/preferences. The eager owner and mounted controller
// share this one promise and the already-created reader API/session instance.
export function readAudioMetadata({readerFetch,readerStorageKey,readerSession,storage,valid}){
 const check=()=>{if(!valid())throw Error('Stale audio metadata');};
 const get=async action=>{check();const response=await readerFetch('/api/audio/'+action);check();const value=await response.json();check();if(!response.ok)throw Error('Audio metadata unavailable');return value;};
 return (async()=>{
  const capabilities=await get('capabilities');check();
  let prefs={narrator:'Sulafat',guide:'Charon',questioner:'Puck',speed:1,follow:true};
  try{prefs={...prefs,...JSON.parse(storage.getItem(readerStorageKey('marginalia-audio-preferences-v1'))||'{}')};}catch{}
  let error=false;if(!readerSession||readerSession.user)try{prefs={...prefs,...await get('preferences')};}catch{check();error=true;}
  check();return {capabilities,prefs,error};
 })().catch(error=>{check();return {capabilities:{speechAvailable:false,dialogueAvailable:false,local:true,voices:[]},prefs:{narrator:'Sulafat',guide:'Charon',questioner:'Puck',speed:1,follow:true},error:true,capabilitiesFailed:true};});
}

// Only exact built-in server identity/text pairs are UI. Customized capability
// prose stays literal even when its voice ID matches a built-in voice.
const builtinVoiceUi={
 Sulafat:{label:'温暖',description:'平静地读，适合长一些的段落'},
 Charon:{label:'清晰',description:'条理清楚，适合讲解'},
 Puck:{label:'轻快',description:'语气轻松，适合对话'},
 Kore:{label:'沉稳',description:'声音坚定，节奏从容'}
};
export function audioVoiceUi(voice,field='label'){
 const value=voice?.[field];
 return (field==='label'||field==='description')&&Object.hasOwn(builtinVoiceUi,voice?.id)&&builtinVoiceUi[voice.id][field]===value
  ?Object.freeze({id:'audio.voice.'+voice.id+'.'+field,params:Object.freeze({})}):value;
}
