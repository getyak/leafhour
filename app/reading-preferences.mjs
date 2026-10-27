import {validatePreferenceMemory} from './preference-memory-codec.mjs';
// Shared by local rendering and record validation. No generated CSS or remote fonts.
export const appearanceDefaults=Object.freeze({readingPurpose:'manual',preferredLanguage:'source',pageLayout:'scroll',font:22,theme:'system',fontFamily:'song',lineHeight:1.98,paragraphGap:24,letterSpacing:0,wordSpacing:0,fontWeight:400,indent:false,parallelLayout:'stack',parallelStyle:'plain',parallelColor:'auto',parallelBackground:'auto'});
export const appearanceChoices=Object.freeze({readingPurpose:['manual','deep','language'],preferredLanguage:['source','zh'],pageLayout:['scroll','spread'],theme:['system','paper','warm','mist','leaf','night'],fontFamily:['song','kai','sans'],parallelLayout:['columns','stack'],parallelStyle:['plain','muted','quote','tint','reveal'],parallelColor:['auto','green','blue','amber'],parallelBackground:['auto','none','soft']});
export const appearanceBounds=Object.freeze({font:[18,28,1],lineHeight:[1.4,2.4,0.1],paragraphGap:[8,48,4],letterSpacing:[-0.04,0.1,0.01],wordSpacing:[0,0.2,0.02],fontWeight:[300,700,50]});
export function normalizeAppearance(source={},strict=false){
  const result={...appearanceDefaults};
  for(const key of Object.keys(result)){
    const value=source[key];if(value===undefined)continue;
    const range=appearanceBounds[key];
    const valid=range?Number.isFinite(value)&&value>=range[0]&&value<=range[1]:appearanceChoices[key]?appearanceChoices[key].includes(value):typeof value==='boolean';
    if(valid)result[key]=value;else if(strict)throw new Error('阅读偏好格式不正确');
  }
  return result;
}

const readingModes=['en','zh','parallel'];
export function preferredReadingMode(preferences={}, {sourceOnly=false}={}){
  const {readingPurpose,preferredLanguage}=normalizeAppearance(preferences);
  if(sourceOnly||readingPurpose==='language')return 'en';
  if(readingPurpose==='deep')return preferredLanguage==='zh'?'zh':'en';
  return readingModes.includes(preferences.mode)?preferences.mode:'en';
}

// A valid saved manual view (including manual parallel/zh) is a deliberate
// choice and must survive reopening. Records without a saved mode keep the
// legacy original-first opening; Chinese-original-only books stay source-only.
export function openingReadingPreferences(position={}, {sourceOnly=false}={}){
  const preferences=normalizeAppearance(position);
  const mode=sourceOnly?'en':readingModes.includes(position.mode)?position.mode:preferredReadingMode(preferences,{sourceOnly});
  return {...preferences,mode,variant:position.variant==='literal'?'literal':'interpretive'};
}

// Account-wide reading defaults live with the account, never beside avatar or
// auth identity. One strict, bounded v1 snapshot: all existing appearance
// fields plus mode, variant and onboarding state.
const readingModesChoices=readingModes,readingVariantChoices=['literal','interpretive'];
export const readingSetupStates=Object.freeze(['pending','completed','dismissed']);
export const globalPreferenceKeys=Object.freeze([...Object.keys(appearanceDefaults),'mode','variant','onboarding']);
export const globalPreferencesDefaults=Object.freeze({...appearanceDefaults,mode:'en',variant:'interpretive',onboarding:'pending'});
export const globalPreferencesKind='marginalia-reading-preferences';
// Timestamps are bounded before any parsing so oversized metadata can never
// ride through restores or session responses. Valid ISO/time strings fit easily.
export const MAX_PREFERENCE_TIMESTAMP=64;
const strictEnum=(value,choices)=>{if(!choices.includes(value))throw new Error('阅读习惯取值不正确');return value;};
const lenientEnum=(value,choices,fallback)=>choices.includes(value)?value:fallback;
// strict: every known key present and valid, no unknown keys, nothing unbounded.
// lenient: fill safe legacy defaults and drop invalid fields.
export function normalizeGlobalPreferences(source={},strict=false){
  if(!source||typeof source!=='object'||Array.isArray(source)){if(strict)throw new Error('阅读习惯格式不正确');return {...globalPreferencesDefaults};}
  if(strict){for(const key of Object.keys(source))if(!globalPreferenceKeys.includes(key))throw new Error('阅读习惯包含未知字段');for(const key of globalPreferenceKeys)if(!Object.hasOwn(source,key)||source[key]===undefined)throw new Error('阅读习惯快照不完整');}
  const appearance=normalizeAppearance(source,strict);
  return {...appearance,
    mode:source.mode===undefined?globalPreferencesDefaults.mode:strict?strictEnum(source.mode,readingModesChoices):lenientEnum(source.mode,readingModesChoices,globalPreferencesDefaults.mode),
    variant:source.variant===undefined?globalPreferencesDefaults.variant:strict?strictEnum(source.variant,readingVariantChoices):lenientEnum(source.variant,readingVariantChoices,globalPreferencesDefaults.variant),
    onboarding:source.onboarding===undefined?globalPreferencesDefaults.onboarding:strict?strictEnum(source.onboarding,readingSetupStates):lenientEnum(source.onboarding,readingSetupStates,globalPreferencesDefaults.onboarding)};
}
export const validateGlobalPreferences=value=>normalizeGlobalPreferences(value,true);
// The portable/persisted wrapper keeps the CAS revision with the snapshot.
export function globalPreferencesMetadata(view){
  return {kind:globalPreferencesKind,schemaVersion:1,revision:Number.isSafeInteger(view?.revision)&&view.revision>=0?view.revision:0,updatedAt:typeof view?.updatedAt==='string'&&view.updatedAt.length<=MAX_PREFERENCE_TIMESTAMP?view.updatedAt:new Date().toISOString(),preferences:normalizeGlobalPreferences(view?.preferences),...(view?.memory!==undefined?{memory:validatePreferenceMemory(view.memory)}:{})};
}
export function validateGlobalPreferencesMetadata(value){
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('阅读习惯备份信息不完整');
  for(const key of Object.keys(value))if(!['kind','schemaVersion','revision','updatedAt','preferences','memory'].includes(key))throw new Error('阅读习惯备份包含未知字段');
  if(value.kind!==globalPreferencesKind||value.schemaVersion!==1||!Number.isSafeInteger(value.revision)||value.revision<0||typeof value.updatedAt!=='string'||value.updatedAt.length>MAX_PREFERENCE_TIMESTAMP||!Number.isFinite(Date.parse(value.updatedAt)))throw new Error('阅读习惯备份版本不正确');
  return {kind:globalPreferencesKind,schemaVersion:1,revision:value.revision,updatedAt:value.updatedAt,preferences:validateGlobalPreferences(value.preferences),...(value.memory!==undefined?{memory:validatePreferenceMemory(value.memory)}:{})};
}

// Opening precedence: explicit entry intent is applied afterwards through
// entryViewPreferences; a valid per-book saved view wins over the account
// defaults, which win over safe legacy guest defaults.
export function openingReadingView({saved=null,account=null,sourceOnly=false}={}){
  return openingReadingPreferences(saved||account||{},{sourceOnly});
}
// Deep links and cited layers override the opened view without touching saves.
export function entryViewPreferences(entry){
  if(!entry)return {};
  const patch={};
  if(entry.note||entry.action==='translate')patch.mode='en';
  if(entry.layer){patch.mode=entry.mode;if(entry.variant)patch.variant=entry.variant;}
  return patch;
}
