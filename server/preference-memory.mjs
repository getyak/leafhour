import {initialPreferenceMemory,validatePreferenceMemory,validMemoryValue,memoryKeys,onboardingChoices} from '../app/preference-memory-codec.mjs';
import {globalPreferencesDefaults,normalizeGlobalPreferences} from '../app/reading-preferences.mjs';
import {fail,digest} from './document-import.mjs';
export function memoryFor(data,user){
 if(data.memory!==undefined){try{return validatePreferenceMemory(data.memory);}catch{throw fail('阅读偏好记录无法识别，已保持原样',409);}}
 const order=parseInt(digest(user.id).slice(-1),16)%2?['language','topic','style']:['topic','language','style'];
 return initialPreferenceMemory({order,status:data.preferences?.onboarding||'pending'});
}
export function recordPreference(memory,operation,key,value,source,at){
 memory.history.push({operation,key,...(value===undefined?{}:{value}),source,at});memory.history=memory.history.slice(-100);
 if(['update','confirm'].includes(operation)){memory.sources[key]={source,at};delete memory.suggestions[key];}
 if(operation==='delete'){delete memory.sources[key];delete memory.suggestions[key];}
}
export function applyMemoryChange(data,user,input,source){
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['baseRevision','action','key','value','inferred','event','choice'].includes(k))||!Number.isSafeInteger(input.baseRevision)||input.baseRevision<0)throw fail('阅读偏好请求格式不正确');
 if((data.revision||0)!==input.baseRevision)throw fail('阅读偏好已在另一处更新，请读取最新版本',409);
 if(input.baseRevision>=Number.MAX_SAFE_INTEGER)throw fail('阅读偏好版本已超过保存范围',409);
 if(!['settings','onboarding','agent'].includes(source))throw fail('阅读偏好来源不正确');
 const actions={update:['key','value','inferred'],delete:['key'],confirm:['key'],reject:['key'],onboarding:['event','key','choice']},allowed=Object.hasOwn(actions,input.action)?actions[input.action]:null;
 if(!allowed||Object.keys(input).some(k=>!['baseRevision','action',...allowed].includes(k))||input.inferred!==undefined&&typeof input.inferred!=='boolean')throw fail('阅读偏好操作不正确');
 const memory=memoryFor(data,user),preferences=normalizeGlobalPreferences(data.preferences||{}),at=new Date().toISOString();
 function update(key,value,inferred=false){
  if(!validMemoryValue(key,value))throw fail('阅读偏好取值不正确');
  if(inferred){memory.suggestions[key]={value,source,at};recordPreference(memory,'suggest',key,value,source,at);}
  else{if(key==='topic')memory.topic=value;else preferences[key]=value;if(key==='mode')preferences.readingPurpose='manual';recordPreference(memory,'update',key,value,source,at);}
 }
 if(input.action==='update')update(input.key,input.value,input.inferred===true);
 else if(['delete','confirm','reject'].includes(input.action)){
  const key=input.key;if(!memoryKeys.includes(key))throw fail('阅读偏好项目不存在');
  if(input.action==='confirm'){
   if(source!=='settings')throw fail('请在设置中确认推测偏好',403);
   const suggestion=memory.suggestions[key];if(!suggestion)throw fail('这项推测已变化，请读取最新版本',409);
   update(key,suggestion.value);memory.history.at(-1).operation='confirm';
  }else if(input.action==='reject'){
   delete memory.suggestions[key];recordPreference(memory,'reject',key,undefined,source,at);
  }else{if(key==='topic')memory.topic=null;else preferences[key]=globalPreferencesDefaults[key];recordPreference(memory,'delete',key,undefined,source,at);}
 }else{
  if(source!=='onboarding')throw fail('引导来源不正确',403);
  const o=memory.onboarding,emit=(event,key)=>o.events.push({event,...(key?{key}:{}),at,order:[...o.order]});
  if(o.status!=='pending')throw fail('阅读引导已完成或跳过',409);
  if(!o.events.some(e=>e.event==='started'))emit('started');
  if(input.event==='dismissed'){o.status='dismissed';emit('dismissed');}
  else if(input.event==='started'){if(input.key!==undefined||input.choice!==undefined)throw fail('引导请求格式不正确');}
  else if(['answered','skipped'].includes(input.event)){
   const key=o.order[o.answers.length];if(input.key!==key)throw fail('请先读取当前引导问题',409);
   if(input.event==='answered'){
    if(!onboardingChoices[key].includes(input.choice))throw fail('引导选项不正确');
    if(key==='topic')update('topic',input.choice);
    if(key==='style')update('theme',input.choice);
    if(key==='language'){update('mode',input.choice);update('preferredLanguage',input.choice==='zh'?'zh':'source');preferences.readingPurpose='manual';}
   }else if(input.choice!==undefined)throw fail('跳过的问题不应包含选项');
   o.answers.push({key,choice:input.event==='answered'?input.choice:null});emit(input.event,key);
   if(o.answers.length===3){o.status='completed';emit('completed');}
  }else throw fail('引导事件不正确');
  preferences.onboarding=o.status;
 }
 data.kind='marginalia-reading-preferences';data.schemaVersion=1;data.revision=input.baseRevision+1;data.updatedAt=at;data.preferences=preferences;data.memory=validatePreferenceMemory(memory);
 return {revision:data.revision,updatedAt:at,preferences:structuredClone(preferences),memory:structuredClone(memory)};
}
