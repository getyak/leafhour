// Finite account preferences. No free-form biography, private notes or model text.
export const memoryChoices=Object.freeze({topic:['philosophy','science','literature','history','fiction'],mode:['en','zh','parallel'],preferredLanguage:['source','zh'],theme:['system','paper','warm','mist','leaf','night']});
export const onboardingChoices=Object.freeze({topic:memoryChoices.topic,language:['en','zh','parallel'],style:['paper','warm','night']});
export const memoryKeys=Object.freeze(Object.keys(memoryChoices));
export function validMemoryValue(key,value){return Object.hasOwn(memoryChoices,key)&&memoryChoices[key].includes(value);}
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).every(k=>keys.includes(k));
const stamp=v=>typeof v==='string'&&v.length<=64&&Number.isFinite(Date.parse(v));
const sources=['settings','onboarding','agent'];
export function initialPreferenceMemory({order=['topic','language','style'],status='pending'}={}){return {schemaVersion:1,topic:null,sources:{},suggestions:{},history:[],onboarding:{status,order:[...order],answers:[],events:[]}};}
export function validatePreferenceMemory(v){
 const bad=()=>{throw Error('Invalid preference memory');};
 if(!exact(v,['schemaVersion','topic','sources','suggestions','history','onboarding'])||Object.keys(v).length!==6||v.schemaVersion!==1||v.topic!==null&&!memoryChoices.topic.includes(v.topic))bad();
 for(const key of ['sources','suggestions']){
  if(!exact(v[key],memoryKeys))bad();
  for(const [name,row]of Object.entries(v[key])){if(!exact(row,key==='sources'?['source','at']:['source','at','value'])||!sources.includes(row.source)||!stamp(row.at)||key==='suggestions'&&!validMemoryValue(name,row.value))bad();}
 }
 if(!Array.isArray(v.history)||v.history.length>100||v.history.some(r=>!exact(r,['operation','key','value','source','at'])||!['update','delete','suggest','confirm','reject'].includes(r.operation)||!memoryKeys.includes(r.key)||!sources.includes(r.source)||!stamp(r.at)||r.value!==undefined&&!validMemoryValue(r.key,r.value)))bad();
 const o=v.onboarding;if(!exact(o,['status','order','answers','events'])||Object.keys(o).length!==4||!['pending','completed','dismissed'].includes(o.status)||!Array.isArray(o.order)||o.order.length!==3||new Set(o.order).size!==3||o.order.some(k=>!Object.hasOwn(onboardingChoices,k))||!Array.isArray(o.answers)||o.answers.length>3||new Set(o.answers.map(a=>a.key)).size!==o.answers.length||o.answers.some((a,i)=>!exact(a,['key','choice'])||a.key!==o.order[i]||a.choice!==null&&!onboardingChoices[a.key]?.includes(a.choice)))bad();
 if(!Array.isArray(o.events)||o.events.length>8||o.events.some(e=>!exact(e,['event','key','at','order'])||!['started','answered','skipped','completed','dismissed'].includes(e.event)||!stamp(e.at)||JSON.stringify(e.order)!==JSON.stringify(o.order)||e.key!==undefined&&!o.order.includes(e.key)))bad();
 if(o.status==='pending'&&o.answers.length===3||o.events.filter(e=>e.event==='started').length>1||o.events.filter(e=>e.event==='completed').length>1||o.events.some(e=>e.event==='completed')&&(o.status!=='completed'||o.answers.length!==3))bad();
 return structuredClone(v);
}
